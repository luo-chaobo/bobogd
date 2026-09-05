const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

const headers = appSource.match(/<th>客户\/产品\/数量<\/th>/g) || [];
assert.strictEqual(headers.length, 2, "Active and historical order tables must use the customer/product/quantity header");
assert.ok(
  appSource.includes('${escapeHtml(w.productName)}</span><br><span class="muted">${escapeHtml(w.planQty)} ${workOrderQuantityUnit(w)}</span>'),
  "Active orders must show planned quantity on the third line"
);
assert.ok(
  appSource.includes('${escapeHtml(item.productName)}</span><br><span class="muted">${escapeHtml(item.planQty)} ${quantityUnit(item.quantityUnit)}</span>'),
  "Historical orders must show planned quantity on the third line"
);
assert.match(indexSource, /\/app\.js\?v=[a-z0-9-]+/i, "The admin page must load the cache-busted application script");

console.log("order-quantity-ui: ok");
