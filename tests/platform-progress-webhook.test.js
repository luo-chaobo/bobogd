const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const secret = "webhook-test-secret";

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for webhook or server");
}

test("platform report persists a signed, retryable public progress event", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bobo-progress-"));
  const dbPath = path.join(directory, "data", "db.json");
  let child;
  let acceptWebhook = false;
  const received = [];
  const receiver = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ body, headers: request.headers });
    response.writeHead(acceptWebhook ? 202 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: acceptWebhook }));
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const readDb = () => JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const start = async () => {
    child = spawn(process.execPath, ["server.js"], {
      cwd: directory,
      env: { ...process.env, PORT: String(port), DB_DRIVER: "json", BOBO_INTEGRATION_SECRET: secret, FUTURE_WEBHOOK_URL: `http://127.0.0.1:${receiver.address().port}/api/integrations/bobo/events` },
      stdio: "ignore"
    });
    await waitFor(async () => { try { return (await fetch(`${baseUrl}/api/tv-dashboard`)).ok; } catch { return false; } });
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  };
  try {
    for (const name of ["data", "lib", "public"]) fs.mkdirSync(path.join(directory, name), { recursive: true });
    fs.copyFileSync(path.join(root, "server.js"), path.join(directory, "server.js"));
    fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(directory, "lib", "weapp-image.js"));
    fs.writeFileSync(path.join(directory, "public", "index.html"), "test");
    fs.writeFileSync(dbPath, JSON.stringify({
      users: [
        { id: "worker", name: "工人", phone: "1", role: "laser_worker", roles: ["laser_worker"], password: "1", active: true },
        { id: "vip", name: "管理账号", phone: "15257457485", role: "manager", roles: ["manager"], password: "1", active: true },
      ],
      deletedUsers: [], processes: [{ id: "laser", name: "激光", sort: 1, active: true }],
      customers: [{ id: "customer", name: "客户", active: true }],
      orders: [
        { id: "order", orderNo: "WL-TEST-1", orderOrigin: "platform", sourceChannel: "order_platform", externalOrderNumber: "WL-TEST-1", customerId: "customer", productName: "Q235", quantity: 1, dueDate: "2099-01-01", status: "生产中" },
        { id: "order-2", orderNo: "WL-TEST-2", orderOrigin: "platform", sourceChannel: "order_platform", externalOrderNumber: "WL-TEST-2", customerId: "customer", productName: "Q235", quantity: 1, dueDate: "2099-01-01", status: "生产中" },
        { id: "factory-order", orderNo: "FACTORY-1", orderOrigin: "factory", sourceChannel: "factory_manual", customerId: "customer", productName: "Q235", quantity: 1, dueDate: "2099-01-01", status: "生产中" }
      ],
      workOrders: [
        { id: "work", workNo: "WL-TEST-1", orderId: "order", productName: "Q235", planQty: 1, status: "生产中" },
        { id: "work-2", workNo: "WL-TEST-2", orderId: "order-2", productName: "Q235", planQty: 1, status: "生产中" },
        { id: "factory-work", workNo: "FACTORY-1", orderId: "factory-order", productName: "Q235", planQty: 1, status: "生产中" }
      ],
      routes: [
        { id: "route", workOrderId: "work", processId: "laser", processName: "激光", sequence: 1, assignedRole: "laser_worker", assignedTo: "worker", status: "进行中", planQty: 1, completedQty: 0 },
        { id: "route-2", workOrderId: "work-2", processId: "laser", processName: "激光", sequence: 1, assignedRole: "laser_worker", assignedTo: "worker", status: "进行中", planQty: 1, completedQty: 0 },
        { id: "factory-route", workOrderId: "factory-work", processId: "laser", processName: "激光", sequence: 1, assignedRole: "laser_worker", assignedTo: "worker", status: "进行中", planQty: 1, completedQty: 0 }
      ],
      reports: [], exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
    }));
    await start();
    const reportResponse = await fetch(`${baseUrl}/api/report`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "worker" },
      body: JSON.stringify({ routeId: "route", completedQty: 1 })
    });
    assert.equal(reportResponse.status, 200);
    await waitFor(() => received.length === 1);
    const queued = readDb().platformWebhookEvents;
    assert.equal(queued.length, 1);
    assert.equal(queued[0].status, "pending");
    const first = received[0];
    const event = JSON.parse(first.body);
    assert.deepEqual({ externalOrderNumber: event.externalOrderNumber, workOrderId: event.workOrderId, type: event.type, sequence: event.sequence }, { externalOrderNumber: "WL-TEST-1", workOrderId: "work", type: "process.updated", sequence: 1 });
    assert.deepEqual({ id: event.process.id, name: event.process.name, status: event.process.status }, { id: "route", name: "激光", status: "已完成" });
    assert.equal(event.allProcessesCompleted, true);
    assert.equal(first.body.includes("工人"), false);
    const signed = crypto.createHmac("sha256", secret).update(`${first.headers["x-integration-timestamp"]}.${first.headers["x-integration-nonce"]}.${first.body}`).digest("hex");
    assert.equal(first.headers["x-integration-signature"], signed);

    acceptWebhook = true;
    const secondReport = await fetch(`${baseUrl}/api/report`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "worker" },
      body: JSON.stringify({ routeId: "route-2", completedQty: 1 })
    });
    assert.equal(secondReport.status, 200);
    await waitFor(() => received.length === 2 && readDb().platformWebhookEvents[1]?.status === "delivered");
    assert.equal(JSON.parse(received[1].body).externalOrderNumber, "WL-TEST-2");
    assert.equal(JSON.parse(received[1].body).allProcessesCompleted, true);
    const factoryReport = await fetch(`${baseUrl}/api/report`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "worker" },
      body: JSON.stringify({ routeId: "factory-route", completedQty: 1 })
    });
    assert.equal(factoryReport.status, 200);
    assert.equal(readDb().platformWebhookEvents.length, 2);

    await stop();
    const pendingDb = readDb();
    pendingDb.platformWebhookEvents[0].nextAttemptAt = "";
    fs.writeFileSync(dbPath, JSON.stringify(pendingDb));
    await start();
    await waitFor(() => received.length === 3 && readDb().platformWebhookEvents[0].status === "delivered");
    assert.equal(JSON.parse(received[2].body).eventId, event.eventId);
    assert.equal(readDb().reports.length, 3);

    const fulfillmentResponse = await fetch(`${baseUrl}/api/orders/fulfillment`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "vip" },
      body: JSON.stringify({ orderId: "order", shipped: true, invoiced: false })
    });
    assert.equal(fulfillmentResponse.status, 200);
    const fulfillment = await fulfillmentResponse.json();
    assert.equal(fulfillment.status, "已发货");
    assert.equal(fulfillment.platformSync, "pending");
    await waitFor(() => received.length === 4 && readDb().platformWebhookEvents[2]?.status === "delivered");
    const shipmentRequest = received[3];
    const shipmentEvent = JSON.parse(shipmentRequest.body);
    assert.deepEqual({ externalOrderNumber: shipmentEvent.externalOrderNumber, workOrderId: shipmentEvent.workOrderId, type: shipmentEvent.type, sequence: shipmentEvent.sequence }, { externalOrderNumber: "WL-TEST-1", workOrderId: "work", type: "shipment.shipped", sequence: 2 });
    assert.equal(shipmentEvent.allProcessesCompleted, true);
    const shipmentSignature = crypto.createHmac("sha256", secret).update(`${shipmentRequest.headers["x-integration-timestamp"]}.${shipmentRequest.headers["x-integration-nonce"]}.${shipmentRequest.body}`).digest("hex");
    assert.equal(shipmentRequest.headers["x-integration-signature"], shipmentSignature);

    const duplicateFulfillmentResponse = await fetch(`${baseUrl}/api/orders/fulfillment`, {
      method: "POST", headers: { "content-type": "application/json", "x-user-id": "vip" },
      body: JSON.stringify({ orderId: "order", shipped: true, invoiced: false })
    });
    assert.equal(duplicateFulfillmentResponse.status, 200);
    assert.equal(readDb().platformWebhookEvents.length, 3, "repeating shipped updates must not create duplicate events");
  } finally {
    await stop();
    await new Promise((resolve) => receiver.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
