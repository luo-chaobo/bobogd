const { routeHasOpenIssue, routeQuantityComplete, syncWorkOrderState, workOrderHasOpenIssue } = require("./work-order-state");

const SUPERVISOR_ROLES = new Set(["owner", "manager", "admin"]);

function userRoles(user) {
  return [...new Set([...(Array.isArray(user.roles) ? user.roles : []), user.role].filter(Boolean))];
}

function snapshotRoute(route) {
  return {
    id: route.id,
    processName: route.processName,
    planQty: Number(route.planQty || 0),
    completedQty: Number(route.completedQty || 0),
    status: route.status,
  };
}

function repairWorkOrderCompletion(db, options) {
  const now = options.now || new Date().toISOString();
  const makeId = options.makeId;
  if (typeof makeId !== "function") throw new Error("缺少记录 ID 生成器");
  const operator = (db.users || []).find((item) => item.id === options.operatorId && item.active !== false);
  if (!operator || !userRoles(operator).some((role) => SUPERVISOR_ROLES.has(role))) {
    throw new Error("修复操作人必须是启用中的管理员、生产主管或老板");
  }
  const workOrder = (db.workOrders || []).find((item) => item.workNo === options.workNo);
  if (!workOrder) throw new Error(`工单不存在: ${options.workNo}`);
  const order = (db.orders || []).find((item) => item.id === workOrder.orderId);
  const routes = (db.routes || []).filter((item) => item.workOrderId === workOrder.id).sort((a, b) => a.sequence - b.sequence);
  if (!routes.length) throw new Error("工单没有工序，不能执行完工修复");
  if (workOrderHasOpenIssue(db, workOrder.id)) throw new Error("工单存在未解决异常或返工，拒绝执行完工修复");

  const completeAlready = routes.every((route) => routeQuantityComplete(route) && route.status === "已完成")
    && workOrder.status === "已完成" && (!order || order.status === "已完成");
  if (completeAlready) return { changed: false, workOrderId: workOrder.id, message: "无需修复" };

  const deficientRoutes = routes.filter((route) => !routeQuantityComplete(route));
  if (deficientRoutes.some((route) => route.processName !== "设计")) {
    throw new Error("存在非设计工序数量未满，拒绝自动补录");
  }

  const before = { workOrderStatus: workOrder.status, orderStatus: order?.status || "", routes: routes.map(snapshotRoute) };
  for (const route of deficientRoutes) {
    const adjustmentQty = Number(route.planQty || 0) - Number(route.completedQty || 0);
    db.reports.push({
      id: makeId("rep"), routeId: route.id, workOrderId: workOrder.id, reporterId: operator.id,
      reportType: "production", completedQty: adjustmentQty, submittedQty: 0, inspectedQty: 0,
      goodQty: 0, badQty: 0, reworkQty: 0, disposition: "", reworkTargetRouteId: "",
      note: "管理员完工数据修复", images: [], createdAt: now, reportDate: now.slice(0, 10),
      scheduleStatus: "未排期", scheduleVarianceDays: 0,
    });
    route.completedQty = Number(route.planQty || 0);
    route.lastReportedAt = now;
    route.lastReporterId = operator.id;
    route.completedAt = now;
  }
  for (const route of routes) {
    if (routeQuantityComplete(route) && !routeHasOpenIssue(db, route)) {
      route.status = "已完成";
      route.completedAt ||= route.lastReportedAt || now;
    }
  }
  syncWorkOrderState(db, workOrder.id, now);
  const after = { workOrderStatus: workOrder.status, orderStatus: order?.status || "", routes: routes.map(snapshotRoute) };
  db.auditLogs ||= [];
  db.auditLogs.push({
    id: makeId("log"), actorId: operator.id, action: "work-order-completion-repair",
    targetType: "workOrder", targetId: workOrder.id,
    detail: { workNo: workOrder.workNo, backupKey: options.backupKey || "", before, after }, createdAt: now,
  });
  return { changed: true, workOrderId: workOrder.id, before, after };
}

module.exports = { repairWorkOrderCompletion };
