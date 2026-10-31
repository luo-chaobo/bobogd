const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const printSource = fs.readFileSync(path.join(root, "public", "qr-print.html"), "utf8");

assert.ok(appSource.includes('<span>激光编号</span><input id="drawingNo"'), "新建订单必须使用激光编号标签");
assert.ok(appSource.includes('placeholder="请输入激光编号"'), "新建订单必须使用激光编号提示");
assert.ok(appSource.includes('<span>激光编号</span><input id="editDrawingNo"'), "编辑订单必须使用激光编号标签");
assert.ok(printSource.includes('workOrder.order?.drawingNo'), "二维码打印页必须读取订单激光编号");
assert.ok(printSource.includes('激光编号：${esc(workOrder.order.drawingNo)}'), "二维码打印页必须显示激光编号内容");

console.log("laser-number-qr-print-ui: ok");
