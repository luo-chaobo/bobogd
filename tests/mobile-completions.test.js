const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-mobile-completions-"));
const port = 32257;
let child;

function shanghaiDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

function localDay(offset, time = "12:00:00") {
  const today = new Date(`${shanghaiDateKey()}T00:00:00+08:00`);
  today.setUTCDate(today.getUTCDate() + offset);
  return `${shanghaiDateKey(today)}T${time}+08:00`;
}

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  const workOrders = [
    { id: "today", workNo: "TODAY", orderId: "today-order", status: "已完成", completedAt: localDay(0, "00:05:00") },
    { id: "three", workNo: "THREE", orderId: "three-order", status: "已完成", completedAt: localDay(-2) },
    { id: "seven", workNo: "SEVEN", orderId: "seven-order", status: "已完成", completedAt: localDay(-6) },
    { id: "thirty", workNo: "THIRTY", orderId: "thirty-order", status: "已完成", completedAt: localDay(-29) },
    { id: "old", workNo: "OLD", orderId: "old-order", status: "已完成", completedAt: localDay(-30) },
    { id: "active", workNo: "ACTIVE", orderId: "active-order", status: "生产中", completedAt: localDay(0) },
    { id: "fallback", workNo: "FALLBACK", orderId: "fallback-order", status: "已完成", completedAt: "" },
    { id: "invalid", workNo: "INVALID", orderId: "invalid-order", status: "已完成", completedAt: "not-a-date" }
  ].map((item) => ({ productName: item.workNo, planQty: 1, currentProcess: "质检", ...item }));
  const orders = workOrders.map((item) => ({ id: item.orderId, orderNo: item.workNo, customerId: "customer", productName: item.productName, quantity: 1, quantityUnit: "件", status: item.status }));
  orders.find((item) => item.id === "three-order").shippedAt = localDay(-1);
  const routes = workOrders.map((item, index) => ({
    id: `route-${index}`, workOrderId: item.id, processName: "质检", sequence: 1,
    status: item.status === "已完成" && item.id !== "invalid" ? "已完成" : "进行中", planQty: 1,
    completedQty: item.status === "已完成" ? 1 : 0,
    completedAt: item.id === "fallback" ? localDay(0, "23:55:00") : ""
  }));
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "vip", name: "白名单", phone: "15257457485", role: "manager", roles: ["manager"], active: true },
      { id: "manager", name: "普通主管", phone: "9", role: "manager", roles: ["manager"], active: true },
      { id: "worker", name: "工人", phone: "8", role: "weld_worker", roles: ["weld_worker"], active: true }
    ],
    deletedUsers: [], processes: [], customers: [{ id: "customer", name: "客户" }], orders, workOrders, routes,
    reports: [], exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function request(pathname, userId = "worker") {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { "x-user-id": userId } });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  assert.strictEqual((await request("/api/mobile/completions?period=today")).data.count, 2);
  assert.strictEqual((await request("/api/mobile/completions?period=3d")).data.count, 3);
  assert.strictEqual((await request("/api/mobile/completions?period=7d")).data.count, 4);
  assert.strictEqual((await request("/api/mobile/completions?period=30d")).data.count, 5);
  assert.strictEqual((await request("/api/mobile/completions?period=bad")).status, 400);
  assert.strictEqual((await request("/api/mobile/completions?period=today&includeItems=1", "manager")).status, 403);

  const details = await request("/api/mobile/completions?period=3d&includeItems=1", "vip");
  assert.strictEqual(details.status, 200);
  assert.strictEqual(details.data.items.length, 3);
  assert.strictEqual(details.data.canManageOrderFulfillment, true);
  assert.ok(details.data.items.some((item) => item.workNo === "THREE" && item.status === "已发货"));
  assert.ok(details.data.items.every((item) => item.customerName === "客户"));
  console.log("mobile-completions: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
