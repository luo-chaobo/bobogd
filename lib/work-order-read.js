'use strict';

function decode(rows) {
  return rows.map((row) => typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
}

// The caller supplies a connection in a consistent read transaction.
async function readWorkOrderDetails(connection, workOrderId) {
  if (typeof workOrderId !== 'string' || !workOrderId.trim() || workOrderId.length > 80) {
    throw new TypeError('Invalid work order ID');
  }
  const [orders] = await connection.execute('SELECT payload FROM bobo_work_orders_v2 WHERE id = ?', [workOrderId]);
  if (!orders.length) return null;
  const [routes] = await connection.execute('SELECT payload FROM bobo_routes_v2 WHERE work_order_id = ? ORDER BY source_position', [workOrderId]);
  const [reports] = await connection.execute('SELECT payload FROM bobo_reports_v2 WHERE work_order_id = ? ORDER BY source_position', [workOrderId]);
  return { workOrder: decode(orders)[0], routes: decode(routes), reports: decode(reports) };
}

module.exports = { readWorkOrderDetails };
