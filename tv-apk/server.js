const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(PUBLIC, "uploads");
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
const ULTIMATE_WORK_ORDER_ADMIN_PHONE = "15257457485";
let wechatAccessTokenCache = { value: "", expiresAt: 0 };
let wechatAccessTokenPromise = null;
const weappCodePromises = new Map();
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
  laser_worker: "激光师傅",
  bend_worker: "折弯师傅",
  polish_worker: "打磨师傅",
  weld_worker: "焊接师傅",
  powder_worker: "喷塑师傅",
  quality: "质检",
  admin: "管理员",
};

const defaultProcesses = ["图纸设计", "激光", "折弯", "压铆", "打孔攻丝", "焊接", "打磨", "喷塑", "组装"];

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
  const isImage = bytes.length > 2 && (bytes[0] === 0xFF || bytes[0] === 0x89);
  if (response.ok && isImage) return bytes;
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
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile);
  if (weappCodePromises.has(cacheFile)) return weappCodePromises.get(cacheFile);

  const requestPromise = (async () => {
    const image = await requestWeappCode(route);
    fs.writeFileSync(cacheFile, image);
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
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
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

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) return;
  const users = [
    { id: "u_owner", name: "老板", phone: "13800000001", role: "owner", password: "123456", active: true },
    { id: "u_manager", name: "生产主管", phone: "13800000002", role: "manager", password: "123456", active: true },
    { id: "u_office", name: "跟单员", phone: "13800000003", role: "office", password: "123456", active: true },
    { id: "u_worker_laser", name: "激光师傅", phone: "13800000004", role: "laser_worker", password: "123456", active: true },
    { id: "u_worker_bend", name: "折弯师傅", phone: "13800000005", role: "bend_worker", password: "123456", active: true },
    { id: "u_quality", name: "质检员", phone: "13800000006", role: "quality", password: "123456", active: true },
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
  writeDb({ users, deletedUsers: [], processes, customers, orders, workOrders, routes, reports: [], exceptions, attachments: [], auditLogs: [], settings: { ...defaultSettings } });
}

function readDb() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  let changed = false;
  if (!Array.isArray(db.deletedUsers)) {
    db.deletedUsers = [];
    changed = true;
  }
  db.reports ||= [];
  db.exceptions ||= [];
  db.attachments ||= [];
  db.auditLogs ||= [];
  db.processes ||= [];
  db.settings ||= {};
  Object.entries(defaultSettings).forEach(([key, value]) => {
    if (db.settings[key] === undefined) {
      db.settings[key] = value;
      changed = true;
    }
  });
  defaultProcesses.forEach((name) => {
    if (!db.processes.some((p) => p.name === name)) {
      db.processes.push({ id: id("p"), name, sort: db.processes.length + 1, active: true });
      changed = true;
    }
  });
  const legacyRoleByName = {
    激光师傅: "laser_worker",
    折弯师傅: "bend_worker",
    打磨师傅: "polish_worker",
    焊接师傅: "weld_worker",
    喷塑师傅: "powder_worker",
  };
  db.users.forEach((item) => {
    const nextRole = legacyRoleByName[item.name];
    if (item.role === "worker" && nextRole) {
      item.role = nextRole;
      changed = true;
    }
  });
  db.routes.forEach((route) => {
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
  db.processes.forEach((process, index) => {
    const standardIndex = defaultProcesses.indexOf(process.name);
    const nextSort = standardIndex >= 0 ? standardIndex + 1 : defaultProcesses.length + index + 1;
    if (process.sort !== nextSort) {
      process.sort = nextSort;
      changed = true;
    }
  });
  if (changed) writeDb(db);
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

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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

function enrich(db) {
  const byId = (list, itemId) => list.find((item) => item.id === itemId);
  const workOrders = db.workOrders.map((wo) => {
    const order = byId(db.orders, wo.orderId);
    const customer = order ? byId(db.customers, order.customerId) : null;
    const routes = db.routes.filter((r) => r.workOrderId === wo.id).sort((a, b) => a.sequence - b.sequence);
    const done = routes.reduce((sum, r) => sum + Number(r.completedQty || 0), 0);
    const total = routes.reduce((sum, r) => sum + Number(r.planQty || 0), 0) || wo.planQty;
    const progress = Math.min(100, Math.round((done / total) * 100));
    const hasException = db.exceptions.some((e) => e.workOrderId === wo.id && e.status !== "已解决");
    const overdue = order && order.dueDate < today(0) && wo.status !== "已完成";
    return { ...wo, order, customer, routes, progress, hasException, overdue };
  });
  return { ...db, workOrders };
}

function canManage(role) {
  return ["owner", "manager", "office", "admin"].includes(role);
}

function canForceDeleteWorkOrders(user) {
  return Boolean(user && user.active && user.phone === ULTIMATE_WORK_ORDER_ADMIN_PHONE);
}

function userPermissions(user) {
  return { forceDeleteWorkOrders: canForceDeleteWorkOrders(user) };
}

function isShopWorker(role) {
  return ["worker", "quality", "laser_worker", "bend_worker", "polish_worker", "weld_worker", "powder_worker"].includes(role);
}

const reportProcessRoleMap = {
  laser_worker: ["激光"],
  bend_worker: ["折弯"],
  weld_worker: ["焊接"],
  polish_worker: ["打磨"],
  powder_worker: ["喷塑"],
  quality: ["质检"],
  worker: ["图纸设计", "压铆", "打孔攻丝", "组装"],
};

function canReportProcess(user, route) {
  if (!user || !route) return { ok: false, error: "请先登录" };
  if (canManage(user.role)) return { ok: true };
  if (!isShopWorker(user.role)) return { ok: false, error: "无权报工" };
  if (route.assignedTo !== user.id) return { ok: false, error: "只能报自己的任务" };
  const allowedProcesses = reportProcessRoleMap[user.role] || [];
  if (!allowedProcesses.includes(route.processName)) return { ok: false, error: "当前工种不能报此工序" };
  return { ok: true };
}

function canReportRouteStatus(route) {
  if (!route) return { ok: false, error: "工序不存在" };
  if (route.status === "待开始") return { ok: false, error: "请先点击开始生产" };
  if (route.status === "暂停") return { ok: false, error: "工序已暂停，请先点击继续" };
  if (route.status === "已完成") return { ok: false, error: "该工序已完成，无需再报工" };
  if (route.status !== "进行中") return { ok: false, error: `当前状态为${route.status}，暂不能报工` };
  return { ok: true };
}

function syncWorkOrder(db, workOrderId) {
  const routes = db.routes.filter((r) => r.workOrderId === workOrderId).sort((a, b) => a.sequence - b.sequence);
  const wo = db.workOrders.find((item) => item.id === workOrderId);
  if (!wo) return;
  const active = routes.find((r) => !["已完成"].includes(r.status)) || routes[routes.length - 1];
  wo.currentProcess = active ? active.processName : "";
  if (routes.length && routes.every((r) => r.status === "已完成")) wo.status = "已完成";
  else if (routes.some((r) => r.status === "异常")) wo.status = "异常";
  else wo.status = "生产中";
  if (wo.status === "已完成" && !wo.completedAt) wo.completedAt = new Date().toISOString();
  if (wo.status !== "已完成") wo.completedAt = "";
  const order = db.orders.find((o) => o.id === wo.orderId);
  if (order) order.status = wo.status;
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

function todayTimeRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function buildProcessLoad(db, processNames = defaultProcesses) {
  const { start, end } = todayTimeRange();
  return processNames.map((name) => {
    const process = db.processes.find((p) => p.name === name);
    const routes = db.routes.filter((r) => r.processName === name || (process && r.processId === process.id));
    const completedToday = routes.filter((route) => {
      if (route.status !== "已完成") return false;
      const completedAt = new Date(route.completedAt || route.lastReportedAt || "");
      return !Number.isNaN(completedAt.getTime()) && completedAt >= start && completedAt < end;
    }).length;
    const remaining = routes.filter((route) => route.status !== "已完成").length;
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
  const time = route.completedAt || latest?.createdAt || route.lastReportedAt || "";
  return {
    latestReport: latest || null,
    reporterName: reporter?.name || "",
    lastReportTime: time,
    lastReportTimeText: formatDateTime(time),
    targetFinishTimeText: formatDateTime(route.targetFinishTime),
  };
}

function buildTvDashboard(db) {
  const tvProcessNames = ["图纸设计", "激光", "折弯", "压铆", "打孔攻丝", "焊接", "打磨", "喷塑", "组装"];
  const data = enrich(db);
  const orders = data.workOrders.map((wo) => {
    const routes = wo.routes.map((route) => {
      const meta = routeMeta(db, route);
      const progress = Math.min(100, Math.round((Number(route.completedQty || 0) / Number(route.planQty || 1)) * 100));
      return { ...route, ...meta, progress };
    });
    return { ...wo, ...dueInfo(wo.order), routes };
  });
  const todayText = today(0);
  const todayReports = db.reports.filter((r) => String(r.createdAt || "").startsWith(todayText));
  const finishedWorkOrdersToday = orders.filter((wo) => {
    if (String(wo.completedAt || "").startsWith(todayText)) return true;
    return wo.status === "已完成" && wo.routes.some((route) => String(route.completedAt || "").startsWith(todayText));
  }).length;
  const active = orders
    .filter((w) => !["已完成"].includes(w.status))
    .sort((a, b) => a.dueAt - b.dueAt);
  const delayed = active.filter((w) => w.dueLevel === "overdue");
  const urgent = active.filter((w) => w.dueLevel === "urgent");
  const rushOrders = active.filter((w) => w.order?.priority === "急单");
  const waiting = db.routes.filter((r) => ["待开始", "暂停"].includes(r.status)).length;
  const onTimeRate = orders.length ? Math.round(((orders.length - delayed.length) / orders.length) * 100) : 100;
  const processLoad = buildProcessLoad(db, tvProcessNames);
  const statusDistribution = {
    active: db.routes.filter((r) => ["进行中"].includes(r.status)).length,
    delayed: delayed.length,
    finishedToday: todayReports.length,
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
    const d = new Date();
    d.setDate(d.getDate() - (6 - index));
    const key = dateKey(d);
    const value = orders.filter((wo) => {
      if (String(wo.completedAt || "").startsWith(key)) return true;
      return wo.status === "已完成" && wo.routes.some((route) => String(route.completedAt || "").startsWith(key));
    }).length;
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
      finishedToday: todayReports.length,
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
  const db = readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await parseBody(req);
      const user = db.users.find((u) => u.phone === body.phone && u.password === body.password && u.active);
      if (!user) return send(res, 401, { error: "手机号或密码不正确" });
      return send(res, 200, { user: { id: user.id, name: user.name, role: user.role, roleName: roles[user.role] }, permissions: userPermissions(user) });
    }

    if (req.method === "GET" && url.pathname === "/api/tv-dashboard") {
      return send(res, 200, buildTvDashboard(db));
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
        writeDb(db);
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
        writeDb(db);
      }
      try {
        const image = await getWeappCode(route);
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": image.length,
          "Cache-Control": "private, max-age=86400",
        });
        res.end(image);
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

    if (req.method === "GET" && url.pathname === "/api/me") return send(res, 200, { user: { ...user, roleName: roles[user.role] }, roles, permissions: userPermissions(user) });
    if (req.method === "GET" && url.pathname === "/api/bootstrap") return send(res, 200, { ...enrich(db), roles, permissions: userPermissions(user) });

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
      db.auditLogs.push({ id: id("log"), actorId: user.id, action: "tv-settings-save", targetType: "settings", targetId: "tv", detail: db.settings, createdAt: new Date().toISOString() });
      writeDb(db);
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
        .filter((r) => r.assignedTo === user.id && r.status !== "已完成")
        .map((r) => ({ ...r, workOrder: data.workOrders.find((w) => w.id === r.workOrderId) }));
      return send(res, 200, { tasks });
    }

    if (req.method === "POST" && url.pathname === "/api/customers") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权维护客户" });
      const body = await parseBody(req);
      if (!body.name) return send(res, 400, { error: "客户名称必填" });
      db.customers.push({ id: id("c"), name: body.name, contact: body.contact || "", phone: body.phone || "", address: body.address || "", note: body.note || "" });
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/customers/delete") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权删除客户" });
      const body = await parseBody(req);
      const customer = db.customers.find((c) => c.id === body.customerId);
      if (!customer) return send(res, 404, { error: "客户不存在" });
      if (db.orders.some((order) => order.customerId === customer.id)) return send(res, 400, { error: "已有订单关联的客户不能删除" });
      db.customers = db.customers.filter((item) => item.id !== customer.id);
      db.auditLogs.push({ id: id("log"), actorId: user.id, action: "customer-delete", targetType: "customer", targetId: customer.id, detail: { name: customer.name }, createdAt: new Date().toISOString() });
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      if (!["admin", "manager", "owner"].includes(user.role)) return send(res, 403, { error: "无权维护员工" });
      const body = await parseBody(req);
      if (!body.name || !body.phone || !body.role) return send(res, 400, { error: "姓名、手机号和角色必填" });
      if (!isValidRole(body.role)) return send(res, 400, { error: "岗位角色不正确" });
      const inactiveUser = db.users.find((u) => u.phone === body.phone && u.active === false);
      if (inactiveUser) {
        inactiveUser.name = body.name;
        inactiveUser.role = body.role;
        inactiveUser.password = body.password || inactiveUser.password || "123456";
        inactiveUser.active = true;
        inactiveUser.deletedAt = "";
        inactiveUser.deletedBy = "";
        writeDb(db);
        return send(res, 200, { ok: true, user: inactiveUser });
      }
      if (db.users.some((u) => u.phone === body.phone)) return send(res, 400, { error: "手机号已存在" });
      db.users.push({ id: id("u"), name: body.name, phone: body.phone, role: body.role, password: body.password || "123456", active: true });
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/users/update-role") {
      if (!["admin", "manager", "owner"].includes(user.role)) return send(res, 403, { error: "无权修改员工角色" });
      const body = await parseBody(req);
      const target = db.users.find((u) => u.id === body.userId && u.active !== false);
      if (!target) return send(res, 404, { error: "员工不存在" });
      if (target.id === user.id) return send(res, 400, { error: "不能修改当前登录账号角色" });
      if (!isValidRole(body.role)) return send(res, 400, { error: "岗位角色不正确" });
      const oldRole = target.role;
      target.role = body.role;
      db.auditLogs.push({ id: id("log"), actorId: user.id, action: "user-role-update", targetType: "user", targetId: target.id, detail: { name: target.name, phone: target.phone, oldRole, newRole: target.role }, createdAt: new Date().toISOString() });
      writeDb(db);
      return send(res, 200, { ok: true, user: target });
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
      db.auditLogs.push({ id: id("log"), actorId: user.id, action: "user-delete", targetType: "user", targetId: target.id, detail: { name: target.name, phone: target.phone, role: target.role, clearedAssignments }, createdAt: deletedAt });
      writeDb(db);
      return send(res, 200, { ok: true, clearedAssignments });
    }

    if (req.method === "POST" && url.pathname === "/api/processes") {
      if (!["admin", "manager", "owner"].includes(user.role)) return send(res, 403, { error: "无权维护工序" });
      const body = await parseBody(req);
      if (!body.name) return send(res, 400, { error: "工序名称必填" });
      db.processes.push({ id: id("p"), name: body.name, sort: db.processes.length + 1, active: true });
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权创建订单" });
      const body = await parseBody(req);
      const orderNo = String(body.orderNo || "").trim();
      const productName = String(body.productName || "").trim();
      if (!orderNo || !body.customerId || !productName || !body.quantity || !body.dueDate) return send(res, 400, { error: "订单号、客户、产品、数量和交期必填" });
      const dueDate = normalizeDate(body.dueDate);
      if (!dueDate) return send(res, 400, { error: "交期格式请填写 YYYY/MM/DD" });
      if (!Array.isArray(body.processIds) || body.processIds.length === 0) return send(res, 400, { error: "至少选择一道工序" });
      const orderId = id("o");
      const workOrderId = id("w");
      const createdAt = new Date().toISOString();
      const order = { id: orderId, orderNo, customerId: body.customerId, productName, drawingNo: body.drawingNo || "", quantity: Number(body.quantity), dueDate, priority: body.priority || "普通", status: "未开始", note: body.note || "", createdAt };
      const workOrder = { id: workOrderId, workNo: String(body.workNo || orderNo).trim(), orderId, productName, planQty: Number(body.quantity), status: "未开始", currentProcess: "", assigneeId: user.id, qrToken: id("qr"), createdAt };
      db.orders.push(order);
      db.workOrders.push(workOrder);
      (body.processIds || []).forEach((processId, index) => {
        const process = db.processes.find((p) => p.id === processId);
        if (process) db.routes.push({ id: id("r"), workOrderId, processId, processName: process.name, sequence: index + 1, assignedTo: body.assignedTo || "", qrToken: qrToken("rt"), status: index === 0 ? "待开始" : "待开始", planQty: Number(body.quantity), completedQty: 0, goodQty: 0, badQty: 0, reworkQty: 0 });
      });
      syncWorkOrder(db, workOrderId);
      writeDb(db);
      return send(res, 200, { ok: true, order, workOrder });
    }

    if (req.method === "POST" && url.pathname === "/api/assign") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权派工" });
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      route.assignedTo = body.userId;
      route.targetFinishTime = body.targetFinishTime || route.targetFinishTime || "";
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/routes") {
      if (!canManage(user.role)) return send(res, 403, { error: "无权调整工艺路线" });
      const body = await parseBody(req);
      const workOrder = db.workOrders.find((w) => w.id === body.workOrderId);
      const process = db.processes.find((p) => p.id === body.processId);
      if (!workOrder) return send(res, 404, { error: "工单不存在" });
      if (!process) return send(res, 404, { error: "工序不存在" });
      const existingRoutes = db.routes.filter((r) => r.workOrderId === workOrder.id);
      const sequence = Number(body.sequence || existingRoutes.length + 1);
      db.routes
        .filter((r) => r.workOrderId === workOrder.id && r.sequence >= sequence)
        .forEach((r) => {
          r.sequence += 1;
        });
      const route = {
        id: id("r"),
        workOrderId: workOrder.id,
        processId: process.id,
        processName: process.name,
        sequence,
        assignedTo: body.assignedTo || "",
        qrToken: qrToken("rt"),
        targetFinishTime: body.targetFinishTime || "",
        status: "待开始",
        planQty: Number(body.planQty || workOrder.planQty || 0),
        completedQty: 0,
        goodQty: 0,
        badQty: 0,
        reworkQty: 0,
      };
      db.routes.push(route);
      syncWorkOrder(db, workOrder.id);
      writeDb(db);
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
      writeDb(db);
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
      db.auditLogs.push({ id: id("log"), actorId: user.id, action: forceDelete ? "work-order-force-delete" : "work-order-delete", targetType: "workOrder", targetId: workOrder.id, detail: { workNo: workOrder.workNo, orderId: workOrder.orderId, forceDelete, deletedReportCount, deletedExceptionCount }, createdAt: new Date().toISOString() });
      writeDb(db);
      return send(res, 200, { ok: true, forceDelete });
    }

    if (req.method === "POST" && url.pathname === "/api/route-status") {
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const allowed = ["待开始", "进行中", "暂停", "返工", "异常"];
      if (!allowed.includes(body.status)) return send(res, 400, { error: "工序状态不正确" });
      if (isShopWorker(user.role) && route.assignedTo !== user.id) return send(res, 403, { error: "只能操作自己的任务" });
      if (!isShopWorker(user.role) && !canManage(user.role)) return send(res, 403, { error: "无权修改工序状态" });
      if (isShopWorker(user.role)) {
        const validTransition =
          (route.status === "待开始" && body.status === "进行中") ||
          (route.status === "进行中" && body.status === "暂停") ||
          (route.status === "暂停" && body.status === "进行中");
        if (!validTransition) return send(res, 400, { error: "当前工序状态不允许该操作，请刷新后重试" });
      }
      route.status = body.status;
      if (body.status === "进行中" && !route.startedAt) route.startedAt = new Date().toISOString();
      if (body.status === "暂停") route.pausedAt = new Date().toISOString();
      syncWorkOrder(db, route.workOrderId);
      db.auditLogs.push({ id: id("log"), actorId: user.id, action: "route-status", targetType: "route", targetId: route.id, detail: { status: body.status }, createdAt: new Date().toISOString() });
      writeDb(db);
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/report") {
      const body = await parseBody(req);
      const route = db.routes.find((r) => r.id === body.routeId);
      if (!route) return send(res, 404, { error: "工序不存在" });
      const permission = canReportProcess(user, route);
      if (!permission.ok) return send(res, 403, { error: permission.error });
      const statusPermission = canReportRouteStatus(route);
      if (!statusPermission.ok) return send(res, 409, { error: statusPermission.error });
      const isQuality = route.processName === "质检";
      let completedQty = Number(body.completedQty || 0);
      let submittedQty = 0;
      let inspectedQty = 0;
      let goodQty = 0;
      let badQty = 0;
      let reworkQty = Number(body.reworkQty || 0);
      let disposition = "";
      const remainingQty = Math.max(0, Number(route.planQty) - Number(route.completedQty || 0));
      if (isQuality) {
        submittedQty = Number(body.submittedQty);
        inspectedQty = Number(body.inspectedQty);
        goodQty = Number(body.goodQty);
        badQty = Number(body.badQty || 0);
        disposition = String(body.disposition || "无需处理");
        if (submittedQty < 1 || inspectedQty < 1) return send(res, 400, { error: "送检数量和检验数量必须大于 0" });
        if (inspectedQty > submittedQty) return send(res, 400, { error: "检验数量不能超过送检数量" });
        if (goodQty < 0 || badQty < 0 || goodQty + badQty !== inspectedQty) return send(res, 400, { error: "检验数量必须等于合格数量与不合格数量之和" });
        if (!["无需处理", "返工", "让步接收", "报废"].includes(disposition)) return send(res, 400, { error: "质检处理方式无效" });
        if (badQty > 0 && disposition === "无需处理") return send(res, 400, { error: "存在不合格品时必须选择处理方式" });
        completedQty = goodQty + (disposition === "让步接收" ? badQty : 0);
        reworkQty = disposition === "返工" ? badQty : 0;
      } else {
        if (!completedQty || completedQty < 1) return send(res, 400, { error: "完成件数必须大于 0" });
        if (reworkQty < 0 || reworkQty > completedQty) return send(res, 400, { error: "返工数量不能超过完成件数" });
      }
      if (completedQty > remainingQty) return send(res, 400, { error: "本次计入完成的数量不能超过剩余数量" });
      route.completedQty = Math.min(Number(route.planQty), Number(route.completedQty || 0) + completedQty);
      route.goodQty = Number(route.goodQty || 0) + goodQty;
      route.badQty = Number(route.badQty || 0) + badQty;
      route.reworkQty = Number(route.reworkQty || 0) + reworkQty;
      route.lastReportedAt = new Date().toISOString();
      route.lastReporterId = user.id;
      route.status = route.completedQty >= route.planQty ? "已完成" : "进行中";
      if (route.status === "已完成") route.completedAt = route.lastReportedAt;
      db.reports.push({ id: id("rep"), routeId: route.id, workOrderId: route.workOrderId, reporterId: user.id, reportType: isQuality ? "quality" : "production", completedQty, submittedQty, inspectedQty, goodQty, badQty, reworkQty, disposition, note: body.note || "", images: body.images || [], createdAt: route.lastReportedAt });
      if (body.exceptionType || body.exceptionDescription) {
        route.status = "异常";
        db.exceptions.push({ id: id("e"), workOrderId: route.workOrderId, routeId: route.id, type: body.exceptionType || "现场异常", description: body.exceptionDescription || body.note || "", status: "待处理", reporterId: user.id, createdAt: new Date().toISOString(), images: body.images || [] });
      }
      syncWorkOrder(db, route.workOrderId);
      writeDb(db);
      return send(res, 200, { ok: true, route });
    }

    if (req.method === "POST" && url.pathname === "/api/exceptions/resolve") {
      if (!["manager", "quality", "admin", "owner"].includes(user.role)) return send(res, 403, { error: "无权处理异常" });
      const body = await parseBody(req);
      const item = db.exceptions.find((e) => e.id === body.id);
      if (!item) return send(res, 404, { error: "异常不存在" });
      item.status = body.status || "已解决";
      item.solution = body.solution || "";
      item.resolvedBy = user.id;
      item.resolvedAt = new Date().toISOString();
      const route = db.routes.find((r) => r.id === item.routeId);
      if (route && item.status === "已解决" && route.status === "异常") route.status = route.completedQty >= route.planQty ? "已完成" : "进行中";
      if (route) syncWorkOrder(db, route.workOrderId);
      writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      const body = await parseBody(req);
      const match = String(body.dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return send(res, 400, { error: "只支持图片 dataUrl" });
      const ext = match[1].includes("png") ? "png" : "jpg";
      const fileName = `${id("img")}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fileName), Buffer.from(match[2], "base64"));
      const item = { id: id("att"), url: `/uploads/${fileName}`, name: body.name || fileName, uploaderId: user.id, createdAt: new Date().toISOString() };
      db.attachments.push(item);
      writeDb(db);
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
  const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
}

ensureDb();
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

server.listen(PORT, () => {
  console.log(`非标钣金工单系统已启动：http://localhost:${PORT}`);
});
