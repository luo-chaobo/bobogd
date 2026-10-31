const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const reportTemplate = fs.readFileSync(path.join(root, "miniprogram", "pages", "report", "report.wxml"), "utf8").replace(/\r\n/g, "\n");
const reportStyle = fs.readFileSync(path.join(root, "miniprogram", "pages", "report", "report.wxss"), "utf8");

assert.ok(app.includes("创建时间 ${escapeHtml(formatDateTime(w.order?.createdAt || w.createdAt))}"), "派工卡片必须显示工单创建时间");
assert.ok(/<textarea class="compact-textarea"[^>]*data-key="note"/.test(reportTemplate), "备注必须使用紧凑文本框");
assert.ok(reportTemplate.includes('class="compact-textarea"\n        value="{{form.exceptionDescription}}"'), "异常说明必须使用紧凑文本框");
assert.ok(reportStyle.includes(".compact-textarea"), "紧凑文本框必须有独立高度规则");
assert.ok(reportStyle.includes("min-height: 150rpx"), "紧凑文本框高度必须适合一屏提交");

console.log("dispatch-created-and-report-compact-ui: ok");
