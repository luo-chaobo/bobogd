const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for server");
}

test("direct node startup loads integration settings from config.local.json", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bobo-persistent-config-"));
  const port = await freePort();
  let child;

  try {
    fs.mkdirSync(path.join(directory, "lib"), { recursive: true });
    fs.mkdirSync(path.join(directory, "public"), { recursive: true });
    fs.copyFileSync(path.join(root, "server.js"), path.join(directory, "server.js"));
    fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(directory, "lib", "weapp-image.js"));
    fs.copyFileSync(path.join(root, "lib", "order-financials.js"), path.join(directory, "lib", "order-financials.js"));
    fs.writeFileSync(path.join(directory, "public", "index.html"), "test");
    fs.writeFileSync(path.join(directory, "config.local.json"), JSON.stringify({
      serverEnvironment: {
        PORT: String(port),
        BOBO_INTEGRATION_SECRET: "persistent-secret",
        FUTURE_WEBHOOK_URL: "https://example.invalid/webhook"
      }
    }));
    const environment = { ...process.env, DB_DRIVER: "json" };
    delete environment.PORT;
    delete environment.BOBO_INTEGRATION_SECRET;
    delete environment.FUTURE_WEBHOOK_URL;
    child = spawn(process.execPath, ["server.js"], { cwd: directory, env: environment, stdio: "ignore" });

    const response = await waitForServer(`http://127.0.0.1:${port}/api/external/health`);
    assert.deepEqual(await response.json(), {
      enabled: true,
      service: "external-work-orders",
      processMode: "single-process"
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
