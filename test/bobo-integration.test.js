const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createApplication } = require("../src/server");

function sign(secret, timestamp, nonce, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

test("accepts one signed bobo event and exposes only the public process timeline", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-bobo-event-"));
  const secret = "integration-secret-32-characters";
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    adminToken: "admin-token",
    boboWebhookSecret: secret
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await request(baseUrl, "/api/health")).body.version, "0.2.1");
    const created = await request(baseUrl, "/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ drawingMode: "none", contactName: "王先生", phone: "13812345678", region: "浙江省 宁波市 北仑区", address: "新碶街道 1 号", quantity: 2, expectedDate: "2026-10-01", description: "设备护罩" }) });
    await request(baseUrl, `/api/admin/inquiries/${created.body.id}/quotes`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: JSON.stringify({ amount: 2000, validUntil: "2026-10-01", confirmed: true, specification: { requirement: "控制柜外壳", material: "SECC", thickness: "1.5 mm", dimensions: "600×400×300 mm", process: "激光、折弯、喷塑", quantity: 2, expectedDate: "2026-10-01", technicalRequirements: "无毛刺", remark: "" } }) });
    const paid = await request(baseUrl, `/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" });
    assert.equal(paid.status, 201);

    const event = { eventId: "evt-1", sequence: 1, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "process.updated", occurredAt: "2026-09-05T10:00:00.000Z", allProcessesCompleted: false, process: { id: "route-1", sequence: 1, name: "激光", status: "已完成", startedAt: "2026-09-05T08:00:00.000Z", completedAt: "2026-09-05T10:00:00.000Z", employee: "不得公开", cost: 88 } };
    const body = JSON.stringify(event);
    const timestamp = String(Date.now());
    const nonce = "nonce-1";
    const headers = { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": nonce, "x-integration-signature": sign(secret, timestamp, nonce, body) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers, body })).status, 202);
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers, body })).status, 409);
    const retryNonce = "nonce-2";
    const retryHeaders = { ...headers, "x-integration-nonce": retryNonce, "x-integration-signature": sign(secret, timestamp, retryNonce, body) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers: retryHeaders, body })).status, 200);

    const db = app.database;
    const order = db.prepare("SELECT id FROM orders WHERE order_number = ?").get(paid.body.orderNumber);
    const stored = db.prepare("SELECT * FROM public_processes WHERE order_id = ?").all(order.id);
    assert.deepEqual(stored.map((item) => ({ name: item.name, status: item.status })), [{ name: "激光", status: "已完成" }]);
    assert.equal(Object.hasOwn(stored[0], "employee"), false);
    const publicStatus = await request(baseUrl, `/api/order-status?orderNumber=${encodeURIComponent(paid.body.orderNumber)}&phone=13812345678`);
    assert.equal(publicStatus.status, 200);
    assert.equal(publicStatus.body.status, "production");
    assert.deepEqual(publicStatus.body.processes, [{ id: "route-1", sequence: 1, name: "激光", status: "已完成", startedAt: "2026-09-05T08:00:00.000Z", completedAt: "2026-09-05T10:00:00.000Z" }]);
    assert.equal(JSON.stringify(publicStatus.body).includes("不得公开"), false);

    const productionOrders = await request(baseUrl, "/api/admin/orders", { headers: { authorization: "Bearer admin-token" } });
    assert.equal(productionOrders.body[0].status, "production");
    assert.equal(productionOrders.body[0].currentProcess, "激光已完成，等待下一工序");
    const productionOrder = await request(baseUrl, `/api/admin/orders/${paid.body.id}`, { headers: { authorization: "Bearer admin-token" } });
    assert.equal(productionOrder.body.currentProcess, "激光已完成，等待下一工序");

    const activeEvent = { eventId: "evt-2", sequence: 2, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "process.updated", occurredAt: "2026-09-05T10:30:00.000Z", allProcessesCompleted: false, process: { id: "route-2", sequence: 2, name: "焊接", status: "进行中", startedAt: "2026-09-05T10:30:00.000Z", completedAt: "" } };
    const activeBody = JSON.stringify(activeEvent);
    const activeNonce = "nonce-3";
    const activeHeaders = { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": activeNonce, "x-integration-signature": sign(secret, timestamp, activeNonce, activeBody) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers: activeHeaders, body: activeBody })).status, 202);
    const activeOrder = await request(baseUrl, `/api/admin/orders/${paid.body.id}`, { headers: { authorization: "Bearer admin-token" } });
    assert.equal(activeOrder.body.currentProcess, "焊接 · 进行中");

    const completedEvent = { eventId: "evt-3", sequence: 3, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "process.updated", occurredAt: "2026-09-05T12:00:00.000Z", allProcessesCompleted: true, process: { id: "route-3", sequence: 3, name: "质检", status: "已完成", startedAt: "2026-09-05T11:30:00.000Z", completedAt: "2026-09-05T12:00:00.000Z" } };
    const completedBody = JSON.stringify(completedEvent);
    const completedNonce = "nonce-4";
    const completedHeaders = { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": completedNonce, "x-integration-signature": sign(secret, timestamp, completedNonce, completedBody) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers: completedHeaders, body: completedBody })).status, 202);
    const adminOrders = await request(baseUrl, "/api/admin/orders", { headers: { authorization: "Bearer admin-token" } });
    assert.equal(adminOrders.body[0].status, "ready");
    assert.equal(adminOrders.body[0].statusText, "待配送");
    assert.equal(adminOrders.body[0].currentProcess, "工序已全部完成");
    const adminOrder = await request(baseUrl, `/api/admin/orders/${paid.body.id}`, { headers: { authorization: "Bearer admin-token" } });
    assert.equal(adminOrder.body.currentProcess, "工序已全部完成");
    assert.deepEqual(adminOrder.body.processes, [
      { id: "route-1", sequence: 1, name: "激光", status: "已完成", startedAt: "2026-09-05T08:00:00.000Z", completedAt: "2026-09-05T10:00:00.000Z" },
      { id: "route-2", sequence: 2, name: "焊接", status: "进行中", startedAt: "2026-09-05T10:30:00.000Z", completedAt: "" },
      { id: "route-3", sequence: 3, name: "质检", status: "已完成", startedAt: "2026-09-05T11:30:00.000Z", completedAt: "2026-09-05T12:00:00.000Z" },
    ]);

    const shipmentEvent = { eventId: "evt-4", sequence: 4, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "shipment.shipped", occurredAt: "2026-09-05T13:00:00.000Z", allProcessesCompleted: true };
    const shipmentBody = JSON.stringify(shipmentEvent);
    const shipmentNonce = "nonce-5";
    const shipmentHeaders = { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": shipmentNonce, "x-integration-signature": sign(secret, timestamp, shipmentNonce, shipmentBody) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers: shipmentHeaders, body: shipmentBody })).status, 202);

    const deliveryEvent = { eventId: "evt-5", sequence: 5, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "delivery.completed", occurredAt: "2026-09-05T15:00:00.000Z", allProcessesCompleted: true, delivery: { deliveredAt: "2026-09-05T15:00:00.000Z" } };
    const deliveryBody = JSON.stringify(deliveryEvent);
    const deliveryNonce = "nonce-6";
    const deliveryHeaders = { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": deliveryNonce, "x-integration-signature": sign(secret, timestamp, deliveryNonce, deliveryBody) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers: deliveryHeaders, body: deliveryBody })).status, 202);
    const deliveredOrder = await request(baseUrl, `/api/admin/orders/${paid.body.id}`, { headers: { authorization: "Bearer admin-token" } });
    assert.equal(deliveredOrder.body.status, "completed");
    assert.equal(deliveredOrder.body.statusText, "已送达");
    assert.equal(deliveredOrder.body.completedAt, "2026-09-05T15:00:00.000Z");
    assert.equal(deliveredOrder.body.events.at(-1).title, "订单已送达");
    const webhookRows = db.prepare("SELECT event_id, event_type, applied_status, payload_json FROM bobo_webhook_events ORDER BY sequence").all();
    assert.deepEqual(webhookRows.map((item) => [item.event_id, item.event_type, item.applied_status]), [
      ["evt-1", "process.updated", "production"],
      ["evt-2", "process.updated", "production"],
      ["evt-3", "process.updated", "ready"],
      ["evt-4", "shipment.shipped", "shipped"],
      ["evt-5", "delivery.completed", "completed"]
    ]);
    assert.equal(JSON.parse(webhookRows[0].payload_json).process.name, "激光");
    const auditRows = db.prepare("SELECT detail FROM audit_logs WHERE action = 'webhook_event' ORDER BY id").all();
    assert.deepEqual(JSON.parse(auditRows[0].detail), {
      kind: "bobo_webhook",
      eventType: "process.updated",
      eventId: "evt-1",
      process: { name: "激光", status: "已完成" }
    });
    assert.deepEqual(JSON.parse(auditRows.at(-1).detail), {
      kind: "bobo_webhook",
      eventType: "delivery.completed",
      eventId: "evt-5",
      deliveredAt: "2026-09-05T15:00:00.000Z"
    });

    db.exec(`CREATE TRIGGER reject_bobo_event BEFORE INSERT ON bobo_webhook_events
      WHEN NEW.event_id = 'evt-rollback' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END`);
    const rollbackEvent = { eventId: "evt-rollback", sequence: 6, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "process.updated", occurredAt: "2026-09-05T16:00:00.000Z", allProcessesCompleted: true, process: { id: "route-rollback", sequence: 4, name: "包装", status: "已完成", startedAt: "", completedAt: "2026-09-05T16:00:00.000Z" } };
    const rollbackBody = JSON.stringify(rollbackEvent);
    const rollbackNonce = "nonce-rollback";
    const rollbackHeaders = { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": rollbackNonce, "x-integration-signature": sign(secret, timestamp, rollbackNonce, rollbackBody) };
    assert.equal((await request(baseUrl, "/api/integrations/bobo/events", { method: "POST", headers: rollbackHeaders, body: rollbackBody })).status, 500);
    assert.equal(db.prepare("SELECT bobo_last_sequence FROM orders WHERE id = ?").get(order.id).bobo_last_sequence, 5);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_processes WHERE process_id = 'route-rollback'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'webhook_event'").get().count, 5);

  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("auto-queues a fully paid legacy order before sending the bobo create job", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-bobo-job-"));
  const calls = [];
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "admin-token", boboCreate: async (payload) => { calls.push(payload); return { orderId: "bo-1", workOrderId: "bw-1" }; } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const created = await request(baseUrl, "/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ drawingMode: "none", contactName: "王先生", phone: "13812345678", region: "浙江省 宁波市 北仑区", address: "新碶街道 1 号", quantity: 2, expectedDate: "2026-10-01", description: "设备护罩" }) });
    await request(baseUrl, `/api/admin/inquiries/${created.body.id}/quotes`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: JSON.stringify({ amount: 2000, validUntil: "2026-10-01", confirmed: true, specification: { requirement: "控制柜外壳", material: "SECC", thickness: "1.5 mm", dimensions: "600×400×300 mm", process: "激光、折弯、喷塑", quantity: 2, expectedDate: "2026-10-01", technicalRequirements: "无毛刺", remark: "" } }) });
    const paid = await request(baseUrl, `/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" });
    assert.equal(paid.body.boboSyncStatus, "pending");
    assert.equal(paid.body.boboAutoSubmitted, true);

    const prematureRetry = await request(baseUrl, `/api/admin/orders/${paid.body.id}/bobo-retry`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" });
    assert.equal(prematureRetry.status, 409);
    assert.equal((await request(baseUrl, `/api/admin/orders/${paid.body.id}/bobo-retry`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" })).status, 409);
    await app.processBoboJobs();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].externalOrderNumber, paid.body.orderNumber);
    assert.equal(calls[0].sourceChannel, "order_platform");
    assert.equal(calls[0].material, "SECC");
    assert.equal(calls[0].dimensions, "600×400×300 mm");
    assert.equal(calls[0].region, "浙江省 宁波市 北仑区");
    assert.equal(calls[0].deliveryAddress, "新碶街道 1 号");
    assert.match(calls[0].description, /控制柜外壳.*厚度：1\.5 mm.*加工工艺：激光、折弯、喷塑.*技术要求：无毛刺/);
    const order = app.database.prepare("SELECT bobo_sync_status, bobo_order_id, bobo_work_order_id FROM orders WHERE id = ?").get(paid.body.id);
    assert.equal(order.bobo_sync_status, "synced");
    assert.equal(order.bobo_order_id, "bo-1");
    assert.equal(order.bobo_work_order_id, "bw-1");
    assert.equal((await request(baseUrl, `/api/admin/orders/${paid.body.id}/bobo-retry`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" })).status, 409);
  } finally {
    await new Promise((resolve) => app.server.close(resolve)); app.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a verified payment when the automatically queued bobo call fails", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-bobo-failure-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "admin-token", boboCreate: async () => { throw new Error("波波暂时离线"); } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { authorization: "Bearer admin-token", "content-type": "application/json" };
  try {
    const inquiry = await request(baseUrl, "/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ drawingMode: "none", contactName: "李先生", phone: "13812345679", region: "宁波", quantity: 1, expectedDate: "2026-10-01", description: "设备护罩" }) });
    await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/quotes`, { method: "POST", headers, body: JSON.stringify({ amount: 2000, validUntil: "2026-10-01", confirmed: true, paymentMode: "full", startAmount: 2000 }) });
    const order = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/order-confirmation`, { method: "POST", headers, body: "{}" });
    const payment = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, { method: "POST", headers, body: JSON.stringify({ amount: 2000, paymentMethod: "银行转账", payerName: "李先生" }) });
    const verified = await request(baseUrl, `/api/admin/payments/${payment.body.id}/verify`, { method: "POST", headers, body: "{}" });
    assert.equal(verified.body.boboAutoSubmitted, true);
    await app.processBoboJobs();
    assert.equal(app.database.prepare("SELECT status FROM payments WHERE id = ?").get(payment.body.id).status, "verified");
    assert.equal(app.database.prepare("SELECT bobo_sync_status FROM orders WHERE id = ?").get(order.body.id).bobo_sync_status, "retrying");
    assert.match(app.database.prepare("SELECT last_error FROM bobo_sync_jobs WHERE order_id = ?").get(order.body.id).last_error, /波波暂时离线/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve)); app.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("uses production WeChat adapters for login and phone authorization", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-wechat-provider-"));
  const calls = [];
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    exchangeWechatCode: async (code) => { calls.push(["login", code]); return "openid-production"; },
    exchangePhoneCode: async (code) => { calls.push(["phone", code]); return "13812345678"; }
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await request(baseUrl, "/api/auth/wechat/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "wx-login-code" }) });
    assert.equal(login.status, 201);
    const binding = await request(baseUrl, "/api/customer/phone-binding", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.body.sessionToken}` }, body: JSON.stringify({ phoneCode: "wx-phone-code" }) });
    assert.equal(binding.status, 200);
    assert.equal(binding.body.customer.phone, "13812345678");
    assert.deepEqual(calls, [["login", "wx-login-code"], ["phone", "wx-phone-code"]]);
  } finally {
    await new Promise((resolve) => app.server.close(resolve)); app.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
