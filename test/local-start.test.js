const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("the local launcher starts the website on port 8089", async () => {
  const projectDir = path.resolve(__dirname, "..");
  const processHandle = spawn("cmd.exe", ["/d", "/c", "启动本地服务-8089.bat"], {
    cwd: projectDir,
    env: process.env,
    stdio: "ignore",
    windowsHide: true
  });

  try {
    let response;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        response = await fetch("http://127.0.0.1:8089/api/health");
        break;
      } catch {}
    }

    assert.equal(response?.status, 200);
  } finally {
    if (processHandle.pid) {
      spawnSync("taskkill.exe", ["/pid", String(processHandle.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    }
  }
});
