const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-tube-cut-"));
const port = 32016;
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
      { id: "laser", name: "激光", phone: "2", role: "laser_worker", roles: ["laser_worker"], password: "1", active: true },
      { id: "bend", name: "折弯", phone: "3", role: "bend_worker", roles: ["bend_worker"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [
      { id: "design", name: "设计", sort: 1, active: true },
      { id: "laserProcess", name: "激光", sort: 2, active: true },
      { id: "bendProcess", name: "折弯", sort: 3, active: true },
      { id: "quality", name: "质检", sort: 4, active: true }
    ],
    customers: [{ id: "customer", name: "客户", active: true }],
    orders: [
      { id: "orderLaser", orderNo: "L1", customerId: "customer", productName: "产品", quantity: 5, dueDate: "2099-01-01", status: "生产中" },
      { id: "orderTube", orderNo: "T1", customerId: "customer", productName: "产品", quantity: 5, dueDate: "2099-01-01", status: "生产中" }
    ],
    workOrders: [
      { id: "workLaser", workNo: "L1", orderId: "orderLaser", productName: "产品", planQty: 5, status: "生产中" },
      { id: "workTube", workNo: "T1", orderId: "orderTube", productName: "产品", planQty: 5, status: "生产中" }
    ],
    routes: [
      { id: "laserRoute", workOrderId: "workLaser", processId: "laserProcess", processName: "激光", sequence: 1, status: "待开始", planQty: 5, completedQty: 0 },
      { id: "bendAfterLaser", workOrderId: "workLaser", processId: "bendProcess", processName: "折弯", sequence: 2, status: "待开始", planQty: 5, completedQty: 0 },
      { id: "tubeRoute", workOrderId: "workTube", processId: "legacyTube", processName: "切管", sequence: 1, status: "待开始", planQty: 5, completedQty: 0 },
      { id: "bendAfterTube", workOrderId: "workTube", processId: "bendProcess", processName: "折弯", sequence: 2, status: "待开始", planQty: 5, completedQty: 0 }
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
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

function routeNames(items, workOrderId) {
  return items.filter((item) => item.workOrderId === workOrderId).sort((a, b) => a.sequence - b.sequence).map((item) => item.processName);
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();

  const bootstrap = await request("/api/bootstrap", "manager");
  assert.strictEqual(bootstrap.status, 200);
  assert.deepStrictEqual(bootstrap.data.processes.map((item) => item.name).slice(0, 4), ["设计", "激光", "切管", "折弯"]);
  const tubeProcess = bootstrap.data.processes.find((item) => item.name === "切管");
  assert.ok(tubeProcess?.active);
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "tubeRoute").assignedRole, "laser_worker");

  const laserTasks = await request("/api/my-tasks", "laser");
  const bendTasks = await request("/api/my-tasks", "bend");
  assert.ok(laserTasks.data.tasks.some((item) => item.id === "tubeRoute"));
  assert.ok(!bendTasks.data.tasks.some((item) => item.id === "tubeRoute"));

  const created = await request("/api/orders", "manager", {
    method: "POST",
    body: { orderNo: "NEW", customerId: "customer", productName: "新产品", quantity: 2, dueDate: "2099-02-01", processIds: ["bendProcess", tubeProcess.id, "laserProcess"] }
  });
  assert.strictEqual(created.status, 200);
  const afterCreate = await request("/api/bootstrap", "manager");
  assert.deepStrictEqual(routeNames(afterCreate.data.routes, created.data.workOrder.id), ["激光", "切管", "折弯"]);

  assert.strictEqual((await request("/api/routes", "manager", { method: "POST", body: { workOrderId: "workLaser", processId: tubeProcess.id } })).status, 200);
  assert.strictEqual((await request("/api/routes", "manager", { method: "POST", body: { workOrderId: "workTube", processId: "laserProcess" } })).status, 200);
  const afterInsert = await request("/api/bootstrap", "manager");
  assert.deepStrictEqual(routeNames(afterInsert.data.routes, "workLaser"), ["激光", "切管", "折弯"]);
  assert.deepStrictEqual(routeNames(afterInsert.data.routes, "workTube"), ["激光", "切管", "折弯"]);

  const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.ok(appSource.includes('["设计", "激光", "切管", "折弯"'));
  assert.ok(appSource.includes('切管: "laser_worker"'));
  assert.ok(!appSource.includes('["设计", "激光", "切管", "折弯", "焊接", "打磨", "质检"].includes(p.name)'));
  console.log("tube-cut-process: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
