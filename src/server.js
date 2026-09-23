const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { nextNumber, openDatabase } = require("./database");
const { ALLOWED_EXTENSIONS, MAX_ATTACHMENT_SIZE, ORDER_STATUS_TEXT, actualAttachmentSize, canConfirmPayment, canEnterProduction, canShip, normalizePhone, publicOrder, PUBLIC_STATUS_DICTIONARY, validateInquiry, validatePublicEventTitle } = require("./domain");
const { createWechatSubscriptionSender } = require("./wechat-subscription");
const { version: applicationVersion } = require("../package.json");

const MAX_BODY_SIZE = 60 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("请求格式错误"), { status: 400 });
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readSingleFileUpload(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw Object.assign(new Error("上传格式错误"), { status: 400 });
  const body = await readBody(request);
  const boundaryText = boundaryMatch[1].replaceAll('"', "");
  const delimiter = Buffer.from(`--${boundaryText}`);
  const nextDelimiter = Buffer.from(`\r\n--${boundaryText}`);
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(delimiter, cursor);
    if (start < 0) break;
    let headerStart = start + delimiter.length;
    if (body.subarray(headerStart, headerStart + 2).toString() === "--") break;
    if (body.subarray(headerStart, headerStart + 2).toString() === "\r\n") headerStart += 2;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd < 0) break;
    const contentStart = headerEnd + 4;
    const contentEnd = body.indexOf(nextDelimiter, contentStart);
    if (contentEnd < 0) break;
    const header = body.subarray(headerStart, headerEnd).toString("utf8");
    const filename = header.match(/filename="([^"]+)"/i)?.[1];
    if (filename) return { name: filename.replace(/[\\/]/g, "_"), content: body.subarray(contentStart, contentEnd) };
    cursor = contentEnd + 2;
  }
  throw Object.assign(new Error("请选择附件"), { status: 422 });
}

function isLegacyAdmin(request, token) {
  return token && request.headers.authorization === `Bearer ${token}`;
}

function hashToken(value, secret) {
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

function csrfTokenForSession(sessionToken, secret) {
  return crypto.createHmac("sha256", secret).update(`csrf:${sessionToken}`).digest("base64url");
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function setCookie(response, name, value, maxAge) {
  response.setHeader("set-cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validIntegrationRequest(request, rawBody, secret, now) {
  if (!secret) return false;
  const timestamp = String(request.headers["x-integration-timestamp"] || "");
  const nonce = String(request.headers["x-integration-nonce"] || "");
  const signature = String(request.headers["x-integration-signature"] || "");
  if (!/^\d{13}$/.test(timestamp) || !nonce || Math.abs(now().getTime() - Number(timestamp)) > 300000) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");
  return safeEqual(signature, expected);
}

function currentProcessLabel(order, processes) {
  if (!processes.length) return "尚无工序回传";
  const completed = Boolean(order.bobo_all_processes_completed) || ["ready", "shipped", "completed"].includes(order.status);
  if (completed) return "工序已全部完成";
  const active = processes.find((item) => item.status !== "已完成");
  if (active) return `${active.name} · ${active.status}`;
  return `${processes.at(-1).name}已完成，等待下一工序`;
}

function boboAuditDetail(event) {
  const detail = { kind: "bobo_webhook", eventType: String(event.type || ""), eventId: String(event.eventId || "") };
  if (event.type === "process.updated") detail.process = { name: String(event.process?.name || ""), status: String(event.process?.status || "") };
  if (event.type === "delivery.completed") detail.deliveredAt = String(event.delivery?.deliveredAt || event.occurredAt || "");
  return JSON.stringify(detail);
}

function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const isImage = /^assets\/images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(requested)
    || requested === "assets/images/factory-location-map.svg";
  const isBrandAsset = /^assets\/brand\/[a-z0-9-]+\.(svg|png)$/.test(requested);
  const isVideo = /^assets\/video\/[a-z0-9-]+\.mp4$/.test(requested);
  const isPage = /^(?:[a-z0-9-]+|news\/[a-z0-9-]+)\.html$/.test(requested);
  const isAsset = new Set(["styles.css", "app.js", "admin.js", "admin-tools.js", "robots.txt", "sitemap.xml", "feKCc7G0cA.txt"]).has(requested);
  if (!isImage && !isBrandAsset && !isVideo && !isPage && !isAsset) return false;
  const file = path.join(PUBLIC_DIR, requested);
  if (!fs.existsSync(file)) return false;
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4" };
  if (isVideo && request.headers.range) {
    const match = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2])) {
      const size = fs.statSync(file).size;
      let start;
      let end;
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
      } else if (match[2]) {
        const suffixLength = Number(match[2]);
        start = Math.max(size - suffixLength, 0);
        end = size - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
        response.writeHead(416, { "content-range": `bytes */${size}`, "accept-ranges": "bytes", "content-length": "0" });
        response.end();
        return true;
      }
      end = Math.min(end, size - 1);
      response.writeHead(206, {
        "content-type": types[path.extname(file)],
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=604800",
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1)
      });
      fs.createReadStream(file, { start, end }).pipe(response);
      return true;
    }
  }
  response.writeHead(200, { "content-type": types[path.extname(file)], "x-content-type-options": "nosniff", "cache-control": isImage || isVideo ? "public, max-age=604800" : "no-cache" });
  fs.createReadStream(file).pipe(response);
  return true;
}

function createApplication(options = {}) {
  const dbPath = options.dbPath || process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "website.sqlite");
  const uploadDir = options.uploadDir || process.env.UPLOAD_DIR || path.join(__dirname, "..", "private", "uploads");
  const adminToken = options.adminToken || process.env.ADMIN_TOKEN || "";
  const legacyAdminEnabled = options.adminToken !== undefined || process.env.ENABLE_LEGACY_ADMIN_TOKEN === "1";
  const adminSessionSecret = String(options.adminSessionSecret || process.env.ADMIN_SESSION_SECRET || "");
  const wecomCorpId = String(options.wecomCorpId || process.env.WECOM_CORP_ID || "");
  const wecomAgentId = String(options.wecomAgentId || process.env.WECOM_AGENT_ID || "1000002");
  const wecomAppSecret = String(options.wecomAppSecret || process.env.WECOM_APP_SECRET || "");
  const wecomRedirectUri = String(options.wecomRedirectUri || process.env.WECOM_REDIRECT_URI || "https://test.wljixie.com/api/admin/auth/wecom/callback");
  const superAdminUserIds = new Set(options.superAdminUserIds || String(process.env.WECOM_SUPER_ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
  const now = options.now || (() => new Date());
  const fetchImpl = options.fetch || fetch;
  const enableWechatMock = options.enableWechatMock === true || process.env.ENABLE_WECHAT_MOCK === "1";
  const enablePhoneMock = options.enablePhoneMock === true || process.env.ENABLE_PHONE_MOCK === "1";
  const wechatAppId = String(options.wechatAppId || process.env.WECHAT_APP_ID || "");
  const wechatAppSecret = String(options.wechatAppSecret || process.env.WECHAT_APP_SECRET || "");
  const wechatSubscriptionTemplateId = String(options.wechatSubscriptionTemplateId || process.env.WECHAT_SUBSCRIPTION_TEMPLATE_ID || "");
  const wechatMiniprogramState = String(options.wechatMiniprogramState || process.env.WECHAT_MINIPROGRAM_STATE || "trial");
  let wechatAccessToken = { value: "", expiresAt: 0 };
  let wecomAccessToken = { value: "", expiresAt: 0 };
  async function getWecomAccessToken() {
    if (wecomAccessToken.value && wecomAccessToken.expiresAt > Date.now()) return wecomAccessToken.value;
    if (!wecomCorpId || !wecomAppSecret) throw Object.assign(new Error("企业微信登录尚未配置"), { status: 501 });
    const query = new URLSearchParams({ corpid: wecomCorpId, corpsecret: wecomAppSecret });
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${query}`);
    const result = await response.json();
    if (!response.ok || result.errcode || !result.access_token) throw Object.assign(new Error(result.errmsg || "企业微信访问令牌获取失败"), { status: 502 });
    wecomAccessToken = { value: result.access_token, expiresAt: Date.now() + Math.max(60, Number(result.expires_in || 7200) - 300) * 1000 };
    return wecomAccessToken.value;
  }
  const exchangeWecomCode = options.exchangeWecomCode || (async (code) => {
    const accessToken = await getWecomAccessToken();
    const identityResponse = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}`);
    const identity = await identityResponse.json();
    if (!identityResponse.ok || identity.errcode || !identity.UserId) throw Object.assign(new Error(identity.errmsg || "企业微信成员认证失败"), { status: identity.errcode === 60011 ? 403 : 502 });
    const userResponse = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(accessToken)}&userid=${encodeURIComponent(identity.UserId)}`);
    const user = await userResponse.json();
    if (!userResponse.ok || user.errcode || !user.name) throw Object.assign(new Error(user.errmsg || "成员不在应用可见范围"), { status: user.errcode === 60011 ? 403 : 502 });
    return { userId: identity.UserId, name: user.name };
  });
  const exchangeWechatCode = options.exchangeWechatCode || (async (code) => {
    if (!wechatAppId || !wechatAppSecret) throw Object.assign(new Error("未配置微信验证提供商"), { status: 501 });
    const query = new URLSearchParams({ appid: wechatAppId, secret: wechatAppSecret, js_code: code, grant_type: "authorization_code" });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
    const result = await response.json();
    if (!response.ok || !result.openid) throw Object.assign(new Error(result.errmsg || "微信登录失败"), { status: 502 });
    return result.openid;
  });
  async function getWechatAccessToken() {
    if (wechatAccessToken.value && wechatAccessToken.expiresAt > Date.now()) return wechatAccessToken.value;
    if (!wechatAppId || !wechatAppSecret) throw Object.assign(new Error("未配置微信小程序凭证"), { status: 501 });
    const query = new URLSearchParams({ grant_type: "client_credential", appid: wechatAppId, secret: wechatAppSecret });
    const response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
    const result = await response.json();
    if (!response.ok || result.errcode || !result.access_token) throw Object.assign(new Error(result.errmsg || "微信访问令牌获取失败"), { status: 502 });
    wechatAccessToken = { value: result.access_token, expiresAt: Date.now() + Math.max(60, Number(result.expires_in || 7200) - 300) * 1000 };
    return wechatAccessToken.value;
  }
  const exchangePhoneCode = options.exchangePhoneCode || (async (code) => {
    const accessToken = await getWechatAccessToken();
    const response = await fetchImpl(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const result = await response.json();
    const phone = result.phone_info?.purePhoneNumber;
    if (!response.ok || !phone) throw Object.assign(new Error(result.errmsg || "手机号授权失败"), { status: 502 });
    return phone;
  });
  const notify = options.notify || createWechatSubscriptionSender({
    fetch: fetchImpl,
    getAccessToken: getWechatAccessToken,
    now,
    state: wechatMiniprogramState,
    templateId: wechatSubscriptionTemplateId
  });
  const boboWebhookSecret = options.boboWebhookSecret || process.env.BOBO_INTEGRATION_SECRET || "";
  const boboBaseUrl = String(options.boboBaseUrl || process.env.BOBO_BASE_URL || "").replace(/\/$/, "");
  const wecomWebhookUrl = String(options.wecomWebhookUrl || process.env.WECOM_WEBHOOK_URL || "");
  const alert = options.alert || (async (content) => {
    if (!wecomWebhookUrl) return;
    const response = await fetch(wecomWebhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msgtype: "text", text: { content } }) });
    if (!response.ok) throw new Error(`企业微信告警返回 ${response.status}`);
  });
  const boboCreate = options.boboCreate || (async (payload) => {
    if (!boboBaseUrl || !boboWebhookSecret) throw new Error("波波工单集成未配置");
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const signature = crypto.createHmac("sha256", boboWebhookSecret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
    const response = await fetch(`${boboBaseUrl}/api/external/work-orders`, { method: "POST", headers: { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": nonce, "x-integration-signature": signature }, body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || result.message || `波波接口返回 ${response.status}`);
    return result;
  });
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(dbPath);

  function audit(actor, action, entityType, entityId, detail = "") {
    const identity = typeof actor === "string" ? { name: actor, userId: "", role: "" } : actor;
    db.prepare("INSERT INTO audit_logs (operator, action, entity_type, entity_id, detail, created_at, actor_user_id, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(identity.name, action, entityType, entityId, detail, now().toISOString(), identity.userId || "", identity.role || "");
  }

  function paymentSummary(orderId) {
    const order = db.prepare("SELECT total_amount FROM orders WHERE id = ?").get(orderId);
    const terms = db.prepare("SELECT * FROM payment_terms WHERE order_id = ?").get(orderId);
    if (!order) return null;
    const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS verified,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending
      FROM payments WHERE order_id = ?`).get(orderId);
    const totalAmount = Number(terms?.total_amount ?? order.total_amount);
    const startAmount = Number(terms?.start_amount ?? totalAmount);
    const verifiedAmount = Number(totals.verified);
    const pendingAmount = Number(totals.pending);
    const paymentStatus = verifiedAmount >= totalAmount ? "paid" : pendingAmount > 0 ? "pending_review" : verifiedAmount > 0 ? "partial_paid" : "unpaid";
    return {
      mode: terms?.payment_mode || "full",
      totalAmount,
      startAmount,
      verifiedAmount,
      pendingAmount,
      remainingAmount: Math.max(0, totalAmount - verifiedAmount),
      paymentStatus
    };
  }

  function refreshOrderPayment(orderId) {
    const order = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId);
    const summary = paymentSummary(orderId);
    if (!order || !summary) return summary;
    let status = order.status;
    if (summary.verifiedAmount >= summary.startAmount && status === "awaiting_payment") status = "awaiting_schedule";
    if (summary.verifiedAmount < summary.startAmount && status === "awaiting_schedule") status = "awaiting_payment";
    db.prepare("UPDATE orders SET payment_status = ?, status = ? WHERE id = ?").run(summary.paymentStatus, status, orderId);
    return { ...summary, orderStatus: status };
  }

  function normalizeQuoteSpecification(input, inquiry) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const text = (key, fallback = "", limit = 500) => String(source[key] ?? fallback).trim().slice(0, limit);
    return {
      requirement: text("requirement", inquiry.description),
      material: text("material", inquiry.material, 120),
      thickness: text("thickness", "", 80),
      dimensions: text("dimensions", inquiry.dimensions, 200),
      process: text("process", inquiry.process, 300),
      quantity: Math.max(1, Math.trunc(Number(source.quantity) || Number(inquiry.quantity) || 1)),
      expectedDate: text("expectedDate", inquiry.expected_date, 40),
      technicalRequirements: text("technicalRequirements", inquiry.technical_requirements),
      remark: text("remark", "")
    };
  }

  function quoteSpecification(row, inquiry) {
    try {
      const stored = JSON.parse(row.specification_snapshot || "{}");
      if (stored && Object.keys(stored).length) return normalizeQuoteSpecification(stored, inquiry);
    } catch {}
    return normalizeQuoteSpecification({}, inquiry);
  }

  function orderRequirementSnapshot(inquiry, quote, attachments) {
    const specification = quoteSpecification(quote, inquiry);
    return {
      description: specification.requirement,
      material: specification.material,
      thickness: specification.thickness,
      dimensions: specification.dimensions,
      process: specification.process,
      quantity: specification.quantity,
      expectedDate: specification.expectedDate,
      technicalRequirements: specification.technicalRequirements,
      remark: specification.remark,
      drawingMode: inquiry.drawing_mode,
      attachments: attachments.map((item) => ({ id: item.id, name: item.original_name, size: item.size, createdAt: item.created_at }))
    };
  }

  function frozenOrderAttachments(order) {
    let snapshot = {};
    try { snapshot = JSON.parse(order.requirement_snapshot || "{}"); } catch {}
    const ids = Array.isArray(snapshot.attachments)
      ? snapshot.attachments.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    if (!ids.length) return [];
    return db.prepare(`SELECT id, original_name, stored_name, size FROM attachments
      WHERE inquiry_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).all(order.inquiry_id, ...ids);
  }

  function autoQueueBoboSync(orderId, actor, paymentId = 0) {
    const summary = paymentSummary(orderId);
    const order = db.prepare("SELECT bobo_sync_status FROM orders WHERE id = ?").get(orderId);
    if (!summary || !order || !canEnterProduction({ verifiedAmount: summary.verifiedAmount, startAmount: summary.startAmount })) {
      return { status: order?.bobo_sync_status || "not_ready", submitted: false };
    }
    const timestamp = now().toISOString();
    const job = db.prepare("SELECT status FROM bobo_sync_jobs WHERE order_id = ?").get(orderId);
    if (job && job.status !== "awaiting_confirmation") return { status: job.status, submitted: false };
    if (job) db.prepare("UPDATE bobo_sync_jobs SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE order_id = ?").run(timestamp, timestamp, orderId);
    else db.prepare("INSERT INTO bobo_sync_jobs (order_id, status, next_attempt_at, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?)").run(orderId, timestamp, timestamp, timestamp);
    db.prepare("UPDATE orders SET bobo_sync_status = 'pending' WHERE id = ?").run(orderId);
    audit(actor, "auto_submit_bobo_sync", "order", orderId, `payment:${paymentId};amount:${summary.verifiedAmount}`);
    return { status: "pending", submitted: true };
  }

  function inTransaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function adminSession(request) {
    const rawToken = parseCookies(request).wljixie_admin_session;
    if (!rawToken) return null;
    const timestamp = now();
    const row = db.prepare(`SELECT admin_users.user_id, admin_users.name, admin_users.role, admin_sessions.csrf_hash, admin_sessions.absolute_expires_at
      FROM admin_sessions JOIN admin_users ON admin_users.user_id = admin_sessions.user_id
      WHERE admin_sessions.token_hash = ? AND admin_sessions.expires_at > ? AND admin_sessions.absolute_expires_at > ? AND admin_users.active = 1`)
      .get(hashToken(rawToken, adminSessionSecret), timestamp.toISOString(), timestamp.toISOString());
    if (!row) return null;
    const expiresAt = new Date(Math.min(timestamp.getTime() + 30 * 60 * 1000, new Date(row.absolute_expires_at).getTime())).toISOString();
    db.prepare("UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?").run(expiresAt, hashToken(rawToken, adminSessionSecret));
    return { userId: row.user_id, name: row.name, role: row.role, csrfHash: row.csrf_hash, rawToken };
  }

  function validSessionWrite(request, actor) {
    if (!actor.csrfHash) return true;
    const csrf = String(request.headers["x-csrf-token"] || "");
    const origin = String(request.headers.origin || "");
    if (!csrf || !safeEqual(hashToken(csrf, adminSessionSecret), actor.csrfHash)) return false;
    try { return new URL(origin).host === request.headers.host; } catch { return false; }
  }

  function recordChange(inquiryId, action, detail, operator) {
    db.prepare("INSERT INTO inquiry_change_records (inquiry_id, action, detail, operator, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(inquiryId, action, detail, operator, now().toISOString());
  }

  function sessionCustomer(request) {
    const authorization = request.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return null;
    return db.prepare(`SELECT customers.id, customers.contact_name, customers.phone
      FROM customer_sessions JOIN customers ON customers.id = customer_sessions.customer_id
      WHERE customer_sessions.token = ? AND customer_sessions.expires_at > ?`).get(token, now().toISOString());
  }

  function isBoundCustomer(customer) {
    return customer && /^1\d{10}$/.test(customer.phone || "");
  }

  async function deliverNotification(jobId) {
    const job = db.prepare("SELECT * FROM notification_jobs WHERE id = ?").get(jobId);
    if (!job || job.status === "sent") return job;
    const timestamp = now().toISOString();
    try {
      const identity = db.prepare("SELECT openid FROM wechat_identities WHERE customer_id = ? ORDER BY id DESC LIMIT 1").get(job.customer_id);
      await notify({ id: job.id, customerId: job.customer_id, openid: identity?.openid || "", eventType: job.event_type, entityType: job.entity_type, entityId: job.entity_id, payload: JSON.parse(job.payload) });
      db.prepare("UPDATE notification_jobs SET status = 'sent', attempts = attempts + 1, last_error = '', updated_at = ? WHERE id = ?").run(timestamp, job.id);
      db.prepare("INSERT INTO notification_logs (notification_job_id, status, detail, created_at) VALUES (?, 'sent', '', ?)").run(job.id, timestamp);
      db.prepare("UPDATE admin_todos SET status = 'resolved', resolved_at = ? WHERE entity_type = 'notification_job' AND entity_id = ? AND status = 'open'").run(timestamp, job.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "通知服务失败";
      db.prepare("UPDATE notification_jobs SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?").run(detail, timestamp, job.id);
      db.prepare("INSERT INTO notification_logs (notification_job_id, status, detail, created_at) VALUES (?, 'failed', ?, ?)").run(job.id, detail, timestamp);
      db.prepare("INSERT INTO admin_todos (type, entity_type, entity_id, detail, created_at) VALUES ('notification_failed', 'notification_job', ?, ?, ?)").run(job.id, detail, timestamp);
    }
    return db.prepare("SELECT * FROM notification_jobs WHERE id = ?").get(jobId);
  }

  async function queueNotification(customerId, eventType, entityType, entityId, payload = {}) {
    const grant = db.prepare("SELECT enabled, template_id, available_count FROM subscription_grants WHERE customer_id = ?").get(customerId);
    if (!grant || !grant.enabled) return null;
    const limited = Boolean(grant.template_id);
    if (limited && !["payment_confirmed", "order_status_changed"].includes(eventType)) return null;
    if (limited && grant.available_count < 1) return null;
    const timestamp = now().toISOString();
    const result = inTransaction(() => {
      const inserted = db.prepare(`INSERT OR IGNORE INTO notification_jobs
        (customer_id, event_type, entity_type, entity_id, dedupe_key, status, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
        .run(customerId, eventType, entityType, entityId, `${eventType}:${customerId}:${entityType}:${entityId}:${String(payload.status || "")}`, JSON.stringify(payload), timestamp, timestamp);
      if (inserted.changes && limited) db.prepare(`UPDATE subscription_grants SET available_count = available_count - 1,
        enabled = CASE WHEN available_count - 1 > 0 THEN 1 ELSE 0 END, updated_at = ? WHERE customer_id = ?`).run(timestamp, customerId);
      return inserted;
    });
    if (!result.changes) return null;
    return deliverNotification(Number(result.lastInsertRowid));
  }

  async function processBoboJobs() {
    const jobs = db.prepare(`SELECT bobo_sync_jobs.*, orders.order_number, orders.requirement_snapshot, orders.address_snapshot, inquiries.contact_name, inquiries.phone, inquiries.region, inquiries.address, inquiries.quantity, inquiries.expected_date, inquiries.description, inquiries.material, inquiries.dimensions
      FROM bobo_sync_jobs JOIN orders ON orders.id = bobo_sync_jobs.order_id JOIN inquiries ON inquiries.id = orders.inquiry_id
      WHERE bobo_sync_jobs.status IN ('pending', 'retrying') AND bobo_sync_jobs.next_attempt_at <= ? ORDER BY bobo_sync_jobs.id LIMIT 10`).all(now().toISOString());
    for (const job of jobs) {
      try {
        let requirement = {};
        try { requirement = JSON.parse(job.requirement_snapshot || "{}"); } catch {}
        const description = [
          requirement.description || job.description,
          requirement.thickness ? `厚度：${requirement.thickness}` : "",
          requirement.process ? `加工工艺：${requirement.process}` : "",
          requirement.technicalRequirements ? `技术要求：${requirement.technicalRequirements}` : ""
        ].filter(Boolean).join("；");
        const result = await boboCreate({
          externalOrderNumber: String(job.order_number || ""),
          customer: String(job.contact_name || ""),
          phone: String(job.phone || ""),
          quantity: Number(requirement.quantity || job.quantity),
          expectedDate: String(requirement.expectedDate || job.expected_date || ""),
          description,
          material: String(requirement.material || job.material || ""),
          dimensions: String(requirement.dimensions || job.dimensions || ""),
          region: String(job.region || ""),
          deliveryAddress: String(job.address_snapshot || job.address || ""),
          sourceChannel: "order_platform"
        });
        const timestamp = now().toISOString();
        db.prepare("UPDATE orders SET bobo_sync_status = 'synced', bobo_order_id = ?, bobo_work_order_id = ? WHERE id = ?").run(String(result.orderId || ""), String(result.workOrderId || ""), job.order_id);
        db.prepare("UPDATE bobo_sync_jobs SET status = 'synced', attempts = attempts + 1, last_error = '', updated_at = ? WHERE id = ?").run(timestamp, job.id);
        audit("system", "bobo_order_synced", "order", job.order_id, String(result.workOrderId || ""));
      } catch (error) {
        const attempts = Number(job.attempts) + 1;
        const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 5));
        const nextAttempt = new Date(now().getTime() + delayMinutes * 60000).toISOString();
        const message = error instanceof Error ? error.message.slice(0, 500) : "波波同步失败";
        db.prepare("UPDATE bobo_sync_jobs SET status = 'retrying', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?").run(attempts, message, nextAttempt, now().toISOString(), job.id);
        db.prepare("UPDATE orders SET bobo_sync_status = 'retrying' WHERE id = ?").run(job.order_id);
        if (attempts === 5) {
          db.prepare("INSERT INTO admin_todos (type, entity_type, entity_id, detail, created_at) VALUES ('bobo_sync_failed', 'order', ?, ?, ?)").run(job.order_id, message, now().toISOString());
          try { await alert(`未来机械订单 ${job.order_number} 同步波波工单连续失败 5 次：${message}`); } catch (alertError) { audit("system", "wecom_alert_failed", "order", job.order_id, alertError.message); }
        }
      }
    }
    return jobs.length;
  }

  function inquiryView(row) {
    const created = new Date(row.created_at);
    const claimed = row.claimed_at ? new Date(row.claimed_at) : null;
    const elapsedMinutes = ((claimed || now()) - created) / 60000;
    return {
      id: row.id,
      inquiryNumber: row.inquiry_number,
      drawingMode: row.drawing_mode,
      contactName: row.contact_name,
      phone: row.phone,
      region: row.region,
      address: row.address,
      quantity: row.quantity,
      expectedDate: row.expected_date,
      description: row.description,
      material: row.material,
      dimensions: row.dimensions,
      process: row.process,
      technicalRequirements: row.technical_requirements,
      status: row.status,
      source: row.source,
      customerId: row.customer_id,
      state: row.lifecycle_state,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      createdAt: row.created_at,
      slaStatus: elapsedMinutes <= 10 ? "on_time" : "overdue"
    };
  }

  function customerInquiryView(row) {
    return {
      id: row.id,
      inquiryNumber: row.inquiry_number,
      drawingMode: row.drawing_mode,
      region: row.region,
      address: row.address,
      quantity: row.quantity,
      expectedDate: row.expected_date,
      description: row.description,
      material: row.material,
      dimensions: row.dimensions,
      process: row.process,
      technicalRequirements: row.technical_requirements,
      source: row.source,
      state: row.lifecycle_state,
      status: row.status,
      createdAt: row.created_at
    };
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/admin/auth/wecom/start") {
      if (!wecomCorpId || !wecomAgentId || adminSessionSecret.length < 32 || (!wecomAppSecret && !options.exchangeWecomCode)) return sendJson(response, 501, { message: "企业微信登录尚未完整配置" });
      const state = crypto.randomBytes(32).toString("base64url");
      const timestamp = now();
      db.prepare("DELETE FROM admin_oauth_states WHERE expires_at <= ?").run(timestamp.toISOString());
      db.prepare("INSERT INTO admin_oauth_states (state_hash, expires_at, created_at) VALUES (?, ?, ?)")
        .run(hashToken(state, adminSessionSecret), new Date(timestamp.getTime() + 5 * 60 * 1000).toISOString(), timestamp.toISOString());
      setCookie(response, "wljixie_admin_oauth", state, 300);
      const query = new URLSearchParams({ appid: wecomCorpId, agentid: wecomAgentId, redirect_uri: wecomRedirectUri, state });
      response.writeHead(302, { location: `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?${query}`, "cache-control": "no-store" });
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/api/admin/auth/wecom/callback") {
      const state = String(url.searchParams.get("state") || "");
      const code = String(url.searchParams.get("code") || "");
      const cookieState = parseCookies(request).wljixie_admin_oauth || "";
      const stateHash = hashToken(state, adminSessionSecret);
      const stored = state && code && safeEqual(state, cookieState)
        ? db.prepare("SELECT state_hash FROM admin_oauth_states WHERE state_hash = ? AND expires_at > ?").get(stateHash, now().toISOString())
        : null;
      if (!stored) return sendJson(response, 401, { message: "登录请求已失效，请重新扫码" });
      db.prepare("DELETE FROM admin_oauth_states WHERE state_hash = ?").run(stateHash);
      const identity = await exchangeWecomCode(code);
      if (!identity?.userId || !identity?.name) return sendJson(response, 403, { message: "成员不在应用可见范围" });
      const role = superAdminUserIds.has(identity.userId) ? "super_admin" : "customer_service";
      const timestamp = now();
      const createdAt = timestamp.toISOString();
      db.prepare(`INSERT INTO admin_users (user_id, name, role, active, last_login_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, role = excluded.role, last_login_at = excluded.last_login_at, updated_at = excluded.updated_at`)
        .run(identity.userId, identity.name, role, createdAt, createdAt, createdAt);
      const sessionToken = crypto.randomBytes(32).toString("base64url");
      const csrfToken = csrfTokenForSession(sessionToken, adminSessionSecret);
      db.prepare("INSERT INTO admin_sessions (token_hash, user_id, csrf_hash, expires_at, absolute_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(hashToken(sessionToken, adminSessionSecret), identity.userId, hashToken(csrfToken, adminSessionSecret), new Date(timestamp.getTime() + 30 * 60 * 1000).toISOString(), new Date(timestamp.getTime() + 12 * 60 * 60 * 1000).toISOString(), createdAt);
      setCookie(response, "wljixie_admin_session", sessionToken, 12 * 60 * 60);
      response.writeHead(302, { location: "/admin.html", "cache-control": "no-store" });
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/api/admin/auth/session") {
      const actor = adminSession(request);
      if (!actor) return sendJson(response, 401, { message: "请使用企业微信扫码登录" });
      const csrfToken = csrfTokenForSession(actor.rawToken, adminSessionSecret);
      db.prepare("UPDATE admin_sessions SET csrf_hash = ? WHERE token_hash = ?").run(hashToken(csrfToken, adminSessionSecret), hashToken(actor.rawToken, adminSessionSecret));
      return sendJson(response, 200, { user: { userId: actor.userId, name: actor.name, role: actor.role }, csrfToken });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/auth/logout") {
      const actor = adminSession(request);
      if (!actor) return sendJson(response, 401, { message: "登录已失效" });
      if (!validSessionWrite(request, actor)) return sendJson(response, 403, { message: "安全校验失败，请刷新页面后重试" });
      db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(actor.rawToken, adminSessionSecret));
      setCookie(response, "wljixie_admin_session", "", 0);
      response.writeHead(204);
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok", service: "future-machinery-website", version: applicationVersion });
    }

    if (request.method === "GET" && url.pathname === "/api/status-dictionary") {
      return sendJson(response, 200, PUBLIC_STATUS_DICTIONARY);
    }

    if (request.method === "GET" && url.pathname === "/api/integrations/bobo/health") {
      return sendJson(response, 200, { enabled: Boolean(boboWebhookSecret), statusMapping: { production: "production", quality: "quality", ready: "ready", shipped: "shipped", completed: "completed" } });
    }

    if (request.method === "POST" && url.pathname === "/api/integrations/bobo/events") {
      const rawBody = (await readBody(request)).toString("utf8");
      if (!validIntegrationRequest(request, rawBody, boboWebhookSecret, now)) return sendJson(response, 401, { message: "集成签名无效" });
      const nonce = String(request.headers["x-integration-nonce"]);
      db.prepare("DELETE FROM integration_nonces WHERE received_at < ?").run(new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString());
      try {
        db.prepare("INSERT INTO integration_nonces (nonce, received_at) VALUES (?, ?)").run(nonce, now().toISOString());
      } catch {
        return sendJson(response, 409, { message: "集成请求已重放" });
      }
      let event;
      try { event = JSON.parse(rawBody); } catch { return sendJson(response, 400, { message: "请求格式错误" }); }
      if (!event.eventId) return sendJson(response, 422, { message: "事件ID必填" });
      if (db.prepare("SELECT event_id FROM bobo_webhook_events WHERE event_id = ?").get(String(event.eventId))) return sendJson(response, 200, { duplicate: true });
      const order = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(String(event.externalOrderNumber || ""));
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      const sequence = Number(event.sequence || 0);
      if (!Number.isSafeInteger(sequence) || sequence <= Number(order.bobo_last_sequence || 0)) return sendJson(response, 409, { message: "事件序号已过期" });
      const statusByType = { "quality.ready": "quality", "shipment.ready": "ready", "shipment.shipped": "shipped", "delivery.completed": "completed" };
      const processStatus = event.allProcessesCompleted === true ? "ready" : "production";
      const proposedStatus = statusByType[event.type] || processStatus;
      const statusRank = { awaiting_payment: 0, awaiting_schedule: 1, production: 2, quality: 3, ready: 4, shipped: 5, completed: 6 };
      const nextStatus = (statusRank[proposedStatus] ?? 0) > (statusRank[order.status] ?? 0) ? proposedStatus : order.status;
      const allProcessesCompleted = typeof event.allProcessesCompleted === "boolean"
        ? Number(event.allProcessesCompleted)
        : Number(order.bobo_all_processes_completed || 0);
      const occurredAt = String(event.occurredAt || now().toISOString());
      const completedAt = nextStatus === "completed" && order.status !== "completed"
        ? String(event.delivery?.deliveredAt || occurredAt)
        : "";
      const title = nextStatus === "completed" ? "订单已送达" : nextStatus === "shipped" ? "订单配送中" : nextStatus === "ready" ? "波波工序已全部完成，等待配送" : "波波生产进度已更新";
      inTransaction(() => {
        const process = event.process || {};
        if (process.id && process.name && process.status) {
          db.prepare(`INSERT INTO public_processes (order_id, process_id, sequence, name, status, started_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id, process_id) DO UPDATE SET sequence = excluded.sequence, name = excluded.name, status = excluded.status, started_at = excluded.started_at, completed_at = excluded.completed_at`)
            .run(order.id, String(process.id), Number(process.sequence || sequence), String(process.name).slice(0, 60), String(process.status).slice(0, 20), String(process.startedAt || ""), String(process.completedAt || ""));
        }
        db.prepare(`UPDATE orders SET status = ?, bobo_work_order_id = COALESCE(NULLIF(?, ''), bobo_work_order_id),
          bobo_last_sequence = ?, bobo_all_processes_completed = ?, completed_at = CASE WHEN ? != '' THEN ? ELSE completed_at END WHERE id = ?`)
          .run(nextStatus, String(event.workOrderId || ""), sequence, allProcessesCompleted, completedAt, completedAt, order.id);
        if (nextStatus !== order.status) {
          db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, ?, ?, ?)")
            .run(order.id, nextStatus, title, occurredAt);
        }
        db.prepare(`INSERT INTO bobo_webhook_events
          (event_id, order_id, sequence, received_at, event_type, occurred_at, payload_json, applied_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(String(event.eventId), order.id, sequence, now().toISOString(), String(event.type || ""), occurredAt, rawBody, nextStatus);
        audit("bobo", "webhook_event", "order", order.id, boboAuditDetail(event));
      });
      if (nextStatus !== order.status && order.customer_id) {
        await queueNotification(order.customer_id, "order_status_changed", "order", order.id, { orderNumber: order.order_number, status: nextStatus, title, occurredAt });
      }
      return sendJson(response, 202, { accepted: true });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/wechat/login") {
      const input = await readJson(request);
      const code = String(input.code || "");
      if (!code) return sendJson(response, 422, { message: "微信登录凭证必填" });
      let openid;
      if (code.startsWith("mock:")) {
        if (!enableWechatMock || !code.slice(5).trim()) return sendJson(response, 501, { message: "未配置微信验证提供商，mock 登录未启用" });
        openid = code.slice(5).trim();
      } else {
        openid = await exchangeWechatCode(code);
      }
      let identity = db.prepare("SELECT customer_id FROM wechat_identities WHERE openid = ?").get(openid);
      let customer;
      const timestamp = now().toISOString();
      if (identity) {
        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(identity.customer_id);
      } else {
        const created = db.prepare("INSERT INTO customers (contact_name, created_at) VALUES (?, ?)").run(String(input.contactName || "").trim(), timestamp);
        const customerId = Number(created.lastInsertRowid);
        db.prepare("INSERT INTO wechat_identities (customer_id, openid, created_at) VALUES (?, ?, ?)").run(customerId, openid, timestamp);
        customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
        audit("wechat", "mock_login", "customer", customerId, openid);
      }
      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(now().getTime() + 30 * 24 * 60 * 60000).toISOString();
      db.prepare("INSERT INTO customer_sessions (token, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(sessionToken, customer.id, expiresAt, timestamp);
      return sendJson(response, 201, { sessionToken, customer: { id: customer.id, contactName: customer.contact_name, phone: customer.phone || null }, expiresAt });
    }

    if (request.method === "POST" && url.pathname === "/api/customer/phone-binding") {
      const customer = sessionCustomer(request);
      if (!customer) return sendJson(response, 401, { message: "客户登录已失效" });
      const input = await readJson(request);
      let verifiedPhone = "";
      if (input.phoneCode) verifiedPhone = await exchangePhoneCode(String(input.phoneCode));
      else if (enablePhoneMock && input.verificationProof === `mock:${normalizePhone(input.phone)}`) verifiedPhone = input.phone;
      else return sendJson(response, 422, { field: "phoneCode", message: "手机号授权凭证无效" });
      const phone = normalizePhone(verifiedPhone);
      if (!/^1\d{10}$/.test(phone)) return sendJson(response, 422, { field: "phone", message: "请输入正确的11位手机号" });
      if (customer.phone && customer.phone !== phone) return sendJson(response, 409, { message: "已绑定手机号不可更换" });
      const occupied = db.prepare("SELECT id FROM customers WHERE phone = ? AND id != ?").get(phone, customer.id);
      if (occupied) return sendJson(response, 409, { message: "该手机号已绑定其他客户" });
      db.prepare("UPDATE customers SET phone = ? WHERE id = ?").run(phone, customer.id);
      db.prepare("UPDATE inquiries SET customer_id = ? WHERE phone = ?").run(customer.id, phone);
      db.prepare("UPDATE orders SET customer_id = ? WHERE phone = ?").run(customer.id, phone);
      audit(`customer:${customer.id}`, "bind_phone", "customer", customer.id, phone);
      return sendJson(response, 200, { customer: { id: customer.id, contactName: customer.contact_name, phone } });
    }

    if (request.method === "POST" && url.pathname === "/api/wechat/uploads") {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const upload = await readSingleFileUpload(request);
      const extension = upload.name.split(".").pop().toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) return sendJson(response, 422, { field: "attachments", message: "附件格式不支持" });
      if (upload.content.length > MAX_ATTACHMENT_SIZE) return sendJson(response, 422, { field: "attachments", message: "单个附件不能超过20MB" });
      const id = crypto.randomUUID();
      const storedName = `${id}.${extension}`;
      fs.writeFileSync(path.join(uploadDir, storedName), upload.content, { flag: "wx" });
      db.prepare("INSERT INTO staged_uploads (id, customer_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, customer.id, upload.name, storedName, upload.content.length, now().toISOString());
      audit(`customer:${customer.id}`, "stage_upload", "staged_upload", 0, id);
      return sendJson(response, 201, { id, name: upload.name, size: upload.content.length });
    }

    if (request.method === "POST" && url.pathname === "/api/customer/subscriptions") {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const input = await readJson(request);
      const types = [...new Set(Array.isArray(input.types) ? input.types.map(String).filter(Boolean) : [])];
      const timestamp = now().toISOString();
      if (types.length) {
        if (!wechatSubscriptionTemplateId) return sendJson(response, 501, { message: "订阅消息模板尚未配置" });
        if (types.length !== 1 || types[0] !== wechatSubscriptionTemplateId) return sendJson(response, 422, { message: "订阅消息模板无效" });
        db.prepare(`INSERT INTO subscription_grants (customer_id, enabled, template_id, available_count, updated_at) VALUES (?, 1, ?, 1, ?)
          ON CONFLICT(customer_id) DO UPDATE SET enabled = 1, template_id = excluded.template_id,
          available_count = subscription_grants.available_count + 1, updated_at = excluded.updated_at`)
          .run(customer.id, wechatSubscriptionTemplateId, timestamp);
      } else {
        const enabled = input.enabled !== false ? 1 : 0;
        db.prepare(`INSERT INTO subscription_grants (customer_id, enabled, template_id, available_count, updated_at) VALUES (?, ?, '', 0, ?)
          ON CONFLICT(customer_id) DO UPDATE SET enabled = excluded.enabled, template_id = '', updated_at = excluded.updated_at`)
          .run(customer.id, enabled, timestamp);
      }
      const grant = db.prepare("SELECT enabled, available_count FROM subscription_grants WHERE customer_id = ?").get(customer.id);
      audit(`customer:${customer.id}`, "subscription", "customer", customer.id, `available:${grant.available_count}`);
      return sendJson(response, 200, { enabled: Boolean(grant.enabled), availableCount: grant.available_count });
    }

    if (request.method === "POST" && url.pathname === "/api/customer/inquiries") {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const input = await readJson(request);
      const state = input.state === "draft" ? "draft" : "submitted";
      const payload = {
        ...input,
        contactName: String(input.contactName || customer.contact_name || "微信客户"),
        phone: customer.phone,
        region: String(input.region || ""),
        quantity: input.quantity === undefined ? 1 : input.quantity,
        expectedDate: String(input.expectedDate || ""),
        description: String(input.description || ""),
        drawingMode: String(input.drawingMode || "none")
      };
      if (state === "submitted") {
        const problem = validateInquiry(payload);
        if (problem) return sendJson(response, 422, problem);
      }
      const stagedAttachments = [];
      const inlineAttachments = [];
      for (const attachment of payload.attachments || []) {
        if (!attachment.id) {
          if (!attachment.content) return sendJson(response, 422, { field: "attachments", message: "请先上传附件" });
          inlineAttachments.push(attachment);
          continue;
        }
        const staged = db.prepare("SELECT * FROM staged_uploads WHERE id = ? AND customer_id = ?").get(String(attachment.id), customer.id);
        if (!staged) return sendJson(response, 422, { field: "attachments", message: "附件不存在或无权使用" });
        stagedAttachments.push(staged);
      }
      const createdAt = now().toISOString();
      const inquiryNumber = nextNumber(db, "inquiries", "inquiry_number", "XQ", now());
      const result = db.prepare(`INSERT INTO inquiries
        (inquiry_number, drawing_mode, contact_name, phone, region, address, quantity, expected_date, description, material, dimensions, process, technical_requirements, source, customer_id, lifecycle_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'miniprogram', ?, ?, ?)`)
        .run(inquiryNumber, payload.drawingMode, payload.contactName.trim(), customer.phone, payload.region.trim(), String(payload.address || "").trim(), Number(payload.quantity), payload.expectedDate, payload.description.trim(), String(payload.material || "").trim(), String(payload.dimensions || "").trim(), String(payload.process || "").trim(), String(payload.technicalRequirements || "").trim(), customer.id, state, createdAt);
      const inquiryId = Number(result.lastInsertRowid);
      for (const staged of stagedAttachments) {
        db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(inquiryId, staged.original_name, staged.stored_name, staged.size, createdAt);
        db.prepare("DELETE FROM staged_uploads WHERE id = ?").run(staged.id);
      }
      for (const attachment of inlineAttachments) {
        const extension = attachment.name.split(".").pop().toLowerCase();
        const storedName = `${crypto.randomUUID()}.${extension}`;
        const content = Buffer.from(attachment.content, "base64");
        fs.writeFileSync(path.join(uploadDir, storedName), content, { flag: "wx" });
        db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(inquiryId, attachment.name, storedName, actualAttachmentSize(attachment), createdAt);
      }
      recordChange(inquiryId, state, state === "draft" ? "保存草稿" : "小程序提交需求", `customer:${customer.id}`);
      audit(`customer:${customer.id}`, "create_inquiry", "inquiry", inquiryId, state);
      if (state === "submitted") await queueNotification(customer.id, "inquiry_submitted", "inquiry", inquiryId, { inquiryNumber });
      return sendJson(response, 201, { id: inquiryId, inquiryNumber, state });
    }

    if (request.method === "GET" && url.pathname === "/api/customer/inquiries") {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const rows = db.prepare(`SELECT * FROM inquiries
        WHERE (customer_id = ? OR phone = ?)
          AND NOT EXISTS (SELECT 1 FROM orders WHERE orders.inquiry_id = inquiries.id)
        ORDER BY id DESC`).all(customer.id, customer.phone);
      return sendJson(response, 200, rows.map(customerInquiryView));
    }

    let customerMatch = url.pathname.match(/^\/api\/customer\/inquiries\/(\d+)$/);
    if (request.method === "POST" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ? AND customer_id = ? AND lifecycle_state = 'draft'").get(Number(customerMatch[1]), customer.id);
      if (!inquiry) return sendJson(response, 404, { message: "可编辑草稿不存在" });
      const input = await readJson(request);
      const state = input.state === "submitted" ? "submitted" : "draft";
      const payload = {
        ...input,
        contactName: String(input.contactName || customer.contact_name || "微信客户"),
        phone: customer.phone,
        region: String(input.region || ""),
        quantity: input.quantity === undefined ? 1 : input.quantity,
        expectedDate: String(input.expectedDate || ""),
        description: String(input.description || ""),
        drawingMode: String(input.drawingMode || "none")
      };
      if (state === "submitted") {
        const problem = validateInquiry(payload);
        if (problem) return sendJson(response, 422, problem);
      }
      db.prepare(`UPDATE inquiries SET drawing_mode = ?, contact_name = ?, region = ?, address = ?, quantity = ?, expected_date = ?, description = ?, material = ?, dimensions = ?, process = ?, technical_requirements = ?, lifecycle_state = ? WHERE id = ?`)
        .run(payload.drawingMode, payload.contactName.trim(), payload.region.trim(), String(payload.address || "").trim(), Number(payload.quantity), payload.expectedDate, payload.description.trim(), String(payload.material || "").trim(), String(payload.dimensions || "").trim(), String(payload.process || "").trim(), String(payload.technicalRequirements || "").trim(), state, inquiry.id);
      const createdAt = now().toISOString();
      for (const attachment of payload.attachments || []) {
        if (attachment.id) {
          const staged = db.prepare("SELECT * FROM staged_uploads WHERE id = ? AND customer_id = ?").get(String(attachment.id), customer.id);
          if (!staged) return sendJson(response, 422, { field: "attachments", message: "附件不存在或无权使用" });
          db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)").run(inquiry.id, staged.original_name, staged.stored_name, staged.size, createdAt);
          db.prepare("DELETE FROM staged_uploads WHERE id = ?").run(staged.id);
        } else if (attachment.content) {
          const extension = attachment.name.split(".").pop().toLowerCase();
          const storedName = `${crypto.randomUUID()}.${extension}`;
          const content = Buffer.from(attachment.content, "base64");
          fs.writeFileSync(path.join(uploadDir, storedName), content, { flag: "wx" });
          db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)").run(inquiry.id, attachment.name, storedName, content.length, createdAt);
        }
      }
      recordChange(inquiry.id, state === "submitted" ? "submitted" : "draft_updated", state === "submitted" ? "提交已有草稿" : "更新草稿", `customer:${customer.id}`);
      audit(`customer:${customer.id}`, "update_inquiry", "inquiry", inquiry.id, state);
      if (state === "submitted") await queueNotification(customer.id, "inquiry_submitted", "inquiry", inquiry.id, { inquiryNumber: inquiry.inquiry_number });
      return sendJson(response, 200, { id: inquiry.id, inquiryNumber: inquiry.inquiry_number, state });
    }
    if (request.method === "GET" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ? AND (customer_id = ? OR phone = ?)").get(Number(customerMatch[1]), customer.id, customer.phone);
      if (!inquiry) return sendJson(response, 404, { message: "需求不存在" });
      const changes = db.prepare("SELECT action, detail, operator, created_at AS createdAt FROM inquiry_change_records WHERE inquiry_id = ? ORDER BY id").all(inquiry.id);
      return sendJson(response, 200, { ...customerInquiryView(inquiry), changeRecords: changes });
    }

    customerMatch = url.pathname.match(/^\/api\/customer\/inquiries\/(\d+)\/supplements$/);
    if (request.method === "POST" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ? AND (customer_id = ? OR phone = ?)").get(Number(customerMatch[1]), customer.id, customer.phone);
      if (!inquiry) return sendJson(response, 404, { message: "需求不存在" });
      const input = await readJson(request);
      const material = String(input.material === undefined ? inquiry.material : input.material).trim();
      const dimensions = String(input.dimensions === undefined ? inquiry.dimensions : input.dimensions).trim();
      const description = String(input.description === undefined ? inquiry.description : input.description).trim();
      const confirmedQuote = db.prepare("SELECT id FROM quotes WHERE inquiry_id = ? AND status = 'confirmed' ORDER BY version DESC LIMIT 1").get(inquiry.id);
      const order = db.prepare("SELECT id FROM orders WHERE inquiry_id = ?").get(inquiry.id);
      if (confirmedQuote || order) {
        const detail = JSON.stringify({
          before: { material: inquiry.material, dimensions: inquiry.dimensions, description: inquiry.description },
          after: { material, dimensions, description },
          note: String(input.note || "需求变更申请")
        });
        recordChange(inquiry.id, "change_requested", detail, `customer:${customer.id}`);
        if (confirmedQuote && !order) db.prepare("UPDATE quotes SET status = 'change_requested' WHERE inquiry_id = ? AND status = 'confirmed'").run(inquiry.id);
        audit(`customer:${customer.id}`, "request_inquiry_change", "inquiry", inquiry.id);
        return sendJson(response, 202, { id: inquiry.id, changeRequested: true });
      }
      db.prepare("UPDATE inquiries SET material = ?, dimensions = ?, description = ?, lifecycle_state = 'submitted', customer_id = ? WHERE id = ?")
        .run(material, dimensions, description, customer.id, inquiry.id);
      recordChange(inquiry.id, "supplement", String(input.note || "补充资料"), `customer:${customer.id}`);
      audit(`customer:${customer.id}`, "supplement_inquiry", "inquiry", inquiry.id);
      await queueNotification(customer.id, "inquiry_submitted", "inquiry", inquiry.id, { inquiryNumber: inquiry.inquiry_number });
      return sendJson(response, 201, { id: inquiry.id, state: "submitted" });
    }

    if (request.method === "GET" && url.pathname === "/api/customer/orders") {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const scope = url.searchParams.get("scope") || "active";
      if (!["active", "history"].includes(scope)) return sendJson(response, 422, { message: "订单范围无效" });
      const keyword = String(url.searchParams.get("keyword") || "").trim();
      const startDate = String(url.searchParams.get("startDate") || "").trim();
      const endDate = String(url.searchParams.get("endDate") || "").trim();
      const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
      const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));
      const completionSql = `COALESCE(NULLIF(orders.completed_at, ''),
        (SELECT MAX(occurred_at) FROM order_events WHERE order_id = orders.id AND status = 'completed'), orders.created_at)`;
      const where = ["(orders.customer_id = ? OR orders.phone = ?)", scope === "history" ? "orders.status = 'completed'" : "orders.status != 'completed'"];
      const params = [customer.id, customer.phone];
      if (keyword) { where.push("orders.order_number LIKE ?"); params.push(`%${keyword}%`); }
      if (scope === "history" && startDate) { where.push(`date(${completionSql}) >= date(?)`); params.push(startDate); }
      if (scope === "history" && endDate) { where.push(`date(${completionSql}) <= date(?)`); params.push(endDate); }
      const whereSql = where.join(" AND ");
      const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE ${whereSql}`).get(...params).count);
      const rows = db.prepare(`SELECT orders.*,
        ${completionSql} AS effective_completed_at
        FROM orders WHERE ${whereSql}
        ORDER BY ${scope === "history" ? "effective_completed_at" : "orders.id"} DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize);
      const items = rows.map((row) => {
        let requirement = {};
        try { requirement = JSON.parse(row.requirement_snapshot || "{}"); } catch {}
        return {
          id: row.id,
          ...publicOrder({ orderNumber: row.order_number, contactName: row.contact_name, status: row.status }),
          summary: String(requirement.description || ""),
          createdAt: row.created_at,
          completedAt: scope === "history" ? row.effective_completed_at : ""
        };
      });
      return sendJson(response, 200, { items, total, page, pageSize });
    }

    customerMatch = url.pathname.match(/^\/api\/customer\/orders\/(\d+)\/repurchase-draft$/);
    if (request.method === "GET" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const order = db.prepare(`SELECT orders.*, inquiries.region, inquiries.drawing_mode
        FROM orders JOIN inquiries ON inquiries.id = orders.inquiry_id
        WHERE orders.id = ? AND (orders.customer_id = ? OR orders.phone = ?)`).get(Number(customerMatch[1]), customer.id, customer.phone);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      if (order.status !== "completed") return sendJson(response, 409, { message: "只有已送达订单可以复购" });
      let requirement = {};
      try { requirement = JSON.parse(order.requirement_snapshot || "{}"); } catch {}
      const originalAttachments = frozenOrderAttachments(order).map((item) => ({ id: item.id, name: item.original_name, size: item.size }));
      return sendJson(response, 200, {
        orderId: order.id,
        orderNumber: order.order_number,
        form: {
          drawingMode: String(requirement.drawingMode || order.drawing_mode || "none"),
          contactName: order.contact_name,
          phone: order.phone,
          region: order.region,
          address: order.address_snapshot,
          quantity: Number(requirement.quantity || 1),
          expectedDate: "",
          description: String(requirement.description || ""),
          material: String(requirement.material || ""),
          dimensions: String(requirement.dimensions || ""),
          process: String(requirement.process || ""),
          technicalRequirements: String(requirement.technicalRequirements || "")
        },
        originalAttachments
      });
    }

    customerMatch = url.pathname.match(/^\/api\/customer\/orders\/(\d+)\/repurchase$/);
    if (request.method === "POST" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const order = db.prepare("SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR phone = ?)").get(Number(customerMatch[1]), customer.id, customer.phone);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      if (order.status !== "completed") return sendJson(response, 409, { message: "只有已送达订单可以复购" });
      const input = await readJson(request);
      const payload = {
        ...input,
        contactName: String(input.contactName || customer.contact_name || "微信客户"),
        phone: customer.phone,
        region: String(input.region || ""),
        quantity: input.quantity === undefined ? 1 : input.quantity,
        expectedDate: String(input.expectedDate || ""),
        description: String(input.description || ""),
        drawingMode: String(input.drawingMode || "none")
      };
      const originalAttachments = input.reuseOriginalAttachments
        ? frozenOrderAttachments(order).map((item) => ({ name: item.original_name, stored_name: item.stored_name, size: item.size }))
        : [];
      const stagedAttachments = [];
      for (const attachment of payload.attachments || []) {
        if (!attachment.id) return sendJson(response, 422, { field: "attachments", message: "请先上传附件" });
        const staged = db.prepare("SELECT * FROM staged_uploads WHERE id = ? AND customer_id = ?").get(String(attachment.id), customer.id);
        if (!staged) return sendJson(response, 422, { field: "attachments", message: "附件不存在或无权使用" });
        stagedAttachments.push(staged);
      }
      const validationAttachments = [
        ...originalAttachments,
        ...stagedAttachments.map((item) => ({ name: item.original_name, size: item.size }))
      ];
      const problem = validateInquiry({ ...payload, attachments: validationAttachments });
      if (problem) return sendJson(response, 422, problem);
      const createdAt = now().toISOString();
      const inquiryNumber = nextNumber(db, "inquiries", "inquiry_number", "XQ", now());
      const inquiryId = inTransaction(() => {
        const result = db.prepare(`INSERT INTO inquiries
          (inquiry_number, drawing_mode, contact_name, phone, region, address, quantity, expected_date, description, material, dimensions, process, technical_requirements, source, customer_id, lifecycle_state, source_order_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'miniprogram_repurchase', ?, 'submitted', ?, ?)`)
          .run(inquiryNumber, payload.drawingMode, payload.contactName.trim(), customer.phone, payload.region.trim(), String(payload.address || "").trim(), Number(payload.quantity), payload.expectedDate, payload.description.trim(), String(payload.material || "").trim(), String(payload.dimensions || "").trim(), String(payload.process || "").trim(), String(payload.technicalRequirements || "").trim(), customer.id, order.id, createdAt);
        const newInquiryId = Number(result.lastInsertRowid);
        for (const attachment of originalAttachments) {
          db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(newInquiryId, attachment.name, attachment.stored_name, attachment.size, createdAt);
        }
        for (const staged of stagedAttachments) {
          db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(newInquiryId, staged.original_name, staged.stored_name, staged.size, createdAt);
          db.prepare("DELETE FROM staged_uploads WHERE id = ?").run(staged.id);
        }
        recordChange(newInquiryId, "submitted", `复购来源订单 ${order.order_number}`, `customer:${customer.id}`);
        audit(`customer:${customer.id}`, "repurchase_order", "inquiry", newInquiryId, `source_order:${order.id}`);
        return newInquiryId;
      });
      await queueNotification(customer.id, "inquiry_submitted", "inquiry", inquiryId, { inquiryNumber });
      return sendJson(response, 201, { id: inquiryId, inquiryNumber, state: "submitted" });
    }

    customerMatch = url.pathname.match(/^\/api\/customer\/orders\/(\d+)$/);
    if (request.method === "GET" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const order = db.prepare("SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR phone = ?)").get(Number(customerMatch[1]), customer.id, customer.phone);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      const events = db.prepare("SELECT status, title, occurred_at AS occurredAt FROM order_events WHERE order_id = ? ORDER BY id").all(order.id);
      const processes = db.prepare("SELECT process_id AS id, sequence, name, status, started_at AS startedAt, completed_at AS completedAt FROM public_processes WHERE order_id = ? ORDER BY sequence, process_id").all(order.id);
      return sendJson(response, 200, { ...publicOrder({ orderNumber: order.order_number, contactName: order.contact_name, status: order.status, events }), processes });
    }

    if (request.method === "POST" && url.pathname === "/api/inquiries") {
      const input = await readJson(request);
      const problem = validateInquiry(input);
      if (problem) return sendJson(response, 422, problem);
      const phone = normalizePhone(input.phone);
      const cutoff = new Date(now().getTime() - 5 * 60000).toISOString();
      const duplicate = db.prepare("SELECT id FROM inquiries WHERE phone = ? AND description = ? AND created_at >= ?").get(phone, input.description.trim(), cutoff);
      if (duplicate) return sendJson(response, 409, { message: "需求已收到，请勿重复提交" });

      const createdAt = now().toISOString();
      const inquiryNumber = nextNumber(db, "inquiries", "inquiry_number", "XQ", now());
      const source = "web";
      const result = db.prepare(`INSERT INTO inquiries
        (inquiry_number, drawing_mode, contact_name, phone, region, address, quantity, expected_date, description, material, dimensions, process, technical_requirements, source, lifecycle_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`)
        .run(inquiryNumber, input.drawingMode, input.contactName.trim(), phone, input.region.trim(), String(input.address || "").trim(), Number(input.quantity), input.expectedDate, input.description.trim(), String(input.material || "").trim(), String(input.dimensions || "").trim(), String(input.process || "").trim(), String(input.technicalRequirements || "").trim(), source, createdAt);
      const inquiryId = Number(result.lastInsertRowid);
      recordChange(inquiryId, "submitted", "网站提交需求", "public");
      for (const attachment of input.attachments || []) {
        const extension = attachment.name.split(".").pop().toLowerCase();
        const storedName = `${crypto.randomUUID()}.${extension}`;
        const content = Buffer.from(attachment.content, "base64");
        fs.writeFileSync(path.join(uploadDir, storedName), content, { flag: "wx" });
        db.prepare("INSERT INTO attachments (inquiry_id, original_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(inquiryId, attachment.name, storedName, actualAttachmentSize(attachment), createdAt);
      }
      return sendJson(response, 201, { id: inquiryId, inquiryNumber, message: "需求已收到，工作时段客服将在10分钟内联系您" });
    }

    if (request.method === "GET" && url.pathname === "/api/order-status") {
      const orderNumber = url.searchParams.get("orderNumber") || "";
      const phone = normalizePhone(url.searchParams.get("phone"));
      const row = db.prepare("SELECT * FROM orders WHERE order_number = ? AND phone = ?").get(orderNumber, phone);
      if (!row) return sendJson(response, 404, { message: "未找到订单，请核对订单号和手机号" });
      const events = db.prepare("SELECT status, title, occurred_at AS occurredAt FROM order_events WHERE order_id = ? ORDER BY id").all(row.id);
      const processes = db.prepare("SELECT process_id AS id, sequence, name, status, started_at AS startedAt, completed_at AS completedAt FROM public_processes WHERE order_id = ? ORDER BY sequence, process_id").all(row.id);
      return sendJson(response, 200, { ...publicOrder({
        orderNumber: row.order_number,
        contactName: row.contact_name,
        status: row.status,
        statusText: ORDER_STATUS_TEXT[row.status] || "状态更新中",
        events
      }), processes });
    }

    let adminActor = adminSession(request);
    if (!adminActor && legacyAdminEnabled && isLegacyAdmin(request, adminToken)) adminActor = { userId: "legacy-admin", name: "旧版管理员", role: "super_admin", csrfHash: "" };
    if (url.pathname.startsWith("/api/admin/") && !adminActor) {
      return sendJson(response, 401, { message: "请使用企业微信扫码登录" });
    }
    if (url.pathname.startsWith("/api/admin/") && request.method !== "GET" && !validSessionWrite(request, adminActor)) {
      return sendJson(response, 403, { message: "安全校验失败，请刷新页面后重试" });
    }
    const superAdminOnly = request.method === "POST" && (/\/payment-confirmation$/.test(url.pathname) || /\/payments\/\d+\/(verify|reject|void)$/.test(url.pathname) || /\/bobo-confirm$/.test(url.pathname) || /\/bobo-retry$/.test(url.pathname) || /\/notification-jobs\/\d+\/retry$/.test(url.pathname) || /\/orders\/\d+\/events$/.test(url.pathname));
    if ((superAdminOnly || url.pathname === "/api/admin/audit-logs") && adminActor.role !== "super_admin") {
      return sendJson(response, 403, { message: "此操作仅限超级管理员" });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/inquiries") {
      const view = url.searchParams.get("view") || "all";
      const search = String(url.searchParams.get("search") || "").trim().toLowerCase();
      let rows = db.prepare(`SELECT inquiries.*,
        (SELECT COUNT(*) FROM attachments WHERE attachments.inquiry_id = inquiries.id) AS attachment_count,
        (SELECT order_number FROM orders WHERE orders.inquiry_id = inquiries.id) AS order_number
        FROM inquiries ORDER BY inquiries.id DESC`).all();
      if (view === "active") rows = rows.filter((row) => !["ordered", "closed"].includes(row.status));
      if (view === "ordered") rows = rows.filter((row) => row.status === "ordered");
      if (view === "closed") rows = rows.filter((row) => row.status === "closed");
      if (search) rows = rows.filter((row) => [row.inquiry_number, row.contact_name, row.phone, row.region, row.address, row.description].some((value) => String(value || "").toLowerCase().includes(search)));
      return sendJson(response, 200, rows.map((row) => ({ ...inquiryView(row), attachmentCount: Number(row.attachment_count), orderNumber: row.order_number || "", closedReason: row.closed_reason || "" })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/orders") {
      const view = url.searchParams.get("view") || "all";
      const search = String(url.searchParams.get("search") || "").trim().toLowerCase();
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      let rows = db.prepare(`SELECT orders.*, inquiries.region, bobo_sync_jobs.last_error, bobo_sync_jobs.updated_at AS bobo_synced_at,
        (SELECT id FROM payments WHERE payments.order_id = orders.id AND payments.status = 'verified' ORDER BY id DESC LIMIT 1) AS payment_id,
        (SELECT receipt_number FROM payment_receipts WHERE payment_receipts.payment_id = (SELECT id FROM payments WHERE payments.order_id = orders.id AND payments.status = 'verified' ORDER BY id DESC LIMIT 1)) AS receipt_number
        FROM orders JOIN inquiries ON inquiries.id = orders.inquiry_id
        LEFT JOIN bobo_sync_jobs ON bobo_sync_jobs.order_id = orders.id ORDER BY orders.id DESC`).all();
      if (view === "active") rows = rows.filter((row) => row.status !== "completed");
      if (view === "completed") rows = rows.filter((row) => row.status === "completed");
      if (search) rows = rows.filter((row) => [row.order_number, row.inquiry_number, row.contact_name, row.phone, row.region].some((value) => String(value || "").toLowerCase().includes(search)));
      if (from) rows = rows.filter((row) => row.created_at.slice(0, 10) >= from);
      if (to) rows = rows.filter((row) => row.created_at.slice(0, 10) <= to);
      const processesForOrder = (orderId) => {
        const processes = db.prepare("SELECT name, status FROM public_processes WHERE order_id = ? ORDER BY sequence, process_id").all(orderId);
        return processes;
      };
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        inquiryNumber: row.inquiry_number,
        contactName: row.contact_name,
        phone: row.phone,
        region: row.region,
        address: row.address_snapshot,
        status: row.status,
        statusText: ORDER_STATUS_TEXT[row.status] || "状态更新中",
        currentProcess: currentProcessLabel(row, processesForOrder(row.id)),
        paymentStatus: paymentSummary(row.id).paymentStatus,
        payment: paymentSummary(row.id),
        boboSyncStatus: row.bobo_sync_status,
        boboOrderId: row.bobo_order_id,
        boboWorkOrderId: row.bobo_work_order_id,
        boboLastError: row.last_error || "",
        boboSyncedAt: row.bobo_synced_at || "",
        paymentId: row.payment_id || null,
        receiptNumber: row.receipt_number || "",
        createdAt: row.created_at
      })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
      const inquiries = db.prepare("SELECT status, claimed_at FROM inquiries").all();
      const orders = db.prepare("SELECT id, status, bobo_sync_status, created_at, completed_at FROM orders").all();
      const payments = db.prepare("SELECT status FROM payments").all();
      const today = now().toISOString().slice(0, 10);
      const count = {
        unclaimedInquiries: inquiries.filter((item) => !item.claimed_at && item.status !== "ordered" && item.status !== "closed").length,
        quotedAwaitingCustomer: inquiries.filter((item) => item.status === "quoted").length,
        ordersAwaitingPayment: orders.filter((item) => paymentSummary(item.id).verifiedAmount === 0).length,
        paymentsAwaitingReview: payments.filter((item) => item.status === "pending").length,
        depositReadyForScheduling: orders.filter((item) => { const summary = paymentSummary(item.id); return summary.mode === "deposit" && summary.verifiedAmount >= summary.startAmount && item.status === "awaiting_schedule"; }).length,
        balancesOutstanding: orders.filter((item) => { const summary = paymentSummary(item.id); return summary.verifiedAmount >= summary.startAmount && summary.remainingAmount > 0; }).length,
        boboSyncErrors: orders.filter((item) => item.bobo_sync_status === "retrying").length,
        deliveringSoon: orders.filter((item) => item.status === "ready").length,
        completedToday: orders.filter((item) => item.status === "completed" && String(item.completed_at || item.created_at).slice(0, 10) === today).length
      };
      return sendJson(response, 200, count);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/customers") {
      const rows = db.prepare(`SELECT MIN(inquiries.id) AS id, MAX(inquiries.contact_name) AS contact_name, inquiries.phone,
        MIN(inquiries.created_at) AS created_at, COUNT(DISTINCT inquiries.id) AS inquiry_count,
        COUNT(DISTINCT orders.id) AS order_count, MAX(COALESCE(orders.created_at, inquiries.created_at)) AS last_activity_at
        FROM inquiries LEFT JOIN orders ON orders.inquiry_id = inquiries.id
        GROUP BY inquiries.phone ORDER BY last_activity_at DESC`).all();
      const knownPhones = new Set(rows.map((row) => row.phone));
      const standalone = db.prepare("SELECT id, contact_name, phone, created_at FROM customers ORDER BY id DESC").all()
        .filter((row) => row.phone && !knownPhones.has(row.phone))
        .map((row) => ({ ...row, inquiry_count: 0, order_count: 0, last_activity_at: row.created_at }));
      return sendJson(response, 200, [...rows, ...standalone].map((row) => ({
        id: row.id, contactName: row.contact_name, phone: row.phone, createdAt: row.created_at,
        inquiryCount: Number(row.inquiry_count), orderCount: Number(row.order_count), lastActivityAt: row.last_activity_at
      })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/notification-jobs") {
      const rows = db.prepare("SELECT id, customer_id, event_type, entity_type, entity_id, status, attempts, last_error, created_at, updated_at FROM notification_jobs ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map((row) => ({ id: row.id, customerId: row.customer_id, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, status: row.status, attempts: row.attempts, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/todos") {
      const rows = db.prepare("SELECT id, type, entity_type, entity_id, detail, status, created_at, resolved_at FROM admin_todos WHERE status = 'open' ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map((row) => ({ id: row.id, type: row.type, entityType: row.entity_type, entityId: row.entity_id, detail: row.detail, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/payments") {
      const status = url.searchParams.get("status") || "";
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      let rows = db.prepare(`SELECT payments.*, orders.order_number FROM payments
        JOIN orders ON orders.id = payments.order_id ORDER BY payments.id DESC`).all();
      if (status) rows = rows.filter((row) => row.status === status);
      if (from) rows = rows.filter((row) => row.created_at.slice(0, 10) >= from);
      if (to) rows = rows.filter((row) => row.created_at.slice(0, 10) <= to);
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id, orderId: row.order_id, orderNumber: row.order_number, amount: row.amount,
        paymentMethod: row.payment_method, payerName: row.payer_name, receivedAt: row.received_at,
        status: row.status, recordedBy: row.recorded_by, verifiedBy: row.verified_by,
        verifiedAt: row.verified_at, reviewReason: row.review_reason, legacy: Boolean(row.is_legacy),
        note: row.note, proofName: row.proof_original_name,
        proofPreviewUrl: row.proof_stored_name ? `/api/admin/payments/${row.id}/proof/preview` : "",
        proofUrl: row.proof_stored_name ? `/api/admin/payments/${row.id}/proof` : "", createdAt: row.created_at
      })));
    }

    let detailMatch = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)$/);
    if (request.method === "GET" && detailMatch) {
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(Number(detailMatch[1]));
      if (!inquiry) return sendJson(response, 404, { message: "需求不存在" });
      const attachments = db.prepare("SELECT id, original_name, size, created_at FROM attachments WHERE inquiry_id = ? ORDER BY id").all(inquiry.id);
      const quotes = db.prepare("SELECT * FROM quotes WHERE inquiry_id = ? ORDER BY version DESC").all(inquiry.id);
      const timeline = db.prepare("SELECT action, detail, operator, created_at FROM inquiry_change_records WHERE inquiry_id = ? ORDER BY id").all(inquiry.id);
      const order = db.prepare("SELECT id, order_number, status FROM orders WHERE inquiry_id = ?").get(inquiry.id);
      return sendJson(response, 200, {
        ...inquiryView(inquiry),
        attachments: attachments.map((item) => ({ id: item.id, name: item.original_name, size: item.size, createdAt: item.created_at, downloadUrl: `/api/admin/attachments/${item.id}/download` })),
        quotes: quotes.map((item) => ({ id: item.id, version: item.version, amount: item.amount, validUntil: item.valid_until, status: item.status, operator: item.operator, paymentMode: item.payment_mode, startAmount: item.start_amount, specification: quoteSpecification(item, inquiry), createdAt: item.created_at })),
        timeline: timeline.map((item) => ({ action: item.action, detail: item.detail, operator: item.operator, createdAt: item.created_at })),
        order: order ? { id: order.id, orderNumber: order.order_number, status: order.status } : null
      });
    }

    detailMatch = url.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (request.method === "GET" && detailMatch) {
      const order = db.prepare(`SELECT orders.*, inquiries.region, quotes.version AS quote_version, quotes.amount AS quote_amount,
        quotes.valid_until, quotes.operator AS quote_operator FROM orders
        JOIN inquiries ON inquiries.id = orders.inquiry_id LEFT JOIN quotes ON quotes.id = orders.quote_id WHERE orders.id = ?`).get(Number(detailMatch[1]));
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      const summary = paymentSummary(order.id);
      const records = db.prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC").all(order.id);
      const events = db.prepare("SELECT status, title, occurred_at FROM order_events WHERE order_id = ? ORDER BY id").all(order.id);
      const processes = db.prepare("SELECT process_id AS id, sequence, name, status, started_at AS startedAt, completed_at AS completedAt FROM public_processes WHERE order_id = ? ORDER BY sequence, process_id").all(order.id);
      const currentProcess = currentProcessLabel(order, processes);
      const auditRows = db.prepare(`SELECT operator, action, detail, created_at FROM audit_logs
        WHERE (entity_type = 'order' AND entity_id = ?)
          OR (entity_type = 'payment' AND entity_id IN (SELECT id FROM payments WHERE order_id = ?))
        ORDER BY id DESC`).all(order.id, order.id);
      let requirement = {};
      try { requirement = JSON.parse(order.requirement_snapshot || "{}"); } catch { requirement = {}; }
      return sendJson(response, 200, {
        id: order.id, orderNumber: order.order_number, inquiryNumber: order.inquiry_number,
        contactName: order.contact_name, phone: order.phone, region: order.region, address: order.address_snapshot,
        status: order.status, statusText: ORDER_STATUS_TEXT[order.status] || "状态更新中", currentProcess, processes, paymentStatus: summary.paymentStatus, boboSyncStatus: order.bobo_sync_status,
        boboOrderId: order.bobo_order_id, boboWorkOrderId: order.bobo_work_order_id,
        createdAt: order.created_at, completedAt: order.completed_at, requirement,
        quote: { id: order.quote_id, version: order.quote_version, amount: order.quote_amount, validUntil: order.valid_until, operator: order.quote_operator },
        payment: summary,
        payments: records.map((item) => ({ id: item.id, amount: item.amount, paymentMethod: item.payment_method, payerName: item.payer_name, receivedAt: item.received_at, status: item.status, recordedBy: item.recorded_by, verifiedBy: item.verified_by, verifiedAt: item.verified_at, reviewReason: item.review_reason, legacy: Boolean(item.is_legacy), note: item.note, proofName: item.proof_original_name, proofPreviewUrl: item.proof_stored_name ? `/api/admin/payments/${item.id}/proof/preview` : "", proofUrl: item.proof_stored_name ? `/api/admin/payments/${item.id}/proof` : "" })),
        events: events.map((item) => ({ status: item.status, title: item.title, occurredAt: item.occurred_at })),
        audit: auditRows.map((item) => ({ operator: item.operator, action: item.action, detail: item.detail, createdAt: item.created_at })),
        actions: { canSchedule: canEnterProduction({ verifiedAmount: summary.verifiedAmount, startAmount: summary.startAmount }), canShip: canShip({ verifiedAmount: summary.verifiedAmount, totalAmount: summary.totalAmount }) }
      });
    }

    detailMatch = url.pathname.match(/^\/api\/admin\/attachments\/(\d+)\/download$/);
    if (request.method === "GET" && detailMatch) {
      const attachment = db.prepare("SELECT * FROM attachments WHERE id = ?").get(Number(detailMatch[1]));
      if (!attachment) return sendJson(response, 404, { message: "附件不存在" });
      const file = path.join(uploadDir, attachment.stored_name);
      if (!fs.existsSync(file)) return sendJson(response, 404, { message: "附件文件不存在" });
      response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      fs.createReadStream(file).pipe(response);
      return true;
    }

    detailMatch = url.pathname.match(/^\/api\/admin\/attachments\/(\d+)\/preview$/);
    if (request.method === "GET" && detailMatch) {
      const attachment = db.prepare("SELECT * FROM attachments WHERE id = ?").get(Number(detailMatch[1]));
      if (!attachment) return sendJson(response, 404, { message: "附件不存在" });
      const file = path.join(uploadDir, attachment.stored_name);
      if (!fs.existsSync(file)) return sendJson(response, 404, { message: "附件文件不存在" });
      const extension = path.extname(attachment.original_name).toLowerCase();
      const previewTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".dxf": "text/plain; charset=utf-8" };
      const contentType = previewTypes[extension];
      if (!contentType) return sendJson(response, 415, { message: "该附件格式暂不支持在线预览" });
      response.writeHead(200, { "content-type": contentType, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      fs.createReadStream(file).pipe(response);
      return true;
    }

    detailMatch = url.pathname.match(/^\/api\/admin\/payments\/(\d+)\/proof$/);
    if (request.method === "GET" && detailMatch) {
      const payment = db.prepare("SELECT proof_original_name, proof_stored_name FROM payments WHERE id = ?").get(Number(detailMatch[1]));
      if (!payment?.proof_stored_name) return sendJson(response, 404, { message: "付款凭证不存在" });
      const file = path.join(uploadDir, payment.proof_stored_name);
      if (!fs.existsSync(file)) return sendJson(response, 404, { message: "付款凭证文件不存在" });
      response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${encodeURIComponent(payment.proof_original_name)}"`, "cache-control": "no-store" });
      fs.createReadStream(file).pipe(response);
      return true;
    }

    detailMatch = url.pathname.match(/^\/api\/admin\/payments\/(\d+)\/proof\/preview$/);
    if (request.method === "GET" && detailMatch) {
      const payment = db.prepare("SELECT proof_original_name, proof_stored_name FROM payments WHERE id = ?").get(Number(detailMatch[1]));
      if (!payment?.proof_stored_name) return sendJson(response, 404, { message: "付款凭证不存在" });
      const file = path.join(uploadDir, payment.proof_stored_name);
      if (!fs.existsSync(file)) return sendJson(response, 404, { message: "付款凭证文件不存在" });
      const contentType = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" }[path.extname(payment.proof_original_name).toLowerCase()];
      if (!contentType) return sendJson(response, 415, { message: "该付款凭证格式暂不支持在线预览" });
      response.writeHead(200, { "content-type": contentType, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(payment.proof_original_name)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      fs.createReadStream(file).pipe(response);
      return true;
    }

    let match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/claim$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const row = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(Number(match[1]));
      if (!row) return sendJson(response, 404, { message: "需求不存在" });
      const claimedAt = now().toISOString();
      db.prepare("UPDATE inquiries SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?")
        .run(adminActor.name, claimedAt, row.id);
      audit(adminActor, "claim", "inquiry", row.id);
      return sendJson(response, 200, inquiryView({ ...row, status: "claimed", claimed_by: adminActor.name, claimed_at: claimedAt }));
    }

    match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/customer$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(Number(match[1]));
      const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(Number(input.customerId));
      if (!inquiry || !customer) return sendJson(response, 404, { message: "需求或客户不存在" });
      if (!customer.phone || customer.phone !== inquiry.phone) return sendJson(response, 409, { message: "客户手机号与需求手机号不一致" });
      db.prepare("UPDATE inquiries SET customer_id = ? WHERE id = ?").run(customer.id, inquiry.id);
      db.prepare("UPDATE orders SET customer_id = ? WHERE inquiry_id = ?").run(customer.id, inquiry.id);
      audit(adminActor, "link_customer", "inquiry", inquiry.id, String(customer.id));
      return sendJson(response, 200, { inquiryId: inquiry.id, customerId: customer.id });
    }

    match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/quotes$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const inquiryId = Number(match[1]);
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(inquiryId);
      if (!inquiry) return sendJson(response, 404, { message: "需求不存在" });
      if (!(Number(input.amount) > 0) || !input.validUntil) return sendJson(response, 422, { message: "报价金额和有效期必填" });
      const paymentMode = input.paymentMode === "deposit" ? "deposit" : "full";
      const startAmount = paymentMode === "deposit" ? Number(input.startAmount) : Number(input.amount);
      if (!(startAmount > 0) || startAmount > Number(input.amount)) return sendJson(response, 422, { message: "开工款必须大于0且不能超过订单总额" });
      const last = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM quotes WHERE inquiry_id = ?").get(inquiryId);
      const version = Number(last.version) + 1;
      const status = input.confirmed ? "confirmed" : "draft";
      if (input.specification !== undefined && (!input.specification || typeof input.specification !== "object" || Array.isArray(input.specification))) return sendJson(response, 422, { message: "报价规格格式错误" });
      if (input.specification && Object.hasOwn(input.specification, "quantity") && (!Number.isSafeInteger(Number(input.specification.quantity)) || Number(input.specification.quantity) <= 0)) return sendJson(response, 422, { message: "报价数量必须为正整数" });
      if (input.specification && Object.hasOwn(input.specification, "requirement") && !String(input.specification.requirement).trim()) return sendJson(response, 422, { message: "需求内容不能为空" });
      const specification = normalizeQuoteSpecification(input.specification, inquiry);
      const result = db.prepare("INSERT INTO quotes (inquiry_id, version, amount, valid_until, status, operator, payment_mode, start_amount, specification_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(inquiryId, version, Number(input.amount), input.validUntil, status, adminActor.name, paymentMode, startAmount, JSON.stringify(specification), now().toISOString());
      if (status === "confirmed") db.prepare("UPDATE inquiries SET status = 'quoted' WHERE id = ? AND status != 'ordered'").run(inquiryId);
      audit(adminActor, "create_quote", "quote", Number(result.lastInsertRowid), `v${version}`);
      return sendJson(response, 201, { id: Number(result.lastInsertRowid), version, status, specification });
    }

    match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/close$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(Number(match[1]));
      const reason = String(input.reason || "").trim().slice(0, 300);
      if (!inquiry) return sendJson(response, 404, { message: "需求不存在" });
      if (inquiry.status === "ordered") return sendJson(response, 409, { message: "已转订单的询价不能关闭" });
      if (!reason) return sendJson(response, 422, { message: "关闭未成交询价必须填写原因" });
      db.prepare("UPDATE inquiries SET status = 'closed', lifecycle_state = 'closed', closed_reason = ? WHERE id = ?").run(reason, inquiry.id);
      recordChange(inquiry.id, "closed", reason, adminActor.name);
      audit(adminActor, "close_inquiry", "inquiry", inquiry.id, reason);
      return sendJson(response, 200, { id: inquiry.id, status: "closed", reason });
    }

    match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/order-confirmation$/);
    if (request.method === "POST" && match) {
      await readJson(request);
      const inquiryId = Number(match[1]);
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(inquiryId);
      const quote = db.prepare("SELECT * FROM quotes WHERE inquiry_id = ? AND status = 'confirmed' ORDER BY version DESC LIMIT 1").get(inquiryId);
      if (!inquiry || !quote) return sendJson(response, 409, { message: "请先创建并确认报价" });
      if (db.prepare("SELECT id FROM orders WHERE inquiry_id = ?").get(inquiryId)) return sendJson(response, 409, { message: "该询价已经生成正式订单" });
      const createdAt = now().toISOString();
      const orderNumber = nextNumber(db, "orders", "order_number", "WL", now());
      const frozenAttachments = db.prepare("SELECT id, original_name, size, created_at FROM attachments WHERE inquiry_id = ? ORDER BY id").all(inquiryId);
      const requirement = JSON.stringify(orderRequirementSnapshot(inquiry, quote, frozenAttachments));
      const result = db.prepare(`INSERT INTO orders
        (inquiry_id, inquiry_number, quote_id, order_number, contact_name, phone, address_snapshot, requirement_snapshot, status, payment_status, total_amount, customer_id, bobo_sync_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', 'unpaid', ?, ?, 'not_ready', ?)`)
        .run(inquiryId, inquiry.inquiry_number, quote.id, orderNumber, inquiry.contact_name, inquiry.phone, inquiry.address, requirement, quote.amount, inquiry.customer_id, createdAt);
      const orderId = Number(result.lastInsertRowid);
      const paymentMode = quote.payment_mode === "deposit" ? "deposit" : "full";
      const startAmount = Number(quote.start_amount) > 0 ? Number(quote.start_amount) : Number(quote.amount);
      db.prepare("INSERT INTO payment_terms (order_id, payment_mode, total_amount, start_amount, balance_due_event, created_at) VALUES (?, ?, ?, ?, 'before_shipping', ?)")
        .run(orderId, paymentMode, quote.amount, startAmount, createdAt);
      db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, 'awaiting_payment', '客户已确认报价，正式订单已创建', ?)").run(orderId, createdAt);
      db.prepare("UPDATE inquiries SET status = 'ordered', lifecycle_state = 'ordered' WHERE id = ?").run(inquiryId);
      recordChange(inquiryId, "ordered", `已生成正式订单 ${orderNumber}`, adminActor.name);
      audit(adminActor, "create_order", "order", orderId, `quote:${quote.id}`);
      return sendJson(response, 201, { id: orderId, orderNumber, status: "awaiting_payment", paymentStatus: "unpaid", boboSyncStatus: "not_ready" });
    }

    match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/payment-confirmation$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const inquiryId = Number(match[1]);
      const inquiry = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(inquiryId);
      const quote = db.prepare("SELECT * FROM quotes WHERE inquiry_id = ? ORDER BY version DESC LIMIT 1").get(inquiryId);
      const existing = db.prepare("SELECT * FROM orders WHERE inquiry_id = ?").get(inquiryId);
      if (!inquiry || !quote) return sendJson(response, 409, { message: "请先创建并确认报价" });
      if (!canConfirmPayment({ quoteStatus: quote.status, paymentStatus: existing ? "paid" : "unpaid" })) {
        return sendJson(response, 409, { message: "当前状态不能确认付款" });
      }
      const customer = inquiry.customer_id
        ? db.prepare("SELECT id FROM customers WHERE id = ?").get(inquiry.customer_id)
        : db.prepare("SELECT id FROM customers WHERE phone = ?").get(inquiry.phone);
      const orderNumber = nextNumber(db, "orders", "order_number", "WL", now());
      const createdAt = now().toISOString();
      const frozenAttachments = db.prepare("SELECT id, original_name, size, created_at FROM attachments WHERE inquiry_id = ? ORDER BY id").all(inquiryId);
      const requirement = JSON.stringify(orderRequirementSnapshot(inquiry, quote, frozenAttachments));
      const parsedReceivedAt = Date.parse(String(input.receivedAt || ""));
      const receivedAt = Number.isNaN(parsedReceivedAt) ? createdAt : new Date(parsedReceivedAt).toISOString();
      const paymentMethod = String(input.paymentMethod || "线下付款").trim().slice(0, 40) || "线下付款";
      const payerName = String(input.payerName || inquiry.contact_name).trim().slice(0, 80) || inquiry.contact_name;
      const created = inTransaction(() => {
        if (customer && !inquiry.customer_id) db.prepare("UPDATE inquiries SET customer_id = ? WHERE id = ?").run(customer.id, inquiryId);
        const orderResult = db.prepare(`INSERT INTO orders
          (inquiry_id, inquiry_number, quote_id, order_number, contact_name, phone, address_snapshot, requirement_snapshot, status, payment_status, total_amount, customer_id, bobo_sync_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'paid', ?, ?, 'not_ready', ?)`)
          .run(inquiryId, inquiry.inquiry_number, quote.id, orderNumber, inquiry.contact_name, inquiry.phone, inquiry.address, requirement, quote.amount, customer ? customer.id : null, createdAt);
        const orderId = Number(orderResult.lastInsertRowid);
        db.prepare("INSERT INTO payment_terms (order_id, payment_mode, total_amount, start_amount, balance_due_event, created_at) VALUES (?, 'full', ?, ?, 'before_shipping', ?)")
          .run(orderId, quote.amount, quote.amount, createdAt);
        const paymentResult = db.prepare(`INSERT INTO payments
          (order_id, amount, payment_method, payer_name, received_at, status, recorded_by, verified_by, verified_at, created_at)
          VALUES (?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`)
          .run(orderId, quote.amount, paymentMethod, payerName, receivedAt, adminActor.name, adminActor.name, createdAt, createdAt);
        db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, 'paid', '已确认全额付款', ?)").run(orderId, createdAt);
        db.prepare("UPDATE inquiries SET status = 'ordered', lifecycle_state = 'ordered' WHERE id = ?").run(inquiryId);
        audit(adminActor, "confirm_payment", "order", orderId);
        const bobo = autoQueueBoboSync(orderId, adminActor, Number(paymentResult.lastInsertRowid));
        return { orderId, bobo };
      });
      if (customer) await queueNotification(customer.id, "payment_confirmed", "order", created.orderId, { orderNumber, status: "paid", title: "已确认付款，等待排产", occurredAt: createdAt });
      return sendJson(response, 201, { id: created.orderId, orderNumber, status: "paid", boboSyncStatus: created.bobo.status, boboAutoSubmitted: created.bobo.submitted });
    }

    match = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/payments$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const orderId = Number(match[1]);
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      const summary = paymentSummary(orderId);
      const amount = Number(input.amount);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      if (!(amount > 0)) return sendJson(response, 422, { message: "到账金额必须大于0" });
      if (amount > summary.remainingAmount - summary.pendingAmount) return sendJson(response, 422, { message: "本次金额超过剩余未登记金额" });
      const allowedMethods = new Set(["银行转账", "微信", "支付宝", "现金", "其他"]);
      const paymentMethod = allowedMethods.has(input.paymentMethod) ? input.paymentMethod : "其他";
      const parsedReceivedAt = Date.parse(String(input.receivedAt || ""));
      const receivedAt = Number.isNaN(parsedReceivedAt) ? now().toISOString() : new Date(parsedReceivedAt).toISOString();
      let proofOriginalName = "";
      let proofStoredName = "";
      if (input.proof?.name && input.proof?.content) {
        const extension = String(input.proof.name).split(".").pop().toLowerCase();
        const content = Buffer.from(input.proof.content, "base64");
        if (!ALLOWED_EXTENSIONS.has(extension) || content.length > MAX_ATTACHMENT_SIZE) return sendJson(response, 422, { message: "付款凭证格式或大小不符合要求" });
        proofOriginalName = String(input.proof.name).replace(/[\\/]/g, "_");
        proofStoredName = `${crypto.randomUUID()}.${extension}`;
        fs.writeFileSync(path.join(uploadDir, proofStoredName), content, { flag: "wx" });
      }
      const createdAt = now().toISOString();
      const result = db.prepare(`INSERT INTO payments
        (order_id, amount, payment_method, payer_name, received_at, status, recorded_by, verified_by, verified_at, proof_original_name, proof_stored_name, note, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, '', '', ?, ?, ?, ?)`)
        .run(orderId, amount, paymentMethod, String(input.payerName || order.contact_name).trim().slice(0, 80), receivedAt, adminActor.name, proofOriginalName, proofStoredName, String(input.note || "").trim().slice(0, 300), createdAt);
      const paymentId = Number(result.lastInsertRowid);
      refreshOrderPayment(orderId);
      audit(adminActor, "register_payment", "payment", paymentId, `order:${orderId};amount:${amount}`);
      return sendJson(response, 201, { id: paymentId, orderId, amount, status: "pending" });
    }

    match = url.pathname.match(/^\/api\/admin\/payments\/(\d+)\/(verify|reject|void)$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const paymentId = Number(match[1]);
      const action = match[2];
      const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
      if (!payment) return sendJson(response, 404, { message: "付款记录不存在" });
      const reason = String(input.reason || "").trim().slice(0, 300);
      if (["reject", "void"].includes(action) && !reason) return sendJson(response, 422, { message: "驳回或作废必须填写原因" });
      if (action === "verify" && payment.status !== "pending") return sendJson(response, 409, { message: "只有待核验收款可以确认到账" });
      if (action === "reject" && payment.status !== "pending") return sendJson(response, 409, { message: "只有待核验收款可以驳回" });
      if (action === "void" && payment.status !== "verified") return sendJson(response, 409, { message: "只有已核验收款可以作废" });
      const timestamp = now().toISOString();
      const status = action === "verify" ? "verified" : action === "reject" ? "rejected" : "voided";
      const result = inTransaction(() => {
        db.prepare("UPDATE payments SET status = ?, verified_by = ?, verified_at = ?, review_reason = ? WHERE id = ?")
          .run(status, adminActor.name, timestamp, reason, paymentId);
        const summary = refreshOrderPayment(payment.order_id);
        if (action === "verify") {
          db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, ?, ?, ?)")
            .run(payment.order_id, summary.verifiedAmount >= summary.startAmount ? "awaiting_schedule" : "awaiting_payment", `已核验到账 ¥${Number(payment.amount).toFixed(2)}`, timestamp);
        }
        audit(adminActor, `${action}_payment`, "payment", paymentId, reason || `order:${payment.order_id}`);
        const bobo = action === "verify" ? autoQueueBoboSync(payment.order_id, adminActor, paymentId) : null;
        return { summary, bobo };
      });
      const order = db.prepare("SELECT status, payment_status FROM orders WHERE id = ?").get(payment.order_id);
      return sendJson(response, 200, { id: paymentId, status, orderStatus: order.status, paymentStatus: order.payment_status, summary: result.summary, boboSyncStatus: result.bobo?.status || db.prepare("SELECT bobo_sync_status FROM orders WHERE id = ?").get(payment.order_id).bobo_sync_status, boboAutoSubmitted: Boolean(result.bobo?.submitted) });
    }

    match = url.pathname.match(/^\/api\/admin\/payments\/(\d+)\/receipt$/);
    if (request.method === "POST" && match) {
      const payment = db.prepare(`SELECT payments.*, orders.order_number
        FROM payments JOIN orders ON orders.id = payments.order_id WHERE payments.id = ?`).get(Number(match[1]));
      if (!payment) return sendJson(response, 404, { message: "付款记录不存在" });
      if (payment.status !== "verified") return sendJson(response, 409, { message: "只有已确认到账的付款可以生成收据" });
      const existing = db.prepare("SELECT * FROM payment_receipts WHERE payment_id = ?").get(payment.id);
      const view = (row) => ({
        receiptNumber: row.receipt_number,
        companyName: row.company_name,
        orderNumber: row.order_number,
        payerName: row.payer_name,
        amount: row.amount,
        paymentMethod: row.payment_method,
        receivedAt: row.received_at,
        purpose: row.purpose,
        verifiedBy: row.verified_by,
        status: row.status,
        createdAt: row.created_at
      });
      if (existing) return sendJson(response, 200, view(existing));
      const createdAt = now().toISOString();
      const receiptNumber = nextNumber(db, "payment_receipts", "receipt_number", "SJ", now());
      db.prepare(`INSERT INTO payment_receipts
        (payment_id, receipt_number, company_name, order_number, payer_name, amount, payment_method, received_at, purpose, verified_by, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
        .run(payment.id, receiptNumber, "宁波未来机械制造有限公司", payment.order_number, payment.payer_name, payment.amount, payment.payment_method, payment.received_at, "非标钣金加工款", payment.verified_by, createdAt);
      audit(adminActor, "create_payment_receipt", "payment", payment.id, receiptNumber);
      return sendJson(response, 201, view(db.prepare("SELECT * FROM payment_receipts WHERE payment_id = ?").get(payment.id)));
    }

    match = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/events$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const orderId = Number(match[1]);
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      if (!input.status || !input.title) return sendJson(response, 422, { message: "状态和公开说明必填" });
      if (adminActor.csrfHash && !String(input.reason || "").trim()) return sendJson(response, 422, { message: "人工覆盖必须填写异常原因" });
      const titleProblem = validatePublicEventTitle(input.title);
      if (titleProblem) return sendJson(response, 422, { message: titleProblem });
      if (!PUBLIC_STATUS_DICTIONARY.order.includes(input.status)) return sendJson(response, 422, { message: "公开状态不支持" });
      const summary = paymentSummary(orderId);
      if (["production", "quality", "ready", "shipped", "completed"].includes(input.status) && !canEnterProduction({ verifiedAmount: summary.verifiedAmount, startAmount: summary.startAmount })) return sendJson(response, 409, { message: "未达到约定开工款，不得进入生产" });
      if (["shipped", "completed"].includes(input.status) && !canShip({ verifiedAmount: summary.verifiedAmount, totalAmount: summary.totalAmount })) return sendJson(response, 409, { message: "尾款未付清，不得发货或完成订单" });
      const occurredAt = now().toISOString();
      db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, ?, ?, ?)").run(orderId, input.status, input.title, occurredAt);
      db.prepare("UPDATE orders SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END WHERE id = ?").run(input.status, input.status, occurredAt, orderId);
      audit(adminActor, "manual_progress_override", "order", orderId, `${input.status}:${String(input.reason || "legacy override").trim()}`);
      if (order.customer_id) await queueNotification(order.customer_id, "order_status_changed", "order", orderId, { orderNumber: order.order_number, status: input.status, title: input.title, occurredAt });
      return sendJson(response, 201, { status: input.status, title: input.title, occurredAt });
    }

    match = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/bobo-confirm$/);
    if (request.method === "POST" && match) {
      const orderId = Number(match[1]);
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      const summary = paymentSummary(orderId);
      if (!canEnterProduction({ verifiedAmount: summary.verifiedAmount, startAmount: summary.startAmount })) return sendJson(response, 409, { message: "未达到约定开工款，不能同步波波工单" });
      let job = db.prepare("SELECT status FROM bobo_sync_jobs WHERE order_id = ?").get(orderId);
      const timestamp = now().toISOString();
      if (!job) {
        db.prepare("INSERT INTO bobo_sync_jobs (order_id, status, next_attempt_at, created_at, updated_at) VALUES (?, 'awaiting_confirmation', ?, ?, ?)").run(orderId, timestamp, timestamp, timestamp);
        job = { status: "awaiting_confirmation" };
      }
      if (job.status !== "awaiting_confirmation") return sendJson(response, 200, { status: job.status });
      db.prepare("UPDATE bobo_sync_jobs SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE order_id = ?").run(timestamp, timestamp, orderId);
      db.prepare("UPDATE orders SET bobo_sync_status = 'pending' WHERE id = ?").run(orderId);
      audit(adminActor, "confirm_bobo_sync", "order", orderId);
      return sendJson(response, 202, { status: "pending" });
    }

    match = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/bobo-retry$/);
    if (request.method === "POST" && match) {
      const orderId = Number(match[1]);
      const job = db.prepare("SELECT status FROM bobo_sync_jobs WHERE order_id = ?").get(orderId);
      if (!job) return sendJson(response, 404, { message: "同步任务不存在" });
      if (!["retrying", "failed"].includes(job.status)) return sendJson(response, 409, { message: "当前同步任务状态不允许重试" });
      const timestamp = now().toISOString();
      const result = db.prepare("UPDATE bobo_sync_jobs SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE order_id = ?").run(timestamp, timestamp, orderId);
      db.prepare("UPDATE orders SET bobo_sync_status = 'pending' WHERE id = ?").run(orderId);
      audit(adminActor, "retry_bobo_sync", "order", orderId);
      return sendJson(response, 202, { queued: true });
    }

    match = url.pathname.match(/^\/api\/admin\/notification-jobs\/(\d+)\/retry$/);
    if (request.method === "POST" && match) {
      await readJson(request);
      const job = db.prepare("SELECT * FROM notification_jobs WHERE id = ?").get(Number(match[1]));
      if (!job) return sendJson(response, 404, { message: "通知任务不存在" });
      if (job.status === "sent") return sendJson(response, 200, { id: job.id, status: "sent" });
      db.prepare("UPDATE notification_jobs SET status = 'queued', updated_at = ? WHERE id = ?").run(now().toISOString(), job.id);
      const delivered = await deliverNotification(job.id);
      audit(adminActor, "retry_notification", "notification_job", job.id);
      return sendJson(response, 200, { id: delivered.id, status: delivered.status, attempts: delivered.attempts });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/audit-logs") {
      return sendJson(response, 200, db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200").all());
    }

    return false;
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const handled = await handleApi(request, response, url);
      if (handled !== false) return;
      const legacyRedirects = { "/list_139/": "/#cases", "/list_140/": "/#news", "/list_140/764.html": "/#news" };
      if (request.method === "GET" && legacyRedirects[url.pathname]) {
        response.writeHead(301, { location: legacyRedirects[url.pathname] });
        return response.end();
      }
      if (request.method === "GET" && serveStatic(request, response, url.pathname)) return;
      sendJson(response, 404, { message: "接口不存在" });
    } catch (error) {
      sendJson(response, error.status || 500, { message: error.status ? error.message : "服务器处理失败" });
    }
  });

  return { server, database: db, processBoboJobs, close: () => db.close() };
}

if (require.main === module) {
  const app = createApplication();
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, host, () => console.log(`Future Machinery website: http://${host}:${port}`));
  if (process.env.BOBO_BASE_URL && process.env.BOBO_INTEGRATION_SECRET) setInterval(() => app.processBoboJobs().catch((error) => console.error("bobo sync failed", error)), 15000).unref();
}

module.exports = { createApplication };
