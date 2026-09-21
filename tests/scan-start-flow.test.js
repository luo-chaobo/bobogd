const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "tasks", "tasks.js"), "utf8").replace(/\r\n/g, "\n");

const startMatch = source.match(/async startScannedRoute\(routeId\) \{([\s\S]*?)\n  \},\n  openScannedReport/);
assert.ok(startMatch, "startScannedRoute 方法必须存在");
assert.ok(!startMatch[1].includes("openScannedReport"), "扫码待开始工序点开始后不得跳转报工页");
assert.ok(source.includes("工单："), "待开始扫码弹窗必须显示工单号");
assert.ok(source.includes("产品："), "待开始扫码弹窗必须显示产品信息");
assert.ok(source.includes("计划："), "待开始扫码弹窗必须显示计划数量");

console.log("scan-start-flow: ok");
