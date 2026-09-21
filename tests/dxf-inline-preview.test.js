const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bobogd-dxf-preview-"));
let port;
let child;

const sampleDxf = `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
100
21
0
0
CIRCLE
10
50
20
50
40
20
0
ENDSEC
0
EOF
`;

const distantEntityDxf = `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
100
21
0
0
LINE
10
0
20
50
11
100
21
50
0
LINE
10
10000
20
10000
11
10020
21
10000
0
ENDSEC
0
EOF
`;

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function run() {
  assert.ok(
    serverSource.indexOf("dxfToSvg(fs.readFileSync(sourcePath") < serverSource.indexOf("for (const command of cadPreviewCommands"),
    "DXF 应优先使用内置预览，失败后才尝试外部命令"
  );
  seedDatabase();
  port = await getFreePort();
  child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), CAD_PREVIEW_COMMAND: "missing-cad-command" },
    stdio: "ignore"
  });
  await waitForServer();

  const uploaded = await request("/api/drawings/upload", {
    filename: "sample.dxf",
    dataUrl: `data:application/dxf;base64,${Buffer.from(sampleDxf).toString("base64")}`,
  });
  assert.strictEqual(uploaded.status, 200);
  assert.strictEqual(uploaded.data.fileType, "dxf");
  assert.ok(uploaded.data.previewUrl.endsWith(".svg"));
  assert.strictEqual(uploaded.data.previewError, "");

  const previewPath = path.join(tempRoot, "public", uploaded.data.previewUrl);
  const previewSvg = fs.readFileSync(previewPath, "utf8");
  assert.ok(previewSvg.includes("<line"));
  assert.ok(previewSvg.includes("<circle"));

  const distant = await request("/api/drawings/upload", {
    filename: "distant.dxf",
    dataUrl: `data:application/dxf;base64,${Buffer.from(distantEntityDxf).toString("base64")}`,
  });
  assert.strictEqual(distant.status, 200);
  const distantSvg = fs.readFileSync(path.join(tempRoot, "public", distant.data.previewUrl), "utf8");
  const viewBox = distantSvg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  assert.ok(viewBox[2] < 1000, "DXF 预览应忽略离主体很远的孤立实体，避免主体被缩成小点");
  console.log("dxf-inline-preview: ok");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => child?.kill());
