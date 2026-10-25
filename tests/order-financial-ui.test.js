const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
assert.match(app, /viewOrderFinancials/);
assert.match(app, /id="unitPrice"/);
assert.match(app, /id="totalAmount"[^>]*readonly/i);
assert.match(app, /id="editUnitPrice"/);
assert.match(app, /id="editTotalAmount"[^>]*readonly/i);
assert.ok(app.includes("(Number(priceText) * quantity).toFixed(2)"));
assert.match(app, /unitPrice:\s*el\("unitPrice"\)\.value/);
assert.match(app, /unitPrice:\s*el\("editUnitPrice"\)\.value/);
assert.equal(/totalAmount:\s*el\(/.test(app), false, "client total must never be submitted");

console.log("order-financial-ui: all assertions passed");
