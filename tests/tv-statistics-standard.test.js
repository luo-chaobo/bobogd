const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-tv-statistics-"));
const port = 32119;
let child;

function shanghaiDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

function dayOffset(days) {
  const current = new Date(`${shanghaiDateKey()}T00:00:00+08:00`);
  current.setUTCDate(current.getUTCDate() + days);
  return shanghaiDateKey(current);
}

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");

  const today = dayOffset(0);
  const yesterday = dayOffset(-1);
  const earlyShanghaiToday = `${yesterday}T23:56:00.000Z`;
  const laterShanghaiToday = `${today}T08:00:00.000Z`;
  const orders = [
    { id: "normal", dueDate: dayOffset(2), status: "生产中" },
    { id: "delayed", dueDate: yesterday, status: "生产中" },
    { id: "early", dueDate: today, status: "已完成" },
    { id: "later", dueDate: today, status: "已完成" }
  ].map((order) => ({ ...order, orderNo: order.id, customerId: "customer", productName: order.id, quantity: 1 }));
  const workOrders = orders.map((order) => ({
    id: `work-${order.id}`,
    workNo: order.id,
    orderId: order.id,
    productName: order.id,
    planQty: 1,
    status: order.status,
    completedAt: order.id === "early" ? earlyShanghaiToday : order.id === "later" ? laterShanghaiToday : ""
  }));
  const routes = [
    { id: "normal-waiting", workOrderId: "work-normal", processId: "laser", processName: "激光", status: "待开始" },
    { id: "normal-running", workOrderId: "work-normal", processId: "custom", processName: "外协", status: "进行中" },
    { id: "delayed-error", workOrderId: "work-delayed", processId: "weld", processName: "焊接", status: "异常" },
    { id: "early-done", workOrderId: "work-early", processId: "weld", processName: "焊接", status: "已完成", completedAt: earlyShanghaiToday, completedQty: 1 },
    { id: "later-done", workOrderId: "work-later", processId: "weld", processName: "焊接", status: "已完成", completedAt: laterShanghaiToday, completedQty: 1 }
  ].map((route, index) => ({ sequence: index + 1, planQty: 1, completedQty: 0, ...route }));

  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "worker", name: "工人", phone: "1", role: "weld_worker", roles: ["weld_worker"], active: true }], deletedUsers: [],
    processes: [
      { id: "laser", name: "激光", sort: 2, active: true },
      { id: "weld", name: "焊接", sort: 7, active: true },
      { id: "custom", name: "外协", sort: 99, active: false }
    ],
    customers: [{ id: "customer", name: "客户" }],
    orders, workOrders, routes,
    reports: Array.from({ length: 5 }, (_, index) => ({ id: `report-${index}`, createdAt: laterShanghaiToday })),
    exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();

  const tv = await (await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).json();
  const mobile = await (await fetch(`http://127.0.0.1:${port}/api/mobile/completions?period=today`, { headers: { "x-user-id": "worker" } })).json();
  assert.strictEqual(tv.summary.finishedWorkOrdersToday, 2, "上海凌晨完工必须计入大屏当天工单");
  assert.strictEqual(tv.summary.finishedWorkOrdersToday, mobile.count, "大屏与小程序当天完工工单必须一致");
  assert.deepStrictEqual(tv.statusDistribution, { active: 1, delayed: 1, finishedToday: 2, waiting: 3 });
  assert.strictEqual(tv.summary.waitingRoutes, 3, "全部未完成工序节点都应计入待加工");
  assert.strictEqual(tv.processLoad.reduce((sum, item) => sum + item.remaining, 0), 3, "顶部待加工必须等于分工序待加工之和");
  assert.strictEqual(tv.processLoad.find((item) => item.name === "焊接").completedToday, 2);
  assert.strictEqual(tv.processLoad.find((item) => item.name === "外协").remaining, 1, "在产路线使用的非启用工序不能漏掉");
  assert.strictEqual(tv.reportTrend.at(-1).value, 2, "近7日趋势必须使用上海自然日");
  console.log("tv-statistics-standard: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
