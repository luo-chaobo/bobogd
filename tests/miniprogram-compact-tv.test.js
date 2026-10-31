const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const miniprogramSource = fs.readFileSync(path.join(root, "miniprogram", "pages", "tv", "tv.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const tvSource = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
const tvStyles = fs.readFileSync(path.join(root, "public", "tv.css"), "utf8");
const clientMode = require(path.join(root, "public", "client-mode.js"));

assert.ok(miniprogramSource.includes('parts.push("compact=1")'), "小程序横屏网址必须启用独立紧凑模式");
assert.ok(tvSource.includes('params.get("mobile") === "1" && params.get("compact") === "1"'), "紧凑模式必须同时校验手机模式和专用参数");
assert.ok(tvSource.includes('classList.toggle("compact-mobile", isCompactMobileTv())'), "看板必须按专用参数切换紧凑样式类");
assert.ok(tvStyles.includes("body.mobile-tv.compact-mobile .route-node"), "紧凑工序尺寸必须限定在小程序专用模式");
assert.ok(tvStyles.includes("flex-basis: 60px"), "紧凑模式应使用小幅加宽后的工序节点");
assert.match(tvStyles, /body\.mobile-tv\.compact-mobile \.circle \{[\s\S]*?width: 58px;[\s\S]*?font-size: 9px;/, "紧凑模式应加宽椭圆并保持日期字号");
assert.match(tvStyles, /body\.mobile-tv\.compact-mobile \.order-drawing-slot\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px/s, "小程序图纸槽必须限制在第三行高度");
assert.match(tvStyles, /body\.mobile-tv\.compact-mobile \.order-drawing-button,[\s\S]*?body\.mobile-tv\.compact-mobile \.order-drawing-placeholder\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px/s, "小程序图纸按钮必须使用14px紧凑尺寸");
assert.match(tvStyles, /body\.mobile-tv\.compact-mobile \.drawing-count\s*\{[^}]*min-width:\s*9px;[^}]*height:\s*9px/s, "小程序附件角标必须同步缩小");
const compactOrderRow = tvStyles.match(/body\.mobile-tv\.compact-mobile \.order-row\s*\{[^}]*\}/s)?.[0] || "";
assert.ok(compactOrderRow.includes("80px"), "小程序产品列宽必须保持不变");
assert.ok(!/\b(?:min-)?height\s*:/.test(compactOrderRow), "小程序图标调整不能改变工单行高");
assert.strictEqual(clientMode.interactiveBoardNavigation("token", false, "").url, "/tv.html?mobile=1&viewerToken=token", "后台手机横屏入口必须保持原网址");
assert.strictEqual(clientMode.interactiveBoardNavigation("token", true, "").url, "/tv.html?mobile=1&dispatch=1&viewerToken=token", "后台派工入口必须保持原网址");
assert.ok(appSource.includes('window.open("/tv.html", "_blank")'), "后台电视大屏入口必须保持原网址");
assert.ok(!appSource.includes("compact=1"), "后台三个看板入口不得启用小程序紧凑模式");

console.log("miniprogram-compact-tv: ok");
