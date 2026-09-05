const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.ok(app.includes("reportsFrom"), "基础报表应保存开始日期筛选");
assert.ok(app.includes("reportsTo"), "基础报表应保存结束日期筛选");
assert.ok(app.includes("exportManagementReport"), "基础报表应提供管理分析导出动作");
assert.ok(app.includes("sortReportsByNewest"), "报工记录应默认按最新时间排序");
assert.ok(app.includes("activateSortableTables"), "后台表格应统一启用可排序表头");
assert.ok(app.includes("data-sort-value"), "排序应优先使用原始字段值");
assert.ok(styles.includes(".sortable-header"), "可排序表头应显示交互样式");
assert.ok(styles.includes(".sort-indicator"), "可排序表头应显示方向箭头");
assert.ok(!app.includes("<h3>大屏看板设置</h3>"), "基础设置应隐藏大屏看板设置");

console.log("backend-report-sorting-ui: ok");
