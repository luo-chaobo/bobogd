const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const webSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const miniSource = fs.readFileSync(path.join(root, "miniprogram", "pages", "drawings", "drawings.js"), "utf8");
const viewerPath = path.join(root, "public", "cad-preview.html");

assert.ok(fs.existsSync(viewerPath), "必须提供同域名的 CAD HTML 查看器");
const viewerSource = fs.readFileSync(viewerPath, "utf8");

assert.ok(serverSource.includes("cadPreviewPageUrl"), "服务器必须生成 CAD 查看器地址");
assert.ok(serverSource.includes("previewPageUrl"), "CAD 预览接口必须返回查看器地址");
assert.ok(serverSource.includes("function cadPreviewPageUrl(previewUrl, downloadUrl, name)"), "CAD 查看器地址必须接收原文件 URL 和文件名");
assert.ok(serverSource.includes("download=${encodeURIComponent(downloadUrl)}"), "CAD 查看器地址必须编码原文件 URL");
assert.ok(serverSource.includes("name=${encodeURIComponent(name)}"), "CAD 查看器地址必须编码原文件名");
assert.ok(webSource.includes("file.previewPageUrl"), "网页后台必须打开 CAD 查看器而不是直接打开 SVG");
assert.ok(miniSource.includes("result.previewPageUrl"), "小程序必须打开 CAD 查看器而不是直接打开 SVG");
assert.ok(viewerSource.includes("URLSearchParams"), "CAD 查看器必须读取 SVG 地址参数");
assert.ok(viewerSource.includes("data-action=\"zoom-in\""), "CAD 查看器必须支持放大");
assert.ok(viewerSource.includes("data-action=\"reset\""), "CAD 查看器必须支持复位");
assert.ok(viewerSource.includes(".message[hidden]"), "加载完成后必须隐藏加载提示");
assert.ok(viewerSource.includes("getBBox()"), "CAD 查看器必须按浏览器计算的实际图形边界适配窗口");
assert.ok(viewerSource.includes("下载原文件"), "CAD 查看器必须显示原文件下载入口");
assert.ok(viewerSource.includes("/uploads/drawings/"), "CAD 查看器只能下载本站图纸目录中的文件");
assert.ok(viewerSource.includes("wx.miniProgram.navigateTo"), "小程序 WebView 必须跳转到原生下载页");
assert.ok(viewerSource.includes("pages/file-download/file-download"), "CAD 查看器必须使用专用原生下载页");

console.log("cad-viewer-routing: ok");
