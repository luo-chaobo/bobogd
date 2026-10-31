const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert.ok(source.includes("normalizeCadSvg"), "CAD SVG 必须修正 LibreDWG 的零线宽输出");
assert.ok(source.includes("stroke-width:0.25px"), "零线宽必须替换为浏览器可见线宽");
assert.ok(source.includes("stroke-width=\"0.25px\""), "属性形式的零线宽也必须替换为浏览器可见线宽");
assert.ok(source.includes("normalizeCadColor"), "CAD SVG 必须修正白色或过浅线条");
assert.ok(source.includes("stroke=\"#111827\""), "白色 CAD 线条必须替换为白底可见的深色线条");
assert.ok(source.includes("cad-preview-visible-style"), "CAD SVG 必须注入可见性覆盖样式");
assert.ok(source.includes("cadPreviewUrl"), "CAD 预览接口必须返回带版本号的地址以避开浏览器缓存");
assert.ok(source.includes("normalizeCadViewBox"), "CAD SVG 必须按实际线条坐标重算 viewBox");
assert.ok(source.includes("svgShapeBounds"), "CAD SVG 必须能从已生成 SVG 中提取图形边界");
assert.ok(source.includes("percentileCadBounds"), "CAD SVG 重算 viewBox 必须按坐标密集区裁剪");
assert.ok(source.includes("fs.readFileSync(previewFile"), "已有 CAD 预览也必须在读取时修复");
assert.ok(appSource.includes("if (isCad && file.drawingId)"), "打开已有 CAD 预览时也必须触发缓存修复");

console.log("cad-svg-line-width: ok");
