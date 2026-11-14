const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { AsyncLocalStorage } = require("async_hooks");
const { weappImageType } = require("./lib/weapp-image");
const { readRawBody, parseBody } = require("./lib/request-body");
const { normalizeUnitPrice, calculateOrderTotal, identifyFinancialAccessUsers, financialAccessUserIds, createSerialQueue, hasOrderNumberConflict, normalizeOrderNumber } = require("./lib/order-financials");
function auditValues(item) { return require("./lib/audit-store").auditValues(item); }

const LOCAL_CONFIG_FILE = path.join(__dirname, "config.local.json");
if (fs.existsSync(LOCAL_CONFIG_FILE)) {
  const localConfig = JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, "utf8"));
  const localEnvironment = localConfig.serverEnvironment;
  if (localEnvironment && typeof localEnvironment === "object" && !Array.isArray(localEnvironment)) {
    for (const [name, value] of Object.entries(localEnvironment)) {
      if (value === null || value === undefined || String(process.env[name] || "").trim()) continue;
      process.env[name] = String(value).trim();
    }
  }
}

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(PUBLIC, "uploads");
const DRAWING_DIR = path.join(UPLOAD_DIR, "drawings");
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, "thumbnails");
const CAD_PREVIEW_DIR = path.join(UPLOAD_DIR, "previews");
const CAD_PREVIEW_COMMAND = String(process.env.CAD_PREVIEW_COMMAND || "dwg2SVG").trim();
const WEAPP_CODE_CACHE_DIR = path.resolve(
  process.env.WEAPP_CODE_CACHE_DIR || path.join(DATA_DIR, "weapp-code-cache")
);
const QR_BASE_URL = process.env.QR_BASE_URL || `http://localhost:${PORT}`;
const WX_APPID = String(process.env.WX_APPID || "").trim();
const WX_APP_SECRET = String(process.env.WX_APP_SECRET || "").trim();
const WX_CODE_ENV_VERSION = ["develop", "trial", "release"].includes(process.env.WX_CODE_ENV_VERSION)
  ? process.env.WX_CODE_ENV_VERSION
  : "trial";
const WECHAT_API_BASE_URL = String(process.env.WECHAT_API_BASE_URL || "https://api.weixin.qq.com").replace(/\/$/, "");
const DB_DRIVER = String(process.env.DB_DRIVER || "json").trim().toLowerCase();
const ROW_RELEASE = DB_DRIVER === "mysql_rows" && process.env.BOBO_ROW_RELEASE === "1";
const FUTURE_WEBHOOK_URL = String(process.env.FUTURE_WEBHOOK_URL || "").trim();
const BOBO_INTEGRATION_SECRET = String(process.env.BOBO_INTEGRATION_SECRET || "").trim();
const PLATFORM_SOURCE_CHANNELS = new Set(["website", "order_platform", "miniprogram"]);
const MYSQL_STATE_KEY = "main";
const ULTIMATE_WORK_ORDER_ADMIN_PHONE = "15257457485";
const RESTRICTED_VIEW_PHONES = new Set([
  "13456125046",
  "13757433269",
  "13777234068",
  "15257457485",
  "15728038503",
]);
const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TV_VIEW_TOKEN_SECRET = String(process.env.TV_VIEW_TOKEN_SECRET || WX_APP_SECRET).trim()
  || crypto.randomBytes(32).toString("hex");
const TV_VIEW_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const TV_DASHBOARD_CACHE_TTL_MS = 15 * 1000;
let wechatAccessTokenCache = { value: "", expiresAt: 0 };
let wechatAccessTokenPromise = null;
const weappCodePromises = new Map();
let mysqlPool = null;
const rowTrialContext = new AsyncLocalStorage();
const WEAPP_QR_ROUTE = /^\/api\/qr\/route\/([^/]+)\/weapp\.png$/;
let databaseRevision = 0;
let tvDatabaseCache = { value: null, expiresAt: 0 };
const tvDashboardCache = new Map();
const defaultSettings = {
  tvCarouselEnabled: true,
  tvCarouselSeconds: 120,
  tvDisplayRatio: "auto",
};

const roles = {
  owner: "老板",
  manager: "生产主管",
  office: "办公室/跟单",
  worker: "车间工人",
  design_worker: "设计师",
  laser_worker: "激光师傅",
  bend_worker: "折弯师傅",
  rivet_worker: "压铆师傅",
  tap_worker: "攻丝师傅",
  polish_worker: "打磨师傅",
  weld_worker: "焊接师傅",
  machining_worker: "机加师傅",
  powder_worker: "喷塑师傅",
  assembly_worker: "装配师傅",
  quality: "质检",
  driver: "司机",
  admin: "管理员",
};

const defaultProcesses = ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "机加", "打磨", "喷塑", "装配", "质检"];
const processAliases = {
  图纸设计: "设计",
  打孔攻丝: "攻丝",
  组装: "装配",
};
const processRoleMap = {
  设计: "design_worker",
  激光: "laser_worker",
  切管: "laser_worker",
  折弯: "bend_worker",
  压铆: "rivet_worker",
  攻丝: "tap_worker",
  焊接: "weld_worker",
  机加: "machining_worker",
  打磨: "polish_worker",
  喷塑: "powder_worker",
  装配: "assembly_worker",
  质检: "quality",
};
const rolePriority = {
  admin: 100,
  owner: 90,
  manager: 80,
  office: 70,
  quality: 30,
  driver: 40,
  design_worker: 20,
  laser_worker: 20,
  bend_worker: 20,
  rivet_worker: 20,
  tap_worker: 20,
  weld_worker: 20,
  machining_worker: 20,
  polish_worker: 20,
  powder_worker: 20,
  assembly_worker: 20,
  worker: 10,
};

function normalizeProcessName(name) {
  const text = String(name || "").trim();
  return processAliases[text] || text;
}

function normalizeRoles(values) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.filter((role) => Object.prototype.hasOwnProperty.call(roles, role)))];
}

function getUserRoles(user) {
  if (!user) return [];
  return normalizeRoles([...(Array.isArray(user.roles) ? user.roles : []), user.role]);
}

function getPrimaryRole(user) {
  return getUserRoles(user).sort((a, b) => (rolePriority[b] || 0) - (rolePriority[a] || 0))[0] || "worker";
}

function primaryRoleFromRoles(userRoles) {
  return normalizeRoles(userRoles).sort((a, b) => (rolePriority[b] || 0) - (rolePriority[a] || 0))[0] || "worker";
}

function getProcessRole(processName) {
  return processRoleMap[normalizeProcessName(processName)] || "";
}

function processOrderIndex(processName) {
  const index = defaultProcesses.indexOf(normalizeProcessName(processName));
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function userHasRole(user, role) {
  return getUserRoles(user).includes(role);
}

function normalizeTargetFinishTime(value) {
  const text = String(value || "").trim().replaceAll("/", "-").replace(" ", "T");
  if (!text) return "";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2})(?::\d{2})?$/);
  if (!match) return "";
  const date = normalizeDate(`${match[1]}-${match[2]}-${match[3]}`);
  const hour = Number(match[4]);
  if (!date || hour < 0 || hour > 23) return "";
  return `${date}T${String(hour).padStart(2, "0")}:00`;
}

function normalizePlanDate(value) {
  const text = String(value || "").trim().replaceAll("/", "-");
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? normalizeDate(text) : "";
}

function normalizeRouteSchedule(startValue, endValue) {
  const plannedStartDate = normalizePlanDate(startValue);
  const plannedEndDate = normalizePlanDate(endValue);
  if ((startValue && !plannedStartDate) || (endValue && !plannedEndDate)) return { error: "计划日期格式不正确" };
  if (plannedStartDate && plannedEndDate && plannedStartDate > plannedEndDate) return { error: "计划开始日不能晚于结束日" };
  return { plannedStartDate, plannedEndDate };
}

function reportSchedule(route, createdAt) {
  const reportDate = shanghaiDateKey(createdAt);
  const plannedStartDate = route.plannedStartDate || "";
  const plannedEndDate = route.plannedEndDate || "";
  if (!plannedStartDate || !plannedEndDate) {
    return { reportDate, plannedStartDate, plannedEndDate, scheduleStatus: "unplanned", scheduleReason: "未设置完整计划区间" };
  }
  if (reportDate < plannedStartDate) {
    return { reportDate, plannedStartDate, plannedEndDate, scheduleStatus: "early", scheduleReason: "早于计划开始日" };
  }
  if (reportDate > plannedEndDate) {
    return { reportDate, plannedStartDate, plannedEndDate, scheduleStatus: "outside_plan", scheduleReason: "晚于计划结束日" };
  }
  return { reportDate, plannedStartDate, plannedEndDate, scheduleStatus: "on_time", scheduleReason: "" };
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function qrToken(prefix = "qt") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function weappCodeCachePath(route) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${route.id}:${route.qrToken}:${WX_CODE_ENV_VERSION}`)
    .digest("hex")
    .slice(0, 20);
  return path.join(WEAPP_CODE_CACHE_DIR, `${fingerprint}.png`);
}

async function readJsonResponse(response, action) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${action}返回了无法识别的数据`);
  }
  if (!response.ok || data.errcode) {
    throw new Error(`${action}失败：${data.errmsg || data.errcode || response.status}`);
  }
  return data;
}

async function getWechatAccessToken(forceRefresh = false) {
  if (!WX_APPID || !WX_APP_SECRET) {
    throw new Error("服务器尚未配置 WX_APPID 和 WX_APP_SECRET");
  }
  if (!forceRefresh && wechatAccessTokenCache.value && wechatAccessTokenCache.expiresAt > Date.now()) {
    return wechatAccessTokenCache.value;
  }
  if (!forceRefresh && wechatAccessTokenPromise) return wechatAccessTokenPromise;

  const requestPromise = (async () => {
    const response = await fetch(`${WECHAT_API_BASE_URL}/cgi-bin/stable_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: WX_APPID,
        secret: WX_APP_SECRET,
        force_refresh: forceRefresh,
      }),
    });
    const data = await readJsonResponse(response, "获取微信访问令牌");
    if (!data.access_token) throw new Error("微信接口未返回访问令牌");
    const expiresIn = Math.max(300, Number(data.expires_in || 7200));
    wechatAccessTokenCache = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, expiresIn - 300) * 1000,
    };
    return data.access_token;
  })();

  wechatAccessTokenPromise = requestPromise;
  try {
    return await requestPromise;
  } finally {
    if (wechatAccessTokenPromise === requestPromise) wechatAccessTokenPromise = null;
  }
}

async function requestWeappCode(route, retry = true) {
  if (!route.qrToken || Buffer.byteLength(route.qrToken, "utf8") > 32) {
    throw new Error("工序二维码参数无效或超过微信 scene 的 32 字节限制");
  }
  const accessToken = await getWechatAccessToken(false);
  const response = await fetch(`${WECHAT_API_BASE_URL}/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene: route.qrToken,
      page: "pages/report/report",
      check_path: false,
      env_version: WX_CODE_ENV_VERSION,
      width: 430,
      auto_color: false,
      line_color: { r: 21, g: 111, b: 98 },
      is_hyaline: false,
    }),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = weappImageType(bytes);
  if (response.ok && contentType) return { bytes, contentType };

  let errorData = {};
  try {
    errorData = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`生成微信小程序码失败：HTTP ${response.status}`);
  }
  if (retry && [40001, 40014, 42001].includes(Number(errorData.errcode))) {
    wechatAccessTokenCache = { value: "", expiresAt: 0 };
    await getWechatAccessToken(true);
    return requestWeappCode(route, false);
  }
  throw new Error(`生成微信小程序码失败：${errorData.errmsg || errorData.errcode || response.status}`);
}

async function getWeappCode(route) {
  fs.mkdirSync(WEAPP_CODE_CACHE_DIR, { recursive: true });
  const cacheFile = weappCodeCachePath(route);
  if (fs.existsSync(cacheFile)) {
    const bytes = fs.readFileSync(cacheFile);
    return { bytes, contentType: weappImageType(bytes) || "image/png" };
  }
  if (weappCodePromises.has(cacheFile)) return weappCodePromises.get(cacheFile);

  const requestPromise = (async () => {
    const image = await requestWeappCode(route);
    fs.writeFileSync(cacheFile, image.bytes);
    return image;
  })();
  weappCodePromises.set(cacheFile, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (weappCodePromises.get(cacheFile) === requestPromise) weappCodePromises.delete(cacheFile);
  }
}

function today(offset = 0) {
  return shanghaiDateKey(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
}

function normalizeDate(value) {
  const text = String(value || "").trim().replaceAll("/", "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
}

function normalizeWeightKg(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { value: null };
  const weightKg = Number(value);
  if (!Number.isInteger(weightKg) || weightKg < 0) return { error: "重量必须是大于或等于 0 的整数 KG" };
  return { value: weightKg };
}

function normalizeQuantityUnit(value) {
  const unit = String(value || "").trim();
  return unit === "套" ? "套" : "件";
}

function isValidQuantityUnit(value) {
  return value === undefined || value === null || String(value).trim() === "" || ["件", "套"].includes(String(value).trim());
}

function createMysqlPool() {
  if (mysqlPool) return mysqlPool;
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    throw new Error("当前 DB_DRIVER=mysql，但未安装 mysql2。请先执行 npm install。");
  }
  const database = String(process.env.MYSQL_DATABASE || "").trim();
  const user = String(process.env.MYSQL_USER || "").trim();
  if (!database || !user) throw new Error("MySQL 模式必须配置 MYSQL_DATABASE 和 MYSQL_USER");
  mysqlPool = mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 5),
    charset: "utf8mb4",
  });
  return mysqlPool;
}

async function ensureMysqlStateTable() {
  const pool = createMysqlPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS app_state (
      name VARCHAR(80) PRIMARY KEY,
      value_json JSON NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
}

async function ensureMysqlAuditTable() {
  const pool = createMysqlPool();
  const { CREATE_AUDIT_TABLE } = require('./lib/audit-store');
  await pool.execute(CREATE_AUDIT_TABLE);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS bobo_schema_migrations (
      name VARCHAR(120) PRIMARY KEY,
      applied_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const database = String(process.env.MYSQL_DATABASE || "").trim();
  const [payloadColumns] = await pool.execute(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'bobo_audit_logs_v2' AND column_name = 'payload'",
    [database]
  );
  if (!payloadColumns.length) throw new Error("审计目标表缺少原始记录列，迁移已停止");
  const indexes = [
    ["idx_audit_created", "created_at"],
    ["idx_audit_actor_created", "actor_id, created_at"],
    ["idx_audit_action_created", "action, created_at"],
  ];
  for (const [name, columns] of indexes) {
    const [rows] = await pool.execute(
      "SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'bobo_audit_logs_v2' AND index_name = ? LIMIT 1",
      [database, name]
    );
    if (!rows.length) await pool.query(`ALTER TABLE bobo_audit_logs_v2 ADD INDEX ${name} (${columns})`);
  }
}

async function moveAuditLogsOutOfState() {
  const pool = createMysqlPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [migrationRows] = await connection.execute(
      "SELECT name FROM bobo_schema_migrations WHERE name = ?",
      ["audit_logs_out_of_app_state_v1"]
    );
    if (migrationRows.length) {
      await connection.commit();
      return;
    }
    const [[existingAudit]] = await connection.execute("SELECT COUNT(*) AS total FROM bobo_audit_logs_v2");
    if (Number(existingAudit.total) !== 0) throw new Error("审计目标表已有数据但缺少迁移标记，迁移已停止");
    const [rows] = await connection.execute(
      "SELECT value_json FROM app_state WHERE name = ? FOR UPDATE",
      [MYSQL_STATE_KEY]
    );
    if (!rows.length) {
      await connection.execute(
        "INSERT INTO bobo_schema_migrations (name, applied_at) VALUES (?, NOW())",
        ["audit_logs_out_of_app_state_v1"]
      );
      await connection.commit();
      return;
    }
    const state = typeof rows[0].value_json === "string" ? JSON.parse(rows[0].value_json) : rows[0].value_json;
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    if (state.auditLogs != null && !Array.isArray(state.auditLogs)) {
      throw new Error("审计日志格式无效，迁移已停止，请先核对原始备份");
    }
    const auditLogs = state.auditLogs || [];
    const ids = new Set();
    for (const item of auditLogs) {
      if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) {
        throw new Error("审计日志存在无效或重复 ID、无效时间，迁移已停止，请先核对原始备份");
      }
      auditValues(item);
      ids.add(item.id);
    }
    const logs = auditLogs.filter((item) => new Date(item.createdAt).getTime() >= cutoff);
    for (let offset = 0; offset < logs.length; offset += 250) {
      const batch = logs.slice(offset, offset + 250);
      const values = batch.map(auditValues);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))").join(", ");
      await connection.execute(
        `INSERT INTO bobo_audit_logs_v2 (id, actor_id, action, target_type, target_id, detail, created_at, payload) VALUES ${placeholders} ON DUPLICATE KEY UPDATE actor_id=VALUES(actor_id), action=VALUES(action), target_type=VALUES(target_type), target_id=VALUES(target_id), detail=VALUES(detail), created_at=VALUES(created_at), payload=VALUES(payload)`,
        values.flat()
      );
    }
    const [updated] = await connection.execute(
      "UPDATE app_state SET value_json = JSON_REMOVE(value_json, '$.auditLogs'), updated_at = NOW() WHERE name = ?",
      [MYSQL_STATE_KEY]
    );
    await connection.execute(
      "INSERT INTO bobo_schema_migrations (name, applied_at) VALUES (?, NOW())",
      ["audit_logs_out_of_app_state_v1"]
    );
    await connection.execute("DELETE FROM bobo_audit_logs_v2 WHERE created_at < ?", [mysqlDateTime(cutoff)]);
    await connection.commit();
    if (updated.affectedRows) {
      databaseRevision += 1;
      tvDatabaseCache = { value: null, expiresAt: 0 };
      tvDashboardCache.clear();
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function mysqlDateTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) throw new TypeError("audit log createdAt is invalid");
  return date.toISOString().slice(0, 23).replace("T", " ");
}

let rowWebhookSender;

async function verifyRowRelease() {
  const expectedUuid = String(process.env.BOBO_ROW_SERVER_UUID || "").toLowerCase();
  const expectedDatabase = process.env.BOBO_ROW_DATABASE;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(expectedUuid) ||
      !expectedDatabase || expectedDatabase !== process.env.MYSQL_DATABASE ||
      process.env.BOBO_SYNTHETIC_ROW_TRIAL === "1" ||
      process.env.BOBO_SYNTHETIC_TASK_DIRECT === "1" ||
      process.env.BOBO_SYNTHETIC_TASK_SHADOW === "1") {
    throw new Error("行存储发布目标配置无效");
  }
  const pool = createMysqlPool();
  const [[target]] = await pool.query("SELECT @@server_uuid AS uuid, DATABASE() AS name");
  if (String(target.uuid).toLowerCase() !== expectedUuid || target.name !== expectedDatabase) {
    throw new Error("行存储发布数据库身份不匹配");
  }
  const [[legacy]] = await pool.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'app_state'");
  if (Number(legacy.count) !== 0) throw new Error("行存储发布必须使用独立目标库");
  const [[lock]] = await pool.query("SELECT COUNT(*) AS count FROM bobo_state_write_lock WHERE id=1");
  if (Number(lock.count) !== 1) throw new Error("行存储发布数据库缺少写锁");
  if (process.env.BOBO_ROW_WEBHOOK_ENABLED === "1") {
    const { createPlatformWebhookSender } = require("./lib/platform-webhook-sender");
    rowWebhookSender = createPlatformWebhookSender({ url: FUTURE_WEBHOOK_URL, secret: BOBO_INTEGRATION_SECRET });
  }
}

async function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(DRAWING_DIR, { recursive: true });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.mkdirSync(CAD_PREVIEW_DIR, { recursive: true });
  if (DB_DRIVER === "mysql_rows") {
    if (ROW_RELEASE) {
      await verifyRowRelease();
      return;
    }
    if (process.env.BOBO_SYNTHETIC_ROW_TRIAL !== "1" || process.env.MYSQL_HOST !== "127.0.0.1" || process.env.MYSQL_PORT !== "33317" || !/^bobo_row_trial_[a-z0-9]+$/.test(process.env.MYSQL_DATABASE || "")) {
      throw new Error("行存储试验仅允许独立合成数据库");
    }
    if (FUTURE_WEBHOOK_URL || (BOBO_INTEGRATION_SECRET && (process.env.BOBO_SYNTHETIC_EXTERNAL_TRIAL !== "1" || !/^synthetic-[a-z0-9-]{8,80}$/.test(BOBO_INTEGRATION_SECRET)))) throw new Error("行存储试验只允许合成集成密钥");
    const config = fs.readFileSync(path.join(ROOT, "local-mysql-isolated", "auto.cnf"), "utf8");
    const expected = config.match(/^server-uuid\s*=\s*([0-9a-f-]+)/im)?.[1]?.toLowerCase();
    const pool = createMysqlPool();
    const [[info]] = await pool.query("SELECT @@server_uuid AS uuid");
    if (!expected || String(info.uuid).toLowerCase() !== expected) throw new Error("行存储试验数据库身份不匹配");
    const [[lock]] = await pool.query("SELECT COUNT(*) AS count FROM bobo_state_write_lock WHERE id=1");
    if (Number(lock.count) !== 1) throw new Error("行存储试验数据库缺少写锁");
    return;
  }
  if (DB_DRIVER === "mysql") {
    await ensureMysqlStateTable();
    const pool = createMysqlPool();
    let migrationRows;
    try {
      [migrationRows] = await pool.execute(
        "SELECT name FROM bobo_schema_migrations WHERE name = ?",
        ["audit_logs_out_of_app_state_v1"]
      );
    } catch (error) {
      if (error.code === "ER_NO_SUCH_TABLE") throw new Error("MySQL 尚未执行审计日志拆表迁移；请先运行 node server.js --migrate-audit-logs");
      throw error;
    }
    if (!migrationRows.length) throw new Error("MySQL 尚未执行审计日志拆表迁移；请先运行 node server.js --migrate-audit-logs");
    const [rows] = await pool.execute("SELECT name FROM app_state WHERE name = ?", [MYSQL_STATE_KEY]);
    if (rows.length) return;
    if (fs.existsSync(DB_FILE)) {
      const initialDb = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      await writeDb(initialDb);
      return;
    }
  } else if (fs.existsSync(DB_FILE)) {
    return;
  }
  const users = [
    { id: "u_owner", name: "老板", phone: "13800000001", role: "owner", password: "123456", active: true },
    { id: "u_manager", name: "生产主管", phone: "13800000002", role: "manager", password: "123456", active: true },
    { id: "u_office", name: "跟单员", phone: "13800000003", role: "office", password: "123456", active: true },
    { id: "u_worker_laser", name: "激光师傅", phone: "13800000004", role: "laser_worker", roles: ["laser_worker"], password: "123456", active: true },
    { id: "u_worker_bend", name: "折弯师傅", phone: "13800000005", role: "bend_worker", roles: ["bend_worker"], password: "123456", active: true },
    { id: "u_quality", name: "质检员", phone: "13800000006", role: "quality", roles: ["quality"], password: "123456", active: true },
    { id: "u_admin", name: "管理员", phone: "13800000007", role: "admin", password: "123456", active: true },
  ];
  const processes = defaultProcesses.map((name, index) => ({ id: `p_${index + 1}`, name, sort: index + 1, active: true }));
  const customers = [
    { id: "c_1", name: "样例客户 A", contact: "张先生", phone: "13900000001", address: "上海", note: "演示客户" },
    { id: "c_2", name: "样例客户 B", contact: "李女士", phone: "13900000002", address: "苏州", note: "急单客户" },
  ];
  const orders = [
    { id: "o_1", orderNo: "SO-20260602-001", customerId: "c_1", productName: "电控箱外壳", drawingNo: "DKX-2406-A", quantity: 120, dueDate: today(5), priority: "普通", status: "生产中", note: "样例订单" },
    { id: "o_2", orderNo: "SO-20260602-002", customerId: "c_2", productName: "设备护罩", drawingNo: "HZ-2406-B", quantity: 40, dueDate: today(1), priority: "急单", status: "生产中", note: "交期紧" },
  ];
  const workOrders = [
    { id: "w_1", workNo: "WO-001", orderId: "o_1", productName: "电控箱外壳", planQty: 120, status: "生产中", currentProcess: "折弯", assigneeId: "u_manager", qrToken: "qr_w_1" },
    { id: "w_2", workNo: "WO-002", orderId: "o_2", productName: "设备护罩", planQty: 40, status: "生产中", currentProcess: "焊接", assigneeId: "u_manager", qrToken: "qr_w_2" },
  ];
  const routes = [
    { id: "r_1", workOrderId: "w_1", processId: "p_2", processName: "激光", sequence: 1, assignedTo: "u_worker_laser", status: "已完成", planQty: 120, completedQty: 120, goodQty: 118, badQty: 2, reworkQty: 0 },
    { id: "r_2", workOrderId: "w_1", processId: "p_3", processName: "折弯", sequence: 2, assignedTo: "u_worker_bend", status: "进行中", planQty: 120, completedQty: 60, goodQty: 60, badQty: 0, reworkQty: 0 },
    { id: "r_3", workOrderId: "w_1", processId: "p_4", processName: "焊接", sequence: 3, assignedTo: "", status: "待开始", planQty: 120, completedQty: 0, goodQty: 0, badQty: 0, reworkQty: 0 },
    { id: "r_4", workOrderId: "w_2", processId: "p_2", processName: "激光", sequence: 1, assignedTo: "u_worker_laser", status: "已完成", planQty: 40, completedQty: 40, goodQty: 40, badQty: 0, reworkQty: 0 },
    { id: "r_5", workOrderId: "w_2", processId: "p_4", processName: "焊接", sequence: 2, assignedTo: "u_worker_bend", status: "异常", planQty: 40, completedQty: 8, goodQty: 6, badQty: 2, reworkQty: 2 },
    { id: "r_6", workOrderId: "w_2", processId: "p_8", processName: "质检", sequence: 3, assignedTo: "u_quality", status: "待开始", planQty: 40, completedQty: 0, goodQty: 0, badQty: 0, reworkQty: 0 },
  ];
  const exceptions = [
    { id: "e_1", workOrderId: "w_2", routeId: "r_5", type: "焊接变形", description: "护罩侧板焊后变形，需要主管确认返修方式。", status: "待处理", reporterId: "u_worker_bend", createdAt: new Date().toISOString(), images: [] },
  ];
  await writeDb({ users, deletedUsers: [], processes, customers, orders, workOrders, routes, reports: [], exceptions, attachments: [], drawings: [], auditLogs: [], platformWebhookEvents: [], settings: { ...defaultSettings } });
}

async function readDb(maxAgeMs = 0) {
  const readRevision = databaseRevision;
  if (DB_DRIVER !== "mysql_rows" && maxAgeMs > 0 && tvDatabaseCache.value && tvDatabaseCache.expiresAt > Date.now()) {
    return tvDatabaseCache.value;
  }
  let db;
  if (DB_DRIVER === "mysql_rows") {
    const context = rowTrialContext.getStore();
    if (!context) throw new Error("行存储试验缺少事务上下文");
    db = context.state;
    if (context.scoped) return db;
  } else if (DB_DRIVER === "mysql") {
    const pool = createMysqlPool();
    const [rows] = await pool.execute("SELECT JSON_REMOVE(value_json, '$.auditLogs') AS value_json FROM app_state WHERE name = ?", [MYSQL_STATE_KEY]);
    if (!rows.length) throw new Error("MySQL app_state 未初始化，请先执行迁移或确认 data/db.json 可用于首次导入");
    db = typeof rows[0].value_json === "string" ? JSON.parse(rows[0].value_json) : rows[0].value_json;
  } else {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }
  let changed = false;
  if (!Array.isArray(db.deletedUsers)) {
    db.deletedUsers = [];
    changed = true;
  }
  db.reports ||= [];
  db.exceptions ||= [];
  db.customerFeedbacks ||= [];
  db.attachments ||= [];
  db.drawings ||= [];
  db.auditLogs ||= [];
  db.platformWebhookEvents ||= [];
  db.integrationNonces ||= [];
  db.deliveryTrips ||= [];
  db.deliveries ||= [];
  db.processes ||= [];
  db.settings ||= {};
  if (!db.orderFinancialAccessUserIds || typeof db.orderFinancialAccessUserIds !== "object" || Array.isArray(db.orderFinancialAccessUserIds)) {
    db.orderFinancialAccessUserIds = identifyFinancialAccessUsers(db.users);
    changed = true;
  }
  db.customers.forEach((customer) => {
    if (customer.active === undefined) {
      customer.active = true;
      changed = true;
    }
  });
  db.orders.forEach((order) => {
    const source = normalizedOrderSource(order);
    if (order.orderOrigin !== source.orderOrigin || order.sourceChannel !== source.sourceChannel || String(order.externalOrderNumber || "") !== source.externalOrderNumber) {
      Object.assign(order, source);
      changed = true;
    }
    const quantityUnit = normalizeQuantityUnit(order.quantityUnit);
    if (order.quantityUnit !== quantityUnit) {
      order.quantityUnit = quantityUnit;
      changed = true;
    }
    if (source.orderOrigin === "platform") {
      const externalSnapshot = {
        externalQuantity: Number(order.externalQuantity ?? order.quantity),
        externalExpectedDate: String(order.externalExpectedDate ?? order.dueDate ?? ""),
        externalRegion: String(order.externalRegion ?? order.region ?? ""),
        externalDeliveryAddress: String(order.externalDeliveryAddress ?? order.deliveryAddress ?? ""),
      };
      for (const [key, value] of Object.entries(externalSnapshot)) {
        if (order[key] === undefined) {
          order[key] = value;
          changed = true;
        }
      }
    }
  });
  Object.entries(defaultSettings).forEach(([key, value]) => {
    if (db.settings[key] === undefined) {
      db.settings[key] = value;
      changed = true;
    }
  });
  const legacyRoleByName = {
    设计师: "design_worker",
    激光师傅: "laser_worker",
    折弯师傅: "bend_worker",
    压铆师傅: "rivet_worker",
    攻丝师傅: "tap_worker",
    打磨师傅: "polish_worker",
    焊接师傅: "weld_worker",
    机加师傅: "machining_worker",
    喷塑师傅: "powder_worker",
    装配师傅: "assembly_worker",
  };
  db.users.forEach((item) => {
    const nextRole = legacyRoleByName[item.name];
    if (item.role === "worker" && nextRole) {
      item.role = nextRole;
      changed = true;
    }
    const nextRoles = normalizeRoles([...(Array.isArray(item.roles) ? item.roles : []), item.role]);
    const nextPrimaryRole = getPrimaryRole({ ...item, roles: nextRoles });
    if (JSON.stringify(item.roles || []) !== JSON.stringify(nextRoles)) {
      item.roles = nextRoles;
      changed = true;
    }
    if (item.role !== nextPrimaryRole) {
      item.role = nextPrimaryRole;
      changed = true;
    }
  });
  db.deletedUsers.forEach((item) => {
    const nextRoles = normalizeRoles([...(Array.isArray(item.roles) ? item.roles : []), item.role]);
    if (JSON.stringify(item.roles || []) !== JSON.stringify(nextRoles)) {
      item.roles = nextRoles;
      changed = true;
    }
  });
  const processIdMap = new Map();
  const canonicalProcesses = [];
  db.processes.forEach((process) => {
    const name = normalizeProcessName(process.name);
    const existing = canonicalProcesses.find((item) => item.name === name);
    if (existing) {
      processIdMap.set(process.id, existing.id);
      changed = true;
      return;
    }
    if (process.name !== name) changed = true;
    process.name = name;
    if (process.active === undefined) {
      process.active = true;
      changed = true;
    }
    canonicalProcesses.push(process);
    processIdMap.set(process.id, process.id);
  });
  db.processes = canonicalProcesses;
  defaultProcesses.forEach((name) => {
    if (!db.processes.some((process) => process.name === name)) {
      db.processes.push({ id: id("p"), name, sort: db.processes.length + 1, active: true });
      changed = true;
    }
  });
  db.routes.forEach((route) => {
    const processName = normalizeProcessName(route.processName);
    const process = db.processes.find((item) => item.name === processName);
    if (route.processName !== processName) {
      route.processName = processName;
      changed = true;
    }
    const nextProcessId = process?.id || processIdMap.get(route.processId) || route.processId;
    if (route.processId !== nextProcessId) {
      route.processId = nextProcessId;
      changed = true;
    }
    const assignedRole = getProcessRole(processName);
    if (route.assignedRole !== assignedRole) {
      route.assignedRole = assignedRole;
      changed = true;
    }
    if (route.assignedTo && route.status !== "已完成") {
      const assignee = db.users.find((item) => item.id === route.assignedTo && item.active !== false);
      if (!assignee || (assignedRole && !userHasRole(assignee, assignedRole))) {
        route.assignedTo = "";
        changed = true;
      }
    }
    const targetFinishTime = normalizeTargetFinishTime(route.targetFinishTime);
    if ((route.targetFinishTime || "") !== targetFinishTime) {
      route.targetFinishTime = targetFinishTime;
      changed = true;
    }
    const schedule = normalizeRouteSchedule(route.plannedStartDate, route.plannedEndDate || targetFinishTime.slice(0, 10));
    if (!schedule.error) {
      if (route.plannedStartDate !== schedule.plannedStartDate) {
        route.plannedStartDate = schedule.plannedStartDate;
        changed = true;
      }
      if (route.plannedEndDate !== schedule.plannedEndDate) {
        route.plannedEndDate = schedule.plannedEndDate;
        changed = true;
      }
    }
    if (!route.qrToken) {
      route.qrToken = qrToken("rt");
      changed = true;
    }
    if (route.status === "已完成" && !route.completedAt) {
      const report = db.reports.find((item) => item.routeId === route.id);
      route.completedAt = report?.createdAt || new Date().toISOString();
      route.lastReportedAt = route.completedAt;
      route.lastReporterId ||= report?.reporterId || route.assignedTo || "";
      changed = true;
    }
  });
  db.workOrders.forEach((workOrder) => {
    if (!workOrder.creationStatus) {
      const order = db.orders.find((item) => item.id === workOrder.orderId);
      const platform = normalizedOrderSource(order).orderOrigin === "platform";
      const hasRoutes = db.routes.some((route) => route.workOrderId === workOrder.id);
      workOrder.creationStatus = platform && !hasRoutes ? "pending" : "confirmed";
      changed = true;
    }
    const currentProcess = normalizeProcessName(workOrder.currentProcess);
    if (workOrder.currentProcess !== currentProcess) {
      workOrder.currentProcess = currentProcess;
      changed = true;
    }
  });
  db.orders.forEach((order) => {
    if (normalizedOrderSource(order).orderOrigin !== "platform") return;
    if (db.deliveries.some((delivery) => delivery.orderId === order.id)) return;
    const workOrders = db.workOrders.filter((workOrder) => workOrder.orderId === order.id);
    if (!workOrders.length || workOrders.some((workOrder) => workOrder.creationStatus === "pending" || workOrder.status !== "已完成")) return;
    db.deliveries.push({
      id: id("delivery"),
      orderId: order.id,
      tripId: "",
      driverId: order.shippedBy || "",
      status: order.shippedAt ? "legacy_shipped" : "waiting",
      addressSnapshot: { region: String(order.region || ""), deliveryAddress: String(order.deliveryAddress || "") },
      startedAt: order.shippedAt || "",
      deliveredAt: "",
      proofAttachmentIds: [],
      note: "",
      createdAt: order.shippedAt || new Date().toISOString(),
    });
    changed = true;
  });
  db.processes.forEach((process, index) => {
    const standardIndex = defaultProcesses.indexOf(process.name);
    const nextSort = standardIndex >= 0 ? standardIndex + 1 : defaultProcesses.length + index + 1;
    if (process.sort !== nextSort) {
      process.sort = nextSort;
      changed = true;
    }
  });
  const processOrderBeforeSort = db.processes.map((process) => process.id).join(",");
  db.processes.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-Hans-CN"));
  if (processOrderBeforeSort !== db.processes.map((process) => process.id).join(",")) changed = true;
  if (changed) await writeDb(db);
  if (DB_DRIVER !== "mysql_rows") reopenInFlightRoutes(db);
  if (DB_DRIVER !== "mysql_rows" && maxAgeMs > 0 && readRevision === databaseRevision) tvDatabaseCache = { value: db, expiresAt: Date.now() + maxAgeMs };
  return db;
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsGenerator(degree) {
  let result = [1];
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    const next = Array(result.length + 1).fill(0);
    result.forEach((coef, index) => {
      next[index] ^= gfMultiply(coef, root);
      next[index + 1] ^= coef;
    });
    result = next;
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, degree) {
  const generator = rsGenerator(degree);
  const result = Array(degree).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i += 1) result[i] ^= gfMultiply(generator[i], factor);
  });
  return result;
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function qrFormatBits(mask) {
  let data = (1 << 3) | mask; // Error correction level L.
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function qrMask(mask, x, y) {
  if (mask === 0) return (x + y) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (x + y) % 3 === 0;
  return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
}

function makeQrSvg(text) {
  const version = 4;
  const size = version * 4 + 17;
  const dataCodewords = 80;
  const eccCodewords = 20;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  const drawFinder = (x, y) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFunction(xx, yy, dark);
      }
    }
  };
  const drawAlignment = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  for (let i = 8; i < size - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  drawAlignment(26, 26);
  setFunction(8, version * 4 + 9, true);
  for (let i = 0; i < 9; i += 1) {
    setFunction(8, i, false);
    setFunction(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    setFunction(size - 1 - i, 8, false);
    setFunction(8, size - 1 - i, false);
  }

  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > dataCodewords - 3) throw new Error("二维码内容过长");
  const bits = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  for (let pad = 0xec; data.length < dataCodewords; pad ^= 0xec ^ 0x11) data.push(pad);
  const codewords = data.concat(rsRemainder(data, eccCodewords));
  const allBits = [];
  codewords.forEach((byte) => appendBits(allBits, byte, 8));

  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (!reserved[y][x] && bitIndex < allBits.length) modules[y][x] = Boolean(allBits[bitIndex++]);
      }
    }
  }
  const mask = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!reserved[y][x] && qrMask(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  }
  const format = qrFormatBits(mask);
  const bit = (i) => Boolean((format >>> i) & 1);
  for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
  setFunction(8, 7, bit(6));
  setFunction(8, 8, bit(7));
  setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, bit(i));

  const scale = 8;
  const border = 4;
  const dim = (size + border * 2) * scale;
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) rects.push(`<rect x="${(x + border) * scale}" y="${(y + border) * scale}" width="${scale}" height="${scale}"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}

async function writeDb(db) {
  databaseRevision += 1;
  tvDatabaseCache = { value: null, expiresAt: 0 };
  tvDashboardCache.clear();
  if (DB_DRIVER === "mysql_rows") {
    const context = rowTrialContext.getStore();
    if (!context || context.state !== db) throw new Error("行存储试验的状态不属于当前事务");
    if (context.readOnly || context.readOnlyConnection) throw new Error("只读请求不可写入");
    context.saved = true;
    return;
  }
  if (DB_DRIVER === "mysql") {
    const pool = createMysqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const state = { ...db };
      const auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
      delete state.auditLogs;
      await connection.execute(
        "REPLACE INTO app_state (name, value_json, updated_at) VALUES (?, CAST(? AS JSON), NOW())",
        [MYSQL_STATE_KEY, JSON.stringify(state)]
      );
      for (const item of auditLogs) {
        await connection.execute(
          "INSERT INTO bobo_audit_logs_v2 (id, actor_id, action, target_type, target_id, detail, created_at, payload) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE actor_id=VALUES(actor_id), action=VALUES(action), target_type=VALUES(target_type), target_id=VALUES(target_id), detail=VALUES(detail), created_at=VALUES(created_at), payload=VALUES(payload)",
          auditValues(item)
        );
      }
      await connection.execute("DELETE FROM bobo_audit_logs_v2 WHERE created_at < ?", [mysqlDateTime(Date.now() - AUDIT_RETENTION_MS)]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    databaseRevision += 1;
    tvDatabaseCache = { value: null, expiresAt: 0 };
    tvDashboardCache.clear();
    return;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  tvDatabaseCache = { value: null, expiresAt: 0 };
  tvDashboardCache.clear();
}

function normalizedOrderSource(order) {
  const platform = order?.orderOrigin === "platform" && PLATFORM_SOURCE_CHANNELS.has(order?.sourceChannel);
  return {
    orderOrigin: platform ? "platform" : "factory",
    sourceChannel: platform ? order.sourceChannel : "factory_manual",
    externalOrderNumber: platform ? String(order.externalOrderNumber || "") : ""
  };
}

function externalOrderMatches(order, input) {
  return order.orderOrigin === "platform"
    && order.sourceChannel === input.sourceChannel
    && order.externalOrderNumber === input.externalOrderNumber
    && order.externalCustomer === input.customer
    && order.externalPhone === input.phone
    && Number(order.externalQuantity ?? order.quantity) === input.quantity
    && String(order.externalExpectedDate ?? order.dueDate) === input.expectedDate
    && order.externalDescription === input.description
    && order.material === input.material
    && order.dimensions === input.dimensions
    && String(order.externalRegion ?? order.region ?? "") === input.region
    && String(order.externalDeliveryAddress ?? order.deliveryAddress ?? "") === input.deliveryAddress;
}

function workOrderMatchesSource(workOrder, source = "all") {
  if (source === "all" || !source) return true;
  const origin = normalizedOrderSource(workOrder.order).orderOrigin;
  return origin === source;
}

function visibleProductionWorkOrders(workOrders, source = "all") {
  return workOrders.filter((workOrder) => workOrder.creationStatus !== "pending" && workOrderMatchesSource(workOrder, source));
}

function validExternalSignature(req, rawBody) {
  if (!BOBO_INTEGRATION_SECRET) return false;
  const timestamp = String(req.headers["x-integration-timestamp"] || "");
  const nonce = String(req.headers["x-integration-nonce"] || "");
  const signature = String(req.headers["x-integration-signature"] || "");
  if (!/^\d{13}$/.test(timestamp) || !nonce || nonce.length > 128 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const expected = crypto.createHmac("sha256", BOBO_INTEGRATION_SECRET).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}


async function readExternalOrder(req) {
  if (!BOBO_INTEGRATION_SECRET) return { status: 503, error: "外部工单集成未启用" };
  const rawBody = await readRawBody(req);
  if (!validExternalSignature(req, rawBody)) return { status: 401, error: "外部集成签名无效" };
  let input;
  try { input = JSON.parse(rawBody) || {}; } catch { return { status: 400, error: "请求格式错误" }; }
  input = {
    externalOrderNumber: String(input.externalOrderNumber || "").trim(),
    sourceChannel: String(input.sourceChannel || "").trim(),
    customer: String(input.customer || "").trim(),
    phone: String(input.phone || "").trim(),
    quantity: Number(input.quantity),
    expectedDate: normalizeDate(input.expectedDate),
    description: String(input.description || "").trim(),
    material: String(input.material || "").trim(),
    dimensions: String(input.dimensions || "").trim(),
    region: String(input.region || "").trim(),
    deliveryAddress: String(input.deliveryAddress || "").trim(),
  };
  if (!input.externalOrderNumber || input.externalOrderNumber.length > 128 || !input.customer || !input.phone || !Number.isInteger(input.quantity) || input.quantity < 1 || !input.expectedDate) return { status: 422, error: "外部订单核心参数不合法或不完整" };
  if (!PLATFORM_SOURCE_CHANNELS.has(input.sourceChannel)) return { status: 422, error: "平台渠道无效" };
  const nonce = String(req.headers["x-integration-nonce"]);
  return { input, nonce };
}

let externalOrderWrite = Promise.resolve();
function serializeExternalOrder(task) {
  const result = externalOrderWrite.then(task, task);
  externalOrderWrite = result.catch(() => {});
  return result;
}

let deliveryWrite = Promise.resolve();
function serializeDelivery(task) {
  if (rowTrialContext.getStore()?.scoped) return task();
  const result = deliveryWrite.then(task, task);
  deliveryWrite = result.catch(() => {});
  return result;
}

let platformOrderWrite = Promise.resolve();
function serializePlatformOrder(task) {
  const result = platformOrderWrite.then(task, task);
  platformOrderWrite = result.catch(() => {});
  return result;
}

const serializeOrderNumberWrite = createSerialQueue();
const ORDER_NUMBER_WRITE_PATHS = new Set(["/api/orders", "/api/orders/update", "/api/orders/repeat", "/api/external/work-orders"]);
const serializeDispatchBoardWrite = createSerialQueue();
const DISPATCH_BOARD_WRITE_PATHS = new Set([
  "/api/routes/publish-schedule",
  "/api/assign",
  "/api/routes",
  "/api/routes/delete",
  "/api/dispatch-board/route-toggle",
  "/api/dispatch-board/report",
  "/api/report",
  "/api/route-status",
  "/api/dispatch-board/route-schedule",
  "/api/dispatch-board/order-due-date",
]);

function queuePlatformProgress(db, route, reportId, occurredAt) {
  const workOrder = db.workOrders.find((item) => item.id === route.workOrderId);
  const order = db.orders.find((item) => item.id === workOrder?.orderId);
  const source = normalizedOrderSource(order);
  if (source.orderOrigin !== "platform" || !source.externalOrderNumber) return;
  const eventId = `bobo-report-${reportId}`;
  if (db.platformWebhookEvents.some((item) => item.event.eventId === eventId)) return;
  const workOrderIds = new Set(db.workOrders.filter((item) => item.orderId === order.id).map((item) => item.id));
  const routes = db.routes.filter((item) => workOrderIds.has(item.workOrderId));
  const allProcessesCompleted = routes.length > 0 && routes.every((item) => item.status === "已完成" && routeQuantityComplete(item));
  order.platformWebhookSequence = Number(order.platformWebhookSequence || 0) + 1;
  db.platformWebhookEvents.push({
    status: "pending", attempts: 0, nextAttemptAt: "", lastError: "",
    event: {
      eventId, sequence: order.platformWebhookSequence, workOrderId: workOrder.id,
      externalOrderNumber: source.externalOrderNumber, type: "process.updated", occurredAt,
      allProcessesCompleted,
      processes: routes.map(item => ({ id: item.id, sequence: Number(item.sequence), name: item.processName,
        status: item.status === "已完成" && routeQuantityComplete(item) ? "已完成" : "待开始",
        completedAt: item.status === "已完成" && routeQuantityComplete(item) ? item.completedAt || "" : "" })),
      process: { id: route.id, sequence: Number(route.sequence), name: route.processName, status: route.status, startedAt: route.startedAt || route.lastReportedAt || "", completedAt: route.completedAt || "" }
    }
  });
}

function queuePlatformShipment(db, order, workOrder, occurredAt) {
  const source = normalizedOrderSource(order);
  if (source.orderOrigin !== "platform" || !source.externalOrderNumber) return null;
  const eventId = `bobo-shipment-${order.id}`;
  const existing = db.platformWebhookEvents.find((item) => item.event.eventId === eventId);
  if (existing) {
    if (existing.status !== "delivered") {
      existing.status = "pending";
      existing.nextAttemptAt = "";
    }
    return existing;
  }
  order.platformWebhookSequence = Number(order.platformWebhookSequence || 0) + 1;
  const queuedEvent = {
    status: "pending", attempts: 0, nextAttemptAt: "", lastError: "",
    event: {
      eventId, sequence: order.platformWebhookSequence, workOrderId: workOrder.id,
      externalOrderNumber: source.externalOrderNumber, type: "shipment.shipped", occurredAt,
      allProcessesCompleted: true,
    },
  };
  db.platformWebhookEvents.push(queuedEvent);
  return queuedEvent;
}

function queuePlatformDeliveryCompleted(db, order, workOrder, delivery) {
  const source = normalizedOrderSource(order);
  if (source.orderOrigin !== "platform" || !source.externalOrderNumber) return null;
  const eventId = `bobo-delivery-${order.id}`;
  const existing = db.platformWebhookEvents.find((item) => item.event.eventId === eventId);
  if (existing) return existing;
  order.platformWebhookSequence = Number(order.platformWebhookSequence || 0) + 1;
  const queuedEvent = {
    status: "pending", attempts: 0, nextAttemptAt: "", lastError: "",
    event: {
      eventId,
      sequence: order.platformWebhookSequence,
      workOrderId: workOrder.id,
      externalOrderNumber: source.externalOrderNumber,
      type: "delivery.completed",
      occurredAt: delivery.deliveredAt,
      allProcessesCompleted: true,
      delivery: {
        id: delivery.id,
        tripId: delivery.tripId,
        driverId: delivery.driverId,
        deliveredAt: delivery.deliveredAt,
      },
    },
  };
  db.platformWebhookEvents.push(queuedEvent);
  return queuedEvent;
}

let processingPlatformWebhooks = false;
async function processPlatformWebhooks() {
  if (DB_DRIVER === "mysql_rows") {
    if (processingPlatformWebhooks || !rowWebhookSender) return;
    processingPlatformWebhooks = true;
    try {
      const { processOneOutbox } = require("./lib/outbox-worker");
      for (let index = 0; index < 20; index++) {
        const result = await processOneOutbox(createMysqlPool(), rowWebhookSender);
        if (!result.claimed) break;
      }
    } catch (error) {
      console.error("行存储回传队列处理失败", error.code || error.name);
    } finally {
      processingPlatformWebhooks = false;
    }
    return;
  }
  if (processingPlatformWebhooks || !FUTURE_WEBHOOK_URL || !BOBO_INTEGRATION_SECRET) return;
  processingPlatformWebhooks = true;
  try {
    const db = await readDb();
    const currentTime = Date.now();
    const pending = db.platformWebhookEvents.filter((item) => item.status !== "delivered" && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= currentTime));
    for (const item of pending) {
      const body = JSON.stringify(item.event);
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const signature = crypto.createHmac("sha256", BOBO_INTEGRATION_SECRET).update(`${timestamp}.${nonce}.${body}`).digest("hex");
      try {
        const response = await fetch(FUTURE_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json", "x-integration-timestamp": timestamp, "x-integration-nonce": nonce, "x-integration-signature": signature }, body });
        if (!response.ok) throw new Error(`平台返回 ${response.status}`);
        item.status = "delivered";
        item.lastError = "";
        item.nextAttemptAt = "";
      } catch (error) {
        item.status = "pending";
        item.attempts = Number(item.attempts || 0) + 1;
        item.lastError = error.message;
        item.nextAttemptAt = new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(item.attempts, 6))).toISOString();
      }
    }
    if (pending.length) await writeDb(db);
  } finally {
    processingPlatformWebhooks = false;
  }
}

async function backfillPlatformOrder(orderNumber) {
  if (DB_DRIVER !== "json" || !orderNumber) throw new Error("回填仅支持指定本地 JSON 数据库中的订单号");
  const db = await readDb();
  const order = db.orders.find((item) => normalizedOrderSource(item).externalOrderNumber === orderNumber);
  if (!order) throw new Error("未找到对应平台订单");
  const workOrderIds = new Set(db.workOrders.filter((item) => item.orderId === order.id).map((item) => item.id));
  const before = db.platformWebhookEvents.length;
  for (const route of db.routes.filter((item) => workOrderIds.has(item.workOrderId)).sort((a, b) => a.sequence - b.sequence)) {
    const report = db.reports.filter((item) => item.routeId === route.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (report) queuePlatformProgress(db, route, report.id, report.createdAt);
  }
  if (db.platformWebhookEvents.length !== before) await writeDb(db);
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(res.viewOrderFinancials ? data : redactOrderFinancials(data)));
}

function redactOrderFinancials(value) {
  if (Array.isArray(value)) return value.map(redactOrderFinancials);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "unitPrice" || key === "totalAmount") continue;
    result[key] = redactOrderFinancials(item);
  }
  return result;
}

function sendLocalFile(res, filePath, contentType, downloadName = "") {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, { error: "图纸文件不存在" });
  }
  const headers = {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": fs.statSync(filePath).size,
    "Cache-Control": "private, no-store",
  };
  if (downloadName) {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function drawingContentType(drawing, filePath) {
  if (drawing.contentType) return drawing.contentType;
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml; charset=utf-8",
    ".pdf": "application/pdf",
  }[ext] || "application/octet-stream";
}

function validTvDrawingViewer(db, token) {
  const viewer = viewerFromToken(db, token);
  return viewer && ["mobile-tv", "dispatch-board"].includes(viewer.audience) ? viewer : null;
}

function isDateInRange(value, from, to) {
  const text = String(value || "").trim();
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : shanghaiDateKey(text);
  if (!dateText) return false;
  if (from && dateText < from) return false;
  if (to && dateText > to) return false;
  return true;
}

function historyFilters(url) {
  const dateType = String(url.searchParams.get("dateType") || "createdAt");
  return {
    workOrderId: String(url.searchParams.get("workOrderId") || "").trim(),
    workNo: String(url.searchParams.get("workNo") || "").trim().toLowerCase(),
    customerId: String(url.searchParams.get("customerId") || "").trim(),
    status: String(url.searchParams.get("status") || "").trim(),
    source: String(url.searchParams.get("source") || "").trim(),
    sourceChannel: String(url.searchParams.get("sourceChannel") || "").trim(),
    processName: normalizeProcessName(url.searchParams.get("processName") || ""),
    from: normalizeDate(url.searchParams.get("from") || ""),
    to: normalizeDate(url.searchParams.get("to") || ""),
    keyword: String(url.searchParams.get("keyword") || "").trim().toLowerCase(),
    dateType: ["createdAt", "dueDate", "completedAt"].includes(dateType) ? dateType : "createdAt",
  };
}

function orderFulfillmentStatus(workOrder, order) {
  if (workOrder.status !== "已完成") return workOrder.status;
  if (order.invoicedAt) return "已开票";
  if (order.shippedAt) return "已发货";
  return "已完成";
}

function attachmentByUrl(db, url) {
  return db.attachments.find((item) => item.url === url) || null;
}

function workOrderHistoryItems(db, filters, includeCustomerFeedbacks = false, includeDetails = true) {
  const orders = new Map();
  const customers = new Map();
  for (const order of db.orders) if (!orders.has(order.id)) orders.set(order.id, order);
  for (const customer of db.customers) if (!customers.has(customer.id)) customers.set(customer.id, customer);
  const completedRoutes = new Map();
  for (const route of db.routes) {
    if (route.status !== "已完成") continue;
    if (!completedRoutes.has(route.workOrderId)) completedRoutes.set(route.workOrderId, []);
    completedRoutes.get(route.workOrderId).push(route);
  }
  const matched = db.workOrders
    .filter((item) => !filters.workOrderId || item.id === filters.workOrderId)
    .filter((item) => !filters.workNo || String(item.workNo || "").trim().toLowerCase() === filters.workNo)
    .map((workOrder) => {
      const order = orders.get(workOrder.orderId) || {};
      const source = normalizedOrderSource(order);
      const customer = customers.get(order.customerId) || {};
      return {
        id: workOrder.id,
        workNo: workOrder.workNo,
        orderNo: order.orderNo || "",
        orderId: order.id || "",
        orderOrigin: source.orderOrigin,
        sourceChannel: source.sourceChannel,
        externalOrderNumber: source.externalOrderNumber,
        customerId: customer.id || "",
        customerName: customer.name || "",
        productName: workOrder.productName || order.productName || "",
        drawingNo: order.drawingNo || "",
        planQty: workOrder.planQty,
        quantityUnit: normalizeQuantityUnit(order.quantityUnit),
        status: orderFulfillmentStatus(workOrder, order),
        productionStatus: workOrder.status,
        weightKg: order.weightKg ?? null,
        priority: order.priority || "普通",
        note: order.note || "",
        shippedAt: order.shippedAt || "",
        invoicedAt: order.invoicedAt || "",
        dueDate: order.dueDate || "",
        createdAt: workOrder.createdAt || order.createdAt || "",
        completedAt: workOrderCompletedAt(db, workOrder, completedRoutes.get(workOrder.id) || []),
      };
    })
    .filter((item) => !filters.customerId || item.customerId === filters.customerId)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => !filters.source || item.orderOrigin === filters.source)
    .filter((item) => !filters.sourceChannel || item.sourceChannel === filters.sourceChannel)
    .filter((item) => (!filters.from && !filters.to) || isDateInRange(item[filters.dateType], filters.from, filters.to))
    .filter((item) => {
      if (!filters.keyword) return true;
      return [item.workNo, item.orderNo, item.customerName, item.productName, item.drawingNo]
        .some((value) => String(value || "").toLowerCase().includes(filters.keyword));
    })
    .sort((a, b) => String(b[filters.dateType] || b.createdAt || b.dueDate).localeCompare(String(a[filters.dateType] || a.createdAt || a.dueDate)));
  if (!includeDetails) return matched;
  return matched.map((entry) => {
    const orderId = entry.orderId || undefined;
    const routes = db.routes.filter((item) => item.workOrderId === entry.id).sort((a, b) => a.sequence - b.sequence);
    const drawings = (db.drawings || []).filter((item) => item.workOrderId === entry.id || item.orderId === orderId);
    const qualityExceptions = db.exceptions
      .filter((item) => item.workOrderId === entry.id && (item.qualityRouteId || item.source === "quality-inspection"))
      .map((item) => ({ ...item, processName: db.routes.find((route) => route.id === item.issueRouteId || route.id === item.routeId)?.processName || item.type || "", reporterName: resolveUser(db, item.reporterId)?.name || "", resolvedByName: resolveUser(db, item.resolvedBy)?.name || "" }));
    const customerFeedbacks = includeCustomerFeedbacks
      ? db.customerFeedbacks.filter((item) => item.workOrderId === entry.id).map((item) => ({ ...item, processName: db.routes.find((route) => route.id === item.routeId)?.processName || "", reporterName: resolveUser(db, item.reporterId)?.name || "", resolvedByName: resolveUser(db, item.resolvedBy)?.name || "" }))
      : null;
    return { ...entry, routes, drawings, qualityExceptions, ...(includeCustomerFeedbacks ? { customerFeedbacks } : {}) };
  });
}

function exceptionHistoryItems(db, filters) {
  return db.exceptions
    .map((item) => {
      const route = db.routes.find((routeItem) => routeItem.id === item.routeId) || {};
      const workOrder = db.workOrders.find((workItem) => workItem.id === item.workOrderId) || {};
      const order = db.orders.find((orderItem) => orderItem.id === workOrder.orderId) || {};
      const customer = db.customers.find((customerItem) => customerItem.id === order.customerId) || {};
      return {
        ...item,
        workNo: workOrder.workNo || "",
        orderNo: order.orderNo || "",
        customerId: customer.id || "",
        customerName: customer.name || "",
        productName: workOrder.productName || order.productName || "",
        processName: route.processName || "",
        disposition: item.disposition || "",
        attachments: (item.images || []).map((url) => attachmentByUrl(db, url)).filter(Boolean),
      };
    })
    .filter((item) => !filters.customerId || item.customerId === filters.customerId)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => !filters.processName || normalizeProcessName(item.processName) === filters.processName)
    .filter((item) => !filters.from || isDateInRange(item.createdAt, filters.from, filters.to))
    .filter((item) => {
      if (!filters.keyword) return true;
      return [item.workNo, item.orderNo, item.customerName, item.productName, item.processName, item.type, item.description]
        .some((value) => String(value || "").toLowerCase().includes(filters.keyword));
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function saveDataUrlFile(body, options = {}) {
  const allowImagesOnly = options.allowImagesOnly !== false;
  const match = String(body.dataUrl || "").match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
  if (!match) return { error: "缺少有效的 dataUrl" };
  const contentType = match[1].toLowerCase();
  if (allowImagesOnly && !contentType.startsWith("image/")) return { error: "只支持图片 dataUrl" };
  const extByType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "application/acad": "dwg",
    "application/x-acad": "dwg",
    "application/dxf": "dxf",
    "application/x-dxf": "dxf",
  };
  const sourceName = String(body.name || "").trim();
  const nameExt = path.extname(sourceName).replace(".", "").toLowerCase();
  const ext = extByType[contentType] || nameExt;
  const allowed = options.allowedExts || ["png", "jpg", "jpeg", "gif"];
  if (!allowed.includes(ext)) return { error: `不支持的文件类型：${ext || contentType}` };
  const targetDir = options.targetDir || UPLOAD_DIR;
  const urlPrefix = options.urlPrefix || "/uploads";
  fs.mkdirSync(targetDir, { recursive: true });
  const fileName = `${id(options.prefix || "file")}.${ext === "jpeg" ? "jpg" : ext}`;
  writeUploadFile(path.join(targetDir, fileName), Buffer.from(match[2], "base64"));
  return {
    fileName,
    url: `${urlPrefix}/${fileName}`,
    contentType,
    fileType: ext,
    originalName: sourceName || fileName,
  };
}

function writeUploadFile(file, contents) {
  const rollbackFiles = rowTrialContext.getStore()?.rollbackFiles;
  if (rollbackFiles && !fs.existsSync(file)) rollbackFiles.push(() => {
    try { fs.rmSync(file, { force: true }); }
    catch (error) { console.error("Unable to remove rolled-back upload", error.code); }
  });
  fs.writeFileSync(file, contents);
}

function isCadDrawing(fileType) {
  return ["dwg", "dxf"].includes(String(fileType || "").toLowerCase());
}

function cadPreviewPath(fileName) {
  return path.join(CAD_PREVIEW_DIR, `${path.parse(fileName).name}.svg`);
}

function normalizeCadSvg(svg) {
  const style = '<style id="cad-preview-visible-style">line,path,polyline,polygon,circle,ellipse{stroke:#111827!important;stroke-width:0.35px!important;vector-effect:non-scaling-stroke!important}text,tspan{fill:#111827!important;stroke:none!important}</style>';
  const source = String(svg).includes("cad-preview-visible-style")
    ? String(svg)
    : String(svg).replace(/<svg\b([^>]*)>/i, `<svg$1>${style}`);
  return normalizeCadViewBox(source)
    .replace(/stroke-width\s*:\s*0(?:\.0+)?(?:px)?/gi, "stroke-width:0.25px")
    .replace(/stroke-width=(["'])0(?:\.0+)?(?:px)?\1/gi, 'stroke-width="0.25px"')
    .replace(/stroke\s*:\s*(#[0-9a-f]{3,6}|white|rgb\([^)]+\))/gi, (match, color) => `stroke:${normalizeCadColor(color)}`)
    .replace(/stroke=(["'])(#[0-9a-f]{3,6}|white|rgb\([^)]+\))\1/gi, (_match, _quote, color) => `stroke="${normalizeCadColor(color)}"`);
}

function svgAttribute(tag, name) {
  const match = String(tag).match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? match[1] : "";
}

function svgNumbers(text) {
  return String(text).match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number).filter(Number.isFinite) || [];
}

function svgShapeBounds(svg) {
  const shapes = [];
  String(svg).replace(/<(line|polyline|polygon|circle|ellipse|path)\b[^>]*>/gi, (tag, type) => {
    const bounds = createBounds();
    if (type === "line") {
      addBounds(bounds, { x: dxfNumber(svgAttribute(tag, "x1")), y: dxfNumber(svgAttribute(tag, "y1")) });
      addBounds(bounds, { x: dxfNumber(svgAttribute(tag, "x2")), y: dxfNumber(svgAttribute(tag, "y2")) });
    } else if (type === "circle") {
      const cx = dxfNumber(svgAttribute(tag, "cx"));
      const cy = dxfNumber(svgAttribute(tag, "cy"));
      const r = Math.abs(dxfNumber(svgAttribute(tag, "r")));
      addBounds(bounds, { x: cx - r, y: cy - r });
      addBounds(bounds, { x: cx + r, y: cy + r });
    } else if (type === "ellipse") {
      const cx = dxfNumber(svgAttribute(tag, "cx"));
      const cy = dxfNumber(svgAttribute(tag, "cy"));
      const rx = Math.abs(dxfNumber(svgAttribute(tag, "rx")));
      const ry = Math.abs(dxfNumber(svgAttribute(tag, "ry")));
      addBounds(bounds, { x: cx - rx, y: cy - ry });
      addBounds(bounds, { x: cx + rx, y: cy + ry });
    } else if (type === "polyline" || type === "polygon") {
      const values = svgNumbers(svgAttribute(tag, "points"));
      for (let index = 0; index < values.length - 1; index += 2) addBounds(bounds, { x: values[index], y: values[index + 1] });
    } else if (type === "path") {
      const values = svgNumbers(svgAttribute(tag, "d"));
      for (let index = 0; index < values.length - 1; index += 2) addBounds(bounds, { x: values[index], y: values[index + 1] });
    }
    if (Number.isFinite(bounds.minX)) shapes.push(bounds);
    return tag;
  });
  return shapes;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function percentileCadBounds(boundsList) {
  const centers = boundsList.map(boundsCenter);
  const sizes = boundsList.map(boundsSize);
  const threshold = Math.max(1, percentile(sizes, 0.6));
  const denseMinX = percentile(centers.map((point) => point.x), 0.05);
  const denseMaxX = percentile(centers.map((point) => point.x), 0.95);
  const denseMinY = percentile(centers.map((point) => point.y), 0.05);
  const denseMaxY = percentile(centers.map((point) => point.y), 0.95);
  const selected = boundsList.filter((bounds) => {
    const center = boundsCenter(bounds);
    const isDense = center.x >= denseMinX && center.x <= denseMaxX && center.y >= denseMinY && center.y <= denseMaxY;
    return isDense || boundsSize(bounds) >= threshold * 4;
  });
  const result = createBounds();
  (selected.length ? selected : boundsList).forEach((bounds) => mergeBounds(result, bounds));
  return Number.isFinite(result.minX) ? result : null;
}

function mainCadBounds(boundsList) {
  if (!boundsList.length) return null;
  if (boundsList.length >= 10) return percentileCadBounds(boundsList);
  const primary = boundsList.reduce((best, item) => (boundsScore(item) > boundsScore(best) ? item : best), boundsList[0]);
  const primaryCenter = boundsCenter(primary);
  const primarySize = Math.max(100, boundsSize(primary));
  const visible = boundsList.filter((item) => {
    const itemSize = boundsSize(item);
    const maxDistance = Math.max(primarySize * 8, 500);
    return itemSize >= primarySize * 0.25 || distance(boundsCenter(item), primaryCenter) <= maxDistance;
  });
  const bounds = createBounds();
  visible.forEach((item) => mergeBounds(bounds, item));
  return Number.isFinite(bounds.minX) ? bounds : null;
}

function normalizeCadViewBox(svg) {
  const bounds = mainCadBounds(svgShapeBounds(svg));
  if (!bounds) return svg;
  const padding = Math.max(10, (boundsWidth(bounds) + boundsHeight(bounds)) / 40);
  const viewBox = `${bounds.minX - padding} ${bounds.minY - padding} ${Math.max(1, boundsWidth(bounds) + padding * 2)} ${Math.max(1, boundsHeight(bounds) + padding * 2)}`;
  return String(svg).includes("viewBox=")
    ? String(svg).replace(/viewBox=(["'])[^"']+\1/i, `viewBox="${viewBox}"`)
    : String(svg).replace(/<svg\b([^>]*)>/i, `<svg$1 viewBox="${viewBox}">`);
}

function cadPreviewUrl(previewUrl) {
  if (!previewUrl) return "";
  const previewFile = path.join(CAD_PREVIEW_DIR, path.basename(String(previewUrl).split("?")[0]));
  const version = fs.existsSync(previewFile) ? Math.round(fs.statSync(previewFile).mtimeMs) : Date.now();
  return `${String(previewUrl).split("?")[0]}?v=${version}`;
}

function cadPreviewPageUrl(previewUrl, downloadUrl, name) {
  const sourceUrl = cadPreviewUrl(previewUrl);
  if (!sourceUrl) return "";
  return `/cad-preview.html?src=${encodeURIComponent(sourceUrl)}&download=${encodeURIComponent(downloadUrl)}&name=${encodeURIComponent(name)}`;
}

function normalizeCadColor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "white") return "#111827";
  const rgbMatch = text.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1).map(Number);
    return r > 220 && g > 220 && b > 220 ? "#111827" : value;
  }
  const hex = text.startsWith("#") ? text.slice(1) : "";
  const fullHex = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  if (!/^[0-9a-f]{6}$/.test(fullHex)) return value;
  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  return r > 220 && g > 220 && b > 220 ? "#111827" : value;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[char]));
}

function readDxfPairs(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const pairs = [];
  for (let index = 0; index < lines.length - 1; index += 2) {
    pairs.push({ code: lines[index].trim(), value: lines[index + 1].trim() });
  }
  return pairs;
}

function dxfNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dxfPoint(entity, xCode, yCode) {
  return { x: dxfNumber(entity[xCode]), y: dxfNumber(entity[yCode]) };
}

function addBounds(bounds, point) {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function createBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function mergeBounds(target, source) {
  addBounds(target, { x: source.minX, y: source.minY });
  addBounds(target, { x: source.maxX, y: source.maxY });
}

function boundsWidth(bounds) {
  return Math.max(0, bounds.maxX - bounds.minX);
}

function boundsHeight(bounds) {
  return Math.max(0, bounds.maxY - bounds.minY);
}

function boundsCenter(bounds) {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function boundsSize(bounds) {
  return Math.max(boundsWidth(bounds), boundsHeight(bounds));
}

function boundsScore(bounds) {
  return Math.max(1, boundsWidth(bounds)) * Math.max(1, boundsHeight(bounds));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dxfArcPath(cx, cy, radius, startDeg, endDeg) {
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const startPoint = { x: cx + radius * Math.cos(start), y: cy + radius * Math.sin(start) };
  const endPoint = { x: cx + radius * Math.cos(end), y: cy + radius * Math.sin(end) };
  const sweep = ((endDeg - startDeg + 360) % 360) || 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${startPoint.x} ${-startPoint.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endPoint.x} ${-endPoint.y}`;
}

function dxfEntityFromPairs(pairs, startIndex) {
  const type = pairs[startIndex].value;
  const entity = { type, vertices: [] };
  let index = startIndex + 1;
  for (; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (pair.code === "0") break;
    if (type === "LWPOLYLINE" && pair.code === "10") {
      const yPair = pairs[index + 1];
      if (yPair && yPair.code === "20") entity.vertices.push({ x: dxfNumber(pair.value), y: dxfNumber(yPair.value) });
    }
    entity[pair.code] = pair.value;
  }
  return { entity, nextIndex: index };
}

function dxfToSvg(text, title = "CAD 预览") {
  const pairs = readDxfPairs(text);
  const shapes = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index].code !== "0") continue;
    const type = pairs[index].value;
    if (type === "LINE") {
      const result = dxfEntityFromPairs(pairs, index);
      const start = dxfPoint(result.entity, "10", "20");
      const end = dxfPoint(result.entity, "11", "21");
      const bounds = createBounds();
      addBounds(bounds, start);
      addBounds(bounds, end);
      shapes.push({ markup: `<line x1="${start.x}" y1="${-start.y}" x2="${end.x}" y2="${-end.y}"/>`, bounds });
      index = result.nextIndex - 1;
    } else if (type === "LWPOLYLINE") {
      const result = dxfEntityFromPairs(pairs, index);
      if (result.entity.vertices.length > 1) {
        const bounds = createBounds();
        result.entity.vertices.forEach((point) => addBounds(bounds, point));
        const points = result.entity.vertices.map((point) => `${point.x},${-point.y}`).join(" ");
        const closed = (Number(result.entity["70"] || 0) & 1) === 1;
        shapes.push({ markup: `<polyline points="${points}"${closed ? " data-closed=\"true\"" : ""}/>`, bounds });
      }
      index = result.nextIndex - 1;
    } else if (type === "CIRCLE" || type === "ARC") {
      const result = dxfEntityFromPairs(pairs, index);
      const center = dxfPoint(result.entity, "10", "20");
      const radius = Math.abs(dxfNumber(result.entity["40"]));
      const bounds = createBounds();
      addBounds(bounds, { x: center.x - radius, y: center.y - radius });
      addBounds(bounds, { x: center.x + radius, y: center.y + radius });
      if (type === "CIRCLE") {
        shapes.push({ markup: `<circle cx="${center.x}" cy="${-center.y}" r="${radius}"/>`, bounds });
      } else {
        shapes.push({ markup: `<path d="${dxfArcPath(center.x, center.y, radius, dxfNumber(result.entity["50"]), dxfNumber(result.entity["51"]))}"/>`, bounds });
      }
      index = result.nextIndex - 1;
    }
  }
  if (!shapes.length) return "";
  const primary = shapes.reduce((best, item) => (boundsScore(item.bounds) > boundsScore(best.bounds) ? item : best), shapes[0]);
  const primaryCenter = boundsCenter(primary.bounds);
  const primarySize = Math.max(100, boundsSize(primary.bounds));
  const visibleShapes = shapes.filter((item) => {
    const itemSize = boundsSize(item.bounds);
    const maxDistance = Math.max(primarySize * 8, 500);
    return itemSize >= primarySize * 0.25 || distance(boundsCenter(item.bounds), primaryCenter) <= maxDistance;
  });
  const bounds = createBounds();
  visibleShapes.forEach((item) => mergeBounds(bounds, item.bounds));
  if (!Number.isFinite(bounds.minX)) return "";
  const padding = Math.max(10, (bounds.maxX - bounds.minX + bounds.maxY - bounds.minY) / 40);
  const minX = bounds.minX - padding;
  const minY = -bounds.maxY - padding;
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}"><title>${escapeXml(title)}</title><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#fff"/><g fill="none" stroke="#111827" stroke-width="0.25px" vector-effect="non-scaling-stroke">${visibleShapes.map((item) => item.markup).join("")}</g></svg>`;
}

function cadPreviewCommands(fileType) {
  const configured = CAD_PREVIEW_COMMAND ? [CAD_PREVIEW_COMMAND] : [];
  const defaults = String(fileType || "").toLowerCase() === "dxf" ? ["dxf2svg", "dwg2SVG"] : ["dwg2SVG"];
  return [...new Set([...configured, ...defaults])];
}

function runCadPreviewCommand(command, sourcePath, fileName) {
  return new Promise((resolve) => {
    const chunks = [];
    const errorChunks = [];
    let converter;
    try {
      converter = spawn(command, [sourcePath], { windowsHide: true });
    } catch (error) {
      resolve({ ok: false, error: String(error.message || error) });
      return;
    }
    converter.stdout.on("data", (chunk) => chunks.push(chunk));
    converter.stderr.on("data", (chunk) => errorChunks.push(chunk));
    converter.on("error", (error) => resolve({ ok: false, error: String(error.message || error) }));
    converter.on("close", (code) => {
      const svgText = Buffer.concat(chunks).toString("utf8");
      const stderr = Buffer.concat(errorChunks).toString("utf8").trim();
      if (code === 0 && svgText.includes("<svg")) {
        resolve({ ok: true, svgText });
        return;
      }
      console.error("CAD preview generation failed", {
        command,
        file: fileName,
        code,
        stderr: stderr.slice(0, 500),
      });
      resolve({ ok: false, error: stderr });
    });
  });
}

async function generateCadPreview(drawing) {
  if (!isCadDrawing(drawing.fileType)) return { previewUrl: "", previewError: "" };
  const fileName = drawing.fileName || path.basename(String(drawing.url || ""));
  const sourcePath = path.join(DRAWING_DIR, fileName);
  const targetPath = cadPreviewPath(fileName);
  if (!fs.existsSync(sourcePath)) return { previewUrl: "", previewError: "CAD 预览生成失败" };
  fs.mkdirSync(CAD_PREVIEW_DIR, { recursive: true });
  if (String(drawing.fileType || "").toLowerCase() === "dxf") {
    const previewSvg = dxfToSvg(fs.readFileSync(sourcePath, "utf8"), drawing.originalName || drawing.name || fileName);
    if (previewSvg) {
      writeUploadFile(targetPath, previewSvg);
      return { previewUrl: `/uploads/previews/${path.basename(targetPath)}`, previewError: "" };
    }
  }
  for (const command of cadPreviewCommands(drawing.fileType)) {
    const preview = await runCadPreviewCommand(command, sourcePath, fileName);
    if (!preview.ok) continue;
    writeUploadFile(targetPath, normalizeCadSvg(preview.svgText));
    return { previewUrl: `/uploads/previews/${path.basename(targetPath)}`, previewError: "" };
  }
  return { previewUrl: "", previewError: "CAD 预览生成失败" };
}


function currentUser(req, db) {
  const userId = req.headers["x-user-id"];
  return db.users.find((u) => u.id === userId && u.active);
}

function signTvViewerToken(user, audience = "mobile-tv") {
  if (!TV_VIEW_TOKEN_SECRET) return "";
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    audience,
    expiresAt: Date.now() + TV_VIEW_TOKEN_TTL_MS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", TV_VIEW_TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifiedViewerClaims(token) {
  if (!TV_VIEW_TOKEN_SECRET || !token) return null;
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", TV_VIEW_TOKEN_SECRET).update(payload).digest();
  let received;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.userId !== "string" || !data.audience || !Number.isFinite(Number(data.expiresAt)) || Number(data.expiresAt) <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function viewerFromToken(db, token) {
  const claims = verifiedViewerClaims(token);
  if (!claims) return null;
  const user = db.users.find((item) => item.id === claims.userId && item.active);
  return user ? { user, audience: claims.audience, expiresAt: Number(claims.expiresAt) } : null;
}

function dispatchViewerToken(req) {
  const authorization = String(req.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function tvViewerFromToken(db, token) {
  const viewer = viewerFromToken(db, token);
  return viewer && ["mobile-tv", "dispatch-board"].includes(viewer.audience) ? viewer.user : null;
}

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(roles, role);
}

function resolveUser(db, userId) {
  if (!userId) return null;
  const user = db.users.find((u) => u.id === userId);
  if (user) return { ...user, deleted: false };
  const deletedUser = (db.deletedUsers || []).find((u) => u.id === userId);
  return deletedUser ? { ...deletedUser, deleted: true } : null;
}

function qualityRouteMeta(db, route, indexes = null) {
  if (route.processName !== "质检") return {};
  const routes = indexes ? (indexes.routesByWorkOrder.get(route.workOrderId) || []) : db.routes.filter((item) => item.workOrderId === route.workOrderId);
  const sourceRoute = routes
    .filter((item) => item.processName !== "质检" && item.routeType !== "rework" && item.sequence < route.sequence)
    .sort((a, b) => b.sequence - a.sequence)[0];
  const reworkRoutes = routes.filter((item) => item.sourceQualityRouteId === route.id);
  const availableFromProduction = Number(sourceRoute?.completedQty || 0);
  const availableFromRework = reworkRoutes
    .filter((item) => item.status === "已完成")
    .reduce((sum, item) => sum + Number(item.completedQty || 0), 0);
  const submittedQty = (indexes ? (indexes.reportsByRoute.get(route.id) || []) : db.reports)
    .filter((item) => item.routeId === route.id && item.reportType === "quality")
    .reduce((sum, item) => sum + Number(item.submittedQty || 0), 0);
  const remainingQty = Math.max(0, Number(route.planQty || 0) - Number(route.completedQty || 0));
  const sourceCompleted = sourceRoute?.status === "已完成";
  return {
    sourceCompleted,
    inspectionAvailableQty: sourceCompleted ? Math.max(0, Math.min(remainingQty, availableFromProduction + availableFromRework - submittedQty)) : 0,
    pendingReworkQty: reworkRoutes
      .filter((item) => item.status !== "已完成")
      .reduce((sum, item) => sum + Math.max(0, Number(item.planQty || 0) - Number(item.completedQty || 0)), 0),
  };
}

function buildQualityIndexes(db) {
  const routesByWorkOrder = new Map();
  const reportsByRoute = new Map();
  for (const route of db.routes) {
    if (!routesByWorkOrder.has(route.workOrderId)) routesByWorkOrder.set(route.workOrderId, []);
    routesByWorkOrder.get(route.workOrderId).push(route);
  }
  for (const report of db.reports) {
    if (!reportsByRoute.has(report.routeId)) reportsByRoute.set(report.routeId, []);
    reportsByRoute.get(report.routeId).push(report);
  }
  return { routesByWorkOrder, reportsByRoute };
}

function enrichRoute(db, route, indexes = null) {
  return { ...route, ...qualityRouteMeta(db, route, indexes) };
}

function buildMyTasks(db, user) {
  const qualityIndexes = buildQualityIndexes(db);
  const workOrdersById = new Map(db.workOrders.map((item) => [item.id, item]));
  const ordersById = new Map(db.orders.map((item) => [item.id, item]));
  const workOrderIdsWithDrawings = new Set();
  const orderIdsWithDrawings = new Set();
  db.drawings.forEach((drawing) => {
    if (drawing.removedAt) return;
    if (drawing.workOrderId) workOrderIdsWithDrawings.add(drawing.workOrderId);
    if (drawing.orderId) orderIdsWithDrawings.add(drawing.orderId);
  });
  return (db.taskRoutes || db.routes).filter((route) => route.status !== "已完成" && canOperateRoute(user, route).ok).map((route) => {
    const workOrder = workOrdersById.get(route.workOrderId) || {};
    const order = ordersById.get(workOrder.orderId) || {};
    return {
      ...enrichRoute(db, route, qualityIndexes),
      workOrder: {
        workNo: workOrder.workNo || "",
        productName: workOrder.productName || "",
        order: { quantityUnit: order.quantityUnit },
        hasDrawings: workOrderIdsWithDrawings.has(workOrder.id) || orderIdsWithDrawings.has(order.id),
      },
    };
  });
}

function workOrderCompletedAt(db, workOrder, routes = db.routes) {
  if (workOrder.completedAt && !Number.isNaN(new Date(workOrder.completedAt).getTime())) return workOrder.completedAt;
  if (workOrder.status !== "已完成") return "";
  return routes
    .filter((route) => route.workOrderId === workOrder.id && route.status === "已完成")
    .map((route) => route.completedAt || route.lastReportedAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

function shanghaiDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = shanghaiDateFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function completionPeriodRange(period, now = new Date()) {
  const periodDays = { today: 1, "3d": 3, "7d": 7, "30d": 30 };
  if (!Object.hasOwn(periodDays, period)) return null;
  const days = periodDays[period];
  const to = shanghaiDateKey(now);
  const start = new Date(`${to}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { period, from: shanghaiDateKey(start), to };
}

function mobileCompletionData(db, period, includeItems, scope) {
  const range = scope ? scope.range : completionPeriodRange(period);
  if (!range) return null;
  const completed = (scope ? scope.completed : db.workOrders
    .filter((workOrder) => workOrder.status === "已完成")
    .map((workOrder) => ({ id: workOrder.id, completedAt: workOrderCompletedAt(db, workOrder) }))
    .filter((entry) => {
      const key = shanghaiDateKey(entry.completedAt);
      return key && key >= range.from && key <= range.to;
    }))
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const result = { ...range, count: completed.length };
  if (!includeItems) return result;
  const workOrdersById = new Map(db.workOrders.map((item) => [item.id, item]));
  const ordersById = new Map(db.orders.map((item) => [item.id, item]));
  const customersById = new Map(db.customers.map((item) => [item.id, item]));
  const incompleteOrders = new Set(db.workOrders.filter((item) => item.status !== "已完成").map((item) => item.orderId));
  result.items = completed.map(({ id, completedAt }) => {
    const workOrder = workOrdersById.get(id);
    const order = ordersById.get(workOrder.orderId) || {};
    const customer = customersById.get(order.customerId) || {};
    return {
      id: workOrder.id,
      workNo: workOrder.workNo,
      orderNo: order.orderNo || "",
      orderId: order.id || "",
      productName: workOrder.productName || order.productName || "",
      customerName: customer.name || "",
      planQty: Number(workOrder.planQty || 0),
      quantityUnit: normalizeQuantityUnit(order.quantityUnit),
      completedAt,
      status: orderFulfillmentStatus(workOrder, order),
      shippedAt: order.shippedAt || "",
      invoicedAt: order.invoicedAt || "",
      canUpdateFulfillment: Boolean(order.id && !incompleteOrders.has(order.id)),
    };
  });
  return result;
}

function enrich(db) {
  const ordersById = new Map();
  const customersById = new Map();
  const qualityIndexes = buildQualityIndexes(db);
  const routesByWorkOrder = new Map();
  const drawingsByWorkOrder = new Map();
  const drawingsByOrder = new Map();
  const workOrdersWithExceptions = new Set();
  for (const order of db.orders) if (!ordersById.has(order.id)) ordersById.set(order.id, order);
  for (const customer of db.customers) if (!customersById.has(customer.id)) customersById.set(customer.id, customer);
  for (let index = 0; index < db.drawings.length; index += 1) {
    const drawing = db.drawings[index];
    if (drawing.removedAt) continue;
    if (!drawingsByWorkOrder.has(drawing.workOrderId)) drawingsByWorkOrder.set(drawing.workOrderId, []);
    if (!drawingsByOrder.has(drawing.orderId)) drawingsByOrder.set(drawing.orderId, []);
    drawingsByWorkOrder.get(drawing.workOrderId).push(index);
    drawingsByOrder.get(drawing.orderId).push(index);
  }
  for (const exception of db.exceptions) if (exception.status !== '已解决') workOrdersWithExceptions.add(exception.workOrderId);
  const routes = db.routes.map((route) => enrichRoute(db, route, qualityIndexes));
  for (const route of routes) {
    if (!routesByWorkOrder.has(route.workOrderId)) routesByWorkOrder.set(route.workOrderId, []);
    routesByWorkOrder.get(route.workOrderId).push(route);
  }
  const workOrders = db.workOrders.map((wo) => {
    const order = ordersById.get(wo.orderId);
    const customer = order ? customersById.get(order.customerId) : null;
    const workOrderRoutes = (routesByWorkOrder.get(wo.id) || []).slice().sort((a, b) => a.sequence - b.sequence);
    const workDrawingIndexes = drawingsByWorkOrder.get(wo.id) || [];
    const orderDrawingIndexes = drawingsByOrder.get(wo.orderId) || [];
    const drawings = [];
    let workIndex = 0;
    let orderIndex = 0;
    while (workIndex < workDrawingIndexes.length || orderIndex < orderDrawingIndexes.length) {
      const workPosition = workDrawingIndexes[workIndex] ?? Infinity;
      const orderPosition = orderDrawingIndexes[orderIndex] ?? Infinity;
      const position = Math.min(workPosition, orderPosition);
      drawings.push(db.drawings[position]);
      if (workPosition === position) workIndex += 1;
      if (orderPosition === position) orderIndex += 1;
    }
    const done = workOrderRoutes.reduce((sum, r) => sum + Number(r.completedQty || 0), 0);
    const total = workOrderRoutes.reduce((sum, r) => sum + Number(r.planQty || 0), 0) || wo.planQty;
    const progress = Math.min(100, Math.round((done / total) * 100));
    const hasException = workOrdersWithExceptions.has(wo.id);
    const overdue = order && order.dueDate < today(0) && wo.status !== "已完成";
    return { ...wo, completedAt: workOrderCompletedAt(db, wo, qualityIndexes.routesByWorkOrder.get(wo.id) || []), order, customer, routes: workOrderRoutes, drawings, progress, hasException, overdue };
  });
  const cutoff = today(-29);
  const completionSourceSummary = workOrders
    .filter((workOrder) => workOrder.status === "已完成" && shanghaiDateKey(workOrder.completedAt) >= cutoff)
    .reduce((summary, workOrder) => {
      const origin = workOrder.order?.orderOrigin === "platform" ? "platform" : "factory";
      const channel = origin === "platform" ? workOrder.order?.sourceChannel : "factory_manual";
      summary.total += 1;
      summary[origin] += 1;
      if (Object.hasOwn(summary, channel)) summary[channel] += 1;
      return summary;
    }, { total: 0, factory: 0, platform: 0, factory_manual: 0, website: 0, order_platform: 0, miniprogram: 0 });
  return { ...db, routes, workOrders, completionSourceSummary };
}

function canManage(userOrRole) {
  if (typeof userOrRole === "string") return ["owner", "manager", "office", "admin"].includes(userOrRole);
  return getUserRoles(userOrRole).some((role) => ["owner", "manager", "office", "admin"].includes(role));
}

function canSupervise(userOrRole) {
  if (typeof userOrRole === "string") return ["owner", "manager", "admin"].includes(userOrRole);
  return getUserRoles(userOrRole).some((role) => ["owner", "manager", "admin"].includes(role));
}

function canDrive(user) {
  return Boolean(user && user.active !== false && (userHasRole(user, "driver") || canSupervise(user)));
}

function completedOrderWorkOrders(db, orderId) {
  const workOrders = db.workOrders.filter((workOrder) => workOrder.orderId === orderId);
  return workOrders.length > 0
    && workOrders.every((workOrder) => workOrder.creationStatus !== "pending" && workOrder.status === "已完成");
}

function deliveryAvailability(db, order) {
  if (!order || normalizedOrderSource(order).orderOrigin !== "platform") return { ok: false, error: "仅平台订单可以配送" };
  if (!completedOrderWorkOrders(db, order.id)) return { ok: false, error: "订单尚未完成生产" };
  if (!String(order.region || "").trim() || !String(order.deliveryAddress || "").trim()) return { ok: false, error: "订单缺少完整配送地址" };
  const delivery = db.deliveries.find((item) => item.orderId === order.id);
  if (delivery ? delivery.status !== "waiting" : Boolean(order.shippedAt)) return { ok: false, error: "订单已被领取或已完成配送" };
  return { ok: true, delivery };
}

function waitingDelivery(order) {
  const key = crypto.createHash("sha256").update(order.id).digest("hex");
  return {
    id: `delivery_${key}`, orderId: order.id, tripId: "", driverId: "", status: "waiting",
    addressSnapshot: { region: String(order.region || ""), deliveryAddress: String(order.deliveryAddress || "") },
    startedAt: "", deliveredAt: "", proofAttachmentIds: [], note: "", createdAt: order.createdAt || "",
  };
}

function deliveryOrderView(db, order, showWaiting = false) {
  const customer = db.customers.find((item) => item.id === order.customerId) || {};
  const delivery = db.deliveries.find((item) => item.orderId === order.id) || (showWaiting ? waitingDelivery(order) : null);
  return {
    ...order,
    customerName: customer.name || order.externalCustomer || "",
    customerPhone: customer.phone || order.externalPhone || "",
    delivery,
  };
}

function canForceDeleteWorkOrders(user) {
  return Boolean(user && user.active && user.phone === ULTIMATE_WORK_ORDER_ADMIN_PHONE);
}

function canDeleteCustomers(user) {
  return Boolean(user && user.active && user.phone === ULTIMATE_WORK_ORDER_ADMIN_PHONE);
}

function canViewRestrictedBoard(user) {
  const phone = String(user?.phone || "").replace(/\D/g, "").slice(-11);
  return Boolean(user && user.active && RESTRICTED_VIEW_PHONES.has(phone));
}

let financialAccessWarning = "";

function userPermissions(user, users = [], financialUserIds = {}) {
  const activeUsers = users.filter((item) => item && item.active !== false);
  const issues = ["罗朝波", "郑金波", "郑学良"]
    .map((name) => ({ name, count: activeUsers.filter((item) => item.name === name).length }))
    .filter((item) => item.count !== 1)
    .map((item) => `${item.name}:${item.count}`)
    .join(",");
  if (issues && issues !== financialAccessWarning) {
    console.warn(`[order-financials] financial access disabled for ambiguous/missing accounts: ${issues}`);
    financialAccessWarning = issues;
  }
  return {
    forceDeleteWorkOrders: canForceDeleteWorkOrders(user),
    editOrders: canSupervise(user),
    viewAuditLogs: canSupervise(user),
    deleteCustomers: canDeleteCustomers(user),
    viewTv: Boolean(user && user.active),
    viewBoardCustomer: canViewRestrictedBoard(user),
    manageCustomerFeedback: canViewRestrictedBoard(user),
    manageOrderFulfillment: canViewRestrictedBoard(user),
    manageDeliveries: canDrive(user),
    viewOrderFinancials: financialAccessUserIds(users, financialUserIds).has(String(user?.id || "")),
  };
}

function cleanAuditValue(value, depth = 0) {
  if (depth > 4) return "[omitted]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => cleanAuditValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result = {};
  Object.entries(value).forEach(([key, item]) => {
    if (/password|base64|dataurl|filecontent/i.test(key)) return;
    result[key] = cleanAuditValue(item, depth + 1);
  });
  return result;
}

function pruneAuditLogs(db, now = Date.now()) {
  const cutoff = now - AUDIT_RETENTION_MS;
  db.auditLogs = (db.auditLogs || []).filter((item) => {
    const createdAt = new Date(item.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}

function appendAudit(db, user, action, targetType, targetId, detail = {}) {
  pruneAuditLogs(db);
  db.auditLogs.push({
    id: id("log"),
    actorId: user?.id || "",
    action,
    targetType,
    targetId: targetId || "",
    detail: cleanAuditValue(detail),
    createdAt: new Date().toISOString(),
  });
}

function isShopWorker(userOrRole) {
  if (typeof userOrRole === "string") return rolePriority[userOrRole] > 0 && rolePriority[userOrRole] <= 30;
  return getUserRoles(userOrRole).some((role) => rolePriority[role] > 0 && rolePriority[role] <= 30);
}

function canOperateRoute(user, route) {
  if (!user || !route) return { ok: false, error: "请先登录" };
  if (route.assignedTo && route.assignedTo !== user.id) return { ok: false, error: "该工序已指定给其他员工" };
  if (canManage(user)) return { ok: true };
  const assignedRole = route.assignedRole || getProcessRole(route.processName);
  if (assignedRole && userHasRole(user, assignedRole)) return { ok: true };
  if (!assignedRole && userHasRole(user, "worker")) return { ok: true };
  return { ok: false, error: "当前岗位不能操作此工序" };
}

function canReportProcess(user, route) {
  const permission = canOperateRoute(user, route);
  if (!permission.ok) return permission;
  if (!canManage(user) && !isShopWorker(user)) return { ok: false, error: "无权报工" };
  return { ok: true };
}

function validateAssignee(db, processName, userId) {
  if (!userId) return { ok: true };
  const assignee = db.users.find((item) => item.id === userId && item.active !== false);
  if (!assignee) return { ok: false, error: "指定员工不存在或已停用" };
  const assignedRole = getProcessRole(processName);
  if (assignedRole && !userHasRole(assignee, assignedRole)) {
    return { ok: false, error: `${normalizeProcessName(processName)}工序只能派给${roles[assignedRole]}` };
  }
  return { ok: true, assignee };
}

function canReportRouteStatus(route) {
  if (!route) return { ok: false, error: "工序不存在" };
  if (route.status === "待开始") return { ok: false, error: "请先点击开始生产" };
  if (route.status === "暂停") return { ok: false, error: "工序已暂停，请先点击继续" };
  if (route.status === "已完成") return { ok: false, error: "该工序已完成，无需再报工" };
  if (route.status !== "进行中") return { ok: false, error: `当前状态为${route.status}，暂不能报工` };
  return { ok: true };
}

function routeQuantityComplete(route) {
  const planQty = Number(route?.planQty || 0);
  return planQty > 0 && Number(route?.completedQty || 0) >= planQty;
}

function routeHasOpenIssue(db, route) {
  if (route.routeType === "rework") return false;
  return (db.exceptions || []).some((item) =>
    item.status !== "已解决" && item.source !== "exception-only"
    && [item.routeId, item.issueRouteId, item.qualityRouteId, item.reworkRouteId].includes(route.id)
  );
}

function canonicalRouteStatus(db, route, preferredStatus = route.status) {
  if (routeHasOpenIssue(db, route)) {
    return preferredStatus === "返工" || route.status === "返工" ? "返工" : "异常";
  }
  if (routeQuantityComplete(route)) return "已完成";
  if (["已完成", "异常", "返工"].includes(preferredStatus)) {
    return Number(route.completedQty || 0) > 0 ? "进行中" : "待开始";
  }
  return preferredStatus;
}

function canReopenOrder(order) {
  return Boolean(order && !order.shippedAt && !order.invoicedAt && !["已发货", "已开票"].includes(order.status));
}

function reopenIncompleteRoute(db, route) {
  const planned = Number(route.planQty);
  const completed = Number(route.completedQty || 0);
  if (route.status !== "已完成" || route.routeType === "rework" || !Number.isFinite(planned) || planned <= 0 ||
      !Number.isFinite(completed) || completed < 0 || completed >= planned) return false;
  route.status = canonicalRouteStatus(db, route);
  route.completedAt = "";
  return true;
}

function reopenInFlightRoutes(db) {
  const reopenable = new Set(db.orders.filter(canReopenOrder).map((order) => order.id));
  const active = new Set(db.workOrders.filter((order) => order.creationStatus !== "pending" &&
    ["生产中", "异常"].includes(order.status) && reopenable.has(order.orderId)).map((order) => order.id));
  const reopened = new Set();
  for (const route of db.routes) {
    if (active.has(route.workOrderId) && reopenIncompleteRoute(db, route)) reopened.add(route.workOrderId);
  }
  for (const id of reopened) syncWorkOrder(db, id);
}

function validateRouteStatusChange(db, route, nextStatus) {
  const openIssue = routeHasOpenIssue(db, route);
  if (openIssue && !["异常", "返工"].includes(nextStatus)) {
    return { ok: false, error: "工序存在未解决异常或返工，不能修改为普通状态" };
  }
  if (!openIssue && routeQuantityComplete(route) && !["已完成", "异常", "返工"].includes(nextStatus)) {
    return { ok: false, error: "工序完成数量已达到计划数量，状态必须为已完成" };
  }
  if (!routeQuantityComplete(route) && nextStatus === "已完成") {
    return { ok: false, error: "工序完成数量未达到计划数量，不能设置为已完成" };
  }
  if (route.status === "已完成" && ["进行中", "暂停", "待开始"].includes(nextStatus)) {
    return { ok: false, error: "已完成工序不能恢复为进行中、暂停或待开始" };
  }
  return { ok: true };
}

function syncWorkOrder(db, workOrderId) {
  const routes = db.routes.filter((route) => route.workOrderId === workOrderId).sort((a, b) => a.sequence - b.sequence);
  const workOrder = db.workOrders.find((item) => item.id === workOrderId);
  if (!workOrder) return null;
  const active = routes.find((route) => route.status !== "已完成") || routes[routes.length - 1];
  workOrder.currentProcess = active ? active.processName : "";
  const hasOpenIssue = (db.exceptions || []).some((item) => item.workOrderId === workOrderId && item.status !== "已解决");
  if (hasOpenIssue || routes.some((route) => route.status === "异常")) workOrder.status = "异常";
  else if (routes.length && routes.every((route) => route.status === "已完成" && routeQuantityComplete(route))) workOrder.status = "已完成";
  else workOrder.status = "生产中";
  if (workOrder.status === "已完成" && !workOrder.completedAt) workOrder.completedAt = new Date().toISOString();
  if (workOrder.status !== "已完成") workOrder.completedAt = "";
  const order = db.orders.find((item) => item.id === workOrder.orderId);
  if (order) order.status = workOrder.status;
  return workOrder;
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDayLabel(key) {
  const parts = String(key || "").split("-");
  if (parts.length >= 3) return `${parts[1]}.${parts[2]}`;
  return key || "";
}

function dashboardProcessNames(db, source = "all", data = enrich(db)) {
  const activeWorkOrderIds = new Set(
    visibleProductionWorkOrders(data.workOrders, source).filter((workOrder) => workOrder.status !== "已完成").map((workOrder) => workOrder.id)
  );
  const usedNames = new Set(
    db.routes.filter((route) => activeWorkOrderIds.has(route.workOrderId)).map((route) => route.processName)
  );
  const names = new Set(
    db.processes.filter((process) => process.active !== false || usedNames.has(process.name)).map((process) => process.name)
  );
  usedNames.forEach((name) => names.add(name));
  return [...names].sort((a, b) => {
    const orderDiff = processOrderIndex(a) - processOrderIndex(b);
    if (orderDiff) return orderDiff;
    const processA = db.processes.find((process) => process.name === a);
    const processB = db.processes.find((process) => process.name === b);
    return Number(processA?.sort || Number.MAX_SAFE_INTEGER) - Number(processB?.sort || Number.MAX_SAFE_INTEGER)
      || a.localeCompare(b, "zh-Hans-CN");
  });
}

function buildProcessLoad(db, processNames = dashboardProcessNames(db), source = "all", enriched = null) {
  const todayKey = shanghaiDateKey(new Date());
  const data = enriched || enrich(db);
  const activeWorkOrderIds = new Set(
    visibleProductionWorkOrders(data.workOrders, source).filter((workOrder) => workOrder.status !== "已完成").map((workOrder) => workOrder.id)
  );
  return processNames.map((name) => {
    const process = db.processes.find((p) => p.name === name);
    const routes = db.routes.filter((r) => r.processName === name || (process && r.processId === process.id));
    const completedToday = routes.filter((route) => {
      if (route.status !== "已完成") return false;
      return shanghaiDateKey(route.completedAt || route.lastReportedAt || "") === todayKey;
    }).length;
    const remaining = routes.filter((route) => route.status !== "已完成" && activeWorkOrderIds.has(route.workOrderId)).length;
    return { name, completedToday, remaining, done: completedToday, todo: remaining };
  });
}

function dueInfo(order) {
  const dueDate = order?.dueDate;
  if (!dueDate) return { dueAt: 8640000000000000, dueLevel: "normal", dueLabel: "正常" };
  const dueAt = new Date(`${dueDate}T23:59:59`).getTime();
  const now = Date.now();
  if (Number.isNaN(dueAt)) return { dueAt: 8640000000000000, dueLevel: "normal", dueLabel: "正常" };
  const diff = dueAt - now;
  if (diff < 0) return { dueAt, dueLevel: "overdue", dueLabel: "延期" };
  if (diff <= 48 * 60 * 60 * 1000) return { dueAt, dueLevel: "urgent", dueLabel: "加急" };
  return { dueAt, dueLevel: "normal", dueLabel: "正常" };
}

function routeMeta(db, route, groupedReports = null, dashboardDate = null) {
  const reports = (groupedReports || db.reports.filter((r) => r.routeId === route.id)).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latest = reports[0];
  const reporter = latest ? resolveUser(db, latest.reporterId) : resolveUser(db, route.lastReporterId);
  const time = latest?.createdAt || route.completedAt || route.lastReportedAt || "";
  const currentDate = dashboardDate || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return {
    latestReport: latest || null,
    reporterName: reporter?.name || "",
    lastReportTime: time,
    lastReportTimeText: formatDateTime(time),
    targetFinishTimeText: formatDateTime(route.targetFinishTime),
    lastReportScheduleStatus: latest?.scheduleStatus || "",
    plannedStartDate: route.plannedStartDate || "",
    plannedEndDate: route.plannedEndDate || "",
    scheduleOverdue: route.status !== "已完成" && Boolean(route.plannedEndDate) && route.plannedEndDate < currentDate,
  };
}

function tvDrawingMeta(drawing) {
  return {
    id: drawing.id,
    name: drawing.originalName || drawing.name || path.basename(String(drawing.url || "")),
    fileType: String(drawing.fileType || "").toLowerCase(),
    contentType: drawing.contentType || "",
    previewError: drawing.previewError || "",
  };
}

function buildTvDashboard(db, showCustomer = false, source = "all") {
  const data = enrich(db);
  const visible = visibleProductionWorkOrders(data.workOrders, source);
  const openIssuesByWorkOrder = new Map();
  const fieldIssuesByRoute = new Map();
  for (const issue of db.exceptions) {
    if (issue.status === "已解决") continue;
    if (!openIssuesByWorkOrder.has(issue.workOrderId)) openIssuesByWorkOrder.set(issue.workOrderId, []);
    openIssuesByWorkOrder.get(issue.workOrderId).push(issue);
    if (issue.source === "exception-only") {
      const previous = fieldIssuesByRoute.get(issue.routeId);
      if (!previous || String(issue.createdAt).localeCompare(String(previous.createdAt)) > 0) fieldIssuesByRoute.set(issue.routeId, issue);
    }
  }
  const reportsByRoute = new Map();
  for (const report of db.reports) {
    if (!reportsByRoute.has(report.routeId)) reportsByRoute.set(report.routeId, []);
    reportsByRoute.get(report.routeId).push(report);
  }
  const dashboardDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const active = visible.filter((wo) => wo.status !== "已完成").map((wo) => {
    const openIssues = openIssuesByWorkOrder.get(wo.id) || [];
    const openQualityExceptions = openIssues.filter((item) => item.qualityRouteId || item.source === "quality-inspection");
    const routes = wo.routes.map((route) => {
      const meta = routeMeta(db, route, reportsByRoute.get(route.id) || [], dashboardDate);
      const progress = Math.min(100, Math.round((Number(route.completedQty || 0) / Number(route.planQty || 1)) * 100));
      const qualityIssueActive = openQualityExceptions.some((item) => item.qualityRouteId === route.id || item.issueRouteId === route.id);
      const issue = fieldIssuesByRoute.get(route.id);
      return { ...route, ...meta, progress, qualityIssueActive, fieldExceptionActive: Boolean(issue),
        fieldExceptionTime: issue?.createdAt || "", fieldExceptionReporter: issue ? (db.users.find((item) => item.id === issue.reporterId)?.name || "历史员工") : "" };
    });
    const customer = showCustomer ? wo.customer : { id: wo.customer?.id || wo.order?.customerId || "" };
    const { drawings, ...safeWorkOrder } = wo;
    return {
      ...safeWorkOrder,
      drawingCount: drawings.length,
      customer,
      ...dueInfo(wo.order),
      isRush: wo.order?.priority === "急单",
      routes,
    };
  }).sort((a, b) => a.dueAt - b.dueAt);
  const todayText = shanghaiDateKey(new Date());
  const completionCounts = new Map();
  for (const workOrder of visible) {
    const day = shanghaiDateKey(workOrder.completedAt);
    if (day) completionCounts.set(day, (completionCounts.get(day) || 0) + 1);
  }
  const finishedWorkOrdersToday = completionCounts.get(todayText) || 0;
  const delayed = active.filter((w) => w.dueLevel === "overdue");
  const urgent = active.filter((w) => w.dueLevel === "urgent");
  const rushOrders = active.filter((w) => w.isRush);
  const onTimeRate = active.length ? Math.round(((active.length - delayed.length) / active.length) * 100) : 100;
  const processLoad = buildProcessLoad(db, dashboardProcessNames(db, source, data), source, data);
  const waiting = processLoad.reduce((sum, process) => sum + process.remaining, 0);
  const statusDistribution = {
    active: active.length - delayed.length,
    delayed: delayed.length,
    finishedToday: finishedWorkOrdersToday,
    waiting,
  };
  const recentReports = db.reports
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12)
    .map((report) => {
      const route = db.routes.find((r) => r.id === report.routeId);
      const wo = data.workOrders.find((w) => w.id === report.workOrderId);
      const user = resolveUser(db, report.reporterId);
      return { ...report, routeName: route?.processName || "", workNo: wo?.workNo || "", productName: wo?.productName || "", reporterName: user?.name || "", timeText: formatDateTime(report.createdAt) };
    });
  const reportTrend = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(`${todayText}T00:00:00+08:00`);
    d.setUTCDate(d.getUTCDate() - (6 - index));
    const key = shanghaiDateKey(d);
    const value = completionCounts.get(key) || 0;
    return { key, label: shortDayLabel(key), value };
  });
  return {
    generatedAt: new Date().toISOString(),
    generatedAtText: formatDateTime(new Date().toISOString()),
    settings: { ...defaultSettings, ...(db.settings || {}) },
    summary: {
      activeWorkOrders: active.length,
      rushWorkOrders: rushOrders.length,
      delayedWorkOrders: delayed.length,
      urgentWorkOrders: urgent.length,
      waitingRoutes: waiting,
      totalWorkOrders: visible.length,
      onTimeRate,
      finishedToday: finishedWorkOrdersToday,
      finishedWorkOrdersToday,
    },
    processLoad,
    statusDistribution,
    reportTrend,
    activeOrders: active,
    delayedOrders: delayed.slice(0, 6),
    recentReports,
  };
}

const scheduleSubscribers = new Set();
function publishScheduleChange() {
  const context = rowTrialContext.getStore();
  if (context) {
    context.scheduleChanged = true;
    return;
  }
  for (const response of scheduleSubscribers) {
    if (!response.destroyed && !response.write(`event: schedule\ndata: {}\n\n`)) response.end();
  }
}

function reportSubmissionKey(body, userId) {
  if (typeof userId !== "string" || typeof body.routeId !== "string" || typeof body.submissionId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.submissionId)) return "";
  return `rep_${crypto.createHash("sha256").update(JSON.stringify([userId, body.routeId, body.submissionId])).digest("hex")}`;
}

function sendReportResult(res, db, body, result, proxyReport) {
  if (!proxyReport) return send(res, 200, result);
  const context = rowTrialContext.getStore();
  if (context?.scoped) {
    context.proxyReportResult = result;
    return send(res, 200, { ok: true });
  }
  return send(res, 200, { ...result, dashboard: buildTvDashboard(db, true, dashboardSource(body.source)) });
}

function dashboardSource(source) {
  return ["factory", "platform"].includes(source) ? source : "all";
}

function tvCacheKey(source, viewer) {
  const audience = !viewer ? "anonymous" : canViewRestrictedBoard(viewer) ? "restricted" : "authenticated";
  return `${source}:${audience}`;
}

function cachedTvDashboard(key) {
  const entry = tvDashboardCache.get(key);
  return entry?.expiresAt > Date.now() ? entry.value : null;
}

function sendTvDashboard(res, dashboard, params, cacheHit) {
  const total = dashboard.activeOrders.length;
  const requestedLimit = Number(params.get("limit"));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(24, requestedLimit) : total;
  return send(res, 200, {
    ...dashboard, activeOrderTotal: total, activeOrders: dashboard.activeOrders.slice(offset, offset + limit),
  }, { "X-TV-Cache": cacheHit ? "HIT" : "MISS" });
}

function invalidateCommittedRowReads(context) {
  if (!context?.saved) return;
  databaseRevision += 1;
  tvDashboardCache.clear();
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestId = res.getHeader("X-Request-ID") || crypto.randomUUID();
  res.setHeader("X-Request-ID", requestId);
  const requestStartedAt = Date.now();
  res.once("finish", () => {
    const durationMs = Date.now() - requestStartedAt;
    if (durationMs >= 1000 && url.pathname !== "/api/schedule-events") console.warn(JSON.stringify({ requestId, path: url.pathname, status: res.statusCode, durationMs }));
  });
  const requestRevision = rowTrialContext.getStore()?.readRevision ?? databaseRevision;
  let db;
  let dbReadMs = 0;
  try {
    const cacheableTvRequest = req.method === "GET" && ["/api/tv-viewer-token", "/api/tv-dashboard", "/api/schedule-events"].includes(url.pathname);
    const dbReadStartedAt = Date.now();
    db = await readDb(cacheableTvRequest ? TV_DASHBOARD_CACHE_TTL_MS : 0);
    dbReadMs = Date.now() - dbReadStartedAt;
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: "数据存储不可用" });
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/schedule-events") {
      const token = url.searchParams.get("viewerToken") || "";
      const viewer = viewerFromToken(db, token);
      if (!viewer || !["mobile-tv", "dispatch-board"].includes(viewer.audience)) return send(res, 401, { error: "看板身份已失效" });
      if (scheduleSubscribers.size >= 200) return send(res, 503, { error: "实时连接繁忙" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\nevent: ready\ndata: {}\n\n");
      scheduleSubscribers.add(res);
      const expiresAt = viewer.expiresAt;
      const heartbeat = setInterval(() => {
        if (Date.now() >= expiresAt) return res.end();
        res.write(": heartbeat\n\n");
      }, 15000);
      const cleanup = () => { clearInterval(heartbeat); scheduleSubscribers.delete(res); };
      res.on("close", cleanup);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/external/health") {
      return send(res, 200, { enabled: Boolean(BOBO_INTEGRATION_SECRET), service: "external-work-orders", processMode: "single-process" });
    }

    if (req.method === "POST" && url.pathname === "/api/external/work-orders") {
      const incoming = rowTrialContext.getStore()?.inbound || await readExternalOrder(req);
      if (incoming.error) return send(res, incoming.status, { error: incoming.error });
      const { input, nonce } = incoming;
      const result = await serializeExternalOrder(async () => {
        const currentDb = await readDb();
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        currentDb.integrationNonces = currentDb.integrationNonces.filter((item) => Date.parse(item.createdAt) >= cutoff);
        if (currentDb.integrationNonces.some((item) => item.nonce === nonce)) return { status: 401, data: { error: "集成请求已重放" } };
        currentDb.integrationNonces.push({ nonce, createdAt: new Date().toISOString() });
        const existing = currentDb.orders.find((item) => item.externalOrderNumber === input.externalOrderNumber || normalizeOrderNumber(item.orderNo) === normalizeOrderNumber(input.externalOrderNumber));
        if (existing) {
          if (!externalOrderMatches(existing, input)) return { status: 409, data: { error: "外部订单号已存在且内容不一致" }, save: true, db: currentDb };
          const workOrder = currentDb.workOrders.find((item) => item.orderId === existing.id);
          return { status: 200, data: { order: existing, workOrder, routes: currentDb.routes.filter((item) => item.workOrderId === workOrder?.id) }, save: true, db: currentDb };
        }
        let customer = currentDb.customers.find((item) => item.phone === input.phone && item.active !== false);
        if (!customer) {
          customer = { id: id("c"), name: input.customer, contact: input.customer, phone: input.phone, address: input.deliveryAddress, note: "平台订单自动创建", active: true };
          currentDb.customers.push(customer);
        }
        const createdAt = new Date().toISOString();
        const order = { id: id("o"), orderNo: input.externalOrderNumber, customerId: customer.id, productName: input.material || input.description || "非标钣金件", drawingNo: "", quantity: input.quantity, quantityUnit: "件", dueDate: input.expectedDate, priority: "普通", status: "待正式创建", note: input.description, createdAt, orderOrigin: "platform", sourceChannel: input.sourceChannel, externalOrderNumber: input.externalOrderNumber, externalCustomer: input.customer, externalPhone: input.phone, externalDescription: input.description, externalQuantity: input.quantity, externalExpectedDate: input.expectedDate, externalRegion: input.region, externalDeliveryAddress: input.deliveryAddress, material: input.material, dimensions: input.dimensions, region: input.region, deliveryAddress: input.deliveryAddress };
        const workOrder = { id: id("w"), workNo: input.externalOrderNumber, orderId: order.id, productName: order.productName, planQty: input.quantity, status: "待排产", creationStatus: "pending", currentProcess: "", assigneeId: "", qrToken: id("qr"), createdAt };
        currentDb.orders.push(order);
        currentDb.workOrders.push(workOrder);
        return { status: 201, data: { order, workOrder, routes: [] }, save: true, db: currentDb };
      });
      if (result.save) await writeDb(result.db);
      return send(res, result.status, result.data);
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await parseBody(req);
      const user = db.users.find((u) => u.phone === body.phone && u.password === body.password && u.active);
      if (!user) return send(res, 401, { error: "手机号或密码不正确" });
      appendAudit(db, user, "login", "user", user.id, { name: user.name, phone: user.phone });
      await writeDb(db);
      return send(res, 200, {
        user: {
          id: user.id,
          name: user.name,
          role: getPrimaryRole(user),
          roles: getUserRoles(user),
          roleName: roles[getPrimaryRole(user)],
          roleNames: getUserRoles(user).map((role) => roles[role]),
          viewBoardCustomer: canViewRestrictedBoard(user),
        },
        permissions: userPermissions(user, db.users, db.orderFinancialAccessUserIds),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/tv-viewer-token") {
      const viewer = currentUser(req, db);
      if (!viewer) return send(res, 401, { error: "请先登录" });
      const token = signTvViewerToken(viewer);
      if (!token) return send(res, 503, { error: "看板身份令牌未配置" });
      return send(res, 200, { token, expiresInSeconds: TV_VIEW_TOKEN_TTL_MS / 1000 });
    }

    if (req.method === "GET" && url.pathname === "/api/dispatch-board-token") {
      const viewer = currentUser(req, db);
      if (!viewer) return send(res, 401, { error: "请先登录" });
      if (!canViewRestrictedBoard(viewer)) return send(res, 403, { error: "无权使用派工看板" });
      const token = signTvViewerToken(viewer, "dispatch-board");
      if (!token) return send(res, 503, { error: "看板身份令牌未配置" });
      return send(res, 200, { token, expiresInSeconds: TV_VIEW_TOKEN_TTL_MS / 1000 });
    }

    if (req.method === "GET" && url.pathname === "/api/tv-dashboard") {
      const viewer = tvViewerFromToken(db, url.searchParams.get("viewerToken"));
      const source = dashboardSource(url.searchParams.get("source"));
      const cacheKey = tvCacheKey(source, viewer);
      const cached = cachedTvDashboard(cacheKey);
      const dashboard = cached || buildTvDashboard(db, canViewRestrictedBoard(viewer), source);
      if (!cached && requestRevision === databaseRevision) tvDashboardCache.set(cacheKey, { value: dashboard, expiresAt: Date.now() + TV_DASHBOARD_CACHE_TTL_MS });
      return sendTvDashboard(res, dashboard, url.searchParams, Boolean(cached));
    }

    const tvOrderDrawingsMatch = url.pathname.match(/^\/api\/tv-orders\/([^/]+)\/drawings$/);
    if (req.method === "GET" && tvOrderDrawingsMatch) {
      const viewer = validTvDrawingViewer(db, url.searchParams.get("viewerToken"));
      if (!viewer) return send(res, 401, { error: "看板身份已失效，请重新打开" });
      const workOrderId = decodeURIComponent(tvOrderDrawingsMatch[1]);
      const workOrder = visibleProductionWorkOrders(enrich(db).workOrders).find((item) => item.id === workOrderId);
      if (!workOrder) return send(res, 404, { error: "工单不存在" });
      return send(res, 200, { items: (workOrder.drawings || []).map(tvDrawingMeta) });
    }

    const tvDrawingFileMatch = url.pathname.match(/^\/api\/tv-drawings\/([^/]+)\/(file|preview-file)$/);
    if (req.method === "GET" && tvDrawingFileMatch) {
      const viewer = validTvDrawingViewer(db, url.searchParams.get("viewerToken"));
      if (!viewer) return send(res, 401, { error: "看板身份已失效，请重新打开" });
      const drawing = db.drawings.find((item) => item.id === decodeURIComponent(tvDrawingFileMatch[1]) && !item.removedAt);
      if (!drawing) return send(res, 404, { error: "图纸不存在" });
      const previewFile = tvDrawingFileMatch[2] === "preview-file";
      const sourceUrl = previewFile ? drawing.previewUrl : drawing.url;
      const filePath = sourceUrl ? path.normalize(path.join(PUBLIC, sourceUrl)) : "";
      if (!filePath.startsWith(PUBLIC)) return send(res, 403, { error: "图纸路径无效" });
      const downloadName = url.searchParams.get("download") === "1"
        ? drawing.originalName || drawing.name || path.basename(String(drawing.url || ""))
        : "";
      return sendLocalFile(res, filePath, previewFile ? "image/svg+xml; charset=utf-8" : drawingContentType(drawing, filePath), downloadName);
    }

    if (req.method === "POST" && url.pathname === "/api/tv-drawings/preview") {
      const authorization = String(req.headers.authorization || "");
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const viewer = validTvDrawingViewer(db, token);
      if (!viewer) return send(res, 401, { error: "看板身份已失效，请重新打开" });
      const body = await parseBody(req);
      const drawing = db.drawings.find((item) => item.id === body.drawingId && !item.removedAt);
      if (!drawing) return send(res, 404, { error: "图纸不存在" });
      if (isCadDrawing(drawing.fileType)) {
        const previewFile = drawing.previewUrl ? path.join(CAD_PREVIEW_DIR, path.basename(drawing.previewUrl)) : "";
        if (!previewFile || !fs.existsSync(previewFile)) {
          const preview = await generateCadPreview(drawing);
          drawing.previewUrl = preview.previewUrl;
          drawing.previewError = preview.previewError;
          await writeDb(db);
        }
      }
      const queryToken = encodeURIComponent(token);
      const hasCadPreview = isCadDrawing(drawing.fileType) && drawing.previewUrl && !drawing.previewError;
      return send(res, 200, {
        previewUrl: hasCadPreview
          ? `/api/tv-drawings/${encodeURIComponent(drawing.id)}/preview-file?viewerToken=${queryToken}`
          : `/api/tv-drawings/${encodeURIComponent(drawing.id)}/file?viewerToken=${queryToken}`,
        previewError: drawing.previewError || "",
      });
    }

    if (req.method === "POST" && url.pathname === "/api/dispatch-board/route-toggle") {
      const viewer = viewerFromToken(db, dispatchViewerToken(req));
      if (!viewer) return send(res, 401, { error: "派工看板身份已失效，请重新打开" });
      if (viewer.audience !== "dispatch-board" || !canViewRestrictedBoard(viewer.user)) {
        return send(res, 403, { error: "无权操作派工看板" });
      }
      const body = await parseBody(req);
      const route = db.routes.find((item) => item.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      if (route.status !== body.expectedStatus) return send(res, 409, { error: "工序状态已变化，正在刷新看板" });
      const nextStatus = ["待开始", "暂停"].includes(route.status)
        ? "进行中"
        : route.status === "进行中" ? "暂停" : "";
      if (!nextStatus) return send(res, 400, { error: "当前工序不能在派工看板中切换" });
      const statusValidation = validateRouteStatusChange(db, route, nextStatus);
      if (!statusValidation.ok) return send(res, 409, { error: statusValidation.error });
      const beforeStatus = route.status;
      route.status = nextStatus;
      if (nextStatus === "进行中" && !route.startedAt) route.startedAt = new Date().toISOString();
      if (nextStatus === "暂停") route.pausedAt = new Date().toISOString();
      syncWorkOrder(db, route.workOrderId);
      appendAudit(db, viewer.user, "dispatch-board-route-toggle", "route", route.id, {
        beforeStatus, afterStatus: nextStatus, planQty: Number(route.planQty || 0), completedQty: Number(route.completedQty || 0),
      });
      await writeDb(db);
      publishScheduleChange();
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/dispatch-board/route-schedule") {
      const authorization = String(req.headers.authorization || "");
      const viewer = viewerFromToken(db, authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
      if (!viewer) return send(res, 401, { error: "派工看板身份已失效，请重新打开" });
      if (viewer.audience !== "dispatch-board" || !canViewRestrictedBoard(viewer.user)) {
        return send(res, 403, { error: "无权操作派工看板" });
      }
      const body = await parseBody(req);
      const route = db.routes.find((item) => item.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      if (route.status === "已完成") return send(res, 400, { error: "已完成工序不能修改排期" });
      const before = {
        plannedStartDate: route.plannedStartDate || "",
        plannedEndDate: route.plannedEndDate || "",
      };
      if (before.plannedStartDate !== String(body.expectedStartDate || "") || before.plannedEndDate !== String(body.expectedEndDate || "")) {
        return send(res, 409, { error: "工序排期已被修改，请刷新后重试" });
      }
      const schedule = normalizeRouteSchedule(body.plannedStartDate, body.plannedEndDate);
      if (schedule.error) return send(res, 400, { error: schedule.error });
      route.plannedStartDate = schedule.plannedStartDate;
      route.plannedEndDate = schedule.plannedEndDate;
      appendAudit(db, viewer.user, "dispatch-board-route-schedule", "route", route.id, {
        before,
        after: { plannedStartDate: route.plannedStartDate, plannedEndDate: route.plannedEndDate },
      });
      await writeDb(db);
      publishScheduleChange();
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/dispatch-board/order-due-date") {
      const authorization = String(req.headers.authorization || "");
      const viewer = viewerFromToken(db, authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
      if (!viewer) return send(res, 401, { error: "派工看板身份已失效，请重新打开" });
      if (viewer.audience !== "dispatch-board" || !canViewRestrictedBoard(viewer.user)) {
        return send(res, 403, { error: "无权操作派工看板" });
      }
      const body = await parseBody(req);
      const order = db.orders.find((item) => item.id === body.orderId);
      if (!order) return send(res, 404, { error: "订单不存在" });
      const beforeDueDate = String(order.dueDate || "");
      if (beforeDueDate !== String(body.expectedDueDate || "")) return send(res, 409, { error: "订单交期已被修改，请刷新后重试" });
      const dueDate = normalizeDate(body.dueDate);
      if (!dueDate) return send(res, 400, { error: "交期格式请填写 YYYY/MM/DD" });
      order.dueDate = dueDate;
      appendAudit(db, viewer.user, "dispatch-board-order-due-date", "order", order.id, {
        beforeDueDate,
        afterDueDate: dueDate,
      });
      await writeDb(db);
      publishScheduleChange();
      const result = { ok: true, order, dashboard: buildTvDashboard(db, true, dashboardSource(body.source)) };
      const context = rowTrialContext.getStore();
      if (context) {
        context.dispatchDueDateResult = result;
        return send(res, 200, { ok: true });
      }
      return send(res, 200, result);
    }

    const qrRouteMatch = url.pathname.match(/^\/api\/qr\/route\/([^/]+)\.svg$/);
    if (req.method === "GET" && qrRouteMatch) {
      const route = db.routes.find((r) => r.id === decodeURIComponent(qrRouteMatch[1]));
      if (!route) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("工序不存在");
        return;
      }
      if (!route.qrToken) {
        route.qrToken = qrToken("rt");
        await writeDb(db);
      }
      const scanUrl = `${QR_BASE_URL.replace(/\/$/, "")}/scan.html?routeToken=${encodeURIComponent(route.qrToken)}`;
      const svg = makeQrSvg(scanUrl);
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-QR-Content": encodeURIComponent(scanUrl),
      });
      res.end(svg);
      return;
    }

    const weappQrRouteMatch = url.pathname.match(/^\/api\/qr\/route\/([^/]+)\/weapp\.png$/);
    if (req.method === "GET" && weappQrRouteMatch) {
      const route = db.routes.find((r) => r.id === decodeURIComponent(weappQrRouteMatch[1]));
      if (!route) return send(res, 404, { error: "工序不存在" });
      if (!route.qrToken) {
        route.qrToken = qrToken("rt");
        await writeDb(db);
      }
      try {
        const image = await getWeappCode(route);
        res.writeHead(200, {
          "Content-Type": image.contentType,
          "Content-Length": image.bytes.length,
          "Cache-Control": "private, max-age=86400",
        });
        res.end(image.bytes);
      } catch (error) {
        return send(res, 503, {
          error: error.message,
          code: "WEAPP_CODE_UNAVAILABLE",
          envVersion: WX_CODE_ENV_VERSION,
        });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/qr/resolve") {
      const token = url.searchParams.get("routeToken") || url.searchParams.get("token");
      const route = db.routes.find((r) => r.qrToken === token);
      if (!route) return send(res, 404, { error: "二维码无效或工序不存在" });
      const data = enrich(db);
      const workOrder = data.workOrders.find((w) => w.id === route.workOrderId);
      const scanUser = currentUser(req, db);
      const permission = scanUser ? canReportProcess(scanUser, route) : { ok: true };
      const statusPermission = canReportRouteStatus(route);
      const scanPermission = permission.ok ? statusPermission : permission;
      return send(res, 200, {
        routeId: route.id,
        route,
        workOrder,
        canReport: scanPermission.ok,
        permissionAllowed: permission.ok,
        processPermissionError: permission.error || "",
        statusAllowed: statusPermission.ok,
        statusError: statusPermission.error || "",
        permissionError: scanPermission.error || ""
      });
    }

    const dispatchReportRequest = ["/api/dispatch-board/report", "/api/dispatch-board/report-context", "/api/dispatch-board/report-upload"].includes(url.pathname);
    let user;
    if (dispatchReportRequest) {
      const authorization = String(req.headers.authorization || "");
      const viewer = viewerFromToken(db, authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
      if (!viewer || viewer.audience !== "dispatch-board") return send(res, 401, { error: "派工看板身份已失效，请重新打开" });
      if (!canManage(viewer.user) || !canViewRestrictedBoard(viewer.user)) return send(res, 403, { error: "无权代报工" });
      user = viewer.user;
    } else user = currentUser(req, db);
    if (!user) return send(res, 401, { error: "请先登录" });
    if (req.method === "GET" && url.pathname === "/api/report-context") {
      const route = db.routes.find((item) => item.id === url.searchParams.get("routeId"));
      if (!route) return send(res, 404, { error: "工序不存在" });
      const permission = canReportProcess(user, route);
      if (!permission.ok) return send(res, 403, { error: permission.error });
      const workOrder = db.workOrders.find((item) => item.id === route.workOrderId);
      if (!workOrder) return send(res, 404, { error: "工单不存在" });
      const order = db.orders.find((item) => item.id === workOrder.orderId);
      const routes = db.routes.filter((item) => item.workOrderId === workOrder.id && item.processName !== "质检" && item.routeType !== "rework")
        .map(({ id, processName, sequence, workOrderId }) => ({ id, processName, sequence, workOrderId }));
      return send(res, 200, {
        route: enrichRoute(db, route),
        workOrder: { workNo: workOrder.workNo, productName: workOrder.productName, order: { quantityUnit: order?.quantityUnit } },
        routes,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/dispatch-board/report-context") {
      const route = db.routes.find((item) => item.id === url.searchParams.get("routeId"));
      if (!route) return send(res, 404, { error: "工序不存在" });
      if (route.status !== "进行中") return send(res, 409, { error: "只有进行中的工序才能代报工，请刷新" });
      const workOrder = db.workOrders.find((item) => item.id === route.workOrderId);
      const order = db.orders.find((item) => item.id === workOrder?.orderId);
      return send(res, 200, { route: enrichRoute(db, route), workNo: workOrder?.workNo || "", productName: workOrder?.productName || "", quantityUnit: normalizeQuantityUnit(order?.quantityUnit), managerName: user.name,
        issueRoutes: db.routes.filter((item) => item.workOrderId === route.workOrderId && item.processName !== "质检" && item.routeType !== "rework").sort((a, b) => a.sequence - b.sequence).map((item) => ({ id: item.id, processName: item.processName, sequence: item.sequence })) });
    }
    res.viewOrderFinancials = financialAccessUserIds(db.users, db.orderFinancialAccessUserIds).has(String(user.id));

    if (req.method === "GET" && url.pathname === "/api/deliveries/available") {
      if (!canDrive(user)) return send(res, 403, { error: "无权查看配送任务" });
      const region = String(url.searchParams.get("region") || "").trim().toLowerCase();
      const orders = db.orders
        .filter((order) => deliveryAvailability(db, order).ok)
        .filter((order) => !region || `${order.region || ""} ${order.deliveryAddress || ""}`.toLowerCase().includes(region))
        .sort((a, b) => `${a.region || ""}${a.deliveryAddress || ""}${a.orderNo || ""}`.localeCompare(`${b.region || ""}${b.deliveryAddress || ""}${b.orderNo || ""}`, "zh-CN"))
        .map((order) => deliveryOrderView(db, order, Boolean(rowTrialContext.getStore()?.scoped)));
      return send(res, 200, { orders });
    }

    if (req.method === "GET" && url.pathname === "/api/deliveries/my") {
      if (!canDrive(user)) return send(res, 403, { error: "无权查看配送任务" });
      const deliveries = db.deliveries
        .filter((delivery) => canSupervise(user) || delivery.driverId === user.id)
        .filter((delivery) => ["delivering", "delivered"].includes(delivery.status))
        .map((delivery) => ({
          ...delivery,
          order: deliveryOrderView(db, db.orders.find((order) => order.id === delivery.orderId) || {}),
          proofAttachments: (delivery.proofAttachmentIds || []).map((attachmentId) => db.attachments.find((attachment) => attachment.id === attachmentId)).filter(Boolean),
        }))
        .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
      return send(res, 200, { deliveries });
    }

    if (req.method === "POST" && url.pathname === "/api/delivery-trips/start") {
      if (!canDrive(user)) return send(res, 403, { error: "无权领取配送任务" });
      const body = await parseBody(req);
      const orderIds = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(String).filter(Boolean))];
      if (!orderIds.length) return send(res, 400, { error: "请至少选择一个配送订单" });
      const result = await serializeDelivery(async () => {
        const currentDb = await readDb();
        const orders = orderIds.map((orderId) => currentDb.orders.find((order) => order.id === orderId));
        if (orders.some((order) => !order)) return { status: 404, data: { error: "配送订单不存在" } };
        const invalid = orders.map((order) => deliveryAvailability(currentDb, order)).find((item) => !item.ok);
        if (invalid) return { status: 409, data: { error: invalid.error } };
        const startedAt = new Date().toISOString();
        const trip = { id: id("trip"), driverId: user.id, status: "delivering", orderIds, startedAt, completedAt: "", createdAt: startedAt };
        const deliveries = orders.map((order) => {
          const existing = currentDb.deliveries.find((item) => item.orderId === order.id);
          const delivery = existing || (rowTrialContext.getStore()?.scoped
            ? waitingDelivery(order)
            : { id: id("delivery"), orderId: order.id, proofAttachmentIds: [], note: "", createdAt: startedAt });
          Object.assign(delivery, {
            tripId: trip.id,
            driverId: user.id,
            status: "delivering",
            addressSnapshot: { region: String(order.region || ""), deliveryAddress: String(order.deliveryAddress || "") },
            startedAt,
            deliveredAt: "",
          });
          if (!existing) currentDb.deliveries.push(delivery);
          const workOrder = currentDb.workOrders.find((item) => item.orderId === order.id);
          order.shippedAt ||= startedAt;
          order.shippedBy ||= user.id;
          order.status = orderFulfillmentStatus(workOrder, order);
          queuePlatformShipment(currentDb, order, workOrder, order.shippedAt);
          appendAudit(currentDb, user, "delivery-start", "delivery", delivery.id, { orderId: order.id, tripId: trip.id });
          return delivery;
        });
        currentDb.deliveryTrips.push(trip);
        await writeDb(currentDb);
        return { status: 201, data: { trip, delivery: deliveries[0], deliveries } };
      });
      if (result.status === 201) {
        setTimeout(() => void processPlatformWebhooks(), 50);
      }
      return send(res, result.status, result.data);
    }

    if (req.method === "POST" && url.pathname === "/api/deliveries/complete") {
      if (!canDrive(user)) return send(res, 403, { error: "无权确认送达" });
      const body = await parseBody(req);
      const photos = Array.isArray(body.photos) ? body.photos : [];
      if (photos.length < 1 || photos.length > 3) return send(res, 400, { error: "送达照片必须为 1 至 3 张" });
      if (photos.some((photo) => !/^data:image\/(?:png|jpe?g|gif);base64,/.test(String(photo.dataUrl || "")))) return send(res, 400, { error: "送达照片格式无效" });
      const result = await serializeDelivery(async () => {
        const currentDb = await readDb();
        const delivery = currentDb.deliveries.find((item) => item.orderId === String(body.orderId || ""));
        if (!delivery) return { status: 404, data: { error: "配送记录不存在" } };
        if (delivery.status !== "delivering") return { status: 409, data: { error: "订单不在配送中" } };
        if (!canSupervise(user) && delivery.driverId !== user.id) return { status: 403, data: { error: "该订单由其他司机配送" } };
        const order = currentDb.orders.find((item) => item.id === delivery.orderId);
        const workOrder = currentDb.workOrders.find((item) => item.orderId === order?.id);
        if (!order || !workOrder) return { status: 404, data: { error: "订单工单不存在" } };
        const createdAt = new Date().toISOString();
        const attachments = photos.map((photo) => {
          const saved = saveDataUrlFile(photo, { prefix: "delivery" });
          if (saved.error) throw new Error(saved.error);
          return { ...saved, id: id("att"), attachmentType: "delivery-proof", orderId: order.id, deliveryId: delivery.id, uploaderId: user.id, createdAt };
        });
        currentDb.attachments.push(...attachments);
        delivery.status = "delivered";
        delivery.deliveredAt = createdAt;
        delivery.deliveredBy = user.id;
        delivery.note = String(body.note || "").trim();
        delivery.proofAttachmentIds = attachments.map((attachment) => attachment.id);
        order.deliveredAt = createdAt;
        order.deliveredBy = user.id;
        const tripDeliveries = currentDb.deliveries.filter((item) => item.tripId === delivery.tripId);
        const trip = currentDb.deliveryTrips.find((item) => item.id === delivery.tripId);
        if (trip && tripDeliveries.every((item) => item.id === delivery.id || item.status === "delivered")) {
          trip.status = "completed";
          trip.completedAt = createdAt;
        }
        const webhookEvent = queuePlatformDeliveryCompleted(currentDb, order, workOrder, delivery);
        appendAudit(currentDb, user, "delivery-complete", "delivery", delivery.id, { orderId: order.id, tripId: delivery.tripId, proofAttachmentIds: delivery.proofAttachmentIds, note: delivery.note });
        await writeDb(currentDb);
        return { status: 200, data: { ok: true, delivery, trip, proofAttachments: attachments, platformSync: webhookEvent?.status || "not-applicable" } };
      }).catch((error) => ({ status: 400, data: { error: error.message } }));
      if (result.status === 200) setTimeout(() => void processPlatformWebhooks(), 50);
      return send(res, result.status, result.data);
    }

    if (req.method === "POST" && url.pathname === "/api/deliveries/release") {
      if (!canDrive(user)) return send(res, 403, { error: "无权退回配送任务" });
      const body = await parseBody(req);
      const reason = String(body.reason || "").trim();
      const result = await serializeDelivery(async () => {
        const currentDb = await readDb();
        const delivery = currentDb.deliveries.find((item) => item.orderId === String(body.orderId || ""));
        if (!delivery) return { status: 404, data: { error: "配送记录不存在" } };
        if (delivery.status === "delivered" && !canSupervise(user)) return { status: 409, data: { error: "司机不能撤销已送达记录" } };
        if (!["delivering", "delivered"].includes(delivery.status)) return { status: 409, data: { error: "配送记录当前不能退回" } };
        if (!canSupervise(user) && delivery.driverId !== user.id) return { status: 403, data: { error: "该订单由其他司机配送" } };
        if (canSupervise(user) && !reason) return { status: 400, data: { error: "管理者纠正状态必须填写原因" } };
        const before = { status: delivery.status, driverId: delivery.driverId, deliveredAt: delivery.deliveredAt || "" };
        const previousTripId = delivery.tripId;
        delivery.status = "waiting";
        delivery.tripId = "";
        delivery.driverId = "";
        delivery.startedAt = "";
        delivery.deliveredAt = "";
        delivery.deliveredBy = "";
        delivery.correctedAt = new Date().toISOString();
        delivery.correctionReason = reason;
        const order = currentDb.orders.find((item) => item.id === delivery.orderId);
        if (order) {
          order.deliveredAt = "";
          order.deliveredBy = "";
        }
        const trip = currentDb.deliveryTrips.find((item) => item.id === previousTripId);
        if (trip && !currentDb.deliveries.some((item) => item.tripId === trip.id && item.status === "delivering")) {
          trip.status = "completed";
          trip.completedAt ||= new Date().toISOString();
        }
        appendAudit(currentDb, user, "delivery-release", "delivery", delivery.id, { orderId: delivery.orderId, before, reason });
        await writeDb(currentDb);
        return { status: 200, data: { ok: true, delivery } };
      });
      return send(res, result.status, result.data);
    }

    if (req.method === "GET" && url.pathname === "/api/reports/management-export") {
      if (!canManage(user)) return send(res, 403, { error: "无权导出管理分析" });
      const {
        buildManagementReportData,
        buildManagementWorkbook,
        validateReportDateRange,
      } = require("./lib/management-report-export");
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      try {
        validateReportDateRange(from, to);
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
      try {
        const workbook = await buildManagementWorkbook(buildManagementReportData(db, from, to), {
          includeFinancials: userPermissions(user, db.users, db.orderFinancialAccessUserIds).viewOrderFinancials,
        });
        const filename = `波波工单报工管理分析_${from}_${to}.xlsx`;
        res.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Length": workbook.length,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "private, no-store",
        });
        res.end(workbook);
      } catch (error) {
        console.error("management report export failed", error);
        return send(res, 500, { error: "管理分析生成失败" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return send(res, 200, {
        user: {
          ...user,
          role: getPrimaryRole(user),
          roles: getUserRoles(user),
          roleName: roles[getPrimaryRole(user)],
          roleNames: getUserRoles(user).map((role) => roles[role]),
          viewBoardCustomer: canViewRestrictedBoard(user),
        },
        roles,
        permissions: userPermissions(user, db.users, db.orderFinancialAccessUserIds),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      appendAudit(db, user, "logout", "user", user.id, { name: user.name, phone: user.phone });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      const data = enrich(db);
      if (url.searchParams.get("scope") === "dashboard") {
        const { workOrders, routes, processes, drawings, exceptions } = data;
        return send(res, 200, {
          scope: "dashboard", workOrders, routes, processes, drawings,
          exceptions: exceptions.filter((item) => item.status !== "已解决"),
          permissions: userPermissions(user, db.users, db.orderFinancialAccessUserIds),
        });
      }
      delete data.auditLogs;
      if (!canViewRestrictedBoard(user)) delete data.customerFeedbacks;
      data.customers = db.customers.filter((customer) => customer.active !== false);
      const payload = { ...data, roles, permissions: userPermissions(user, db.users, db.orderFinancialAccessUserIds) };
      const context = rowTrialContext.getStore();
      if (context?.deferBootstrap) {
        context.bootstrapResult = payload;
        return send(res, 200, { ok: true });
      }
      return send(res, 200, payload);
    }

    if (req.method === "GET" && url.pathname === "/api/mobile/completions") {
      const period = String(url.searchParams.get("period") || "today");
      const includeItems = url.searchParams.get("includeItems") === "1";
      const result = mobileCompletionData(db, period, includeItems, rowTrialContext.getStore()?.completionScope);
      if (!result) return send(res, 400, { error: "完工统计时间范围不正确" });
      if (includeItems && !canViewRestrictedBoard(user)) return send(res, 403, { error: "无权查看完工详情" });
      if (includeItems) result.canManageOrderFulfillment = userPermissions(user, db.users, db.orderFinancialAccessUserIds).manageOrderFulfillment;
      return send(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/audit-logs") {
      if (!canSupervise(user)) return send(res, 403, { error: "无权查看操作日志" });
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") || 20)));
      const startDate = String(url.searchParams.get("startDate") || "");
      const endDate = String(url.searchParams.get("endDate") || "");
      const actorId = String(url.searchParams.get("actorId") || "");
      const action = String(url.searchParams.get("action") || "").toLowerCase();
      const keyword = String(url.searchParams.get("keyword") || "").toLowerCase();
      const sortBy = String(url.searchParams.get("sortBy") || "createdAt");
      const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
      const auditSorters = {
        createdAt: (item) => item.createdAt || "",
        actorName: (item) => item.actorName || "",
        action: (item) => item.action || "",
        target: (item) => `${item.targetType || ""}/${item.targetId || ""}`,
        detail: (item) => JSON.stringify(item.detail || {}),
      };
      if (!auditSorters[sortBy]) return send(res, 400, { error: "操作日志排序字段不正确" });
      if (DB_DRIVER === "mysql" || DB_DRIVER === "mysql_rows") {
        const pool = rowTrialContext.getStore()?.readOnlyConnection || createMysqlPool();
        const conditions = [];
        const params = [];
        const escapeLike = (value) => value.replace(/[!%_]/g, "!$&");
        if (startDate) { conditions.push("created_at >= CONCAT(?, ' 00:00:00')"); params.push(startDate); }
        if (endDate) { conditions.push("created_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)"); params.push(endDate); }
        if (actorId) { conditions.push("actor_id = ?"); params.push(actorId); }
        if (action) { conditions.push("LOWER(action) COLLATE utf8mb4_bin LIKE ? ESCAPE '!'"); params.push(`%${escapeLike(action)}%`); }
        if (keyword) {
          conditions.push("LOWER(CAST(payload AS CHAR CHARACTER SET utf8mb4)) COLLATE utf8mb4_bin LIKE ? ESCAPE '!'");
          params.push(`%${escapeLike(keyword)}%`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const [[countRows], [rows]] = await Promise.all([
          pool.execute(`SELECT COUNT(*) AS total FROM bobo_audit_logs_v2 ${where}`, params),
          (async () => {
            let orderBy = sortBy === "target" ? "CONCAT(target_type, '/', target_id)"
              : sortBy === "detail" ? "CAST(detail AS CHAR)"
                : sortBy === "action" ? "action" : "created_at";
            const orderParams = [];
            if (sortBy === "actorName") {
              const actors = new Map();
              for (const actor of [...db.users, ...db.deletedUsers]) if (!actors.has(actor.id)) actors.set(actor.id, actor.name || "未知用户");
              const names = [...new Set([...actors.values(), "未知用户"])].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
              const ranks = new Map(names.map((name, index) => [name, index]));
              const cases = [...actors].map(([id, name]) => {
                orderParams.push(id, ranks.get(name));
                return "WHEN ? THEN ?";
              }).join(" ");
              orderParams.push(ranks.get("未知用户"));
              orderBy = `CASE actor_id ${cases} ELSE ? END`;
            }
            const direction = sortDir === "asc" ? "ASC" : "DESC";
            const sql = `SELECT actor_id, payload FROM bobo_audit_logs_v2 ${where} ORDER BY ${orderBy} ${direction}, id ${direction} LIMIT ? OFFSET ?`;
            const result = await pool.execute(sql, [...params, ...orderParams, String(pageSize), String((page - 1) * pageSize)]);
            return result;
          })(),
        ]);
        const items = rows.map((item) => {
          const actor = resolveUser(db, item.actor_id);
          const original = typeof item.payload === "string" ? JSON.parse(item.payload) : item.payload;
          return {
            ...original,
            actorName: actor?.name || "未知用户",
            actorPhone: actor?.phone || "",
          };
        });
        return send(res, 200, { page, pageSize, total: Number(countRows[0].total), items });
      }
      const items = (db.auditLogs || [])
        .filter((item) => !startDate || String(item.createdAt || "").slice(0, 10) >= startDate)
        .filter((item) => !endDate || String(item.createdAt || "").slice(0, 10) <= endDate)
        .filter((item) => !actorId || item.actorId === actorId)
        .filter((item) => !action || String(item.action || "").toLowerCase().includes(action))
        .filter((item) => !keyword || JSON.stringify(item).toLowerCase().includes(keyword))
        .map((item) => {
          const actor = resolveUser(db, item.actorId);
          return { ...item, actorName: actor?.name || "未知用户", actorPhone: actor?.phone || "" };
        })
        .sort((a, b) => String(auditSorters[sortBy](a)).localeCompare(String(auditSorters[sortBy](b)), "zh-CN", { numeric: true }) * (sortDir === "asc" ? 1 : -1));
      const offset = (page - 1) * pageSize;
      return send(res, 200, { page, pageSize, total: items.length, items: items.slice(offset, offset + pageSize) });
    }

    if (req.method === "GET" && url.pathname === "/api/history/work-orders") {
      if (!canManage(user) && !userHasRole(user, "quality")) return send(res, 403, { error: "无权查看历史工单" });
      return send(res, 200, { items: workOrderHistoryItems(db, historyFilters(url), canViewRestrictedBoard(user)) });
    }

    if (req.method === "GET" && url.pathname === "/api/history/exceptions") {
      if (!canManage(user) && !userHasRole(user, "quality")) return send(res, 403, { error: "无权查看异常记录" });
      return send(res, 200, { items: exceptionHistoryItems(db, historyFilters(url)) });
    }

    if (req.method === "GET" && url.pathname === "/api/customer-feedbacks") {
      if (!canViewRestrictedBoard(user)) return send(res, 403, { error: "无权查看客户反馈" });
      return send(res, 200, { items: db.customerFeedbacks.slice().sort((a, b) => String(b.feedbackAt || b.createdAt).localeCompare(String(a.feedbackAt || a.createdAt))) });
    }

    if (req.method === "POST" && url.pathname === "/api/customer-feedbacks") {
      if (!canViewRestrictedBoard(user)) return send(res, 403, { error: "无权登记客户反馈" });
      const body = await parseBody(req);
      const workOrder = db.workOrders.find((item) => item.id === body.workOrderId && item.status === "已完成");
      const order = workOrder && db.orders.find((item) => item.id === workOrder.orderId && item.customerId === body.customerId);
      const route = workOrder && db.routes.find((item) => item.id === body.routeId && item.workOrderId === workOrder.id);
      const description = String(body.description || "").trim();
      const feedbackAt = normalizeDate(body.feedbackAt);
      if (!workOrder || !order) return send(res, 400, { error: "请选择已完成订单工单" });
      if (!route) return send(res, 400, { error: "请选择该工单的问题工序" });
      if (!feedbackAt || !description) return send(res, 400, { error: "反馈时间和问题描述必填" });
      const item = { id: id("cf"), customerId: order.customerId, orderId: order.id, workOrderId: workOrder.id, routeId: route.id, feedbackAt, description, images: Array.isArray(body.images) ? body.images : [], status: "待处理", solution: "", reporterId: user.id, createdAt: new Date().toISOString() };
      db.customerFeedbacks.push(item);
      appendAudit(db, user, "customer-feedback-create", "customer-feedback", item.id, { customerId: item.customerId, workOrderId: item.workOrderId, routeId: item.routeId, feedbackAt, description });
      await writeDb(db);
      return send(res, 200, { ok: true, item });
    }

    if (req.method === "POST" && url.pathname === "/api/customer-feedbacks/resolve") {
      if (!canViewRestrictedBoard(user)) return send(res, 403, { error: "无权处理客户反馈" });
      const body = await parseBody(req);
      const item = db.customerFeedbacks.find((entry) => entry.id === body.id);
      const solution = String(body.solution || "").trim();
      if (!item) return send(res, 404, { error: "客户反馈不存在" });
      if (!solution) return send(res, 400, { error: "请填写处理结果" });
      item.status = "已处理";
      item.solution = solution;
      item.resolvedBy = user.id;
      item.resolvedAt = new Date().toISOString();
      appendAudit(db, user, "customer-feedback-resolve", "customer-feedback", item.id, { solution });
      await writeDb(db);
      return send(res, 200, { ok: true, item });
    }

    if (req.method === "POST" && url.pathname === "/api/platform-orders/sync-processes") {
      if (!canSupervise(user)) return send(res, 403, { error: "无权同步平台工序" });
      const body = await parseBody(req);
      if (!String(body.orderNumber || "").trim() || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(body.requestId || ""))) return send(res, 400, { error: "请提供订单号及同步请求标识" });
      const result = await serializePlatformOrder(async () => {
        const currentDb = await readDb();
        const order = currentDb.orders.find(item => normalizedOrderSource(item).externalOrderNumber === body.orderNumber);
        const workOrder = currentDb.workOrders.find(item => item.orderId === order?.id && item.creationStatus !== "pending");
        const route = currentDb.routes.find(item => item.workOrderId === workOrder?.id);
        if (!order || !route) return { status: 404, data: { error: "未找到已建立工序的平台订单" } };
        queuePlatformProgress(currentDb, route, `sync-${order.id}-${body.requestId}`, new Date().toISOString());
        appendAudit(currentDb, user, "platform-process-sync", "order", order.id, { requestId: body.requestId });
        await writeDb(currentDb);
        return { status: 200, data: { ok: true, platformSync: "queued" } };
      });
      if (result.status === 200) setTimeout(() => void processPlatformWebhooks(), 50);
      return send(res, result.status, result.data);
    }

    if (req.method === "POST" && url.pathname === "/api/platform-orders/confirm") {
      if (!canSupervise(user)) return send(res, 403, { error: "无权确认平台订单" });
      const body = await parseBody(req);
      if (!Array.isArray(body.processIds) || !body.processIds.length) return send(res, 400, { error: "至少选择一道工序" });
      const processIds = [...new Set(body.processIds.map(String))];
      const result = await serializePlatformOrder(async () => {
        const currentDb = await readDb();
        const order = currentDb.orders.find((item) => item.id === body.orderId);
        const workOrder = currentDb.workOrders.find((item) => item.orderId === order?.id);
        if (!order || !workOrder || normalizedOrderSource(order).orderOrigin !== "platform") return { status: 404, data: { error: "平台订单不存在" } };
        if (workOrder.creationStatus !== "pending") return { status: 409, data: { error: "平台订单已正式创建" } };
        const selectedProcesses = processIds.map((processId) => currentDb.processes.find((process) => process.id === processId));
        if (selectedProcesses.some((process) => !process || process.active === false)) return { status: 400, data: { error: "所选工序不存在或已停用" } };
        if (!selectedProcesses.some((process) => process.name !== "质检")) return { status: 400, data: { error: "质检前至少选择一道生产工序" } };
        const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
        const productName = has("productName") ? String(body.productName || "").trim() : order.productName;
        const quantity = has("quantity") ? Number(body.quantity) : Number(order.quantity);
        const dueDate = has("dueDate") ? normalizeDate(body.dueDate) : order.dueDate;
        const priority = has("priority") ? String(body.priority || "").trim() : order.priority;
        if (!productName || !Number.isInteger(quantity) || quantity < 1 || !dueDate || !["普通", "急单"].includes(priority)) {
          return { status: 400, data: { error: "订单资料不完整或格式不正确" } };
        }
        Object.assign(order, {
          productName,
          quantity,
          dueDate,
          priority,
          note: has("note") ? String(body.note || "").trim() : order.note,
          region: has("region") ? String(body.region || "").trim() : order.region,
          deliveryAddress: has("deliveryAddress") ? String(body.deliveryAddress || "").trim() : order.deliveryAddress,
        });
        workOrder.productName = productName;
        workOrder.planQty = quantity;
        selectedProcesses.sort((a, b) => processOrderIndex(a.name) - processOrderIndex(b.name) || processIds.indexOf(a.id) - processIds.indexOf(b.id));
        const createdAt = new Date().toISOString();
        const routes = selectedProcesses.map((process, index) => ({
          id: id("r"), workOrderId: workOrder.id, processId: process.id, processName: normalizeProcessName(process.name),
          assignedRole: getProcessRole(process.name), sequence: index + 1, assignedTo: "", qrToken: qrToken("rt"), status: "待开始",
          planQty: Number(workOrder.planQty || order.quantity), completedQty: 0, goodQty: 0, badQty: 0, reworkQty: 0,
        }));
        currentDb.routes.push(...routes);
        workOrder.creationStatus = "confirmed";
        workOrder.confirmedAt = createdAt;
        workOrder.confirmedBy = user.id;
        syncWorkOrder(currentDb, workOrder.id);
        queuePlatformProgress(currentDb, routes[0], `plan-${workOrder.id}`, createdAt);
        appendAudit(currentDb, user, "platform-order-confirm", "order", order.id, { workOrderId: workOrder.id, processNames: routes.map((route) => route.processName) });
        await writeDb(currentDb);
        return { status: 200, data: { ok: true, order, workOrder, routes } };
      });
      return send(res, result.status, result.data);
    }

    if (req.method === "POST" && url.pathname === "/api/orders/fulfillment") {
      if (!canViewRestrictedBoard(user)) return send(res, 403, { error: "无权更新发货开票状态" });
      const body = await parseBody(req);
      const order = db.orders.find((item) => item.id === body.orderId);
      const workOrders = order ? db.workOrders.filter((item) => item.orderId === order.id) : [];
      if (!order || !workOrders.length) return send(res, 404, { error: "订单工单不存在" });
      if (workOrders.some((item) => item.status !== "已完成")) return send(res, 400, { error: "工单尚未完成" });
      const before = { shippedAt: order.shippedAt || "", invoicedAt: order.invoicedAt || "" };
      const now = new Date().toISOString();
      order.shippedAt = body.shipped === true ? order.shippedAt || now : "";
      order.shippedBy = body.shipped === true ? order.shippedBy || user.id : "";
      order.invoicedAt = body.invoiced === true ? order.invoicedAt || now : "";
      order.invoicedBy = body.invoiced === true ? order.invoicedBy || user.id : "";
      order.status = orderFulfillmentStatus(workOrders[0], order);
      appendAudit(db, user, "order-fulfillment-update", "order", order.id, { before, after: { shippedAt: order.shippedAt, invoicedAt: order.invoicedAt }, status: order.status });
      const shipmentEvent = body.shipped === true ? queuePlatformShipment(db, order, workOrders[0], order.shippedAt || now) : null;
      await writeDb(db);
      if (shipmentEvent && shipmentEvent.status !== "delivered") setTimeout(() => void processPlatformWebhooks(), 50);
      return send(res, 200, { ok: true, status: order.status, order, platformSync: shipmentEvent?.status || "not-applicable" });
    }

    if (req.method === "POST" && url.pathname === "/api/settings/tv") {
      if (!["admin", "manager", "owner"].includes(user.role)) return send(res, 403, { error: "无权维护看板设置" });
      const body = await parseBody(req);
      const allowedRatios = ["auto", "16:9", "16:10", "21:9", "4:3"];
      const seconds = Math.max(30, Math.min(600, Number(body.tvCarouselSeconds || defaultSettings.tvCarouselSeconds)));
      const tvDisplayRatio = allowedRatios.includes(body.tvDisplayRatio) ? body.tvDisplayRatio : defaultSettings.tvDisplayRatio;
      db.settings = {
        ...defaultSettings,
        ...(db.settings || {}),
        tvCarouselEnabled: body.tvCarouselEnabled !== false,
        tvCarouselSeconds: seconds,
        tvDisplayRatio,
      };
      appendAudit(db, user, "tv-settings-save", "settings", "tv", db.settings);
      await writeDb(db);
      return send(res, 200, { ok: true, settings: db.settings });
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      const data = enrich(db);
      const source = ["factory", "platform"].includes(url.searchParams.get("source")) ? url.searchParams.get("source") : "all";
      const workOrders = visibleProductionWorkOrders(data.workOrders, source);
      const openExceptions = db.exceptions.filter((e) => e.status !== "已解决").length;
      const overdue = workOrders.filter((w) => w.overdue).length;
      const active = workOrders.filter((w) => w.status !== "已完成").length;
      const finished = workOrders.filter((w) => w.status === "已完成").length;
      const processLoad = buildProcessLoad(db, dashboardProcessNames(db, source, data), source, data);
      return send(res, 200, { active, finished, overdue, openExceptions, processLoad, workOrders, permissions: userPermissions(user, db.users, db.orderFinancialAccessUserIds) });
    }

    if (req.method === "GET" && url.pathname === "/api/my-tasks") {
      return send(res, 200, { tasks: buildMyTasks(db, user) });
    }

    const routeDrawingsMatch = req.method === "GET" && url.pathname.match(/^\/api\/routes\/([^/]+)\/drawings$/);
    if (routeDrawingsMatch) {
      const routeId = decodeURIComponent(routeDrawingsMatch[1]);
      const route = db.routes.find((item) => item.id === routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const permission = canOperateRoute(user, route);
      if (!permission.ok) return send(res, 403, { error: permission.error });
      const workOrder = db.workOrders.find((item) => item.id === route.workOrderId);
      if (!workOrder) return send(res, 404, { error: "工单不存在" });
      const items = db.drawings.filter((item) =>
        !item.removedAt && (item.workOrderId === workOrder.id || item.orderId === workOrder.orderId)
      );
      return send(res, 200, { items });
    }

    if (req.method === "POST" && url.pathname === "/api/customers") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权维护客户" });
      const body = await parseBody(req);
      if (!body.name) return send(res, 400, { error: "客户名称必填" });
      const customer = { id: id("c"), name: body.name, contact: body.contact || "", phone: body.phone || "", address: body.address || "", note: body.note || "", active: true };
      db.customers.push(customer);
      appendAudit(db, user, "customer-create", "customer", customer.id, { name: customer.name, phone: customer.phone });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/customers/delete") {
      if (!canDeleteCustomers(user)) return send(res, 403, { error: "仅最高权限账号可以停用客户" });
      const body = await parseBody(req);
      const customer = db.customers.find((c) => c.id === body.customerId && c.active !== false);
      if (!customer) return send(res, 404, { error: "客户不存在" });
      customer.active = false;
      customer.deletedAt = new Date().toISOString();
      customer.deletedBy = user.id;
      appendAudit(db, user, "customer-deactivate", "customer", customer.id, { name: customer.name });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      if (!getUserRoles(user).some((role) => ["admin", "manager", "owner"].includes(role))) return send(res, 403, { error: "无权维护员工" });
      const body = await parseBody(req);
      const userRoles = normalizeRoles(Array.isArray(body.roles) ? body.roles : body.role);
      if (!body.name || !body.phone || userRoles.length === 0) return send(res, 400, { error: "姓名、手机号和岗位角色必填" });
      const inactiveUser = db.users.find((u) => u.phone === body.phone && u.active === false);
      if (inactiveUser) {
        inactiveUser.name = body.name;
        inactiveUser.roles = userRoles;
        inactiveUser.role = primaryRoleFromRoles(userRoles);
        inactiveUser.password = body.password || inactiveUser.password || "123456";
        inactiveUser.active = true;
        inactiveUser.deletedAt = "";
        inactiveUser.deletedBy = "";
        appendAudit(db, user, "user-reactivate", "user", inactiveUser.id, { name: inactiveUser.name, phone: inactiveUser.phone, roles: userRoles });
        await writeDb(db);
        return send(res, 200, { ok: true, user: inactiveUser });
      }
      if (db.users.some((u) => u.phone === body.phone)) return send(res, 400, { error: "手机号已存在" });
      const newUser = { id: id("u"), name: body.name, phone: body.phone, roles: userRoles, password: body.password || "123456", active: true };
      newUser.role = primaryRoleFromRoles(userRoles);
      db.users.push(newUser);
      appendAudit(db, user, "user-create", "user", newUser.id, { name: newUser.name, phone: newUser.phone, roles: userRoles });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/users/update-role") {
      if (!getUserRoles(user).some((role) => ["admin", "manager", "owner"].includes(role))) return send(res, 403, { error: "无权修改员工角色" });
      const body = await parseBody(req);
      const target = db.users.find((u) => u.id === body.userId && u.active !== false);
      if (!target) return send(res, 404, { error: "员工不存在" });
      if (target.id === user.id) return send(res, 400, { error: "不能修改当前登录账号角色" });
      const nextRoles = normalizeRoles(Array.isArray(body.roles) ? body.roles : body.role);
      if (nextRoles.length === 0) return send(res, 400, { error: "至少选择一个岗位角色" });
      const oldRoles = getUserRoles(target);
      target.roles = nextRoles;
      target.role = primaryRoleFromRoles(nextRoles);
      let clearedAssignments = 0;
      db.routes.forEach((route) => {
        const assignedRole = route.assignedRole || getProcessRole(route.processName);
        if (route.assignedTo === target.id && route.status !== "已完成" && assignedRole && !userHasRole(target, assignedRole)) {
          route.assignedTo = "";
          clearedAssignments += 1;
        }
      });
      appendAudit(db, user, "user-role-update", "user", target.id, { name: target.name, phone: target.phone, oldRoles, newRoles: nextRoles, clearedAssignments });
      await writeDb(db);
      return send(res, 200, { ok: true, user: target, clearedAssignments });
    }

    if (req.method === "POST" && url.pathname === "/api/users/delete") {
      if (!["admin", "manager", "owner"].includes(user.role)) return send(res, 403, { error: "无权删除员工" });
      const body = await parseBody(req);
      const target = db.users.find((u) => u.id === body.userId && u.active !== false);
      if (!target) return send(res, 404, { error: "员工不存在" });
      if (target.id === user.id) return send(res, 400, { error: "不能删除当前登录账号" });
      const deletedAt = new Date().toISOString();
      const deletedSnapshot = {
        id: target.id,
        name: target.name,
        phone: target.phone,
        role: target.role,
        roles: getUserRoles(target),
        roleName: roles[target.role] || target.role,
        deletedAt,
        deletedBy: user.id,
      };
      db.deletedUsers = (db.deletedUsers || []).filter((item) => item.id !== target.id);
      db.deletedUsers.push(deletedSnapshot);
      let clearedAssignments = 0;
      db.routes.forEach((route) => {
        if (route.assignedTo === target.id && route.status !== "已完成") {
          route.assignedTo = "";
          clearedAssignments += 1;
        }
      });
      db.users = db.users.filter((item) => item.id !== target.id);
      appendAudit(db, user, "user-delete", "user", target.id, { name: target.name, phone: target.phone, role: target.role, clearedAssignments });
      await writeDb(db);
      return send(res, 200, { ok: true, clearedAssignments });
    }

    if (req.method === "POST" && url.pathname === "/api/processes") {
      if (!["admin", "manager", "owner"].includes(user.role)) return send(res, 403, { error: "无权维护工序" });
      const body = await parseBody(req);
      const processName = normalizeProcessName(body.name);
      if (!processName) return send(res, 400, { error: "工序名称必填" });
      if (db.processes.some((process) => process.name === processName)) return send(res, 400, { error: "工序名称已存在" });
      const process = { id: id("p"), name: processName, sort: db.processes.length + 1, active: true };
      db.processes.push(process);
      appendAudit(db, user, "process-create", "process", process.id, { name: process.name });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/processes/update-status") {
      if (!getUserRoles(user).some((role) => ["admin", "manager", "owner"].includes(role))) return send(res, 403, { error: "无权维护工序" });
      const body = await parseBody(req);
      const process = db.processes.find((item) => item.id === body.processId && defaultProcesses.includes(item.name));
      if (!process) return send(res, 404, { error: "标准工序不存在" });
      if (typeof body.active !== "boolean") return send(res, 400, { error: "工序状态必须为布尔值" });
      process.active = body.active;
      appendAudit(db, user, "process-status-update", "process", process.id, { name: process.name, active: process.active });
      await writeDb(db);
      return send(res, 200, { ok: true, process });
    }

    if (req.method === "POST" && url.pathname === "/api/orders/repeat") {
      if (!canManage(user)) return send(res, 403, { error: "无权创建返单" });
      const body = await parseBody(req);
      const sourceWorkOrder = db.workOrders.find((item) => item.id === body.sourceWorkOrderId);
      if (!sourceWorkOrder) return send(res, 404, { error: "原工单不存在" });
      if (sourceWorkOrder.status !== "已完成") return send(res, 409, { error: "只有已完成工单可以返单" });
      const sourceOrder = db.orders.find((item) => item.id === sourceWorkOrder.orderId);
      if (!sourceOrder) return send(res, 404, { error: "原订单不存在" });
      const customer = db.customers.find((item) => item.id === sourceOrder.customerId && item.active !== false);
      if (!customer) return send(res, 409, { error: "原订单客户不存在或已停用" });

      const orderNo = String(body.orderNo || "").trim();
      const quantity = Number(body.quantity);
      const dueDate = normalizeDate(body.dueDate);
      const priority = String(body.priority || "").trim();
      const weight = normalizeWeightKg(body.weightKg);
      if (!orderNo) return send(res, 400, { error: "新订单号必填" });
      if (orderNo === sourceOrder.orderNo) return send(res, 409, { error: "新订单号不能与原订单号相同" });
      if (hasOrderNumberConflict(db.orders, orderNo)) return send(res, 409, { error: "订单号已存在" });
      if (!Number.isInteger(quantity) || quantity < 1) return send(res, 400, { error: "数量必须为大于 0 的整数" });
      if (!dueDate) return send(res, 400, { error: "交期格式请填写 YYYY/MM/DD" });
      if (!["普通", "急单"].includes(priority)) return send(res, 400, { error: "优先级不正确" });
      if (weight.error) return send(res, 400, { error: weight.error });

      const sourceRoutes = db.routes
        .filter((route) => route.workOrderId === sourceWorkOrder.id && route.routeType !== "rework")
        .sort((a, b) => a.sequence - b.sequence);
      if (!sourceRoutes.length) return send(res, 409, { error: "原工单没有可复制的正式工序" });
      const processes = sourceRoutes.map((route) => db.processes.find((process) => process.id === route.processId));
      if (processes.some((process) => !process || process.active === false)) return send(res, 409, { error: "原工单包含不存在或已停用的工序，请先处理工序配置" });

      const orderId = id("o");
      const workOrderId = id("w");
      const createdAt = new Date().toISOString();
      const order = {
        id: orderId,
        orderNo,
        customerId: sourceOrder.customerId,
        productName: sourceOrder.productName,
        drawingNo: sourceOrder.drawingNo || "",
        weightKg: weight.value,
        quantity,
        quantityUnit: normalizeQuantityUnit(sourceOrder.quantityUnit),
        dueDate,
        priority,
        status: "未开始",
        note: String(body.note || ""),
        createdAt,
        orderOrigin: normalizedOrderSource(sourceOrder).orderOrigin,
        sourceChannel: normalizedOrderSource(sourceOrder).sourceChannel,
        externalOrderNumber: "",
      };
      const workOrder = {
        id: workOrderId,
        workNo: orderNo,
        orderId,
        productName: sourceOrder.productName,
        planQty: quantity,
        status: "未开始",
        creationStatus: "confirmed",
        currentProcess: "",
        assigneeId: user.id,
        qrToken: id("qr"),
        createdAt,
      };
      const routes = sourceRoutes.map((sourceRoute, index) => ({
        id: id("r"),
        workOrderId,
        processId: sourceRoute.processId,
        processName: normalizeProcessName(sourceRoute.processName),
        assignedRole: getProcessRole(sourceRoute.processName),
        sequence: index + 1,
        assignedTo: "",
        qrToken: qrToken("rt"),
        status: "待开始",
        planQty: quantity,
        completedQty: 0,
        goodQty: 0,
        badQty: 0,
        reworkQty: 0,
      }));
      const sourceDrawings = db.drawings.filter((drawing) => !drawing.removedAt && (drawing.workOrderId === sourceWorkOrder.id || drawing.orderId === sourceOrder.id));
      const drawings = sourceDrawings.map((sourceDrawing) => {
        const drawing = {
          ...sourceDrawing,
          id: id("drw"),
          orderId,
          workOrderId,
          customerId: sourceOrder.customerId,
          uploaderId: user.id,
          createdAt,
        };
        delete drawing.removedAt;
        delete drawing.removedBy;
        return drawing;
      });
      const attachments = drawings.map((drawing) => ({ ...drawing, id: id("att"), attachmentType: "drawing" }));

      db.orders.push(order);
      db.workOrders.push(workOrder);
      db.routes.push(...routes);
      db.drawings.push(...drawings);
      db.attachments.push(...attachments);
      syncWorkOrder(db, workOrderId);
      appendAudit(db, user, "order-repeat-create", "order", orderId, {
        sourceOrderId: sourceOrder.id,
        sourceWorkOrderId: sourceWorkOrder.id,
        newOrderId: orderId,
        newWorkOrderId: workOrderId,
        orderNo,
        quantity,
        dueDate,
        priority,
        weightKg: weight.value,
        note: order.note,
        processNames: routes.map((route) => route.processName),
        drawingIds: drawings.map((drawing) => drawing.id),
      });
      await writeDb(db);
      return send(res, 200, { ok: true, order, workOrder, routes, drawings });
    }

    if (req.method === "POST" && url.pathname === "/api/orders/update") {
      if (!canSupervise(user)) return send(res, 403, { error: "无权编辑订单" });
      const body = await parseBody(req);
      const canEditFinancials = res.viewOrderFinancials;
      if (!canEditFinancials && (Object.hasOwn(body, "unitPrice") || Object.hasOwn(body, "totalAmount"))) {
        return send(res, 403, { error: "无权编辑订单金额" });
      }
      const order = db.orders.find((item) => item.id === body.orderId);
      if (!order) return send(res, 404, { error: "订单不存在" });
      const orderNo = String(body.orderNo || "").trim();
      if (normalizedOrderSource(order).orderOrigin === "platform" && orderNo !== order.orderNo) return send(res, 400, { error: "平台订单号不可修改" });
      const productName = String(body.productName || "").trim();
      const customer = db.customers.find((item) => item.id === body.customerId && item.active !== false);
      const dueDate = normalizeDate(body.dueDate);
      const weight = normalizeWeightKg(body.weightKg);
      const quantity = Number(body.quantity);
      if (!isValidQuantityUnit(body.quantityUnit)) return send(res, 400, { error: "数量单位仅支持件或套" });
      const quantityUnit = body.quantityUnit === undefined || String(body.quantityUnit).trim() === ""
        ? normalizeQuantityUnit(order.quantityUnit)
        : normalizeQuantityUnit(body.quantityUnit);
      if (!orderNo || !customer || !productName || !dueDate) return send(res, 400, { error: "订单号、客户、产品和交期必填" });
      if (weight.error) return send(res, 400, { error: weight.error });
      if (!Number.isInteger(quantity) || quantity < 1) return send(res, 400, { error: "数量必须为大于 0 的整数" });
      const orderNoChanged = normalizeOrderNumber(orderNo) !== normalizeOrderNumber(order.orderNo);
      if (orderNoChanged && hasOrderNumberConflict(db.orders, orderNo, order.id)) return send(res, 400, { error: "订单号已存在" });
      const priceResult = canEditFinancials && Object.hasOwn(body, "unitPrice")
        ? normalizeUnitPrice(body.unitPrice)
        : { value: order.unitPrice ?? null, error: "" };
      if (priceResult.error) return send(res, 400, { error: priceResult.error });
      const totalAmount = calculateOrderTotal(priceResult.value, quantity);
      if (priceResult.value !== null && totalAmount === null) return send(res, 400, { error: "订单总金额超出可处理范围" });

      const before = {
        orderNo: order.orderNo,
        customerId: order.customerId,
        productName: order.productName,
        quantity: order.quantity,
        quantityUnit: normalizeQuantityUnit(order.quantityUnit),
        drawingNo: order.drawingNo,
        weightKg: order.weightKg ?? null,
        dueDate: order.dueDate,
        priority: order.priority,
        note: order.note,
      };
      const oldOrderNo = order.orderNo;
      const savedOrderNo = orderNoChanged ? orderNo : order.orderNo;
      Object.assign(order, {
        orderNo: savedOrderNo,
        customerId: customer.id,
        productName,
        quantity,
        unitPrice: priceResult.value,
        totalAmount,
        quantityUnit,
        drawingNo: String(body.drawingNo || "").trim(),
        weightKg: weight.value,
        dueDate,
        priority: body.priority || order.priority,
        note: String(body.note || ""),
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      });
      const linkedWorkOrders = db.workOrders.filter((item) => item.orderId === order.id);
      linkedWorkOrders.forEach((workOrder) => {
        if (workOrder.workNo === oldOrderNo) workOrder.workNo = savedOrderNo;
        workOrder.productName = productName;
        workOrder.planQty = quantity;
      });
      const linkedWorkOrderIds = new Set(linkedWorkOrders.map((workOrder) => workOrder.id));
      const reopenedWorkOrders = new Set();
      db.routes.forEach((route) => {
        if (!linkedWorkOrderIds.has(route.workOrderId) || route.routeType === "rework") return;
        const increased = quantity > Number(route.planQty);
        route.planQty = quantity;
        if (increased && canReopenOrder(order) && reopenIncompleteRoute(db, route)) reopenedWorkOrders.add(route.workOrderId);
      });
      for (const id of reopenedWorkOrders) syncWorkOrder(db, id);

      const addedDrawings = [];
      [...new Set(Array.isArray(body.addDrawingIds) ? body.addDrawingIds : [])].forEach((drawingId) => {
        const drawing = db.drawings.find((item) => item.id === drawingId && !item.removedAt);
        if (!drawing) return;
        drawing.orderId = order.id;
        drawing.workOrderId = linkedWorkOrders[0]?.id || "";
        drawing.customerId = customer.id;
        addedDrawings.push({ id: drawing.id, name: drawing.name });
      });
      const removedDrawings = [];
      [...new Set(Array.isArray(body.removeDrawingIds) ? body.removeDrawingIds : [])].forEach((drawingId) => {
        const drawing = db.drawings.find((item) => item.id === drawingId && item.orderId === order.id && !item.removedAt);
        if (!drawing) return;
        drawing.removedAt = new Date().toISOString();
        drawing.removedBy = user.id;
        removedDrawings.push({ id: drawing.id, name: drawing.name });
      });
      appendAudit(db, user, "order-update", "order", order.id, {
        before,
        after: { orderNo: savedOrderNo, customerId: customer.id, productName, quantity, quantityUnit, drawingNo: order.drawingNo, weightKg: order.weightKg, dueDate, priority: order.priority, note: order.note },
        addedDrawings,
        removedDrawings,
      });
      await writeDb(db);
      if (reopenedWorkOrders.size) {
        const context = rowTrialContext.getStore();
        if (context) context.scheduleChanged = true;
        else publishScheduleChange();
      }
      return send(res, 200, { ok: true, order, workOrders: linkedWorkOrders });
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权创建订单" });
      const body = await parseBody(req);
      const canEditFinancials = res.viewOrderFinancials;
      if (!canEditFinancials && (Object.hasOwn(body, "unitPrice") || Object.hasOwn(body, "totalAmount"))) {
        return send(res, 403, { error: "无权填写订单金额" });
      }
      const priceResult = canEditFinancials ? normalizeUnitPrice(body.unitPrice) : { value: null, error: "" };
      if (priceResult.error) return send(res, 400, { error: priceResult.error });
      const orderNo = String(body.orderNo || "").trim();
      const productName = String(body.productName || "").trim();
      const weight = normalizeWeightKg(body.weightKg);
      if (!isValidQuantityUnit(body.quantityUnit)) return send(res, 400, { error: "数量单位仅支持件或套" });
      const quantityUnit = normalizeQuantityUnit(body.quantityUnit);
      if (!orderNo || !body.customerId || !productName || !body.quantity || !body.dueDate) return send(res, 400, { error: "订单号、客户、产品、数量和交期必填" });
      if (hasOrderNumberConflict(db.orders, orderNo)) return send(res, 400, { error: "订单号已存在" });
      if (weight.error) return send(res, 400, { error: weight.error });
      if (!db.customers.some((customer) => customer.id === body.customerId && customer.active !== false)) return send(res, 400, { error: "客户不存在或已停用" });
      const dueDate = normalizeDate(body.dueDate);
      if (!dueDate) return send(res, 400, { error: "交期格式请填写 YYYY/MM/DD" });
      if (!Array.isArray(body.processIds) || body.processIds.length === 0) return send(res, 400, { error: "至少选择一道工序" });
      const selectedProcesses = [...new Set(body.processIds)]
        .map((processId) => db.processes.find((process) => process.id === processId))
        .filter(Boolean);
      if (selectedProcesses.length !== new Set(body.processIds).size) return send(res, 400, { error: "所选工序不存在" });
      if (selectedProcesses.some((process) => process.active === false)) return send(res, 400, { error: "所选工序已停用，请刷新后重试" });
      if (!selectedProcesses.some((process) => process.name !== "质检")) return send(res, 400, { error: "质检前至少选择一道生产工序" });
      selectedProcesses.sort((a, b) => {
        const order = processOrderIndex(a.name) - processOrderIndex(b.name);
        return order || body.processIds.indexOf(a.id) - body.processIds.indexOf(b.id);
      });
      const orderId = id("o");
      const workOrderId = id("w");
      const createdAt = new Date().toISOString();
      const quantity = Number(body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return send(res, 400, { error: "数量必须为有效正数" });
      const totalAmount = calculateOrderTotal(priceResult.value, quantity);
      if (priceResult.value !== null && totalAmount === null) return send(res, 400, { error: "订单总金额超出可处理范围" });
      const order = { id: orderId, orderNo, customerId: body.customerId, productName, drawingNo: body.drawingNo || "", weightKg: weight.value, quantity, unitPrice: priceResult.value, totalAmount, quantityUnit, dueDate, priority: body.priority || "普通", status: "未开始", note: body.note || "", createdAt, orderOrigin: "factory", sourceChannel: "factory_manual", externalOrderNumber: "" };
      const workOrder = { id: workOrderId, workNo: String(body.workNo || orderNo).trim(), orderId, productName, planQty: Number(body.quantity), status: "未开始", creationStatus: "confirmed", currentProcess: "", assigneeId: user.id, qrToken: id("qr"), createdAt };
      db.orders.push(order);
      db.workOrders.push(workOrder);
      (Array.isArray(body.drawingIds) ? body.drawingIds : []).forEach((drawingId) => {
        const drawing = db.drawings.find((item) => item.id === drawingId);
        if (!drawing) return;
        drawing.orderId = orderId;
        drawing.workOrderId = workOrderId;
        drawing.customerId = body.customerId;
      });
      selectedProcesses.forEach((process, index) => {
          db.routes.push({
            id: id("r"),
            workOrderId,
            processId: process.id,
            processName: normalizeProcessName(process.name),
            assignedRole: getProcessRole(process.name),
            sequence: index + 1,
            assignedTo: "",
            qrToken: qrToken("rt"),
            status: "待开始",
            planQty: Number(body.quantity),
            completedQty: 0,
            goodQty: 0,
            badQty: 0,
            reworkQty: 0,
          });
      });
      syncWorkOrder(db, workOrderId);
      appendAudit(db, user, "order-create", "order", order.id, { orderNo, productName, customerId: body.customerId, quantity: order.quantity, quantityUnit, drawingIds: body.drawingIds || [] });
      await writeDb(db);
      return send(res, 200, { ok: true, order, workOrder });
    }

    if (req.method === "POST" && url.pathname === "/api/routes/publish-schedule") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权发布排期" });
      const body = await parseBody(req);
      const workOrder = db.workOrders.find((item) => item.id === body.workOrderId);
      if (!workOrder) return send(res, 409, { error: "工单不存在，请放弃草稿并刷新" });
      if (!Array.isArray(body.routes) || !body.routes.length) return send(res, 400, { error: "没有需要发布的排期" });
      const seen = new Set();
      const updates = [];
      for (const item of body.routes) {
        if (!item || typeof item.routeId !== "string" || seen.has(item.routeId)) return send(res, 400, { error: "工序ID无效或重复" });
        seen.add(item.routeId);
        const route = db.routes.find((entry) => entry.id === item.routeId && entry.workOrderId === workOrder.id);
        if (!route) return send(res, 409, { error: "工序不存在或不属于该工单，请放弃草稿并刷新", routeId: item.routeId });
        const beforeStart = String(route.plannedStartDate || "");
        const beforeEnd = String(route.plannedEndDate || route.targetFinishTime?.slice(0, 10) || "");
        if (beforeStart !== item.expectedStartDate || beforeEnd !== item.expectedEndDate) return send(res, 409, { error: route.processName + "排期已被修改，请放弃草稿并刷新", routeId: route.id });
        const schedule = normalizeRouteSchedule(item.plannedStartDate, item.plannedEndDate);
        if (schedule.error) return send(res, 400, { error: route.processName + "：" + schedule.error, routeId: route.id });
        updates.push({ route, schedule, beforeStart, beforeEnd });
      }
      for (const { route, schedule } of updates) {
        Object.assign(route, schedule);
        route.targetFinishTime = schedule.plannedEndDate ? schedule.plannedEndDate + "T23:00" : "";
      }
      appendAudit(db, user, "schedule-publish", "workOrder", workOrder.id, { routes: updates.map(({ route, beforeStart, beforeEnd }) => ({ routeId: route.id, beforeStart, beforeEnd, plannedStartDate: route.plannedStartDate, plannedEndDate: route.plannedEndDate })) });
      await writeDb(db);
      publishScheduleChange();
      return send(res, 200, { ok: true, routes: updates.map(({ route }) => route) });
    }

    if (req.method === "POST" && url.pathname === "/api/assign") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权派工" });
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const assigneePermission = validateAssignee(db, route.processName, body.userId || "");
      if (!assigneePermission.ok) return send(res, 400, { error: assigneePermission.error });
      const hasSchedule = ["plannedStartDate", "plannedEndDate", "targetFinishTime"].some((key) => Object.hasOwn(body, key));
      if (hasSchedule) {
        const targetFinishTime = body.targetFinishTime ? normalizeTargetFinishTime(body.targetFinishTime) : "";
        if (body.targetFinishTime && !targetFinishTime) return send(res, 400, { error: "目标完成时间格式不正确" });
        const schedule = normalizeRouteSchedule(body.plannedStartDate, body.plannedEndDate || targetFinishTime.slice(0, 10));
        if (schedule.error) return send(res, 400, { error: schedule.error });
        Object.assign(route, schedule, { targetFinishTime });
      }
      route.assignedRole = getProcessRole(route.processName);
      route.assignedTo = body.userId || "";
      appendAudit(db, user, "route-assign", "route", route.id, { assignedTo: route.assignedTo, targetFinishTime: route.targetFinishTime || "", plannedStartDate: route.plannedStartDate, plannedEndDate: route.plannedEndDate });
      await writeDb(db);
      publishScheduleChange();
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/routes") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权调整工艺路线" });
      const body = await parseBody(req);
      const workOrder = db.workOrders.find((w) => w.id === body.workOrderId);
      const process = db.processes.find((p) => p.id === body.processId);
      if (!workOrder) return send(res, 404, { error: "工单不存在" });
      if (!process) return send(res, 404, { error: "工序不存在" });
      if (process.active === false) return send(res, 400, { error: "该工序已停用，不能新增" });
      const assigneePermission = validateAssignee(db, process.name, body.assignedTo || "");
      if (!assigneePermission.ok) return send(res, 400, { error: assigneePermission.error });
      const targetFinishTime = body.targetFinishTime ? normalizeTargetFinishTime(body.targetFinishTime) : "";
      if (body.targetFinishTime && !targetFinishTime) return send(res, 400, { error: "目标完成时间格式不正确" });
      const schedule = normalizeRouteSchedule(body.plannedStartDate, body.plannedEndDate || targetFinishTime.slice(0, 10));
      if (schedule.error) return send(res, 400, { error: schedule.error });
      const existingRoutes = db.routes.filter((r) => r.workOrderId === workOrder.id);
      let sequence = Number(body.sequence || existingRoutes.length + 1);
      if (!body.sequence) {
        const laterRoute = existingRoutes
          .filter((route) => processOrderIndex(route.processName) > processOrderIndex(process.name))
          .sort((a, b) => a.sequence - b.sequence)[0];
        sequence = Number(laterRoute?.sequence || existingRoutes.length + 1);
      }
      db.routes
        .filter((r) => r.workOrderId === workOrder.id && r.sequence >= sequence)
        .forEach((r) => {
          r.sequence += 1;
        });
      const route = {
        id: id("r"),
        workOrderId: workOrder.id,
        processId: process.id,
        processName: normalizeProcessName(process.name),
        assignedRole: getProcessRole(process.name),
        sequence,
        assignedTo: body.assignedTo || "",
        qrToken: qrToken("rt"),
        targetFinishTime,
        plannedStartDate: schedule.plannedStartDate,
        plannedEndDate: schedule.plannedEndDate,
        status: "待开始",
        planQty: Number(body.planQty || workOrder.planQty || 0),
        completedQty: 0,
        goodQty: 0,
        badQty: 0,
        reworkQty: 0,
      };
      db.routes.push(route);
      syncWorkOrder(db, workOrder.id);
      appendAudit(db, user, "route-create", "route", route.id, { workOrderId: workOrder.id, processName: route.processName, sequence: route.sequence });
      await writeDb(db);
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/routes/delete") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权调整工艺路线" });
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      if (Number(route.completedQty || 0) > 0 || route.status === "已完成") return send(res, 400, { error: "已有报工的工序不能删除，可改为暂停或返工" });
      db.routes = db.routes.filter((r) => r.id !== route.id);
      db.routes
        .filter((r) => r.workOrderId === route.workOrderId)
        .sort((a, b) => a.sequence - b.sequence)
        .forEach((r, index) => {
          r.sequence = index + 1;
        });
      syncWorkOrder(db, route.workOrderId);
      appendAudit(db, user, "route-delete", "route", route.id, { workOrderId: route.workOrderId, processName: route.processName });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/work-orders/delete") {
      const forceDelete = canForceDeleteWorkOrders(user);
      if (!canManage(user.role) && !forceDelete) return send(res, 403, { error: "无权删除工单" });
      const body = await parseBody(req);
      const workOrder = db.workOrders.find((w) => w.id === body.workOrderId);
      if (!workOrder) return send(res, 404, { error: "工单不存在" });
      const hasReports = db.reports.some((report) => report.workOrderId === workOrder.id);
      const hasCompletedQty = db.routes.some((route) => route.workOrderId === workOrder.id && Number(route.completedQty || 0) > 0);
      if ((hasReports || hasCompletedQty) && !forceDelete) return send(res, 400, { error: "已有报工记录的工单不能删除" });
      const deletedReportCount = db.reports.filter((report) => report.workOrderId === workOrder.id).length;
      const deletedExceptionCount = db.exceptions.filter((item) => item.workOrderId === workOrder.id).length;
      db.reports = db.reports.filter((report) => report.workOrderId !== workOrder.id);
      db.routes = db.routes.filter((route) => route.workOrderId !== workOrder.id);
      db.exceptions = db.exceptions.filter((item) => item.workOrderId !== workOrder.id);
      db.workOrders = db.workOrders.filter((item) => item.id !== workOrder.id);
      if (!db.workOrders.some((item) => item.orderId === workOrder.orderId)) {
        db.orders = db.orders.filter((item) => item.id !== workOrder.orderId);
      }
      appendAudit(db, user, forceDelete ? "work-order-force-delete" : "work-order-delete", "workOrder", workOrder.id, { workNo: workOrder.workNo, orderId: workOrder.orderId, forceDelete, deletedReportCount, deletedExceptionCount });
      await writeDb(db);
      return send(res, 200, { ok: true, forceDelete });
    }

    if (req.method === "POST" && url.pathname === "/api/route-status") {
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const allowed = ["待开始", "进行中", "暂停", "返工", "异常", "已完成"];
      if (!allowed.includes(body.status)) return send(res, 400, { error: "工序状态不正确" });
      const operationPermission = canOperateRoute(user, route);
      if (!operationPermission.ok) return send(res, 403, { error: operationPermission.error });
      if (!isShopWorker(user) && !canManage(user)) return send(res, 403, { error: "无权修改工序状态" });
      if (isShopWorker(user) && !canManage(user)) {
        const validTransition =
          (route.status === "待开始" && body.status === "进行中") ||
          (route.status === "进行中" && body.status === "暂停") ||
          (route.status === "暂停" && body.status === "进行中");
        if (!validTransition) return send(res, 400, { error: "当前工序状态不允许该操作，请刷新后重试" });
      }
      const statusValidation = validateRouteStatusChange(db, route, body.status);
      if (!statusValidation.ok) return send(res, 409, { error: statusValidation.error });
      const beforeStatus = route.status;
      route.status = body.status;
      if (body.status === "进行中" && !route.startedAt) route.startedAt = new Date().toISOString();
      if (body.status === "暂停") route.pausedAt = new Date().toISOString();
      syncWorkOrder(db, route.workOrderId);
      appendAudit(db, user, "route-status", "route", route.id, {
        beforeStatus, afterStatus: route.status, planQty: Number(route.planQty || 0), completedQty: Number(route.completedQty || 0),
      });
      const dbWriteStartedAt = Date.now();
      await writeDb(db);
      const dbWriteMs = Date.now() - dbWriteStartedAt;
      return send(res, 200, { ok: true, route }, {
        "Server-Timing": `db-read;dur=${dbReadMs}, db-write;dur=${dbWriteMs}`,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/route-exceptions") {
      const body = await parseBody(req);
      const route = db.routes.find((item) => item.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const permission = canReportProcess(user, route);
      if (!permission.ok) return send(res, 403, { error: permission.error });
      if (route.processName === "质检" || route.status === "已完成") return send(res, 409, { error: "该工序不能仅异常上报" });
      const description = String(body.description || "").trim();
      if (!description) return send(res, 400, { error: "请填写异常说明" });
      const item = { id: id("e"), workOrderId: route.workOrderId, routeId: route.id,
        type: "现场异常", description, status: "待处理", reporterId: user.id,
        createdAt: new Date().toISOString(), images: Array.isArray(body.images) ? body.images : [], source: "exception-only" };
      db.exceptions.push(item);
      syncWorkOrder(db, route.workOrderId);
      appendAudit(db, user, "exception-only-create", "exception", item.id, { routeId: route.id, description });
      await writeDb(db);
      return send(res, 200, { ok: true, item });
    }

    if (req.method === "POST" && ["/api/report", "/api/dispatch-board/report"].includes(url.pathname)) {
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const proxyReport = url.pathname === "/api/dispatch-board/report";
      const permission = proxyReport ? { ok: true } : canReportProcess(user, route);
      if (!permission.ok) return send(res, 403, { error: permission.error });
      const submissionId = String(body.submissionId || "");
      const submissionHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const reportId = proxyReport ? "" : reportSubmissionKey(body, user.id);
      if (!proxyReport && body.submissionId !== undefined) {
        if (!reportId) return send(res, 400, { error: "报工提交标识无效" });
        const previous = db.reports.find((item) => item.id === reportId);
        if (previous) {
          if (previous.submissionHash !== submissionHash) return send(res, 409, { error: "该提交已处理，请重新发起报工" });
          return send(res, 200, { ok: true, route: previous.submissionRouteResult, report: previous });
        }
      }
      if (proxyReport) {
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(submissionId)) return send(res, 400, { error: "报工提交标识无效" });
        const previous = db.reports.find((item) => item.dispatchSubmissionId === submissionId && item.reporterId === user.id);
        if (previous) {
          if (previous.dispatchSubmissionHash !== submissionHash || previous.routeId !== route.id) return send(res, 409, { error: "该提交已处理，请关闭后重新打开报工窗口" });
          return sendReportResult(res, db, body, { ok: true, route, report: previous }, proxyReport);
        }
        if (route.status !== "进行中" || Number(body.expectedCompletedQty) !== Number(route.completedQty || 0)) return send(res, 409, { error: "工序状态或剩余数量已变化，请关闭后重新打开" });
        if (route.processName === "质检" && Number(body.expectedInspectionAvailableQty) !== qualityRouteMeta(db, route).inspectionAvailableQty) return send(res, 409, { error: "可送检数量已变化，请重新打开" });
      }
      for (const key of (route.processName === "质检" ? ["submittedQty", "inspectedQty", "goodQty", "badQty"] : ["completedQty", "reworkQty"])) {
        if (!Number.isFinite(Number(body[key] ?? (["reworkQty", "badQty"].includes(key) ? 0 : NaN)))) return send(res, 400, { error: "报工数量必须为有效数字" });
      }
      const beforeStatus = route.status;
      const isQuality = route.processName === "质检";
      const reportWorkOrder = db.workOrders.find((item) => item.id === route.workOrderId);
      const reportOrder = db.orders.find((item) => item.id === reportWorkOrder?.orderId);
      const reportQuantityUnit = normalizeQuantityUnit(reportOrder?.quantityUnit);
      if (body.autoStartQuality) {
        if (!isQuality || !canManage(user)) return send(res, 403, { error: "无权自动开启质检" });
        const qualityMeta = qualityRouteMeta(db, route);
        if (!qualityMeta.sourceCompleted) return send(res, 400, { error: "质检前一道工序尚未完成" });
        if (route.status === "待开始") {
          route.status = "进行中";
          route.startedAt = new Date().toISOString();
        }
      }
      const statusPermission = canReportRouteStatus(route);
      if (!statusPermission.ok) return send(res, 409, { error: statusPermission.error });
      let completedQty = Number(body.completedQty || 0);
      let submittedQty = 0;
      let inspectedQty = 0;
      let goodQty = 0;
      let badQty = 0;
      let reworkQty = Number(body.reworkQty || 0);
      let disposition = "";
      let qualityIssueRoute = null;
      const remainingQty = Math.max(0, Number(route.planQty) - Number(route.completedQty || 0));
      if (isQuality) {
        submittedQty = Number(body.submittedQty);
        inspectedQty = Number(body.inspectedQty);
        goodQty = Number(body.goodQty);
        badQty = Number(body.badQty || 0);
        disposition = String(body.disposition || "无需处理");
        if (submittedQty < 1 || inspectedQty < 1) return send(res, 400, { error: "送检数量和检验数量必须大于 0" });
        if (inspectedQty !== submittedQty) return send(res, 400, { error: "检验数量必须等于送检数量" });
        if (goodQty < 0 || badQty < 0 || goodQty + badQty !== inspectedQty) return send(res, 400, { error: "检验数量必须等于合格数量与不合格数量之和" });
        if (!["无需处理", "返工", "让步接收", "报废"].includes(disposition)) return send(res, 400, { error: "质检处理方式无效" });
        if (badQty > 0 && disposition === "无需处理") return send(res, 400, { error: "存在不合格品时必须选择处理方式" });
        if (badQty > 0 && !String(body.exceptionDescription || "").trim()) return send(res, 400, { error: "存在不合格品时必须填写问题说明" });
        const qualityMeta = qualityRouteMeta(db, route);
        if (submittedQty > qualityMeta.inspectionAvailableQty) return send(res, 400, { error: `本次最多可送检 ${qualityMeta.inspectionAvailableQty} ${reportQuantityUnit}` });
        if (badQty > 0) {
          const issueRouteId = body.issueRouteId || body.reworkTargetRouteId;
          qualityIssueRoute = db.routes.find((item) => item.id === issueRouteId && item.workOrderId === route.workOrderId && item.processName !== "质检" && item.routeType !== "rework");
          if (!qualityIssueRoute) return send(res, 400, { error: "请选择本工单的问题工序" });
        }
        if (disposition === "返工") {
          const targetRoute = db.routes.find((item) => item.id === body.reworkTargetRouteId && item.workOrderId === route.workOrderId && item.processName !== "质检" && item.routeType !== "rework");
          if (!targetRoute) return send(res, 400, { error: "请选择本工单的返工工序" });
          const targetProcess = db.processes.find((item) => item.id === targetRoute.processId || item.name === targetRoute.processName);
          if (!targetProcess || targetProcess.active === false) return send(res, 400, { error: "返工目标工序已停用" });
        }
        completedQty = goodQty + (disposition === "让步接收" ? badQty : 0);
        reworkQty = disposition === "返工" ? badQty : 0;
      } else {
        if (!completedQty || completedQty < 1) return send(res, 400, { error: "完成数量必须大于 0" });
        if (reworkQty < 0 || reworkQty > completedQty) return send(res, 400, { error: "返工数量不能超过完成数量" });
      }
      if (completedQty > remainingQty) return send(res, 400, { error: "本次计入完成的数量不能超过剩余数量" });
      route.completedQty = Math.min(Number(route.planQty), Number(route.completedQty || 0) + completedQty);
      route.goodQty = Number(route.goodQty || 0) + goodQty;
      route.badQty = Number(route.badQty || 0) + badQty;
      route.reworkQty = Number(route.reworkQty || 0) + reworkQty;
      route.lastReportedAt = new Date().toISOString();
      route.lastReporterId = user.id;
      route.status = canonicalRouteStatus(db, route, "进行中");
      if (route.status === "已完成") route.completedAt = route.lastReportedAt;
      const schedule = reportSchedule(route, route.lastReportedAt);
      const report = {
        id: reportId || id("rep"),
        routeId: route.id,
        workOrderId: route.workOrderId,
        reporterId: user.id,
        reportType: isQuality ? "quality" : "production",
        completedQty,
        submittedQty,
        inspectedQty,
        goodQty,
        badQty,
        reworkQty,
        disposition,
        reworkTargetRouteId: isQuality && disposition === "返工" ? body.reworkTargetRouteId : "",
        note: body.note || "",
        images: body.images || [],
        createdAt: route.lastReportedAt,
        ...schedule,
      };
      db.reports.push(report);
      let reworkRoute = null;
      if (isQuality && disposition === "返工" && badQty > 0) {
        const targetRoute = db.routes.find((item) => item.id === body.reworkTargetRouteId);
        db.routes
          .filter((item) => item.workOrderId === route.workOrderId && item.sequence >= route.sequence)
          .forEach((item) => {
            item.sequence += 1;
          });
        reworkRoute = {
          id: id("r"),
          workOrderId: route.workOrderId,
          processId: targetRoute.processId,
          processName: targetRoute.processName,
          assignedRole: getProcessRole(targetRoute.processName),
          sequence: route.sequence - 1,
          assignedTo: "",
          qrToken: qrToken("rt"),
          status: "待开始",
          planQty: badQty,
          completedQty: 0,
          goodQty: 0,
          badQty: 0,
          reworkQty: 0,
          routeType: "rework",
          sourceQualityRouteId: route.id,
          sourceQualityReportId: report.id,
          reworkOfRouteId: targetRoute.id,
        };
        db.routes.push(reworkRoute);
      }
      if (isQuality && badQty > 0) {
        db.exceptions.push({
          id: id("e"),
          workOrderId: route.workOrderId,
          routeId: reworkRoute ? reworkRoute.id : qualityIssueRoute.id,
          qualityRouteId: route.id,
          qualityReportId: report.id,
          reworkRouteId: reworkRoute ? reworkRoute.id : "",
          type: body.exceptionType || qualityIssueRoute.processName || `质检${disposition}`,
          description: String(body.exceptionDescription || "").trim(),
          status: "待处理",
          reporterId: user.id,
          createdAt: route.lastReportedAt,
          images: body.images || [],
          badQty,
          reworkQty,
          disposition,
          issueRouteId: qualityIssueRoute.id,
          reworkTargetRouteId: reworkRoute ? body.reworkTargetRouteId : "",
        });
      } else if (!isQuality && (body.exceptionType || body.exceptionDescription)) {
        route.status = "异常";
        db.exceptions.push({ id: id("e"), workOrderId: route.workOrderId, routeId: route.id, type: body.exceptionType || "现场异常", description: body.exceptionDescription || body.note || "", status: "待处理", reporterId: user.id, createdAt: new Date().toISOString(), images: body.images || [] });
      }
      if (route.status === "已完成" && route.routeType === "rework") {
        db.exceptions
          .filter((item) => item.reworkRouteId === route.id && item.status !== "已解决")
          .forEach((item) => {
            item.status = "已解决";
            item.solution = "返工任务已完成，等待重新质检";
            item.resolvedBy = user.id;
            item.resolvedAt = route.completedAt;
          });
      }
      syncWorkOrder(db, route.workOrderId);
      queuePlatformProgress(db, route, report.id, report.createdAt);
      appendAudit(db, user, "report-create", "report", report.id, {
        routeId: route.id,
        workOrderId: route.workOrderId,
        processName: route.processName,
        beforeStatus,
        afterStatus: route.status,
        planQty: Number(route.planQty || 0),
        routeCompletedQty: Number(route.completedQty || 0),
        completedQty: report.completedQty,
        submittedQty: report.submittedQty,
        inspectedQty: report.inspectedQty,
        goodQty: report.goodQty,
        badQty: report.badQty,
        reworkQty: report.reworkQty,
      });
      if (proxyReport) {
        report.dispatchSubmissionId = submissionId;
        report.dispatchSubmissionHash = submissionHash;
        report.dispatchRouteResult = { ...route };
        report.source = "dispatch-board";
        appendAudit(db, user, "dispatch-report-create", "report", report.id, { routeId: route.id, submissionId, managerId: user.id });
      }
      if (reportId) {
        report.submissionHash = submissionHash;
        report.submissionRouteResult = { ...route };
      }
      await writeDb(db);
      const scoped = rowTrialContext.getStore()?.scoped;
      if (!scoped) {
        publishScheduleChange();
        setTimeout(() => void processPlatformWebhooks(), 50);
      }
      return sendReportResult(res, db, body, { ok: true, route, report }, proxyReport);
    }

    if (req.method === "POST" && url.pathname === "/api/exceptions/resolve") {
      if (!["manager", "quality", "admin", "owner"].includes(user.role)) return send(res, 403, { error: "无权处理异常" });
      const body = await parseBody(req);
      const item = db.exceptions.find((e) => e.id === body.id);
      if (!item) return send(res, 404, { error: "异常不存在" });
      const route = db.routes.find((r) => r.id === item.routeId);
      const beforeStatus = route?.status || "";
      item.status = body.status || "已解决";
      item.solution = body.solution || "";
      item.resolvedBy = user.id;
      item.resolvedAt = new Date().toISOString();
      if (route && item.status === "已解决" && ["异常", "返工"].includes(route.status)) {
        route.status = canonicalRouteStatus(db, route, "进行中");
      }
      if (route) syncWorkOrder(db, route.workOrderId);
      appendAudit(db, user, "exception-resolve", "exception", item.id, {
        status: item.status, solution: item.solution, workOrderId: item.workOrderId, routeId: item.routeId,
        beforeStatus, afterStatus: route?.status || "", planQty: Number(route?.planQty || 0), completedQty: Number(route?.completedQty || 0),
      });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/exceptions") {
      if (!["manager", "quality", "admin", "owner"].includes(user.role)) return send(res, 403, { error: "无权登记异常" });
      const body = await parseBody(req);
      const workOrder = db.workOrders.find((item) => item.id === body.workOrderId && item.status !== "已完成");
      if (!workOrder) return send(res, 404, { error: "生产中工单不存在" });
      const issueProcessName = normalizeProcessName(body.processName || body.type || "");
      const route = body.routeId
        ? db.routes.find((item) => item.id === body.routeId && item.workOrderId === workOrder.id)
        : db.routes.find((item) => item.workOrderId === workOrder.id && item.processName === issueProcessName)
          || db.routes.find((item) => item.workOrderId === workOrder.id && item.processName === "质检")
          || db.routes.find((item) => item.workOrderId === workOrder.id && item.status !== "已完成")
          || db.routes.find((item) => item.workOrderId === workOrder.id);
      if (!route) return send(res, 404, { error: "工单缺少工序，不能登记异常" });
      const beforeStatus = route.status;
      const description = String(body.description || body.exceptionDescription || "").trim();
      if (!description) return send(res, 400, { error: "请填写问题描述" });
      const item = {
        id: id("e"),
        workOrderId: workOrder.id,
        routeId: route.id,
        type: issueProcessName || String(body.exceptionType || "质检问题").trim(),
        description,
        status: "待处理",
        reporterId: user.id,
        createdAt: new Date().toISOString(),
        images: Array.isArray(body.images) ? body.images : [],
        source: userHasRole(user, "quality") ? "quality-inspection" : "manual",
      };
      db.exceptions.push(item);
      route.status = "异常";
      syncWorkOrder(db, workOrder.id);
      appendAudit(db, user, "exception-create", "exception", item.id, {
        workOrderId: item.workOrderId, routeId: item.routeId, type: item.type, description: item.description,
        beforeStatus, afterStatus: route.status, planQty: Number(route.planQty || 0), completedQty: Number(route.completedQty || 0),
      });
      await writeDb(db);
      return send(res, 200, { ok: true, item });
    }

    if (req.method === "POST" && url.pathname === "/api/drawings/preview") {
      if (!user) return send(res, 401, { error: "请先登录" });
      const body = await parseBody(req);
      const drawing = db.drawings.find((item) => item.id === body.drawingId);
      if (!drawing) return send(res, 404, { error: "图纸不存在" });
      if (!isCadDrawing(drawing.fileType)) return send(res, 200, { previewUrl: drawing.url, previewError: "" });
      const previewFile = drawing.previewUrl ? path.join(CAD_PREVIEW_DIR, path.basename(drawing.previewUrl)) : "";
      if (previewFile && fs.existsSync(previewFile)) {
        const previewSvg = normalizeCadSvg(fs.readFileSync(previewFile, "utf8"));
        fs.writeFileSync(previewFile, previewSvg);
        return send(res, 200, {
          previewUrl: cadPreviewUrl(drawing.previewUrl),
          previewPageUrl: cadPreviewPageUrl(drawing.previewUrl, drawing.url, drawing.originalName || drawing.name || path.basename(drawing.url)),
          previewError: ""
        });
      }
      const preview = await generateCadPreview(drawing);
      drawing.previewUrl = preview.previewUrl;
      drawing.previewError = preview.previewError;
      db.attachments.filter((item) => item.url === drawing.url).forEach((item) => {
        item.previewUrl = preview.previewUrl;
        item.previewError = preview.previewError;
      });
      await writeDb(db);
      return send(res, 200, {
        ...preview,
        previewUrl: cadPreviewUrl(preview.previewUrl),
        previewPageUrl: cadPreviewPageUrl(preview.previewUrl, drawing.url, drawing.originalName || drawing.name || path.basename(drawing.url))
      });
    }

    if (req.method === "POST" && url.pathname === "/api/drawings/upload") {
      if (!canManage(user)) return send(res, 403, { error: "无权上传图纸" });
      const body = await parseBody(req);
      const saved = saveDataUrlFile(body, {
        allowImagesOnly: false,
        allowedExts: ["png", "jpg", "jpeg", "gif", "pdf", "dwg", "dxf"],
        targetDir: DRAWING_DIR,
        urlPrefix: "/uploads/drawings",
        prefix: "drawing",
      });
      if (saved.error) return send(res, 400, { error: saved.error });
      const preview = await generateCadPreview(saved);
      const item = {
        id: id("drw"),
        url: saved.url,
        thumbnailUrl: "",
        previewUrl: preview.previewUrl,
        previewError: preview.previewError,
        fileName: saved.fileName,
        name: saved.originalName,
        fileType: saved.fileType,
        contentType: saved.contentType,
        orderId: body.orderId || "",
        workOrderId: body.workOrderId || "",
        customerId: body.customerId || "",
        uploaderId: user.id,
        createdAt: new Date().toISOString(),
      };
      db.drawings.push(item);
      db.attachments.push({ ...item, id: id("att"), attachmentType: "drawing" });
      appendAudit(db, user, "drawing-upload", "drawing", item.id, { name: item.name, fileType: item.fileType, orderId: item.orderId, workOrderId: item.workOrderId });
      await writeDb(db);
      return send(res, 200, item);
    }

    if (req.method === "POST" && ["/api/upload", "/api/dispatch-board/report-upload"].includes(url.pathname)) {
      const body = await parseBody(req);
      const saved = saveDataUrlFile(body, { prefix: "img" });
      if (saved.error) return send(res, 400, { error: saved.error });
      const item = { id: id("att"), url: saved.url, thumbnailUrl: saved.url, name: saved.originalName, fileType: saved.fileType, contentType: saved.contentType, uploaderId: user.id, createdAt: new Date().toISOString() };
      db.attachments.push(item);
      appendAudit(db, user, "attachment-upload", "attachment", item.id, { name: item.name, fileType: item.fileType });
      await writeDb(db);
      return send(res, 200, item);
    }

    return send(res, 404, { error: "接口不存在" });
  } catch (error) {
    console.error(JSON.stringify({ requestId, method: req.method, path: url.pathname, error: error.message }));
    return send(res, error.statusCode || 500, { error: error.statusCode ? error.message : "服务器处理失败，请联系管理员", requestId });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
  const ext = path.extname(file).toLowerCase();
  const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml; charset=utf-8", ".pdf": "application/pdf" }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
}

async function dispatchApi(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const requestId = crypto.randomUUID();
  res.setHeader("X-Request-ID", requestId);
  try {
    // Receive the body before taking a write-queue slot.
    if (["POST", "PUT", "PATCH"].includes(req.method)) await readRawBody(req);
    if (req.aborted || res.destroyed) return;
    if (DB_DRIVER === "mysql_rows") {
      const { readScopedRows, scopedReads, withScopedRows, scopedWrites } = require("./lib/scoped-row-transaction");
      const weappQrRouteMatch = req.method === "GET" && pathname.match(WEAPP_QR_ROUTE);
      if (weappQrRouteMatch) {
        const state = await readScopedRows(createMysqlPool(), {
          pathname: "/api/qr/route/weapp.png", routeId: decodeURIComponent(weappQrRouteMatch[1])
        }, (selected) => selected);
        return await rowTrialContext.run({ state, scoped: true, readOnly: true }, () => handleApi(req, res));
      }
      const proxyReport = pathname === "/api/dispatch-board/report";
      const dispatchViewer = proxyReport || pathname === "/api/dispatch-board/report-context" || pathname === "/api/dispatch-board/report-upload";
      const claims = dispatchViewer ? verifiedViewerClaims(dispatchViewerToken(req)) : null;
      const userId = dispatchViewer ? (claims?.audience === "dispatch-board" ? claims.userId : "") : req.headers["x-user-id"];
      const { searchParams } = new URL(req.url, "http://localhost");
      const bootstrapDashboard = pathname === "/api/bootstrap" && searchParams.get("scope") === "dashboard";
      if (req.method === "GET" && (scopedReads.has(pathname) || bootstrapDashboard)) {
        const readRevision = databaseRevision;
        const routeId = searchParams.get("routeId");
        const viewerUserId = pathname === "/api/tv-dashboard" ? verifiedViewerClaims(searchParams.get("viewerToken"))?.userId : userId;
        if (pathname === "/api/tv-dashboard" && tvDashboardCache.size) {
          const source = dashboardSource(searchParams.get("source"));
          const token = searchParams.get("viewerToken");
          const viewer = viewerUserId ? await readScopedRows(createMysqlPool(),
            { pathname: "/api/tv-viewer-token", userId: viewerUserId }, (state) => tvViewerFromToken(state, token)) : null;
          const cached = cachedTvDashboard(tvCacheKey(source, viewer));
          if (cached) return sendTvDashboard(res, cached, searchParams, true);
        }
        const completions = pathname === "/api/mobile/completions" ? {
          range: completionPeriodRange(searchParams.get("period") || "today"),
          dateKey: shanghaiDateKey, includeItems: searchParams.get("includeItems") === "1"
        } : undefined;
        const history = pathname.startsWith("/api/history/") ? {
          filters: historyFilters({ searchParams }), dateInRange: isDateInRange,
          canRead: (user) => canManage(user) || userHasRole(user, "quality"), canViewFeedback: canViewRestrictedBoard,
          matchWorkOrders: (state, filters) => workOrderHistoryItems(state, filters, false, false)
        } : undefined;
        const deliveryAccess = pathname.startsWith("/api/deliveries/") ? { canDrive, canSupervise, platformChannels: PLATFORM_SOURCE_CHANNELS } : undefined;
        const options = { pathname, userId: viewerUserId, routeId, completions, history, deliveryAccess, bootstrapDashboard };
        if (pathname === "/api/reports/management-export") {
          const { validateReportDateRange } = require("./lib/management-report-export");
          try {
            options.reportRange = { ...validateReportDateRange(searchParams.get("from"), searchParams.get("to")), canRead: canManage };
          } catch {
            // The normal handler returns its permission or validation response.
          }
          const state = await readScopedRows(createMysqlPool(), options, (selected) => selected);
          return await rowTrialContext.run({ state, scoped: true, readOnly: true }, () => handleApi(req, res));
        }
        return await readScopedRows(createMysqlPool(), options, (state, readOnlyConnection, completed) => {
          if (options.bootstrapDashboard || pathname === "/api/dashboard" || pathname === "/api/tv-dashboard") reopenInFlightRoutes(state);
          return rowTrialContext.run({ state, scoped: true, readRevision, readOnlyConnection, completionScope: completions && { range: completions.range, completed } }, () => handleApi(req, res));
        });
      }
      if (req.method === "POST" && Object.hasOwn(scopedWrites, pathname)) {
        const inbound = pathname === "/api/external/work-orders" ? await readExternalOrder(req) : null;
        if (inbound?.error) return send(res, inbound.status, { error: inbound.error });
        const body = req.method === "POST" && !inbound ? await parseBody(req) : {};
        const { runBufferedRowMutation } = require("./lib/row-http-mutation");
        let context;
        await runBufferedRowMutation(createMysqlPool(), res, (state, buffered, rollbackFiles) => {
          context = { state, scoped: true, saved: false, inbound, rollbackFiles };
          return rowTrialContext.run(context, () => handleApi(req, buffered));
        }, () => Boolean(context?.saved), {
          transact: (pool, action, shouldApply) => withScopedRows(pool, action, shouldApply, {
            pathname, userId, body, inbound, reportId: proxyReport ? "" : reportSubmissionKey(body, userId), platformChannels: PLATFORM_SOURCE_CHANNELS
          }),
          deferSuccess: proxyReport,
          afterCommit: () => invalidateCommittedRowReads(context),
          commitOnError: (status) => Boolean(inbound && status === 409 && context?.saved)
        });
        if ((pathname === "/api/report" || proxyReport) && context?.saved && res.statusCode < 400) publishScheduleChange();
        if (context?.proxyReportResult && !res.destroyed && !res.writableEnded) {
          const dashboard = await readScopedRows(createMysqlPool(), { pathname: "/api/tv-dashboard", userId, reportDashboard: true }, (state) => {
            const viewer = viewerFromToken(state, dispatchViewerToken(req));
            if (!viewer || !canManage(viewer.user) || !canViewRestrictedBoard(viewer.user)) return null;
            res.viewOrderFinancials = financialAccessUserIds(state.users, state.orderFinancialAccessUserIds).has(String(viewer.user.id));
            return buildTvDashboard(state, true, dashboardSource(body.source));
          });
          if (!dashboard) return send(res, 403, { error: "派工看板权限已变化，请重新打开" });
          if (res.destroyed || res.writableEnded) return;
          return send(res, 200, { ...context.proxyReportResult, dashboard });
        }
        return;
      }
      if (req.method === "GET" && pathname === "/api/my-tasks" && process.env.BOBO_SYNTHETIC_TASK_DIRECT === "1") {
        const { withConsistentRowRead } = require("./lib/row-state-reader");
        const { readEmployeeTaskSnapshot } = require("./lib/task-snapshot-read");
        const selected = await withConsistentRowRead(createMysqlPool(), (connection) =>
          readEmployeeTaskSnapshot(connection, req.headers["x-user-id"], canOperateRoute)
        );
        if (!selected) return send(res, 401, { error: "请先登录" });
        return send(res, 200, { tasks: buildMyTasks(selected, selected.user) });
      }
      const trialReads = new Set(["/api/bootstrap", "/api/my-tasks", "/api/customer-feedbacks", "/api/qr/resolve"]);
      const trialWrites = new Set(["/api/login", "/api/logout", "/api/customers", "/api/customers/delete", "/api/users", "/api/users/update-role", "/api/users/delete", "/api/processes", "/api/processes/update-status", "/api/orders", "/api/orders/update", "/api/orders/repeat", "/api/routes", "/api/routes/delete", "/api/routes/publish-schedule", "/api/work-orders/delete", "/api/assign", "/api/route-status", "/api/route-exceptions", "/api/exceptions", "/api/exceptions/resolve", "/api/customer-feedbacks", "/api/customer-feedbacks/resolve", "/api/settings/tv"]);
      const dispatchWrite = req.method === "POST" && ["/api/dispatch-board/route-toggle", "/api/dispatch-board/route-schedule", "/api/dispatch-board/order-due-date"].includes(pathname);
      if (!dispatchWrite && !((req.method === "GET" && trialReads.has(pathname)) || (req.method === "POST" && trialWrites.has(pathname)))) return send(res, 503, { error: "当前接口尚未完成合成试验", requestId });
      const { runBufferedRowMutation } = require("./lib/row-http-mutation");
      let context;
      const deferBootstrap = req.method === "GET" && pathname === "/api/bootstrap";
      await runBufferedRowMutation(createMysqlPool(), res, async (state, buffered, connection) => {
        if (req.aborted || res.destroyed) throw new Error("行存储试验请求已断开");
        context = { state, saved: false, deferBootstrap };
        await rowTrialContext.run(context, () => handleApi(req, buffered));
        if (req.method === "GET" && pathname === "/api/my-tasks" && process.env.BOBO_SYNTHETIC_TASK_SHADOW === "1" && !context.saved) {
          const user = currentUser(req, state);
          if (user) {
            const { readTaskSnapshot } = require("./lib/task-snapshot-read");
            const selected = await readTaskSnapshot(connection);
            const shadowUser = currentUser(req, selected);
            if (!shadowUser || JSON.stringify(buildMyTasks(state, user)) !== JSON.stringify(buildMyTasks(selected, shadowUser))) throw new Error("任务读取影子校验不一致");
          }
        }
      }, () => Boolean(context?.saved), {
        auditBuffer: true, deferSuccess: deferBootstrap || (dispatchWrite && pathname === "/api/dispatch-board/order-due-date"), afterCommit: () => {
          invalidateCommittedRowReads(context);
          if (context?.saved && context.scheduleChanged) publishScheduleChange();
        }
      });
      if (context?.bootstrapResult && !res.destroyed && !res.writableEnded) return send(res, 200, context.bootstrapResult);
      if (context?.dispatchDueDateResult && !res.destroyed && !res.writableEnded) return send(res, 200, context.dispatchDueDateResult);
      return;
    }
    const queue = req.method === "POST" && pathname === "/api/orders/update" ? (run) => serializeOrderNumberWrite(() => serializeDispatchBoardWrite(run))
      : req.method === "POST" && ORDER_NUMBER_WRITE_PATHS.has(pathname) ? serializeOrderNumberWrite
      : req.method === "POST" && DISPATCH_BOARD_WRITE_PATHS.has(pathname) ? serializeDispatchBoardWrite : null;
    if (!queue) return await handleApi(req, res);
    const queuedAt = Date.now();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (!res.destroyed && !res.writableEnded) send(res, 503, { error: "操作排队超时，请刷新确认后再提交", requestId });
      console.warn(JSON.stringify({ requestId, path: pathname, stage: "queue-timeout", durationMs: Date.now() - queuedAt }));
    }, 20000);
    timer.unref();
    try {
      await queue(async () => {
        clearTimeout(timer);
        if (expired || req.aborted || res.destroyed || res.writableEnded) return;
        const queueWaitMs = Date.now() - queuedAt;
        if (queueWaitMs >= 1000) console.warn(JSON.stringify({ requestId, path: pathname, stage: "queue-start", queueWaitMs }));
        await handleApi(req, res);
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error(JSON.stringify({ requestId, path: pathname, stage: "request", error: error.message }));
    if (!res.destroyed && !res.writableEnded) send(res, error.statusCode || 500, { error: error.statusCode ? error.message : "服务器处理失败", requestId });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return void dispatchApi(req, res);
  serveStatic(req, res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`端口 ${PORT} 已被占用，系统可能已经启动。请直接打开：http://localhost:${PORT}`);
    return;
  }
  console.error(error);
});

async function startServer() {
  if (process.argv.includes("--migrate-audit-logs")) {
    if (DB_DRIVER !== "mysql") throw new Error("审计日志拆表迁移仅支持 DB_DRIVER=mysql");
    try {
      await ensureMysqlStateTable();
      await ensureMysqlAuditTable();
      await moveAuditLogsOutOfState();
    } finally {
      if (mysqlPool) await mysqlPool.end();
    }
    console.log("audit logs split migration: ok");
    return;
  }
  await ensureDb();
  const backfillIndex = process.argv.indexOf("--backfill-platform-order");
  if (backfillIndex >= 0) {
    await backfillPlatformOrder(process.argv[backfillIndex + 1]);
    return;
  }
  const onListening = () => {
    console.log(`非标钣金工单系统已启动：http://localhost:${PORT}`);
    void processPlatformWebhooks();
    setInterval(() => void processPlatformWebhooks(), 5000).unref();
  };
  if (DB_DRIVER === "mysql_rows") server.listen(PORT, "127.0.0.1", onListening);
  else server.listen(PORT, onListening);
}

startServer().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  if (mysqlPool) {
    try {
      await mysqlPool.end();
    } catch (closeError) {
      console.error("关闭 MySQL 连接池失败", closeError.code || closeError.name);
    }
  }
});
