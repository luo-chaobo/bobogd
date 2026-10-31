const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "drawings", "drawings.js"),
  "utf8"
);

assert.match(
  source,
  /if \(isImage\(drawing\.fileType\)\) \{\s*wx\.previewImage\(\{ current: drawing\.url, urls: this\.data\.imageUrls \}\)/,
  "普通图片应使用全部图片 URL 调用 wx.previewImage"
);
assert.match(source, /if \(drawing\.fileType === "pdf"\)/, "PDF 应继续走 openDocument");
assert.match(source, /if \(\["dwg", "dxf"\]\.includes\(drawing\.fileType\)\)/, "CAD 应保留独立预览分支");

console.log("PASS: miniprogram preview routing checks passed");
