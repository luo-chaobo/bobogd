const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApplication } = require("../src/server");

function inquiryPayload() {
  return {
    drawingMode: "none",
    contactName: "王先生",
    phone: "13812345678",
    region: "宁波北仑",
    quantity: 2,
    expectedDate: "2026-10-01",
    description: "制作设备防护罩",
    material: "304不锈钢",
    dimensions: "800×500×300 mm",
    attachments: []
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

function cookieValue(setCookie, name) {
  return setCookie.split(/,\s*(?=[A-Za-z0-9_]+=)/).find((part) => part.startsWith(`${name}=`))?.split(";")[0] || "";
}

async function login(baseUrl, userId, name, superAdminUserIds = []) {
  const started = await request(`${baseUrl}/api/admin/auth/wecom/start`);
  assert.equal(started.response.status, 302);
  const authorizationUrl = new URL(started.response.headers.get("location"));
  const state = authorizationUrl.searchParams.get("state");
  const stateCookie = cookieValue(started.response.headers.get("set-cookie"), "wljixie_admin_oauth");
  const callback = await request(`${baseUrl}/api/admin/auth/wecom/callback?code=${encodeURIComponent(userId)}&state=${encodeURIComponent(state)}`, {
    headers: { cookie: stateCookie }
  });
  assert.equal(callback.response.status, 302);
  const sessionCookie = cookieValue(callback.response.headers.get("set-cookie"), "wljixie_admin_session");
  const session = await request(`${baseUrl}/api/admin/auth/session`, { headers: { cookie: sessionCookie } });
  assert.equal(session.response.status, 200);
  assert.equal(session.body.user.name, name);
  assert.equal(session.body.user.role, superAdminUserIds.includes(userId) ? "super_admin" : "customer_service");
  return { cookie: sessionCookie, csrfToken: session.body.csrfToken };
}

async function withApp(run, users, superAdminUserIds = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-admin-auth-"));
  const app = createApplication({
    dbPath: path.join(directory, "test.sqlite"),
    uploadDir: path.join(directory, "uploads"),
    wecomCorpId: "corp-1",
    wecomAgentId: "1000002",
    wecomRedirectUri: "https://test.wljixie.com/api/admin/auth/wecom/callback",
    adminSessionSecret: "test-session-secret-with-at-least-32-bytes",
    superAdminUserIds,
    exchangeWecomCode: async (code) => {
      const user = users[code];
      if (!user) throw Object.assign(new Error("成员不在应用可见范围"), { status: 403 });
      return user;
    }
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await run(baseUrl, app);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("refuses to start WeCom login without a session secret", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-admin-secret-"));
  const app = createApplication({ dbPath: path.join(directory, "test.sqlite"), uploadDir: path.join(directory, "uploads"), wecomCorpId: "corp-1", wecomAgentId: "1000002", exchangeWecomCode: async () => ({ userId: "one", name: "一" }) });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await request(`http://127.0.0.1:${app.server.address().port}/api/admin/auth/wecom/start`);
    assert.equal(result.response.status, 501);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("creates a server session from a one-time WeCom callback and logs out", async () => {
  await withApp(async (baseUrl) => {
    const started = await request(`${baseUrl}/api/admin/auth/wecom/start`);
    const location = new URL(started.response.headers.get("location"));
    assert.equal(location.hostname, "open.work.weixin.qq.com");
    assert.equal(location.searchParams.get("appid"), "corp-1");
    assert.equal(location.searchParams.get("agentid"), "1000002");
    const state = location.searchParams.get("state");
    const oauthCookie = cookieValue(started.response.headers.get("set-cookie"), "wljixie_admin_oauth");

    const callback = await request(`${baseUrl}/api/admin/auth/wecom/callback?code=service-1&state=${state}`, { headers: { cookie: oauthCookie } });
    assert.equal(callback.response.status, 302);
    assert.equal(callback.response.headers.get("location"), "/admin.html");
    assert.equal(callback.response.headers.get("cache-control"), "no-store");
    const sessionCookie = cookieValue(callback.response.headers.get("set-cookie"), "wljixie_admin_session");
    assert.match(callback.response.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(callback.response.headers.get("set-cookie"), /Secure/i);
    assert.match(callback.response.headers.get("set-cookie"), /SameSite=Lax/i);

    const replay = await request(`${baseUrl}/api/admin/auth/wecom/callback?code=service-1&state=${state}`, { headers: { cookie: oauthCookie } });
    assert.equal(replay.response.status, 401);

    const session = await request(`${baseUrl}/api/admin/auth/session`, { headers: { cookie: sessionCookie } });
    assert.equal(session.body.user.role, "customer_service");
    assert.ok(session.body.csrfToken);
    const secondTab = await request(`${baseUrl}/api/admin/auth/session`, { headers: { cookie: sessionCookie } });
    assert.equal(secondTab.body.csrfToken, session.body.csrfToken);

    const logout = await request(`${baseUrl}/api/admin/auth/logout`, {
      method: "POST",
      headers: { cookie: sessionCookie, "x-csrf-token": session.body.csrfToken, origin: baseUrl }
    });
    assert.equal(logout.response.status, 204);
    assert.equal((await request(`${baseUrl}/api/admin/auth/session`, { headers: { cookie: sessionCookie } })).response.status, 401);
  }, { "service-1": { userId: "service-1", name: "客服甲" } });
});

test("uses the authenticated identity and blocks customer service from payment side effects", async () => {
  const users = {
    "service-1": { userId: "service-1", name: "客服甲" },
    "boss-1": { userId: "boss-1", name: "罗朝波" }
  };
  await withApp(async (baseUrl, app) => {
    const created = await request(`${baseUrl}/api/inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inquiryPayload())
    });
    const service = await login(baseUrl, "service-1", "客服甲", ["boss-1"]);
    const serviceHeaders = { cookie: service.cookie, "x-csrf-token": service.csrfToken, origin: baseUrl, "content-type": "application/json" };
    const claim = await request(`${baseUrl}/api/admin/inquiries/${created.body.id}/claim`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ operator: "伪造管理员" }) });
    assert.equal(claim.response.status, 200);
    assert.equal(claim.body.claimedBy, "客服甲");
    assert.equal((await request(`${baseUrl}/api/admin/inquiries/${created.body.id}/quotes`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ amount: 2800, validUntil: "2026-10-01", confirmed: true }) })).response.status, 201);

    const forbidden = await request(`${baseUrl}/api/admin/inquiries/${created.body.id}/payment-confirmation`, { method: "POST", headers: serviceHeaders, body: "{}" });
    assert.equal(forbidden.response.status, 403);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 0);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM bobo_sync_jobs").get().count, 0);

    const boss = await login(baseUrl, "boss-1", "罗朝波", ["boss-1"]);
    const paid = await request(`${baseUrl}/api/admin/inquiries/${created.body.id}/payment-confirmation`, {
      method: "POST",
      headers: { cookie: boss.cookie, "x-csrf-token": boss.csrfToken, origin: baseUrl, "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(paid.response.status, 201);
    assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM bobo_sync_jobs").get().count, 1);
    assert.equal(paid.body.boboSyncStatus, "pending");
    assert.equal(paid.body.boboAutoSubmitted, true);
    const audit = app.database.prepare("SELECT operator, actor_user_id, actor_role FROM audit_logs WHERE action = 'confirm_payment'").get();
    assert.equal(audit.operator, "罗朝波");
    assert.equal(audit.actor_user_id, "boss-1");
    assert.equal(audit.actor_role, "super_admin");

    const bossHeaders = { cookie: boss.cookie, "x-csrf-token": boss.csrfToken, origin: baseUrl, "content-type": "application/json" };
    const forbiddenConfirmation = await request(`${baseUrl}/api/admin/orders/${paid.body.id}/bobo-confirm`, { method: "POST", headers: serviceHeaders, body: "{}" });
    assert.equal(forbiddenConfirmation.response.status, 403);

    const confirmed = await request(`${baseUrl}/api/admin/orders/${paid.body.id}/bobo-confirm`, { method: "POST", headers: bossHeaders, body: "{}" });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.status, "pending");
    assert.equal(app.database.prepare("SELECT status FROM bobo_sync_jobs WHERE order_id = ?").get(paid.body.id).status, "pending");
    assert.equal(app.database.prepare("SELECT actor_user_id, actor_role FROM audit_logs WHERE action = 'auto_submit_bobo_sync'").get().actor_user_id, "boss-1");

    const repeatedConfirmation = await request(`${baseUrl}/api/admin/orders/${paid.body.id}/bobo-confirm`, { method: "POST", headers: bossHeaders, body: "{}" });
    assert.equal(repeatedConfirmation.response.status, 200);
    assert.equal(repeatedConfirmation.body.status, "pending");

    const missingReason = await request(`${baseUrl}/api/admin/orders/${paid.body.id}/events`, { method: "POST", headers: bossHeaders, body: JSON.stringify({ status: "production", title: "人工更新" }) });
    assert.equal(missingReason.response.status, 422);
    const overridden = await request(`${baseUrl}/api/admin/orders/${paid.body.id}/events`, { method: "POST", headers: bossHeaders, body: JSON.stringify({ status: "production", title: "人工更新", reason: "波波回传暂时中断" }) });
    assert.equal(overridden.response.status, 201);
    assert.match(app.database.prepare("SELECT detail FROM audit_logs WHERE action = 'manual_progress_override'").get().detail, /波波回传暂时中断/);
  }, users, ["boss-1"]);
});

test("requires CSRF for session writes and a reason for super-admin progress override", async () => {
  await withApp(async (baseUrl) => {
    const boss = await login(baseUrl, "boss-1", "郑金波", ["boss-1"]);
    const missingCsrf = await request(`${baseUrl}/api/admin/notification-jobs/1/retry`, { method: "POST", headers: { cookie: boss.cookie, origin: baseUrl }, body: "{}" });
    assert.equal(missingCsrf.response.status, 403);
  }, { "boss-1": { userId: "boss-1", name: "郑金波" } }, ["boss-1"]);
});
