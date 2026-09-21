const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const test = require("node:test");

function loadApp() {
  const element = () => ({
    innerHTML: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
  });
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
      getElementById: element,
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    window: { open() {}, location: {} },
    setTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/app.js", "utf8"), context, { filename: "public/app.js" });
  return context;
}

const factoryWorkOrder = { id: "factory", workNo: "F-1", productName: "工厂件", planQty: 2, status: "生产中", order: {} };
const websiteWorkOrder = { id: "website", workNo: "P-1", productName: "网站件", planQty: 3, status: "生产中", order: { orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "WEB-9" } };
const marketplaceWorkOrder = { id: "marketplace", workNo: "P-2", productName: "平台件", planQty: 4, status: "生产中", order: { orderOrigin: "platform", sourceChannel: "order_platform", externalOrderNumber: "MARKET-8" } };
const miniprogramWorkOrder = { id: "mini", workNo: "P-3", productName: "小程序件", planQty: 5, status: "生产中", order: { orderOrigin: "platform", sourceChannel: "miniprogram", externalOrderNumber: "MINI-7" } };

test("后台订单只区分工厂单和平台单", () => {
  const app = loadApp();
  assert.match(app.orderSourceBadge(factoryWorkOrder), /工厂单/);
  assert.match(app.orderSourceBadge(websiteWorkOrder), />平台单</);
  assert.doesNotMatch(app.orderSourceBadge(websiteWorkOrder), /企业官网/);
  assert.doesNotMatch(app.productionSourceBadge(factoryWorkOrder), /工厂单/);
  assert.match(app.productionSourceBadge(miniprogramWorkOrder), /平台单/);
});

test("订单工单侧栏和生产总览提供三种来源视图", () => {
  const app = loadApp();
  const data = {
    workOrders: [factoryWorkOrder, websiteWorkOrder], orders: [], customers: [], routes: [], reports: [], exceptions: [], drawings: [],
    permissions: {}, completionSourceSummary: {},
  };
  assert.match(app.dashboardSourceTabs(), /全部订单/);
  assert.match(app.dashboardSourceTabs(), /工厂单/);
  assert.match(app.dashboardSourceTabs(), /平台单/);
  assert.strictEqual(app.filterWorkOrdersBySource(data.workOrders, "platform", "").length, 1);
});

test("来源筛选保留工厂单并可继续按平台渠道过滤", () => {
  const app = loadApp();
  const workOrders = [factoryWorkOrder, websiteWorkOrder, marketplaceWorkOrder, miniprogramWorkOrder];
  assert.deepStrictEqual(
    app.filterWorkOrdersBySource(workOrders, "factory", "").map((item) => item.id),
    ["factory"]
  );
  assert.deepStrictEqual(
    app.filterWorkOrdersBySource(workOrders, "platform", "miniprogram").map((item) => item.id),
    ["mini"]
  );
  assert.deepStrictEqual(
    app.filterWorkOrdersBySource(workOrders, "", "").map((item) => item.id),
    ["factory", "website", "marketplace", "mini"]
  );
});

test("后台完工来源统计按后端 sourceSummary 显示工厂和三种平台渠道", () => {
  const app = loadApp();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(app.completionSourceSummaryRows({ total: 10, factory: 4, platform: 6, factory_manual: 4, website: 1, order_platform: 2, miniprogram: 3 }))),
    [
      ["工厂单", 4],
      ["企业官网", 1],
      ["接单平台", 2],
      ["未来机械小程序", 3],
    ]
  );
});

test("订单、派工、工人任务、历史详情和基础报表渲染来源徽标", () => {
  const app = loadApp();
  const data = {
    workOrders: [websiteWorkOrder],
    orders: [],
    customers: [],
    routes: [{ id: "route", workOrderId: "website", processName: "激光", status: "待开始", planQty: 3, completedQty: 0 }],
    reports: [{ id: "report", workOrderId: "website", routeId: "route", reporterId: "worker", completedQty: 1, createdAt: "2026-09-13T08:00:00.000Z" }],
    users: [{ id: "worker", name: "张师傅" }],
    exceptions: [],
    drawings: [],
    permissions: {},
    completionSourceSummary: { total: 4, factory: 1, platform: 3, factory_manual: 1, website: 1, order_platform: 1, miniprogram: 1 },
  };
  app.websiteWorkOrder = websiteWorkOrder;
  vm.runInContext('state.user = { id: "worker", role: "worker", roles: ["worker"] }; state.historyFilters = { dateType: "createdAt", from: "", to: "", customerId: "", status: "", source: "", sourceChannel: "" }; state.historyOrderId = "website"; state.historyResults = { workOrders: [{ ...websiteWorkOrder, customerName: "客户", quantityUnit: "件", productionStatus: "已完成", orderNo: "P-1", routes: [] }], loaded: true }; state.reportsFrom = "2026-09-01"; state.reportsTo = "2026-09-30";', app);
  assert.match(app.workOrderTable(data), /平台单/);
  assert.match(app.dispatchPage(data), /平台单/);
  assert.match(app.taskCard({ ...data.routes[0], workOrder: websiteWorkOrder }), /平台单/);
  assert.match(app.historyPage(data), /来源筛选/);
  assert.match(app.historyOrderModal(data), /平台单/);
  assert.match(app.reportsPage(data), /来源统计/);
  assert.match(app.reportsPage(data), /近30天完工来源/);
  assert.match(app.reportsPage(data), /接单平台 1 单/);
  assert.match(app.reportsPage(data), /未来机械小程序 1 单/);
});
