const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSerialQueue, hasOrderNumberConflict, normalizeOrderNumber } = require("../lib/order-financials");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("order numbers are compared after trimming and case folding", () => {
  const existingOrders = [{ id: "old", orderNo: "DUP-1" }];
  assert.equal(normalizeOrderNumber(" dup-1 "), "DUP-1");
  assert.equal(hasOrderNumberConflict(existingOrders, " dup-1 "), true);
  assert.equal(hasOrderNumberConflict(existingOrders, "NEW-1"), false);
  assert.equal(hasOrderNumberConflict(existingOrders, "DUP-1", "old"), false);
});

test("order write queue checks requests against writes that finished first", async () => {
  const serialize = createSerialQueue();
  const order = [];
  const first = serialize(async () => {
    order.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("first:end");
  });
  const second = serialize(() => order.push("second"));
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("all order-number write paths are serialized and check conflicts", () => {
  for (const pathname of ["/api/orders", "/api/orders/update", "/api/orders/repeat", "/api/external/work-orders"]) {
    assert.ok(serverSource.includes(`"${pathname}"`), `${pathname} must use the serialized write queue`);
  }
  assert.match(serverSource, /hasOrderNumberConflict\(db\.orders, orderNo\)/);
  assert.match(serverSource, /orderNoChanged && hasOrderNumberConflict\(db\.orders, orderNo, order\.id\)/);
  assert.match(serverSource, /normalizeOrderNumber\(item\.orderNo\) === normalizeOrderNumber\(input\.externalOrderNumber\)/);
});
