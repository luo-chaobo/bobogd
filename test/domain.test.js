const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALLOWED_EXTENSIONS,
  canConfirmPayment,
  canEnterProduction,
  normalizePhone,
  PUBLIC_STATUS_DICTIONARY,
  publicOrder,
  validatePublicEventTitle,
  validateInquiry
} = require("../src/domain");

function validInquiry() {
  return {
    drawingMode: "none",
    contactName: "王先生",
    phone: "138 1234 5678",
    region: "宁波北仑",
    quantity: 2,
    expectedDate: "2026-09-10",
    description: "按现场照片制作不锈钢防护罩",
    material: "304不锈钢",
    dimensions: "约 800×500×300 mm",
    attachments: [{ name: "现场照片.jpg", size: 1024, content: "ZmFrZQ==" }]
  };
}

test("normalizes a mainland mobile number", () => {
  assert.equal(normalizePhone("+86 138-1234-5678"), "13812345678");
});

test("rejects an inquiry missing a required region", () => {
  const input = validInquiry();
  input.region = "";
  assert.deepEqual(validateInquiry(input), { field: "region", message: "请填写所在区域" });
});

test("rejects unsupported attachment extensions", () => {
  const input = validInquiry();
  input.attachments = [{ name: "program.exe", size: 10, content: "AA==" }];
  assert.deepEqual(validateInquiry(input), { field: "attachments", message: "附件格式不支持" });
});

test("accepts planned drawing formats", () => {
  for (const extension of ["pdf", "jpg", "png", "dxf", "dwg", "step", "stp", "zip"]) {
    assert.equal(ALLOWED_EXTENSIONS.has(extension), true);
  }
});

test("rejects an attachment whose decoded content is larger than 20 MiB", () => {
  const input = validInquiry();
  input.attachments[0].content = Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64");
  input.attachments[0].size = 1;
  assert.deepEqual(validateInquiry(input), { field: "attachments", message: "单个附件不能超过20MB" });
});

test("allows payment confirmation only after a quote is confirmed", () => {
  assert.equal(canConfirmPayment({ quoteStatus: "draft", paymentStatus: "unpaid" }), false);
  assert.equal(canConfirmPayment({ quoteStatus: "confirmed", paymentStatus: "unpaid" }), true);
  assert.equal(canConfirmPayment({ quoteStatus: "confirmed", paymentStatus: "paid" }), false);
});

test("publishes only supported customer-visible statuses and blocks unpaid production", () => {
  assert.deepEqual(PUBLIC_STATUS_DICTIONARY.order, ["paid", "production", "quality", "ready", "completed"]);
  assert.equal(canEnterProduction({ paymentStatus: "paid", status: "paid" }), true);
  assert.equal(canEnterProduction({ paymentStatus: "unpaid", status: "paid" }), false);
});

test("limits public event titles and rejects control characters", () => {
  assert.equal(validatePublicEventTitle("已进入生产"), null);
  assert.equal(validatePublicEventTitle("a".repeat(121)), "公开说明不能超过120个字符");
  assert.equal(validatePublicEventTitle("生产\n中"), "公开说明不能包含控制字符");
});

test("public order projection excludes internal and payment details", () => {
  const result = publicOrder({
    orderNumber: "WL-20260829-0001",
    contactName: "王先生",
    phone: "13812345678",
    status: "production",
    paymentStatus: "paid",
    totalAmount: 2800,
    internalNote: "成本 1600",
    events: [{ status: "production", title: "生产中", occurredAt: "2026-08-29T10:00:00.000Z" }]
  });

  assert.deepEqual(result, {
    orderNumber: "WL-20260829-0001",
    contactName: "王先生",
    status: "production",
    events: [{ status: "production", title: "生产中", occurredAt: "2026-08-29T10:00:00.000Z" }]
  });
});
