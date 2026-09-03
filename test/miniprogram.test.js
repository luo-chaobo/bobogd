const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLoginRequest,
  buildInquiryPayload,
  selectAttachments,
  validateInquiryDraft
} = require("../miniprogram/services/contracts.ts");
const { createApiClient } = require("../miniprogram/services/api.ts");
const fs = require("node:fs");
const path = require("node:path");

test("uses a local mock code only when development verification requests it", () => {
  assert.deepEqual(buildLoginRequest("wx-live-code", "mock-local-code"), {
    code: "mock-local-code",
    mock: true
  });
  assert.deepEqual(buildLoginRequest("wx-live-code"), { code: "wx-live-code", mock: false });
});

test("rejects a submitted inquiry draft without contact details", () => {
  assert.deepEqual(validateInquiryDraft({ drawingMode: "none", quantity: 1, description: "做一个机罩" }), {
    field: "contactName",
    message: "请填写联系人"
  });
});

test("builds an image-free inquiry payload without inventing attachment data", () => {
  const payload = buildInquiryPayload({
    drawingMode: "none",
    contactName: "王先生",
    phone: "138 1234 5678",
    region: "宁波北仑",
    quantity: 2,
    expectedDate: "2026-09-15",
    description: "按现场尺寸做设备防护罩",
    material: "304不锈钢",
    dimensions: "800×500×300mm",
    attachments: []
  });

  assert.deepEqual(payload, {
    drawingMode: "none",
    contactName: "王先生",
    phone: "13812345678",
    region: "宁波北仑",
    quantity: 2,
    expectedDate: "2026-09-15",
    description: "按现场尺寸做设备防护罩",
    material: "304不锈钢",
    dimensions: "800×500×300mm",
    attachments: []
  });
});

test("keeps allowed drawings and reports rejected files for the upload adapter", () => {
  const result = selectAttachments([
    { name: "机罩.dxf", size: 2048, path: "/tmp/cover.dxf" },
    { name: "说明.exe", size: 10, path: "/tmp/run.exe" }
  ]);

  assert.deepEqual(result.accepted, [{ name: "机罩.dxf", size: 2048, path: "/tmp/cover.dxf" }]);
  assert.deepEqual(result.rejected, [{ name: "说明.exe", reason: "附件格式不支持" }]);
});

test("sends the login exchange to the customer API route", async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: "https://api.example.com/",
    request: async (options) => {
      calls.push(options);
      return { sessionToken: "session-1", user: { phoneBound: false } };
    }
  });

  const result = await api.login({ code: "mock-code", mock: true });

  assert.deepEqual(result, { sessionToken: "session-1", user: { phoneBound: false } });
  assert.deepEqual(calls, [{
    url: "https://api.example.com/api/auth/wechat/login",
    method: "POST",
    data: { code: "mock-code", mock: true },
    token: ""
  }]);
});

test("applies attachment limits across repeated selections", () => {
  const existing = Array.from({ length: 8 }, (_, index) => ({ name: `${index}.jpg`, size: 1, path: `/tmp/${index}.jpg` }));
  const result = selectAttachments([
    { name: "8.jpg", size: 1, path: "/tmp/8.jpg" },
    { name: "9.jpg", size: 1, path: "/tmp/9.jpg" }
  ], existing);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected[0].reason, "最多选择9个附件");
});

test("exposes draft update, detail, supplement and granular subscription routes", async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: "https://api.example.com", request: async (options) => { calls.push(options); return {}; } });
  await api.bindPhone("13812345678", "mock:13812345678", "token");
  await api.getRequirement(7, "token");
  await api.updateInquiry(7, { state: "submitted" }, "token");
  await api.supplementInquiry(7, { material: "304" }, "token");
  await api.saveSubscriptions(["quote_ready", "production"], "token");
  assert.deepEqual(calls.map(({ url, method, data }) => ({ url, method, data })), [
    { url: "https://api.example.com/api/customer/phone-binding", method: "POST", data: { phone: "13812345678", verificationProof: "mock:13812345678" } },
    { url: "https://api.example.com/api/customer/inquiries/7", method: "GET", data: undefined },
    { url: "https://api.example.com/api/customer/inquiries/7", method: "POST", data: { state: "submitted" } },
    { url: "https://api.example.com/api/customer/inquiries/7/supplements", method: "POST", data: { material: "304" } },
    { url: "https://api.example.com/api/customer/subscriptions", method: "POST", data: { types: ["quote_ready", "production"] } }
  ]);
});

test("presents the approved brand and laser-cutting hero on the mini-program home", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const home = fs.readFileSync(path.join(miniDir, "pages/home/index.wxml"), "utf8");
  const app = JSON.parse(fs.readFileSync(path.join(miniDir, "app.json"), "utf8"));
  assert.equal(app.window.navigationBarTitleText, "未来机械钣金服务");
  assert.match(home, /assets\/brand\/wl-mark-transparent\.png/);
  assert.match(home, /assets\/images\/laser-cutting-hero\.jpg/);
  assert.match(home, /无图可沟通/);
  assert.match(home, /小批量可接/);
  const homeLogic = fs.readFileSync(path.join(miniDir, "pages/home/index.ts"), "utf8");
  assert.match(homeLogic, /onShareAppMessage/);
  assert.match(homeLogic, /assets\/brand\/share-card\.jpg/);
});

test("uses TypeScript pages without stale JavaScript shadow files", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const project = JSON.parse(fs.readFileSync(path.join(miniDir, "project.config.json"), "utf8"));
  assert.ok(project.setting.useCompilerPlugins.includes("typescript"));
  for (const page of fs.readdirSync(path.join(miniDir, "pages"))) {
    assert.equal(fs.existsSync(path.join(miniDir, "pages", page, "index.js")), false, `${page} must not shadow index.ts`);
  }
});
