const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-route-status-"));
const port = 32241;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  const stateModule = path.join(root, "lib", "work-order-state.js");
  if (fs.existsSync(stateModule)) fs.copyFileSync(stateModule, path.join(tempRoot, "lib", "work-order-state.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "manager", name: "主管", phone: "1", role: "manager", roles: ["manager"], active: true }],
    deletedUsers: [], processes: [], customers: [],
    orders: [{ id: "order", orderNo: "WO-1", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "WO-1", orderId: "order", planQty: 10, status: "生产中", currentProcess: "设计" }],
    routes: [
      { id: "full", workOrderId: "work", processName: "设计", sequence: 1, status: "已完成", planQty: 10, completedQty: 10 },
      { id: "override", workOrderId: "work", processName: "激光", sequence: 2, status: "已完成", planQty: 10, completedQty: 10 },
      { id: "partial", workOrderId: "work", processName: "焊接", sequence: 3, status: "进行中", planQty: 10, completedQty: 8 },
      { id: "issue", workOrderId: "work", processName: "质检", sequence: 4, status: "异常", planQty: 10, completedQty: 10 }
    ],
    reports: [],
    exceptions: [{ id: "exception", workOrderId: "work", routeId: "issue", status: "待处理", createdAt: "2026-01-01T00:00:00.000Z" }],
    attachments: [], drawings: [], auditLogs: [], settings: {}
  }, null, 2), "utf8");
}

async function request(urlPath, body) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "manager" },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port), DB_DRIVER: "json" }, stdio: "ignore" });
  await waitForServer();

  for (const status of ["进行中", "暂停", "待开始"]) {
    const result = await request("/api/route-status", { routeId: "full", status });
    assert.strictEqual(result.status, 409, `满额工序不应改为${status}`);
  }

  const incomplete = await request("/api/route-status", { routeId: "partial", status: "已完成" });
  assert.strictEqual(incomplete.status, 409);

  const unresolved = await request("/api/route-status", { routeId: "issue", status: "已完成" });
  assert.strictEqual(unresolved.status, 409);

  const abnormalOverride = await request("/api/route-status", { routeId: "override", status: "异常" });
  assert.strictEqual(abnormalOverride.status, 200);

  const resolved = await request("/api/exceptions/resolve", { id: "exception", status: "已解决", solution: "已处理" });
  assert.strictEqual(resolved.status, 200);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  assert.strictEqual(db.routes.find((item) => item.id === "full").status, "已完成");
  assert.strictEqual(db.routes.find((item) => item.id === "partial").status, "进行中");
  assert.strictEqual(db.routes.find((item) => item.id === "issue").status, "已完成");
  assert.strictEqual(db.routes.find((item) => item.id === "override").status, "异常");
  assert.strictEqual(db.workOrders[0].status, "异常");
  console.log("route-status-consistency: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
