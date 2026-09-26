const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "../public/admin.js"), "utf8");
const tools = fs.readFileSync(path.join(__dirname, "../public/admin-tools.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");

test("provides the seven-part industrial operations navigation", () => {
  for (const label of ["工作台", "询价管理", "订单管理", "历史订单", "收款管理", "客户档案", "异常待办"]) assert.match(html, new RegExp(label));
  for (const view of ["dashboard", "inquiries", "orders", "history", "payments", "customers", "todos"]) assert.match(html, new RegExp(`data-view="${view}"`));
  assert.match(html, /class="admin-sidebar"/);
  assert.match(html, /id="admin-detail"/);
  assert.match(html, /aria-modal="true"/);
});

test("shows all operational dashboard queues and searchable management tables", () => {
  for (const label of ["待认领询价", "已报价待客户确认", "已建单待收款", "收款待核验", "定金已收待排产", "尾款待收", "波波同步异常", "待配送订单", "今日送达订单"]) assert.match(script, new RegExp(label));
  for (const id of ["inquiry-table", "order-table", "history-table", "payment-table", "customer-table", "todo-table"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="admin-context"/);
  assert.match(script, /buildAdminHash/);
  assert.match(script, /parseAdminHash/);
  assert.match(html, /name="search"/);
  assert.match(html, /name="from"/);
  assert.match(html, /name="to"/);
});

test("keeps an explicit order overview beside precise task scopes", () => {
  for (const label of ["全部履约中", "待收款", "待排产", "尾款待收", "待配送"]) assert.match(html, new RegExp(label));
  assert.match(html, /data-order-scope="all"/);
  assert.match(script, /createOrderScopeController/);
  assert.doesNotMatch(html, /data-clear-context/);
  assert.doesNotMatch(script, /data-clear-context/);
  assert.match(html, /<button type="button" data-order-scope="all">全部履约中<\/button>/);
  assert.match(html, /<button type="button" data-order-scope="awaiting_payment">待收款<\/button>/);
  assert.doesNotMatch(html.match(/<section class="admin-view" data-panel="orders">[\s\S]*?<\/section>/)?.[0] || "", /data-reset-filter/);
  assert.match(script, /addEventListener\("hashchange"/);
  assert.match(script, /clicked\.closest\("\[data-order-scope\]"\)/);
  assert.doesNotMatch(script, /querySelectorAll\("\[data-order-scope\]"\)\.forEach\(\(button\) => button\.addEventListener/);
  const scopeBusyHandler = script.match(/function setOrderScopeBusy\(busy\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(scopeBusyHandler, /\.disabled\s*=/);
  assert.doesNotMatch(styles, /\.admin-scope-nav \.is-busy\s*\{[^}]*pointer-events:\s*none/);
  assert.match(script, /function applyViewParams\(view, params = \{\}\) \{[\s\S]*?for \(const control of form\.elements\) \{\s*if \(!control\.name\) continue;\s*control\.value = "";/);
  assert.doesNotMatch(script.match(/function applyViewParams\(view, params = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || "", /form\.reset\(\)/);
});

test("uses the compact order overview with one clear-state entry per list", () => {
  const orderSection = html.match(/<section class="admin-view" data-panel="orders">([\s\S]*?)<\/section>/)?.[1] || "";
  const orderHeader = orderSection.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] || "";
  assert.equal((orderHeader.match(/<th>/g) || []).length, 7);
  for (const label of ["履约状态 / 当前工序", "应收金额 / 已收金额 / 未收金额", "波波同步"]) assert.match(orderHeader, new RegExp(label));
  assert.match(script, /money\(item\.payment\.totalAmount\)/);
  assert.match(script, /money\(item\.payment\.verifiedAmount\)/);
  assert.match(script, /money\(item\.payment\.remainingAmount\)/);
  assert.match(script, /labeledCell\("履约状态 \/ 当前工序"/);
  assert.match(styles, /\.admin-table td\[data-label\]::before\s*\{\s*content:\s*attr\(data-label\)/);
  assert.doesNotMatch(script, /function handleClearContextClick/);
  assert.doesNotMatch(script, /clear\.dataset\.clearContext/);
  assert.match(script, /empty\.colSpan\s*=\s*columnCount/);
  assert.equal((html.match(/data-reset-filter/g) || []).length, 4);
  assert.match(script, /setView\(state\.view\)\)/);
});

test("turns priority tasks and bobo todos into precise actionable entries", () => {
  assert.match(script, /priorityTaskTarget/);
  assert.match(script, /data-priority-task/);
  assert.match(html, /id="todo-table"[\s\S]*?<th>操作<\/th>/);
  assert.match(script, /actionButton\("查看订单", "open-order"/);
});

test("shows the current bobo process separately from fulfillment status", () => {
  assert.match(html, /履约状态 \/ 当前工序/);
  assert.match(script, /admin-order-fulfillment/);
  assert.match(script, /item\.currentProcess/);
  assert.match(script, /\["当前工序", item\.currentProcess\]/);
});

test("renders the complete bobo process timeline in the order drawer", () => {
  assert.match(script, /工序进度/);
  assert.match(script, /item\.processes/);
  assert.match(script, /process\.startedAt/);
  assert.match(script, /process\.completedAt/);
});

test("renders server data as text and includes responsive drawer behavior", () => {
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.match(script, /textContent/);
  assert.match(script, /Escape/);
  assert.match(styles, /\.admin-drawer/);
  assert.match(styles, /@media \(max-width: 768px\)/);
  assert.match(styles, /min-height:\s*44px/);
});

test("offers a PNG receipt only for verified payments", () => {
  assert.match(script, /item\.status === "verified"/);
  assert.match(script, /actionButton\("收据", "receipt"/);
  assert.match(tools, /receipt\.companyName/);
  assert.match(script, /canvas\.toBlob\(resolve, "image\/png"\)/);
  assert.match(tools, /本收据仅作为本次款项到账凭证，不替代发票/);
});

test("creates editable versioned quote sheets in the shared preview dialog", () => {
  for (const field of ["requirement", "material", "thickness", "dimensions", "otherProcess", "quantity", "expectedDate", "remark"]) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  for (const process of ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "机加", "打磨", "喷塑", "装配", "质检"]) assert.match(html, new RegExp(`value="${process}"`));
  assert.match(html, /id="quote-process-preview"/);
  assert.match(html, /id="quote-process-preview" class="admin-process-preview admin-field-full"/);
  assert.match(html, /styles\.css\?v=20260925-admin-controls-v10/);
  assert.match(html, /admin-tools\.js\?v=20260925-admin-controls-v7/);
  assert.match(html, /admin\.js\?v=20260925-admin-controls-v10/);
  assert.match(html, />加工需求<textarea/);
  assert.doesNotMatch(html, />技术要求<textarea/);
  assert.doesNotMatch(html, />需求与技术要求<textarea/);
  assert.match(html, /class="admin-quote-layout"/);
  assert.match(styles, /\.admin-quote-layout\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.admin-quote-dialog\s*\{[^}]*width:\s*min\(760px,/);
  assert.match(styles, /\.admin-quote-group\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.admin-quote-fields,[\s\S]*?\.admin-quote-commercial\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /\.admin-quote-dialog \.admin-quote-fields > \.admin-field-full\s*\{[^}]*grid-column:\s*1\s*\/\s*span 2/);
  assert.match(styles, /\.admin-quote-fields > \*,[\s\S]*?\.admin-quote-commercial > \*\s*\{[^}]*min-width:\s*0/);
  assert.match(styles, /\.admin-quote-dialog \.admin-form\s*\{[^}]*width:\s*100%/);
  assert.match(styles, /\.admin-quote-fields,\s*\.admin-quote-commercial\s*\{[^}]*width:\s*100%/);
  assert.match(script, /actionButton\("查看报价单", "preview-quote"/);
  assert.match(script, /previewQuote/);
  assert.match(script, /drawQuoteSheet/);
  assert.match(script, /quoteFormValues/);
  assert.match(tools, /boboAutoSubmitted/);
  assert.match(script, /pending:\s*"待同步"/);
  assert.match(script, /\["厚度", item\.requirement\.thickness\]/);
  assert.match(script, /\["加工工艺", item\.requirement\.process\]/);
});

test("opens customer correspondence in a customer drawer instead of a broad order search", () => {
  assert.match(script, /openCustomer/);
  assert.match(script, /\/api\/admin\/customers\/detail\?phone=/);
  assert.doesNotMatch(script, /dataset\.action === "search-customer"/);
});

test("provides manual refresh status and one reusable preview dialog", () => {
  assert.match(html, /id="admin-refresh"/);
  assert.match(html, /id="admin-updated-at"/);
  assert.match(html, /id="preview-dialog"/);
  assert.match(html, /id="preview-content"/);
  assert.match(html, /id="preview-download"/);
  assert.match(html, /id="preview-fit"/);
  assert.match(html, /id="preview-zoom-in"/);
  assert.match(html, /id="preview-zoom-out"/);
  assert.match(html, /src="\/admin-tools\.js(?:\?[^\"]+)?"/);
});

test("opens attachments and receipts in preview before downloading", () => {
  assert.match(script, /previewAttachment/);
  assert.match(script, /previewReceipt/);
  assert.match(script, /dataset\.action = "preview-attachment"/);
  assert.match(script, /previewUrl/);
  assert.match(script, /downloadUrl/);
  assert.match(script, /createObjectURL/);
  assert.match(script, /preview-download/);
});

test("refreshes on focus and visibility changes without replacing active writes", () => {
  assert.match(script, /createRefreshController/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /window\.addEventListener\("focus"/);
  assert.match(script, /pendingWrites/);
  assert.match(script, /admin-updated-at/);
});

test("payment registration and high-risk actions show errors inside centered dialogs", () => {
  assert.match(html, /id="payment-form"[\s\S]*?<button class="button" type="submit">提交待核验<\/button>/);
  assert.match(html, /id="payment-result"[^>]*aria-live="polite"/);
  assert.match(html, /id="action-dialog"[^>]*aria-labelledby="action-title"/);
  assert.match(html, /id="action-form"[\s\S]*?id="action-summary"[\s\S]*?id="action-proof"/);
  assert.match(html, /id="action-result"[^>]*aria-live="polite"/);
  assert.match(script, /showFormResult\("payment-result", error\.message, true\)/);
  assert.match(script, /showFormResult\("action-result", error\.message, true\)/);
  assert.doesNotMatch(script, /\b(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
  assert.match(script, /await loadView\(state\.view\)/);
});

test("renders payment proof thumbnails and Chinese audit records", () => {
  assert.match(script, /proofPreviewUrl/);
  assert.match(script, /admin-proof-thumbnail/);
  assert.match(script, /preview-payment-proof/);
  assert.match(script, /auditActionLabel/);
  assert.match(script, /formatAuditDetail/);
});

test("offers a retry action when bobo synchronization has failed", () => {
  assert.match(script, /\["retrying", "failed"\]/);
  assert.match(script, /actionButton\("重试波波同步", "retry-bobo"/);
  assert.match(script, /\/bobo-retry/);
});
