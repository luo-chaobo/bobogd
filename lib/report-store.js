'use strict';
const { allocatePosition } = require('./row-sequence');

const CREATE_REPORTS_TABLE = `CREATE TABLE IF NOT EXISTS bobo_reports_v2 (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  work_order_id VARCHAR(80) NOT NULL,
  route_id VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  source_position BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY idx_report_source_position (source_position),
  KEY idx_report_work_order_time (work_order_id, created_at, id),
  KEY idx_report_route_time (route_id, created_at, id),
  KEY idx_report_created_at (created_at),
  KEY idx_report_work_order_position (work_order_id, source_position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

function requiredString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`Invalid report ${name}`);
  }
  return value;
}

function reportValues(report) {
  if (!report || Array.isArray(report) || typeof report !== 'object') throw new TypeError('Invalid report');
  const id = requiredString(report.id, 'id', 80);
  const workOrderId = requiredString(report.workOrderId, 'workOrderId', 80);
  const routeId = requiredString(report.routeId, 'routeId', 80);
  const createdAt = requiredString(report.createdAt, 'createdAt', 40);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError('Invalid report createdAt');
  }
  const createdAtUtc = new Date(createdAt).toISOString().slice(0, 23).replace('T', ' ');
  const payload = JSON.stringify(report);
  if (payload === undefined) throw new TypeError('Invalid report payload');
  return [id, workOrderId, routeId, createdAtUtc, payload];
}

async function insertReport(connection, report) {
  const values = reportValues(report);
  const position = await allocatePosition(connection, 'reports');
  await connection.execute(
    'INSERT INTO bobo_reports_v2 (id, work_order_id, route_id, created_at, source_position, payload) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))',
    [...values.slice(0, 4), position, values[4]]
  );
}

async function listReports(connection, filter) {
  if (!filter || typeof filter !== 'object') throw new TypeError('Report filter required');
  const hasWorkOrder = typeof filter.workOrderId === 'string' && filter.workOrderId.trim();
  const hasRoute = typeof filter.routeId === 'string' && filter.routeId.trim();
  if (Boolean(hasWorkOrder) === Boolean(hasRoute)) throw new TypeError('Specify one report filter');
  const limit = filter.limit;
  const offset = filter.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
    throw new TypeError('Invalid report pagination');
  }
  const column = hasWorkOrder ? 'work_order_id' : 'route_id';
  const value = requiredString(hasWorkOrder ? filter.workOrderId : filter.routeId, column, 80);
  const [rows] = await connection.execute(
    `SELECT payload FROM bobo_reports_v2 WHERE ${column} = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [value, String(limit), String(offset)]
  );
  return rows.map((row) => typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
}

module.exports = { CREATE_REPORTS_TABLE, reportValues, insertReport, listReports };
