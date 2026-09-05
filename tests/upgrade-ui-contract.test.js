const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const web = read("public/app.js");
assert.ok(web.includes('data-action="openMobileTv"'));
assert.ok(web.includes('["auditLogs", "操作日志"]'));
assert.ok(web.includes("/api/audit-logs"));
assert.ok(web.includes("/api/orders/update"));
assert.ok(web.includes("deleteCustomers"));
assert.ok(web.includes("editOrders"));

const appJson = JSON.parse(read("miniprogram/app.json"));
assert.ok(appJson.pages.includes("pages/drawings/drawings"));

const tasks = read("miniprogram/pages/tasks/tasks.js");
const tasksView = read("miniprogram/pages/tasks/tasks.wxml");
assert.ok(tasks.includes("/pages/drawings/drawings"));
assert.ok(tasksView.includes(">图</button>"));

const board = read("miniprogram/pages/board/board.js");
const tv = read("miniprogram/pages/tv/tv.js");
assert.strictEqual(board.includes('["owner", "manager", "admin"].includes'), false);
assert.strictEqual(tv.includes('["owner", "manager", "admin"].includes'), false);

const drawings = read("miniprogram/pages/drawings/drawings.js");
assert.ok(drawings.includes("wx.previewImage"));
assert.ok(drawings.includes("imageUrls"));

const download = read("miniprogram/pages/file-download/file-download.js");
const downloadView = read("miniprogram/pages/file-download/file-download.wxml");
assert.ok(download.includes("wx.openDocument"));
assert.ok(download.includes("shareFile"));
assert.ok(downloadView.includes('bindtap="openLocalFile"'));
assert.ok(downloadView.includes('bindtap="shareFile"'));

console.log("upgrade-ui-contract: ok");
