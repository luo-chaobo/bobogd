const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApplication } = require("../src/server");

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const type = response.headers.get("content-type") || "";
  return { status: response.status, headers: response.headers, body: type.includes("application/json") ? await response.json() : await response.text() };
}

async function withApp(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-operations-"));
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    adminToken: "admin-token",
    now: () => new Date("2026-09-13T08:00:00.000Z")
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${app.server.address().port}`, app, directory);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const adminHeaders = { authorization: "Bearer admin-token", "content-type": "application/json" };

async function createQuotedInquiry(baseUrl, paymentMode = "deposit") {
  const inquiry = await request(baseUrl, "/api/inquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      drawingMode: "none",
      contactName: "王先生",
      phone: "13812345678",
      region: "宁波北仑",
      address: "大碶街道沿山河北路88号",
      quantity: 2,
      expectedDate: "2026-10-01",
      description: "制作设备防护罩",
      material: "304不锈钢",
      dimensions: "800×500×300 mm"
    })
  });
  assert.equal(inquiry.status, 201);
  const quote = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/quotes`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ amount: 10000, validUntil: "2026-10-01", confirmed: true, paymentMode, startAmount: paymentMode === "deposit" ? 3000 : 10000 })
  });
  assert.equal(quote.status, 201);
  return inquiry.body.id;
}

test("creates one unpaid order from a confirmed quote and freezes inquiry details", async () => {
  await withApp(async (baseUrl, app) => {
    const inquiryId = await createQuotedInquiry(baseUrl);
    const created = await request(baseUrl, `/api/admin/inquiries/${inquiryId}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "awaiting_payment");
    assert.equal(created.body.paymentStatus, "unpaid");
    assert.equal((await request(baseUrl, `/api/admin/inquiries/${inquiryId}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" })).status, 409);

    const detail = await request(baseUrl, `/api/admin/orders/${created.body.id}` , { headers: adminHeaders });
    assert.equal(detail.body.inquiryNumber, `XQ-20260913-0001`);
    assert.equal(detail.body.address, "大碶街道沿山河北路88号");
    assert.equal(detail.body.requirement.description, "制作设备防护罩");
    assert.equal(detail.body.payment.mode, "deposit");
    assert.equal(detail.body.payment.startAmount, 3000);
    assert.equal(detail.body.payment.verifiedAmount, 0);
    assert.equal(detail.body.actions.canSchedule, false);

    app.database.prepare("INSERT INTO audit_logs (operator, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("其他操作员", "unrelated_payment", "payment", created.body.id, "另一订单的收款日志", "2026-09-13T08:00:00.000Z");
    const refreshed = await request(baseUrl, `/api/admin/orders/${created.body.id}`, { headers: adminHeaders });
    assert.equal(refreshed.body.audit.some((item) => item.action === "unrelated_payment"), false);

    const active = await request(baseUrl, "/api/admin/inquiries?view=active", { headers: adminHeaders });
    assert.equal(active.body.length, 0);
    const customers = await request(baseUrl, "/api/admin/customers", { headers: adminHeaders });
    assert.deepEqual(customers.body.map((item) => item.phone), ["13812345678"]);
    assert.equal(customers.body[0].inquiryCount, 1);
    assert.equal(customers.body[0].orderCount, 1);
  });
});

test("uses the same queue predicates for dashboard counts and filtered lists", async () => {
  await withApp(async (baseUrl, app) => {
    const firstInquiry = await createQuotedInquiry(baseUrl);
    const firstOrder = await request(baseUrl, `/api/admin/inquiries/${firstInquiry}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const secondInquiry = await request(baseUrl, "/api/inquiries", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ drawingMode: "none", contactName: "李女士", phone: "13900000002", region: "宁波", quantity: 1, expectedDate: "2026-10-02", description: "机箱" })
    });
    assert.equal(secondInquiry.status, 201);

    const dashboard = await request(baseUrl, "/api/admin/dashboard", { headers: adminHeaders });
    const unclaimed = await request(baseUrl, "/api/admin/inquiries?queue=unclaimed", { headers: adminHeaders });
    const awaitingPayment = await request(baseUrl, "/api/admin/orders?queue=awaiting_payment", { headers: adminHeaders });
    assert.equal(dashboard.body.unclaimedInquiries, unclaimed.body.length);
    assert.equal(dashboard.body.ordersAwaitingPayment, awaitingPayment.body.length);
    assert.deepEqual(awaitingPayment.body.map((item) => item.id), [firstOrder.body.id]);
    assert.ok(Array.isArray(dashboard.body.priorityTasks));

    app.database.prepare("INSERT INTO bobo_sync_jobs (order_id, status, last_error, next_attempt_at, created_at, updated_at) VALUES (?, 'retrying', '波波暂时离线', ?, ?, ?)")
      .run(firstOrder.body.id, "2026-09-13T08:05:00.000Z", "2026-09-13T08:00:00.000Z", "2026-09-13T08:00:00.000Z");
    const refreshedDashboard = await request(baseUrl, "/api/admin/dashboard", { headers: adminHeaders });
    const boboTodos = await request(baseUrl, "/api/admin/todos?type=bobo_sync", { headers: adminHeaders });
    assert.equal(refreshedDashboard.body.boboSyncErrors, 1);
    assert.equal(refreshedDashboard.body.boboSyncErrors, boboTodos.body.length);
    assert.equal(boboTodos.body[0].entityId, firstOrder.body.id);
  });
});

test("separates completed history by completion date and exposes customer correspondence", async () => {
  await withApp(async (baseUrl, app) => {
    const inquiryId = await createQuotedInquiry(baseUrl, "full");
    const created = await request(baseUrl, `/api/admin/inquiries/${inquiryId}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    app.database.prepare("UPDATE orders SET status = 'completed', completed_at = ? WHERE id = ?").run("2026-09-13T06:30:00.000Z", created.body.id);

    const active = await request(baseUrl, "/api/admin/orders", { headers: adminHeaders });
    const history = await request(baseUrl, "/api/admin/orders?view=completed&from=2026-09-13&to=2026-09-13", { headers: adminHeaders });
    assert.equal(active.body.length, 0);
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].completedAt, "2026-09-13T06:30:00.000Z");
    assert.match(history.body[0].requirementSummary, /设备防护罩/);

    const customer = await request(baseUrl, "/api/admin/customers/detail?phone=13812345678", { headers: adminHeaders });
    assert.equal(customer.status, 200);
    assert.equal(customer.body.summary.inquiryCount, 1);
    assert.equal(customer.body.summary.activeOrderCount, 0);
    assert.equal(customer.body.summary.historyOrderCount, 1);
    assert.equal(customer.body.historyOrders[0].orderNumber, created.body.orderNumber);
    assert.equal(customer.body.customer.address, "大碶街道沿山河北路88号");
  });
});

test("stores an editable requirement snapshot on each quote version", async () => {
  await withApp(async (baseUrl) => {
    const inquiry = await request(baseUrl, "/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drawingMode: "none", contactName: "陈先生", phone: "13800000001", region: "宁波", quantity: 4, expectedDate: "2026-10-15", description: "机架外壳", material: "Q235B", dimensions: "600×400×300 mm" })
    });
    const specification = { requirement: "技".repeat(600), material: "SECC", thickness: "1.5 mm", dimensions: "600×400×300 mm", process: "激光、折弯、喷塑", quantity: 4, expectedDate: "2026-10-15", technicalRequirements: "RAL7035，无毛刺", remark: "含独立包装" };
    const invalid = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/quotes`, {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ amount: 4800, validUntil: "2026-09-30", confirmed: true, paymentMode: "full", startAmount: 4800, specification: { ...specification, quantity: 0 } })
    });
    assert.equal(invalid.status, 422);
    const missingProcess = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/quotes`, {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ amount: 4800, validUntil: "2026-09-30", confirmed: true, paymentMode: "full", startAmount: 4800, specification: { ...specification, process: "" } })
    });
    assert.equal(missingProcess.status, 422);
    assert.equal(missingProcess.body.message, "请至少选择一个加工工序");
    const first = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/quotes`, {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ amount: 4800, validUntil: "2026-09-30", confirmed: true, paymentMode: "full", startAmount: 4800, specification })
    });
    assert.equal(first.status, 201);
    assert.deepEqual(first.body.specification, specification);

    const secondSpecification = { ...specification, thickness: "2.0 mm", remark: "第二版" };
    await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/quotes`, {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ amount: 5200, validUntil: "2026-10-02", confirmed: true, paymentMode: "full", startAmount: 5200, specification: secondSpecification })
    });
    const detail = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}`, { headers: adminHeaders });
    assert.equal(detail.body.quotes[0].version, 2);
    assert.equal(detail.body.quotes[0].specification.thickness, "2.0 mm");
    assert.equal(detail.body.quotes[1].specification.thickness, "1.5 mm");
    assert.equal(detail.body.quotes[1].specification.material, "SECC");
    const order = await request(baseUrl, `/api/admin/inquiries/${inquiry.body.id}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const orderDetail = await request(baseUrl, `/api/admin/orders/${order.body.id}`, { headers: adminHeaders });
    assert.equal(orderDetail.body.requirement.material, "SECC");
    assert.equal(orderDetail.body.requirement.thickness, "2.0 mm");
    assert.equal(orderDetail.body.requirement.process, "激光、折弯、喷塑");
  });
});

test("counts only verified receipts, auto-queues bobo at the deposit and blocks shipping before full payment", async () => {
  await withApp(async (baseUrl, app) => {
    const inquiryId = await createQuotedInquiry(baseUrl);
    const order = await request(baseUrl, `/api/admin/inquiries/${inquiryId}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const first = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 3000, paymentMethod: "银行转账", receivedAt: "2026-09-13T07:30:00.000Z", payerName: "王先生" })
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.status, "pending");
    assert.equal((await request(baseUrl, `/api/admin/orders/${order.body.id}`, { headers: adminHeaders })).body.payment.verifiedAmount, 0);
    assert.equal((await request(baseUrl, `/api/admin/orders/${order.body.id}/bobo-confirm`, { method: "POST", headers: adminHeaders, body: "{}" })).status, 409);

    const verified = await request(baseUrl, `/api/admin/payments/${first.body.id}/verify`, { method: "POST", headers: adminHeaders, body: "{}" });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.orderStatus, "awaiting_schedule");
    assert.equal(verified.body.paymentStatus, "partial_paid");
    assert.equal(verified.body.boboSyncStatus, "pending");
    assert.equal(verified.body.boboAutoSubmitted, true);
    assert.equal(app.database.prepare("SELECT status FROM bobo_sync_jobs WHERE order_id = ?").get(order.body.id).status, "pending");

    const shippingBlocked = await request(baseUrl, `/api/admin/orders/${order.body.id}/events`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ status: "shipped", title: "已发货", reason: "人工确认物流" })
    });
    assert.equal(shippingBlocked.status, 409);

    const balance = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 7000, paymentMethod: "银行转账", receivedAt: "2026-09-13T08:00:00.000Z", payerName: "王先生" })
    });
    const balanceVerified = await request(baseUrl, `/api/admin/payments/${balance.body.id}/verify`, { method: "POST", headers: adminHeaders, body: "{}" });
    assert.equal(balanceVerified.body.boboAutoSubmitted, false);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM bobo_sync_jobs WHERE order_id = ?").get(order.body.id).count, 1);
    const shipped = await request(baseUrl, `/api/admin/orders/${order.body.id}/events`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ status: "shipped", title: "已发货", reason: "尾款已结清" })
    });
    assert.equal(shipped.status, 201);
    assert.equal(app.database.prepare("SELECT payment_status FROM orders WHERE id = ?").get(order.body.id).payment_status, "paid");
  });
});

test("requires reasons for rejected or voided receipts and keeps their audit history", async () => {
  await withApp(async (baseUrl, app) => {
    const inquiryId = await createQuotedInquiry(baseUrl, "full");
    const order = await request(baseUrl, `/api/admin/inquiries/${inquiryId}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const payment = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ amount: 10000, paymentMethod: "微信", payerName: "王先生" }) });
    assert.equal((await request(baseUrl, `/api/admin/payments/${payment.body.id}/reject`, { method: "POST", headers: adminHeaders, body: "{}" })).status, 422);
    assert.equal((await request(baseUrl, `/api/admin/payments/${payment.body.id}/reject`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ reason: "金额截图不清晰" }) })).status, 200);

    const replacement = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ amount: 10000, paymentMethod: "银行转账", payerName: "王先生" }) });
    await request(baseUrl, `/api/admin/payments/${replacement.body.id}/verify`, { method: "POST", headers: adminHeaders, body: "{}" });
    assert.equal((await request(baseUrl, `/api/admin/payments/${replacement.body.id}/void`, { method: "POST", headers: adminHeaders, body: "{}" })).status, 422);
    assert.equal((await request(baseUrl, `/api/admin/payments/${replacement.body.id}/void`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ reason: "重复登记" }) })).status, 200);
    assert.deepEqual(app.database.prepare("SELECT action FROM audit_logs WHERE entity_type = 'payment' ORDER BY id").all().map((row) => row.action), [
      "register_payment", "reject_payment", "register_payment", "verify_payment", "void_payment"
    ]);
  });
});

test("previews supported attachments inline while downloads remain attachments", async () => {
  await withApp(async (baseUrl, app, directory) => {
    const inquiryId = await createQuotedInquiry(baseUrl);
    const fixtures = [
      ["drawing.png", "drawing-png", "image/png"],
      ["drawing.pdf", "%PDF-1.4", "application/pdf"],
      ["drawing.dxf", "0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF", "text/plain"],
      ["drawing.step", "ISO-10303-21", null]
    ];
    for (const [name, content] of fixtures) {
      const storedName = `fixture-${name}`;
      fs.writeFileSync(path.join(directory, "uploads", storedName), content);
      app.database.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(inquiryId, name, storedName, Buffer.byteLength(content), "2026-09-13T08:00:00.000Z");
    }

    const detail = await request(baseUrl, `/api/admin/inquiries/${inquiryId}`, { headers: adminHeaders });
    const [png, pdf, dxf, step] = detail.body.attachments;
    assert.equal((await request(baseUrl, `/api/admin/attachments/${png.id}/preview`)).status, 401);

    for (const [file, expectedType] of [[png, "image/png"], [pdf, "application/pdf"], [dxf, "text/plain"]]) {
      const preview = await request(baseUrl, `/api/admin/attachments/${file.id}/preview`, { headers: adminHeaders });
      assert.equal(preview.status, 200);
      assert.match(preview.headers.get("content-type"), new RegExp(expectedType));
      assert.match(preview.headers.get("content-disposition"), /^inline;/);
    }

    const unsupported = await request(baseUrl, `/api/admin/attachments/${step.id}/preview`, { headers: adminHeaders });
    assert.equal(unsupported.status, 415);
    assert.equal(unsupported.body.message, "该附件格式暂不支持在线预览");

    const download = await request(baseUrl, `/api/admin/attachments/${png.id}/download`, { headers: adminHeaders });
    assert.match(download.headers.get("content-disposition"), /^attachment;/);
  });
});

test("previews payment proof inline while preserving the authenticated download", async () => {
  await withApp(async (baseUrl) => {
    const inquiryId = await createQuotedInquiry(baseUrl);
    const order = await request(baseUrl, `/api/admin/inquiries/${inquiryId}/order-confirmation`, { method: "POST", headers: adminHeaders, body: "{}" });
    const proofContent = Buffer.from("payment-proof-image").toString("base64");
    const payment = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 3000, paymentMethod: "微信", payerName: "王先生", proof: { name: "付款截图.png", content: proofContent } })
    });
    assert.equal(payment.status, 201);

    const list = await request(baseUrl, "/api/admin/payments", { headers: adminHeaders });
    const listed = list.body.find((item) => item.id === payment.body.id);
    assert.equal(listed.proofPreviewUrl, `/api/admin/payments/${payment.body.id}/proof/preview`);
    assert.equal(listed.proofUrl, `/api/admin/payments/${payment.body.id}/proof`);
    const detail = await request(baseUrl, `/api/admin/orders/${order.body.id}`, { headers: adminHeaders });
    assert.equal(detail.body.payments[0].proofPreviewUrl, listed.proofPreviewUrl);

    assert.equal((await request(baseUrl, listed.proofPreviewUrl)).status, 401);
    const preview = await request(baseUrl, listed.proofPreviewUrl, { headers: adminHeaders });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type"), /^image\/png/);
    assert.match(preview.headers.get("content-disposition"), /^inline;/);
    const download = await request(baseUrl, listed.proofUrl, { headers: adminHeaders });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /^attachment;/);

    const pdfPayment = await request(baseUrl, `/api/admin/orders/${order.body.id}/payments`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount: 1000, paymentMethod: "银行转账", payerName: "王先生", proof: { name: "银行回单.pdf", content: Buffer.from("%PDF-1.4").toString("base64") } })
    });
    const pdfPreview = await request(baseUrl, `/api/admin/payments/${pdfPayment.body.id}/proof/preview`, { headers: adminHeaders });
    assert.equal(pdfPreview.status, 200);
    assert.match(pdfPreview.headers.get("content-type"), /^application\/pdf/);
    assert.match(pdfPreview.headers.get("content-disposition"), /^inline;/);
  });
});
