const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pagePath = path.join(__dirname, "..", "docs", "工单业务逻辑与岗位操作图谱.html");
const html = fs.readFileSync(pagePath, "utf8");

[
  "订单录入",
  "扫码报工",
  "质检与返工",
  "看板规则",
  "岗位操作地图",
  "生产主流程",
  "数据追溯",
].forEach((text) => assert.ok(html.includes(text), `缺少页面内容：${text}`));

assert.ok(!/<script\s+[^>]*src=/i.test(html), "页面不应依赖外部脚本");
assert.ok(!/<link\s+[^>]*href=/i.test(html), "页面不应依赖外部样式");

console.log("PASS: work-order operation map document checks passed");
