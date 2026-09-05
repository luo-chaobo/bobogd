const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

assert.ok(appSource.includes('id="editQuantity" type="number" min="1" step="1"'), "Order edit must contain a positive integer quantity input");
assert.ok(appSource.includes('value="${escapeHtml(order.quantity)}"'), "Order edit must show the current quantity");
assert.ok(appSource.includes('quantity: el("editQuantity").value'), "Order edit must submit quantity");
assert.match(indexSource, /\/app\.js\?v=[a-z0-9-]+/i, "The admin page must load the cache-busted application script");

console.log("order-edit-quantity-ui: ok");
