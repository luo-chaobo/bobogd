const state = { session: null, view: "dashboard", pendingWrites: 0, detail: null, detailItem: null, payments: new Map(), action: null, refreshingDetail: false, previewUrl: "", dxfPreview: null, refreshController: null };
const { createRefreshController, parseDxf, drawReceipt, drawQuoteSheet, quoteFormValues, paymentVerificationMessage, paymentRegistrationState, auditActionLabel, formatAuditDetail, adminActionDefinition } = window.AdminTools;
const labels = {
  new: "待认领", claimed: "跟进中", quoted: "已报价", ordered: "已转订单", closed: "已关闭", draft: "草稿", confirmed: "已确认", change_requested: "变更待处理",
  awaiting_payment: "待付款", awaiting_schedule: "待排产", production: "生产中", quality: "质检中",
  ready: "待交付", shipped: "已发货", completed: "已完成", paid: "已付清",
  unpaid: "未付款", partial_paid: "部分付款", pending_review: "待核验", pending: "待核验",
  verified: "已确认", rejected: "已驳回", voided: "已作废", not_ready: "未到同步条件",
  awaiting_confirmation: "待确认同步", retrying: "同步异常", synced: "已同步"
};
const boboLabels = { not_ready: "未到同步条件", awaiting_confirmation: "待确认同步", pending: "待同步", retrying: "同步异常", failed: "同步失败", synced: "已同步" };
const headings = {
  dashboard: ["OPERATIONS OVERVIEW", "工作台"], inquiries: ["RFQ MANAGEMENT", "询价管理"],
  orders: ["ORDER FULFILLMENT", "订单管理"], payments: ["PAYMENT CONTROL", "收款管理"],
  customers: ["CUSTOMER RECORDS", "客户档案"], todos: ["EXCEPTION QUEUE", "异常待办"]
};

function byId(id) { return document.getElementById(id); }
function element(tag, text = "", className = "") { const item = document.createElement(tag); item.textContent = String(text ?? ""); item.className = className; return item; }
function money(value) { return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function dateTime(value) { return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—"; }
function badge(value) { return element("span", labels[value] || value || "—", `admin-badge status-${value || "unknown"}`); }
function boboBadge(value) { return element("span", boboLabels[value] || value || "—", `admin-badge status-${value || "unknown"}`); }
function cell(...children) { const item = document.createElement("td"); item.append(...children); return item; }
function stacked(primary, secondary = "") { const item = element("div", "", "admin-cell"); item.append(element("strong", primary), element("small", secondary)); return item; }
function actionButton(text, action, id, primary = false) { const item = element("button", text, `button button-small${primary ? "" : " button-ghost"}`); item.type = "button"; item.dataset.action = action; item.dataset.id = String(id); return item; }
function showNotice(message, error = false) { const item = byId("admin-notice"); item.textContent = message; item.classList.toggle("error", error); }
function showFormResult(id, message = "", error = false) { const item = byId(id); item.textContent = message; item.classList.toggle("error", error); }

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isWrite = options.method && options.method !== "GET";
  if (isWrite) {
    headers["content-type"] = "application/json";
    headers["x-csrf-token"] = state.session.csrfToken;
  }
  if (isWrite) state.pendingWrites += 1;
  try {
    const response = await fetch(url, { ...options, headers });
    const type = response.headers.get("content-type") || "";
    const body = response.status === 204 ? null : type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(body?.message || "操作失败");
    return body;
  } finally {
    if (isWrite) state.pendingWrites -= 1;
  }
}

function query(form) {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (String(value).trim()) params.set(key, value);
  return params.toString();
}

function renderRows(body, rows, emptyText) {
  if (rows.length) return body.replaceChildren(...rows);
  const row = document.createElement("tr");
  const empty = cell(element("span", emptyText, "admin-empty"));
  empty.colSpan = 12;
  row.append(empty);
  body.replaceChildren(row);
}

async function loadDashboard() {
  const [metrics, inquiries] = await Promise.all([api("/api/admin/dashboard"), api("/api/admin/inquiries?view=active")]);
  const definitions = [
    ["待认领询价", metrics.unclaimedInquiries, "inquiries"],
    ["已报价待客户确认", metrics.quotedAwaitingCustomer, "inquiries"],
    ["已建单待收款", metrics.ordersAwaitingPayment, "orders"],
    ["收款待核验", metrics.paymentsAwaitingReview, "payments"],
    ["定金已收待排产", metrics.depositReadyForScheduling, "orders"],
    ["尾款待收", metrics.balancesOutstanding, "orders"],
    ["波波同步异常", metrics.boboSyncErrors, "todos"],
    ["即将交付订单", metrics.deliveringSoon, "orders"],
    ["今日完成订单", metrics.completedToday, "orders"]
  ];
  const cards = definitions.map(([label, value, view], index) => {
    const card = element("button", "", `admin-metric metric-${index + 1}`);
    card.type = "button";
    card.dataset.go = view;
    card.append(element("span", value || 0), element("strong", label), element("small", "点击查看相关记录 →"));
    return card;
  });
  byId("dashboard-grid").replaceChildren(...cards);
  const queue = inquiries.slice(0, 6).map((item) => {
    const row = element("button", "", "admin-queue-item");
    row.type = "button";
    row.dataset.openInquiry = item.id;
    row.append(stacked(item.inquiryNumber, dateTime(item.createdAt)), stacked(item.contactName, `${item.region} · ${item.phone}`), badge(item.status));
    return row;
  });
  byId("dashboard-queue").replaceChildren(...queue);
}

async function loadInquiries() {
  const data = await api(`/api/admin/inquiries?${query(byId("inquiry-filter"))}`);
  const rows = data.map((item) => {
    const row = document.createElement("tr");
    row.dataset.openInquiry = item.id;
    row.append(
      cell(stacked(item.inquiryNumber, dateTime(item.createdAt))), cell(stacked(item.contactName, item.phone)),
      cell(stacked(item.region, item.address || "未填写详细地址")), cell(stacked(item.description, item.material || "材料待确认")),
      cell(stacked(item.quantity, item.expectedDate)), cell(element("span", `${item.attachmentCount} 个`)),
      cell(stacked(labels[item.status] || item.status, item.claimedBy || "未分配")), cell(actionButton("查看", "open-inquiry", item.id))
    );
    return row;
  });
  renderRows(byId("inquiry-table").tBodies[0], rows, "暂无符合条件的询价");
}

async function loadOrders() {
  const data = await api(`/api/admin/orders?${query(byId("order-filter"))}`);
  const rows = data.map((item) => {
    const row = document.createElement("tr");
    row.dataset.openOrder = item.id;
    row.append(
      cell(stacked(item.orderNumber, item.inquiryNumber)), cell(stacked(item.contactName, item.phone)), cell(badge(item.status)), cell(element("span", item.currentProcess)),
      cell(badge(item.paymentStatus)), cell(stacked(`${money(item.payment.totalAmount)} / ${money(item.payment.verifiedAmount)}`, `未收 ${money(item.payment.remainingAmount)}`)),
      cell(boboBadge(item.boboSyncStatus)), cell(element("span", dateTime(item.createdAt))), cell(actionButton("查看", "open-order", item.id))
    );
    return row;
  });
  renderRows(byId("order-table").tBodies[0], rows, "暂无符合条件的订单");
}

async function loadPayments() {
  const data = await api(`/api/admin/payments?${query(byId("payment-filter"))}`);
  state.payments = new Map(data.map((item) => [String(item.id), item]));
  const rows = data.map((item) => {
    const actions = element("div", "", "admin-inline-actions");
    if (item.status === "pending" && state.session.user.role === "super_admin") actions.append(actionButton("确认", "verify-payment", item.id, true), actionButton("驳回", "reject-payment", item.id));
    if (item.status === "verified") {
      actions.append(actionButton("收据", "receipt", item.id));
      if (state.session.user.role === "super_admin") actions.append(actionButton("作废", "void-payment", item.id));
    }
    const row = document.createElement("tr");
    row.append(cell(element("strong", item.orderNumber)), cell(element("strong", money(item.amount))), cell(stacked(item.payerName, item.paymentMethod)), cell(element("span", dateTime(item.receivedAt))), cell(element("span", item.recordedBy)), cell(stacked(labels[item.status] || item.status, item.verifiedBy || item.reviewReason)), cell(actions));
    return row;
  });
  renderRows(byId("payment-table").tBodies[0], rows, "暂无收款记录");
}

async function loadCustomers() {
  const data = await api("/api/admin/customers");
  const rows = data.map((item) => { const row = document.createElement("tr"); row.append(cell(element("strong", item.contactName || "未命名客户")), cell(element("span", item.phone || "—")), cell(element("span", item.inquiryCount)), cell(element("span", item.orderCount)), cell(element("span", dateTime(item.lastActivityAt))), cell(actionButton("查看往来", "search-customer", item.phone))); return row; });
  renderRows(byId("customer-table").tBodies[0], rows, "暂无客户档案");
}

async function loadTodos() {
  const data = await api("/api/admin/todos");
  const rows = data.map((item) => { const row = document.createElement("tr"); row.append(cell(element("strong", item.type)), cell(element("span", `${item.entityType} #${item.entityId}`)), cell(element("span", item.detail)), cell(element("span", dateTime(item.createdAt))), cell(badge(item.status))); return row; });
  renderRows(byId("todo-table").tBodies[0], rows, "当前没有异常待办");
}

async function loadView(view) {
  if (view === "dashboard") return loadDashboard();
  if (view === "inquiries") return loadInquiries();
  if (view === "orders") return loadOrders();
  if (view === "payments") return loadPayments();
  if (view === "customers") return loadCustomers();
  return loadTodos();
}

async function refreshCurrentView() {
  await loadView(state.view);
  if (!state.detail || byId("admin-detail").hidden) return;
  const detail = { ...state.detail };
  state.refreshingDetail = true;
  try {
    if (detail.type === "inquiry") await openInquiry(detail.id);
    else await openOrder(detail.id);
  } finally {
    state.refreshingDetail = false;
  }
}

function updatedNow() {
  byId("admin-updated-at").textContent = `最后更新：${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date())}`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("active", item.dataset.panel === view));
  document.querySelectorAll(".admin-sidebar [data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  byId("admin-kicker").textContent = headings[view][0];
  byId("admin-title").textContent = headings[view][1];
  document.body.classList.remove("admin-nav-open");
  return state.refreshController.run();
}

function detailSection(title, entries) {
  const section = element("section", "", "admin-detail-section");
  section.append(element("h3", title));
  const grid = element("dl", "", "admin-detail-grid");
  for (const [label, value] of entries) grid.append(element("dt", label), element("dd", value || "—"));
  section.append(grid);
  return section;
}

function openDrawer(title, ...content) {
  const drawer = byId("admin-detail");
  const scrollTop = state.refreshingDetail ? drawer.scrollTop : 0;
  byId("detail-title").textContent = title;
  byId("detail-body").replaceChildren(...content);
  byId("admin-detail-backdrop").hidden = false;
  drawer.hidden = false;
  document.body.classList.add("drawer-open");
  if (state.refreshingDetail) drawer.scrollTop = scrollTop;
  else byId("detail-close").focus();
}

function closeDrawer() {
  byId("admin-detail").hidden = true;
  byId("admin-detail-backdrop").hidden = true;
  document.body.classList.remove("drawer-open");
  state.detail = null;
  state.detailItem = null;
}

function attachmentRow(file) {
  const row = element("div", "", "admin-file-row");
  const preview = element("button", file.size ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : file.name, "admin-file-name");
  preview.type = "button";
  preview.dataset.action = "preview-attachment";
  preview.dataset.fileName = file.name;
  preview.dataset.previewUrl = file.previewUrl || `/api/admin/attachments/${file.id}/preview`;
  preview.dataset.downloadUrl = file.downloadUrl || `/api/admin/attachments/${file.id}/download`;
  const download = element("a", "下载", "button button-small button-ghost");
  download.href = preview.dataset.downloadUrl;
  download.download = file.name;
  row.append(preview, download);
  return row;
}

async function openInquiry(id) {
  const item = await api(`/api/admin/inquiries/${id}`);
  const actions = element("div", "", "admin-detail-actions");
  if (!item.claimedAt && item.status !== "ordered") actions.append(actionButton("认领询价", "claim-inquiry", id, true));
  if (!item.order && item.status !== "closed") actions.append(actionButton("创建报价", "quote-inquiry", id, true));
  if (!item.order && item.quotes.some((quote) => quote.status === "confirmed")) actions.append(actionButton("生成正式订单", "create-order", id));
  if (!item.order && item.status !== "closed") actions.append(actionButton("关闭未成交", "close-inquiry", id));
  if (item.order) actions.append(actionButton(`查看订单 ${item.order.orderNumber}`, "open-order", item.order.id));

  const attachments = element("section", "", "admin-detail-section");
  attachments.append(element("h3", `图纸附件（${item.attachments.length}）`));
  const files = element("div", "", "admin-file-list");
  for (const file of item.attachments) files.append(attachmentRow(file));
  attachments.append(files.childElementCount ? files : element("p", "未上传附件", "admin-empty"));

  const quotes = element("section", "", "admin-detail-section");
  quotes.append(element("h3", "报价版本"));
  for (const quote of item.quotes) {
    const version = element("div", "", "admin-quote-version");
    version.append(stacked(`V${quote.version} · ${money(quote.amount)} · ${labels[quote.status] || quote.status}`, `${quote.operator} · ${dateTime(quote.createdAt)} · 开工款 ${money(quote.startAmount)}`), actionButton("查看报价单", "preview-quote", quote.id));
    quotes.append(version);
  }

  const timeline = element("section", "", "admin-detail-section");
  timeline.append(element("h3", "操作时间线"));
  for (const event of item.timeline) timeline.append(stacked(event.detail || event.action, `${event.operator} · ${dateTime(event.createdAt)}`));

  openDrawer(
    item.inquiryNumber,
    actions,
    detailSection("客户与交付", [["客户", item.contactName], ["手机号", item.phone], ["地区", item.region], ["详细地址", item.address], ["提交时间", dateTime(item.createdAt)], ["负责人", item.claimedBy]]),
    detailSection("完整需求", [["描述", item.description], ["材料", item.material], ["尺寸", item.dimensions], ["数量", item.quantity], ["期望交期", item.expectedDate]]),
    attachments, quotes, timeline
  );
  state.detail = { type: "inquiry", id: Number(id) };
  state.detailItem = item;
}

function paymentProofCard(payment, compact = false) {
  const card = element("div", "", `admin-proof-card${compact ? " compact" : ""}`);
  if (!payment.proofPreviewUrl) {
    card.append(element("p", "未上传付款凭证", "admin-empty"));
    return card;
  }
  const extension = payment.proofName.split(".").pop().toLowerCase();
  const preview = element("button", "", "admin-proof-preview");
  preview.type = "button";
  preview.dataset.action = "preview-payment-proof";
  preview.dataset.fileName = payment.proofName;
  preview.dataset.previewUrl = payment.proofPreviewUrl;
  preview.dataset.downloadUrl = payment.proofUrl;
  if (["jpg", "jpeg", "png", "webp"].includes(extension)) {
    const image = document.createElement("img");
    image.src = payment.proofPreviewUrl;
    image.alt = `${payment.orderNumber || "订单"}付款凭证`;
    image.loading = "lazy";
    image.className = "admin-proof-thumbnail";
    image.addEventListener("error", () => preview.replaceChildren(element("span", "凭证加载失败，请下载查看")));
    preview.append(image);
  } else {
    preview.append(element("span", `预览 PDF：${payment.proofName}`));
  }
  const download = element("a", "下载原文件", "button button-small button-ghost");
  download.href = payment.proofUrl;
  download.download = payment.proofName;
  card.append(preview, download);
  return card;
}

async function openOrder(id) {
  const item = await api(`/api/admin/orders/${id}`);
  const actions = element("div", "", "admin-detail-actions");
  const registrationState = paymentRegistrationState(item.payment);
  if (["initial", "followup"].includes(registrationState)) actions.append(actionButton(registrationState === "initial" ? "登记收款" : "登记后续收款", "register-payment", id, true));
  if (registrationState === "pending") {
    const pending = actionButton("已有收款待核验", "payment-pending", id);
    pending.disabled = true;
    actions.append(pending);
  }
  if (registrationState === "paid") actions.append(element("span", "已全部收款", "admin-badge status-verified"));
  if (item.actions.canSchedule && state.session.user.role === "super_admin") {
    if (["not_ready", "awaiting_confirmation"].includes(item.boboSyncStatus)) actions.append(actionButton("手动补提波波", "sync-bobo", id));
    if (["retrying", "failed"].includes(item.boboSyncStatus)) actions.append(actionButton("重试波波同步", "retry-bobo", id));
  }
  if (state.session.user.role === "super_admin") {
    const next = { awaiting_schedule: ["production", "进入生产"], production: ["quality", "进入质检"], quality: ["ready", "进入待交付"], ready: ["shipped", "确认已发货"], shipped: ["completed", "确认已完成"] }[item.status];
    if (next) actions.append(actionButton(next[1], "advance-order", `${id}:${next[0]}`));
  }

  const paymentList = element("section", "", "admin-detail-section");
  paymentList.append(element("h3", "收款记录"));
  for (const payment of item.payments) {
    const record = stacked(`${money(payment.amount)} · ${labels[payment.status] || payment.status}`, `${payment.paymentMethod} · ${payment.payerName} · ${dateTime(payment.receivedAt)}${payment.note ? ` · ${payment.note}` : ""}`);
    record.append(paymentProofCard({ ...payment, orderNumber: item.orderNumber }, true));
    paymentList.append(record);
  }

  const attachments = element("section", "", "admin-detail-section");
  const frozenAttachments = item.requirement.attachments || [];
  attachments.append(element("h3", `冻结图纸附件（${frozenAttachments.length}）`));
  const files = element("div", "", "admin-file-list");
  for (const file of frozenAttachments) files.append(attachmentRow(file));
  attachments.append(files.childElementCount ? files : element("p", "未上传附件", "admin-empty"));

  const timeline = element("section", "", "admin-detail-section");
  timeline.append(element("h3", "履约时间线"));
  for (const event of item.events) timeline.append(stacked(labels[event.status] || event.status, `${event.title} · ${dateTime(event.occurredAt)}`));

  const processTimeline = element("section", "", "admin-detail-section");
  processTimeline.append(element("h3", "工序进度"));
  for (const process of item.processes || []) {
    const timing = [process.startedAt ? `开始 ${dateTime(process.startedAt)}` : "", process.completedAt ? `完成 ${dateTime(process.completedAt)}` : ""].filter(Boolean).join(" · ");
    processTimeline.append(stacked(`${process.sequence}. ${process.name} · ${process.status}`, timing || "尚无时间记录"));
  }
  if (!item.processes?.length) processTimeline.append(element("p", "尚无工序回传", "admin-empty"));

  const audit = element("section", "", "admin-detail-section");
  audit.append(element("h3", "审计记录"));
  for (const event of item.audit) audit.append(stacked(auditActionLabel(event.action), `${event.operator} · ${formatAuditDetail(event.detail)} · ${dateTime(event.createdAt)}`));

  openDrawer(
    item.orderNumber,
    actions,
    detailSection("订单信息", [["来源询价", item.inquiryNumber], ["客户", item.contactName], ["手机号", item.phone], ["地区", item.region], ["详细地址", item.address], ["履约状态", labels[item.status] || item.status], ["当前工序", item.currentProcess], ["波波同步", boboLabels[item.boboSyncStatus] || item.boboSyncStatus]]),
    detailSection("确认报价", [["报价版本", `V${item.quote.version || "—"}`], ["报价金额", money(item.quote.amount)], ["有效期", item.quote.validUntil], ["确认人", item.quote.operator]]),
    detailSection("冻结需求", [["描述", item.requirement.description], ["材料", item.requirement.material], ["厚度", item.requirement.thickness], ["尺寸", item.requirement.dimensions], ["加工工艺", item.requirement.process], ["数量", item.requirement.quantity], ["交期", item.requirement.expectedDate], ["技术要求", item.requirement.technicalRequirements], ["备注", item.requirement.remark]]),
    detailSection("付款汇总", [["付款条件", item.payment.mode === "deposit" ? "定金后开工，发货前付清" : "全款后开工"], ["订单总额", money(item.payment.totalAmount)], ["约定开工款", money(item.payment.startAmount)], ["已确认到账", money(item.payment.verifiedAmount)], ["待核验", money(item.payment.pendingAmount)], ["剩余未收", money(item.payment.remainingAmount)]]),
    attachments, paymentList, processTimeline, timeline, audit
  );
  state.detail = { type: "order", id: Number(id) };
  state.detailItem = item;
}

function currencyUppercase(value) {
  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const units = ["", "拾", "佰", "仟", "万", "拾", "佰", "仟", "亿"];
  const cents = Math.round(Number(value) * 100);
  let integer = Math.floor(cents / 100);
  if (!integer && !cents) return "人民币零元整";
  let text = "";
  let zero = false;
  let index = 0;
  while (integer) {
    const digit = integer % 10;
    if (digit) { text = digits[digit] + units[index] + (zero ? "零" : "") + text; zero = false; }
    else if (text) zero = true;
    integer = Math.floor(integer / 10);
    index += 1;
  }
  text = text.replace(/零+(万|亿)/g, "$1").replace(/亿万/g, "亿").replace(/零+/g, "零");
  const fraction = cents % 100;
  if (!fraction) return `人民币${text}元整`;
  return `人民币${text}元${Math.floor(fraction / 10) ? `${digits[Math.floor(fraction / 10)]}角` : ""}${fraction % 10 ? `${digits[fraction % 10]}分` : ""}`;
}

function closePreview() {
  byId("preview-dialog").close();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = "";
  state.dxfPreview = null;
  byId("preview-content").replaceChildren();
}

function openPreview(title, content, downloadUrl, downloadName, objectUrl = "") {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = objectUrl;
  state.dxfPreview = null;
  byId("preview-title").textContent = title;
  byId("preview-content").replaceChildren(content);
  const download = byId("preview-download");
  download.href = downloadUrl;
  download.download = downloadName;
  for (const id of ["preview-fit", "preview-zoom-in", "preview-zoom-out"]) byId(id).hidden = true;
  if (!byId("preview-dialog").open) byId("preview-dialog").showModal();
}

function drawDxfPreview() {
  const preview = state.dxfPreview;
  if (!preview) return;
  const { canvas, drawing, zoom } = preview;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const spanX = Math.max(1, drawing.bounds.maxX - drawing.bounds.minX);
  const spanY = Math.max(1, drawing.bounds.maxY - drawing.bounds.minY);
  const scale = Math.min((width - 80) / spanX, (height - 80) / spanY) * zoom;
  const centerX = (drawing.bounds.minX + drawing.bounds.maxX) / 2;
  const centerY = (drawing.bounds.minY + drawing.bounds.maxY) / 2;
  const point = (x, y) => ({ x: width / 2 + (x - centerX) * scale, y: height / 2 - (y - centerY) * scale });
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
  context.strokeStyle = "#0e1a24"; context.lineWidth = 1.5;
  for (const entity of drawing.entities) {
    context.beginPath();
    if (entity.type === "line") { const start = point(entity.x1, entity.y1); const end = point(entity.x2, entity.y2); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); }
    if (entity.type === "polyline") {
      entity.points.forEach((item, index) => { const current = point(item.x, item.y); if (index) context.lineTo(current.x, current.y); else context.moveTo(current.x, current.y); });
      if (entity.closed) context.closePath();
    }
    if (entity.type === "circle") { const center = point(entity.x, entity.y); context.arc(center.x, center.y, entity.radius * scale, 0, Math.PI * 2); }
    if (entity.type === "arc") { const center = point(entity.x, entity.y); context.arc(center.x, center.y, entity.radius * scale, -entity.start * Math.PI / 180, -entity.end * Math.PI / 180, true); }
    context.stroke();
  }
}

async function previewAttachment(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const supportedImages = ["jpg", "jpeg", "png", "webp"];
  if (supportedImages.includes(extension)) {
    const image = document.createElement("img");
    image.src = file.previewUrl; image.alt = file.name; image.className = "admin-preview-image";
    openPreview(file.name, image, file.downloadUrl, file.name);
    return;
  }
  if (extension === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = file.previewUrl; frame.title = file.name; frame.className = "admin-preview-pdf";
    openPreview(file.name, frame, file.downloadUrl, file.name);
    return;
  }
  if (extension === "dxf") {
    const loading = element("p", "正在解析 DXF…", "admin-preview-message");
    openPreview(file.name, loading, file.downloadUrl, file.name);
    try {
      const drawing = parseDxf(await api(file.previewUrl));
      const canvas = document.createElement("canvas");
      canvas.width = 1200; canvas.height = 800; canvas.className = "admin-preview-dxf";
      byId("preview-content").replaceChildren(canvas);
      state.dxfPreview = { canvas, drawing, zoom: 1 };
      for (const id of ["preview-fit", "preview-zoom-in", "preview-zoom-out"]) byId(id).hidden = false;
      drawDxfPreview();
    } catch (error) {
      byId("preview-content").replaceChildren(element("p", `${error.message}，请下载后使用专业软件查看。`, "admin-preview-message"));
    }
    return;
  }
  openPreview(file.name, element("p", "该格式暂不支持在线预览，请下载后使用专业软件查看。", "admin-preview-message"), file.downloadUrl, file.name);
}

async function previewReceipt(paymentId) {
  const receipt = await api(`/api/admin/payments/${paymentId}/receipt`, { method: "POST", body: "{}" });
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 1000;
  const context = canvas.getContext("2d");
  drawReceipt(context, { ...receipt, amountText: `${money(receipt.amount)}（${currencyUppercase(receipt.amount)}）`, receivedAtText: dateTime(receipt.receivedAt) });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("收据图片生成失败");
  const url = URL.createObjectURL(blob);
  const image = document.createElement("img");
  image.src = url; image.alt = `${receipt.receiptNumber} 收据`; image.className = "admin-preview-image admin-receipt-preview";
  openPreview(`${receipt.receiptNumber} 收据`, image, url, `${receipt.receiptNumber}.png`, url);
}

async function previewQuote(quoteId) {
  const inquiry = state.detailItem;
  const quote = inquiry?.quotes?.find((item) => String(item.id) === String(quoteId));
  if (!quote) throw new Error("报价版本不存在，请刷新后重试");
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 1200;
  drawQuoteSheet(canvas.getContext("2d"), {
    companyName: "宁波未来机械制造有限公司",
    inquiryNumber: inquiry.inquiryNumber,
    version: quote.version,
    customerName: inquiry.contactName,
    quotedAtText: dateTime(quote.createdAt),
    amountText: money(quote.amount),
    validUntil: quote.validUntil,
    paymentTerms: quote.paymentMode === "deposit" ? "定金后开工，发货前付清" : "全款后开工",
    startAmountText: money(quote.startAmount),
    specification: quote.specification
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("报价单图片生成失败");
  const url = URL.createObjectURL(blob);
  const fileName = `${inquiry.inquiryNumber}-V${quote.version}-报价单.png`;
  const image = document.createElement("img");
  image.src = url; image.alt = fileName; image.className = "admin-preview-image admin-quote-preview";
  openPreview(`${inquiry.inquiryNumber} V${quote.version} 报价单`, image, url, fileName, url);
}

async function filePayload(file) {
  if (!file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { name: file.name, content: btoa(binary) };
}

function openQuote(id) {
  const form = byId("quote-form");
  form.reset();
  form.elements.inquiryId.value = id;
  const values = quoteFormValues(state.detailItem || {});
  for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
  showFormResult("quote-result");
  byId("quote-dialog").showModal();
}

function openPayment(id) {
  const form = byId("payment-form");
  form.reset();
  form.elements.orderId.value = id;
  showFormResult("payment-result");
  byId("payment-dialog").showModal();
}

function actionSummary(entries) {
  const summary = byId("action-summary");
  summary.replaceChildren();
  for (const [label, value] of entries) summary.append(element("dt", label), element("dd", value || "—"));
}

function openAction(kind, id) {
  const form = byId("action-form");
  form.reset();
  const definition = adminActionDefinition(kind);
  const payment = state.payments.get(String(id));
  const detail = state.detailItem;
  state.action = { kind, id: String(id), payment, reasonRequired: definition.reasonRequired };
  byId("action-title").textContent = definition.title;
  byId("action-description").textContent = definition.description;
  byId("action-submit").textContent = definition.confirmLabel;
  const reasonWrap = byId("action-reason-wrap");
  reasonWrap.hidden = !definition.reasonRequired;
  byId("action-reason-label").textContent = definition.reasonLabel || "操作原因";
  form.elements.reason.required = false;
  const entries = [];
  if (kind.endsWith("payment") && payment) {
    entries.push(["订单", payment.orderNumber], ["金额", money(payment.amount)], ["付款方", payment.payerName], ["付款方式", payment.paymentMethod], ["到账时间", dateTime(payment.receivedAt)]);
  } else if (kind === "advance-order") {
    const [, status] = String(id).split(":");
    state.action.status = status;
    entries.push(["订单", detail?.orderNumber], ["原状态", labels[detail?.status]], ["目标状态", labels[status]]);
  } else {
    const referenceLabel = ["create-order", "close-inquiry"].includes(kind) ? "询价" : "订单";
    entries.push([referenceLabel, detail?.inquiryNumber || detail?.orderNumber || `#${id}`]);
  }
  actionSummary(entries);
  byId("action-proof").replaceChildren(kind.endsWith("payment") && payment ? paymentProofCard(payment) : document.createDocumentFragment());
  showFormResult("action-result");
  byId("action-dialog").showModal();
  byId("action-submit").focus();
}

async function submitAction(reason) {
  const { kind, id, status } = state.action;
  if (kind === "create-order") {
    const created = await api(`/api/admin/inquiries/${id}/order-confirmation`, { method: "POST", body: "{}" });
    closeDrawer();
    await setView("orders");
    return `已生成正式订单 ${created.orderNumber}`;
  }
  if (kind === "close-inquiry") {
    await api(`/api/admin/inquiries/${id}/close`, { method: "POST", body: JSON.stringify({ reason }) });
    closeDrawer();
    await loadView(state.view);
    return "询价已关闭";
  }
  if (kind.endsWith("payment")) {
    const action = kind.split("-")[0];
    const result = await api(`/api/admin/payments/${id}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
    await refreshCurrentView();
    if (kind === "verify-payment") return paymentVerificationMessage(result);
    return "收款状态已更新";
  }
  if (["sync-bobo", "retry-bobo"].includes(kind)) {
    const endpoint = kind === "sync-bobo" ? `/api/admin/orders/${id}/bobo-confirm` : `/api/admin/orders/${id}/bobo-retry`;
    await api(endpoint, { method: "POST", body: "{}" });
    await loadOrders();
    await openOrder(id);
    return kind === "sync-bobo" ? "已提交波波同步" : "已提交同步重试";
  }
  if (kind === "advance-order") {
    const orderId = id.split(":")[0];
    await api(`/api/admin/orders/${orderId}/events`, { method: "POST", body: JSON.stringify({ status, title: labels[status], reason }) });
    await loadOrders();
    await openOrder(orderId);
    return `订单已更新为${labels[status]}`;
  }
  throw new Error("未知后台操作");
}

document.addEventListener("click", async (event) => {
  const navigation = event.target.closest("[data-view]");
  if (navigation) return setView(navigation.dataset.view);
  const shortcut = event.target.closest("[data-go]");
  if (shortcut) return setView(shortcut.dataset.go);
  const inquiry = event.target.closest("[data-open-inquiry], [data-action='open-inquiry']");
  if (inquiry) return openInquiry(inquiry.dataset.openInquiry || inquiry.dataset.id).catch((error) => showNotice(error.message, true));
  const order = event.target.closest("[data-open-order], [data-action='open-order']");
  if (order) return openOrder(order.dataset.openOrder || order.dataset.id).catch((error) => showNotice(error.message, true));
  const target = event.target.closest("[data-action]");
  if (!target) return;
  try {
    if (target.dataset.action === "claim-inquiry") { await api(`/api/admin/inquiries/${target.dataset.id}/claim`, { method: "POST", body: "{}" }); await openInquiry(target.dataset.id); }
    if (target.dataset.action === "quote-inquiry") openQuote(target.dataset.id);
    if (["create-order", "close-inquiry"].includes(target.dataset.action)) openAction(target.dataset.action, target.dataset.id);
    if (target.dataset.action === "register-payment") openPayment(target.dataset.id);
    if (["verify-payment", "reject-payment", "void-payment"].includes(target.dataset.action)) openAction(target.dataset.action, target.dataset.id);
    if (["preview-attachment", "preview-payment-proof"].includes(target.dataset.action)) await previewAttachment({ name: target.dataset.fileName, previewUrl: target.dataset.previewUrl, downloadUrl: target.dataset.downloadUrl });
    if (target.dataset.action === "preview-quote") await previewQuote(target.dataset.id);
    if (target.dataset.action === "receipt") await previewReceipt(target.dataset.id);
    if (["sync-bobo", "retry-bobo", "advance-order"].includes(target.dataset.action)) openAction(target.dataset.action, target.dataset.id);
    if (target.dataset.action === "search-customer") { setView("orders"); byId("order-filter").elements.search.value = target.dataset.id; await loadOrders(); }
  } catch (error) { showNotice(error.message, true); }
});

for (const formId of ["inquiry-filter", "order-filter", "payment-filter"]) {
  byId(formId).addEventListener("submit", (event) => { event.preventDefault(); state.refreshController.run(); });
}

byId("quote-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  showFormResult("quote-result");
  try {
    const specification = {};
    for (const name of ["requirement", "material", "thickness", "dimensions", "process", "quantity", "expectedDate", "technicalRequirements", "remark"]) specification[name] = name === "quantity" ? Number(form.elements[name].value) : form.elements[name].value.trim();
    await api(`/api/admin/inquiries/${form.elements.inquiryId.value}/quotes`, { method: "POST", body: JSON.stringify({ amount: Number(form.elements.amount.value), validUntil: form.elements.validUntil.value, paymentMode: form.elements.paymentMode.value, startAmount: Number(form.elements.startAmount.value), confirmed: true, specification }) });
    byId("quote-dialog").close();
    await openInquiry(form.elements.inquiryId.value);
    showNotice("报价已确认，可在报价版本中查看报价单");
  } catch (error) { showFormResult("quote-result", error.message, true); }
  finally { submit.disabled = false; }
});

byId("quote-form").elements.paymentMode.addEventListener("change", (event) => {
  const form = event.currentTarget.form;
  if (event.currentTarget.value === "full") form.elements.startAmount.value = form.elements.amount.value;
});
byId("quote-form").elements.amount.addEventListener("input", (event) => {
  const form = event.currentTarget.form;
  if (form.elements.paymentMode.value === "full") form.elements.startAmount.value = event.currentTarget.value;
});
byId("payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = event.submitter;
  submit.disabled = true;
  showFormResult("payment-result");
  try {
    const proof = await filePayload(form.elements.proof.files[0]);
    await api(`/api/admin/orders/${form.elements.orderId.value}/payments`, { method: "POST", body: JSON.stringify({ amount: Number(form.elements.amount.value), paymentMethod: form.elements.paymentMethod.value, receivedAt: form.elements.receivedAt.value, payerName: form.elements.payerName.value, note: form.elements.note.value, proof }) });
    byId("payment-dialog").close();
    await openOrder(form.elements.orderId.value);
    showNotice("收款已登记，等待超级管理员核验");
  } catch (error) { showFormResult("payment-result", error.message, true); }
  finally { submit.disabled = false; }
});

byId("action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = event.submitter;
  if (!state.action || submit !== byId("action-submit")) return;
  const reason = form.elements.reason.value.trim();
  if (state.action.reasonRequired && !reason) {
    showFormResult("action-result", "请填写操作原因或更新依据", true);
    form.elements.reason.focus();
    return;
  }
  submit.disabled = true;
  const originalLabel = submit.textContent;
  submit.textContent = "处理中…";
  showFormResult("action-result");
  try {
    const message = await submitAction(reason);
    byId("action-dialog").close();
    showNotice(message);
  } catch (error) { showFormResult("action-result", error.message, true); }
  finally { submit.disabled = false; submit.textContent = originalLabel; }
});

document.querySelectorAll("[data-dialog-close]").forEach((item) => item.addEventListener("click", () => item.closest("dialog").close()));
byId("action-dialog").addEventListener("close", () => { state.action = null; });
document.querySelectorAll("[data-preview-close]").forEach((item) => item.addEventListener("click", closePreview));
byId("preview-dialog").addEventListener("close", () => {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = "";
  state.dxfPreview = null;
});
byId("preview-fit").addEventListener("click", () => { if (state.dxfPreview) { state.dxfPreview.zoom = 1; drawDxfPreview(); } });
byId("preview-zoom-in").addEventListener("click", () => { if (state.dxfPreview) { state.dxfPreview.zoom = Math.min(4, state.dxfPreview.zoom * 1.25); drawDxfPreview(); } });
byId("preview-zoom-out").addEventListener("click", () => { if (state.dxfPreview) { state.dxfPreview.zoom = Math.max(.25, state.dxfPreview.zoom / 1.25); drawDxfPreview(); } });
byId("detail-close").addEventListener("click", closeDrawer);
byId("admin-detail-backdrop").addEventListener("click", closeDrawer);
byId("admin-menu").addEventListener("click", () => document.body.classList.toggle("admin-nav-open"));
byId("admin-refresh").addEventListener("click", () => state.refreshController?.run());
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !document.querySelector("dialog[open]") && !byId("admin-detail").hidden) closeDrawer(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") state.refreshController?.run(); });
window.addEventListener("focus", () => state.refreshController?.run());
byId("admin-logout").addEventListener("click", async () => { state.refreshController?.stop(); await api("/api/admin/auth/logout", { method: "POST", body: "{}" }); location.reload(); });

async function initialize() {
  try {
    state.session = await api("/api/admin/auth/session");
    byId("admin-auth").hidden = true;
    byId("admin-workspace").hidden = false;
    byId("admin-user").querySelector("strong").textContent = state.session.user.name;
    byId("admin-role").textContent = state.session.user.role === "super_admin" ? "超级管理员" : "客服";
    state.refreshController = createRefreshController({
      refresh: refreshCurrentView,
      canRefresh: () => Boolean(state.session) && document.visibilityState === "visible" && state.pendingWrites === 0,
      onUpdated: updatedNow,
      onError: (error) => showNotice(`自动刷新失败：${error.message}`, true)
    });
    state.refreshController.start();
    setView("dashboard");
  } catch {
    byId("admin-auth").hidden = false;
    byId("admin-workspace").hidden = true;
  }
}

initialize();
