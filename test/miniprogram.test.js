const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLoginRequest,
  buildInquiryPayload,
  formatFileSize,
  removeAttachmentAt,
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

test("omits customer-entered process fields from an inquiry payload", () => {
  const payload = buildInquiryPayload({
    drawingMode: "none",
    contactName: "王先生",
    phone: "138 1234 5678",
    region: "宁波北仑",
    address: "",
    quantity: 2,
    expectedDate: "2026-09-15",
    description: "按现场尺寸做设备防护罩",
    material: "304不锈钢",
    dimensions: "800×500×300mm",
    process: "激光切割、折弯",
    technicalRequirements: "去毛刺",
    attachments: []
  });

  assert.deepEqual(payload, {
    drawingMode: "none",
    contactName: "王先生",
    phone: "13812345678",
    region: "宁波北仑",
    address: "",
    quantity: 2,
    expectedDate: "2026-09-15",
    description: "按现场尺寸做设备防护罩",
    material: "304不锈钢",
    dimensions: "800×500×300mm",
    process: "",
    technicalRequirements: "",
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
  const existing = Array.from({ length: 4 }, (_, index) => ({ name: `${index}.jpg`, size: 1, path: `/tmp/${index}.jpg` }));
  const result = selectAttachments([
    { name: "4.jpg", size: 1, path: "/tmp/4.jpg" },
    { name: "5.jpg", size: 1, path: "/tmp/5.jpg" }
  ], existing);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected[0].reason, "最多选择5个附件");
});

test("rejects files immediately when the combined selection exceeds 40MB", () => {
  const mib = 1024 * 1024;
  const result = selectAttachments([
    { name: "drawing.step", size: 20 * mib, path: "/tmp/drawing.step" },
    { name: "photo.jpg", size: 6 * mib, path: "/tmp/photo.jpg" }
  ], [{ name: "existing.pdf", size: 15 * mib, path: "/tmp/existing.pdf" }]);

  assert.deepEqual(result.accepted.map((file) => file.name), ["drawing.step"]);
  assert.equal(result.rejected[0].reason, "附件总大小不能超过40MB");
});

test("formats attachment sizes and removes a selected file", () => {
  assert.equal(formatFileSize(559674), "546.56 KB");
  assert.equal(formatFileSize(9912598), "9.45 MB");
  assert.equal(formatFileSize(1024), "1 KB");
  assert.deepEqual(removeAttachmentAt([{ name: "a" }, { name: "b" }], 0), [{ name: "b" }]);
});

test("explains the WeChat chat file picker before opening it", () => {
  const source = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/order-form/index.ts"), "utf8");

  assert.match(source, /chooseFiles\(\) \{ wx\.showModal\(\{/);
  assert.match(source, /title: "选择图纸文件"/);
  assert.match(source, /请先发送至“文件传输助手”或任一微信聊天/);
  assert.match(source, /confirmText: "前往选择"/);
  assert.match(source, /if \(!modal\.confirm\) return;/);
  assert.match(source, /wx\.chooseMessageFile\(\{ count: 5, type: "file"/);
});

test("shows formatted sizes and a delete control for every selected attachment", () => {
  const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/order-form/index.wxml"), "utf8");
  assert.match(page, /\{\{item\.sizeText\}\}/);
  assert.match(page, /bindtap="removeAttachment"/);
  assert.match(page, /class="attachment-remove"/);
});

test("does not offer the incomplete draft-saving action", () => {
  const miniDir = path.join(__dirname, "../miniprogram/pages/order-form");
  const page = fs.readFileSync(path.join(miniDir, "index.wxml"), "utf8");
  const logic = fs.readFileSync(path.join(miniDir, "index.ts"), "utf8");

  assert.doesNotMatch(page, /保存草稿|bindtap="saveDraft"/);
  assert.doesNotMatch(logic, /async saveDraft\(\)/);
});

test("displays customer-facing mini-program statuses in Chinese", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const statusModule = path.join(miniDir, "services/status.ts");
  assert.ok(fs.existsSync(statusModule));
  const { statusText, withStatusText } = require(statusModule);

  assert.deepEqual({
    draft: statusText("draft"), submitted: statusText("submitted"), new: statusText("new"),
    claimed: statusText("claimed"), ordered: statusText("ordered"), paid: statusText("paid"),
    production: statusText("production"), inProgress: statusText("in_progress"), quality: statusText("quality"),
    ready: statusText("ready"), shipped: statusText("shipped"), completed: statusText("completed"),
    pending: statusText("pending"), unknown: statusText("external_code")
  }, {
    draft: "草稿", submitted: "待受理", new: "待受理", claimed: "已受理", ordered: "已转订单",
    paid: "已付款", production: "生产中", inProgress: "生产中", quality: "质检中",
    ready: "待配送", shipped: "配送中", completed: "已送达", pending: "待开始", unknown: "状态更新中"
  });
  assert.equal(withStatusText({ status: "new", state: "draft" }).statusText, "草稿");

  for (const page of ["requirements", "orders", "order-detail"]) {
    const markup = fs.readFileSync(path.join(miniDir, `pages/${page}/index.wxml`), "utf8");
    const logic = fs.readFileSync(path.join(miniDir, `pages/${page}/index.ts`), "utf8");
    assert.match(markup, /statusText/);
    assert.match(logic, page === "order-detail" ? /buildOrderDetailViewModel/ : /withStatusText/);
  }
});

test("refreshes the customer order detail while the page is visible", () => {
  const logic = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/order-detail/index.ts"), "utf8");
  assert.match(logic, /onShow\(\)/);
  assert.match(logic, /onHide\(\)/);
  assert.match(logic, /onUnload\(\)/);
  assert.match(logic, /onPullDownRefresh/);
  assert.match(logic, /setTimeout/);
  assert.match(logic, /clearTimeout/);
  assert.match(logic, /10000/);
  assert.match(logic, /refreshNow/);
  assert.match(logic, /lastUpdated/);
});

test("adds a cache-busting key when refreshing an order", async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: "https://api.example.com", request: async (options) => { calls.push(options); return {}; } });
  await api.getOrder(7, "token", 123456);
  assert.equal(calls[0].url, "https://api.example.com/api/customer/orders/7?refresh=123456");
});

test("colors delivery dates by calendar-day urgency without adding status copy", () => {
  const { buildDeliveryDateView } = require("../miniprogram/services/status.ts");
  const now = new Date("2026-10-10T12:00:00+08:00");
  const cases = [
    ["2026-10-20", "production", "normal"],
    ["2026-10-16", "production", "attention"],
    ["2026-10-12", "production", "urgent"],
    ["2026-10-10", "production", "critical"],
    ["2026-10-09", "production", "critical"],
    ["2026-10-09", "completed", "completed"]
  ];
  for (const [expectedDate, status, tone] of cases) {
    assert.deepEqual(buildDeliveryDateView(expectedDate, status, now), { deliveryDateText: expectedDate, deliveryDateTone: tone });
  }
  assert.deepEqual(buildDeliveryDateView("", "production", now), { deliveryDateText: "交期待确认", deliveryDateTone: "unknown" });
});

test("formats order progress times and Chinese process statuses for customers", () => {
  const { buildOrderDetailViewModel, formatPublicDateTime, statusText } = require("../miniprogram/services/status.ts");
  assert.equal(formatPublicDateTime("2026-09-16T13:58:50.085Z"), "2026-09-16 21:58");
  assert.equal(formatPublicDateTime(""), "等待更新");
  assert.equal(statusText("待开始"), "待开始");
  assert.equal(statusText("进行中"), "进行中");
  assert.equal(statusText("已完成"), "已完成");

  const order = buildOrderDetailViewModel({
    orderNumber: "WL-20260923-0002",
    status: "production",
    expectedDate: "2026-10-12",
    processes: [{ id: "laser", sequence: 1, name: "激光", status: "已完成", startedAt: "2026-09-16T12:00:00.000Z", completedAt: "2026-09-16T13:58:50.085Z" }],
    events: [{ status: "paid", title: "已核验到账 ¥878.00", occurredAt: "2026-09-16T13:59:36.654Z" }]
  });
  assert.equal(order.processes[0].statusText, "已完成");
  assert.equal(order.processes[0].displayTime, "完成于 2026-09-16 21:58");
  assert.equal(order.events[0].displayTime, "2026-09-16 21:59");
  assert.equal(order.deliveryDateText, "2026-10-12");
  assert.equal(order.orderNumberPrefix, "WL-20260923");
  assert.equal(order.orderNumberSuffix, "-0002");
});

test("renders production processes and public events as readable timelines", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const page = fs.readFileSync(path.join(miniDir, "pages/order-detail/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.join(miniDir, "app.wxss"), "utf8");
  assert.match(page, /class="process-step"/);
  assert.match(page, /\{\{item\.sequenceText\}\}/);
  assert.match(page, /\{\{item\.statusText\}\}/);
  assert.match(page, /\{\{item\.displayTime\}\}/);
  assert.match(page, /class="timeline-dot"/);
  assert.match(styles, /\.process-step\s*\{/);
  assert.match(styles, /\.progress-timeline\s*\{/);
  assert.match(styles, /\.timeline-dot\s*\{/);
});

test("exposes draft update, detail, supplement and granular subscription routes", async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: "https://api.example.com", request: async (options) => { calls.push(options); return {}; } });
  await api.bindPhone("13812345678", "mock:13812345678", "token");
  await api.bindPhoneCode("wechat-phone-code", "token");
  await api.getRequirement(7, "token");
  await api.updateInquiry(7, { state: "submitted" }, "token");
  await api.supplementInquiry(7, { material: "304" }, "token");
  await api.saveSubscriptions(["quote_ready", "production"], "token");
  assert.deepEqual(calls.map(({ url, method, data }) => ({ url, method, data })), [
    { url: "https://api.example.com/api/customer/phone-binding", method: "POST", data: { phone: "13812345678", verificationProof: "mock:13812345678" } },
    { url: "https://api.example.com/api/customer/phone-binding", method: "POST", data: { phoneCode: "wechat-phone-code" } },
    { url: "https://api.example.com/api/customer/inquiries/7", method: "GET", data: undefined },
    { url: "https://api.example.com/api/customer/inquiries/7", method: "POST", data: { state: "submitted" } },
    { url: "https://api.example.com/api/customer/inquiries/7/supplements", method: "POST", data: { material: "304" } },
    { url: "https://api.example.com/api/customer/subscriptions", method: "POST", data: { types: ["quote_ready", "production"] } }
  ]);
});

test("exposes paged order history and repurchase routes", async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: "https://api.example.com", request: async (options) => { calls.push(options); return {}; } });
  await api.getOrders({ scope: "history", keyword: "WL-1", startDate: "2026-09-01", endDate: "2026-09-30", page: 2, pageSize: 20 }, "token");
  await api.getRepurchaseDraft(8, "token");
  await api.repurchaseOrder(8, { quantity: 3 }, "token");
  assert.deepEqual(calls.map(({ url, method, data }) => ({ url, method, data })), [
    { url: "https://api.example.com/api/customer/orders?scope=history&keyword=WL-1&startDate=2026-09-01&endDate=2026-09-30&page=2&pageSize=20", method: "GET", data: undefined },
    { url: "https://api.example.com/api/customer/orders/8/repurchase-draft", method: "GET", data: undefined },
    { url: "https://api.example.com/api/customer/orders/8/repurchase", method: "POST", data: { quantity: 3 } }
  ]);
});

test("renders active and historical orders with filters and repurchase controls", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const ordersLogic = fs.readFileSync(path.join(miniDir, "pages/orders/index.ts"), "utf8");
  const ordersPage = fs.readFileSync(path.join(miniDir, "pages/orders/index.wxml"), "utf8");
  const formLogic = fs.readFileSync(path.join(miniDir, "pages/order-form/index.ts"), "utf8");
  const formPage = fs.readFileSync(path.join(miniDir, "pages/order-form/index.wxml"), "utf8");
  assert.match(ordersPage, /进行中/);
  assert.match(ordersPage, /历史订单/);
  assert.match(ordersPage, /mode="date"/);
  assert.match(ordersPage, /再次购买/);
  assert.match(ordersPage, /class="order-card-main"[^>]*bindtap="detail"/);
  assert.match(ordersPage, /bindtap="repurchase"/);
  assert.doesNotMatch(ordersPage, /catchtap="repurchase"/);
  assert.match(ordersLogic, /getOrders\(/);
  assert.match(ordersLogic, /repurchase/);
  assert.match(ordersLogic, /setStorageSync\("repurchaseSourceOrderId"/);
  assert.match(ordersLogic, /switchTab\(/);
  assert.doesNotMatch(ordersLogic, /navigateTo\(\{\s*url: `\/pages\/order-form/);
  assert.match(formLogic, /getRepurchaseDraft/);
  assert.match(formLogic, /repurchaseOrder/);
  assert.match(formLogic, /getStorageSync\("repurchaseSourceOrderId"\)/);
  assert.match(formLogic, /removeStorageSync\("repurchaseSourceOrderId"\)/);
  assert.match(formPage, /沿用原订单图纸/);
});

test("keeps history filters readable and gives empty results a clear hierarchy", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const ordersPage = fs.readFileSync(path.join(miniDir, "pages/orders/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.join(miniDir, "app.wxss"), "utf8");

  assert.match(ordersPage, /class="filter-field"[\s\S]*订单号/);
  assert.match(ordersPage, /class="filter-field"[\s\S]*开始日期/);
  assert.match(ordersPage, /class="filter-field"[\s\S]*结束日期/);
  assert.match(ordersPage, /class="empty-state-title"[^>]*>暂未查询到/);
  assert.match(ordersPage, /调整订单号或日期范围后重新查询/);
  assert.match(styles, /\.filter-field\s*\{/);
  assert.match(styles, /\.empty-state-title\s*\{/);
});

test("presents the approved brand and laser-cutting hero on the mini-program home", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const home = fs.readFileSync(path.join(miniDir, "pages/home/index.wxml"), "utf8");
  const app = JSON.parse(fs.readFileSync(path.join(miniDir, "app.json"), "utf8"));
  assert.equal(app.window.navigationBarTitleText, "未来机械钣金服务");
  assert.match(home, /assets\/brand\/wl-mark-transparent\.png/);
  assert.match(home, /assets\/images\/laser-cutting-hero-enhanced\.jpg/);
  assert.match(home, /无图可沟通/);
  assert.match(home, /小批量可接/);
  const homeLogic = fs.readFileSync(path.join(miniDir, "pages/home/index.ts"), "utf8");
  assert.match(homeLogic, /onShareAppMessage/);
  assert.match(homeLogic, /assets\/brand\/share-card\.jpg/);
});

test("opens the configured WeCom customer service with a local QR fallback", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const config = fs.readFileSync(path.join(miniDir, "config.ts"), "utf8");
  const profileLogic = fs.readFileSync(path.join(miniDir, "pages/profile/index.ts"), "utf8");
  const profilePage = fs.readFileSync(path.join(miniDir, "pages/profile/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.join(miniDir, "app.wxss"), "utf8");

  assert.match(config, /export const WECHAT_WORK_CORP_ID = "wwcf524bec522394af";/);
  assert.match(config, /export const WECHAT_WORK_KF_URL = "https:\/\/work\.weixin\.qq\.com\/kfid\/kfc91b64c9e96963032";/);
  assert.match(config, /export const WECHAT_WORK_QR_IMAGE = "\/assets\/images\/wecom-customer-service-qr\.png";/);
  assert.ok(fs.existsSync(path.join(miniDir, "assets/images/wecom-customer-service-qr.png")));
  assert.match(profileLogic, /corpId: WECHAT_WORK_CORP_ID/);
  assert.doesNotMatch(profileLogic, /__REPLACE_WITH_WECHAT_WORK_CORP_ID__/);
  assert.match(profilePage, /class="support-entry"[\s\S]*企业微信客服[\s\S]*点击立即咨询/);
  assert.match(profilePage, /aria-label="打开企业微信客服会话"/);
  assert.match(styles, /\.support-entry\s*\{/);
  assert.match(styles, /\.support-entry-copy\s*\{[^}]*text-align:\s*center/);
  assert.match(styles, /\.support-entry-badge\s*\{[^}]*position:\s*absolute/);
  assert.match(styles, /\.support-entry-arrow\s*\{[^}]*position:\s*absolute/);
});

test("requests one order notification credit with the configured template", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const config = fs.readFileSync(path.join(miniDir, "config.ts"), "utf8");
  const profileLogic = fs.readFileSync(path.join(miniDir, "pages/profile/index.ts"), "utf8");

  assert.match(config, /SUBSCRIPTION_TEMPLATE_IDS: string\[\] = \["tppDS_ZBA9nKXerDEzEVdd7dRHRH85W7QX4eL_U3zTA"\]/);
  assert.match(profileLogic, /已增加\$\{accepted\.length\}次订单提醒/);
});

test("opens the configured corporate website from the profile page", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const app = JSON.parse(fs.readFileSync(path.join(miniDir, "app.json"), "utf8"));
  const config = fs.readFileSync(path.join(miniDir, "config.ts"), "utf8");
  const profile = fs.readFileSync(path.join(miniDir, "pages/profile/index.wxml"), "utf8");
  const profileLogic = fs.readFileSync(path.join(miniDir, "pages/profile/index.ts"), "utf8");
  const styles = fs.readFileSync(path.join(miniDir, "app.wxss"), "utf8");

  assert.ok(app.pages.includes("pages/website/index"));
  assert.match(config, /export const WEBSITE_URL = "https:\/\/test\.wljixie\.com";/);
  assert.match(profile, /<view class="card profile-actions">[\s\S]*bindtap="support"[\s\S]*<button class="outline" bindtap="website">企业官网<\/button><button class="outline" bindtap="legal">隐私与用户协议<\/button><\/view>/);
  assert.doesNotMatch(styles, /\.profile-website-button\s*\{/);
  assert.match(profileLogic, /website\(\) \{ wx\.navigateTo\(\{ url: "\/pages\/website\/index" \}\); \}/);
  const website = fs.readFileSync(path.join(miniDir, "pages/website/index.wxml"), "utf8");
  const websiteLogic = fs.readFileSync(path.join(miniDir, "pages/website/index.ts"), "utf8");
  assert.match(website, /<web-view src="\{\{src\}\}"><\/web-view>/);
  assert.match(websiteLogic, /import \{ WEBSITE_URL \} from "\.\.\/\.\.\/config";/);
  assert.match(websiteLogic, /data: \{ src: WEBSITE_URL \}/);
});

test("uses TypeScript pages without stale JavaScript shadow files", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const project = JSON.parse(fs.readFileSync(path.join(miniDir, "project.config.json"), "utf8"));
  assert.ok(project.setting.useCompilerPlugins.includes("typescript"));
  for (const page of fs.readdirSync(path.join(miniDir, "pages"))) {
    assert.equal(fs.existsSync(path.join(miniDir, "pages", page, "index.js")), false, `${page} must not shadow index.ts`);
  }
});

test("lets first-time visitors browse before requesting phone authorization", () => {
  const miniDir = path.join(__dirname, "../miniprogram");
  const app = JSON.parse(fs.readFileSync(path.join(miniDir, "app.json"), "utf8"));
  const login = fs.readFileSync(path.join(miniDir, "pages/login/index.wxml"), "utf8");
  const loginLogic = fs.readFileSync(path.join(miniDir, "pages/login/index.ts"), "utf8");
  const form = fs.readFileSync(path.join(miniDir, "pages/order-form/index.wxml"), "utf8");
  const formLogic = fs.readFileSync(path.join(miniDir, "pages/order-form/index.ts"), "utf8");
  const homeLogic = fs.readFileSync(path.join(miniDir, "pages/home/index.ts"), "utf8");
  const profileLogic = fs.readFileSync(path.join(miniDir, "pages/profile/index.ts"), "utf8");
  const legal = fs.readFileSync(path.join(miniDir, "pages/legal/index.wxml"), "utf8");

  assert.equal(app.pages[0], "pages/home/index");
  assert.doesNotMatch(login, /bindtap="login"|>微信登录</);
  assert.match(login, /open-type="getPhoneNumber"/);
  assert.match(login, /暂不登录，返回首页继续浏览/);
  assert.match(loginLogic, /bindCustomerPhone/);
  assert.match(form, /授权手机号并提交需求/);
  assert.match(form, /open-type="getPhoneNumber"/);
  assert.match(formLogic, /authorizeAndSubmit/);
  assert.match(homeLogic, /openProtectedPage/);
  assert.match(profileLogic, /openProtectedPage/);
  assert.match(legal, /不收集您的微信头像和昵称/);
  assert.doesNotMatch(legal, /待确认|上线前须替换/);
});
