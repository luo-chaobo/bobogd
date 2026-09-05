const fs = require("fs");
const path = require("path");

async function main() {
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    throw new Error("请先安装 mysql2：npm install mysql2");
  }

  const dbFile = process.argv[2] || path.join(__dirname, "..", "data", "db.json");
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: false,
  });

  await connection.beginTransaction();
  try {
    await insertRows(connection, "users", db.users || [], userRow);
    await insertRows(connection, "customers", db.customers || [], customerRow);
    await insertRows(connection, "processes", db.processes || [], processRow);
    await insertRows(connection, "orders", db.orders || [], orderRow);
    await insertRows(connection, "work_orders", db.workOrders || [], workOrderRow);
    await insertRows(connection, "routes", db.routes || [], routeRow);
    await insertRows(connection, "reports", db.reports || [], reportRow);
    await insertRows(connection, "exceptions", db.exceptions || [], exceptionRow);
    await insertRows(connection, "attachments", db.attachments || [], attachmentRow);
    await insertRows(connection, "attachments", db.drawings || [], drawingRow);
    await insertRows(connection, "audit_logs", db.auditLogs || [], auditLogRow);
    await connection.execute(
      "REPLACE INTO settings (name, value_json) VALUES (?, CAST(? AS JSON))",
      ["app", JSON.stringify(db.settings || {})]
    );
    await connection.execute(
      "REPLACE INTO app_state (name, value_json, updated_at) VALUES (?, CAST(? AS JSON), NOW())",
      ["main", JSON.stringify(db)]
    );
    await connection.commit();
    console.log("migrate-json-to-mysql: ok");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

async function insertRows(connection, table, rows, mapRow) {
  for (const source of rows) {
    const row = mapRow(source);
    const columns = Object.keys(row);
    const placeholders = columns.map(() => "?").join(", ");
    const updates = columns.map((column) => `${column}=VALUES(${column})`).join(", ");
    await connection.execute(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
      columns.map((column) => row[column])
    );
  }
}

function json(value) {
  return JSON.stringify(value || null);
}

function dt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(":");
}

function userRow(item) {
  return { id: item.id, name: item.name || "", phone: item.phone || "", role: item.role || "worker", roles: json(item.roles || []), password: item.password || "", active: item.active !== false, created_at: dt(item.createdAt), updated_at: dt(item.updatedAt) };
}

function customerRow(item) {
  return { id: item.id, name: item.name || "", contact: item.contact || "", phone: item.phone || "", address: item.address || "", note: item.note || "" };
}

function processRow(item) {
  return { id: item.id, name: item.name || "", sort: Number(item.sort || 0), active: item.active !== false };
}

function orderRow(item) {
  return { id: item.id, order_no: item.orderNo || "", customer_id: item.customerId || "", product_name: item.productName || "", drawing_no: item.drawingNo || "", quantity: Number(item.quantity || 0), due_date: item.dueDate || null, priority: item.priority || "普通", status: item.status || "未开始", note: item.note || "", created_at: dt(item.createdAt) };
}

function workOrderRow(item) {
  return { id: item.id, work_no: item.workNo || "", order_id: item.orderId || "", product_name: item.productName || "", plan_qty: Number(item.planQty || 0), status: item.status || "未开始", current_process: item.currentProcess || "", assignee_id: item.assigneeId || "", qr_token: item.qrToken || "", created_at: dt(item.createdAt), completed_at: dt(item.completedAt) };
}

function routeRow(item) {
  return { id: item.id, work_order_id: item.workOrderId || "", process_id: item.processId || "", process_name: item.processName || "", assigned_role: item.assignedRole || "", assigned_to: item.assignedTo || "", sequence: Number(item.sequence || 0), qr_token: item.qrToken || "", target_finish_time: item.targetFinishTime || "", status: item.status || "待开始", plan_qty: Number(item.planQty || 0), completed_qty: Number(item.completedQty || 0), good_qty: Number(item.goodQty || 0), bad_qty: Number(item.badQty || 0), rework_qty: Number(item.reworkQty || 0), route_type: item.routeType || "", source_quality_route_id: item.sourceQualityRouteId || "", source_quality_report_id: item.sourceQualityReportId || "", rework_of_route_id: item.reworkOfRouteId || "", started_at: dt(item.startedAt), paused_at: dt(item.pausedAt), completed_at: dt(item.completedAt), last_reported_at: dt(item.lastReportedAt), last_reporter_id: item.lastReporterId || "" };
}

function reportRow(item) {
  return { id: item.id, route_id: item.routeId || "", work_order_id: item.workOrderId || "", reporter_id: item.reporterId || "", report_type: item.reportType || "production", completed_qty: Number(item.completedQty || 0), submitted_qty: Number(item.submittedQty || 0), inspected_qty: Number(item.inspectedQty || 0), good_qty: Number(item.goodQty || 0), bad_qty: Number(item.badQty || 0), rework_qty: Number(item.reworkQty || 0), disposition: item.disposition || "", rework_target_route_id: item.reworkTargetRouteId || "", note: item.note || "", images: json(item.images || []), created_at: dt(item.createdAt) };
}

function exceptionRow(item) {
  return { id: item.id, work_order_id: item.workOrderId || "", route_id: item.routeId || "", quality_route_id: item.qualityRouteId || "", quality_report_id: item.qualityReportId || "", rework_route_id: item.reworkRouteId || "", type: item.type || "现场异常", description: item.description || "", status: item.status || "待处理", reporter_id: item.reporterId || "", images: json(item.images || []), solution: item.solution || "", resolved_by: item.resolvedBy || "", rework_qty: Number(item.reworkQty || 0), rework_target_route_id: item.reworkTargetRouteId || "", created_at: dt(item.createdAt), resolved_at: dt(item.resolvedAt) };
}

function attachmentRow(item) {
  return { id: item.id, url: item.url || "", thumbnail_url: item.thumbnailUrl || "", name: item.name || "", file_type: item.fileType || "", content_type: item.contentType || "", attachment_type: item.attachmentType || "", order_id: item.orderId || "", work_order_id: item.workOrderId || "", customer_id: item.customerId || "", uploader_id: item.uploaderId || "", created_at: dt(item.createdAt) };
}

function drawingRow(item) {
  return attachmentRow({ ...item, attachmentType: "drawing" });
}

function auditLogRow(item) {
  return { id: item.id, actor_id: item.actorId || "", action: item.action || "", target_type: item.targetType || "", target_id: item.targetId || "", detail: json(item.detail || {}), created_at: dt(item.createdAt) };
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
