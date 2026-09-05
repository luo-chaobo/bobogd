const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-mobile-task-drawings-"));
const port = 31995;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "worker", name: "worker", phone: "1", role: "admin", roles: ["admin"], password: "1", active: true }],
    processes: [],
    customers: [{ id: "customer", name: "customer" }],
    orders: [{ id: "order", orderNo: "O-1", customerId: "customer", productName: "product", quantity: 10, dueDate: "2099-01-01", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "W-1", orderId: "order", productName: "product", planQty: 10, status: "生产中", currentProcess: "设计" }],
    routes: [
      { id: "route-design", workOrderId: "work", processName: "设计", sequence: 1, assignedRole: "worker", status: "进行中", planQty: 10, completedQty: 0 },
      { id: "route-quality", workOrderId: "work", processName: "质检", sequence: 2, assignedRole: "worker", status: "待开始", planQty: 10, completedQty: 0 }
    ],
    reports: [],
    exceptions: [],
    attachments: [],
    auditLogs: [],
    settings: {},
    drawings: [
      { id: "drawing-image", orderId: "order", workOrderId: "work", url: "/uploads/drawings/image.png", name: "long-image-name.png", fileType: "png", previewUrl: "", previewError: "" },
      { id: "drawing-cad", orderId: "order", workOrderId: "work", url: "/uploads/drawings/part.dwg", name: "long-cad-name.dwg", fileType: "dwg", previewUrl: "/uploads/previews/part.svg", previewError: "" }
    ]
  }), "utf8");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/my-tasks`, { headers: { "x-user-id": "worker" } });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("test server did not start");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], { cwd: tempRoot, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  await waitForServer();

  const response = await fetch(`http://127.0.0.1:${port}/api/my-tasks`, { headers: { "x-user-id": "worker" } });
  const data = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(data.tasks.length, 2);
  data.tasks.forEach((task) => {
    assert.deepStrictEqual(task.workOrder.drawings.map((item) => item.id), ["drawing-image", "drawing-cad"]);
    assert.strictEqual(task.workOrder.drawings[1].previewUrl, "/uploads/previews/part.svg");
  });

  const boardJs = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.js"), "utf8");
  const boardWxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "board", "board.wxml"), "utf8");
  const taskJs = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.js"), "utf8");
  const drawingsJs = fs.readFileSync(path.join(root, "miniprogram", "pages", "drawings", "drawings.js"), "utf8");
  const taskWxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.wxml"), "utf8");
  const taskStyle = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.wxss"), "utf8");
  const previewJs = fs.readFileSync(path.join(root, "miniprogram", "pages", "file-preview", "file-preview.js"), "utf8");
  const previewWxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "file-preview", "file-preview.wxml"), "utf8");

  assert.ok(!boardWxml.includes("drawing-actions"), "生产看板卡片不能显示图纸预览/下载操作区");
  assert.ok(!boardJs.includes("confirmDownload"), "生产看板不能保留下载确认逻辑");
  assert.ok(taskJs.includes("previewDrawing"), "我的任务需要支持图纸预览");
  assert.ok(drawingsJs.includes("/api/drawings/preview"), "附件清单 CAD 图纸需要支持按需生成预览");
  assert.ok(taskWxml.includes("drawing-preview-icon"), "任务卡右上角需要显示预览小图标");
  assert.ok(taskWxml.includes("bindtap=\"previewDrawing\""), "预览小图标必须绑定预览动作");
  assert.ok(!taskWxml.includes("downloadDrawing") && !taskWxml.includes("confirmDownload"), "我的任务本次只增加预览入口，不增加下载入口");
  assert.ok(taskStyle.includes("min-width: 0"), "预览图标必须清除按钮默认最小宽度");
  assert.ok(taskStyle.includes("flex: 0 0 36rpx"), "预览图标必须保持原来的固定小方块");
  assert.ok(taskStyle.includes("border-radius: 8rpx"), "预览图标应保持原来的方形圆角");

  assert.ok(drawingsJs.includes("downloadUrl="), "preview page navigation must include original download url");
  assert.ok(drawingsJs.includes("fileType="), "preview page navigation must include file type");
  assert.ok(drawingsJs.includes("wx.previewImage"), "image drawings must use native preview");
  assert.ok(previewWxml.includes("preview-image"), "preview page must render images without native image preview");
  assert.ok(previewWxml.includes("binderror=\"onPreviewError\""), "preview page must show a visible error instead of a blank page");
  assert.ok(previewJs.includes("onPreviewError"), "preview page must record preview load failures");
  assert.ok(previewWxml.includes("bindtap=\"confirmDownload\""), "preview page must render a download button");
  assert.ok(previewJs.includes("downloadUrl"), "preview page must store the original download url");
  assert.ok(previewJs.includes("wx.showModal"), "preview download must ask for confirmation");
  assert.ok(previewJs.includes("wx.downloadFile"), "preview download must download the original file");
  assert.ok(previewJs.includes("wx.saveFile"), "preview download must save the file");

  console.log("mobile-task-drawings: ok");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => child?.kill());
