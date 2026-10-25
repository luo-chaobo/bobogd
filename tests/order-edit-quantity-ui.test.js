const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.ok(appSource.includes('id="editQuantity" type="number" min="1" step="1"'), "Order edit must contain a positive integer quantity input");
assert.ok(appSource.includes('value="${escapeHtml(order.quantity)}"'), "Order edit must show the current quantity");
assert.ok(appSource.includes('quantity: el("editQuantity").value'), "Order edit must submit quantity");
assert.ok(appSource.includes('<section class="dialog order-edit-dialog"'), "Order edit must use isolated compact dialog styles");
assert.match(stylesSource, /\.order-edit-dialog\s*\{[^}]*max-height:\s*calc\(100dvh[^}]*env\(safe-area-inset-bottom/s, "Order edit must fit the dynamic viewport and preserve the bottom safe area");
assert.match(stylesSource, /\.order-edit-dialog\s+\.form-grid\s*\{[^}]*row-gap:\s*10px/s, "Order edit fields must use the compact vertical spacing");
assert.match(stylesSource, /\.toast\s*\{[^}]*z-index:\s*1101/s, "Save results must render above the order edit backdrop");
assert.match(stylesSource, /\.dialog-backdrop\s*\{[^}]*z-index:\s*1000/s, "Order edit backdrop must retain its modal layer");
assert.match(indexSource, /\/app\.js\?v=[a-z0-9-]+/i, "The admin page must load the cache-busted application script");

console.log("order-edit-quantity-ui: ok");
