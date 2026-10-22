const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function loadApp(now = "2026-10-21T23:30:00.000Z") {
  const element = () => ({ innerHTML: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const context = {
    console, Date: FixedDate, Blob: class {}, URL: { createObjectURL() { return "blob:test"; } }, FileReader: class {},
    confirm() { return false; }, fetch() { return Promise.reject(new Error("not used")); },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { body: { appendChild() {} }, createElement: element, getElementById: element, querySelector() { return null; }, querySelectorAll() { return []; } },
    window: { open() {}, location: {} }, setTimeout() {},
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  vm.runInContext(source, context, { filename: "public/app.js" });
  return vm.runInContext("({ state, dashboard, isoDate })", context);
}

test("生产总览按上海日期统计跨 UTC 日界的完成工单", () => {
  const app = loadApp();
  app.state.dashboardFinishedFrom = "2026-10-22";
  app.state.dashboardFinishedTo = "2026-10-22";
  const html = app.dashboard({
    workOrders: [{ id: "w1", workNo: "W-1", status: "已完成", completedAt: "2026-10-21T23:56:00.000Z" }],
    routes: [], processes: [], reports: [], exceptions: [], orders: [], customers: [], permissions: {},
  });
  assert.match(html, /data-action="openFinishedHistory"><span>已完成工单<\/span><strong>1<\/strong>/);
});

test("凌晨默认日期按上海自然日，不回退到 UTC 前一天", () => {
  const app = loadApp("2026-10-21T23:30:00.000Z");
  assert.equal(app.state.dashboardFinishedTo, "2026-10-22");
  assert.equal(app.isoDate(0), "2026-10-22");
});
