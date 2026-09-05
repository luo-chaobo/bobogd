const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-tv-completion-trend-"));
const port = 31994;
let child;

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");

  const today = dateOffset(0);
  const yesterday = dateOffset(-1);
  const twoDaysAgo = dateOffset(-2);
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [], deletedUsers: [], reports: [], exceptions: [], attachments: [], auditLogs: [], settings: {},
    processes: [
      { id: "laser", name: "激光", sort: 2, active: true },
      { id: "bend", name: "折弯", sort: 4, active: true }
    ],
    customers: [{ id: "customer", name: "客户" }],
    orders: [
      { id: "order-new", orderNo: "NEW", customerId: "customer", productName: "新工单", quantity: 1, status: "已完成" },
      { id: "order-legacy", orderNo: "LEGACY", customerId: "customer", productName: "旧工单", quantity: 1, status: "已完成" }
    ],
    workOrders: [
      { id: "work-new", workNo: "NEW", orderId: "order-new", productName: "新工单", planQty: 1, status: "已完成", completedAt: `${today}T08:00:00.000Z` },
      { id: "work-legacy", workNo: "LEGACY", orderId: "order-legacy", productName: "旧工单", planQty: 1, status: "已完成" }
    ],
    routes: [
      { id: "new-laser", workOrderId: "work-new", processId: "laser", processName: "激光", sequence: 1, status: "已完成", planQty: 1, completedQty: 1, completedAt: `${yesterday}T08:00:00.000Z` },
      { id: "new-bend", workOrderId: "work-new", processId: "bend", processName: "折弯", sequence: 2, status: "已完成", planQty: 1, completedQty: 1, completedAt: `${today}T08:00:00.000Z` },
      { id: "legacy-laser", workOrderId: "work-legacy", processId: "laser", processName: "激光", sequence: 1, status: "已完成", planQty: 1, completedQty: 1, completedAt: `${twoDaysAgo}T08:00:00.000Z` },
      { id: "legacy-bend", workOrderId: "work-legacy", processId: "bend", processName: "折弯", sequence: 2, status: "已完成", planQty: 1, completedQty: 1, completedAt: `${yesterday}T08:00:00.000Z` }
    ]
  }, null, 2), "utf8");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();
  const response = await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`);
  const data = await response.json();
  const values = Object.fromEntries(data.reportTrend.map((item) => [item.key, item.value]));
  assert.strictEqual(values[dateOffset(0)], 1, "今天完工的工单只应计入今天");
  assert.strictEqual(values[dateOffset(-1)], 1, "旧工单应按最后一道工序的日期计入一次");
  assert.strictEqual(values[dateOffset(-2)], 0, "早期工序完成日期不得重复计入趋势");
  assert.strictEqual(data.summary.finishedWorkOrdersToday, 1);
  console.log("tv-completion-trend: ok");
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
