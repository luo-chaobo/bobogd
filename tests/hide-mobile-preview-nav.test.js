const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const viewsMatch = source.match(/const views = \[([\s\S]*?)\n  \];/);

assert.ok(viewsMatch, "后台导航必须定义 views 数组");
assert.ok(!viewsMatch[1].includes("手机端预览"), "后台左侧导航不应显示手机端预览");
assert.ok(!viewsMatch[1].includes('"mobile"'), "后台左侧导航不应显示 mobile 入口");
assert.ok(source.includes("mobile: mobileShell(true)"), "手机端预览渲染能力应保留给内部逻辑使用");
assert.ok(source.includes('state.view === "mobile" ? mobileShell() : adminShell()'), "车间账号手机端视图逻辑应保持可用");

console.log("hide-mobile-preview-nav: ok");
