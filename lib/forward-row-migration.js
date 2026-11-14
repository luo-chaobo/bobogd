'use strict';

const { isDeepStrictEqual } = require('node:util');
const { SECTIONS } = require('./state-sql-rehearsal');
const { readRowState, withConsistentRowRead, ROW_METADATA } = require('./row-state-reader');
const { applyRowChanges, CREATE_STATE_LOCK_TABLE } = require('./row-state-writer');
const { planRowChanges } = require('./row-diff-planner');
const { CREATE_SEQUENCES_TABLE, initializeSequence } = require('./row-sequence');
const { CREATE_ORDERS_TABLE, CREATE_EXCEPTIONS_TABLE, orderValues, exceptionValues } = require('./business-store');
const { CREATE_WORK_ORDERS_TABLE, CREATE_ROUTES_TABLE, productionValues, withTransaction } = require('./production-store');
const { CREATE_REPORTS_TABLE, reportValues } = require('./report-store');
const { CREATE_OUTBOX_TABLE, outboxValues } = require('./integration-store');
const { CREATE_AUDIT_TABLE, auditValues, insertAudit } = require('./audit-store');
const { buildLegacyState } = require('./legacy-reconstruction');

const core = new Set(['orders', 'workOrders', 'routes', 'reports', 'exceptions', 'platformWebhookEvents']);

function validateGraph(state) {
  const orders = new Set(state.orders.map((item) => orderValues(item)[0]));
  const workOrders = new Set();
  const routes = new Map();
  if (orders.size !== state.orders.length) throw new Error('Duplicate order ID');
  for (const item of state.workOrders) {
    const [id, orderId] = productionValues(item, 'orderId');
    if (workOrders.has(id) || !orders.has(orderId)) throw new Error('Invalid work order relationship');
    workOrders.add(id);
  }
  for (const item of state.routes) {
    const [id, workOrderId] = productionValues(item, 'workOrderId');
    if (routes.has(id) || !workOrders.has(workOrderId)) throw new Error('Invalid route relationship');
    routes.set(id, workOrderId);
  }
  for (const [items, values] of [[state.reports, reportValues], [state.exceptions, exceptionValues]]) {
    const ids = new Set();
    for (const item of items) {
      const [id, workOrderId, routeId] = values(item);
      if (ids.has(id) || routes.get(routeId) !== workOrderId) throw new Error('Invalid report or exception relationship');
      ids.add(id);
    }
  }
  const ids = new Set();
  const sequences = new Set();
  for (const item of state.platformWebhookEvents) {
    const [id, , order, sequence] = outboxValues(item);
    const orderSequence = JSON.stringify([order, sequence]);
    if (ids.has(id) || sequences.has(orderSequence)) throw new Error('Duplicate outbox event or sequence');
    ids.add(id);
    sequences.add(orderSequence);
  }
}

function validateForwardState(state) {
  buildLegacyState(state, state.auditLogs);
  state.auditLogs.forEach(auditValues);
  validateGraph(state);
  const candidate = { ...state, [ROW_METADATA]: new Map(SECTIONS.map(([name]) => [name, []])) };
  planRowChanges(candidate);
}

function readForwardSnapshot(pool) {
  return withConsistentRowRead(pool, async (connection) => {
    const [rows] = await connection.query("SELECT CAST(value_json AS CHAR CHARACTER SET utf8mb4) AS payload FROM app_state WHERE name = 'main'");
    if (rows.length !== 1) throw new Error('Legacy state missing');
    const state = JSON.parse(rows[0].payload);
    const [tables] = await connection.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('audit_logs', 'bobo_audit_logs_v2')");
    const tableNames = new Set(tables.map(({ name }) => name));
    if (!Object.hasOwn(state, 'auditLogs') && tableNames.has('bobo_audit_logs_v2')) state.auditLogs = [];
    buildLegacyState(state, state.auditLogs);
    const audits = new Map(state.auditLogs.map((item) => [item.id, item]));
    if (tableNames.has('bobo_audit_logs_v2')) {
      const [splitAudits] = await connection.query('SELECT id, CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM bobo_audit_logs_v2 ORDER BY id');
      for (const { id, payload } of splitAudits) {
        const item = JSON.parse(payload);
        if (item.id !== id || (audits.has(id) && !isDeepStrictEqual(audits.get(id), item))) throw new Error('Conflicting audit records');
        audits.set(id, item);
      }
    }
    state.auditLogs = [...audits.values()];
    validateForwardState(state);
    const [legacyAudit] = tableNames.has('audit_logs') ? await connection.query('SELECT * FROM audit_logs ORDER BY id') : [[]];
    return { state, legacyAudit };
  });
}

async function initializeEmptyTarget(connection) {
  const [[{ count }]] = await connection.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()');
  if (Number(count) !== 0) throw new Error('Row target database must be empty');
  for (const ddl of [CREATE_STATE_LOCK_TABLE, CREATE_SEQUENCES_TABLE, CREATE_ORDERS_TABLE, CREATE_WORK_ORDERS_TABLE, CREATE_ROUTES_TABLE, CREATE_REPORTS_TABLE, CREATE_EXCEPTIONS_TABLE, CREATE_OUTBOX_TABLE, CREATE_AUDIT_TABLE]) {
    await connection.query(ddl.replace('IF NOT EXISTS ', ''));
  }
  for (const [section, table] of SECTIONS) {
    if (core.has(section)) continue;
    await connection.query(`CREATE TABLE \`raw_${table}\` (
      position BIGINT UNSIGNED PRIMARY KEY, record_key VARCHAR(191) NULL UNIQUE,
      record_id VARCHAR(191) NULL, payload JSON NOT NULL, INDEX idx_record_id (record_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  }
  await connection.query('CREATE TABLE archive_legacy_audit_payload (position BIGINT UNSIGNED PRIMARY KEY, payload JSON NOT NULL) ENGINE=InnoDB');
}

async function writeForwardSnapshot(pool, { state, legacyAudit }, cutoff) {
  await initializeEmptyTarget(pool);
  await withTransaction(pool, async (connection) => {
    for (const [name] of SECTIONS) await initializeSequence(connection, name, 0);
    const empty = await readRowState(connection);
    for (const [name] of SECTIONS) empty[name] = state[name];
    await applyRowChanges(connection, empty);
    const active = state.auditLogs.filter((item) => Date.parse(item.createdAt) >= cutoff);
    for (const item of active) await insertAudit(connection, item);
    for (const [position, item] of legacyAudit.entries()) {
      await connection.execute('INSERT INTO archive_legacy_audit_payload VALUES (?, CAST(? AS JSON))', [position, JSON.stringify(item)]);
    }
    const restored = await readRowState(connection, { trackChanges: false });
    const [activeRows] = await connection.query('SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM bobo_audit_logs_v2');
    const [legacyRows] = await connection.query('SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM archive_legacy_audit_payload ORDER BY position');
    const actualAudit = new Map(activeRows.map(({ payload }) => { const item = JSON.parse(payload); return [item.id, item]; }));
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(restored)), state) ||
        !isDeepStrictEqual(actualAudit, new Map(active.map((item) => [item.id, item]))) ||
        !isDeepStrictEqual(legacyRows.map(({ payload }) => JSON.parse(payload)), legacyAudit)) {
      throw new Error('Row migration reconciliation failed');
    }
    await connection.query('INSERT INTO bobo_state_write_lock VALUES (1)');
  });
}

module.exports = { readForwardSnapshot, writeForwardSnapshot, validateForwardState };
