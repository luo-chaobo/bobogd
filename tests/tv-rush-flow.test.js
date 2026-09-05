const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-tv-rush-test-"));
const port = 31989;
let child;

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  const orders = [
    { id: "normal", priority: "普通", dueDate: dateOffset(7), status: "生产中" },
    { id: "rush", priority: "急单", dueDate: dateOffset(7), status: "生产中" },
    { id: "rushOverdue", priority: "急单", dueDate: dateOffset(-1), status: "生产中" },
    { id: "rushUrgent", priority: "急单", dueDate: dateOffset(1), status: "生产中" },
    { id: "rushDone", priority: "急单", dueDate: dateOffset(-2), status: "已完成" }
  ].map((order) => ({
    ...order,
    orderNo: order.id,
    customerId: "customer",
    productName: order.id,
    quantity: 1
  }));
  const workOrders = orders.map((order) => ({
    id: `work-${order.id}`,
    workNo: order.orderNo,
    orderId: order.id,
    productName: order.productName,
    planQty: 1,
    status: order.status,
    currentProcess: "激光",
    completedAt: order.status === "已完成" ? new Date().toISOString() : ""
  }));
  const routes = workOrders.map((workOrder) => ({
    id: `route-${workOrder.id}`,
    workOrderId: workOrder.id,
    processId: "laser",
    processName: "激光",
    sequence: 1,
    assignedRole: "laser_worker",
    assignedTo: "",
    status: workOrder.status === "已完成" ? "已完成" : "待开始",
    planQty: 1,
    completedQty: workOrder.status === "已完成" ? 1 : 0,
    completedAt: workOrder.completedAt
  }));
  fs.writeFileSync(
    path.join(tempRoot, "data", "db.json"),
    JSON.stringify({
      users: [],
      deletedUsers: [],
      processes: [{ id: "laser", name: "激光", sort: 2, active: true }],
      customers: [{ id: "customer", name: "客户" }],
      orders,
      workOrders,
      routes,
      reports: [],
      exceptions: [],
      attachments: [],
      auditLogs: [],
      settings: {}
    }, null, 2),
    "utf8"
  );
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

  const response = await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`);
  const data = await response.json();
  assert.strictEqual(data.summary.rushWorkOrders, 3);
  assert.strictEqual(data.activeOrders.filter((order) => order.isRush).length, 3);
  assert.strictEqual(data.activeOrders.some((order) => order.order.id === "rushDone"), false);
  assert.strictEqual(data.activeOrders.find((order) => order.order.id === "normal").isRush, false);
  assert.strictEqual(data.activeOrders.find((order) => order.order.id === "rushOverdue").dueLevel, "overdue");
  assert.strictEqual(data.activeOrders.find((order) => order.order.id === "rushUrgent").dueLevel, "urgent");
  console.log("tv-rush-flow: ok");
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
