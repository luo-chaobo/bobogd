'use strict';

const TASK_SECTIONS = [
  ['users', 'raw_users', 'position'],
  ['orders', 'bobo_orders_v2', 'source_position'],
  ['workOrders', 'bobo_work_orders_v2', 'source_position'],
  ['routes', 'bobo_routes_v2', 'source_position'],
  ['reports', 'bobo_reports_v2', 'source_position'],
  ['drawings', 'raw_drawings', 'position']
];

// The caller supplies a connection within a consistent read transaction.
async function readTaskSnapshot(connection) {
  const result = {};
  for (const [section] of TASK_SECTIONS) {
    result[section] = await readTaskRows(connection, section, '', []);
  }
  return result;
}

async function readTaskRows(connection, section, where, params) {
  const [, table, position] = TASK_SECTIONS.find(([name]) => name === section);
  const [rows] = await connection.query(
    `SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload_json FROM \`${table}\`${where ? ' ' + where : ''} ORDER BY ${position}`,
    params
  );
  return rows.map((row) => {
    if (typeof row.payload_json !== 'string') throw new TypeError(`Invalid ${section} payload`);
    return JSON.parse(row.payload_json);
  });
}

async function readEmployeeTaskSnapshot(connection, userId, canOperate) {
  if (typeof userId !== 'string' || !userId) return null;
  const users = await readTaskRows(connection, 'users', 'WHERE record_id = ?', [userId]);
  const user = users.find((item) => item.id === userId && item.active);
  if (!user) return null;

  const candidates = await readTaskRows(
    connection, 'routes', "WHERE task_completed = 0 AND task_assignee IN ('', LEFT(?, 191))", [userId]
  );
  const tasks = candidates.filter((route) => route.status !== '已完成' && canOperate(user, route).ok);
  const workIds = [...new Set(tasks.map((route) => route.workOrderId).filter(Boolean))];
  const qualityTasks = tasks.filter((route) => route.processName === '质检');
  const qualityWorkIds = [...new Set(qualityTasks.map((route) => route.workOrderId))];
  const routes = qualityWorkIds.length
    ? await readTaskRows(connection, 'routes', 'WHERE work_order_id IN (?)', [qualityWorkIds])
    : [];
  const workOrders = workIds.length ? await readTaskRows(connection, 'workOrders', 'WHERE id IN (?)', [workIds]) : [];
  const orderIds = [...new Set(workOrders.map((item) => item.orderId).filter(Boolean))];
  const orders = orderIds.length ? await readTaskRows(connection, 'orders', 'WHERE id IN (?)', [orderIds]) : [];
  const reports = qualityTasks.length
    ? await readTaskRows(connection, 'reports', 'WHERE route_id IN (?)', [qualityTasks.map((route) => route.id)])
    : [];
  const drawingFilters = [];
  const drawingParams = [];
  if (workIds.length) {
    drawingFilters.push("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.workOrderId')) IN (?)");
    drawingParams.push(workIds);
  }
  if (orderIds.length) {
    drawingFilters.push("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.orderId')) IN (?)");
    drawingParams.push(orderIds);
  }
  const drawings = drawingFilters.length
    ? await readTaskRows(connection, 'drawings', `WHERE ${drawingFilters.join(' OR ')}`, drawingParams)
    : [];
  return { user, orders, workOrders, routes, taskRoutes: tasks, reports, drawings };
}

module.exports = { readTaskSnapshot, readEmployeeTaskSnapshot };
