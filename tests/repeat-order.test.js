const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-repeat-order-"));
const port = 32160;
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
      { id: "manager", name: "主管", phone: "1", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "quality", name: "质检", phone: "2", role: "quality", roles: ["quality"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [
      { id: "p1", name: "激光", sort: 1, active: true },
      { id: "p2", name: "折弯", sort: 2, active: true }
    ],
    customers: [{ id: "c1", name: "海天", active: true }],
    orders: [
      { id: "o1", orderNo: "OLD-1", customerId: "c1", productName: "箱体", drawingNo: "LASER-1", quantity: 5, quantityUnit: "套", dueDate: "2026-09-01", priority: "急单", weightKg: 20, status: "已完成", note: "原备注", createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "o2", orderNo: "ACTIVE-1", customerId: "c1", productName: "在产件", quantity: 2, quantityUnit: "件", dueDate: "2026-10-01", priority: "普通", status: "生产中", note: "", createdAt: "2026-09-01T00:00:00.000Z" }
    ],
    workOrders: [
      { id: "w1", workNo: "OLD-1", orderId: "o1", productName: "箱体", planQty: 5, status: "已完成", currentProcess: "", completedAt: "2026-08-30T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "w2", workNo: "ACTIVE-1", orderId: "o2", productName: "在产件", planQty: 2, status: "生产中", currentProcess: "激光", createdAt: "2026-09-01T00:00:00.000Z" }
    ],
    routes: [
      { id: "r1", workOrderId: "w1", processId: "p1", processName: "激光", sequence: 1, status: "已完成", planQty: 5, completedQty: 5, assignedTo: "manager", plannedStartDate: "2026-08-01", plannedEndDate: "2026-08-02" },
      { id: "r2", workOrderId: "w1", processId: "p2", processName: "折弯", sequence: 2, status: "已完成", planQty: 5, completedQty: 5 },
      { id: "rr", workOrderId: "w1", processId: "p2", processName: "折弯", sequence: 3, routeType: "rework", status: "已完成", planQty: 1, completedQty: 1 },
      { id: "ra", workOrderId: "w2", processId: "p1", processName: "激光", sequence: 1, status: "进行中", planQty: 2, completedQty: 0 }
    ],
    reports: [{ id: "rep1", routeId: "r1", workOrderId: "w1", completedQty: 5, createdAt: "2026-08-02T00:00:00.000Z" }],
    exceptions: [],
    drawings: [{ id: "d1", name: "箱体.pdf", fileType: "pdf", url: "/uploads/drawings/box.pdf", orderId: "o1", workOrderId: "w1", customerId: "c1", createdAt: "2026-08-01T00:00:00.000Z" }],
    attachments: [{ id: "a1", attachmentType: "drawing", name: "箱体.pdf", fileType: "pdf", url: "/uploads/drawings/box.pdf", orderId: "o1", workOrderId: "w1", customerId: "c1", createdAt: "2026-08-01T00:00:00.000Z" }],
    auditLogs: [], settings: {}, customerFeedbacks: []
  }, null, 2), "utf8");
}

async function request(urlPath, userId, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  const history = await request("/api/history/work-orders", "manager");
  const source = history.data.items.find((item) => item.id === "w1");
  assert.strictEqual(source.priority, "急单");
  assert.strictEqual(source.note, "原备注");

  const validBody = { sourceWorkOrderId: "w1", orderNo: "NEW-1", quantity: 8, dueDate: "2026-10-10", priority: "普通", weightKg: 35, note: "返单备注" };
  assert.strictEqual((await request("/api/orders/repeat", "quality", "POST", validBody)).status, 403);
  assert.strictEqual((await request("/api/orders/repeat", "manager", "POST", { ...validBody, sourceWorkOrderId: "w2" })).status, 409);
  assert.strictEqual((await request("/api/orders/repeat", "manager", "POST", { ...validBody, orderNo: "OLD-1" })).status, 409);
  assert.strictEqual((await request("/api/orders/repeat", "manager", "POST", { ...validBody, quantity: 0 })).status, 400);
  assert.strictEqual((await request("/api/orders/repeat", "manager", "POST", { ...validBody, dueDate: "bad-date" })).status, 400);
  assert.strictEqual((await request("/api/orders/repeat", "manager", "POST", { ...validBody, weightKg: -1 })).status, 400);

  const created = await request("/api/orders/repeat", "manager", "POST", validBody);
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.data.order.orderNo, "NEW-1");

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  const newOrder = db.orders.find((item) => item.id === created.data.order.id);
  const newWorkOrder = db.workOrders.find((item) => item.id === created.data.workOrder.id);
  assert.deepStrictEqual(
    { customerId: newOrder.customerId, productName: newOrder.productName, drawingNo: newOrder.drawingNo, quantityUnit: newOrder.quantityUnit, quantity: newOrder.quantity, status: newOrder.status },
    { customerId: "c1", productName: "箱体", drawingNo: "LASER-1", quantityUnit: "套", quantity: 8, status: "生产中" }
  );
  assert.strictEqual(db.orders.find((item) => item.id === "o1").orderNo, "OLD-1");
  const newRoutes = db.routes.filter((item) => item.workOrderId === newWorkOrder.id);
  assert.deepStrictEqual(newRoutes.map((item) => item.processName), ["激光", "折弯"]);
  assert.ok(newRoutes.every((item) => item.status === "待开始" && item.completedQty === 0 && item.planQty === 8 && !item.assignedTo && !item.plannedStartDate));
  assert.strictEqual(db.reports.filter((item) => item.workOrderId === newWorkOrder.id).length, 0);
  const copiedDrawing = db.drawings.find((item) => item.workOrderId === newWorkOrder.id);
  assert.ok(copiedDrawing && copiedDrawing.id !== "d1" && copiedDrawing.url === "/uploads/drawings/box.pdf");
  assert.ok(db.attachments.some((item) => item.workOrderId === newWorkOrder.id && item.id !== "a1"));
  assert.ok(db.auditLogs.some((item) => item.action === "order-repeat-create" && item.detail.sourceWorkOrderId === "w1"));
  assert.strictEqual((await request("/api/orders/repeat", "manager", "POST", validBody)).status, 409);

  const removeCopy = await request("/api/orders/update", "manager", "POST", {
    orderId: newOrder.id,
    orderNo: newOrder.orderNo,
    customerId: newOrder.customerId,
    productName: newOrder.productName,
    drawingNo: newOrder.drawingNo,
    quantity: newOrder.quantity,
    quantityUnit: newOrder.quantityUnit,
    weightKg: newOrder.weightKg,
    dueDate: newOrder.dueDate,
    priority: newOrder.priority,
    note: newOrder.note,
    removeDrawingIds: [copiedDrawing.id]
  });
  assert.strictEqual(removeCopy.status, 200);
  const finalDb = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.ok(finalDb.drawings.find((item) => item.id === copiedDrawing.id).removedAt);
  assert.strictEqual(Boolean(finalDb.drawings.find((item) => item.id === "d1").removedAt), false);
  console.log("repeat-order: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
