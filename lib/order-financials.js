const FINANCIAL_ACCESS_NAMES = ["罗朝波", "郑金波", "郑学良"];
const MAX_UNIT_PRICE_CENTS = 99999999999;

function normalizeOrderNumber(value) {
  return String(value ?? "").trim().toUpperCase();
}

function hasOrderNumberConflict(orders, orderNo, excludedOrderId = "") {
  const candidate = normalizeOrderNumber(orderNo);
  if (!candidate) return false;
  return orders.some((order) => order.id !== excludedOrderId && normalizeOrderNumber(order.orderNo) === candidate);
}

function createSerialQueue() {
  let pending = Promise.resolve();
  return (task) => {
    const result = pending.then(task, task);
    pending = result.catch(() => {});
    return result;
  };
}

function normalizeUnitPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return { value: null, error: "" };
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return { value: null, error: "单价必须为非负且最多两位小数的金额" };
  const [yuan, fraction = ""] = text.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_UNIT_PRICE_CENTS) return { value: null, error: "单价不能超过 999999999.99 元" };
  return { value: cents / 100, error: "" };
}

function calculateOrderTotal(unitPrice, quantity) {
  if (unitPrice === null || unitPrice === undefined || unitPrice === "") return null;
  const price = normalizeUnitPrice(unitPrice);
  const count = Number(quantity);
  if (price.error || !Number.isFinite(count) || count < 0) return null;
  const match = String(count).toLowerCase().match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  const scale = fraction.length - Number(match[3] || 0);
  let quantityNumerator = BigInt(`${match[1]}${fraction}`);
  let quantityDenominator = 1n;
  if (scale > 0) quantityDenominator = 10n ** BigInt(scale);
  else if (scale < 0) quantityNumerator *= 10n ** BigInt(-scale);
  const productCents = BigInt(Math.round(price.value * 100)) * quantityNumerator;
  const roundedCents = (productCents + quantityDenominator / 2n) / quantityDenominator;
  if (roundedCents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(roundedCents) / 100;
}

function identifyFinancialAccessUsers(users) {
  const activeUsers = (Array.isArray(users) ? users : []).filter((user) => user && user.active !== false);
  const identities = {};
  for (const name of FINANCIAL_ACCESS_NAMES) {
    const matches = activeUsers.filter((user) => user.name === name);
    identities[name] = matches.length === 1 && matches[0].id ? String(matches[0].id) : "";
  }
  return identities;
}

function financialAccessUserIds(users, identities) {
  const activeUsers = (Array.isArray(users) ? users : []).filter((user) => user && user.active !== false);
  const allowedIds = new Set();
  for (const name of FINANCIAL_ACCESS_NAMES) {
    const pinnedId = identities && identities[name];
    const matches = activeUsers.filter((user) => user.name === name);
    if (pinnedId && matches.length === 1 && String(matches[0].id) === String(pinnedId)) allowedIds.add(String(pinnedId));
  }
  return allowedIds;
}

module.exports = { normalizeUnitPrice, calculateOrderTotal, identifyFinancialAccessUsers, financialAccessUserIds, normalizeOrderNumber, hasOrderNumberConflict, createSerialQueue };
