const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-dashboard-optimization-"));
const port = 32401;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public", "uploads", "drawings"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "lib", "order-financials.js"), path.join(tempRoot, "lib", "order-financials.js"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "public", "uploads", "drawings", "part.pdf"), "%PDF-1.4 test", "utf8");
  const orders = ["active-a", "active-b", "pending"].map((id) => ({ id, orderNo: id, customerId: "customer", productName: id, quantity: 1, dueDate: "2099-01-01", status: "生产中" }));
  const workOrders = orders.map((order) => ({ id: `work-${order.id}`, workNo: order.id, orderId: order.id, productName: order.id, planQty: 1, status: "生产中", currentProcess: "激光", creationStatus: order.id === "pending" ? "pending" : "created" }));
  const routes = workOrders.map((workOrder, index) => ({ id: `route-${index}`, workOrderId: workOrder.id, processId: "laser", processName: "激光", sequence: 1, status: "待开始", planQty: 1, completedQty: 0 }));
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "owner", name: "老板", phone: "1", role: "owner", roles: ["owner"], password: "1", active: true }],
    deletedUsers: [], processes: [{ id: "laser", name: "激光", sort: 1, active: true }],
    customers: [{ id: "customer", name: "客户", active: true }], orders, workOrders, routes,
    reports: [], exceptions: [], attachments: [], auditLogs: [], settings: {}, customerFeedbacks: [],
    drawings: [{ id: "drawing", orderId: "active-a", workOrderId: "work-active-a", url: "/uploads/drawings/part.pdf", name: "part.pdf", originalName: "part.pdf", fileType: "pdf", contentType: "application/pdf", previewUrl: "", previewError: "" }]
  }), "utf8");
}

async function request(urlPath, options = {}) {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, options);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await request("/api/tv-dashboard")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json", TV_VIEW_TOKEN_SECRET: "dashboard-test-secret", WX_APP_SECRET: "" }, stdio: "ignore" });
  await waitForServer();

  const dashboard = await request("/api/dashboard", { headers: { "x-user-id": "owner" } });
  const dashboardData = await dashboard.json();
  assert.strictEqual(dashboardData.active, 2, "小程序和后台必须排除待建工单");
  assert.deepStrictEqual(dashboardData.workOrders.map((item) => item.id), ["work-active-a", "work-active-b"]);

  const tokenResponse = await request("/api/tv-viewer-token", { headers: { "x-user-id": "owner" } });
  const { token } = await tokenResponse.json();
  const first = await request(`/api/tv-dashboard?limit=1&offset=0&viewerToken=${encodeURIComponent(token)}`);
  const firstData = await first.json();
  assert.strictEqual(firstData.activeOrderTotal, 2);
  assert.strictEqual(firstData.activeOrders.length, 1);
  assert.strictEqual(firstData.activeOrders[0].drawingCount, 1);
  assert.strictEqual(firstData.activeOrders[0].drawings, undefined, "首屏不得附带图纸元数据");
  assert.strictEqual(first.headers.get("x-tv-cache"), "MISS");

  const second = await request(`/api/tv-dashboard?limit=1&offset=1&viewerToken=${encodeURIComponent(token)}`);
  const secondData = await second.json();
  assert.strictEqual(secondData.activeOrders.length, 1);
  assert.strictEqual(second.headers.get("x-tv-cache"), "HIT");

  const drawings = await request(`/api/tv-orders/work-active-a/drawings?viewerToken=${encodeURIComponent(token)}`);
  assert.strictEqual(drawings.status, 200);
  assert.deepStrictEqual((await drawings.json()).items.map((item) => item.id), ["drawing"]);
  console.log("dashboard-optimization: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
