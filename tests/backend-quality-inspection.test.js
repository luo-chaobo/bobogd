const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-backend-quality-"));
const port = 31994;
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
      { id: "worker", name: "激光工", phone: "2", role: "laser_worker", roles: ["laser_worker"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [{ id: "laser", name: "激光", sort: 1, active: true }],
    customers: [{ id: "customer", name: "客户" }],
    orders: [{ id: "order", orderNo: "Q1", customerId: "customer", productName: "产品", quantity: 10, dueDate: "2099-01-01", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "Q1", orderId: "order", productName: "产品", planQty: 10, status: "生产中", currentProcess: "激光" }],
    routes: [
      { id: "laserRoute", workOrderId: "work", processId: "laser", processName: "激光", sequence: 1, assignedRole: "laser_worker", assignedTo: "", status: "进行中", planQty: 10, completedQty: 5 },
      { id: "qualityRoute", workOrderId: "work", processId: "quality", processName: "质检", sequence: 2, assignedRole: "quality", assignedTo: "", status: "待开始", planQty: 10, completedQty: 0 }
    ],
    reports: [],
    exceptions: [],
    attachments: [],
    auditLogs: [],
    settings: {}
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
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();

  let bootstrap = await request("/api/bootstrap", "manager");
  assert.strictEqual(bootstrap.data.routes.find((route) => route.id === "qualityRoute").inspectionAvailableQty, 0);

  const blocked = await request("/api/report", "manager", {
    routeId: "qualityRoute", autoStartQuality: true, submittedQty: 10, inspectedQty: 10, goodQty: 10, badQty: 0, disposition: "无需处理"
  });
  assert.strictEqual(blocked.status, 400);

  const finishLaser = await request("/api/report", "worker", { routeId: "laserRoute", completedQty: 5, reworkQty: 0 });
  assert.strictEqual(finishLaser.status, 200);

  bootstrap = await request("/api/bootstrap", "manager");
  assert.strictEqual(bootstrap.data.routes.find((route) => route.id === "qualityRoute").inspectionAvailableQty, 10);

  const completed = await request("/api/report", "manager", {
    routeId: "qualityRoute", autoStartQuality: true, submittedQty: 10, inspectedQty: 10, goodQty: 10, badQty: 0, disposition: "无需处理"
  });
  assert.strictEqual(completed.status, 200);

  bootstrap = await request("/api/bootstrap", "manager");
  assert.strictEqual(bootstrap.data.routes.find((route) => route.id === "qualityRoute").status, "已完成");
  console.log("backend-quality-inspection: ok");
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (child) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
