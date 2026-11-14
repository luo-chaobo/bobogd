'use strict';
const { SECTIONS } = require('./state-sql-rehearsal');
const { readRowState } = require('./row-state-reader');
const { planRowChanges } = require('./row-diff-planner');
const { insertOrder, orderValues, insertException, exceptionValues } = require('./business-store');
const { insertWorkOrder, insertRoute, productionValues } = require('./production-store');
const { insertReport, reportValues } = require('./report-store');
const { insertOutbox, outboxValues } = require('./integration-store');
const { appendRawArray, insertRawObject } = require('./raw-section-store');
const { allocatePosition } = require('./row-sequence');
const { insertAudit } = require('./audit-store');

const CREATE_STATE_LOCK_TABLE = `CREATE TABLE IF NOT EXISTS bobo_state_write_lock (
  id TINYINT NOT NULL PRIMARY KEY
) ENGINE=InnoDB`;

const CORE = Object.freeze({
  orders: { table: 'bobo_orders_v2', insert: insertOrder, values: orderValues, columns: [] },
  workOrders: { table: 'bobo_work_orders_v2', insert: insertWorkOrder, values: (item) => productionValues(item, 'orderId'), columns: ['order_id'] },
  routes: { table: 'bobo_routes_v2', insert: insertRoute, values: (item) => productionValues(item, 'workOrderId'), columns: ['work_order_id'] },
  reports: { table: 'bobo_reports_v2', insert: insertReport, values: reportValues, columns: ['work_order_id', 'route_id', 'created_at'] },
  exceptions: { table: 'bobo_exceptions_v2', insert: insertException, values: exceptionValues, columns: ['work_order_id', 'route_id'] },
  platformWebhookEvents: { table: 'bobo_outbox_v2', insert: insertOutbox, values: outboxValues, columns: ['status', 'external_order_number', 'event_sequence'] }
});

async function applyRowChanges(connection, state, options = {}) {
  const plan = planRowChanges(state);
  for (const [section, table, kind] of SECTIONS) {
    const changes = plan[section];
    if (options.writableSections && !options.writableSections.has(section)) {
      if (changes.inserted.length || changes.updated.length || changes.deleted.length || changes.requiresReorder) throw new Error(`Unexpected scoped write in ${section}`);
      continue;
    }
    if (section === 'auditLogs' && options.auditBuffer) {
      if (changes.updated.length || changes.deleted.length || changes.requiresReorder) throw new Error('Audit buffer cannot update existing records');
      for (const change of changes.inserted) await insertAudit(connection, change.item);
      if (changes.inserted.length) {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 23).replace('T', ' ');
        await connection.execute('DELETE FROM bobo_audit_logs_v2 WHERE created_at < ?', [cutoff]);
      }
      continue;
    }
    const core = CORE[section];
    const tableName = core ? core.table : `raw_${table}`;
    const position = core ? 'source_position' : 'position';
    for (const change of changes.deleted) {
      const [result] = await connection.execute(
        `DELETE FROM \`${tableName}\` WHERE ${position} = ? AND payload <=> CAST(? AS JSON)`,
        [String(change.position), change.expectedPayload]
      );
      if (result.affectedRows !== 1) throw new Error(`Stale or missing row in ${section}`);
    }
    async function updateRow(change, newPosition) {
      let fields;
      let payload;
      if (core) {
        const values = core.values(change.item);
        if (section === 'platformWebhookEvents') {
          const previous = core.values(JSON.parse(change.expectedPayload));
          if (previous[2] !== values[2] || previous[3] !== values[3]) throw new Error('Outbox order and sequence cannot change');
        }
        payload = values[values.length - 1];
        fields = core.columns.map((column, index) => [column, values[index + 1]]);
      } else {
        payload = JSON.stringify(change.item);
        if (payload === undefined) throw new TypeError(`Invalid payload in ${section}`);
        const id = kind === 'array' && change.item && typeof change.item === 'object' && typeof change.item.id === 'string' ? change.item.id : null;
        if (id !== null && id.length > 191) throw new TypeError(`Invalid record ID in ${section}`);
        fields = [['record_id', id]];
      }
      const assignments = fields.map(([column]) => `\`${column}\` = ?`);
      assignments.push('payload = CAST(? AS JSON)');
      if (newPosition !== null) assignments.push(`${position} = ?`);
      const [result] = await connection.execute(
        `UPDATE \`${tableName}\` SET ${assignments.join(', ')} WHERE ${position} = ? AND payload <=> CAST(? AS JSON)`,
        [...fields.map(([, value]) => value), payload, ...(newPosition === null ? [] : [newPosition]), String(change.position), change.expectedPayload]
      );
      if (result.affectedRows !== 1) throw new Error(`Stale or missing row in ${section}`);
    }
    async function insertRow(change) {
      if (core) await core.insert(connection, change.item);
      else if (kind === 'array') await appendRawArray(connection, section, change.item);
      else await insertRawObject(connection, section, change.key, change.item);
    }
    if (changes.requiresReorder) {
      for (const change of changes.desired) {
        if (change.existing) await updateRow(change, await allocatePosition(connection, section));
        else await insertRow(change);
      }
    } else {
      for (const change of changes.updated) await updateRow(change, null);
      for (const change of changes.inserted) await insertRow(change);
    }
  }
  return plan;
}

// The callback may only modify the supplied state; external effects happen after commit.
async function withLockedRowState(pool, action, shouldApply = () => true, options = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locks] = await connection.execute('SELECT id FROM bobo_state_write_lock WHERE id = 1 FOR UPDATE');
    if (locks.length !== 1) throw new Error('Missing state write lock');
    const state = await readRowState(connection, options);
    const result = await action(state, connection);
    if (shouldApply()) await applyRowChanges(connection, state, options);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { CREATE_STATE_LOCK_TABLE, applyRowChanges, withLockedRowState };
