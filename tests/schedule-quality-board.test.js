const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-schedule-board-test-"));
const port = 31995;
let child;

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "manager", name: "Manager", phone: "1", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "laser", name: "Laser", phone: "2", role: "laser_worker", roles: ["laser_worker"], password: "1", active: true },
      { id: "quality", name: "Quality", phone: "3", role: "quality", roles: ["quality"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [
      { id: "laserProcess", name: "激光", sort: 1, active: true },
      { id: "qualityProcess", name: "质检", sort: 2, active: true }
    ],
    customers: [{ id: "customer", name: "Customer" }],
    orders: [{ id: "order", orderNo: "S1", customerId: "customer", productName: "Product", quantity: 2, dueDate: dateOffset(7), status: "生产中" }],
    workOrders: [{ id: "work", workNo: "S1", orderId: "order", productName: "Product", planQty: 2, status: "生产中", currentProcess: "激光" }],
    routes: [
      { id: "laserOnTime", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 1, assignedRole: "laser_worker", assignedTo: "laser", status: "进行中", planQty: 1, completedQty: 0 },
      { id: "laserOutside", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 2, assignedRole: "laser_worker", assignedTo: "laser", status: "进行中", planQty: 1, completedQty: 0 },
      { id: "laserEarly", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 3, assignedRole: "laser_worker", assignedTo: "laser", status: "进行中", planQty: 1, completedQty: 0 },
      { id: "qualityRoute", workOrderId: "work", processId: "qualityProcess", processName: "质检", sequence: 4, assignedRole: "quality", assignedTo: "quality", status: "进行中", planQty: 1, completedQty: 0 },
      { id: "laserOverduePartial", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 5, assignedRole: "laser_worker", assignedTo: "laser", status: "进行中", planQty: 2, completedQty: 0 },
      { id: "laserToday", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 6, assignedRole: "laser_worker", assignedTo: "laser", status: "待开始", planQty: 1, completedQty: 0 }
    ],
    reports: [], exceptions: [], attachments: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function request(urlPath, userId, body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server start timeout");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();

  const today = dateOffset(0);
  const yesterday = dateOffset(-1);
  const tomorrow = dateOffset(1);
  assert.strictEqual((await request("/api/assign", "manager", { routeId: "laserOnTime", userId: "laser", plannedStartDate: today, plannedEndDate: today })).status, 200);
  assert.strictEqual((await request("/api/assign", "manager", { routeId: "laserOutside", userId: "laser", plannedStartDate: yesterday, plannedEndDate: yesterday })).status, 200);
  assert.strictEqual((await request("/api/assign", "manager", { routeId: "laserEarly", userId: "laser", plannedStartDate: tomorrow, plannedEndDate: tomorrow })).status, 200);
  assert.strictEqual((await request("/api/assign", "manager", { routeId: "laserOverduePartial", userId: "laser", plannedStartDate: yesterday, plannedEndDate: yesterday })).status, 200);
  assert.strictEqual((await request("/api/assign", "manager", { routeId: "laserToday", userId: "laser", plannedStartDate: today, plannedEndDate: today })).status, 200);
  assert.strictEqual((await request("/api/report", "laser", { routeId: "laserOnTime", completedQty: 1 })).status, 200);
  assert.strictEqual((await request("/api/report", "laser", { routeId: "laserOutside", completedQty: 1 })).status, 200);
  assert.strictEqual((await request("/api/report", "laser", { routeId: "laserEarly", completedQty: 1 })).status, 200);
  assert.strictEqual((await request("/api/report", "laser", { routeId: "laserOverduePartial", completedQty: 1 })).status, 200);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  const onTime = db.reports.find((report) => report.routeId === "laserOnTime");
  const outside = db.reports.find((report) => report.routeId === "laserOutside");
  const early = db.reports.find((report) => report.routeId === "laserEarly");
  assert.deepStrictEqual([onTime.plannedStartDate, onTime.plannedEndDate, onTime.scheduleStatus], [today, today, "on_time"]);
  assert.deepStrictEqual([outside.plannedStartDate, outside.plannedEndDate, outside.scheduleStatus], [yesterday, yesterday, "outside_plan"]);
  assert.deepStrictEqual([early.plannedStartDate, early.plannedEndDate, early.scheduleStatus], [tomorrow, tomorrow, "early"]);

  const quality = await request("/api/report", "quality", {
    routeId: "qualityRoute", submittedQty: 1, inspectedQty: 1, goodQty: 0, badQty: 1,
    disposition: "报废", issueRouteId: "laserOnTime", exceptionDescription: "quality issue"
  });
  assert.strictEqual(quality.status, 200);

  const board = await request("/api/tv-dashboard", "manager");
  const routes = board.data.activeOrders[0].routes;
  assert.strictEqual(routes.find((route) => route.id === "laserOnTime").scheduleOverdue, false);
  assert.strictEqual(routes.find((route) => route.id === "laserOutside").scheduleOverdue, false);
  assert.strictEqual(routes.find((route) => route.id === "laserEarly").scheduleOverdue, false);
  assert.strictEqual(routes.find((route) => route.id === "laserOverduePartial").scheduleOverdue, true);
  assert.strictEqual(routes.find((route) => route.id === "laserToday").scheduleOverdue, false);
  assert.strictEqual(routes.find((route) => route.id === "qualityRoute").scheduleOverdue, false);
  assert.strictEqual(routes.find((route) => route.id === "qualityRoute").qualityIssueActive, true);
  assert.strictEqual(routes.find((route) => route.id === "laserOnTime").qualityIssueActive, true);
  assert.strictEqual(routes.find((route) => route.id === "laserOutside").lastReportScheduleStatus, "outside_plan");
  assert.strictEqual(routes.find((route) => route.id === "laserEarly").lastReportScheduleStatus, "early");

  const updatedDb = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  const exception = updatedDb.exceptions[0];
  assert.strictEqual((await request("/api/exceptions/resolve", "manager", { id: exception.id, status: "已解决", solution: "closed" })).status, 200);
  const resolvedBoard = await request("/api/tv-dashboard", "manager");
  assert.strictEqual(resolvedBoard.data.activeOrders[0].routes.find((route) => route.id === "qualityRoute").qualityIssueActive, false);
  console.log("schedule-quality-board: ok");
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
