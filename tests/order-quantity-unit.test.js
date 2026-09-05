const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-quantity-unit-"));
const port = 32161;
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
    deletedUsers: [],
    processes: [{ id: "p1", name: "折弯", sort: 1, active: true }],
    customers: [{ id: "c1", name: "客户", active: true }],
    orders: [{ id: "old", orderNo: "OLD", customerId: "c1", productName: "旧订单", quantity: 3, dueDate: "2099-01-01", status: "生产中" }],
    workOrders: [{ id: "w1", workNo: "OLD", orderId: "old", productName: "旧订单", planQty: 3, status: "生产中" }],
    routes: [{ id: "r1", workOrderId: "w1", processId: "p1", processName: "折弯", sequence: 1, status: "待开始", planQty: 3, completedQty: 0 }],
    reports: [], exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function request(urlPath, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-user-id": "manager" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

function orderBody(orderNo, quantityUnit) {
  return { orderNo, customerId: "c1", productName: orderNo, quantity: 2, quantityUnit, dueDate: "2099-02-01", processIds: ["p1"] };
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  const bootstrap = await request("/api/bootstrap");
  assert.strictEqual(bootstrap.data.orders.find((item) => item.id === "old").quantityUnit, "件");

  const defaultCreate = await request("/api/orders", { method: "POST", body: orderBody("DEFAULT", undefined) });
  assert.strictEqual(defaultCreate.status, 200);
  assert.strictEqual(defaultCreate.data.order.quantityUnit, "件");
  const setCreate = await request("/api/orders", { method: "POST", body: orderBody("SET", "套") });
  assert.strictEqual(setCreate.status, 200);
  assert.strictEqual(setCreate.data.order.quantityUnit, "套");
  assert.strictEqual((await request("/api/orders", { method: "POST", body: orderBody("BAD", "箱") })).status, 400);

  const update = await request("/api/orders/update", {
    method: "POST",
    body: { orderId: "old", orderNo: "OLD", customerId: "c1", productName: "旧订单", quantity: 3, quantityUnit: "套", dueDate: "2099-01-01", priority: "普通" }
  });
  assert.strictEqual(update.status, 200);
  assert.strictEqual(update.data.order.quantityUnit, "套");
  assert.strictEqual((await request("/api/orders/update", { method: "POST", body: { ...orderBody("OLD", "箱"), orderId: "old" } })).status, 400);

  const refreshedBootstrap = await request("/api/bootstrap");
  assert.strictEqual(refreshedBootstrap.data.orders.find((item) => item.orderNo === "SET").quantityUnit, "套");
  assert.strictEqual(refreshedBootstrap.data.orders.find((item) => item.id === "old").quantityUnit, "套");

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(db.orders.find((item) => item.orderNo === "DEFAULT").quantityUnit, "件");
  assert.strictEqual(db.orders.find((item) => item.orderNo === "SET").quantityUnit, "套");
  assert.strictEqual(db.orders.find((item) => item.id === "old").quantityUnit, "套");
  const audit = db.auditLogs.find((item) => item.action === "order-update");
  assert.strictEqual(audit.detail.before.quantityUnit, "件");
  assert.strictEqual(audit.detail.after.quantityUnit, "套");
  console.log("order-quantity-unit: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
