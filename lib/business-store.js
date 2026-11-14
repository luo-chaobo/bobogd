'use strict';
const { allocatePosition } = require('./row-sequence');

const CREATE_ORDERS_TABLE = `CREATE TABLE IF NOT EXISTS bobo_orders_v2 (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  source_position BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY idx_order_source_position (source_position),
  payload JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

const CREATE_EXCEPTIONS_TABLE = `CREATE TABLE IF NOT EXISTS bobo_exceptions_v2 (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  work_order_id VARCHAR(80) NOT NULL,
  route_id VARCHAR(80) NOT NULL,
  source_position BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY idx_exception_source_position (source_position),
  KEY idx_exception_work_order (work_order_id, id),
  KEY idx_exception_route (route_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

function required(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new TypeError(`Invalid ${name}`);
  return value;
}

function orderValues(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid order');
  return [required(item.id, 'order id'), JSON.stringify(item)];
}

function exceptionValues(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid exception');
  return [required(item.id, 'exception id'), required(item.workOrderId, 'work order id'), required(item.routeId, 'route id'), JSON.stringify(item)];
}

async function insertOrder(connection, item) {
  const [id, payload] = orderValues(item);
  const position = await allocatePosition(connection, 'orders');
  await connection.execute('INSERT INTO bobo_orders_v2 (id, source_position, payload) VALUES (?, ?, CAST(? AS JSON))', [id, position, payload]);
}

async function lockOrder(connection, orderId) {
  required(orderId, 'order id');
  const [rows] = await connection.execute('SELECT payload FROM bobo_orders_v2 WHERE id = ? FOR UPDATE', [orderId]);
  if (rows.length !== 1) throw new Error('Order not found');
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
}

async function updateOrder(connection, item) {
  const [id, payload] = orderValues(item);
  const [result] = await connection.execute('UPDATE bobo_orders_v2 SET payload = CAST(? AS JSON) WHERE id = ?', [payload, id]);
  if (result.affectedRows !== 1) throw new Error('Order not found');
}

async function insertException(connection, item) {
  const [id, workOrderId, routeId, payload] = exceptionValues(item);
  const position = await allocatePosition(connection, 'exceptions');
  await connection.execute('INSERT INTO bobo_exceptions_v2 (id, work_order_id, route_id, source_position, payload) VALUES (?, ?, ?, ?, CAST(? AS JSON))', [id, workOrderId, routeId, position, payload]);
}

async function updateException(connection, item) {
  const [id, workOrderId, routeId, payload] = exceptionValues(item);
  const [result] = await connection.execute(
    'UPDATE bobo_exceptions_v2 SET payload = CAST(? AS JSON) WHERE id = ? AND work_order_id = ? AND route_id = ?',
    [payload, id, workOrderId, routeId]
  );
  if (result.affectedRows !== 1) throw new Error('Exception missing or parent changed');
}

async function lockExceptions(connection, workOrderId) {
  required(workOrderId, 'work order id');
  const [rows] = await connection.execute('SELECT payload FROM bobo_exceptions_v2 WHERE work_order_id = ? ORDER BY id FOR UPDATE', [workOrderId]);
  return rows.map((row) => typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
}

module.exports = { CREATE_ORDERS_TABLE, CREATE_EXCEPTIONS_TABLE, orderValues, exceptionValues, insertOrder, lockOrder, updateOrder, insertException, updateException, lockExceptions };
