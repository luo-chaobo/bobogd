const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-management-export-"));
const port = 32261;
let child;

function seed() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  for (const file of ["weapp-image.js", "management-report-export.js", "work-order-state.js"]) {
    fs.copyFileSync(path.join(root, "lib", file), path.join(tempRoot, "lib", file));
  }
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "manager", name: "主管", role: "manager", roles: ["manager"], active: true },
      { id: "worker", name: "工人", role: "weld_worker", roles: ["weld_worker"], active: true },
    ],
    deletedUsers: [], processes: [], customers: [], orders: [],
    workOrders: [{ id: "w1", workNo: "WO-1", productName: "机架", status: "生产中", planQty: 1 }],
    routes: [{ id: "r1", workOrderId: "w1", processName: "焊接", sequence: 1, status: "进行中", planQty: 1, completedQty: 0 }],
    reports: [{ id: "rep1", reporterId: "worker", workOrderId: "w1", routeId: "r1", completedQty: 1, createdAt: "2026-08-10T01:00:00.000Z", scheduleStatus: "unplanned" }],
    exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}, customerFeedbacks: [],
  }), "utf8");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { "x-user-id": "manager" } })).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seed();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), DB_DRIVER: "json", NODE_PATH: path.join(root, "node_modules") },
    stdio: "ignore",
  });
  await waitForServer();
  const pathName = "/api/reports/management-export?from=2026-08-01&to=2026-08-31";
  const denied = await fetch(`http://127.0.0.1:${port}${pathName}`, { headers: { "x-user-id": "worker" } });
  assert.strictEqual(denied.status, 403);
  const invalid = await fetch(`http://127.0.0.1:${port}/api/reports/management-export?from=2026-08-31&to=2026-08-01`, { headers: { "x-user-id": "manager" } });
  assert.strictEqual(invalid.status, 400);
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`, { headers: { "x-user-id": "manager" } });
  assert.strictEqual(response.status, 200);
  assert.ok(response.headers.get("content-type").includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
  assert.ok(response.headers.get("content-disposition").includes("2026-08-01_2026-08-31"));
  assert.ok((await response.arrayBuffer()).byteLength > 10000);
  console.log("management-report-export-api: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
