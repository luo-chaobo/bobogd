const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "report", "report.js"), "utf8").replace(/\r\n/g, "\n");
const startMatch = source.match(/async startProduction\(routeId\)[\s\S]*?\n  \},\n  async submit/);

assert.ok(source.includes("工单：${workOrder.workNo || \"\"}"), "外部扫码待开始弹窗必须显示工单号");
assert.ok(source.includes("产品：${workOrder.productName || \"\"}"), "外部扫码待开始弹窗必须显示产品");
assert.ok(source.includes("工序：${route.processName || \"\"}"), "外部扫码待开始弹窗必须显示工序");
assert.ok(source.includes("计划：${route.planQty || 0} ${unit}"), "外部扫码待开始弹窗必须显示计划数量和订单单位");
assert.ok(startMatch, "外部扫码开始生产方法必须存在");
assert.ok(startMatch[0].includes('wx.switchTab({ url: "/pages/tasks/tasks" })'), "外部扫码开始后必须回到我的任务");
assert.ok(!startMatch[0].includes("this.load()"), "外部扫码开始后不得停留在报工页");

console.log("external-qr-start-flow: ok");
