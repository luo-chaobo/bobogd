const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-tv-privacy-"));
const port = 32205;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "lib", "order-financials.js"), path.join(tempRoot, "lib", "order-financials.js"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [
      { id: "allowed-1", name: "Allowed 1", phone: "13456125046", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "allowed-2", name: "Allowed 2", phone: "13757433269", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "allowed-3", name: "Allowed 3", phone: "13777234068", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "manager", name: "Manager", phone: "15257457485", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "allowed-5", name: "Allowed 5", phone: "15728038503", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "other-manager", name: "Other Manager", phone: "9", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "other-owner", name: "Other Owner", phone: "8", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "other-admin", name: "Other Admin", phone: "7", role: "admin", roles: ["admin"], password: "1", active: true },
      { id: "worker", name: "Worker", phone: "2", role: "weld_worker", roles: ["weld_worker"], password: "1", active: true },
      { id: "disabled", name: "Disabled", phone: "3", role: "manager", roles: ["manager"], password: "1", active: false }
    ],
    deletedUsers: [],
    processes: [{ id: "p1", name: "焊接", sort: 1, active: true }],
    customers: [{ id: "c1", name: "Secret Customer", contact: "Contact", phone: "13800000000", address: "Address", note: "Note", active: true }],
    orders: [{ id: "o1", orderNo: "O-1", customerId: "c1", productName: "Part", quantity: 1, dueDate: "2099-01-01", priority: "普通", status: "生产中" }],
    workOrders: [{ id: "w1", workNo: "W-1", orderId: "o1", productName: "Part", planQty: 1, status: "生产中", currentProcess: "焊接" }],
    routes: [{ id: "r1", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 1, status: "待开始", planQty: 1, completedQty: 0 }],
    reports: [], exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }), "utf8");
}

async function request(urlPath, userId = "") {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    headers: userId ? { "x-user-id": userId } : {}
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
  throw new Error("test server startup timeout");
}

function assertCustomerHidden(data) {
  const customer = data.activeOrders[0].customer || {};
  assert.strictEqual(customer.name, undefined);
  assert.strictEqual(customer.contact, undefined);
  assert.strictEqual(customer.phone, undefined);
  assert.strictEqual(customer.address, undefined);
  assert.strictEqual(customer.note, undefined);
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), DB_DRIVER: "json", TV_VIEW_TOKEN_SECRET: "", WX_APP_SECRET: "" },
    stdio: "ignore"
  });
  await waitForServer();

  const anonymous = await request("/api/tv-dashboard");
  assert.strictEqual(anonymous.status, 200);
  assertCustomerHidden(anonymous.data);

  const managerMe = await request("/api/me", "manager");
  const workerMe = await request("/api/me", "worker");
  assert.strictEqual(managerMe.data.permissions.viewBoardCustomer, true);
  assert.strictEqual(workerMe.data.permissions.viewBoardCustomer, false);
  const allowedUserIds = ["allowed-1", "allowed-2", "allowed-3", "manager", "allowed-5"];
  for (const userId of allowedUserIds) {
    const allowedMe = await request("/api/me", userId);
    assert.strictEqual(allowedMe.data.permissions.viewBoardCustomer, true);
    const allowedToken = await request("/api/tv-viewer-token", userId);
    assert.strictEqual(allowedToken.status, 200);
    const allowedBoard = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(allowedToken.data.token)}`);
    assert.strictEqual(allowedBoard.data.activeOrders[0].customer.name, "Secret Customer");
  }
  const otherManagerMe = await request("/api/me", "other-manager");
  assert.strictEqual(otherManagerMe.data.permissions.viewBoardCustomer, false);
  const otherOwnerMe = await request("/api/me", "other-owner");
  const otherAdminMe = await request("/api/me", "other-admin");
  assert.strictEqual(otherOwnerMe.data.permissions.viewBoardCustomer, false);
  assert.strictEqual(otherAdminMe.data.permissions.viewBoardCustomer, false);

  const workerToken = await request("/api/tv-viewer-token", "worker");
  assert.strictEqual(workerToken.status, 200);
  const workerBoard = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(workerToken.data.token)}`);
  assertCustomerHidden(workerBoard.data);

  const managerToken = await request("/api/tv-viewer-token", "manager");
  assert.strictEqual(managerToken.status, 200);
  const managerBoard = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(managerToken.data.token)}`);
  assert.strictEqual(managerBoard.data.activeOrders[0].customer.name, "Secret Customer");

  const otherManagerToken = await request("/api/tv-viewer-token", "other-manager");
  const otherManagerBoard = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(otherManagerToken.data.token)}`);
  assertCustomerHidden(otherManagerBoard.data);

  const forgedBoard = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(`${managerToken.data.token}x`)}`);
  assertCustomerHidden(forgedBoard.data);

  const disabledToken = await request("/api/tv-viewer-token", "disabled");
  assert.strictEqual(disabledToken.status, 401);

  const web = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const tv = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
  const miniTv = fs.readFileSync(path.join(root, "miniprogram", "pages", "tv", "tv.js"), "utf8");
  const miniTvToken = fs.readFileSync(path.join(root, "miniprogram", "utils", "tv-token.js"), "utf8");
  const miniBoard = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.wxml"), "utf8");
  assert.ok(web.includes("/api/tv-viewer-token"));
  assert.ok(tv.includes("viewerToken"));
  assert.ok(miniTv.includes("prepareTvViewerToken"));
  assert.ok(miniTvToken.includes("/api/tv-viewer-token"));
  assert.ok(miniBoard.includes("viewBoardCustomer"));
  console.log("tv-customer-privacy: ok");
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
