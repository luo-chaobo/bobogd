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
    const created = await request(baseUrl, "/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ drawingMode: "none", contactName: "王先生", phone: "13812345678", region: "宁波", quantity: 2, expectedDate: "2026-10-01", description: "设备护罩" }) });
    await request(baseUrl, `/api/admin/inquiries/${created.body.id}/quotes`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: JSON.stringify({ amount: 2000, validUntil: "2026-10-01", confirmed: true }) });
    const paid = await request(baseUrl, `/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" });
    assert.equal(paid.status, 201);

    const event = { eventId: "evt-1", sequence: 1, workOrderId: "work-1", externalOrderNumber: paid.body.orderNumber, type: "process.updated", occurredAt: "2026-09-05T10:00:00.000Z", process: { id: "route-1", name: "激光", status: "已完成", startedAt: "2026-09-05T08:00:00.000Z", completedAt: "2026-09-05T10:00:00.000Z", employee: "不得公开", cost: 88 } };
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
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("persists and completes the bobo create job after payment confirmation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-bobo-job-"));
  const calls = [];
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "admin-token", boboCreate: async (payload) => { calls.push(payload); return { orderId: "bo-1", workOrderId: "bw-1" }; } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const created = await request(baseUrl, "/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ drawingMode: "none", contactName: "王先生", phone: "13812345678", region: "宁波", quantity: 2, expectedDate: "2026-10-01", description: "设备护罩", material: "304" }) });
    await request(baseUrl, `/api/admin/inquiries/${created.body.id}/quotes`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: JSON.stringify({ amount: 2000, validUntil: "2026-10-01", confirmed: true }) });
    const paid = await request(baseUrl, `/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: { authorization: "Bearer admin-token", "content-type": "application/json" }, body: "{}" });
    await app.processBoboJobs();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].externalOrderNumber, paid.body.orderNumber);
    const order = app.database.prepare("SELECT bobo_sync_status, bobo_order_id, bobo_work_order_id FROM orders WHERE id = ?").get(paid.body.id);
    assert.equal(order.bobo_sync_status, "synced");
    assert.equal(order.bobo_order_id, "bo-1");
    assert.equal(order.bobo_work_order_id, "bw-1");
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
