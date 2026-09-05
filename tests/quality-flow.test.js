const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-quality-test-"));
const port = 31988;
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
        { id: "laser", name: "激光", phone: "2", role: "laser_worker", roles: ["laser_worker"], password: "1", active: true },
        { id: "quality", name: "质检", phone: "3", role: "quality", roles: ["quality"], password: "1", active: true }
      ],
      deletedUsers: [],
      processes: [{ id: "laserProcess", name: "激光", sort: 1, active: true }],
      customers: [{ id: "customer", name: "客户" }],
      orders: [{ id: "order", orderNo: "Q1", customerId: "customer", productName: "产品", quantity: 10, dueDate: "2099-01-01", status: "生产中" }],
      workOrders: [{ id: "work", workNo: "Q1", orderId: "order", productName: "产品", planQty: 10, status: "生产中", currentProcess: "质检" }],
      routes: [
        { id: "laserRoute", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 1, assignedRole: "laser_worker", assignedTo: "", status: "已完成", planQty: 10, completedQty: 10 },
        { id: "qualityRoute", workOrderId: "work", processId: "missingQuality", processName: "质检", sequence: 2, assignedRole: "quality", assignedTo: "", status: "进行中", planQty: 10, completedQty: 0 }
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
  return { status: response.status, data: await response.json() };
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

  let bootstrap = await request("/api/bootstrap", "admin");
  const qualityProcess = bootstrap.data.processes.find((item) => item.name === "质检");
  assert.ok(qualityProcess);
  assert.strictEqual(qualityProcess.active, true);
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "qualityRoute").inspectionAvailableQty, 10);

  const disableLaser = await request("/api/processes/update-status", "admin", {
    method: "POST",
    body: { processId: "laserProcess", active: false }
  });
  assert.strictEqual(disableLaser.status, 200);

  const blockedOrder = await request("/api/orders", "admin", {
    method: "POST",
    body: { orderNo: "Q2", customerId: "customer", productName: "产品", quantity: 2, dueDate: "2099-01-02", processIds: ["laserProcess", qualityProcess.id] }
  });
  assert.strictEqual(blockedOrder.status, 400);

  await request("/api/processes/update-status", "admin", {
    method: "POST",
    body: { processId: "laserProcess", active: true }
  });

  const decimalWeight = await request("/api/orders", "admin", {
    method: "POST",
    body: { orderNo: "Q-WEIGHT", customerId: "customer", productName: "产品", quantity: 2, weightKg: "6.5", dueDate: "2099-01-03", processIds: ["laserProcess", qualityProcess.id] }
  });
  assert.strictEqual(decimalWeight.status, 400);

  const createdOrder = await request("/api/orders", "admin", {
    method: "POST",
    body: { orderNo: "Q3", customerId: "customer", productName: "产品", quantity: 2, weightKg: "6", dueDate: "2099-01-03", processIds: [qualityProcess.id, "laserProcess"] }
  });
  assert.strictEqual(createdOrder.status, 200);
  assert.strictEqual(createdOrder.data.order.weightKg, 6);
  let db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  const createdRoutes = db.routes.filter((item) => item.workOrderId === createdOrder.data.workOrder.id).sort((a, b) => a.sequence - b.sequence);
  assert.deepStrictEqual(createdRoutes.map((item) => item.processName), ["激光", "质检"]);

  const invalidInspection = await request("/api/report", "quality", {
    method: "POST",
    body: { routeId: "qualityRoute", submittedQty: 10, inspectedQty: 9, goodQty: 8, badQty: 1, disposition: "返工", reworkTargetRouteId: "laserRoute", exceptionDescription: "尺寸不合格" }
  });
  assert.strictEqual(invalidInspection.status, 400);

  const qualityReport = await request("/api/report", "quality", {
    method: "POST",
    body: { routeId: "qualityRoute", submittedQty: 10, inspectedQty: 10, goodQty: 8, badQty: 2, disposition: "返工", reworkTargetRouteId: "laserRoute", exceptionDescription: "尺寸不合格" }
  });
  assert.strictEqual(qualityReport.status, 200);

  db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  const reworkRoute = db.routes.find((item) => item.routeType === "rework");
  assert.ok(reworkRoute);
  assert.strictEqual(reworkRoute.planQty, 2);
  assert.strictEqual(db.exceptions.find((item) => item.reworkRouteId === reworkRoute.id).status, "待处理");

  bootstrap = await request("/api/bootstrap", "quality");
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "qualityRoute").inspectionAvailableQty, 0);
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "qualityRoute").pendingReworkQty, 2);

  await request("/api/route-status", "laser", {
    method: "POST",
    body: { routeId: reworkRoute.id, status: "进行中" }
  });
  const finishRework = await request("/api/report", "laser", {
    method: "POST",
    body: { routeId: reworkRoute.id, completedQty: 2, reworkQty: 0 }
  });
  assert.strictEqual(finishRework.status, 200);

  bootstrap = await request("/api/bootstrap", "quality");
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "qualityRoute").inspectionAvailableQty, 2);
  assert.strictEqual(bootstrap.data.routes.find((item) => item.id === "qualityRoute").pendingReworkQty, 0);

  const finalInspection = await request("/api/report", "quality", {
    method: "POST",
    body: { routeId: "qualityRoute", submittedQty: 2, inspectedQty: 2, goodQty: 2, badQty: 0, disposition: "无需处理" }
  });
  assert.strictEqual(finalInspection.status, 200);

  db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(db.routes.find((item) => item.id === "qualityRoute").status, "已完成");
  assert.strictEqual(db.exceptions.find((item) => item.reworkRouteId === reworkRoute.id).status, "已解决");
  console.log("quality-flow: ok");
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
