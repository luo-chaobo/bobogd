const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-order-upgrade-"));
const port = 32147;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  const oldLogDate = new Date();
  oldLogDate.setUTCFullYear(oldLogDate.getUTCFullYear() - 3);
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "ultimate", name: "罗朝波", phone: "15257457485", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "manager", name: "主管", phone: "2", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "admin", name: "管理员", phone: "3", role: "admin", roles: ["admin"], password: "1", active: true },
      { id: "office", name: "跟单", phone: "4", role: "office", roles: ["office"], password: "1", active: true },
      { id: "worker", name: "折弯", phone: "5", role: "bend_worker", roles: ["bend_worker"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [{ id: "p1", name: "折弯", sort: 1, active: true }],
    customers: [{ id: "c1", name: "客户一", active: true }],
    orders: [{ id: "o1", orderNo: "SO-1", customerId: "c1", productName: "旧产品", drawingNo: "A", quantity: 10, dueDate: "2099-01-01", priority: "普通", status: "生产中", note: "旧备注", createdAt: "2026-01-01T00:00:00.000Z" }],
    workOrders: [{ id: "w1", workNo: "SO-1", orderId: "o1", productName: "旧产品", planQty: 10, status: "生产中", currentProcess: "折弯", createdAt: "2026-01-01T00:00:00.000Z" }],
    routes: [{ id: "r1", workOrderId: "w1", processId: "p1", processName: "折弯", sequence: 1, status: "进行中", planQty: 10, completedQty: 2 }],
    reports: [{ id: "rep1", routeId: "r1", workOrderId: "w1", completedQty: 2, createdAt: "2026-01-02T00:00:00.000Z" }],
    exceptions: [],
    attachments: [],
    drawings: [
      { id: "d1", name: "旧图.png", fileType: "png", url: "/uploads/drawings/d1.png", orderId: "o1", workOrderId: "w1", customerId: "c1" },
      { id: "d2", name: "新图.png", fileType: "png", url: "/uploads/drawings/d2.png" }
    ],
    auditLogs: [{ id: "old", actorId: "manager", action: "old-action", targetType: "order", targetId: "o1", detail: {}, createdAt: oldLogDate.toISOString() }],
    settings: {}
  }, null, 2), "utf8");
}

async function request(urlPath, userId = "", options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  const workerBootstrap = await request("/api/bootstrap", "worker");
  assert.strictEqual(workerBootstrap.status, 200);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(workerBootstrap.data, "auditLogs"), false);
  assert.strictEqual(workerBootstrap.data.permissions.viewTv, true);
  assert.strictEqual(workerBootstrap.data.permissions.editOrders, false);

  const managerEdit = await request("/api/orders/update", "manager", {
    method: "POST",
    body: {
      quantity: 10,
      orderId: "o1", orderNo: "SO-2", customerId: "c1", productName: "新产品", drawingNo: "B", weightKg: "12",
      dueDate: "2099/02/03", priority: "急单", note: "新备注", addDrawingIds: ["d2"], removeDrawingIds: ["d1"]
    }
  });
  assert.strictEqual(managerEdit.status, 200);
  assert.strictEqual(managerEdit.data.order.dueDate, "2099-02-03");
  assert.strictEqual(managerEdit.data.order.weightKg, 12);

  const officeEdit = await request("/api/orders/update", "office", { method: "POST", body: { orderId: "o1" } });
  assert.strictEqual(officeEdit.status, 403);

  const regularManagerDelete = await request("/api/customers/delete", "manager", { method: "POST", body: { customerId: "c1" } });
  assert.strictEqual(regularManagerDelete.status, 403);
  const adminDelete = await request("/api/customers/delete", "admin", { method: "POST", body: { customerId: "c1" } });
  assert.strictEqual(adminDelete.status, 403);
  const ultimateDelete = await request("/api/customers/delete", "ultimate", { method: "POST", body: { customerId: "c1" } });
  assert.strictEqual(ultimateDelete.status, 200);

  const workerLogs = await request("/api/audit-logs", "worker");
  assert.strictEqual(workerLogs.status, 403);
  const managerLogs = await request("/api/audit-logs?page=1&pageSize=20&action=order-update", "manager");
  assert.strictEqual(managerLogs.status, 200);
  assert.strictEqual(managerLogs.data.items.some((item) => item.action === "order-update"), true);

  const finalDb = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(finalDb.customers.find((item) => item.id === "c1").active, false);
  assert.strictEqual(finalDb.orders[0].quantity, 10);
  assert.strictEqual(finalDb.orders[0].weightKg, 12);
  assert.strictEqual(finalDb.workOrders[0].planQty, 10);
  assert.strictEqual(finalDb.routes[0].completedQty, 2);
  assert.strictEqual(finalDb.reports.length, 1);
  assert.strictEqual(finalDb.workOrders[0].workNo, "SO-2");
  assert.strictEqual(finalDb.workOrders[0].productName, "新产品");
  assert.ok(finalDb.drawings.find((item) => item.id === "d1").removedAt);
  assert.strictEqual(finalDb.drawings.find((item) => item.id === "d2").orderId, "o1");
  assert.strictEqual(finalDb.auditLogs.some((item) => item.id === "old"), false);
  console.log("order-admin-upgrade: ok");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
