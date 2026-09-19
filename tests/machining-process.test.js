const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-machining-"));
const port = 32120;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "manager", name: "主管", phone: "1", role: "manager", password: "1", active: true },
      { id: "machinist", name: "机加", phone: "2", role: "machining_worker", roles: ["machining_worker"], password: "1", active: true },
      { id: "welder", name: "焊接", phone: "3", role: "weld_worker", roles: ["weld_worker"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [
      { id: "weld", name: "焊接", sort: 7, active: true },
      { id: "polish", name: "打磨", sort: 8, active: true }
    ],
    customers: [{ id: "customer", name: "客户", active: true }],
    orders: [{ id: "order", orderNo: "OLD", customerId: "customer", productName: "产品", quantity: 1, dueDate: "2099-01-01", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "OLD", orderId: "order", productName: "产品", planQty: 1, status: "生产中" }],
    routes: [
      { id: "weld-route", workOrderId: "work", processId: "weld", processName: "焊接", sequence: 1, status: "待开始", planQty: 1, completedQty: 0 },
      { id: "polish-route", workOrderId: "work", processId: "polish", processName: "打磨", sequence: 2, status: "待开始", planQty: 1, completedQty: 0 }
    ],
    reports: [], exceptions: [], customerFeedbacks: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function request(urlPath, userId = "", options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();

  const bootstrap = await request("/api/bootstrap", "manager");
  const names = bootstrap.data.processes.map((item) => item.name);
  assert.ok(names.indexOf("焊接") < names.indexOf("机加"));
  assert.ok(names.indexOf("机加") < names.indexOf("打磨"));
  const machining = bootstrap.data.processes.find((item) => item.name === "机加");
  assert.ok(machining?.active);
  assert.ok(!bootstrap.data.routes.some((item) => item.processName === "机加"), "既有工单不得自动增加机加路线");

  const added = await request("/api/routes", "manager", { method: "POST", body: { workOrderId: "work", processId: machining.id, assignedTo: "machinist" } });
  assert.strictEqual(added.status, 200);
  assert.strictEqual(added.data.route.assignedRole, "machining_worker");
  const rejected = await request("/api/assign", "manager", { method: "POST", body: { routeId: added.data.route.id, userId: "welder" } });
  assert.strictEqual(rejected.status, 400);
  const after = await request("/api/bootstrap", "manager");
  assert.deepStrictEqual(after.data.routes.filter((item) => item.workOrderId === "work").sort((a, b) => a.sequence - b.sequence).map((item) => item.processName), ["焊接", "机加", "打磨"]);

  const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const miniRoles = fs.readFileSync(path.join(root, "miniprogram", "utils", "roles.js"), "utf8");
  const miniColors = fs.readFileSync(path.join(root, "miniprogram", "utils", "process-style.js"), "utf8");
  assert.ok(appSource.includes('machining_worker: "机加师傅"'));
  assert.ok(appSource.includes('机加: "machining_worker"'));
  assert.ok(appSource.includes('"焊接", "机加", "打磨"'));
  assert.ok(!appSource.includes('["设计", "激光", "折弯", "焊接", "机加", "打磨", "质检"].includes(p.name)'), "机加不应默认勾选");
  assert.ok(miniRoles.includes('machining_worker: "机加师傅"'));
  assert.ok(miniColors.includes("机加:"));
  console.log("machining-process: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

