const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { weappImageType } = require("./lib/weapp-image");

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
const MYSQL_STATE_KEY = "main";
const ULTIMATE_WORK_ORDER_ADMIN_PHONE = "15257457485";
const RESTRICTED_VIEW_PHONES = new Set([
  "13456125046",
  "13757433269",
  "13777234068",
  "15257457485",
  "15728038503",
]);
const AUDIT_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const TV_VIEW_TOKEN_SECRET = String(process.env.TV_VIEW_TOKEN_SECRET || WX_APP_SECRET).trim()
  || crypto.randomBytes(32).toString("hex");
const TV_VIEW_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
let wechatAccessTokenCache = { value: "", expiresAt: 0 };
let wechatAccessTokenPromise = null;
const weappCodePromises = new Map();
let mysqlPool = null;
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
  return normalizeDate(text.slice(0, 10));
}

function normalizeRouteSchedule(startValue, endValue) {
  const plannedStartDate = normalizePlanDate(startValue);
  const plannedEndDate = normalizePlanDate(endValue);
  if ((startValue && !plannedStartDate) || (endValue && !plannedEndDate)) return { error: "计划日期格式不正确" };
  if (plannedStartDate && plannedEndDate && plannedStartDate > plannedEndDate) return { error: "计划开始日不能晚于结束日" };
  return { plannedStartDate, plannedEndDate };
}

function reportSchedule(route, createdAt) {
  const reportDate = String(createdAt || "").slice(0, 10);
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

async function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(DRAWING_DIR, { recursive: true });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.mkdirSync(CAD_PREVIEW_DIR, { recursive: true });
  if (DB_DRIVER === "mysql") {
    await ensureMysqlStateTable();
    const pool = createMysqlPool();
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
  await writeDb({ users, deletedUsers: [], processes, customers, orders, workOrders, routes, reports: [], exceptions, attachments: [], drawings: [], auditLogs: [], settings: { ...defaultSettings } });
}

async function readDb() {
  let db;
  if (DB_DRIVER === "mysql") {
    const pool = createMysqlPool();
    const [rows] = await pool.execute("SELECT value_json FROM app_state WHERE name = ?", [MYSQL_STATE_KEY]);
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
  db.processes ||= [];
  db.settings ||= {};
  db.customers.forEach((customer) => {
    if (customer.active === undefined) {
      customer.active = true;
      changed = true;
    }
  });
  db.orders.forEach((order) => {
    const quantityUnit = normalizeQuantityUnit(order.quantityUnit);
    if (order.quantityUnit !== quantityUnit) {
      order.quantityUnit = quantityUnit;
      changed = true;
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
    const currentProcess = normalizeProcessName(workOrder.currentProcess);
    if (workOrder.currentProcess !== currentProcess) {
      workOrder.currentProcess = currentProcess;
      changed = true;
    }
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
  if (DB_DRIVER === "mysql") {
    const pool = createMysqlPool();
    await pool.execute(
      "REPLACE INTO app_state (name, value_json, updated_at) VALUES (?, CAST(? AS JSON), NOW())",
      [MYSQL_STATE_KEY, JSON.stringify(db)]
    );
    return;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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
  const dateText = String(value || "").slice(0, 10);
  if (!dateText) return false;
  if (from && dateText < from) return false;
  if (to && dateText > to) return false;
  return true;
}

function historyFilters(url) {
  const dateType = String(url.searchParams.get("dateType") || "createdAt");
  return {
    customerId: String(url.searchParams.get("customerId") || "").trim(),
    status: String(url.searchParams.get("status") || "").trim(),
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

function workOrderHistoryItems(db, filters, includeCustomerFeedbacks = false) {
  return db.workOrders
    .map((workOrder) => {
      const order = db.orders.find((item) => item.id === workOrder.orderId) || {};
      const customer = db.customers.find((item) => item.id === order.customerId) || {};
      const routes = db.routes.filter((item) => item.workOrderId === workOrder.id).sort((a, b) => a.sequence - b.sequence);
      const drawings = (db.drawings || []).filter((item) => item.workOrderId === workOrder.id || item.orderId === order.id);
      const qualityExceptions = db.exceptions
        .filter((item) => item.workOrderId === workOrder.id && (item.qualityRouteId || item.source === "quality-inspection"))
        .map((item) => ({ ...item, processName: db.routes.find((route) => route.id === item.issueRouteId || route.id === item.routeId)?.processName || item.type || "", reporterName: resolveUser(db, item.reporterId)?.name || "", resolvedByName: resolveUser(db, item.resolvedBy)?.name || "" }));
      const customerFeedbacks = includeCustomerFeedbacks
        ? db.customerFeedbacks.filter((item) => item.workOrderId === workOrder.id).map((item) => ({ ...item, processName: db.routes.find((route) => route.id === item.routeId)?.processName || "", reporterName: resolveUser(db, item.reporterId)?.name || "", resolvedByName: resolveUser(db, item.resolvedBy)?.name || "" }))
        : null;
      return {
        id: workOrder.id,
        workNo: workOrder.workNo,
        orderNo: order.orderNo || "",
        orderId: order.id || "",
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
        completedAt: workOrderCompletedAt(db, workOrder),
        routes,
        drawings,
        qualityExceptions,
        ...(includeCustomerFeedbacks ? { customerFeedbacks } : {}),
      };
    })
    .filter((item) => !filters.customerId || item.customerId === filters.customerId)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => (!filters.from && !filters.to) || isDateInRange(item[filters.dateType], filters.from, filters.to))
    .filter((item) => {
      if (!filters.keyword) return true;
      return [item.workNo, item.orderNo, item.customerName, item.productName, item.drawingNo]
        .some((value) => String(value || "").toLowerCase().includes(filters.keyword));
    })
    .sort((a, b) => String(b[filters.dateType] || b.createdAt || b.dueDate).localeCompare(String(a[filters.dateType] || a.createdAt || a.dueDate)));
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
  fs.writeFileSync(path.join(targetDir, fileName), Buffer.from(match[2], "base64"));
  return {
    fileName,
    url: `${urlPrefix}/${fileName}`,
    contentType,
    fileType: ext,
    originalName: sourceName || fileName,
  };
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
      fs.writeFileSync(targetPath, previewSvg);
      return { previewUrl: `/uploads/previews/${path.basename(targetPath)}`, previewError: "" };
    }
  }
  for (const command of cadPreviewCommands(drawing.fileType)) {
    const preview = await runCadPreviewCommand(command, sourcePath, fileName);
    if (!preview.ok) continue;
    fs.writeFileSync(targetPath, normalizeCadSvg(preview.svgText));
    return { previewUrl: `/uploads/previews/${path.basename(targetPath)}`, previewError: "" };
  }
  return { previewUrl: "", previewError: "CAD 预览生成失败" };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
  });
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

function viewerFromToken(db, token) {
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
    if (!data.audience || Number(data.expiresAt) <= Date.now()) return null;
    const user = db.users.find((item) => item.id === data.userId && item.active);
    return user ? { user, audience: data.audience } : null;
  } catch {
    return null;
  }
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

function qualityRouteMeta(db, route) {
  if (route.processName !== "质检") return {};
  const routes = db.routes.filter((item) => item.workOrderId === route.workOrderId);
  const sourceRoute = routes
    .filter((item) => item.processName !== "质检" && item.routeType !== "rework" && item.sequence < route.sequence)
    .sort((a, b) => b.sequence - a.sequence)[0];
  const reworkRoutes = routes.filter((item) => item.sourceQualityRouteId === route.id);
  const availableFromProduction = Number(sourceRoute?.completedQty || 0);
  const availableFromRework = reworkRoutes
    .filter((item) => item.status === "已完成")
    .reduce((sum, item) => sum + Number(item.completedQty || 0), 0);
  const submittedQty = db.reports
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

function enrichRoute(db, route) {
  return { ...route, ...qualityRouteMeta(db, route) };
}

function workOrderCompletedAt(db, workOrder) {
  if (workOrder.completedAt && !Number.isNaN(new Date(workOrder.completedAt).getTime())) return workOrder.completedAt;
  if (workOrder.status !== "已完成") return "";
  return db.routes
    .filter((route) => route.workOrderId === workOrder.id && route.status === "已完成")
    .map((route) => route.completedAt || route.lastReportedAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function shanghaiDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function completionPeriodRange(period, now = new Date()) {
  const periodDays = { today: 1, "3d": 3, "7d": 7, "30d": 30 };
  const days = periodDays[period];
  if (!days) return null;
  const to = shanghaiDateKey(now);
  const start = new Date(`${to}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { period, from: shanghaiDateKey(start), to };
}

function mobileCompletionData(db, period, includeItems) {
  const range = completionPeriodRange(period);
  if (!range) return null;
  const completed = db.workOrders
    .filter((workOrder) => workOrder.status === "已完成")
    .map((workOrder) => ({ workOrder, completedAt: workOrderCompletedAt(db, workOrder) }))
    .filter((entry) => {
      const key = shanghaiDateKey(entry.completedAt);
      return key && key >= range.from && key <= range.to;
    })
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const result = { ...range, count: completed.length };
  if (!includeItems) return result;
  result.items = completed.map(({ workOrder, completedAt }) => {
    const order = db.orders.find((item) => item.id === workOrder.orderId) || {};
    const customer = db.customers.find((item) => item.id === order.customerId) || {};
    const allOrderWorkOrdersCompleted = db.workOrders
      .filter((item) => item.orderId === order.id)
      .every((item) => item.status === "已完成");
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
      canUpdateFulfillment: Boolean(order.id && allOrderWorkOrdersCompleted),
    };
  });
  return result;
}

function enrich(db) {
  const byId = (list, itemId) => list.find((item) => item.id === itemId);
  const routes = db.routes.map((route) => enrichRoute(db, route));
  const workOrders = db.workOrders.map((wo) => {
    const order = byId(db.orders, wo.orderId);
    const customer = order ? byId(db.customers, order.customerId) : null;
    const workOrderRoutes = routes.filter((r) => r.workOrderId === wo.id).sort((a, b) => a.sequence - b.sequence);
    const drawings = db.drawings.filter((item) => !item.removedAt && (item.workOrderId === wo.id || item.orderId === wo.orderId));
    const done = workOrderRoutes.reduce((sum, r) => sum + Number(r.completedQty || 0), 0);
    const total = workOrderRoutes.reduce((sum, r) => sum + Number(r.planQty || 0), 0) || wo.planQty;
    const progress = Math.min(100, Math.round((done / total) * 100));
    const hasException = db.exceptions.some((e) => e.workOrderId === wo.id && e.status !== "已解决");
    const overdue = order && order.dueDate < today(0) && wo.status !== "已完成";
    return { ...wo, completedAt: workOrderCompletedAt(db, wo), order, customer, routes: workOrderRoutes, drawings, progress, hasException, overdue };
  });
  return { ...db, routes, workOrders };
}

function canManage(userOrRole) {
  if (typeof userOrRole === "string") return ["owner", "manager", "office", "admin"].includes(userOrRole);
  return getUserRoles(userOrRole).some((role) => ["owner", "manager", "office", "admin"].includes(role));
}

function canSupervise(userOrRole) {
  if (typeof userOrRole === "string") return ["owner", "manager", "admin"].includes(userOrRole);
  return getUserRoles(userOrRole).some((role) => ["owner", "manager", "admin"].includes(role));
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

function userPermissions(user) {
  return {
    forceDeleteWorkOrders: canForceDeleteWorkOrders(user),
    editOrders: canSupervise(user),
    viewAuditLogs: canSupervise(user),
    deleteCustomers: canDeleteCustomers(user),
    viewTv: Boolean(user && user.active),
    viewBoardCustomer: canViewRestrictedBoard(user),
    manageCustomerFeedback: canViewRestrictedBoard(user),
    manageOrderFulfillment: canViewRestrictedBoard(user),
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
    item.status !== "已解决"
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

function dashboardProcessNames(db) {
  const activeWorkOrderIds = new Set(
    db.workOrders.filter((workOrder) => workOrder.status !== "已完成").map((workOrder) => workOrder.id)
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

function buildProcessLoad(db, processNames = dashboardProcessNames(db)) {
  const todayKey = shanghaiDateKey(new Date());
  const activeWorkOrderIds = new Set(
    db.workOrders.filter((workOrder) => workOrder.status !== "已完成").map((workOrder) => workOrder.id)
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

function routeMeta(db, route) {
  const reports = db.reports.filter((r) => r.routeId === route.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latest = reports[0];
  const reporter = latest ? resolveUser(db, latest.reporterId) : resolveUser(db, route.lastReporterId);
  const time = latest?.createdAt || route.completedAt || route.lastReportedAt || "";
  const currentDate = new Intl.DateTimeFormat("en-CA", {
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

function buildTvDashboard(db, showCustomer = false, includeDrawings = false) {
  const data = enrich(db);
  const orders = data.workOrders.map((wo) => {
    const openQualityExceptions = db.exceptions.filter((item) => item.workOrderId === wo.id && item.status !== "已解决" && (item.qualityRouteId || item.source === "quality-inspection"));
    const routes = wo.routes.map((route) => {
      const meta = routeMeta(db, route);
      const progress = Math.min(100, Math.round((Number(route.completedQty || 0) / Number(route.planQty || 1)) * 100));
      const qualityIssueActive = openQualityExceptions.some((item) => item.qualityRouteId === route.id || item.issueRouteId === route.id);
      return { ...route, ...meta, progress, qualityIssueActive };
    });
    const customer = showCustomer ? wo.customer : { id: wo.customer?.id || wo.order?.customerId || "" };
    const { drawings, ...safeWorkOrder } = wo;
    return {
      ...safeWorkOrder,
      ...(includeDrawings ? { drawings: drawings.map(tvDrawingMeta) } : {}),
      customer,
      ...dueInfo(wo.order),
      isRush: wo.order?.priority === "急单",
      routes,
    };
  });
  const todayText = shanghaiDateKey(new Date());
  const finishedWorkOrdersToday = orders.filter((wo) => shanghaiDateKey(wo.completedAt) === todayText).length;
  const active = orders
    .filter((w) => !["已完成"].includes(w.status))
    .sort((a, b) => a.dueAt - b.dueAt);
  const delayed = active.filter((w) => w.dueLevel === "overdue");
  const urgent = active.filter((w) => w.dueLevel === "urgent");
  const rushOrders = active.filter((w) => w.isRush);
  const onTimeRate = active.length ? Math.round(((active.length - delayed.length) / active.length) * 100) : 100;
  const processLoad = buildProcessLoad(db);
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
    const value = orders.filter((wo) => shanghaiDateKey(wo.completedAt) === key).length;
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
      totalWorkOrders: orders.length,
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

async function handleApi(req, res) {
  const db = await readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
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
        permissions: userPermissions(user),
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
      return send(res, 200, buildTvDashboard(db, canViewRestrictedBoard(viewer), Boolean(viewer)));
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
      const authorization = String(req.headers.authorization || "");
      const viewer = viewerFromToken(db, authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
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
      return send(res, 200, { ok: true, route });
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

    const user = currentUser(req, db);
    if (!user) return send(res, 401, { error: "请先登录" });

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
        const workbook = await buildManagementWorkbook(buildManagementReportData(db, from, to));
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
        permissions: userPermissions(user),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      appendAudit(db, user, "logout", "user", user.id, { name: user.name, phone: user.phone });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      const data = enrich(db);
      delete data.auditLogs;
      if (!canViewRestrictedBoard(user)) delete data.customerFeedbacks;
      data.customers = db.customers.filter((customer) => customer.active !== false);
      return send(res, 200, { ...data, roles, permissions: userPermissions(user) });
    }

    if (req.method === "GET" && url.pathname === "/api/mobile/completions") {
      const period = String(url.searchParams.get("period") || "today");
      const includeItems = url.searchParams.get("includeItems") === "1";
      const result = mobileCompletionData(db, period, includeItems);
      if (!result) return send(res, 400, { error: "完工统计时间范围不正确" });
      if (includeItems && !canViewRestrictedBoard(user)) return send(res, 403, { error: "无权查看完工详情" });
      if (includeItems) result.canManageOrderFulfillment = userPermissions(user).manageOrderFulfillment;
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
      await writeDb(db);
      return send(res, 200, { ok: true, status: order.status, order });
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
      const openExceptions = db.exceptions.filter((e) => e.status !== "已解决").length;
      const overdue = data.workOrders.filter((w) => w.overdue).length;
      const active = data.workOrders.filter((w) => w.status !== "已完成").length;
      const finished = data.workOrders.filter((w) => w.status === "已完成").length;
      const processLoad = buildProcessLoad(db);
      return send(res, 200, { active, finished, overdue, openExceptions, processLoad, workOrders: data.workOrders });
    }

    if (req.method === "GET" && url.pathname === "/api/my-tasks") {
      const data = enrich(db);
      const tasks = db.routes
        .filter((route) => route.status !== "已完成" && canOperateRoute(user, route).ok)
        .map((r) => ({ ...enrichRoute(db, r), workOrder: data.workOrders.find((w) => w.id === r.workOrderId) }));
      return send(res, 200, { tasks });
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
      if (db.orders.some((item) => item.orderNo === orderNo)) return send(res, 409, { error: "订单号已存在" });
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
      };
      const workOrder = {
        id: workOrderId,
        workNo: orderNo,
        orderId,
        productName: sourceOrder.productName,
        planQty: quantity,
        status: "未开始",
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
      const order = db.orders.find((item) => item.id === body.orderId);
      if (!order) return send(res, 404, { error: "订单不存在" });
      const orderNo = String(body.orderNo || "").trim();
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
      if (db.orders.some((item) => item.id !== order.id && item.orderNo === orderNo)) return send(res, 400, { error: "订单号已存在" });

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
      Object.assign(order, {
        orderNo,
        customerId: customer.id,
        productName,
        quantity,
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
        if (workOrder.workNo === oldOrderNo) workOrder.workNo = orderNo;
        workOrder.productName = productName;
        workOrder.planQty = quantity;
      });
      const linkedWorkOrderIds = new Set(linkedWorkOrders.map((workOrder) => workOrder.id));
      db.routes.forEach((route) => {
        if (linkedWorkOrderIds.has(route.workOrderId) && route.routeType !== "rework") route.planQty = quantity;
      });

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
        after: { orderNo, customerId: customer.id, productName, quantity, quantityUnit, drawingNo: order.drawingNo, weightKg: order.weightKg, dueDate, priority: order.priority, note: order.note },
        addedDrawings,
        removedDrawings,
      });
      await writeDb(db);
      return send(res, 200, { ok: true, order, workOrders: linkedWorkOrders });
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权创建订单" });
      const body = await parseBody(req);
      const orderNo = String(body.orderNo || "").trim();
      const productName = String(body.productName || "").trim();
      const weight = normalizeWeightKg(body.weightKg);
      if (!isValidQuantityUnit(body.quantityUnit)) return send(res, 400, { error: "数量单位仅支持件或套" });
      const quantityUnit = normalizeQuantityUnit(body.quantityUnit);
      if (!orderNo || !body.customerId || !productName || !body.quantity || !body.dueDate) return send(res, 400, { error: "订单号、客户、产品、数量和交期必填" });
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
      const order = { id: orderId, orderNo, customerId: body.customerId, productName, drawingNo: body.drawingNo || "", weightKg: weight.value, quantity: Number(body.quantity), quantityUnit, dueDate, priority: body.priority || "普通", status: "未开始", note: body.note || "", createdAt };
      const workOrder = { id: workOrderId, workNo: String(body.workNo || orderNo).trim(), orderId, productName, planQty: Number(body.quantity), status: "未开始", currentProcess: "", assigneeId: user.id, qrToken: id("qr"), createdAt };
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

    if (req.method === "POST" && url.pathname === "/api/assign") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权派工" });
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const assigneePermission = validateAssignee(db, route.processName, body.userId || "");
      if (!assigneePermission.ok) return send(res, 400, { error: assigneePermission.error });
      const targetFinishTime = body.targetFinishTime ? normalizeTargetFinishTime(body.targetFinishTime) : "";
      if (body.targetFinishTime && !targetFinishTime) return send(res, 400, { error: "目标完成时间格式不正确" });
      const schedule = normalizeRouteSchedule(body.plannedStartDate, body.plannedEndDate || targetFinishTime.slice(0, 10));
      if (schedule.error) return send(res, 400, { error: schedule.error });
      route.assignedRole = getProcessRole(route.processName);
      route.assignedTo = body.userId || "";
      route.targetFinishTime = targetFinishTime;
      route.plannedStartDate = schedule.plannedStartDate;
      route.plannedEndDate = schedule.plannedEndDate;
      appendAudit(db, user, "route-assign", "route", route.id, { assignedTo: route.assignedTo, targetFinishTime, plannedStartDate: route.plannedStartDate, plannedEndDate: route.plannedEndDate });
      await writeDb(db);
      return send(res, 200, { ok: true });
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
      await writeDb(db);
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/report") {
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const permission = canReportProcess(user, route);
      if (!permission.ok) return send(res, 403, { error: permission.error });
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
        id: id("rep"),
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
      await writeDb(db);
      return send(res, 200, { ok: true, route, report });
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

    if (req.method === "POST" && url.pathname === "/api/upload") {
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
    return send(res, 500, { error: error.message });
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

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
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
  await ensureDb();
  server.listen(PORT, () => {
    console.log(`非标钣金工单系统已启动：http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
