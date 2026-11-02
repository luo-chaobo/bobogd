function routeQuantityComplete(route) {
  const planQty = Number(route?.planQty || 0);
  return planQty > 0 && Number(route?.completedQty || 0) >= planQty;
}

function exceptionTouchesRoute(item, route) {
  return [item.routeId, item.issueRouteId, item.qualityRouteId, item.reworkRouteId].includes(route.id);
}

function isExceptionOpen(item) {
  return item && item.status !== "已解决";
}

function routeHasOpenIssue(db, route) {
  if (route.routeType === "rework") return false;
  return (db.exceptions || []).some((item) => isExceptionOpen(item) && item.source !== "exception-only" && exceptionTouchesRoute(item, route));
}

function workOrderHasOpenIssue(db, workOrderId) {
  return (db.exceptions || []).some((item) => item.workOrderId === workOrderId && isExceptionOpen(item));
}

function canonicalRouteStatus(db, route, preferredStatus = route.status) {
  if (routeHasOpenIssue(db, route)) {
    return preferredStatus === "返工" || route.status === "返工" ? "返工" : "异常";
  }
  if (routeQuantityComplete(route)) return "已完成";
  if (preferredStatus === "已完成" || preferredStatus === "异常" || preferredStatus === "返工") {
    return Number(route.completedQty || 0) > 0 ? "进行中" : "待开始";
  }
  return preferredStatus;
}

function validateRouteStatusChange(db, route, nextStatus) {
  const openIssue = routeHasOpenIssue(db, route);
  if (openIssue && !["异常", "返工"].includes(nextStatus)) {
    return { ok: false, error: "工序存在未解决异常或返工，不能修改为普通状态" };
  }
  if (!openIssue && routeQuantityComplete(route) && !["已完成", "异常", "返工"].includes(nextStatus)) {
    return { ok: false, error: "工序完成数量已达到计划数量，状态必须为已完成" };
  }
  if (!routeQuantityComplete(route) && nextStatus === "已完成") {
    return { ok: false, error: "工序完成数量未达到计划数量，不能设置为已完成" };
  }
  if (route.status === "已完成" && ["进行中", "暂停", "待开始"].includes(nextStatus)) {
    return { ok: false, error: "已完成工序不能恢复为进行中、暂停或待开始" };
  }
  return { ok: true };
}

function syncWorkOrderState(db, workOrderId, now = new Date().toISOString()) {
  const routes = (db.routes || []).filter((route) => route.workOrderId === workOrderId).sort((a, b) => a.sequence - b.sequence);
  const workOrder = (db.workOrders || []).find((item) => item.id === workOrderId);
  if (!workOrder) return null;
  const active = routes.find((route) => route.status !== "已完成") || routes[routes.length - 1];
  workOrder.currentProcess = active ? active.processName : "";
  if (workOrderHasOpenIssue(db, workOrderId) || routes.some((route) => route.status === "异常")) {
    workOrder.status = "异常";
  } else if (routes.length && routes.every((route) => route.status === "已完成" && routeQuantityComplete(route))) {
    workOrder.status = "已完成";
  } else {
    workOrder.status = "生产中";
  }
  if (workOrder.status === "已完成" && !workOrder.completedAt) workOrder.completedAt = now;
  if (workOrder.status !== "已完成") workOrder.completedAt = "";
  const order = (db.orders || []).find((item) => item.id === workOrder.orderId);
  if (order) order.status = workOrder.status;
  return workOrder;
}

module.exports = {
  canonicalRouteStatus,
  routeHasOpenIssue,
  routeQuantityComplete,
  syncWorkOrderState,
  validateRouteStatusChange,
  workOrderHasOpenIssue,
};
