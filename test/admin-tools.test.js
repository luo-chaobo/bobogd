const test = require("node:test");
const assert = require("node:assert/strict");

let tools = {};
try { tools = require("../public/admin-tools"); } catch {}

test("refresh controller uses 15 seconds and prevents overlapping refreshes", async () => {
  let scheduledDelay = 0;
  let scheduledTask;
  let finishRefresh;
  let calls = 0;
  const controller = tools.createRefreshController({
    refresh: () => { calls += 1; return new Promise((resolve) => { finishRefresh = resolve; }); },
    canRefresh: () => true,
    setIntervalFn: (task, delay) => { scheduledTask = task; scheduledDelay = delay; return 7; },
    clearIntervalFn: () => {}
  });

  controller.start();
  assert.equal(scheduledDelay, 15000);
  const first = scheduledTask();
  assert.equal(await controller.run(), false);
  assert.equal(calls, 1);
  finishRefresh();
  assert.equal(await first, true);
});

test("refresh controller skips hidden or busy states", async () => {
  let allowed = false;
  let calls = 0;
  const controller = tools.createRefreshController({ refresh: async () => { calls += 1; }, canRefresh: () => allowed });
  assert.equal(await controller.run(), false);
  allowed = true;
  assert.equal(await controller.run(), true);
  assert.equal(calls, 1);
});

test("synchronizes an order list row with the freshly loaded drawer detail", () => {
  const cells = Array.from({ length: 4 }, () => ({ textContent: "", replaceChildren(value) { this.value = value; } }));
  const badge = { textContent: "已送达" };
  assert.equal(tools.syncOrderRow({ cells }, { status: "completed", currentProcess: "工序已全部完成" }, () => badge), true);
  assert.equal(cells[2].value, badge);
  assert.equal(cells[3].textContent, "工序已全部完成");
  assert.equal(tools.syncOrderRow(null, {}, () => badge), false);
});

test("parses common ASCII DXF entities into preview primitives", () => {
  const drawing = tools.parseDxf(`0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n20\n21\n10\n0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n0\nCIRCLE\n10\n5\n20\n5\n40\n2\n0\nARC\n10\n8\n20\n8\n40\n3\n50\n0\n51\n90\n0\nENDSEC\n0\nEOF`);
  assert.deepEqual(drawing.entities.map((item) => item.type), ["line", "polyline", "circle", "arc"]);
  assert.equal(drawing.entities[1].closed, true);
  assert.deepEqual(drawing.entities[0], { type: "line", x1: 0, y1: 0, x2: 20, y2: 10 });
});

test("rejects binary or entity-free DXF previews", () => {
  assert.throws(() => tools.parseDxf("AutoCAD Binary DXF"), /不支持/);
  assert.throws(() => tools.parseDxf("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"), /没有可预览/);
});

test("draws both receipt headings at the canvas center and restores left alignment", () => {
  const calls = [];
  const context = {
    fillStyle: "", font: "", textAlign: "left",
    fillRect() {},
    fillText(text, x, y) { calls.push({ text, x, y, align: this.textAlign }); }
  };
  tools.drawReceipt(context, {
    companyName: "宁波未来机械制造有限公司", receiptNumber: "SJ-1", orderNumber: "WL-1",
    payerName: "客户", purpose: "加工款", paymentMethod: "银行转账", amountText: "¥1.00（人民币壹元整）",
    receivedAtText: "2026/09/14 10:00", verifiedBy: "管理员"
  });
  assert.deepEqual(calls.slice(0, 2).map(({ text, x, align }) => ({ text, x, align })), [
    { text: "宁波未来机械制造有限公司", x: 800, align: "center" },
    { text: "收 款 收 据", x: 800, align: "center" }
  ]);
  assert.equal(calls.find((item) => item.text === "收据号").align, "left");
});

test("draws a customer quote sheet with centered headings and versioned requirements", () => {
  const calls = [];
  const context = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "left", textBaseline: "alphabetic",
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(text) { return { width: String(text).length * 24 }; },
    fillText(text, x, y) { calls.push({ text, x, y, align: this.textAlign }); }
  };
  tools.drawQuoteSheet(context, {
    companyName: "宁波未来机械制造有限公司", inquiryNumber: "XQ-20260919-0001", version: 2,
    customerName: "王先生", quotedAtText: "2026/09/19", amountText: "¥8,000.00",
    validUntil: "2026-09-30", paymentTerms: "定金后开工，发货前付清", startAmountText: "¥3,000.00",
    specification: { requirement: "设备防护罩", material: "304不锈钢", thickness: "1.5 mm", dimensions: "800×500×300 mm", process: "激光切割、折弯、焊接", quantity: 2, expectedDate: "2026-10-10", technicalRequirements: "表面拉丝，无毛刺", remark: "含包装" }
  });
  assert.deepEqual(calls.slice(0, 2).map(({ text, x, align }) => ({ text, x, align })), [
    { text: "宁波未来机械制造有限公司", x: 800, align: "center" },
    { text: "报 价 单", x: 800, align: "center" }
  ]);
  for (const value of ["XQ-20260919-0001-V2", "设备防护罩", "304不锈钢", "1.5 mm", "¥8,000.00"]) {
    assert.equal(calls.some((item) => item.text === value), true, `missing ${value}`);
  }
});

test("builds editable quote fields from the current inquiry", () => {
  assert.deepEqual(tools.quoteFormValues({
    description: "设备护罩", material: "304不锈钢", dimensions: "800×500×300 mm",
    quantity: 2, expectedDate: "2026-10-10"
  }), {
    requirement: "设备护罩", material: "304不锈钢", thickness: "", dimensions: "800×500×300 mm",
    process: "", quantity: 2, expectedDate: "2026-10-10", technicalRequirements: "", remark: ""
  });
});

test("describes payment verification without misreporting an existing bobo task", () => {
  assert.equal(tools.paymentVerificationMessage({ boboAutoSubmitted: true, boboSyncStatus: "pending" }), "到账已确认，波波同步已自动提交");
  assert.equal(tools.paymentVerificationMessage({ boboAutoSubmitted: false, boboSyncStatus: "not_ready" }), "到账已确认，累计金额尚未达到开工款");
  assert.equal(tools.paymentVerificationMessage({ boboAutoSubmitted: false, boboSyncStatus: "synced" }), "到账已确认，波波订单已同步");
});

test("locks payment registration until the pending payment is reviewed", () => {
  assert.equal(typeof tools.paymentRegistrationState, "function");
  assert.equal(tools.paymentRegistrationState({ remainingAmount: 5000, pendingAmount: 2000, verifiedAmount: 0 }), "pending");
  assert.equal(tools.paymentRegistrationState({ remainingAmount: 3000, pendingAmount: 0, verifiedAmount: 2000 }), "followup");
  assert.equal(tools.paymentRegistrationState({ remainingAmount: 0, pendingAmount: 0, verifiedAmount: 5000 }), "paid");
  assert.equal(tools.paymentRegistrationState({ remainingAmount: 5000, pendingAmount: 0, verifiedAmount: 0 }), "initial");
});

test("translates audit action codes and structured details into Chinese business language", () => {
  assert.equal(tools.auditActionLabel("create_order"), "生成正式订单");
  assert.equal(tools.auditActionLabel("verify_payment"), "确认到账");
  assert.equal(tools.auditActionLabel("retry_bobo_sync"), "重试波波同步");
  assert.equal(tools.auditActionLabel("auto_submit_bobo_sync"), "到账后自动提交波波同步");
  assert.equal(tools.auditActionLabel("future_unknown_action"), "其他系统操作");
  assert.equal(tools.formatAuditDetail("order:5;quote:9;amount:1900"), "订单 #5 · 报价 #9 · 金额 ¥1,900.00");
  assert.equal(tools.formatAuditDetail("payment:7;amount:3000"), "付款记录 #7 · 金额 ¥3,000.00");
  assert.equal(tools.formatAuditDetail("production:波波回传暂时中断"), "生产中 · 波波回传暂时中断");
  assert.equal(tools.formatAuditDetail(JSON.stringify({ kind: "bobo_webhook", eventType: "process.updated", eventId: "evt-1", process: { name: "激光", status: "已完成" } })), "工序：激光 · 已完成 · 事件 evt-1");
  assert.equal(tools.formatAuditDetail(JSON.stringify({ kind: "bobo_webhook", eventType: "shipment.shipped", eventId: "evt-2" })), "配送状态：配送中 · 事件 evt-2");
  assert.equal(tools.formatAuditDetail(JSON.stringify({ kind: "bobo_webhook", eventType: "delivery.completed", eventId: "evt-3", deliveredAt: "2026-09-22T15:02:00.000Z" })), "配送状态：已送达 · 事件 evt-3");
  assert.equal(tools.formatAuditDetail("process.updated:legacy-1"), "生产工序已更新 · 事件 legacy-1");
  assert.equal(tools.formatAuditDetail("shipment.shipped:legacy-2"), "配送状态：配送中 · 事件 legacy-2");
  assert.equal(tools.formatAuditDetail("delivery.completed:legacy-3"), "配送状态：已送达 · 事件 legacy-3");
  assert.equal(tools.formatAuditDetail("金额截图不清晰"), "金额截图不清晰");
});

test("defines each high-risk action for one centered business confirmation", () => {
  const create = tools.adminActionDefinition("create-order", { reference: "XQ-1" });
  assert.equal(create.title, "生成正式订单");
  assert.equal(create.reasonRequired, false);
  assert.match(create.description, /冻结/);

  for (const kind of ["close-inquiry", "reject-payment", "void-payment", "advance-order"]) {
    assert.equal(tools.adminActionDefinition(kind, {}).reasonRequired, true);
  }
  for (const kind of ["verify-payment", "sync-bobo", "retry-bobo"]) {
    assert.equal(tools.adminActionDefinition(kind, {}).reasonRequired, false);
  }
});
