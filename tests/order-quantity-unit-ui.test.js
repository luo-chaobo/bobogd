const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("public/app.js");
const tv = read("public/tv.js");
const qr = read("public/qr-print.html");
const tasksJs = read("miniprogram/pages/tasks/tasks.js");
const tasksView = read("miniprogram/pages/tasks/tasks.wxml");
const reportJs = read("miniprogram/pages/report/report.js");
const reportView = read("miniprogram/pages/report/report.wxml");

assert.ok(app.includes('id="quantityUnit"'), "新建订单必须提供数量单位选择");
assert.ok(app.includes('id="editQuantityUnit"'), "编辑订单必须提供数量单位选择");
assert.ok(app.includes('quantityUnit: el("quantityUnit").value'), "新建订单必须提交数量单位");
assert.ok(app.includes('quantityUnit: el("editQuantityUnit").value'), "编辑订单必须提交数量单位");
assert.ok(app.includes('"单位"'), "CSV 必须包含独立单位列");
assert.ok(tv.includes("quantityUnit"), "电视和横屏看板必须显示订单单位");
assert.ok(qr.includes("quantityUnit"), "二维码打印页必须显示订单单位");
assert.ok(tasksJs.includes("quantityUnit") && tasksView.includes("{{item.quantityUnit}}"), "小程序任务必须显示订单单位");
assert.ok(reportJs.includes("quantityUnit") && reportView.includes("{{quantityUnit}}"), "小程序报工必须显示订单单位");

console.log("order-quantity-unit-ui: ok");
