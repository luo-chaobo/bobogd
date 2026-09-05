const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const web = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const board = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.js"), "utf8");

assert.match(web, /function dispatchPage\(data\) \{\s*const workOrders = data\.workOrders\.filter\(\(item\) => item\.status !== "已完成"\)/);
assert.match(web, /const activeWorkOrders = data\.workOrders\.filter\(\(item\) => item\.status !== "已完成"\)/);
assert.match(board, /const activeWorkOrders = data\.workOrders\.filter\(\(item\) => item\.status !== "已完成"\)/);
assert.ok(web.includes("historyPage(data)"), "历史查询入口必须继续保留");

console.log("completed-work-order-archive-ui: ok");
