'use strict';
const { SECTIONS } = require('./state-sql-rehearsal');
const ROW_METADATA = Symbol('boboRowMetadata');

const CORE_TABLES = Object.freeze({
  orders: 'bobo_orders_v2',
  workOrders: 'bobo_work_orders_v2',
  routes: 'bobo_routes_v2',
  reports: 'bobo_reports_v2',
  exceptions: 'bobo_exceptions_v2',
  platformWebhookEvents: 'bobo_outbox_v2'
});

// Caller supplies one connection inside a consistent read transaction.
async function readRowState(connection, options = {}) {
  const result = {};
  const metadata = new Map();
  for (const [section, table, kind] of SECTIONS) {
    if (section === 'auditLogs' && options.auditBuffer) {
      result.auditLogs = [];
      metadata.set(section, []);
      continue;
    }
    const core = Object.hasOwn(CORE_TABLES, section);
    const tableName = core ? CORE_TABLES[section] : `raw_${table}`;
    const position = core ? 'source_position' : 'position';
    const key = kind === 'object' ? 'record_key' : 'NULL AS record_key';
    const selection = options.sections?.[section];
    const readOnly = options.trackChanges === false;
    const sql = `SELECT ${position} AS position, ${key}, CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload_json FROM \`${tableName}\`${selection?.where ? ` WHERE ${selection.where}` : ''}`;
    const [rows] = !options.sections ? await connection.query(sql)
      : selection ? await connection.execute(sql, selection.params || []) : [[]];
    // Sorting row references avoids MySQL filesorts over large JSON payloads.
    rows.sort((a, b) => Number(a.position) - Number(b.position));
    const value = kind === 'array' ? [] : Object.create(null);
    const originalRows = [];
    let previous = -1;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.position === null || !Number.isSafeInteger(Number(row.position)) || Number(row.position) <= previous) {
        throw new Error(`Invalid source order in ${section}`);
      }
      previous = Number(row.position);
      if (typeof row.payload_json !== 'string') throw new Error(`Invalid payload in ${section}`);
      const item = JSON.parse(row.payload_json);
      if (options.trackChanges !== false) originalRows.push({ position: Number(row.position), key: row.record_key, payload: JSON.stringify(item) });
      if (kind === 'array') value.push(item);
      else {
        if (typeof row.record_key !== 'string' || Object.hasOwn(value, row.record_key)) throw new Error(`Invalid object key in ${section}`);
        Object.defineProperty(value, row.record_key, { value: item, enumerable: true, writable: true, configurable: true });
      }
    }
    Object.defineProperty(result, section, { value, enumerable: true, writable: true, configurable: true });
    metadata.set(section, originalRows);
  }
  if (options.trackChanges !== false) Object.defineProperty(result, ROW_METADATA, { value: metadata, enumerable: false });
  return result;
}

async function withConsistentRowRead(pool, read) {
  const connection = await pool.getConnection();
  let started = false;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    started = true;
    const state = await read(connection);
    await connection.commit();
    started = false;
    return state;
  } catch (error) {
    if (started) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function readConsistentRowState(pool) {
  return withConsistentRowRead(pool, readRowState);
}

module.exports = { readRowState, readConsistentRowState, withConsistentRowRead, ROW_METADATA };
