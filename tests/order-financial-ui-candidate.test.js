const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const candidatePath = path.join(__dirname, "..", "release-candidates", "order-financial-ui", "app.js");

function loadCandidate(elements = {}) {
  const element = () => ({ innerHTML: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const context = {
    console,
    Blob: class {},
    URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class {},
    confirm() { return false; },
    fetch() { return Promise.reject(new Error("not used in UI contract tests")); },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      body: { appendChild() {} },
      createElement: element,
      getElementById(id) { return elements[id] || element(); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    window: { open() {}, location: {} },
    setTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(candidatePath, "utf8"), context, { filename: candidatePath });
  return context;
}

function emptyOrderData(canViewFinancials) {
  return {
    workOrders: [], orders: [], customers: [], routes: [], reports: [], exceptions: [], drawings: [],
    processes: [], permissions: { viewOrderFinancials: canViewFinancials },
  };
}

test("merged app renders private price fields only for authorized users and allows editing the price", () => {
  const app = loadCandidate();
  const authorizedData = emptyOrderData(true);
  vm.runInContext('state.user = { id: "authorized", role: "admin", roles: ["admin"] }; state.editingOrderId = "order-1";', app);
  authorizedData.orders.push({ id: "order-1", orderNo: "20261020", customerId: "customer-1", productName: "机柜", quantity: 4, quantityUnit: "件", unitPrice: 12.5, totalAmount: 50 });
  authorizedData.customers.push({ id: "customer-1", name: "客户甲" });

  const createHtml = app.ordersPage(authorizedData);
  const editHtml = app.orderEditModal(authorizedData);
  assert.match(createHtml, /id="unitPrice"/);
  assert.match(createHtml, /id="totalAmount"[^>]*readonly/);
  assert.match(editHtml, /id="editUnitPrice"[^>]*value="12\.5"/);
  assert.match(editHtml, /id="editTotalAmount"[^>]*readonly[^>]*value="50"/);

  const restrictedHtml = app.ordersPage(emptyOrderData(false));
  assert.doesNotMatch(restrictedHtml, /id="unitPrice"|id="totalAmount"/);
});

test("merged app calculates total from quantity and price and clears invalid inputs", () => {
  const fields = {
    quantity: { value: "4" },
    unitPrice: { value: "12.50" },
    totalAmount: { value: "" },
  };
  const app = loadCandidate(fields);
  app.updateFinancialTotal("quantity", "unitPrice", "totalAmount");
  assert.equal(fields.totalAmount.value, "50.00");

  fields.unitPrice.value = "invalid";
  app.updateFinancialTotal("quantity", "unitPrice", "totalAmount");
  assert.equal(fields.totalAmount.value, "");
});
