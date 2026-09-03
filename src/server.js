const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { nextNumber, openDatabase } = require("./database");
const { ALLOWED_EXTENSIONS, MAX_ATTACHMENT_SIZE, actualAttachmentSize, canConfirmPayment, canEnterProduction, normalizePhone, publicOrder, PUBLIC_STATUS_DICTIONARY, validateInquiry, validatePublicEventTitle } = require("./domain");

const MAX_BODY_SIZE = 43 * 1024 * 1024;
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

function isAdmin(request, token) {
  return token && request.headers.authorization === `Bearer ${token}`;
}

function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const isImage = /^assets\/images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(requested);
  const isBrandAsset = /^assets\/brand\/[a-z0-9-]+\.(svg|png)$/.test(requested);
  const isVideo = /^assets\/video\/[a-z0-9-]+\.mp4$/.test(requested);
  const isPage = /^(?:[a-z0-9-]+|news\/[a-z0-9-]+)\.html$/.test(requested);
  const isAsset = new Set(["styles.css", "app.js", "admin.js", "robots.txt", "sitemap.xml"]).has(requested);
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
  const now = options.now || (() => new Date());
  const notify = options.notify;
  const enableWechatMock = options.enableWechatMock === true || process.env.ENABLE_WECHAT_MOCK === "1";
  const enablePhoneMock = options.enablePhoneMock === true || process.env.ENABLE_PHONE_MOCK === "1";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(dbPath);

  function audit(operator, action, entityType, entityId, detail = "") {
    db.prepare("INSERT INTO audit_logs (operator, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(operator, action, entityType, entityId, detail, now().toISOString());
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
      await notify({ id: job.id, customerId: job.customer_id, eventType: job.event_type, entityType: job.entity_type, entityId: job.entity_id, payload: JSON.parse(job.payload) });
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
    const grant = db.prepare("SELECT enabled FROM subscription_grants WHERE customer_id = ?").get(customerId);
    if (!grant || !grant.enabled) return null;
    const timestamp = now().toISOString();
    const result = db.prepare(`INSERT OR IGNORE INTO notification_jobs
      (customer_id, event_type, entity_type, entity_id, dedupe_key, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
      .run(customerId, eventType, entityType, entityId, `${eventType}:${customerId}:${entityType}:${entityId}:${String(payload.status || "")}`, JSON.stringify(payload), timestamp, timestamp);
    if (!result.changes) return null;
    return deliverNotification(Number(result.lastInsertRowid));
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
      quantity: row.quantity,
      expectedDate: row.expected_date,
      description: row.description,
      material: row.material,
      dimensions: row.dimensions,
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
      quantity: row.quantity,
      expectedDate: row.expected_date,
      description: row.description,
      material: row.material,
      dimensions: row.dimensions,
      source: row.source,
      state: row.lifecycle_state,
      status: row.status,
      createdAt: row.created_at
    };
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok", service: "future-machinery-website" });
    }

    if (request.method === "GET" && url.pathname === "/api/status-dictionary") {
      return sendJson(response, 200, PUBLIC_STATUS_DICTIONARY);
    }

    if (request.method === "GET" && url.pathname === "/api/integrations/bobo/health") {
      return sendJson(response, 200, { enabled: false, statusMapping: { production: "production", quality: "quality", ready: "ready", completed: "completed" } });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/wechat/login") {
      const input = await readJson(request);
      const code = String(input.code || "");
      if (!code.startsWith("mock:") || !code.slice(5).trim()) return sendJson(response, 501, { message: "未配置微信验证提供商" });
      if (!enableWechatMock) return sendJson(response, 501, { message: "未配置微信验证提供商，mock 登录未启用" });
      const openid = code.slice(5).trim();
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
      const phone = normalizePhone(input.phone);
      if (!/^1\d{10}$/.test(phone)) return sendJson(response, 422, { field: "phone", message: "请输入正确的11位手机号" });
      if (!enablePhoneMock) return sendJson(response, 501, { message: "未配置手机号验证提供商" });
      if (input.verificationProof !== `mock:${phone}`) return sendJson(response, 422, { field: "verificationProof", message: "手机号验证凭证无效" });
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
      const enabled = input.enabled !== false ? 1 : 0;
      db.prepare(`INSERT INTO subscription_grants (customer_id, enabled, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(customer_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`)
        .run(customer.id, enabled, now().toISOString());
      audit(`customer:${customer.id}`, "subscription", "customer", customer.id, String(Boolean(enabled)));
      return sendJson(response, 200, { enabled: Boolean(enabled) });
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
        (inquiry_number, drawing_mode, contact_name, phone, region, quantity, expected_date, description, material, dimensions, source, customer_id, lifecycle_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'miniprogram', ?, ?, ?)`)
        .run(inquiryNumber, payload.drawingMode, payload.contactName.trim(), customer.phone, payload.region.trim(), Number(payload.quantity), payload.expectedDate, payload.description.trim(), String(payload.material || "").trim(), String(payload.dimensions || "").trim(), customer.id, state, createdAt);
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
      const rows = db.prepare("SELECT * FROM inquiries WHERE customer_id = ? OR phone = ? ORDER BY id DESC").all(customer.id, customer.phone);
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
      db.prepare(`UPDATE inquiries SET drawing_mode = ?, contact_name = ?, region = ?, quantity = ?, expected_date = ?, description = ?, material = ?, dimensions = ?, lifecycle_state = ? WHERE id = ?`)
        .run(payload.drawingMode, payload.contactName.trim(), payload.region.trim(), Number(payload.quantity), payload.expectedDate, payload.description.trim(), String(payload.material || "").trim(), String(payload.dimensions || "").trim(), state, inquiry.id);
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
      const rows = db.prepare("SELECT * FROM orders WHERE customer_id = ? OR phone = ? ORDER BY id DESC").all(customer.id, customer.phone);
      return sendJson(response, 200, rows.map((row) => ({ id: row.id, ...publicOrder({ orderNumber: row.order_number, contactName: row.contact_name, status: row.status }) })));
    }

    customerMatch = url.pathname.match(/^\/api\/customer\/orders\/(\d+)$/);
    if (request.method === "GET" && customerMatch) {
      const customer = sessionCustomer(request);
      if (!isBoundCustomer(customer)) return sendJson(response, 401, { message: "请先登录并绑定手机号" });
      const order = db.prepare("SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR phone = ?)").get(Number(customerMatch[1]), customer.id, customer.phone);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      const events = db.prepare("SELECT status, title, occurred_at AS occurredAt FROM order_events WHERE order_id = ? ORDER BY id").all(order.id);
      return sendJson(response, 200, publicOrder({ orderNumber: order.order_number, contactName: order.contact_name, status: order.status, events }));
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
        (inquiry_number, drawing_mode, contact_name, phone, region, quantity, expected_date, description, material, dimensions, source, lifecycle_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`)
        .run(inquiryNumber, input.drawingMode, input.contactName.trim(), phone, input.region.trim(), Number(input.quantity), input.expectedDate, input.description.trim(), String(input.material || "").trim(), String(input.dimensions || "").trim(), source, createdAt);
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
      return sendJson(response, 200, publicOrder({
        orderNumber: row.order_number,
        contactName: row.contact_name,
        status: row.status,
        events
      }));
    }

    if (url.pathname.startsWith("/api/admin/") && !isAdmin(request, adminToken)) {
      return sendJson(response, 401, { message: "后台认证失败" });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/inquiries") {
      const rows = db.prepare("SELECT * FROM inquiries ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map(inquiryView));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/orders") {
      const rows = db.prepare("SELECT id, order_number, contact_name, phone, status, payment_status, created_at FROM orders ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        contactName: row.contact_name,
        phone: row.phone,
        status: row.status,
        paymentStatus: row.payment_status,
        createdAt: row.created_at
      })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/customers") {
      const rows = db.prepare("SELECT id, contact_name, phone, created_at FROM customers ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map((row) => ({ id: row.id, contactName: row.contact_name, phone: row.phone, createdAt: row.created_at })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/notification-jobs") {
      const rows = db.prepare("SELECT id, customer_id, event_type, entity_type, entity_id, status, attempts, last_error, created_at, updated_at FROM notification_jobs ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map((row) => ({ id: row.id, customerId: row.customer_id, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, status: row.status, attempts: row.attempts, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at })));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/todos") {
      const rows = db.prepare("SELECT id, type, entity_type, entity_id, detail, status, created_at, resolved_at FROM admin_todos WHERE status = 'open' ORDER BY id DESC").all();
      return sendJson(response, 200, rows.map((row) => ({ id: row.id, type: row.type, entityType: row.entity_type, entityId: row.entity_id, detail: row.detail, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at })));
    }

    let match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/claim$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const row = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(Number(match[1]));
      if (!row) return sendJson(response, 404, { message: "需求不存在" });
      const claimedAt = now().toISOString();
      db.prepare("UPDATE inquiries SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?")
        .run(input.operator || "客服", claimedAt, row.id);
      audit(input.operator || "客服", "claim", "inquiry", row.id);
      return sendJson(response, 200, inquiryView({ ...row, status: "claimed", claimed_by: input.operator || "客服", claimed_at: claimedAt }));
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
      audit(input.operator || "客服", "link_customer", "inquiry", inquiry.id, String(customer.id));
      return sendJson(response, 200, { inquiryId: inquiry.id, customerId: customer.id });
    }

    match = url.pathname.match(/^\/api\/admin\/inquiries\/(\d+)\/quotes$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const inquiryId = Number(match[1]);
      const inquiry = db.prepare("SELECT id FROM inquiries WHERE id = ?").get(inquiryId);
      if (!inquiry) return sendJson(response, 404, { message: "需求不存在" });
      if (!(Number(input.amount) > 0) || !input.validUntil) return sendJson(response, 422, { message: "报价金额和有效期必填" });
      const last = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM quotes WHERE inquiry_id = ?").get(inquiryId);
      const version = Number(last.version) + 1;
      const status = input.confirmed ? "confirmed" : "draft";
      const result = db.prepare("INSERT INTO quotes (inquiry_id, version, amount, valid_until, status, operator, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(inquiryId, version, Number(input.amount), input.validUntil, status, input.operator || "客服", now().toISOString());
      audit(input.operator || "客服", "create_quote", "quote", Number(result.lastInsertRowid), `v${version}`);
      return sendJson(response, 201, { id: Number(result.lastInsertRowid), version, status });
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
      if (customer && !inquiry.customer_id) db.prepare("UPDATE inquiries SET customer_id = ? WHERE id = ?").run(customer.id, inquiryId);
      const orderNumber = nextNumber(db, "orders", "order_number", "WL", now());
      const createdAt = now().toISOString();
      const result = db.prepare("INSERT INTO orders (inquiry_id, order_number, contact_name, phone, status, payment_status, total_amount, customer_id, created_at) VALUES (?, ?, ?, ?, 'paid', 'paid', ?, ?, ?)")
        .run(inquiryId, orderNumber, inquiry.contact_name, inquiry.phone, quote.amount, customer ? customer.id : null, createdAt);
      const orderId = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, 'paid', '已确认全额付款', ?)").run(orderId, createdAt);
      db.prepare("UPDATE inquiries SET status = 'ordered' WHERE id = ?").run(inquiryId);
      audit(input.operator || "财务", "confirm_payment", "order", orderId);
      if (customer) await queueNotification(customer.id, "payment_confirmed", "order", orderId, { orderNumber });
      return sendJson(response, 201, { id: orderId, orderNumber, status: "paid" });
    }

    match = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/events$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      const orderId = Number(match[1]);
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) return sendJson(response, 404, { message: "订单不存在" });
      if (!input.status || !input.title) return sendJson(response, 422, { message: "状态和公开说明必填" });
      const titleProblem = validatePublicEventTitle(input.title);
      if (titleProblem) return sendJson(response, 422, { message: titleProblem });
      if (!PUBLIC_STATUS_DICTIONARY.order.includes(input.status)) return sendJson(response, 422, { message: "公开状态不支持" });
      if (["production", "quality", "ready", "completed"].includes(input.status) && !canEnterProduction({ paymentStatus: order.payment_status, status: order.status })) {
        return sendJson(response, 409, { message: "未确认付款不得进入生产" });
      }
      const occurredAt = now().toISOString();
      db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, ?, ?, ?)").run(orderId, input.status, input.title, occurredAt);
      db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(input.status, orderId);
      audit(input.operator || "客服", "add_public_event", "order", orderId, input.status);
      if (order.customer_id) await queueNotification(order.customer_id, "order_status_changed", "order", orderId, { orderNumber: order.order_number, status: input.status });
      return sendJson(response, 201, { status: input.status, title: input.title, occurredAt });
    }

    match = url.pathname.match(/^\/api\/admin\/notification-jobs\/(\d+)\/retry$/);
    if (request.method === "POST" && match) {
      await readJson(request);
      const job = db.prepare("SELECT * FROM notification_jobs WHERE id = ?").get(Number(match[1]));
      if (!job) return sendJson(response, 404, { message: "通知任务不存在" });
      if (job.status === "sent") return sendJson(response, 200, { id: job.id, status: "sent" });
      db.prepare("UPDATE notification_jobs SET status = 'queued', updated_at = ? WHERE id = ?").run(now().toISOString(), job.id);
      const delivered = await deliverNotification(job.id);
      audit("admin", "retry_notification", "notification_job", job.id);
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

  return { server, close: () => db.close() };
}

if (require.main === module) {
  const app = createApplication();
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, host, () => console.log(`Future Machinery website: http://${host}:${port}`));
}

module.exports = { createApplication };
