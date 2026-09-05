const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-mobile-board-"));
const port = 31994;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "worker", name: "工人", phone: "1", role: "worker", password: "1", active: true }],
    processes: [],
    customers: [{ id: "customer", name: "客户" }],
    orders: [{ id: "order", orderNo: "O-1", customerId: "customer", productName: "产品", quantity: 10, dueDate: "2099-01-01", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "W-1", orderId: "order", productName: "产品", planQty: 10, status: "生产中", currentProcess: "设计" }],
    routes: [{ id: "route", workOrderId: "work", processName: "设计", sequence: 1, status: "进行中", planQty: 10, completedQty: 0 }],
    reports: [], exceptions: [], attachments: [], auditLogs: [], settings: {},
    drawings: [
      { id: "drawing-image", orderId: "order", workOrderId: "work", url: "/uploads/drawings/image.png", name: "very-long-image-name.png", fileType: "png", previewUrl: "", previewError: "" },
      { id: "drawing-cad", orderId: "order", workOrderId: "work", url: "/uploads/drawings/part.dwg", name: "very-long-cad-name.dwg", fileType: "dwg", previewUrl: "/uploads/previews/part.svg", previewError: "" }
    ]
  }), "utf8");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { headers: { "x-user-id": "worker" } });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();
  const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { headers: { "x-user-id": "worker" } });
  const data = await response.json();
  const workOrder = data.workOrders.find((item) => item.id === "work");
  assert.deepStrictEqual(workOrder.drawings.map((item) => item.id), ["drawing-image", "drawing-cad"]);
  assert.strictEqual(workOrder.drawings[1].previewUrl, "/uploads/previews/part.svg");

  const boardWxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.wxml"), "utf8");
  assert.ok(!boardWxml.includes("drawing-actions"), "生产看板卡片不再显示图纸预览/下载操作区");
  console.log("mobile-board-drawings: ok");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => child?.kill());
