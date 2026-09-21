const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobo-delivery-flow-"));
let child;
let port;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
}

function seed() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test");
  const users = [
    { id: "manager", name: "主管", phone: "1", role: "manager", roles: ["manager"], password: "1", active: true },
    { id: "driver-a", name: "司机甲", phone: "2", role: "driver", roles: ["driver"], password: "1", active: true },
    { id: "driver-b", name: "司机乙", phone: "3", role: "driver", roles: ["driver"], password: "1", active: true },
  ];
  const orders = [
    { id: "platform-ready", orderNo: "P-READY", customerId: "c1", productName: "平台件", quantity: 1, dueDate: "2026-10-01", status: "已完成", orderOrigin: "platform", sourceChannel: "order_platform", externalOrderNumber: "P-READY", region: "浙江省 宁波市 鄞州区", deliveryAddress: "学府路 1 号" },
    { id: "platform-no-address", orderNo: "P-NO-ADDR", customerId: "c1", productName: "平台件", quantity: 1, dueDate: "2026-10-01", status: "已完成", orderOrigin: "platform", sourceChannel: "miniprogram", externalOrderNumber: "P-NO-ADDR", region: "", deliveryAddress: "" },
    { id: "factory-ready", orderNo: "F-READY", customerId: "c1", productName: "工厂件", quantity: 1, dueDate: "2026-10-01", status: "已完成", orderOrigin: "factory", sourceChannel: "factory_manual" },
    { id: "platform-working", orderNo: "P-WORK", customerId: "c1", productName: "在产件", quantity: 1, dueDate: "2026-10-01", status: "生产中", orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "P-WORK", region: "浙江省 宁波市", deliveryAddress: "江南路 2 号" },
    { id: "platform-legacy", orderNo: "P-LEGACY", customerId: "c1", productName: "旧发货件", quantity: 1, dueDate: "2026-10-01", status: "已发货", orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "P-LEGACY", region: "浙江省 宁波市", deliveryAddress: "旧地址 3 号", shippedAt: "2026-09-01T08:00:00.000Z" },
  ];
  const workOrders = orders.map((order) => ({ id: `w-${order.id}`, workNo: order.orderNo, orderId: order.id, productName: order.productName, planQty: 1, status: order.id === "platform-legacy" ? "已完成" : order.status, creationStatus: "confirmed" }));
  const routes = workOrders.map((workOrder) => ({ id: `r-${workOrder.id}`, workOrderId: workOrder.id, processId: "p1", processName: "激光", sequence: 1, status: workOrder.status === "已完成" ? "已完成" : "进行中", planQty: 1, completedQty: workOrder.status === "已完成" ? 1 : 0 }));
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({ users, deletedUsers: [], processes: [{ id: "p1", name: "激光", sort: 1, active: true }], customers: [{ id: "c1", name: "客户", active: true }], orders, workOrders, routes, reports: [], exceptions: [], customerFeedbacks: [], attachments: [], drawings: [], auditLogs: [], platformWebhookEvents: [], settings: {} }, null, 2));
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("服务启动超时");
}

async function request(pathname, userId, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function run() {
  seed();
  port = await freePort();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: ["ignore", "ignore", "inherit"] });
  await waitForServer();

  const available = await request("/api/deliveries/available?region=%E5%AE%81%E6%B3%A2", "driver-a");
  assert.strictEqual(available.status, 200);
  assert.deepStrictEqual(available.data.orders.map((order) => order.id), ["platform-ready"]);
  assert.strictEqual((await request("/api/delivery-trips/start", "driver-a", "POST", { orderIds: ["platform-no-address"] })).status, 409);
  assert.strictEqual((await request("/api/delivery-trips/start", "driver-a", "POST", { orderIds: ["factory-ready"] })).status, 409);
  assert.strictEqual((await request("/api/delivery-trips/start", "driver-a", "POST", { orderIds: ["platform-working"] })).status, 409);

  const started = await request("/api/delivery-trips/start", "driver-a", "POST", { orderIds: ["platform-ready"] });
  assert.strictEqual(started.status, 201);
  assert.strictEqual(started.data.delivery.status, "delivering");
  assert.ok(started.data.trip.startedAt);
  assert.strictEqual((await request("/api/delivery-trips/start", "driver-b", "POST", { orderIds: ["platform-ready"] })).status, 409);

  const withoutPhoto = await request("/api/deliveries/complete", "driver-a", "POST", { orderId: "platform-ready", photos: [] });
  assert.strictEqual(withoutPhoto.status, 400);
  const completed = await request("/api/deliveries/complete", "driver-a", "POST", { orderId: "platform-ready", photos: [{ name: "proof.png", dataUrl: "data:image/png;base64,aGVsbG8=" }], note: "已签收" });
  assert.strictEqual(completed.status, 200);
  assert.strictEqual(completed.data.delivery.status, "delivered");
  assert.ok(completed.data.delivery.deliveredAt);
  assert.strictEqual(completed.data.delivery.proofAttachmentIds.length, 1);
  assert.strictEqual((await request("/api/deliveries/complete", "driver-a", "POST", { orderId: "platform-ready", photos: [{ name: "again.png", dataUrl: "data:image/png;base64,aGVsbG8=" }] })).status, 409);
  assert.strictEqual((await request("/api/deliveries/release", "driver-a", "POST", { orderId: "platform-ready" })).status, 409);
  assert.strictEqual((await request("/api/deliveries/release", "manager", "POST", { orderId: "platform-ready" })).status, 400);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.ok(db.orders.find((order) => order.id === "platform-ready").shippedAt);
  assert.strictEqual(db.platformWebhookEvents.filter((item) => item.event.type === "shipment.shipped").length, 1);
  assert.strictEqual(db.platformWebhookEvents.filter((item) => item.event.type === "delivery.completed").length, 1);
  assert.strictEqual(db.deliveries.find((delivery) => delivery.orderId === "platform-legacy").status, "legacy_shipped");
  assert.ok(db.auditLogs.some((item) => item.action === "delivery-complete"));
  console.log("delivery-flow: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
