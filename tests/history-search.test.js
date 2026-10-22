const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-history-test-"));
const port = 31991;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public", "uploads"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(
    path.join(tempRoot, "data", "db.json"),
    JSON.stringify({
      users: [{ id: "admin", name: "主管", phone: "1", role: "manager", roles: ["manager"], password: "1", active: true }],
      deletedUsers: [],
      processes: [{ id: "laser", name: "激光", sort: 1, active: true }],
      customers: [
        { id: "c1", name: "海天" },
        { id: "c2", name: "其他客户" }
      ],
      orders: [
        { id: "o1", orderNo: "AA-20260725", customerId: "c1", productName: "YYYYYYY", quantity: 10, dueDate: "2026-08-01", status: "生产中", createdAt: "2026-07-25T08:00:00.000Z" },
        { id: "o2", orderNo: "BB-20260701", customerId: "c2", productName: "旧产品", quantity: 5, dueDate: "2026-07-02", status: "已完成", createdAt: "2026-07-01T08:00:00.000Z" }
      ],
      workOrders: [
        { id: "w1", workNo: "AA-20260725", orderId: "o1", productName: "YYYYYYY", planQty: 10, status: "生产中", currentProcess: "激光", createdAt: "2026-07-25T08:00:00.000Z" },
        { id: "w2", workNo: "BB-20260701", orderId: "o2", productName: "旧产品", planQty: 5, status: "已完成", currentProcess: "激光", createdAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-10-21T23:56:00.000Z" }
      ],
      routes: [
        { id: "r1", workOrderId: "w1", processId: "laser", processName: "激光", sequence: 1, status: "进行中", planQty: 10, completedQty: 0 },
        { id: "r2", workOrderId: "w2", processId: "laser", processName: "激光", sequence: 1, status: "已完成", planQty: 5, completedQty: 5 }
      ],
      reports: [],
      exceptions: [
        { id: "e1", workOrderId: "w1", routeId: "r1", type: "尺寸", description: "孔位偏差", status: "待处理", reporterId: "admin", createdAt: "2026-07-25T09:00:00.000Z", images: ["/uploads/a.jpg"] }
      ],
      attachments: [],
      auditLogs: [],
      settings: {}
    }, null, 2),
    "utf8"
  );
}

async function request(urlPath) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    headers: { "content-type": "application/json", "x-user-id": "admin" }
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

  const workOrders = await request("/api/history/work-orders?customerId=c1&status=生产中&from=2026-07-20&to=2026-07-31");
  assert.strictEqual(workOrders.status, 200);
  assert.deepStrictEqual(workOrders.data.items.map((item) => item.workNo), ["AA-20260725"]);
  assert.strictEqual(workOrders.data.items[0].customerName, "海天");

  const exceptions = await request("/api/history/exceptions?customerId=c1&processName=激光&from=2026-07-20&to=2026-07-31");
  const completedOnShanghai22 = await request("/api/history/work-orders?dateType=completedAt&from=2026-10-22&to=2026-10-22");
  assert.strictEqual(completedOnShanghai22.status, 200);
  assert.deepStrictEqual(completedOnShanghai22.data.items.map((item) => item.workNo), ["BB-20260701"]);

  const notCompletedOnShanghai21 = await request("/api/history/work-orders?dateType=completedAt&from=2026-10-21&to=2026-10-21");
  assert.strictEqual(notCompletedOnShanghai21.status, 200);
  assert.deepStrictEqual(notCompletedOnShanghai21.data.items, []);

  assert.strictEqual(exceptions.status, 200);
  assert.deepStrictEqual(exceptions.data.items.map((item) => item.id), ["e1"]);
  assert.strictEqual(exceptions.data.items[0].workNo, "AA-20260725");
  assert.strictEqual(exceptions.data.items[0].customerName, "海天");

  console.log("history-search: ok");
}

run()
  .catch((error) => {
    console.error(error && (error.stack || error.message) ? (error.stack || error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
