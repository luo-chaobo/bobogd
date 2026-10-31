const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const printPage = read("public/qr-print.html");
assert.ok(printPage.includes('const customerName = String(workOrder.customer?.name || "").trim()'));
assert.ok(printPage.includes('${esc(workOrder.workNo)} ${esc(customerName || "客户未填写")}'));
assert.ok(!printPage.includes("${esc(workOrder.workNo)} 工序二维码"));

const appJson = JSON.parse(read("miniprogram/app.json"));
assert.strictEqual(appJson.tabBar.custom, true);

const tabBarJs = read("miniprogram/custom-tab-bar/index.js");
const tabBarWxml = read("miniprogram/custom-tab-bar/index.wxml");
assert.ok(tabBarJs.includes("viewBoardCustomer"));
assert.ok(tabBarJs.includes("showExceptions"));
assert.ok(tabBarWxml.includes("showExceptions"));

const exceptionPage = read("miniprogram/pages/exceptions/exceptions.js");
assert.ok(exceptionPage.includes("viewBoardCustomer"));
assert.ok(exceptionPage.includes('wx.switchTab({ url: "/pages/board/board" })'));

const tasks = read("miniprogram/pages/tasks/tasks.js");
const board = read("miniprogram/pages/board/board.js");
assert.ok(tasks.includes("getTabBar"));
assert.ok(board.includes("getTabBar"));

console.log("print-and-exception-visibility: ok");
