const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-order-quantity-"));
const port = 32149;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "manager", name: "主管", phone: "1", role: "manager", roles: ["manager"], password: "1", active: true }],
    deletedUsers: [], processes: [{ id: "p1", name: "折弯", sort: 1, active: true }],
    customers: [{ id: "c1", name: "客户", active: true }],
    orders: [{ id: "o1", orderNo: "SO-1", customerId: "c1", productName: "产品", quantity: 10, dueDate: "2099-01-01", priority: "普通", status: "生产中", createdAt: "2026-01-01T00:00:00.000Z" }],
    workOrders: [{ id: "w1", workNo: "SO-1", orderId: "o1", productName: "产品", planQty: 10, status: "生产中", currentProcess: "折弯", completedAt: "", createdAt: "2026-01-01T00:00:00.000Z" }],
    routes: [
      { id: "r1", workOrderId: "w1", processId: "p1", processName: "折弯", sequence: 1, status: "进行中", planQty: 10, completedQty: 2, startedAt: "2026-01-02T00:00:00.000Z" },
      { id: "r2", workOrderId: "w1", processId: "p1", processName: "折弯", sequence: 2, status: "待开始", routeType: "rework", planQty: 3, completedQty: 0 }
    ],
    reports: [{ id: "rep1", routeId: "r1", workOrderId: "w1", completedQty: 2, createdAt: "2026-01-02T00:00:00.000Z" }],
    exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function request(body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/orders/update`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "manager" },
    body: JSON.stringify(body)
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

function editBody(quantity) {
  return { orderId: "o1", orderNo: "SO-1", customerId: "c1", productName: "产品", quantity, dueDate: "2099-01-01", priority: "普通" };
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  for (const quantity of ["", 0, -1, 1.5, "abc"]) {
    const result = await request(editBody(quantity));
    assert.strictEqual(result.status, 400);
  }

  const result = await request(editBody(14));
  assert.strictEqual(result.status, 200);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(db.orders[0].quantity, 14);
  assert.strictEqual(db.workOrders[0].planQty, 14);
  assert.strictEqual(db.routes.find((item) => item.id === "r1").planQty, 14);
  assert.strictEqual(db.routes.find((item) => item.id === "r2").planQty, 3);
  assert.strictEqual(db.routes.find((item) => item.id === "r1").status, "进行中");
  assert.strictEqual(db.routes.find((item) => item.id === "r1").startedAt, "2026-01-02T00:00:00.000Z");
  assert.strictEqual(db.workOrders[0].status, "生产中");
  assert.strictEqual(db.reports.length, 1);
  const audit = db.auditLogs.find((item) => item.action === "order-update");
  assert.strictEqual(audit.detail.before.quantity, 10);
  assert.strictEqual(audit.detail.after.quantity, 14);
  console.log("order-edit-quantity: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
