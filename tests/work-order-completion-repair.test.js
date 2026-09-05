const assert = require("assert");
const { repairWorkOrderCompletion } = require("../lib/work-order-completion-repair");

function seedDatabase() {
  return {
    users: [{ id: "manager", name: "主管", role: "manager", roles: ["manager"], active: true }],
    orders: [{ id: "order", orderNo: "20261002/1005", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "20261002/1005", orderId: "order", status: "生产中", currentProcess: "设计", completedAt: "" }],
    routes: [
      { id: "design", workOrderId: "work", processName: "设计", sequence: 1, status: "已完成", planQty: 26, completedQty: 24 },
      { id: "weld", workOrderId: "work", processName: "焊接", sequence: 2, status: "进行中", planQty: 26, completedQty: 26 },
      { id: "quality", workOrderId: "work", processName: "质检", sequence: 3, status: "已完成", planQty: 26, completedQty: 26 }
    ],
    reports: [], exceptions: [], auditLogs: []
  };
}

function run() {
  const db = seedDatabase();
  let sequence = 0;
  const options = {
    workNo: "20261002/1005",
    operatorId: "manager",
    backupKey: "main_backup_completion_20260829160000",
    now: "2026-08-29T08:00:00.000Z",
    makeId: (prefix) => `${prefix}_${++sequence}`
  };

  const result = repairWorkOrderCompletion(db, options);
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.workOrderId, "work");
  assert.strictEqual(db.routes.find((item) => item.id === "design").completedQty, 26);
  assert.strictEqual(db.routes.find((item) => item.id === "design").status, "已完成");
  assert.strictEqual(db.routes.find((item) => item.id === "weld").status, "已完成");
  assert.strictEqual(db.workOrders[0].status, "已完成");
  assert.strictEqual(db.orders[0].status, "已完成");
  assert.strictEqual(db.reports.length, 1);
  assert.strictEqual(db.reports[0].completedQty, 2);
  assert.strictEqual(db.reports[0].note, "管理员完工数据修复");
  assert.strictEqual(db.auditLogs.length, 1);
  assert.strictEqual(db.auditLogs[0].action, "work-order-completion-repair");
  assert.strictEqual(db.auditLogs[0].detail.backupKey, options.backupKey);

  const second = repairWorkOrderCompletion(db, options);
  assert.strictEqual(second.changed, false);
  assert.strictEqual(db.reports.length, 1);
  assert.strictEqual(db.auditLogs.length, 1);

  const blocked = seedDatabase();
  blocked.exceptions.push({ id: "open", workOrderId: "work", routeId: "weld", status: "待处理" });
  assert.throws(() => repairWorkOrderCompletion(blocked, options), /未解决异常/);

  console.log("work-order-completion-repair: ok");
}

run();
