const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-role-test-"));
const port = 31987;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(
    path.join(tempRoot, "data", "db.json"),
    JSON.stringify({
      users: [
        { id: "admin", name: "主管", phone: "1", role: "manager", password: "1", active: true },
        { id: "multi", name: "兼职员工", phone: "2", role: "worker", roles: ["bend_worker", "polish_worker"], password: "1", active: true },
        { id: "bend2", name: "折弯乙", phone: "3", role: "bend_worker", password: "1", active: true },
        { id: "laser", name: "激光甲", phone: "4", role: "laser_worker", password: "1", active: true }
      ],
      deletedUsers: [],
      processes: [
        { id: "old_design", name: "图纸设计", sort: 1, active: true },
        { id: "old_tap", name: "打孔攻丝", sort: 2, active: true },
        { id: "old_assembly", name: "组装", sort: 3, active: true },
        { id: "bend", name: "折弯", sort: 4, active: true }
      ],
      customers: [{ id: "c", name: "客户" }],
      orders: [{ id: "o", orderNo: "T1", customerId: "c", productName: "产品", quantity: 10, dueDate: "2099-01-01", status: "生产中" }],
      workOrders: [{ id: "w", workNo: "T1", orderId: "o", productName: "产品", planQty: 10, status: "生产中", currentProcess: "图纸设计" }],
      routes: [
        { id: "designRoute", workOrderId: "w", processId: "old_design", processName: "图纸设计", sequence: 1, assignedTo: "", status: "待开始", planQty: 10, completedQty: 0 },
        { id: "bendRoute", workOrderId: "w", processId: "bend", processName: "折弯", sequence: 2, assignedTo: "", status: "待开始", planQty: 10, completedQty: 0 },
        { id: "polishRoute", workOrderId: "w", processId: "custom", processName: "打磨", sequence: 3, assignedTo: "", status: "待开始", planQty: 10, completedQty: 0 }
      ],
      reports: [],
      exceptions: [],
      attachments: [],
      auditLogs: [],
      settings: {}
    }, null, 2),
    "utf8"
  );
}

async function request(urlPath, userId = "", options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  return { status: response.status, data };
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
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore"
  });
  await waitForServer();

  const bootstrap = await request("/api/bootstrap", "admin");
  assert.strictEqual(bootstrap.status, 200);
  assert.deepStrictEqual(bootstrap.data.processes.slice(0, 11).map((item) => item.name), ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "机加", "打磨", "喷塑", "装配"]);
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "designRoute").assignedRole, "design_worker");

  const tasks = await request("/api/my-tasks", "multi");
  assert.strictEqual(tasks.status, 200);
  assert.deepStrictEqual(tasks.data.tasks.map((item) => item.id).sort(), ["bendRoute", "polishRoute"]);

  const assignWrongRole = await request("/api/assign", "admin", {
    method: "POST",
    body: { routeId: "bendRoute", userId: "laser", targetFinishTime: "2026/06/30 17" }
  });
  assert.strictEqual(assignWrongRole.status, 400);

  const assignOnePerson = await request("/api/assign", "admin", {
    method: "POST",
    body: { routeId: "bendRoute", userId: "multi", targetFinishTime: "2026/06/30 17" }
  });
  assert.strictEqual(assignOnePerson.status, 200);

  const blockedWorker = await request("/api/route-status", "bend2", {
    method: "POST",
    body: { routeId: "bendRoute", status: "进行中" }
  });
  assert.strictEqual(blockedWorker.status, 403);

  const assignedWorker = await request("/api/route-status", "multi", {
    method: "POST",
    body: { routeId: "bendRoute", status: "进行中" }
  });
  assert.strictEqual(assignedWorker.status, 200);

  const finalDb = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(finalDb.routes.find((item) => item.id === "bendRoute").targetFinishTime, "2026-06-30T17:00");
  console.log("multi-role-flow: ok");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
