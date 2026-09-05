const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-closure-"));
const port = 32151;
let child;

function seed() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "vip", name: "白名单", phone: "15257457485", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "manager", name: "普通主管", phone: "13000000000", role: "manager", roles: ["manager"], password: "1", active: true }
    ], deletedUsers: [], processes: [{ id: "p1", name: "折弯", active: true }], customers: [{ id: "c1", name: "客户", active: true }],
    orders: [
      { id: "o1", orderNo: "DONE", customerId: "c1", productName: "产品", weightKg: 12, quantity: 2, dueDate: "2026-08-03", status: "已完成", createdAt: "2026-08-01T01:00:00.000Z" },
      { id: "o2", orderNo: "ACTIVE", customerId: "c1", productName: "在制品", quantity: 1, dueDate: "2026-08-10", status: "生产中", createdAt: "2026-08-02T01:00:00.000Z" }
    ],
    workOrders: [
      { id: "w1", workNo: "DONE", orderId: "o1", productName: "产品", planQty: 2, status: "已完成", completedAt: "2026-08-05T02:00:00.000Z", createdAt: "2026-08-01T01:00:00.000Z" },
      { id: "w2", workNo: "ACTIVE", orderId: "o2", productName: "在制品", planQty: 1, status: "生产中", createdAt: "2026-08-02T01:00:00.000Z" }
    ],
    routes: [{ id: "r1", workOrderId: "w1", processId: "p1", processName: "折弯", sequence: 1, status: "已完成", planQty: 2, completedQty: 2 }],
    reports: [], exceptions: [{ id: "e1", workOrderId: "w1", routeId: "r1", source: "quality-inspection", type: "尺寸", description: "偏差", status: "已解决", reporterId: "vip", createdAt: "2026-08-05T03:00:00.000Z", images: [] }],
    customerFeedbacks: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2));
}

async function request(url, userId, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json", "x-user-id": userId }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}

async function wait() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server timeout");
}

async function run() {
  seed();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await wait();

  const due = await request("/api/history/work-orders?dateType=dueDate&from=2026-08-03&to=2026-08-03", "vip");
  assert.deepStrictEqual(due.data.items.map((item) => item.id), ["w1"]);
  const completed = await request("/api/history/work-orders?dateType=completedAt&from=2026-08-05&to=2026-08-05&status=已完成", "vip");
  assert.strictEqual(completed.data.items[0].weightKg, 12);
  assert.strictEqual(completed.data.items[0].qualityExceptions.length, 1);

  const feedback = await request("/api/customer-feedbacks", "vip", "POST", { customerId: "c1", workOrderId: "w1", routeId: "r1", feedbackAt: "2026-08-06", description: "客户反馈划伤", images: ["/uploads/f.jpg"] });
  assert.strictEqual(feedback.status, 200);
  assert.strictEqual(feedback.data.item.status, "待处理");
  assert.strictEqual((await request("/api/customer-feedbacks", "manager")).status, 403);
  assert.strictEqual((await request("/api/customer-feedbacks", "manager", "POST", { workOrderId: "w1" })).status, 403);

  const resolved = await request("/api/customer-feedbacks/resolve", "vip", "POST", { id: feedback.data.item.id, solution: "补发处理" });
  assert.strictEqual(resolved.status, 200);
  assert.strictEqual(resolved.data.item.status, "已处理");

  const shipped = await request("/api/orders/fulfillment", "vip", "POST", { orderId: "o1", shipped: true, invoiced: false });
  assert.strictEqual(shipped.status, 200);
  assert.strictEqual(shipped.data.status, "已发货");
  const invoiced = await request("/api/orders/fulfillment", "vip", "POST", { orderId: "o1", shipped: false, invoiced: true });
  assert.strictEqual(invoiced.data.status, "已开票");
  assert.strictEqual((await request("/api/orders/fulfillment", "manager", "POST", { orderId: "o1", shipped: true, invoiced: true })).status, 403);

  const vipHistory = await request("/api/history/work-orders?status=已开票", "vip");
  assert.strictEqual(vipHistory.data.items[0].customerFeedbacks.length, 1);
  const managerHistory = await request("/api/history/work-orders", "manager");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(managerHistory.data.items[0], "customerFeedbacks"), false);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(db.workOrders[0].status, "已完成");
  assert.strictEqual(db.workOrders[0].completedAt, "2026-08-05T02:00:00.000Z");
  assert.ok(db.auditLogs.some((item) => item.action === "customer-feedback-create"));
  assert.ok(db.auditLogs.some((item) => item.action === "order-fulfillment-update"));
  console.log("history-closure-feedback: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
