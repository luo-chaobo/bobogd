const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-platform-order-source-"));
let child;
let port;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const value = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(value));
    });
  });
}

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
    processes: [{ id: "p1", name: "激光", sort: 1, active: true }],
    customers: [{ id: "c1", name: "客户甲", active: true }],
    orders: [
      { id: "old-order", orderNo: "OLD-1", customerId: "c1", productName: "旧件", quantity: 2, dueDate: "2026-10-01", priority: "普通", status: "已完成", note: "", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "platform-order", orderNo: "PLATFORM-OLD", customerId: "c1", productName: "平台件", quantity: 2, dueDate: "2026-10-01", priority: "普通", status: "已完成", note: "", orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "EXT-OLD", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "invalid-platform-order", orderNo: "INVALID-OLD", customerId: "c1", productName: "异常来源件", quantity: 1, dueDate: "2026-10-01", priority: "普通", status: "未开始", note: "", orderOrigin: "platform", sourceChannel: "invalid", externalOrderNumber: "BAD-EXT", createdAt: "2026-09-01T00:00:00.000Z" }
    ],
    workOrders: [
      { id: "old-work", workNo: "OLD-1", orderId: "old-order", productName: "旧件", planQty: 2, status: "已完成", currentProcess: "", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "platform-work", workNo: "PLATFORM-OLD", orderId: "platform-order", productName: "平台件", planQty: 2, status: "已完成", currentProcess: "", createdAt: "2026-09-01T00:00:00.000Z" }
    ],
    routes: [
      { id: "old-route", workOrderId: "old-work", processId: "p1", processName: "激光", sequence: 1, status: "已完成", planQty: 2, completedQty: 2 },
      { id: "platform-route", workOrderId: "platform-work", processId: "p1", processName: "激光", sequence: 1, status: "已完成", planQty: 2, completedQty: 2 }
    ],
    reports: [], exceptions: [], drawings: [], attachments: [], auditLogs: [], settings: {}, customerFeedbacks: []
  }, null, 2), "utf8");
}

async function request(urlPath, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": "manager" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  port = await getFreePort();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  const bootstrap = await request("/api/bootstrap");
  const legacy = bootstrap.data.orders.find((item) => item.id === "old-order");
  assert.deepStrictEqual(
    { orderOrigin: legacy.orderOrigin, sourceChannel: legacy.sourceChannel, externalOrderNumber: legacy.externalOrderNumber },
    { orderOrigin: "factory", sourceChannel: "factory_manual", externalOrderNumber: "" }
  );
  const invalidPlatform = bootstrap.data.orders.find((item) => item.id === "invalid-platform-order");
  assert.deepStrictEqual(
    { orderOrigin: invalidPlatform.orderOrigin, sourceChannel: invalidPlatform.sourceChannel, externalOrderNumber: invalidPlatform.externalOrderNumber },
    { orderOrigin: "factory", sourceChannel: "factory_manual", externalOrderNumber: "" }
  );

  const createBody = { orderNo: "MANUAL-1", customerId: "c1", productName: "新件", quantity: 3, dueDate: "2026-10-10", processIds: ["p1"], orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "X-1" };
  const created = await request("/api/orders", "POST", createBody);
  assert.strictEqual(created.status, 200);
  assert.deepStrictEqual(
    { orderOrigin: created.data.order.orderOrigin, sourceChannel: created.data.order.sourceChannel, externalOrderNumber: created.data.order.externalOrderNumber },
    { orderOrigin: "factory", sourceChannel: "factory_manual", externalOrderNumber: "" }
  );

  const update = await request("/api/orders/update", "POST", {
    ...createBody,
    orderId: created.data.order.id,
    quantityUnit: "件",
    weightKg: null,
    orderOrigin: "platform",
    sourceChannel: "order_platform",
    externalOrderNumber: "FORGED-1",
  });
  assert.strictEqual(update.status, 200);
  assert.deepStrictEqual(
    { orderOrigin: update.data.order.orderOrigin, sourceChannel: update.data.order.sourceChannel, externalOrderNumber: update.data.order.externalOrderNumber },
    { orderOrigin: "factory", sourceChannel: "factory_manual", externalOrderNumber: "" }
  );

  const repeat = await request("/api/orders/repeat", "POST", {
    sourceWorkOrderId: "old-work", orderNo: "REPEAT-1", quantity: 4, dueDate: "2026-10-20", priority: "普通", weightKg: null,
  });
  assert.strictEqual(repeat.status, 200);
  assert.deepStrictEqual(
    { orderOrigin: repeat.data.order.orderOrigin, sourceChannel: repeat.data.order.sourceChannel, externalOrderNumber: repeat.data.order.externalOrderNumber },
    { orderOrigin: "factory", sourceChannel: "factory_manual", externalOrderNumber: "" }
  );

  const platformRepeat = await request("/api/orders/repeat", "POST", {
    sourceWorkOrderId: "platform-work", orderNo: "PLATFORM-REPEAT", quantity: 4, dueDate: "2026-10-20", priority: "普通", weightKg: null,
  });
  assert.strictEqual(platformRepeat.status, 200);
  assert.deepStrictEqual(
    { orderOrigin: platformRepeat.data.order.orderOrigin, sourceChannel: platformRepeat.data.order.sourceChannel, externalOrderNumber: platformRepeat.data.order.externalOrderNumber },
    { orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "" }
  );
  console.log("platform-order-source: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
