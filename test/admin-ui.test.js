const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "../public/admin.js"), "utf8");
const tools = fs.readFileSync(path.join(__dirname, "../public/admin-tools.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");

test("provides the six-part industrial operations navigation", () => {
  for (const label of ["工作台", "询价管理", "订单管理", "收款管理", "客户档案", "异常待办"]) assert.match(html, new RegExp(label));
  for (const view of ["dashboard", "inquiries", "orders", "payments", "customers", "todos"]) assert.match(html, new RegExp(`data-view="${view}"`));
  assert.match(html, /class="admin-sidebar"/);
  assert.match(html, /id="admin-detail"/);
  assert.match(html, /aria-modal="true"/);
});

test("shows all operational dashboard queues and searchable management tables", () => {
  for (const label of ["待认领询价", "已报价待客户确认", "已建单待收款", "收款待核验", "定金已收待排产", "尾款待收", "波波同步异常", "即将交付订单", "今日完成订单"]) assert.match(script, new RegExp(label));
  for (const id of ["inquiry-table", "order-table", "payment-table", "customer-table", "todo-table"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /name="search"/);
  assert.match(html, /name="from"/);
  assert.match(html, /name="to"/);
});

test("shows the current bobo process separately from fulfillment status", () => {
  assert.match(html, /<th>当前工序<\/th>/);
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
  for (const field of ["requirement", "material", "thickness", "dimensions", "process", "quantity", "expectedDate", "technicalRequirements", "remark"]) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(script, /actionButton\("查看报价单", "preview-quote"/);
  assert.match(script, /previewQuote/);
  assert.match(script, /drawQuoteSheet/);
  assert.match(script, /quoteFormValues/);
  assert.match(tools, /boboAutoSubmitted/);
  assert.match(script, /pending:\s*"待同步"/);
  assert.match(script, /\["厚度", item\.requirement\.thickness\]/);
  assert.match(script, /\["加工工艺", item\.requirement\.process\]/);
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
  assert.match(html, /src="\/admin-tools\.js"/);
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
