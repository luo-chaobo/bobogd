const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
const page = fs.readFileSync(path.join(root, "public", "tv.html"), "utf8");

assert.match(script, /activeOrderTotal\s*\?\?\s*activeOrders\.length/, "看板总数应使用服务端总量，不能随分页加载跳变");
assert.match(script, /loadInFlight/, "看板轮询应避免分页请求尚未结束时重叠刷新");
assert.match(script, /insertAdjacentHTML\("beforeend"/, "移动看板补载工单应追加列表，不得整页重绘");
assert.match(script, /dashboardContentKey/, "移动看板应比较业务内容并跳过无变化重绘");
assert.match(page, /tv\.js\?v=20261018-mobile-stability/, "发布看板脚本时应更新静态资源版本，避免命中旧缓存");

console.log("tv-mobile-stability: ok");
