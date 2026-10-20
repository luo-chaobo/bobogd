const FINANCIAL_ACCESS_NAMES = ["罗朝波", "郑金波", "郑学良"];

function normalizeUnitPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return { value: null, error: "" };
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return { value: null, error: "单价必须为非负且最多两位小数的金额" };
  const [yuan, fraction = ""] = text.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { value: null, error: "单价超出可处理范围" };
  return { value: cents / 100, error: "" };
}

function calculateOrderTotal(unitPrice, quantity) {
  if (unitPrice === null || unitPrice === undefined || unitPrice === "") return null;
  const price = normalizeUnitPrice(unitPrice);
  const count = Number(quantity);
  if (price.error || !Number.isFinite(count) || count < 0) return null;
  const cents = Math.round(price.value * 100) * count;
  if (!Number.isFinite(cents)) return null;
  return Math.round(cents) / 100;
}

function financialAccessUserIds(users) {
  const activeUsers = (Array.isArray(users) ? users : []).filter((user) => user && user.active !== false);
  const allowedIds = new Set();
  for (const name of FINANCIAL_ACCESS_NAMES) {
    const matches = activeUsers.filter((user) => user.name === name);
    if (matches.length === 1 && matches[0].id) allowedIds.add(String(matches[0].id));
  }
  return allowedIds;
}

module.exports = { normalizeUnitPrice, calculateOrderTotal, financialAccessUserIds };
