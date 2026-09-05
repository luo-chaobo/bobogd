const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pageRoot = path.join(root, "miniprogram", "pages", "file-download");
const appSource = fs.readFileSync(path.join(root, "miniprogram", "app.json"), "utf8");

assert.ok(appSource.includes("pages/file-download/file-download"), "小程序必须注册 CAD 原文件下载页");
for (const extension of ["js", "json", "wxml", "wxss"]) {
  assert.ok(fs.existsSync(path.join(pageRoot, `file-download.${extension}`)), `下载页必须包含 ${extension} 文件`);
}

const jsSource = fs.readFileSync(path.join(pageRoot, "file-download.js"), "utf8");
const wxmlSource = fs.readFileSync(path.join(pageRoot, "file-download.wxml"), "utf8");

assert.ok(jsSource.includes("wx.downloadFile"), "下载页必须使用 wx.downloadFile 下载原文件");
assert.ok(jsSource.includes("wx.shareFileMessage"), "下载页必须支持转发下载完成的文件");
assert.ok(jsSource.includes("/uploads/drawings/"), "下载页必须限制为本站图纸目录");
assert.ok(wxmlSource.includes("重新下载"), "下载失败后必须提供重新下载操作");
assert.ok(wxmlSource.includes("转发文件"), "下载完成后必须提供转发文件操作");

console.log("cad-mobile-download: ok");
