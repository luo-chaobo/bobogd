const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-cad-preview-"));
const port = 31993;
let child;

function seedDatabase() {
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "lib"), { recursive: true });
  fs.copyFileSync(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(tempRoot, "lib", "weapp-image.js"));
  fs.writeFileSync(path.join(tempRoot, "public", "index.html"), "test", "utf8");
  fs.writeFileSync(path.join(tempRoot, "data", "db.json"), JSON.stringify({
    users: [{ id: "manager", name: "主管", phone: "1", role: "manager", password: "1", active: true }],
    processes: [], customers: [], orders: [], workOrders: [], routes: [], reports: [], exceptions: [],
    attachments: [], drawings: [], auditLogs: [], settings: {}
  }), "utf8");
}

async function request(url, body) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-user-id": "manager" },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { headers: { "x-user-id": "manager" } })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function run() {
  seedDatabase();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), CAD_PREVIEW_COMMAND: "missing-dwg2svg-command" },
    stdio: "ignore"
  });
  await waitForServer();
  const uploaded = await request("/api/drawings/upload", {
    filename: "sample.dwg",
    dataUrl: "data:application/acad;base64,RFdH",
  });
  assert.strictEqual(uploaded.status, 200);
  assert.strictEqual(uploaded.data.fileType, "dwg");
  assert.strictEqual(uploaded.data.previewUrl, "");
  assert.strictEqual(uploaded.data.previewError, "CAD 预览生成失败");
  assert.ok(uploaded.data.url.includes("/uploads/drawings/"));

  const preview = await request("/api/drawings/preview", { drawingId: uploaded.data.id });
  assert.strictEqual(preview.status, 200);
  assert.strictEqual(preview.data.previewUrl, "");
  assert.strictEqual(preview.data.previewError, "CAD 预览生成失败");
  console.log("cad-preview-fallback: ok");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => child?.kill());
