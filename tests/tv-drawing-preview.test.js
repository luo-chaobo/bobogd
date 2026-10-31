const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-tv-drawing-"));
const port = 32318;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public", "uploads", "drawings"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "lib", "order-financials.js"), path.join(tempRoot, "lib", "order-financials.js"));
  fs.mkdirSync(path.join(tempRoot, "public", "vendor", "pdfjs"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.copyFileSync(path.join(root, "public", "vendor", "pdfjs", "pdf.min.js"), path.join(tempRoot, "public", "vendor", "pdfjs", "pdf.min.js"));
  fs.copyFileSync(path.join(root, "public", "vendor", "pdfjs", "pdf.worker.min.js"), path.join(tempRoot, "public", "vendor", "pdfjs", "pdf.worker.min.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "public", "uploads", "drawings", "part.png"), "drawing-content", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "worker", name: "工人", phone: "1", role: "weld_worker", roles: ["weld_worker"], password: "1", active: true }],
    deletedUsers: [],
    processes: [{ id: "process", name: "焊接", sort: 1, active: true }],
    customers: [{ id: "customer", name: "客户" }],
    orders: [{ id: "order", orderNo: "O-1", customerId: "customer", productName: "产品", quantity: 10, quantityUnit: "件", dueDate: "2099-01-01", status: "生产中" }],
    workOrders: [{ id: "work", workNo: "W-1", orderId: "order", productName: "产品", planQty: 10, status: "生产中", currentProcess: "焊接" }],
    routes: [{ id: "route", workOrderId: "work", processId: "process", processName: "焊接", sequence: 1, status: "进行中", planQty: 10, completedQty: 0 }],
    reports: [], exceptions: [], attachments: [], auditLogs: [], settings: {}, customerFeedbacks: [],
    drawings: [{ id: "drawing", orderId: "order", workOrderId: "work", url: "/uploads/drawings/part.png", name: "part.png", originalName: "part.png", fileType: "png", contentType: "image/png", previewUrl: "", previewError: "" }]
  }), "utf8");
}

async function request(urlPath, options = {}) {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, options);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await request("/api/tv-dashboard");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("test server startup timeout");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), DB_DRIVER: "json", TV_VIEW_TOKEN_SECRET: "drawing-test-secret", WX_APP_SECRET: "" },
    stdio: "ignore"
  });
  await waitForServer();

  const pdfJs = await request("/vendor/pdfjs/pdf.min.js");
  assert.strictEqual(pdfJs.status, 200);
  assert.match(pdfJs.headers.get("content-type") || "", /application\/javascript/);
  assert.ok((await pdfJs.text()).includes("pdfjsLib"), "服务端必须返回真实PDF.js浏览器脚本");
  const pdfWorker = await request("/vendor/pdfjs/pdf.worker.min.js");
  assert.strictEqual(pdfWorker.status, 200);

  const anonymous = await (await request("/api/tv-dashboard")).json();
  assert.strictEqual(anonymous.activeOrders[0].drawings, undefined, "普通电视接口不能返回图纸元数据");
  assert.strictEqual(anonymous.activeOrders[0].drawingCount, 1);

  const tokenResponse = await request("/api/tv-viewer-token", { headers: { "x-user-id": "worker" } });
  assert.strictEqual(tokenResponse.status, 200);
  const { token } = await tokenResponse.json();
  const interactive = await (await request(`/api/tv-dashboard?viewerToken=${encodeURIComponent(token)}`)).json();
  assert.strictEqual(interactive.activeOrders[0].drawings, undefined, "首屏不能返回图纸元数据");
  const drawingList = await (await request(`/api/tv-orders/work/drawings?viewerToken=${encodeURIComponent(token)}`)).json();
  assert.deepStrictEqual(drawingList.items.map((item) => item.id), ["drawing"]);
  assert.ok(!drawingList.items[0].url, "看板接口不能暴露公开原文件地址");

  const validFile = await request(`/api/tv-drawings/drawing/file?viewerToken=${encodeURIComponent(token)}`);
  assert.strictEqual(validFile.status, 200);
  assert.strictEqual(await validFile.text(), "drawing-content");
  const forgedFile = await request(`/api/tv-drawings/drawing/file?viewerToken=${encodeURIComponent(`${token}x`)}`);
  assert.strictEqual(forgedFile.status, 401);

  const preview = await request("/api/tv-drawings/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ drawingId: "drawing" })
  });
  assert.strictEqual(preview.status, 200);
  const previewData = await preview.json();
  assert.ok(previewData.previewUrl.includes("/api/tv-drawings/drawing/file"));
  const rejectedPreview = await request("/api/tv-drawings/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer forged" },
    body: JSON.stringify({ drawingId: "drawing" })
  });
  assert.strictEqual(rejectedPreview.status, 401);

  const tvSource = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
  const tvStyle = fs.readFileSync(path.join(root, "public", "tv.css"), "utf8");
  const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(tvSource.includes("order-drawing-slot"), "产品第三行必须包含固定图纸占位");
  assert.ok(tvSource.includes("drawing-count"), "图纸图标必须显示附件数量角标");
  assert.ok(tvSource.includes("drawing-preview-modal"), "看板必须包含深色图纸预览浮层");
  assert.ok(tvSource.includes("isMobileTv()"), "图纸入口必须限制在交互横屏模式");
  assert.ok(tvStyle.includes(".order-meta-row"), "数量与图纸入口必须使用同一水平布局");
  assert.ok(tvStyle.includes(".drawing-preview-dialog"), "预览窗口必须有独立看板风格");
  const mobileOrderListStyle = tvStyle.match(/body\.mobile-tv \.order-list\s*\{[^}]*\}/s)?.[0] || "";
  const mobileOrderRowStyle = tvStyle.match(/body\.mobile-tv \.order-row\s*\{[^}]*\}/s)?.[0] || "";
  assert.ok(!mobileOrderListStyle.includes("grid-auto-rows"), "手机横屏列表行高规则必须与线上一致");
  assert.ok(!mobileOrderListStyle.includes("align-content"), "手机横屏列表不能固定靠上排列");
  assert.ok(!/^\s*height:/m.test(mobileOrderRowStyle), "手机横屏工单不能设置固定高度");
  assert.match(mobileOrderRowStyle, /min-height:\s*64px/, "手机横屏工单需保留线上最小高度");
  assert.match(tvStyle, /\.order-drawing-button,\s*\.order-drawing-placeholder\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px/s, "图纸按钮需缩小并与客户、数量两行对齐");
  assert.match(tvStyle, /\.drawing-count\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px/s, "附件数量角标需使用紧凑尺寸");
  assert.ok(fs.statSync(path.join(root, "public", "vendor", "pdfjs", "pdf.min.js")).size > 100000, "PDF.js主脚本必须随项目静态部署");
  assert.ok(fs.statSync(path.join(root, "public", "vendor", "pdfjs", "pdf.worker.min.js")).size > 500000, "PDF.js Worker必须随项目静态部署");
  assert.ok(tvSource.includes("loadCompactPdfDocument"), "小程序紧凑模式必须使用PDF.js加载PDF");
  assert.ok(tvSource.includes("renderCompactPdfPage"), "小程序紧凑模式必须将PDF页面绘制到canvas");
  assert.ok(tvSource.includes("data-pdf-page"), "PDF预览必须提供单页翻页操作");
  assert.ok(tvSource.includes("compact-pdf-canvas"), "PDF预览必须包含canvas而不是空白iframe");
  assert.ok(tvSource.includes('return `<iframe class="drawing-preview-frame"'), "非小程序横屏模式必须保留原iframe预览逻辑");
  assert.ok(tvSource.includes("nativePdfPreviewUrl"), "非小程序PDF必须追加原生预览参数");
  assert.ok(tvSource.includes("pagemode=none") && tvSource.includes("navpanes=0"), "原生PDF预览应尽可能隐藏缩略图侧栏");
  assert.ok(tvSource.includes("zoom=page-fit") && tvSource.includes("view=Fit"), "非小程序PDF默认应使用适应页面视图");
  assert.ok(tvSource.includes("single-file"), "单张图纸必须隐藏系统文件列表");
  assert.ok(tvSource.includes("selectionId"), "附件切换必须忽略过期的异步预览结果");
  assert.ok(!serverSource.includes("PDFJS_BUILD_DIR"), "PDF.js不能依赖宝塔node_modules运行时目录");
  assert.ok(tvSource.includes("compactPdfReady"), "PDF加载失败时不能显示未初始化页码控件");
  console.log("tv-drawing-preview: ok");
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
