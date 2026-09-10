const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const printSource = fs.readFileSync(path.join(root, "public", "qr-print.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

assert.ok(!printSource.includes("将本页打印为 A4"), "The static print instructions must be removed");
assert.ok(printSource.includes("订单备注"), "The print header must identify the order note");
assert.ok(printSource.includes("workOrder.order?.note"), "The print page must read the current order note");
assert.ok(printSource.includes('orderNote || "无备注"'), "An empty note must have a stable fallback");
assert.ok(printSource.includes("noteSizeClass(orderNote)"), "The note must select a size class by content length");
assert.ok(printSource.includes("white-space: pre-wrap"), "Manual line breaks must be preserved");
assert.ok(printSource.includes("overflow-wrap: anywhere"), "Long text must wrap without clipping");
assert.ok(printSource.includes(".header-main"), "The title area must be allowed to shrink beside the order note");
assert.ok(printSource.includes('customerName || "客户未填写"'), "A missing customer must have a stable fallback");
assert.ok(appSource.includes("/qr-print.html?v=20260906-customer-title&workOrderId="), "The print link must use the updated cache version");

console.log("qr-print-order-note: ok");
