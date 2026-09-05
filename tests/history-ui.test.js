const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert.ok(source.includes('["history", "历史查询"]'), "左侧菜单必须包含历史查询");
assert.ok(source.includes("/api/history/work-orders"), "历史查询页面必须调用历史工单接口");
assert.ok(source.includes("data-history-detail"), "历史查询页面必须提供聚合异常详情入口");
assert.ok(source.includes("attachmentGroupButton"), "图纸和问题图片必须使用统一附件组入口");
assert.ok(source.includes("后台质检报工"), "异常返工页面必须提供后台质检报工入口");
assert.ok(source.includes("创建时间"), "历史查询必须支持按创建时间筛选");
assert.ok(source.includes("完工时间"), "历史查询必须支持按完工时间筛选");
assert.ok(source.includes('placeholder="开始时间"'), "开始日期默认必须显示开始时间");
assert.ok(source.includes('placeholder="结束时间"'), "结束日期默认必须显示结束时间");
assert.ok(source.includes("qualityInspectionIssueRoute"), "后台质检必须用工序下拉选择问题工序");
assert.ok(source.includes("exception-list-table"), "异常记录必须使用紧凑列表布局");
assert.ok(source.includes("订单号/客户/产品"), "异常记录表头必须体现订单号/客户/产品");
assert.ok(source.includes("问题工序"), "异常记录必须显示问题工序列");
assert.ok(source.includes("报工人"), "异常记录必须显示报工人列");
assert.ok(source.includes("attachment-count"), "附件组入口必须显示数量角标");
assert.ok(source.includes("exception-main-stack"), "订单号、客户、产品必须纵向排列");
assert.ok(!source.includes('map(fileLinks).join("")'), "工单图纸不得逐个输出操作按钮");
assert.ok(source.includes("exception-resolve-cell"), "处理列必须有独立宽度样式");
assert.ok(source.includes("previewFiles"), "前端必须维护当前预览文件组状态");
assert.ok(source.includes("data-preview-group"), "预览入口必须使用附件组事件");
assert.ok(source.includes("file-preview-modal"), "必须渲染居中预览弹窗");
assert.ok(source.includes("closeFilePreview"), "必须支持关闭预览弹窗");
assert.ok(source.includes("exception-solution-box"), "已解决异常必须显示解决说明框");
assert.ok(!source.includes('target="_blank" rel="noopener">预览'), "预览不应打开新网页");
assert.ok(source.includes("attachment-preview-dialog"), "附件应使用统一深色预览窗口");

console.log("history-ui: ok");
