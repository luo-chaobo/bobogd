const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApplication } = require("../src/server");

function inquiryPayload() {
  return {
    drawingMode: "none",
    contactName: "王先生",
    phone: "13812345678",
    region: "宁波北仑",
    quantity: 2,
    expectedDate: "2026-09-10",
    description: "制作设备不锈钢防护罩",
    material: "304不锈钢",
    dimensions: "800×500×300 mm",
    attachments: [{ name: "现场.jpg", size: 4, content: "dGVzdA==" }]
  };
}

async function withApp(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-site-"));
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    adminToken: "test-token",
    enableWechatMock: true,
    enablePhoneMock: true,
    now: () => new Date("2026-08-29T02:00:00.000Z")
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await run(baseUrl, app);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { response, body };
}

function customerHeaders(sessionToken) {
  return { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };
}

test("creates an inquiry and blocks a rapid duplicate", async () => {
  await withApp(async (baseUrl) => {
    const first = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    assert.equal(first.response.status, 201);
    assert.match(first.body.inquiryNumber, /^XQ-20260829-\d{4}$/);

    const duplicate = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.message, "需求已收到，请勿重复提交");
  });
});

test("keeps mock WeChat login disabled unless explicitly enabled", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-site-mock-off-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "test-token" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await jsonRequest(`http://127.0.0.1:${app.server.address().port}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:wx-off" }) });
    assert.equal(result.response.status, 501);
    assert.match(result.body.message, /未配置微信验证提供商/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects invalid public inquiry data", async () => {
  await withApp(async (baseUrl) => {
    const payload = inquiryPayload();
    payload.phone = "123";
    const result = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.field, "phone");
  });
});

test("requires admin authentication", async () => {
  await withApp(async (baseUrl) => {
    const result = await jsonRequest(`${baseUrl}/api/admin/inquiries`);
    assert.equal(result.response.status, 401);
  });
});

test("completes claim quote payment order and public status workflow", async () => {
  await withApp(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    const inquiryId = created.body.id;
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };

    const claimed = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiryId}/claim`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ operator: "客服A" })
    });
    assert.equal(claimed.response.status, 200);
    assert.equal(claimed.body.slaStatus, "on_time");

    const quote = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiryId}/quotes`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true, operator: "客服A" })
    });
    assert.equal(quote.body.version, 1);

    const paid = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiryId}/payment-confirmation`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ operator: "财务A" })
    });
    assert.equal(paid.response.status, 201);
    assert.match(paid.body.orderNumber, /^WL-20260829-\d{4}$/);

    const orders = await jsonRequest(`${baseUrl}/api/admin/orders`, { headers: adminHeaders });
    assert.equal(orders.response.status, 200);
    assert.equal(orders.body[0].orderNumber, paid.body.orderNumber);
    assert.equal(orders.body[0].phone, "13812345678");

    await jsonRequest(`${baseUrl}/api/admin/orders/${paid.body.id}/events`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ status: "production", title: "已进入生产", operator: "客服A" })
    });

    const status = await jsonRequest(`${baseUrl}/api/order-status?orderNumber=${paid.body.orderNumber}&phone=13812345678`);
    assert.equal(status.response.status, 200);
    assert.equal(status.body.status, "production");
    assert.equal(status.body.totalAmount, undefined);
    assert.equal(status.body.internalNote, undefined);
    assert.equal(status.body.events.at(-1).title, "已进入生产");
  });
});

test("creates one immutable receipt snapshot for a confirmed payment", async () => {
  await withApp(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/quotes`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true })
    });
    const order = await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/payment-confirmation`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ paymentMethod: "银行转账", payerName: "王先生", receivedAt: "2026-08-29T01:30:00.000Z" })
    });
    const orders = await jsonRequest(`${baseUrl}/api/admin/orders`, { headers: adminHeaders });
    assert.equal(typeof orders.body[0].paymentId, "number");

    const first = await jsonRequest(`${baseUrl}/api/admin/payments/${orders.body[0].paymentId}/receipt`, {
      method: "POST",
      headers: adminHeaders,
      body: "{}"
    });
    assert.equal(first.response.status, 201);
    assert.match(first.body.receiptNumber, /^SJ-20260829-\d{4}$/);
    assert.equal(first.body.companyName, "宁波未来机械制造有限公司");
    assert.equal(first.body.orderNumber, order.body.orderNumber);
    assert.equal(first.body.payerName, "王先生");
    assert.equal(first.body.amount, 2800);
    assert.equal(first.body.paymentMethod, "银行转账");
    assert.equal(first.body.receivedAt, "2026-08-29T01:30:00.000Z");
    assert.equal(first.body.purpose, "非标钣金加工款");
    assert.equal(first.body.status, "active");

    const repeated = await jsonRequest(`${baseUrl}/api/admin/payments/${orders.body[0].paymentId}/receipt`, {
      method: "POST",
      headers: adminHeaders,
      body: "{}"
    });
    assert.equal(repeated.response.status, 200);
    assert.deepEqual(repeated.body, first.body);
  });
});

test("lets a mock WeChat customer bind a phone and see only that phone's history", async () => {
  await withApp(async (baseUrl) => {
    const first = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    const foreign = inquiryPayload();
    foreign.phone = "13912345678";
    foreign.description = "另一位客户的需求";
    await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(foreign)
    });

    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "mock:wx-customer-a", contactName: "王先生" })
    });
    assert.equal(login.response.status, 201);
    const headers = customerHeaders(login.body.sessionToken);
    const binding = await jsonRequest(`${baseUrl}/api/customer/phone-binding`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" })
    });
    assert.equal(binding.response.status, 200);

    const mine = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { headers });
    assert.equal(mine.response.status, 200);
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].id, first.body.id);

    const denied = await jsonRequest(`${baseUrl}/api/customer/inquiries/2`, { headers });
    assert.equal(denied.response.status, 404);
  });
});

test("supports customer drafts, material supplements, change records and idempotent notifications", async () => {
  const notifications = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-site-notify-"));
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    adminToken: "test-token",
    enableWechatMock: true,
    enablePhoneMock: true,
    notify: (job) => notifications.push(job),
    now: () => new Date("2026-08-29T02:00:00.000Z")
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "mock:wx-draft" })
    });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    await jsonRequest(`${baseUrl}/api/customer/subscriptions`, { method: "POST", headers, body: JSON.stringify({ enabled: true }) });
    const draft = await jsonRequest(`${baseUrl}/api/customer/inquiries`, {
      method: "POST",
      headers,
      body: JSON.stringify({ drawingMode: "none", description: "待补充尺寸", state: "draft" })
    });
    assert.equal(draft.response.status, 201);
    assert.equal(draft.body.state, "draft");

    const supplement = await jsonRequest(`${baseUrl}/api/customer/inquiries/${draft.body.id}/supplements`, {
      method: "POST",
      headers,
      body: JSON.stringify({ material: "304不锈钢", dimensions: "800x500mm", note: "补充折弯图" })
    });
    assert.equal(supplement.response.status, 201);
    assert.equal(supplement.body.state, "submitted");

    const detail = await jsonRequest(`${baseUrl}/api/customer/inquiries/${draft.body.id}`, { headers });
    assert.equal(detail.body.changeRecords.length, 2);
    assert.equal(notifications.length, 1);

    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    const jobs = await jsonRequest(`${baseUrl}/api/admin/notification-jobs`, { headers: adminHeaders });
    assert.equal(jobs.body.length, 1);
    assert.equal(jobs.body[0].status, "sent");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps failed notifications retryable, exposes admin todo, and forbids unpaid production", async () => {
  let attempts = 0;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-site-retry-"));
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    adminToken: "test-token",
    enableWechatMock: true,
    enablePhoneMock: true,
    notify: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary provider error");
    },
    now: () => new Date("2026-08-29T02:00:00.000Z")
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:wx-retry" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    await jsonRequest(`${baseUrl}/api/customer/subscriptions`, { method: "POST", headers, body: JSON.stringify({ enabled: true }) });
    const created = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { method: "POST", headers, body: JSON.stringify({ ...inquiryPayload(), state: "submitted" }) });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    const todos = await jsonRequest(`${baseUrl}/api/admin/todos`, { headers: adminHeaders });
    assert.equal(todos.body[0].type, "notification_failed");
    const jobs = await jsonRequest(`${baseUrl}/api/admin/notification-jobs`, { headers: adminHeaders });
    const retry = await jsonRequest(`${baseUrl}/api/admin/notification-jobs/${jobs.body[0].id}/retry`, { method: "POST", headers: adminHeaders, body: "{}" });
    assert.equal(retry.body.status, "sent");

    const blocked = await jsonRequest(`${baseUrl}/api/admin/orders/999/events`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ status: "production", title: "生产中" }) });
    assert.equal(blocked.response.status, 404);
    const dictionary = await jsonRequest(`${baseUrl}/api/status-dictionary`);
    assert.equal(dictionary.body.paymentRule.productionRequiresConfirmedPayment, true);
    const bobo = await jsonRequest(`${baseUrl}/api/integrations/bobo/health`);
    assert.deepEqual(bobo.body, { enabled: false, statusMapping: { production: "production", quality: "quality", ready: "ready", shipped: "shipped", completed: "completed" } });
    assert.ok(created.body.id);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("links a same-phone customer in admin and exposes their order list and detail", async () => {
  await withApp(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "mock:wx-order", contactName: "王先生" })
    });
    const customerHeadersValue = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers: customerHeadersValue, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    const linked = await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/customer`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ customerId: login.body.customer.id, operator: "客服A" })
    });
    assert.equal(linked.body.customerId, login.body.customer.id);
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/quotes`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true })
    });
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const orders = await jsonRequest(`${baseUrl}/api/customer/orders`, { headers: customerHeadersValue });
    assert.equal(orders.response.status, 200);
    assert.equal(orders.body.total, 1);
    assert.equal(typeof orders.body.items[0].id, "number");
    const detail = await jsonRequest(`${baseUrl}/api/customer/orders/${orders.body.items[0].id}`, { headers: customerHeadersValue });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.orderNumber.startsWith("WL-"), true);
  });
});

test("archives converted requirements and supports completed-order repurchase", async () => {
  await withApp(async (baseUrl, app) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "mock:repurchase-owner", contactName: "王先生" })
    });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, {
      method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" })
    });
    const inquiry = await jsonRequest(`${baseUrl}/api/customer/inquiries`, {
      method: "POST", headers, body: JSON.stringify({ ...inquiryPayload(), state: "submitted" })
    });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/quotes`, {
      method: "POST", headers: adminHeaders, body: JSON.stringify({
        amount: 2800,
        validUntil: "2026-09-05",
        confirmed: true,
        specification: { process: "激光切割+折弯", technicalRequirements: "去毛刺" }
      })
    });
    const order = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/payment-confirmation`, {
      method: "POST", headers: adminHeaders, body: "{}"
    });

    const requirementsAfterConversion = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { headers });
    assert.deepEqual(requirementsAfterConversion.body, []);
    const active = await jsonRequest(`${baseUrl}/api/customer/orders?scope=active&page=1&pageSize=20`, { headers });
    assert.equal(active.body.total, 1);
    assert.equal(active.body.items[0].summary, inquiryPayload().description);
    const premature = await jsonRequest(`${baseUrl}/api/customer/orders/${order.body.id}/repurchase-draft`, { headers });
    assert.equal(premature.response.status, 409);

    await jsonRequest(`${baseUrl}/api/admin/orders/${order.body.id}/events`, {
      method: "POST", headers: adminHeaders, body: JSON.stringify({ status: "completed", title: "已送货完成" })
    });
    app.database.prepare("UPDATE orders SET completed_at = '', created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(order.body.id);
    app.database.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, 'late.pdf', 'late.pdf', 8, ?)")
      .run(inquiry.body.id, "2026-08-29T02:00:00.000Z");
    const history = await jsonRequest(`${baseUrl}/api/customer/orders?scope=history&keyword=${encodeURIComponent(order.body.orderNumber)}&startDate=2026-08-29&endDate=2026-08-29&page=1&pageSize=20`, { headers });
    assert.equal(history.body.total, 1);
    assert.equal(history.body.items[0].completedAt, "2026-08-29T02:00:00.000Z");

    const draft = await jsonRequest(`${baseUrl}/api/customer/orders/${order.body.id}/repurchase-draft`, { headers });
    assert.equal(draft.response.status, 200);
    assert.equal(draft.body.form.material, "304不锈钢");
    assert.equal(draft.body.form.process, "激光切割+折弯");
    assert.equal(draft.body.form.technicalRequirements, "去毛刺");
    assert.equal(draft.body.form.expectedDate, "");
    assert.equal(draft.body.originalAttachments[0].name, "现场.jpg");
    assert.equal(draft.body.originalAttachments.length, 1);

    const repurchase = await jsonRequest(`${baseUrl}/api/customer/orders/${order.body.id}/repurchase`, {
      method: "POST", headers, body: JSON.stringify({
        ...draft.body.form,
        material: "5052铝板",
        quantity: 5,
        expectedDate: "2026-09-30",
        reuseOriginalAttachments: true,
        attachments: []
      })
    });
    assert.equal(repurchase.response.status, 201);
    const requirements = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { headers });
    assert.equal(requirements.body.length, 1);
    assert.equal(requirements.body[0].material, "5052铝板");
    assert.equal(requirements.body[0].quantity, 5);
    assert.equal(requirements.body[0].process, "激光切割+折弯");
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM attachments WHERE inquiry_id = ?").get(repurchase.body.id).count, 1);

    const withoutOriginals = await jsonRequest(`${baseUrl}/api/customer/orders/${order.body.id}/repurchase`, {
      method: "POST", headers, body: JSON.stringify({
        ...draft.body.form,
        expectedDate: "2026-10-01",
        reuseOriginalAttachments: false,
        attachments: []
      })
    });
    assert.equal(withoutOriginals.response.status, 201);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM attachments WHERE inquiry_id = ?").get(withoutOriginals.body.id).count, 0);

    const boundary = "repurchase-upload-boundary";
    const upload = await jsonRequest(`${baseUrl}/api/wechat/uploads`, {
      method: "POST",
      headers: { authorization: headers.authorization, "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="change.pdf"\r\nContent-Type: application/pdf\r\n\r\nPDF DATA\r\n--${boundary}--\r\n`)
    });
    const withAdditional = await jsonRequest(`${baseUrl}/api/customer/orders/${order.body.id}/repurchase`, {
      method: "POST", headers, body: JSON.stringify({
        ...draft.body.form,
        expectedDate: "2026-10-02",
        reuseOriginalAttachments: true,
        attachments: [{ id: upload.body.id, name: upload.body.name, size: upload.body.size }]
      })
    });
    assert.equal(withAdditional.response.status, 201);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM attachments WHERE inquiry_id = ?").get(withAdditional.body.id).count, 2);

    const otherLogin = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:repurchase-other" })
    });
    const otherHeaders = customerHeaders(otherLogin.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, {
      method: "POST", headers: otherHeaders, body: JSON.stringify({ phone: "13912345678", verificationProof: "mock:13912345678" })
    });
    const denied = await jsonRequest(`${baseUrl}/api/customer/orders/${order.body.id}/repurchase-draft`, { headers: otherHeaders });
    assert.equal(denied.response.status, 404);
  });
});

test("stages a bound customer's upload and associates it with their submitted inquiry", async () => {
  await withApp(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:wx-upload" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const boundary = "future-upload-boundary";
    const upload = await jsonRequest(`${baseUrl}/api/wechat/uploads`, {
      method: "POST",
      headers: { authorization: headers.authorization, "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.dxf"\r\nContent-Type: application/octet-stream\r\n\r\nDXF DATA\r\n--${boundary}--\r\n`)
    });
    assert.equal(upload.response.status, 201);
    assert.equal(upload.body.name, "cover.dxf");
    const created = await jsonRequest(`${baseUrl}/api/customer/inquiries`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...inquiryPayload(), state: "submitted", attachments: [upload.body] })
    });
    assert.equal(created.response.status, 201);
    const detail = await jsonRequest(`${baseUrl}/api/customer/inquiries/${created.body.id}`, { headers });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.changeRecords[0].action, "submitted");
  });
});

test("rejects another customer using a staged attachment without creating an inquiry", async () => {
  await withApp(async (baseUrl) => {
    const firstLogin = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:wx-upload-owner" }) });
    const firstHeaders = customerHeaders(firstLogin.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers: firstHeaders, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const boundary = "foreign-upload-boundary";
    const upload = await jsonRequest(`${baseUrl}/api/wechat/uploads`, {
      method: "POST",
      headers: { authorization: firstHeaders.authorization, "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.dxf"\r\n\r\nDXF DATA\r\n--${boundary}--\r\n`)
    });
    const secondLogin = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:wx-upload-other" }) });
    const secondHeaders = customerHeaders(secondLogin.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers: secondHeaders, body: JSON.stringify({ phone: "13912345678", verificationProof: "mock:13912345678" }) });
    const attempted = await jsonRequest(`${baseUrl}/api/customer/inquiries`, {
      method: "POST",
      headers: secondHeaders,
      body: JSON.stringify({ ...inquiryPayload(), phone: "13912345678", attachments: [upload.body], state: "submitted" })
    });
    assert.equal(attempted.response.status, 422);
    const secondInquiries = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { headers: secondHeaders });
    assert.equal(secondInquiries.body.length, 0);
  });
});

test("rejects public order events with control characters in their title", async () => {
  await withApp(async (baseUrl) => {
    const created = await jsonRequest(`${baseUrl}/api/inquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inquiryPayload()) });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/quotes`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true }) });
    const paid = await jsonRequest(`${baseUrl}/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const unsafe = await jsonRequest(`${baseUrl}/api/admin/orders/${paid.body.id}/events`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ status: "production", title: "<img src=x onerror=alert(1)>\n生产中" })
    });
    assert.equal(unsafe.response.status, 422);
    assert.equal(unsafe.body.message, "公开说明不能包含控制字符");
  });
});

function encodedAttachment(name, bytes, declaredSize = bytes.length) {
  return { name, size: declaredSize, content: bytes.toString("base64") };
}

test("accepts two 20MiB public attachments at the decoded 40MiB total limit", async () => {
  await withApp(async (baseUrl) => {
    const bytes = Buffer.alloc(20 * 1024 * 1024, 7);
    const payload = inquiryPayload();
    payload.attachments = [encodedAttachment("one.pdf", bytes), encodedAttachment("two.pdf", bytes)];
    const result = await jsonRequest(`${baseUrl}/api/inquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(result.response.status, 201);
  });
});

test("rejects a public attachment whose decoded bytes exceed 20MiB despite a forged size", async () => {
  await withApp(async (baseUrl) => {
    const payload = inquiryPayload();
    payload.attachments = [encodedAttachment("oversize.pdf", Buffer.alloc(20 * 1024 * 1024 + 1, 1), 1)];
    const result = await jsonRequest(`${baseUrl}/api/inquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.message, "单个附件不能超过20MB");
  });
});

test("rejects more than five public attachments", async () => {
  await withApp(async (baseUrl) => {
    const payload = inquiryPayload();
    payload.attachments = ["one.pdf", "two.pdf", "three.pdf", "four.pdf", "five.pdf", "six.pdf"].map((name) => encodedAttachment(name, Buffer.from("test")));
    const result = await jsonRequest(`${baseUrl}/api/inquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.message, "附件最多5个");
  });
});

test("rejects public attachments whose decoded total exceeds 40MiB", async () => {
  await withApp(async (baseUrl) => {
    const payload = inquiryPayload();
    payload.attachments = [
      encodedAttachment("one.pdf", Buffer.alloc(20 * 1024 * 1024, 1)),
      encodedAttachment("two.pdf", Buffer.alloc(20 * 1024 * 1024, 2)),
      encodedAttachment("three.pdf", Buffer.alloc(1, 3))
    ];
    const result = await jsonRequest(`${baseUrl}/api/inquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.message, "附件总大小不能超过40MB");
  });
});

test("keeps customer projections private and forces public inquiries to web source", async () => {
  await withApp(async (baseUrl) => {
    const payload = { ...inquiryPayload(), source: "admin" };
    const created = await jsonRequest(`${baseUrl}/api/inquiries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:privacy" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: payload.phone, verificationProof: `mock:${payload.phone}` }) });
    const mine = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { headers });
    assert.equal(mine.body[0].source, "web");
    assert.equal(mine.body[0].customerId, undefined);
    assert.equal(mine.body[0].claimedBy, undefined);
    assert.equal(mine.body[0].slaStatus, undefined);
    assert.equal(mine.body[0].id, created.body.id);
  });
});

test("turns post-quote requirement edits into a change request and invalidates payment", async () => {
  await withApp(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:change" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const inquiry = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { method: "POST", headers, body: JSON.stringify({ ...inquiryPayload(), state: "submitted" }) });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/quotes`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true }) });
    const change = await jsonRequest(`${baseUrl}/api/customer/inquiries/${inquiry.body.id}/supplements`, { method: "POST", headers, body: JSON.stringify({ material: "铝板", note: "改用铝板" }) });
    assert.equal(change.response.status, 202);
    assert.equal(change.body.changeRequested, true);
    const detail = await jsonRequest(`${baseUrl}/api/customer/inquiries/${inquiry.body.id}`, { headers });
    assert.equal(detail.body.material, "304不锈钢");
    assert.match(detail.body.changeRecords.at(-1).detail, /before.*304不锈钢.*after.*铝板/);
    const payment = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/payment-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    assert.equal(payment.response.status, 409);
  });
});

test("sends each order status notification once", async () => {
  const delivered = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-status-notify-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), adminToken: "test-token", enableWechatMock: true, enablePhoneMock: true, notify: (job) => delivered.push(job), now: () => new Date("2026-08-29T02:00:00.000Z") });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:events" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    await jsonRequest(`${baseUrl}/api/customer/subscriptions`, { method: "POST", headers, body: JSON.stringify({ enabled: true }) });
    const inquiry = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { method: "POST", headers, body: JSON.stringify({ ...inquiryPayload(), state: "submitted" }) });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/quotes`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true }) });
    const order = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/payment-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    for (const status of ["production", "quality", "ready", "completed"]) {
      await jsonRequest(`${baseUrl}/api/admin/orders/${order.body.id}/events`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ status, title: status }) });
    }
    assert.deepEqual(delivered.filter((job) => job.eventType === "order_status_changed").map((job) => job.payload.status), ["production", "quality", "ready", "completed"]);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("uses one subscription credit to send one WeChat order status message", async () => {
  const templateId = "tppDS_ZBA9nKXerDEzEVdd7dRHRH85W7QX4eL_U3zTA";
  const providerCalls = [];
  const fetchImpl = async (url, options = {}) => {
    providerCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes("/cgi-bin/token")) return { ok: true, json: async () => ({ access_token: "token", expires_in: 7200 }) };
    if (String(url).includes("/wxaapi/newtmpl/gettemplate")) return { ok: true, json: async () => ({ data: [{ priTmplId: templateId, content: "订单号{{character_string1.DATA}}\n订单状态{{phrase2.DATA}}\n更新时间{{time3.DATA}}\n备注{{thing4.DATA}}" }] }) };
    if (String(url).includes("/cgi-bin/message/subscribe/send")) return { ok: true, json: async () => ({ errcode: 0, errmsg: "ok" }) };
    throw new Error(`unexpected provider URL: ${url}`);
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-wechat-subscription-"));
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"),
    adminToken: "test-token", enableWechatMock: true, enablePhoneMock: true,
    wechatAppId: "wx-test", wechatAppSecret: "secret", wechatSubscriptionTemplateId: templateId,
    wechatMiniprogramState: "trial", fetch: fetchImpl,
    now: () => new Date("2026-08-29T02:00:00.000Z")
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:order-subscriber" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const inquiry = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { method: "POST", headers, body: JSON.stringify({ ...inquiryPayload(), state: "submitted" }) });
    const adminHeaders = { authorization: "Bearer test-token", "content-type": "application/json" };
    await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/quotes`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ amount: 2800, validUntil: "2026-09-05", confirmed: true }) });
    const order = await jsonRequest(`${baseUrl}/api/admin/inquiries/${inquiry.body.id}/payment-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const subscription = await jsonRequest(`${baseUrl}/api/customer/subscriptions`, { method: "POST", headers, body: JSON.stringify({ types: [templateId] }) });
    assert.deepEqual(subscription.body, { enabled: true, availableCount: 1 });

    await jsonRequest(`${baseUrl}/api/admin/orders/${order.body.id}/events`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ status: "production", title: "开始生产" }) });
    await jsonRequest(`${baseUrl}/api/admin/orders/${order.body.id}/events`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ status: "quality", title: "进入质检" }) });

    const sendCalls = providerCalls.filter((item) => item.url.includes("/cgi-bin/message/subscribe/send"));
    assert.equal(sendCalls.length, 1);
    assert.deepEqual(sendCalls[0].body, {
      touser: "order-subscriber", template_id: templateId,
      page: `/pages/order-detail/index?id=${order.body.id}`, miniprogram_state: "trial", lang: "zh_CN",
      data: {
        character_string1: { value: order.body.orderNumber }, phrase2: { value: "生产中" },
        time3: { value: "2026-08-29 10:00" }, thing4: { value: "开始生产" }
      }
    });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("updates and submits an existing customer draft without duplicating it", async () => {
  await withApp(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:draft-update" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const draft = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { method: "POST", headers, body: JSON.stringify({ drawingMode: "none", description: "草稿", state: "draft" }) });
    const submitted = await jsonRequest(`${baseUrl}/api/customer/inquiries/${draft.body.id}`, { method: "POST", headers, body: JSON.stringify({ ...inquiryPayload(), state: "submitted" }) });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.body.id, draft.body.id);
    assert.equal(submitted.body.state, "submitted");
    const mine = await jsonRequest(`${baseUrl}/api/customer/inquiries`, { headers });
    assert.equal(mine.body.length, 1);
  });
});

test("accepts a WeChat multipart upload when form fields precede the file", async () => {
  await withApp(async (baseUrl) => {
    const login = await jsonRequest(`${baseUrl}/api/auth/wechat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "mock:multipart" }) });
    const headers = customerHeaders(login.body.sessionToken);
    await jsonRequest(`${baseUrl}/api/customer/phone-binding`, { method: "POST", headers, body: JSON.stringify({ phone: "13812345678", verificationProof: "mock:13812345678" }) });
    const boundary = "wechat-formdata-first";
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\ndrawing\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="part.step"\r\nContent-Type: application/octet-stream\r\n\r\nSTEP DATA\r\n--${boundary}--\r\n`);
    const upload = await jsonRequest(`${baseUrl}/api/wechat/uploads`, { method: "POST", headers: { authorization: headers.authorization, "content-type": `multipart/form-data; boundary=${boundary}` }, body });
    assert.equal(upload.response.status, 201);
    assert.equal(upload.body.name, "part.step");
    assert.equal(upload.body.size, 9);
  });
});
