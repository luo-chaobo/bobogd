const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const boardSource = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.js"), "utf8");
const tvSource = fs.readFileSync(path.join(root, "miniprogram", "pages", "tv", "tv.js"), "utf8");
const tvPage = fs.readFileSync(path.join(root, "miniprogram", "pages", "tv", "tv.wxml"), "utf8");

assert.ok(boardSource.includes('api.request("/api/dashboard")'), "小程序生产看板必须使用统一统计接口");
assert.ok(!boardSource.includes('api.request("/api/bootstrap")'), "小程序生产看板不能自行统计全部工单");
assert.ok(boardSource.includes("prepareTvViewerToken"), "生产看板应提前准备大屏令牌");
assert.ok(tvSource.includes("getCachedTvViewerToken"), "横屏页应优先复用有效令牌");
assert.ok(tvPage.includes("正在准备生产看板"), "横屏页等待期间必须显示明确骨架提示");

console.log("miniprogram-board-optimization: ok");
