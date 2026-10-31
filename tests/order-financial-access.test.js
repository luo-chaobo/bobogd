const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobo-order-financials-"));
const port = 32371;
let child;
let childOutput = "";

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  for (const file of ["server.js", "lib/weapp-image.js", "lib/work-order-state.js", "lib/order-financials.js"]) {
    fs.copyFileSync(path.join(root, file), path.join(tempRoot, file));
  }
  fs.writeFileSync(path.join(tempRoot, "public/index.html"), "test");
  fs.writeFileSync(path.join(tempRoot, "data/db.json"), JSON.stringify({
    users: [
      { id: "luo", name: "罗朝波", role: "manager", roles: ["manager"], active: true },
      { id: "zheng-jin", name: "郑金波", role: "manager", roles: ["manager"], active: true },
      { id: "zheng-xue", name: "郑学良", role: "manager", roles: ["manager"], active: true },
      { id: "duplicate-luo", name: "罗朝波", role: "manager", roles: ["manager"], active: true },
      { id: "ordinary", name: "普通主管", role: "manager", roles: ["manager"], active: true },
    ],
    deletedUsers: [], processes: [{ id: "p1", name: "焊接", sort: 1, active: true }],
    customers: [{ id: "c1", name: "客户", active: true }],
    orders: [
      { id: "o1", orderNo: "SO-1", customerId: "c1", productName: "机架", quantity: 2, quantityUnit: "件", dueDate: "2099-01-01", priority: "普通", status: "生产中", unitPrice: 10, totalAmount: 20 },
      { id: "o-delivery", orderNo: "PLATFORM-1", customerId: "c1", productName: "配送件", quantity: 1, quantityUnit: "件", dueDate: "2099-01-01", priority: "普通", status: "已完成", orderOrigin: "platform", sourceChannel: "website", unitPrice: 50, totalAmount: 50, region: "浙江", deliveryAddress: "宁波" },
    ],
    workOrders: [
      { id: "w1", workNo: "SO-1", orderId: "o1", productName: "机架", planQty: 2, status: "生产中", currentProcess: "焊接", completedAt: "" },
      { id: "w-delivery", workNo: "PLATFORM-1", orderId: "o-delivery", productName: "配送件", planQty: 1, status: "已完成", creationStatus: "confirmed" },
    ],
    routes: [{ id: "r1", workOrderId: "w1", processId: "p1", processName: "焊接", sequence: 1, status: "进行中", planQty: 2, completedQty: 0 }],
    reports: [], exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}, customerFeedbacks: [],
  }));
}

async function request(pathname, userId, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { "x-user-id": userId, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { "x-user-id": "ordinary" } })).ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`test server exited ${child.exitCode}: ${childOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`test server startup timed out: ${childOutput}`);
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), DB_DRIVER: "json", NODE_PATH: path.join(root, "node_modules") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });
  await waitForServer();

  const authorized = await request("/api/me", "zheng-jin");
  const duplicated = await request("/api/me", "luo");
  const ordinary = await request("/api/me", "ordinary");
  assert.equal(authorized.data.permissions.viewOrderFinancials, true);
  assert.equal(duplicated.data.permissions.viewOrderFinancials, false);
  assert.equal(ordinary.data.permissions.viewOrderFinancials, false);

  const createBody = { orderNo: "SO-2", customerId: "c1", productName: "支架", quantity: 3, quantityUnit: "件", dueDate: "2099/01/01", priority: "普通", processIds: ["p1"], unitPrice: "12.35", totalAmount: 999 };
  const unauthorizedCreate = await request("/api/orders", "ordinary", "POST", { ...createBody, orderNo: "SO-3" });
  assert.equal(unauthorizedCreate.status, 403);
  const created = await request("/api/orders", "zheng-jin", "POST", createBody);
  assert.equal(created.status, 200);
  assert.equal(created.data.order.unitPrice, 12.35);
  assert.equal(created.data.order.totalAmount, 37.05);

  const unauthorizedWrite = await request("/api/orders/update", "ordinary", "POST", {
    orderId: "o1", orderNo: "SO-1", customerId: "c1", productName: "机架", quantity: 2,
    quantityUnit: "件", dueDate: "2099/01/01", priority: "普通", unitPrice: 500, totalAmount: 1,
  });
  assert.equal(unauthorizedWrite.status, 403);
  const invalidPrice = await request("/api/orders/update", "zheng-jin", "POST", {
    orderId: "o1", orderNo: "SO-1", customerId: "c1", productName: "机架", quantity: 2,
    quantityUnit: "件", dueDate: "2099/01/01", priority: "普通", unitPrice: "1.234",
  });
  assert.equal(invalidPrice.status, 400);
  const edited = await request("/api/orders/update", "zheng-jin", "POST", {
    orderId: "o1", orderNo: "SO-1", customerId: "c1", productName: "机架", quantity: 4,
    quantityUnit: "件", dueDate: "2099/01/01", priority: "普通", unitPrice: 7.25, totalAmount: 999,
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.order.totalAmount, 29);

  const bootstrap = await request("/api/bootstrap", "ordinary");
  const dashboard = await request("/api/dashboard", "ordinary");
  const ordinaryDeliveries = await request("/api/deliveries/available", "ordinary");
  const authorizedDeliveries = await request("/api/deliveries/available", "zheng-jin");
  assert.equal(Object.hasOwn(bootstrap.data.orders[0], "unitPrice"), false);
  assert.equal(Object.hasOwn(bootstrap.data.workOrders[0].order, "totalAmount"), false);
  assert.equal(Object.hasOwn(dashboard.data.workOrders[0].order, "unitPrice"), false);
  assert.equal(Object.hasOwn(ordinaryDeliveries.data.orders.find((order) => order.id === "o-delivery"), "unitPrice"), false);
  assert.equal(authorizedDeliveries.data.orders.find((order) => order.id === "o-delivery").totalAmount, 50);
  const authorizedBootstrap = await request("/api/bootstrap", "zheng-jin");
  assert.equal(authorizedBootstrap.data.workOrders[0].order.totalAmount, 29);
  const stored = JSON.parse(fs.readFileSync(path.join(tempRoot, "data/db.json"), "utf8"));
  assert.equal(stored.orderFinancialAccessUserIds["郑金波"], "zheng-jin");
  assert.equal(stored.orderFinancialAccessUserIds["罗朝波"], "");
  assert.equal(stored.orders.find((order) => order.id === "o1").unitPrice, 7.25);
  assert.equal(stored.orders.find((order) => order.id === "o1").totalAmount, 29);
  assert.equal((await request("/api/users/delete", "ordinary", "POST", { userId: "zheng-xue" })).status, 200);
  assert.equal((await request("/api/users", "ordinary", "POST", { name: "郑学良", phone: "13800000000", role: "manager" })).status, 200);
  const afterReplacement = JSON.parse(fs.readFileSync(path.join(tempRoot, "data/db.json"), "utf8"));
  const replacement = afterReplacement.users.find((item) => item.phone === "13800000000");
  assert.ok(replacement);
  assert.equal((await request("/api/me", replacement.id)).data.permissions.viewOrderFinancials, false);
  assert.equal(afterReplacement.orderFinancialAccessUserIds["郑学良"], "zheng-xue");
  console.log("order-financial-access: all assertions passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
