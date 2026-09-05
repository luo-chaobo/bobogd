const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-quality-scrap-test-"));
const port = 31994;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(
    path.join(tempRoot, "data", "db.json"),
    JSON.stringify({
      users: [{ id: "quality", name: "质检", phone: "1", role: "quality", roles: ["quality"], password: "1", active: true }],
      deletedUsers: [],
      processes: [{ id: "laserProcess", name: "激光", sort: 1, active: true }],
      customers: [{ id: "customer", name: "客户" }],
      orders: [{ id: "order", orderNo: "Q1", customerId: "customer", productName: "产品", quantity: 5, dueDate: "2099-01-01", status: "生产中" }],
      workOrders: [{ id: "work", workNo: "Q1", orderId: "order", productName: "产品", planQty: 5, status: "生产中", currentProcess: "质检" }],
      routes: [
        { id: "laserRoute", workOrderId: "work", processId: "laserProcess", processName: "激光", sequence: 1, assignedRole: "laser_worker", status: "已完成", planQty: 5, completedQty: 5 },
        { id: "qualityRoute", workOrderId: "work", processId: "qualityProcess", processName: "质检", sequence: 2, assignedRole: "quality", status: "进行中", planQty: 5, completedQty: 0 }
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

async function request(urlPath, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-user-id": "quality" },
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

  const result = await request("/api/report", {
    method: "POST",
    body: {
      routeId: "qualityRoute",
      submittedQty: 5,
      inspectedQty: 5,
      goodQty: 4,
      badQty: 1,
      disposition: "报废",
      issueRouteId: "laserRoute",
      exceptionDescription: "孔位报废",
      images: ["/uploads/problem.jpg"]
    }
  });
  assert.strictEqual(result.status, 200);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(db.routes.some((item) => item.routeType === "rework"), false);
  assert.strictEqual(db.exceptions.length, 1);
  assert.strictEqual(db.exceptions[0].routeId, "laserRoute");
  assert.strictEqual(db.exceptions[0].qualityRouteId, "qualityRoute");
  assert.strictEqual(db.exceptions[0].qualityReportId, result.data.report.id);
  assert.strictEqual(db.exceptions[0].type, "激光");
  assert.strictEqual(db.exceptions[0].disposition, "报废");
  assert.strictEqual(db.exceptions[0].badQty, 1);
  assert.deepStrictEqual(db.exceptions[0].images, ["/uploads/problem.jpg"]);

  const history = await request("/api/history/exceptions?processName=激光");
  assert.strictEqual(history.status, 200);
  assert.deepStrictEqual(history.data.items.map((item) => item.description), ["孔位报废"]);
  console.log("quality-scrap-exception: ok");
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
