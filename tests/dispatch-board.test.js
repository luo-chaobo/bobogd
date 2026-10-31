const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-dispatch-board-"));
const port = 32219;
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
      { id: "allowed", name: "Allowed", phone: "15257457485", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "allowed-1", name: "Allowed 1", phone: "13456125046", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "allowed-2", name: "Allowed 2", phone: "13757433269", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "allowed-3", name: "Allowed 3", phone: "13777234068", role: "owner", roles: ["owner"], password: "1", active: true },
      { id: "allowed-5", name: "Allowed 5", phone: "15728038503", role: "manager", roles: ["manager"], password: "1", active: true },
      { id: "other", name: "Other", phone: "13800000000", role: "manager", roles: ["manager"], password: "1", active: true }
    ],
    deletedUsers: [],
    processes: [{ id: "p1", name: "焊接", sort: 1, active: true }],
    customers: [{ id: "c1", name: "Customer", active: true }],
    orders: [{ id: "o1", orderNo: "O-1", customerId: "c1", productName: "Part", quantity: 1, dueDate: "2099-01-01", priority: "普通", status: "生产中" }],
    workOrders: [{ id: "w1", workNo: "W-1", orderId: "o1", productName: "Part", planQty: 1, status: "生产中", currentProcess: "焊接" }],
    routes: [
      { id: "waiting", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 1, status: "待开始", planQty: 1, completedQty: 0 },
      { id: "paused", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 2, status: "暂停", planQty: 1, completedQty: 0 },
      { id: "active", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 3, status: "进行中", planQty: 1, completedQty: 0 },
      { id: "done", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 4, status: "已完成", planQty: 1, completedQty: 1 },
      { id: "error", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 5, status: "异常", planQty: 1, completedQty: 0 },
      { id: "rework", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 6, status: "返工", planQty: 1, completedQty: 0 }
    ],
    reports: [], exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
  }), "utf8");
}

async function request(urlPath, { userId = "", token = "", method = "GET", body } = {}) {
  const headers = {};
  if (userId) headers["x-user-id"] = userId;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/tv-dashboard`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("test server startup timeout");
}

async function toggle(token, routeId, expectedStatus) {
  return request("/api/dispatch-board/route-toggle", {
    token,
    method: "POST",
    body: { routeId, expectedStatus }
  });
}

async function updateDispatch(token, path, body) {
  return request(path, { token, method: "POST", body });
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), DB_DRIVER: "json", TV_VIEW_TOKEN_SECRET: "dispatch-test-secret" },
    stdio: "ignore"
  });
  await waitForServer();

  assert.strictEqual((await request("/api/dispatch-board-token")).status, 401);
  assert.strictEqual((await request("/api/dispatch-board-token", { userId: "other" })).status, 403);
  for (const userId of ["allowed", "allowed-1", "allowed-2", "allowed-3", "allowed-5"]) {
    assert.strictEqual((await request("/api/dispatch-board-token", { userId })).status, 200);
  }
  const dispatchTokenResponse = await request("/api/dispatch-board-token", { userId: "allowed" });
  assert.strictEqual(dispatchTokenResponse.status, 200);
  const dispatchToken = dispatchTokenResponse.data.token;
  const mobileToken = (await request("/api/tv-viewer-token", { userId: "allowed" })).data.token;

  const board = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(dispatchToken)}`);
  assert.strictEqual(board.data.activeOrders[0].customer.name, "Customer");
  assert.strictEqual((await toggle("", "waiting", "待开始")).status, 401);
  assert.strictEqual((await toggle(`${dispatchToken}x`, "waiting", "待开始")).status, 401);
  const expiredPayload = Buffer.from(JSON.stringify({ userId: "allowed", audience: "dispatch-board", expiresAt: Date.now() - 1 })).toString("base64url");
  const expiredSignature = crypto.createHmac("sha256", "dispatch-test-secret").update(expiredPayload).digest("base64url");
  assert.strictEqual((await toggle(`${expiredPayload}.${expiredSignature}`, "waiting", "待开始")).status, 401);
  assert.strictEqual((await toggle(mobileToken, "waiting", "待开始")).status, 403);

  const expiredPayloadForEdit = Buffer.from(JSON.stringify({ userId: "allowed", audience: "dispatch-board", expiresAt: Date.now() - 1 })).toString("base64url");
  const expiredEditToken = `${expiredPayloadForEdit}.${crypto.createHmac("sha256", "dispatch-test-secret").update(expiredPayloadForEdit).digest("base64url")}`;
  const routeUpdate = (token, body) => updateDispatch(token, "/api/dispatch-board/route-schedule", body);
  const dueUpdate = (token, body) => updateDispatch(token, "/api/dispatch-board/order-due-date", body);
  assert.strictEqual((await routeUpdate("", { routeId: "waiting" })).status, 401);
  assert.strictEqual((await routeUpdate(mobileToken, { routeId: "waiting" })).status, 403);
  assert.strictEqual((await routeUpdate(expiredEditToken, { routeId: "waiting" })).status, 401);
  assert.strictEqual((await routeUpdate(dispatchToken, { routeId: "done", expectedStartDate: "", expectedEndDate: "", plannedStartDate: "2026-10-25", plannedEndDate: "2026-10-25" })).status, 400);
  assert.strictEqual((await routeUpdate(dispatchToken, { routeId: "waiting", expectedStartDate: "", expectedEndDate: "", plannedStartDate: "2026-10-26", plannedEndDate: "2026-10-25" })).status, 400);
  const concurrentScheduleUpdates = await Promise.all([
    routeUpdate(dispatchToken, { routeId: "paused", expectedStartDate: "", expectedEndDate: "", plannedStartDate: "2026-10-26", plannedEndDate: "2026-10-27" }),
    routeUpdate(dispatchToken, { routeId: "paused", expectedStartDate: "", expectedEndDate: "", plannedStartDate: "2026-10-28", plannedEndDate: "2026-10-29" }),
  ]);
  assert.deepStrictEqual(concurrentScheduleUpdates.map((item) => item.status).sort(), [200, 409]);
  assert.strictEqual((await routeUpdate(dispatchToken, { routeId: "waiting", expectedStartDate: "wrong", expectedEndDate: "", plannedStartDate: "", plannedEndDate: "" })).status, 409);
  const planned = await routeUpdate(dispatchToken, { routeId: "waiting", expectedStartDate: "", expectedEndDate: "", plannedStartDate: "2026/10/26", plannedEndDate: "2026/10/27" });
  assert.strictEqual(planned.status, 200);
  assert.strictEqual(planned.data.route.plannedStartDate, "2026-10-26");
  assert.strictEqual(planned.data.route.plannedEndDate, "2026-10-27");
  const boardAfterSchedule = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(dispatchToken)}`);
  assert.strictEqual(boardAfterSchedule.data.activeOrders[0].routes.find((item) => item.id === "waiting").plannedStartDate, "2026-10-26");
  assert.strictEqual((await routeUpdate(dispatchToken, { routeId: "waiting", expectedStartDate: "", expectedEndDate: "", plannedStartDate: "", plannedEndDate: "" })).status, 409);
  assert.strictEqual((await dueUpdate("", { orderId: "o1" })).status, 401);
  assert.strictEqual((await dueUpdate(mobileToken, { orderId: "o1" })).status, 403);
  assert.strictEqual((await dueUpdate(dispatchToken, { orderId: "missing", expectedDueDate: "2099-01-01", dueDate: "2099-02-01" })).status, 404);
  assert.strictEqual((await dueUpdate(dispatchToken, { orderId: "o1", expectedDueDate: "wrong", dueDate: "2099-02-01" })).status, 409);
  assert.strictEqual((await dueUpdate(dispatchToken, { orderId: "o1", expectedDueDate: "2099-01-01", dueDate: "2099-02-30" })).status, 400);
  const due = await dueUpdate(dispatchToken, { orderId: "o1", expectedDueDate: "2099-01-01", dueDate: "2099-02-01" });
  assert.strictEqual(due.status, 200);
  assert.strictEqual(due.data.order.dueDate, "2099-02-01");
  const boardAfterDue = await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(dispatchToken)}`);
  assert.strictEqual(boardAfterDue.data.activeOrders[0].order.dueDate, "2099-02-01");

  const started = await toggle(dispatchToken, "waiting", "待开始");
  assert.strictEqual(started.status, 200);
  assert.strictEqual(started.data.route.status, "进行中");
  assert.ok(started.data.route.startedAt);
  assert.strictEqual((await toggle(dispatchToken, "paused", "暂停")).data.route.status, "进行中");
  const paused = await toggle(dispatchToken, "active", "进行中");
  assert.strictEqual(paused.data.route.status, "暂停");
  assert.ok(paused.data.route.pausedAt);

  assert.strictEqual((await toggle(dispatchToken, "waiting", "待开始")).status, 409);
  assert.strictEqual((await toggle(dispatchToken, "done", "已完成")).status, 400);
  assert.strictEqual((await toggle(dispatchToken, "error", "异常")).status, 400);
  assert.strictEqual((await toggle(dispatchToken, "rework", "返工")).status, 400);

  const db = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "db.json"), "utf8"));
  const audit = db.auditLogs.filter((item) => item.action === "dispatch-board-route-toggle");
  assert.strictEqual(audit.length, 3);
  assert.deepStrictEqual(audit[0].detail, { beforeStatus: "待开始", afterStatus: "进行中", planQty: 1, completedQty: 0 });
  assert.deepStrictEqual(db.routes.find((item) => item.id === "waiting").plannedStartDate, "2026-10-26");
  assert.strictEqual(db.orders.find((item) => item.id === "o1").dueDate, "2099-02-01");
  assert.deepStrictEqual(db.auditLogs.find((item) => item.action === "dispatch-board-route-schedule" && item.targetId === "waiting").detail, {
    before: { plannedStartDate: "", plannedEndDate: "" }, after: { plannedStartDate: "2026-10-26", plannedEndDate: "2026-10-27" },
  });
  assert.deepStrictEqual(db.auditLogs.filter((item) => item.action === "dispatch-board-order-due-date")[0].detail, {
    beforeDueDate: "2099-01-01", afterDueDate: "2099-02-01",
  });
  assert.strictEqual(db.auditLogs.find((item) => item.action === "dispatch-board-route-schedule" && item.targetId === "waiting").actorId, "allowed");
  assert.strictEqual(db.auditLogs.find((item) => item.action === "dispatch-board-order-due-date").actorId, "allowed");

  const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const tvSource = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
  const tvStyles = fs.readFileSync(path.join(root, "public", "tv.css"), "utf8");
  assert.ok(appSource.includes('data-action="openDispatchBoard"'));
  assert.ok(appSource.includes("permissions?.viewBoardCustomer"));
  assert.ok(appSource.includes("/api/dispatch-board-token"));
  assert.ok(tvSource.includes('params.get("dispatch") === "1"'));
  assert.ok(tvSource.includes("/api/dispatch-board/route-toggle"));
  assert.ok(tvSource.includes("expectedStatus"));
  assert.ok(tvSource.includes("dispatch-clickable"));
  assert.ok(tvSource.includes("dispatch-schedule"));
  assert.ok(tvSource.includes("dispatch-due-date"));
  assert.ok(tvSource.includes("是否对排期进行更改"));
  assert.ok(tvSource.includes("是否对交期进行更改"));
  assert.ok(tvSource.includes("/api/dispatch-board/route-schedule"));
  assert.ok(tvSource.includes("/api/dispatch-board/order-due-date"));
  assert.ok(tvSource.includes('document.addEventListener("dblclick"'));
  const clickHandler = tvSource.split('document.addEventListener("click", (event) => {')[1].split('document.addEventListener("dblclick", (event) => {')[0];
  const doubleClickHandler = tvSource.split('document.addEventListener("dblclick", (event) => {')[1].split('document.addEventListener("input", (event) => {')[0];
  assert.ok(!clickHandler.includes("beginDispatchEditFromNode"), "Single click must not open dispatch edit, including mobile=1 mode");
  assert.ok(clickHandler.includes('event.target.closest(".route-node.dispatch-clickable")'), "Single click on a toggleable route date must reach its route node");
  assert.match(clickHandler, /if \(dueNode\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/, "Single click on due date must not edit or toggle a route");
  assert.ok(clickHandler.includes("toggleDispatchRoute(node)"), "Single click must retain start/pause behavior");
  assert.ok(doubleClickHandler.includes("clearTimeout(pending)"), "Double click must cancel a pending start/pause action");
  assert.ok(doubleClickHandler.includes("beginDispatchEditFromNode(scheduleNode || dueNode)"), "Double click must open schedule or due-date editing");
  assert.ok(tvSource.includes("dispatchClickTimers"));
  assert.ok(tvSource.includes("queuedLoadResolvers"));
  assert.ok(tvSource.includes("}, 500));"));
  assert.ok(tvSource.includes("data-dispatch-edit-cancel"));
  assert.ok(tvSource.includes("开始日不得晚于结束日") || tvSource.includes("计划开始日不能晚于结束日"));
  assert.ok(tvStyles.includes("body.dispatch-board .route-node.dispatch-clickable"));
  assert.ok(tvStyles.includes("touch-action: manipulation"));
  console.log("dispatch-board: ok");
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
