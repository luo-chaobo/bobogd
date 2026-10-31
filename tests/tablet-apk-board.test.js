const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const tablet = path.join(root, "tv-apk", "tablet");
const activity = fs.readFileSync(path.join(tablet, "src", "main", "java", "com", "bobogd", "tablet", "MainActivity.java"), "utf8");
const manifest = fs.readFileSync(path.join(tablet, "src", "main", "AndroidManifest.xml"), "utf8");
const gradle = fs.readFileSync(path.join(tablet, "build.gradle"), "utf8");
const extensionManifestPath = path.join(tablet, "src", "main", "assets", "board-redirect", "manifest.json");
const contentScriptPath = path.join(tablet, "src", "main", "assets", "board-redirect", "content.js");

assert.ok(fs.existsSync(extensionManifestPath), "APK必须内置看板自动跳转扩展");
assert.ok(fs.existsSync(contentScriptPath), "APK必须内置登录状态检测脚本");
assert.match(gradle, /versionCode\s+5/, "APK版本号必须升级为5");
assert.match(gradle, /versionName\s+"1\.0\.4"/, "APK版本名必须升级为1.0.4");
assert.match(manifest, /WRITE_EXTERNAL_STORAGE[^>]*maxSdkVersion="28"/, "Android 8/9下载必须声明兼容存储权限");
assert.ok(activity.includes("ensureBuiltIn"), "GeckoRuntime必须安装内置扩展");
assert.ok(activity.includes("onExternalResponse"), "APP必须接管GeckoView外部下载响应");
assert.ok(activity.includes("DownloadManager.Request"), "附件必须交给Android下载管理器");
assert.ok(activity.includes("isAllowedDownloadUri"), "下载前必须校验域名、HTTPS和viewerToken");
assert.ok(activity.includes('"/tv.html".equals'), "看板首页返回键必须将APP切到后台");

const source = fs.readFileSync(contentScriptPath, "utf8");

async function runScript({ pathname = "/", user = null, response = null }) {
  const values = new Map();
  if (user) values.set("work_user", JSON.stringify(user));
  const replacements = [];
  const requests = [];
  const timers = [];
  const context = {
    URLSearchParams,
    location: {
      pathname,
      search: "",
      replace(url) { replacements.push(url); },
    },
    localStorage: {
      getItem(key) { return values.get(key) || null; },
      removeItem(key) { values.delete(key); },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return response;
    },
    setInterval(callback) { timers.push(callback); return 1; },
    clearInterval() {},
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { values, replacements, requests, timers };
}

(async () => {
  const loggedOut = await runScript({});
  assert.strictEqual(loggedOut.requests.length, 0, "未登录时必须停留登录页");

  const loggedIn = await runScript({
    user: { id: "worker-1", name: "工人" },
    response: { ok: true, status: 200, json: async () => ({ token: "token value" }) },
  });
  assert.strictEqual(loggedIn.requests[0].url, "/api/tv-viewer-token");
  assert.strictEqual(loggedIn.requests[0].options.headers["x-user-id"], "worker-1");
  assert.deepStrictEqual(loggedIn.replacements, ["/tv.html?mobile=1&viewerToken=token+value"]);

  const expired = await runScript({
    user: { id: "expired" },
    response: { ok: false, status: 401, json: async () => ({}) },
  });
  assert.strictEqual(expired.values.has("work_user"), false, "登录失效后必须清除本地状态");
  assert.deepStrictEqual(expired.replacements, ["/?tabletApp=1&loginExpired=1"]);

  const board = await runScript({ pathname: "/tv.html", user: { id: "worker-1" } });
  assert.strictEqual(board.requests.length, 0, "看板页不能重复申请令牌或循环跳转");

  console.log("tablet-apk-board: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
