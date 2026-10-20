const assert = require("node:assert/strict");
const { normalizeUnitPrice, calculateOrderTotal, financialAccessUserIds } = require("../lib/order-financials");

assert.deepEqual(normalizeUnitPrice(""), { value: null, error: "" });
assert.deepEqual(normalizeUnitPrice("0"), { value: 0, error: "" });
assert.deepEqual(normalizeUnitPrice("12.3"), { value: 12.3, error: "" });
for (const value of ["-1", "abc", "1.234", "Infinity"]) {
  assert.notEqual(normalizeUnitPrice(value).error, "", `${value} must be rejected`);
}
assert.equal(calculateOrderTotal(12.35, 3), 37.05);
assert.equal(calculateOrderTotal(0, 3), 0);
assert.equal(calculateOrderTotal(null, 3), null);

const users = [
  { id: "a", name: "罗朝波", active: true },
  { id: "b", name: "郑金波", active: true },
  { id: "c", name: "郑学良", active: true },
  { id: "d", name: "普通员工", active: true },
];
assert.deepEqual([...financialAccessUserIds(users)].sort(), ["a", "b", "c"]);
assert.deepEqual([...financialAccessUserIds([
  { id: "a", name: "罗朝波", active: true },
  { id: "b", name: "郑金波", active: true },
  { id: "c", name: "郑学良", active: true },
  { id: "x", name: "郑金波", active: true },
  { id: "inactive", name: "郑学良", active: false },
])].sort(), ["a", "c"]);
assert.deepEqual([...financialAccessUserIds([])], []);

console.log("order financial helpers: all assertions passed");
