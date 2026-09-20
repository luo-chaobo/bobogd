const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const secret = "test-integration-secret";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-platform-order-integration-"));
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
    deletedUsers: [], processes: [], customers: [{ id: "c1", name: "工厂客户", active: true }],
    orders: [{ id: "factory-order", orderNo: "FACTORY-1", customerId: "c1", productName: "工厂件", quantity: 1, dueDate: "2026-10-01", priority: "普通", status: "未开始", note: "" }],
    workOrders: [], routes: [], reports: [], exceptions: [], drawings: [], attachments: [], auditLogs: [], settings: {}, customerFeedbacks: [],
    integrationNonces: [{ nonce: "expired-nonce", createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }]
  }, null, 2), "utf8");
}

function signedHeaders(raw, nonce, timestamp = String(Date.now())) {
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${raw}`).digest("hex");
  return {
    "content-type": "application/json",
    "x-integration-timestamp": timestamp,
    "x-integration-nonce": nonce,
    "x-integration-signature": signature,
  };
}

async function external(body, nonce, options = {}) {
  const raw = options.raw || JSON.stringify(body);
  const headers = options.headers || signedHeaders(raw, nonce, options.timestamp);
  const response = await fetch(`http://127.0.0.1:${port}/api/external/work-orders`, { method: "POST", headers, body: raw });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function startServer(integrationSecret) {
  port = await getFreePort();
  const env = { ...process.env, PORT: String(port), DB_DRIVER: "json" };
  if (integrationSecret) env.BOBO_INTEGRATION_SECRET = integrationSecret;
  else delete env.BOBO_INTEGRATION_SECRET;
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env, stdio: "ignore" });
  await waitForServer();
}

async function stopServer() {
  if (!child) return;
  if (child.exitCode !== null) {
    child = null;
    return;
  }
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  child = null;
}

async function internalUpdate(body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/orders/update`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "manager" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function run() {
  seedDatabase();
  await startServer(secret);

  const health = await fetch(`http://127.0.0.1:${port}/api/external/health`);
  assert.strictEqual(health.status, 200);
  assert.deepStrictEqual(await health.json(), { enabled: true, service: "external-work-orders", processMode: "single-process" });

  const body = { externalOrderNumber: "PLATFORM-1", sourceChannel: "website", customer: "平台客户", phone: "13800000000", quantity: 5, expectedDate: "2026-10-12", description: "壳体打样", material: "304不锈钢" };
  const created = await external(body, "nonce-create");
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.data.order.orderNo, "PLATFORM-1");
  assert.deepStrictEqual(
    { orderOrigin: created.data.order.orderOrigin, sourceChannel: created.data.order.sourceChannel, externalOrderNumber: created.data.order.externalOrderNumber, orderStatus: created.data.order.status, workOrderStatus: created.data.workOrder.status },
    { orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "PLATFORM-1", orderStatus: "待排产", workOrderStatus: "待排产" }
  );
  assert.strictEqual(created.data.routes.length, 0);

  const sameNonceBody = { ...body, externalOrderNumber: "CONCURRENT-NONCE" };
  const sameNonce = await Promise.all([
    external(sameNonceBody, "nonce-concurrent"),
    external(sameNonceBody, "nonce-concurrent"),
  ]);
  assert.deepStrictEqual(sameNonce.map((item) => item.status).sort((a, b) => a - b), [201, 401]);

  const sameOrderBody = { ...body, externalOrderNumber: "CONCURRENT-ORDER" };
  const sameOrder = await Promise.all([
    external(sameOrderBody, "nonce-concurrent-order-a"),
    external(sameOrderBody, "nonce-concurrent-order-b"),
  ]);
  assert.deepStrictEqual(sameOrder.map((item) => item.status).sort((a, b) => a - b), [200, 201]);
  assert.strictEqual(sameOrder[0].data.order.id, sameOrder[1].data.order.id);
  assert.strictEqual(sameOrder[0].data.workOrder.id, sameOrder[1].data.workOrder.id);

  const repeated = await external(body, "nonce-repeat");
  assert.strictEqual(repeated.status, 200);
  assert.strictEqual(repeated.data.order.id, created.data.order.id);
  assert.strictEqual(repeated.data.workOrder.id, created.data.workOrder.id);

  const renamed = await internalUpdate({
    orderId: created.data.order.id, orderNo: "PLATFORM-RENAMED", customerId: created.data.order.customerId,
    productName: created.data.order.productName, quantity: created.data.order.quantity, quantityUnit: "件",
    dueDate: created.data.order.dueDate, priority: "普通", note: created.data.order.note,
  });
  assert.strictEqual(renamed.status, 400);
  const retryAfterRename = await external(body, "nonce-retry-after-rename");
  assert.strictEqual(retryAfterRename.status, 200);
  assert.strictEqual(retryAfterRename.data.order.id, created.data.order.id);

  assert.strictEqual((await external({ ...body, material: "Q235" }, "nonce-conflict")).status, 409);
  assert.strictEqual((await external({ ...body, externalOrderNumber: "FACTORY-1" }, "nonce-factory-conflict")).status, 409);
  assert.strictEqual((await external({ ...body, customer: "" }, "nonce-invalid")).status, 422);
  assert.strictEqual((await external({ ...body, sourceChannel: "manual" }, "nonce-invalid-channel")).status, 422);
  assert.strictEqual((await external({ ...body, externalOrderNumber: "X".repeat(129) }, "nonce-long-order")).status, 422);
  assert.strictEqual((await external(body, "nonce-bad-signature", { headers: { "content-type": "application/json" } })).status, 401);
  const originalRaw = JSON.stringify(body);
  assert.strictEqual((await external(body, "nonce-modified-body", { raw: JSON.stringify({ ...body, description: "已被篡改" }), headers: signedHeaders(originalRaw, "nonce-modified-body") })).status, 401);
  assert.strictEqual((await external(body, "nonce-old-time", { timestamp: String(Date.now() - 6 * 60 * 1000) })).status, 401);
  assert.strictEqual((await external(body, "nonce-future-time", { timestamp: String(Date.now() + 6 * 60 * 1000) })).status, 401);
  assert.strictEqual((await external({ ...body, externalOrderNumber: "LONG-NONCE" }, "n".repeat(129))).status, 401);
  for (const sourceChannel of ["order_platform", "miniprogram"]) {
    assert.strictEqual((await external({ ...body, externalOrderNumber: `CHANNEL-${sourceChannel}`, sourceChannel }, `nonce-${sourceChannel}`)).status, 201);
  }
  assert.strictEqual((await external({ ...body, externalOrderNumber: "REPLAY-1" }, "nonce-replay")).status, 201);
  assert.strictEqual((await external({ ...body, externalOrderNumber: "REPLAY-1" }, "nonce-replay")).status, 401);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.ok(Array.isArray(db.integrationNonces));
  assert.ok(db.integrationNonces.some((item) => item.nonce === "nonce-create"));
  assert.ok(!db.integrationNonces.some((item) => item.nonce === "expired-nonce"));
  assert.strictEqual(db.workOrders.filter((item) => item.orderId === created.data.order.id).length, 1);
  assert.strictEqual(db.routes.filter((item) => item.workOrderId === created.data.workOrder.id).length, 0);

  await stopServer();
  await startServer(secret);
  assert.strictEqual((await external({ ...body, externalOrderNumber: "REPLAY-1" }, "nonce-replay")).status, 401);
  await stopServer();
  await startServer("");
  const disabledHealth = await fetch(`http://127.0.0.1:${port}/api/external/health`);
  assert.deepStrictEqual(await disabledHealth.json(), { enabled: false, service: "external-work-orders", processMode: "single-process" });
  assert.strictEqual((await external(body, "nonce-disabled")).status, 503);

  await stopServer();
  await startServer(secret);
  fs.rmSync(path.join(tempRoot, "data", "db.json"));
  let storageFailure;
  try {
    storageFailure = await external({ ...body, externalOrderNumber: "STORAGE-FAIL" }, "nonce-storage-failure");
  } catch {
    storageFailure = { status: 0 };
  }
  assert.strictEqual(storageFailure.status, 500);
  console.log("platform-order-integration: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await stopServer();
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
