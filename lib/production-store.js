'use strict';
const { allocatePosition } = require('./row-sequence');

const CREATE_WORK_ORDERS_TABLE = `CREATE TABLE IF NOT EXISTS bobo_work_orders_v2 (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  order_id VARCHAR(80) NOT NULL,
  source_position BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY idx_work_order_source_position (source_position),
  KEY idx_work_order_order (order_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

const TASK_ASSIGNEE_EXPRESSION = `CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$.assignedTo')) = 'STRING'
      THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.assignedTo')), 191) ELSE '' END`;
const TASK_COMPLETED_EXPRESSION = `IF(BINARY JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) = BINARY '已完成', 1, 0)`;
const TASK_ASSIGNEE_COLUMN = `task_assignee VARCHAR(191) GENERATED ALWAYS AS (${TASK_ASSIGNEE_EXPRESSION}) STORED`;
const TASK_COMPLETED_COLUMN = `task_completed TINYINT GENERATED ALWAYS AS (${TASK_COMPLETED_EXPRESSION}) STORED`;
const TASK_CANDIDATE_INDEX = 'KEY idx_route_task_candidate (task_completed, task_assignee, source_position)';

const CREATE_ROUTES_TABLE = `CREATE TABLE IF NOT EXISTS bobo_routes_v2 (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  work_order_id VARCHAR(80) NOT NULL,
  source_position BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  ${TASK_ASSIGNEE_COLUMN},
  ${TASK_COMPLETED_COLUMN},
  UNIQUE KEY idx_route_source_position (source_position),
  KEY idx_route_work_order (work_order_id, id),
  KEY idx_route_work_order_position (work_order_id, source_position),
  ${TASK_CANDIDATE_INDEX}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

// Run with application writers stopped. MySQL commits schema changes separately.
async function ensureRouteTaskIndex(connection) {
  const [columns] = await connection.query("SHOW FULL COLUMNS FROM bobo_routes_v2 WHERE Field IN ('task_assignee', 'task_completed')");
  const [index] = await connection.query("SHOW INDEX FROM bobo_routes_v2 WHERE Key_name = 'idx_route_task_candidate'");
  if (!columns.length && !index.length) {
    await connection.query(`ALTER TABLE bobo_routes_v2 ADD COLUMN ${TASK_ASSIGNEE_COLUMN}, ADD COLUMN ${TASK_COMPLETED_COLUMN}, ADD ${TASK_CANDIDATE_INDEX}`);
    return { created: true };
  }
  const expectedColumns = { task_assignee: 'varchar(191)', task_completed: 'tinyint' };
  const expectedIndex = ['task_completed', 'task_assignee', 'source_position'];
  if (columns.length !== 2 || columns.some((column) => column.Type !== expectedColumns[column.Field] || column.Extra !== 'STORED GENERATED') ||
      index.length !== 3 || index.some((entry) => expectedIndex[entry.Seq_in_index - 1] !== entry.Column_name || Number(entry.Non_unique) !== 1 || entry.Sub_part !== null)) {
    throw new Error('Unexpected route task index schema');
  }
  const [[{ mismatches }]] = await connection.query(
    `SELECT COUNT(*) AS mismatches FROM bobo_routes_v2
     WHERE NOT (BINARY task_assignee <=> BINARY (${TASK_ASSIGNEE_EXPRESSION}))
        OR NOT (task_completed <=> ${TASK_COMPLETED_EXPRESSION})`
  );
  if (Number(mismatches) !== 0) throw new Error('Route task index values differ from source');
  return { created: false };
}

function values(item, parentField) {
  if (!item || Array.isArray(item) || typeof item !== 'object') throw new TypeError('Invalid production record');
  for (const field of ['id', parentField]) {
    if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > 80) {
      throw new TypeError(`Invalid production ${field}`);
    }
  }
  return [item.id, item[parentField], JSON.stringify(item)];
}

async function insertWorkOrder(connection, item) {
  const [id, orderId, payload] = values(item, 'orderId');
  const position = await allocatePosition(connection, 'workOrders');
  await connection.execute('INSERT INTO bobo_work_orders_v2 (id, order_id, source_position, payload) VALUES (?, ?, ?, CAST(? AS JSON))', [id, orderId, position, payload]);
}

async function insertRoute(connection, item) {
  const [id, workOrderId, payload] = values(item, 'workOrderId');
  const position = await allocatePosition(connection, 'routes');
  await connection.execute('INSERT INTO bobo_routes_v2 (id, work_order_id, source_position, payload) VALUES (?, ?, ?, CAST(? AS JSON))', [id, workOrderId, position, payload]);
}

async function updateWorkOrder(connection, item) {
  const [id, orderId, payload] = values(item, 'orderId');
  const [result] = await connection.execute(
    'UPDATE bobo_work_orders_v2 SET payload = CAST(? AS JSON) WHERE id = ? AND order_id = ?',
    [payload, id, orderId]
  );
  if (result.affectedRows !== 1) throw new Error('Work order missing or parent changed');
}

async function updateRoute(connection, item) {
  const [id, workOrderId, payload] = values(item, 'workOrderId');
  const [result] = await connection.execute(
    'UPDATE bobo_routes_v2 SET payload = CAST(? AS JSON) WHERE id = ? AND work_order_id = ?',
    [payload, id, workOrderId]
  );
  if (result.affectedRows !== 1) throw new Error('Route missing or parent changed');
}

function decode(row) {
  return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
}

async function lockWorkOrderGraph(connection, workOrderId) {
  if (typeof workOrderId !== 'string' || !workOrderId.trim() || workOrderId.length > 80) throw new TypeError('Invalid work order ID');
  const [workOrders] = await connection.execute('SELECT payload FROM bobo_work_orders_v2 WHERE id = ? FOR UPDATE', [workOrderId]);
  if (workOrders.length !== 1) throw new Error('Work order not found');
  const [routes] = await connection.execute('SELECT payload FROM bobo_routes_v2 WHERE work_order_id = ? ORDER BY id FOR UPDATE', [workOrderId]);
  return { workOrder: decode(workOrders[0]), routes: routes.map(decode) };
}

async function withTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { CREATE_WORK_ORDERS_TABLE, CREATE_ROUTES_TABLE, ensureRouteTaskIndex, productionValues: values, insertWorkOrder, insertRoute, updateWorkOrder, updateRoute, lockWorkOrderGraph, withTransaction };
