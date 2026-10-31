const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const boardJs = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.js"), "utf8");
const boardWxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.wxml"), "utf8");
const appConfig = JSON.parse(fs.readFileSync(path.join(root, "miniprogram", "app.json"), "utf8"));
const detailJsPath = path.join(root, "miniprogram", "pages", "completion-details", "completion-details.js");

assert.ok(boardJs.includes('completionPeriod: "today"'));
assert.ok(boardJs.includes("/api/mobile/completions"));
assert.ok(boardJs.includes('label: "当天"'));
assert.ok(boardJs.includes('label: "三天"'));
assert.ok(boardJs.includes('label: "一星期"'));
assert.ok(boardJs.includes('label: "一个月"'));
assert.ok(boardWxml.includes("查看详情"));
assert.ok(boardWxml.includes("<picker"));
assert.ok(boardWxml.includes("period-picker-arrow"));
assert.ok(!boardWxml.includes('class="period-tabs"'));
assert.ok(appConfig.pages.includes("pages/completion-details/completion-details"));
assert.ok(fs.existsSync(detailJsPath));

const detailJs = fs.readFileSync(detailJsPath, "utf8");
const detailWxml = fs.readFileSync(detailJsPath.replace(/\.js$/, ".wxml"), "utf8");
const detailWxss = fs.readFileSync(detailJsPath.replace(/\.js$/, ".wxss"), "utf8");
assert.ok(detailJs.includes("includeItems=1"));
assert.ok(detailJs.includes("/api/orders/fulfillment"));
assert.ok(detailJs.includes("wx.showModal"));
assert.ok(detailJs.includes('已发货: "tag-shipped"'));
assert.ok(detailJs.includes('已开票: "tag-invoiced"'));
assert.ok(detailWxml.includes("scroll-view"));
assert.ok(detailWxml.includes("已发货"));
assert.ok(detailWxml.includes("已开票"));
assert.ok(detailWxss.includes("flex: 1 1 0"));
assert.ok(detailWxss.includes("white-space: nowrap"));
assert.ok(detailWxss.includes(".tag-shipped"));
assert.ok(detailWxss.includes(".tag-invoiced"));
console.log("miniprogram-completion-details: ok");
