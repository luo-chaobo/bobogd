const state = {
  user: JSON.parse(localStorage.getItem("work_user") || "null"),
  view: "dashboard",
  dashboardSource: "all",
  orderSourceChannel: "",
  mobileTab: "tasks",
  data: null,
  dataRevision: 0,
  previewFiles: [],
  previewIndex: 0,
  previewTitle: "",
  collapsedDispatchWorkOrders: loadDispatchCollapseState(),
  collapsedEmployeeRoles: {},
  scheduleDrafts: {},
  schedulePublishing: new Set(),
  scheduleErrors: {},
  pendingDrawingIds: [],
  editingOrderId: "",
  confirmingPlatformOrderId: "",
  editRemovedDrawingIds: [],
  auditData: { items: [], total: 0, page: 1, pageSize: 20 },
  auditSort: { sortBy: "createdAt", sortDir: "desc" },
  exceptionFilters: {
    customerId: "",
    processName: "",
    status: "",
    from: "",
    to: "",
  },
  historyFilters: {
    dateType: "createdAt",
    from: "",
    to: "",
    customerId: "",
    status: "",
    source: "",
    sourceChannel: "",
    workNo: "",
  },
  historyResults: {
    workOrders: [],
    exceptions: [],
    loaded: false,
  },
  qualityInspection: {
    workOrderId: "",
  },
  dashboardFinishedFrom: isoDate(-6),
  dashboardFinishedTo: isoDate(0),
  dashboardProcess: "",
  dashboardInsightDays: 30,
  dashboardTrendDetail: null,
  dashboardInsight: null,
  dashboardInsightOrder: null,
  dashboardInsightLoading: false,
  dashboardInsightError: "",
  dashboardInsightRequest: 0,
  historyDetailId: "",
  historyOrderId: "",
  repeatOrderMode: false,
  repeatOrderConfirmOpen: false,
  openFulfillmentOrderId: "",
  customerFeedback: { customerId: "", workOrderId: "" },
  reportsFrom: monthStartDate(),
  reportsTo: isoDate(0),
  deliveryRegion: "",
  tableSorts: {},
};

let attachmentGroupSequence = 0;
const attachmentGroups = new Map();

function loadDispatchCollapseState() {
  const saved = localStorage.getItem("work_dispatch_collapsed");
  const savedState = saved ? JSON.parse(saved) : null;
  return savedState && typeof savedState === "object" ? savedState : {};
}

function isDispatchCollapsed(workOrderId) {
  const saved = localStorage.getItem("work_dispatch_collapsed");
  const savedState = saved ? JSON.parse(saved) : null;
  return !savedState ? true : state.collapsedDispatchWorkOrders[workOrderId] !== false;
}

function saveDispatchCollapseState() {
  localStorage.setItem("work_dispatch_collapsed", JSON.stringify(state.collapsedDispatchWorkOrders));
}

function toggleDispatchCollapse(workOrderId) {
  state.collapsedDispatchWorkOrders[workOrderId] = !isDispatchCollapsed(workOrderId);
  saveDispatchCollapseState();
  render();
}

function isEmployeeRoleCollapsed(role) {
  return state.collapsedEmployeeRoles[role] !== false;
}

function toggleEmployeeRoleCollapse(role) {
  state.collapsedEmployeeRoles[role] = !isEmployeeRoleCollapsed(role);
  render();
}

const roleNames = {
  owner: "老板",
  manager: "生产主管",
  office: "办公室/跟单",
  worker: "车间工人",
  design_worker: "设计师",
  laser_worker: "激光师傅",
  bend_worker: "折弯师傅",
  rivet_worker: "压铆师傅",
  tap_worker: "攻丝师傅",
  machining_worker: "机加师傅",
  polish_worker: "打磨师傅",
  weld_worker: "焊接师傅",
  powder_worker: "喷塑师傅",
  assembly_worker: "装配师傅",
  quality: "质检",
  driver: "司机",
  admin: "管理员",
};

const roleOrder = ["owner", "manager", "office", "driver", "design_worker", "laser_worker", "bend_worker", "rivet_worker", "tap_worker", "weld_worker", "machining_worker", "polish_worker", "powder_worker", "assembly_worker", "quality", "worker", "admin"];
const assignableRoles = ["design_worker", "laser_worker", "bend_worker", "rivet_worker", "tap_worker", "weld_worker", "machining_worker", "polish_worker", "powder_worker", "assembly_worker", "quality", "worker"];
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

const statusClass = {
  已完成: "ok",
  已发货: "shipped",
  已开票: "invoiced",
  进行中: "warn",
  异常: "danger",
  返工: "danger",
  暂停: "warn",
  生产中: "warn",
  待创建工序: "warn",
};

const techProcessNames = ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "机加", "打磨", "喷塑", "装配", "质检"];
const retiredProcessNames = new Set(["下料", "喷涂", "入库"]);
const processColors = {
  设计: "#4f46e5",
  激光: "#e11d48",
  切管: "#059669",
  折弯: "#2563eb",
  压铆: "#d97706",
  攻丝: "#7c3aed",
  焊接: "#ea580c",
  机加: "#ca8a04",
  打磨: "#64748b",
  喷塑: "#16a34a",
  装配: "#0f766e",
  质检: "#0891b2",
};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function quantityUnit(value) {
  return value === "套" ? "套" : "件";
}

function workOrderQuantityUnit(workOrder) {
  return quantityUnit(workOrder?.order?.quantityUnit);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.user) headers["x-user-id"] = state.user.id;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const requestId = res.headers.get("X-Request-ID") || data.requestId || "";
    console.error("接口请求失败", { path: path.split("?")[0], status: res.status, requestId });
    throw Object.assign(new Error(`${data.error || "服务器未能处理请求"}（HTTP ${res.status}${requestId ? `，请求编号 ${requestId}` : ""}）`), { status: res.status, routeId: data.routeId || "" });
  }
  return data;
}

function toast(text) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

async function refresh() {
  if (!state.user) return render();
  const revision = state.dataRevision;
  const data = await api("/api/bootstrap");
  if (revision !== state.dataRevision) return;
  state.data = data;
  render();
}

function loginPage() {
  return `
    <main class="login-shell">
      <section class="login-box">
        <h1>宁波未来机械工单系统</h1>
        <p>用于订单工单、工序派发、现场报工、异常处理和生产看板的统一管理平台。</p>
        <label class="field"><span>手机号</span><input id="phone" autocomplete="username" placeholder="请输入登录手机号" /></label>
        <label class="field"><span>密码</span><input id="password" type="password" autocomplete="current-password" placeholder="请输入密码" /></label>
        <button class="btn" id="loginBtn">登录</button>
      </section>
    </main>
  `;
}

function tag(text, extraClass = "") {
  const classes = ["tag", statusClass[text], extraClass].filter(Boolean).join(" ");
  return `<span class="${classes}">${escapeHtml(text)}</span>`;
}

const sourceChannelLabels = {
  website: "企业官网",
  order_platform: "接单平台",
  miniprogram: "未来机械小程序",
};

function orderSource(item) {
  const order = item?.order || item || {};
  const platform = order.orderOrigin === "platform" && sourceChannelLabels[order.sourceChannel];
  return platform
    ? { origin: "platform", originLabel: "平台单", channel: order.sourceChannel, channelLabel: sourceChannelLabels[order.sourceChannel] }
    : { origin: "factory", originLabel: "工厂单", channel: "factory_manual", channelLabel: "工厂单" };
}

function orderSourceBadge(item, showPricingState = false) {
  const source = orderSource(item);
  const order = item?.order || item || {};
  const unitPrice = order.unitPrice;
  const hasUnitPrice = unitPrice !== null && unitPrice !== undefined && String(unitPrice).trim() !== ""
    && Number.isFinite(Number(unitPrice)) && Number(unitPrice) >= 0;
  return tag(source.originLabel, showPricingState && hasUnitPrice ? "priced" : "");
}

function productionSourceBadge(item) {
  return orderSource(item).origin === "platform" ? tag("平台单") : "";
}

function workOrderCustomerName(workOrder) {
  return workOrder.order?.externalCustomer || workOrder.customer?.name || "";
}

function platformOrderProductName(order) {
  const productName = String(order?.productName || "").trim();
  if (order.orderOrigin === "platform" && (!productName || (!order.material && productName === order.externalDescription))) return "待补产品信息";
  return productName;
}

function workOrderProductName(workOrder) {
  return platformOrderProductName(workOrder.order || {}) || String(workOrder.productName || "").trim();
}

function workOrderDisplayStatus(workOrder) {
  if (workOrder.creationStatus === "pending") return "待创建工序";
  const routes = workOrder.routes || [];
  const hasStarted = routes.some((route) => route.status !== "待开始" || Number(route.completedQty || 0) > 0);
  if (workOrder.status === "生产中" && routes.length && !hasStarted) return "待排产";
  return workOrder.status;
}

function filterWorkOrdersBySource(workOrders, source, sourceChannel) {
  return workOrders.filter((item) => {
    const current = orderSource(item);
    if (source && current.origin !== source) return false;
    return !sourceChannel || current.channel === sourceChannel;
  });
}

function dashboardSourceTabs() {
  return `<div class="source-tabs">${[["all", "全部订单"], ["factory", "工厂单"], ["platform", "平台单"]]
    .map(([value, label]) => `<button type="button" class="btn secondary compact ${state.dashboardSource === value ? "active" : ""}" data-dashboard-source="${value}">${label}</button>`)
    .join("")}</div>`;
}

function ordersNavigation(data, pureDriver = false) {
  if (pureDriver) return "";
  const pendingCount = data.workOrders.filter((workOrder) => workOrder.creationStatus === "pending" && orderSource(workOrder).origin === "platform").length;
  const countBadge = pendingCount ? ` <b class="nav-count">${pendingCount}</b>` : "";
  return `<div class="nav-group">
    <div class="nav-parent"><span>订单工单</span>${countBadge}</div>
    <div class="nav-submenu">
      <button class="${state.view === "ordersAll" ? "active" : ""}" data-view="ordersAll">全部订单</button>
      <button class="${state.view === "ordersFactory" ? "active" : ""}" data-view="ordersFactory">工厂单</button>
      <button class="${state.view === "ordersPlatform" ? "active" : ""}" data-view="ordersPlatform">平台单${countBadge}</button>
    </div>
  </div>`;
}

function completionSourceSummaryRows(summary = {}) {
  return [
    ["工厂单", Number(summary.factory || 0)],
    ["企业官网", Number(summary.website || 0)],
    ["接单平台", Number(summary.order_platform || 0)],
    ["未来机械小程序", Number(summary.miniprogram || 0)],
  ];
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isShopWorkerRole(role) {
  return assignableRoles.includes(role);
}

function userRoles(user) {
  return [...new Set([...(Array.isArray(user?.roles) ? user.roles : []), user?.role].filter((role) => roleNames[role]))];
}

function userHasRole(user, role) {
  return userRoles(user).includes(role);
}

function canManageRole(role) {
  return ["owner", "manager", "office", "admin"].includes(role);
}

function activeAssignableUsers(data) {
  return data.users
    .filter((u) => userRoles(u).some(isShopWorkerRole) && u.active !== false)
    .sort((a, b) => {
      const roleDiff = Math.min(...userRoles(a).map((role) => assignableRoles.indexOf(role)).filter((index) => index >= 0))
        - Math.min(...userRoles(b).map((role) => assignableRoles.indexOf(role)).filter((index) => index >= 0));
      return roleDiff || a.name.localeCompare(b.name, "zh-Hans-CN");
    });
}

function userDisplay(data, userId) {
  if (!userId) return { name: "", role: "", deleted: false };
  const user = data.users.find((u) => u.id === userId);
  if (user) return { name: user.name, role: user.role, deleted: false };
  const deletedUser = (data.deletedUsers || []).find((u) => u.id === userId);
  if (deletedUser) return { name: deletedUser.name, role: deletedUser.role, deleted: true };
  return { name: "", role: "", deleted: false };
}

function userNameText(data, userId) {
  const user = userDisplay(data, userId);
  if (!user.name) return "";
  return user.deleted ? `${user.name}（已删除）` : user.name;
}

function assigneeOptions(data, selected = "", processName = "") {
  const selectedUser = selected ? data.users.find((u) => u.id === selected) : null;
  const inactiveSelected = selectedUser && selectedUser.active === false ? `<optgroup label="已停用人员"><option value="${selectedUser.id}" selected>${escapeHtml(selectedUser.name)}</option></optgroup>` : "";
  const deletedSelected = selected && !selectedUser ? (data.deletedUsers || []).find((u) => u.id === selected) : null;
  const deletedSelectedOption = deletedSelected ? `<optgroup label="已删除人员"><option value="${deletedSelected.id}" selected>${escapeHtml(deletedSelected.name)}（已删除）</option></optgroup>` : "";
  const requiredRole = processRoleMap[processName] || "";
  const availableRoles = requiredRole ? [requiredRole] : assignableRoles;
  return inactiveSelected + deletedSelectedOption + availableRoles
    .map((role) => {
      const users = activeAssignableUsers(data).filter((u) => userHasRole(u, role));
      if (!users.length) return "";
      return `<optgroup label="${roleNames[role]}">${users.map((u) => `<option value="${u.id}" ${u.id === selected ? "selected" : ""}>${escapeHtml(u.name)}</option>`).join("")}</optgroup>`;
    })
    .join("");
}

function rolePicker(id, selected = ["worker"]) {
  const selectedRoles = Array.isArray(selected) ? selected : [selected];
  const safeId = escapeHtml(id);
  const options = roleOrder
    .map((role) => `
      <label class="role-picker-option">
        <input type="checkbox" value="${role}" data-role-checkbox="${safeId}" ${selectedRoles.includes(role) ? "checked" : ""} />
        <span>${roleNames[role]}</span>
      </label>
    `)
    .join("");
  const tags = selectedRoles
    .filter((role) => roleNames[role])
    .map((role) => `<span class="role-tag">${roleNames[role]}<button type="button" data-remove-role="${role}" data-role-picker="${safeId}" aria-label="移除${roleNames[role]}">×</button></span>`)
    .join("");
  return `
    <div class="role-picker" id="${safeId}">
      <div class="role-tags" data-role-tags="${safeId}">${tags}</div>
      <details class="role-picker-menu">
        <summary>选择工种</summary>
        <div class="role-picker-options">${options}</div>
      </details>
    </div>
  `;
}

function roleTags(roles) {
  return `<div class="role-tags role-tags-readonly">${roles.map((role) => `<span class="role-tag">${roleNames[role]}</span>`).join("")}</div>`;
}

function selectedPickerRoles(id) {
  return [...document.querySelectorAll(`[data-role-checkbox="${id}"]:checked`)].map((input) => input.value);
}

function syncRolePicker(id) {
  const picker = el(id);
  const tags = picker?.querySelector(`[data-role-tags="${id}"]`);
  if (!tags) return;
  tags.innerHTML = selectedPickerRoles(id)
    .map((role) => `<span class="role-tag">${roleNames[role]}<button type="button" data-remove-role="${role}" data-role-picker="${escapeHtml(id)}" aria-label="移除${roleNames[role]}">×</button></span>`)
    .join("");
  bindRoleTagButtons(picker);
}

function bindRoleTagButtons(root = document) {
  root.querySelectorAll("[data-remove-role]").forEach((button) => {
    button.onclick = () => {
      const checkbox = document.querySelector(`[data-role-checkbox="${button.dataset.rolePicker}"][value="${button.dataset.removeRole}"]`);
      if (checkbox) checkbox.checked = false;
      syncRolePicker(button.dataset.rolePicker);
    };
  });
}

function bindRolePickers() {
  document.querySelectorAll("[data-role-checkbox]").forEach((checkbox) => {
    checkbox.onchange = () => syncRolePicker(checkbox.dataset.roleCheckbox);
  });
  bindRoleTagButtons();
}

function processOptions(data, selected = "") {
  return activeTechProcesses(data)
    .map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${p.name}</option>`)
    .join("");
}

function routeScheduleControl(id, startValue, endValue) {
  const draft = state.scheduleDrafts[id];
  const plannedStartDate = draft ? draft.plannedStartDate : String(startValue || "").slice(0, 10);
  const plannedEndDate = draft ? draft.plannedEndDate : String(endValue || "").slice(0, 10);
  return `
    <div class="route-schedule">
      <label><span>计划开始</span><input id="plannedStart_${id}" class="planDateInput" data-route="${id}" type="date" min="0001-01-01" max="9999-12-31" value="${plannedStartDate}" /></label>
      <label><span>计划结束</span><input id="plannedEnd_${id}" class="planDateInput" data-route="${id}" type="date" min="0001-01-01" max="9999-12-31" value="${plannedEndDate}" /></label>
    </div>
  `;
}

function routeScheduleValues(routeId) {
  const plannedStartDate = el(`plannedStart_${routeId}`)?.value || "";
  const plannedEndDate = el(`plannedEnd_${routeId}`)?.value || "";
  return { plannedStartDate, plannedEndDate };
}

function scheduleDraftsFor(workOrderId) {
  return Object.values(state.scheduleDrafts).filter((item) => item.workOrderId === workOrderId);
}

function allowScheduleLeave() {
  if (state.schedulePublishing.size) { toast("排期正在发布，请稍候"); return false; }
  if (!Object.keys(state.scheduleDrafts).length) return true;
  if (!window.confirm("还有未发布排期，离开将丢弃修改，是否继续？")) return false;
  state.scheduleDrafts = {};
  state.scheduleErrors = {};
  return true;
}

function scheduleToolbar(workOrderId) {
  const count = scheduleDraftsFor(workOrderId).length;
  const busy = state.schedulePublishing.has(workOrderId);
  const error = state.scheduleErrors[workOrderId];
  return '<span data-schedule-count="' + workOrderId + '">' + (count ? count + '道工序排期未发布' : '排期已发布') + '</span><button class="btn compact" data-publish-schedule="' + workOrderId + '" ' + (!count || busy ? 'disabled' : '') + '>' + (busy ? '发布中…' : '发布排期') + '</button><button class="btn secondary compact" data-discard-schedule="' + workOrderId + '" ' + (!count || busy ? 'disabled' : '') + '>放弃修改</button><span class="schedule-error" role="alert">' + escapeHtml(error?.message || '') + '</span>';
}

function editScheduleDraft(input) {
  const route = state.data.routes.find((item) => item.id === input.dataset.route);
  if (!route || state.schedulePublishing.has(route.workOrderId)) return;
  const original = state.scheduleDrafts[route.id] || { routeId: route.id, workOrderId: route.workOrderId, expectedStartDate: route.plannedStartDate || "", expectedEndDate: String(route.plannedEndDate || route.targetFinishTime || "").slice(0, 10) };
  const values = routeScheduleValues(route.id);
  const valid = [el('plannedStart_' + route.id), el('plannedEnd_' + route.id)].every((control) => control.checkValidity());
  if (valid && values.plannedStartDate === original.expectedStartDate && values.plannedEndDate === original.expectedEndDate) delete state.scheduleDrafts[route.id];
  else state.scheduleDrafts[route.id] = { ...original, plannedStartDate: values.plannedStartDate, plannedEndDate: values.plannedEndDate, invalid: !valid };
  delete state.scheduleErrors[route.workOrderId];
  const toolbar = document.querySelector('[data-schedule-toolbar="' + route.workOrderId + '"]');
  if (toolbar) toolbar.innerHTML = scheduleToolbar(route.workOrderId);
}

async function publishSchedule(workOrderId) {
  if (state.schedulePublishing.has(workOrderId)) return;
  const drafts = scheduleDraftsFor(workOrderId);
  if (!drafts.length) return;
  const invalidDraft = drafts.find((item) => item.invalid);
  if (invalidDraft) {
    state.scheduleErrors[workOrderId] = { message: "日期无效，请展开工序检查四位年份及完整日期", routeId: invalidDraft.routeId };
    render();
    return;
  }
  const card = document.querySelector('[data-dispatch-work="' + workOrderId + '"]');
  for (const input of card?.querySelectorAll('.planDateInput') || []) if (!input.checkValidity()) { input.reportValidity(); return; }
  state.schedulePublishing.add(workOrderId);
  const scrollY = window.scrollY;
  render();
  window.scrollTo(0, scrollY);
  try {
    const result = await api("/api/routes/publish-schedule", { method: "POST", body: JSON.stringify({ workOrderId, routes: drafts }) });
    state.dataRevision += 1;
    for (const updated of result.routes) {
      const route = state.data.routes.find((item) => item.id === updated.id);
      if (route) Object.assign(route, updated);
      for (const workOrder of state.data.workOrders) {
        const nested = workOrder.routes?.find((item) => item.id === updated.id);
        if (nested) Object.assign(nested, updated);
      }
      delete state.scheduleDrafts[updated.id];
    }
    delete state.scheduleErrors[workOrderId];
    toast("排期已发布，看板将同步更新");
  } catch (error) {
    state.scheduleErrors[workOrderId] = { message: error.message, routeId: error.routeId };
    toast(error.message);
  } finally {
    state.schedulePublishing.delete(workOrderId);
    render();
    window.scrollTo(0, scrollY);
  }
}

async function discardSchedule(workOrderId) {
  if (state.schedulePublishing.has(workOrderId) || !window.confirm("放弃该工单未发布排期，并重新读取已发布数据？")) return;
  for (const draft of scheduleDraftsFor(workOrderId)) delete state.scheduleDrafts[draft.routeId];
  delete state.scheduleErrors[workOrderId];
  const scrollY = window.scrollY;
  try { await refresh(); } catch (error) { toast(error.message); render(); }
  window.scrollTo(0, scrollY);
}

window.addEventListener("beforeunload", (event) => {
  if (!Object.keys(state.scheduleDrafts).length && !state.schedulePublishing.size) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("click", (event) => {
  const publish = event.target.closest("[data-publish-schedule]");
  if (publish) void publishSchedule(publish.dataset.publishSchedule);
  const discard = event.target.closest("[data-discard-schedule]");
  if (discard) void discardSchedule(discard.dataset.discardSchedule);
});


function sortedTechProcesses(data) {
  return data.processes
    .filter((p) => techProcessNames.includes(p.name))
    .sort((a, b) => techProcessNames.indexOf(a.name) - techProcessNames.indexOf(b.name))
}

function activeTechProcesses(data) {
  return sortedTechProcesses(data).filter((process) => process.active !== false);
}

function dashboardProcesses(data) {
  const usedNames = new Set(data.routes.map((route) => route.processName).filter(Boolean));
  const processes = new Map(data.processes
    .filter((process) => process.active !== false || usedNames.has(process.name))
    .map((process) => [process.name, process]));
  data.routes.forEach((route) => {
    if (route.processName && !processes.has(route.processName)) {
      processes.set(route.processName, { id: route.processId, name: route.processName });
    }
  });
  return [...processes.values()].filter((process) => !retiredProcessNames.has(process.name)).sort((a, b) => {
    const order = (process) => {
      const index = techProcessNames.indexOf(process.name);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return order(a) - order(b) || Number(a.sort || Number.MAX_SAFE_INTEGER) - Number(b.sort || Number.MAX_SAFE_INTEGER)
      || a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function groupDashboardRoutes(routes) {
  const byName = new Map();
  const byId = new Map();
  for (const route of routes) {
    if (route.processName) {
      if (!byName.has(route.processName)) byName.set(route.processName, []);
      byName.get(route.processName).push(route);
    }
    if (route.processId) {
      if (!byId.has(route.processId)) byId.set(route.processId, []);
      byId.get(route.processId).push(route);
    }
  }
  return { byName, byId };
}

function routesForDashboardProcess(grouped, process) {
  const byName = grouped.byName.get(process.name) || [];
  const byId = grouped.byId.get(process.id) || [];
  return byId.length ? [...new Set([...byName, ...byId])] : byName;
}

function processLoadCards(data, now = new Date()) {
  const todayKey = shanghaiDateKey(now);
  const activeWorkOrders = new Set(data.workOrders.filter((workOrder) => workOrder.status !== "已完成" && workOrder.creationStatus !== "pending").map((workOrder) => workOrder.id));
  const groupedRoutes = groupDashboardRoutes(data.routes);
  return dashboardProcesses(data)
    .map((p) => {
      const matchedRoutes = routesForDashboardProcess(groupedRoutes, p);
      const completedToday = matchedRoutes.filter((route) => {
        if (route.status !== "已完成") return false;
        return shanghaiDateKey(route.completedAt || route.lastReportedAt || "") === todayKey;
      }).length;
      const remaining = matchedRoutes.filter((route) => route.status !== "已完成" && activeWorkOrders.has(route.workOrderId)).length;
      return `<div class="card process-load-card"><strong>${escapeHtml(p.name)}</strong><p>今日完成 <strong class="load-completed">${completedToday}</strong> <span class="muted">/</span> 待完成 <strong class="load-pending">${remaining}</strong></p></div>`;
    })
    .join("");
}

function scheduleInsightData(data, now, days) {
  const todayKey = shanghaiDateKey(now);
  const [year, month, day] = todayKey.split("-").map(Number);
  const fromKey = new Date(Date.UTC(year, month - 1, day - days + 1)).toISOString().slice(0, 10);
  const workOrders = new Map(data.workOrders.map((workOrder) => [workOrder.id, workOrder]));
  const latestReports = new Map();
  for (const report of data.reports || []) {
    const previous = latestReports.get(report.routeId);
    if (!previous || String(report.createdAt || "") > String(previous.createdAt || "")) latestReports.set(report.routeId, report);
  }
  const groupedRoutes = groupDashboardRoutes(data.routes);
  return dashboardProcesses(data).map((process) => {
    const result = {
      name: process.name,
      risk: { overdue: [], urgent: [], normal: [], unplanned: [] },
      unstarted: [], onTime: [], late: [],
    };
    for (const route of routesForDashboardProcess(groupedRoutes, process)) {
      const workOrder = workOrders.get(route.workOrderId);
      if (!workOrder || workOrder.creationStatus === "pending") continue;
      const report = latestReports.get(route.id);
      const plannedStartDate = route.status === "已完成" ? report?.plannedStartDate ?? route.plannedStartDate : route.plannedStartDate;
      const plannedEndDate = route.status === "已完成" ? report?.plannedEndDate ?? route.plannedEndDate : route.plannedEndDate;
      const completedAtText = route.status === "已完成" ? report?.createdAt || route.completedAt || route.lastReportedAt : route.completedAt;
      const item = { ...route, plannedStartDate, plannedEndDate, completedAt: completedAtText, workOrder };
      const validStart = /^\d{4}-\d{2}-\d{2}$/.test(plannedStartDate || "") && shanghaiDateKey(`${plannedStartDate}T12:00:00+08:00`) === plannedStartDate;
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(plannedEndDate || "")
        ? new Date(`${plannedEndDate}T23:59:59.999+08:00`)
        : null;
      const hasPlan = validStart && deadline && !Number.isNaN(deadline.getTime())
        && shanghaiDateKey(deadline) === plannedEndDate && plannedStartDate <= plannedEndDate;
      if (route.status === "已完成") {
        const completedAt = new Date(completedAtText || "");
        const completedKey = shanghaiDateKey(completedAt);
        if (hasPlan && report?.scheduleStatus !== "unplanned" && completedKey >= fromKey && completedKey <= todayKey) {
          const onTime = completedAt.getTime() <= deadline.getTime();
          result[onTime ? "onTime" : "late"].push(item);
        }
        continue;
      }
      if (workOrder.status === "已完成") continue;
      const risk = !hasPlan ? "unplanned" : deadline.getTime() < now.getTime() ? "overdue" : deadline.getTime() - now.getTime() <= 48 * 60 * 60 * 1000 ? "urgent" : "normal";
      result.risk[risk].push(item);
      if (route.status === "待开始" && /^\d{4}-\d{2}-\d{2}$/.test(route.plannedStartDate || "") && route.plannedStartDate < todayKey) {
        result.unstarted.push(item);
      }
    }
    return result;
  });
}

function dashboardInsightModal(insights) {
  const selection = state.dashboardInsight;
  if (!selection) return "";
  const process = insights.find((item) => item.name === selection.processName);
  const rows = selection.kind === "risk" ? process?.risk[selection.segment]
    : selection.kind === "unstarted" ? process?.unstarted : process?.[selection.segment];
  const titles = { overdue: "已超期", urgent: "48 小时内到期", normal: "正常", unplanned: "未排期", unstarted: "未开工超期", onTime: "计划内完工", late: "计划外完工" };
  const title = `${selection.processName} · ${titles[selection.segment] || "工序明细"}`;
  const item = state.dashboardInsightOrder;
  const details = item ? `<div class="dashboard-order-details">
    <div class="form-grid history-order-fields">
      <div class="field"><span>订单号</span><div class="readonly-value">${escapeHtml(item.orderNo || "")}</div></div><div class="field"><span>客户</span><div class="readonly-value">${escapeHtml(item.customerName || "")}</div></div>
      <div class="field"><span>产品名称</span><div class="readonly-value">${escapeHtml(item.productName || "")}</div></div><div class="field"><span>激光编号</span><div class="readonly-value">${escapeHtml(item.drawingNo || "")}</div></div>
      <div class="field"><span>数量</span><div class="readonly-value">${escapeHtml(item.planQty)} ${escapeHtml(quantityUnit(item.quantityUnit))}</div></div><div class="field"><span>交期</span><div class="readonly-value">${escapeHtml(item.dueDate || "")}</div></div>
      <div class="field"><span>优先级</span><div class="readonly-value">${escapeHtml(item.priority || "普通")}</div></div><div class="field"><span>重量（KG）</span><div class="readonly-value">${escapeHtml(item.weightKg ?? "")}</div></div>
      <div class="field wide"><span>工序路线</span><div class="history-route-list">${(item.routes || []).filter((route) => route.routeType !== "rework").sort((a, b) => a.sequence - b.sequence).map((route) => `<div class="history-route-item"><strong>${escapeHtml(route.sequence)}. ${escapeHtml(route.processName)}</strong>${tag(route.status)}<span>${escapeHtml(route.completedQty || 0)} / ${escapeHtml(route.planQty || item.planQty)} ${escapeHtml(quantityUnit(item.quantityUnit))}</span></div>`).join("") || `<span class="muted">无正式工序</span>`}</div></div>
      <div class="field wide"><span>备注</span><div class="readonly-value dashboard-order-note">${escapeHtml(item.note || "")}</div></div>
    </div>
    <div class="history-order-attachments"><span class="attachment-field-title">图纸附件 ${attachmentGroupButton(item.drawings || [], `${item.workNo} ${item.productName}`)}</span></div>
  </div>` : state.dashboardInsightLoading ? `<p class="muted">正在加载订单详情…</p>` : state.dashboardInsightError ? `<p class="dashboard-insight-error" role="alert">${escapeHtml(state.dashboardInsightError)}</p>` : "";
  return `<div class="dialog-backdrop dashboard-insight-backdrop" data-action="closeDashboardInsight"><section class="dialog dashboard-insight-dialog" role="dialog" aria-modal="true" aria-labelledby="dashboardInsightTitle" onclick="event.stopPropagation()">
    <div class="topbar"><div><h3 id="dashboardInsightTitle">${item || state.dashboardInsightLoading || state.dashboardInsightError ? "订单详情" : escapeHtml(title)}</h3>${item ? `<p>${orderSourceBadge(item)}</p><p class="muted">原工单：${escapeHtml(item.workNo)} / 原订单：${escapeHtml(item.orderNo)} / 状态：${escapeHtml(item.productionStatus)}${item.completedAt ? ` / 完工：${escapeHtml(formatDateTime(item.completedAt))}` : ""}</p>` : state.dashboardInsightLoading || state.dashboardInsightError ? "" : `<p class="muted">${rows?.length || 0} 条工序</p>`}</div><button class="btn secondary compact" data-action="closeDashboardInsight">关闭</button></div>
    ${item || state.dashboardInsightLoading || state.dashboardInsightError ? `<div class="actions dashboard-insight-nav"><button class="btn secondary" data-action="backDashboardInsight">返回清单</button></div>${details}` : `<div class="table-wrap"><table><thead><tr><th>工单</th><th>工序状态</th><th>计划开始</th><th>计划结束</th><th>完成时间</th></tr></thead><tbody>
      ${rows?.length ? rows.map((route) => `<tr><td><button type="button" class="history-order-link" data-dashboard-insight-order="${escapeHtml(route.workOrder.id)}">${escapeHtml(route.workOrder.workNo || route.workOrder.id)}</button></td><td>${escapeHtml(route.status)}</td><td>${escapeHtml(route.plannedStartDate || "未设置")}</td><td>${escapeHtml(route.plannedEndDate || "未设置")}</td><td>${escapeHtml(formatDateTime(route.completedAt || route.lastReportedAt || ""))}</td></tr>`).join("") : `<tr><td colspan="5" class="muted">当前筛选下暂无工序</td></tr>`}
    </tbody></table></div>`}
  </section></div>`;
}

function dashboardTrendData(data, days = state.dashboardInsightDays) {
  const todayKey = shanghaiDateKey(new Date());
  const [year, month, day] = todayKey.split("-").map(Number);
  const fromKey = new Date(Date.UTC(year, month - 1, day - days + 1)).toISOString().slice(0, 10);
  const dateKeys = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day - days + 1 + index));
    return date.toISOString().slice(0, 10);
  });
  const ordersByDate = new Map(dateKeys.map((date) => [date, []]));
  const reportsByDate = new Map(dateKeys.map((date) => [date, []]));
  const sourceOrders = (data.orders || []).filter((order) => state.dashboardSource === "all" || orderSource(order).origin === state.dashboardSource);
  const customers = new Map((data.customers || []).map((customer) => [customer.id, customer]));
  const workOrdersByOrder = new Map();
  for (const workOrder of data.workOrders || []) {
    if (!workOrdersByOrder.has(workOrder.orderId)) workOrdersByOrder.set(workOrder.orderId, workOrder);
  }
  for (const order of sourceOrders) {
    const date = shanghaiDateKey(order.createdAt);
    if (date >= fromKey && ordersByDate.has(date)) {
      const workOrder = workOrdersByOrder.get(order.id);
      ordersByDate.get(date).push({
        ...order,
        customerName: order.externalCustomer || customers.get(order.customerId)?.name || workOrder?.customer?.name || "未知客户",
        productDisplayName: order.productName || order.material || order.externalDescription || workOrder?.productName || "",
      });
    }
  }
  const routesById = new Map((data.routes || []).map((route) => [route.id, route]));
  const sourceWorkOrderIds = new Set(filterWorkOrdersBySource(data.workOrders || [], state.dashboardSource === "all" ? "" : state.dashboardSource, "").map((workOrder) => workOrder.id));
  for (const report of data.reports || []) {
    if (report.reportType === "quality" || !sourceWorkOrderIds.has(report.workOrderId)) continue;
    const route = routesById.get(report.routeId);
    if (!route || route.processName === "质检") continue;
    const date = shanghaiDateKey(report.createdAt);
    if (!reportsByDate.has(date)) continue;
    reportsByDate.get(date).push({
      processName: route.processName || "未知工序",
      reporterId: report.reporterId || "",
      reporterName: userNameText(data, report.reporterId) || "未知员工",
    });
  }
  return dateKeys.map((date) => ({
    date,
    orders: ordersByDate.get(date),
    orderCount: ordersByDate.get(date).length,
    reports: reportsByDate.get(date),
    reportCount: reportsByDate.get(date).length,
  }));
}

function trendLineChart(title, values, type, series) {
  const width = 920;
  const height = 280;
  const left = 44;
  const right = 18;
  const top = 30;
  const bottom = 226;
  const maxValue = Math.max(1, ...values.flatMap((item) => series.map((entry) => Number(item[entry.key] || 0))));
  const x = (index) => left + (values.length === 1 ? 0 : index * (width - left - right) / (values.length - 1));
  const y = (value) => bottom - value / maxValue * (bottom - top);
  const labelStep = Math.max(1, Math.ceil(values.length / 7));
  const valueLabelStep = Math.max(1, Math.ceil(values.length / 15));
  const axisLabel = type === "reports" ? "报工总次数" : "订单数";
  const pointHelp = type === "reports" ? "点击日期节点查看各工种和员工的报工次数" : "点击日期节点查看当天新增订单";
  return `<section class="panel trend-panel"><div class="section-heading"><div><h3>${escapeHtml(title)}</h3><p class="muted">${pointHelp}；纵轴为${axisLabel}</p><div class="trend-legend">${series.map((entry) => `<span><i style="background:${entry.color}"></i>${escapeHtml(entry.label)}</span>`).join("")}</div></div></div>
    <div class="trend-chart-wrap"><svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(title)}趋势折线图">
      ${[0, 0.5, 1].map((ratio) => { const gridY = bottom - ratio * (bottom - top); return `<line class="trend-gridline" x1="${left}" y1="${gridY}" x2="${width - right}" y2="${gridY}"></line><text class="trend-axis-value" x="${left - 8}" y="${gridY + 4}" text-anchor="end">${Math.round(maxValue * ratio)}</text>`; }).join("")}
      ${series.map((entry) => `<path class="trend-line" style="stroke:${entry.color}" d="${values.map((item, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(Number(item[entry.key] || 0)).toFixed(1)}`).join(" ")}"></path>`).join("")}
      ${values.map((item, index) => {
        const dateLabel = item.date.slice(5);
        const points = series.map((entry) => {
          const value = Number(item[entry.key] || 0);
          const showValue = index % valueLabelStep === 0 || index === values.length - 1;
          return `<g class="trend-point ${showValue ? "has-label" : ""}" role="button" tabindex="0" aria-label="${escapeHtml(item.date)}，${escapeHtml(entry.label)} ${value}，点击查看明细" data-trend-point="${type}" data-trend-date="${item.date}"><title>${escapeHtml(item.date)}：${escapeHtml(entry.label)} ${value}</title><circle style="fill:${entry.color}" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="5"></circle><text class="trend-point-value" x="${x(index).toFixed(1)}" y="${y(value) - 11}" text-anchor="middle">${value}</text></g>`;
        }).join("");
        return `${points}${index % labelStep === 0 || index === values.length - 1 ? `<text class="trend-date-label" x="${x(index).toFixed(1)}" y="${bottom + 24}" text-anchor="middle">${dateLabel}</text>` : ""}`;
      }).join("")}
    </svg></div></section>`;
}

function dashboardTrendModal(data) {
  const selection = state.dashboardTrendDetail;
  if (!selection) return "";
  const point = dashboardTrendData(data).find((item) => item.date === selection.date);
  if (!point) return "";
  const orders = selection.type === "orders" ? point.orders : [];
  const totals = new Map();
  if (selection.type === "reports") {
    for (const report of point.reports) {
      const key = `${report.processName}\u0000${report.reporterId || report.reporterName}`;
      const current = totals.get(key) || { processName: report.processName, reporterName: report.reporterName, reportCount: 0 };
      current.reportCount += 1;
      totals.set(key, current);
    }
  }
  const reportRows = [...totals.values()].sort((a, b) => {
    const processOrder = (name) => {
      const index = techProcessNames.indexOf(name);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return processOrder(a.processName) - processOrder(b.processName)
      || a.processName.localeCompare(b.processName, "zh-CN")
      || a.reporterName.localeCompare(b.reporterName, "zh-CN");
  });
  const reportGroups = [];
  for (const row of reportRows) {
    const lastGroup = reportGroups[reportGroups.length - 1];
    if (lastGroup?.processName === row.processName) lastGroup.rows.push(row);
    else reportGroups.push({ processName: row.processName, rows: [row] });
  }
  const isOrders = selection.type === "orders";
  return `<div class="dialog-backdrop trend-detail-backdrop" data-action="closeDashboardTrend"><section class="dialog trend-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="trendDetailTitle" onclick="event.stopPropagation()">
    <div class="topbar"><div><h3 id="trendDetailTitle">${isOrders ? "新增订单" : "工序报工汇总"} · ${escapeHtml(selection.date)}</h3><p class="muted">${isOrders ? `${orders.length} 个订单` : `共 ${point.reports.length} 次生产报工；质检报工不计入`}</p></div><button type="button" class="btn secondary compact" data-action="closeDashboardTrend">关闭</button></div>
    ${isOrders ? `<div class="table-wrap"><table><thead><tr><th>订单号</th><th>客户</th><th>产品</th><th>数量</th><th>来源</th><th>创建时间</th></tr></thead><tbody>${orders.length ? orders.map((order) => `<tr><td>${escapeHtml(order.orderNo || order.externalOrderNumber || order.id)}</td><td>${escapeHtml(order.customerName)}</td><td>${escapeHtml(order.productDisplayName)}</td><td>${escapeHtml(order.quantity ?? order.externalQuantity ?? "")} ${escapeHtml(quantityUnit(order.quantityUnit))}</td><td>${escapeHtml(orderSource(order).originLabel)}</td><td>${escapeHtml(formatDateTime(order.createdAt))}</td></tr>`).join("") : `<tr><td colspan="6" class="muted">当天没有新增订单</td></tr>`}</tbody></table></div>` : `<div class="table-wrap"><table><thead><tr><th>工种</th><th>员工</th><th>报工次数</th></tr></thead><tbody>${reportGroups.length ? reportGroups.map((group) => group.rows.map((row, index) => `<tr>${index === 0 ? `<td rowspan="${group.rows.length}">${escapeHtml(group.processName)}</td>` : ""}<td>${escapeHtml(row.reporterName)}</td><td>${row.reportCount}</td></tr>`).join("")).join("") : `<tr><td colspan="3" class="muted">当天没有生产报工</td></tr>`}</tbody></table></div>`}
  </section></div>`;
}

function scheduleInsightCharts(insights) {
  const riskTypes = [["overdue", "已超期"], ["urgent", "48 小时内"], ["normal", "正常"], ["unplanned", "未排期"]];
  const totalRisk = insights.reduce((sum, item) => sum + Object.values(item.risk).reduce((count, routes) => count + routes.length, 0), 0);
  const totalUnstarted = insights.reduce((sum, item) => sum + item.unstarted.length, 0);
  const totalCompleted = insights.reduce((sum, item) => sum + item.onTime.length + item.late.length, 0);
  const maxUnstarted = Math.max(1, ...insights.map((item) => item.unstarted.length));
  return `<div class="insight-grid">
    <section class="panel insight-panel insight-wide"><div class="section-heading"><div><h3>排期风险构成</h3><p class="muted">在产工序 ${totalRisk} 条；按计划结束日 23:59（北京时间）判断，缺计划单列。</p></div></div>
      <div class="insight-legend">${riskTypes.map(([key, label]) => `<span class="insight-key insight-${key}">${label}</span>`).join("")}</div>
      ${insights.length ? insights.map((item) => {
        const total = Object.values(item.risk).reduce((count, routes) => count + routes.length, 0);
        return `<div class="insight-row"><strong>${escapeHtml(item.name)}</strong><div class="insight-stack">${riskTypes.map(([key, label]) => item.risk[key].length ? `<button type="button" class="insight-segment insight-${key}" style="width:${item.risk[key].length / total * 100}%" data-insight-kind="risk" data-insight-process="${escapeHtml(item.name)}" data-insight-segment="${key}" title="${escapeHtml(item.name)} ${label} ${item.risk[key].length} 条">${item.risk[key].length}</button>` : "").join("") || `<span class="insight-empty-bar">0</span>`}</div><span>${total}</span></div>`;
      }).join("") : `<p class="muted">暂无工序数据</p>`}
    </section>
    <section class="panel insight-panel"><div class="section-heading"><div><h3>未开工超期</h3><p class="muted">待开始且计划开始日早于今天；共 ${totalUnstarted} 条。</p></div></div>
      ${insights.map((item) => `<div class="insight-row"><strong>${escapeHtml(item.name)}</strong><div class="insight-track">${item.unstarted.length ? `<button type="button" class="insight-age-bar" style="width:${item.unstarted.length / maxUnstarted * 100}%" data-insight-kind="unstarted" data-insight-process="${escapeHtml(item.name)}" data-insight-segment="unstarted" title="查看${escapeHtml(item.name)}未开工工序">${item.unstarted.length}</button>` : `<span class="insight-empty-bar">0</span>`}</div></div>`).join("") || `<p class="muted">暂无工序数据</p>`}
    </section>
    <section class="panel insight-panel"><div class="section-heading"><div><h3>计划内完工率</h3><p class="muted">近 ${state.dashboardInsightDays} 天已完工且设有完整计划区间的工序 ${totalCompleted} 条；未排期不计分母，提前或结束日当日完工计计划内，仅晚于结束日计计划外。</p></div></div>
      <div class="insight-legend"><span class="insight-key insight-on-time">计划内</span><span class="insight-key insight-late">计划外</span></div>
      ${insights.map((item) => {
        const count = item.onTime.length + item.late.length;
        return `<div class="insight-row"><strong>${escapeHtml(item.name)}</strong><div class="insight-stack">${count ? `${item.onTime.length ? `<button type="button" class="insight-segment insight-on-time" style="width:${item.onTime.length / count * 100}%" data-insight-kind="completion" data-insight-process="${escapeHtml(item.name)}" data-insight-segment="onTime" title="计划内 ${item.onTime.length} 条">${item.onTime.length}</button>` : ""}${item.late.length ? `<button type="button" class="insight-segment insight-late" style="width:${item.late.length / count * 100}%" data-insight-kind="completion" data-insight-process="${escapeHtml(item.name)}" data-insight-segment="late" title="计划外 ${item.late.length} 条">${item.late.length}</button>` : ""}` : `<span class="insight-empty-bar">无排期完工数据</span>`}</div><span>${count ? `${Math.round(item.onTime.length / count * 100)}%` : "—"}</span></div>`;
      }).join("") || `<p class="muted">暂无工序数据</p>`}
    </section>
  </div>`;
}

function mobileProcessTrack(workOrder) {
  const routes = workOrder.routes || [];
  if (!routes.length) return `<div class="progress"><div style="width:${workOrder.progress}%"></div></div>`;
  return `
    <div class="mobile-process-track">
      ${routes
        .map((route) => {
          const done = route.status === "已完成";
          const current = route.processName === workOrder.currentProcess && !done;
          const cls = `${done ? "done" : "todo"} ${current ? "current" : ""}`;
          const color = processColors[route.processName] || "#64748b";
          return `<div class="mobile-process-segment ${cls}">
            <div class="mobile-segment-bar" style="background:${color}"></div>
            <div class="mobile-segment-name">${escapeHtml(route.processName)}</div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

function toDateTimeInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function formatTargetDisplay(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}$/);
  return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}` : "";
}

function parseTargetDisplay(value) {
  const text = String(value || "").trim().replaceAll("-", "/");
  if (!text || text === "yyyy/mm/dd --") return "";
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2})$/);
  if (!match) return "";
  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const hour = match[4].padStart(2, "0");
  if (Number(hour) > 23) return "";
  const date = new Date(`${year}-${month}-${day}T${hour}:00:00`);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) return "";
  return `${year}-${month}-${day}T${hour}:00`;
}

function todayCompact() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function todaySlash() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function normalizeDateInput(value) {
  const text = String(value || "").trim().replaceAll("-", "/");
  const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return "";
  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
}

function slashDateFromIso(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : "";
}

function fileNameFromUrl(url) {
  return decodeURIComponent(String(url || "").split("/").pop() || "附件");
}

function normalizeAttachment(file, index = 0) {
  const source = typeof file === "string" ? { url: file } : (file || {});
  const url = source.url || "";
  const name = source.name || fileNameFromUrl(url) || `附件${index + 1}`;
  const fileType = String(source.fileType || name.split(".").pop() || "").toLowerCase();
  return { ...source, url, name, fileType, drawingId: source.drawingId || source.id || "" };
}

function attachmentGroupButton(files, title = "附件") {
  const normalized = (files || []).map(normalizeAttachment).filter((file) => file.url);
  if (!normalized.length) return `<span class="muted">无</span>`;
  const groupId = `attachment-${attachmentGroupSequence += 1}`;
  attachmentGroups.set(groupId, { files: normalized, title });
  const count = normalized.length > 99 ? "99+" : normalized.length;
  return `<button class="attachment-group-button" type="button" data-preview-group="${groupId}" title="预览${escapeHtml(title)}"><span aria-hidden="true">图</span><small class="attachment-count">${count}</small></button>`;
}

function workOrderDrawings(data, workOrder) {
  const orderId = workOrder.order?.id || workOrder.orderId || "";
  return (data.drawings || []).filter((item) => item.workOrderId === workOrder.id || item.orderId === orderId);
}

function isoDate(offsetDays = 0) {
  const today = shanghaiDateKey(new Date());
  if (!today) return "";
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return date.toISOString().slice(0, 10);
}

function monthStartDate() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

function shanghaiDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function validateOrderForm(processIds) {
  const required = [
    ["订单号", el("orderNo").value],
    ["客户", el("customerId").value],
    ["产品名称", el("productName").value],
    ["数量", el("quantity").value],
    ["交期", el("dueDate").value],
  ];
  const missing = required.filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  if (missing.length) return `${missing.join("、")}必填`;
  if (Number(el("quantity").value) <= 0) return "数量必须大于 0";
  if (!normalizeDateInput(el("dueDate").value)) return "交期格式请填写 YYYY/MM/DD，例如 2026/06/12";
  if (!processIds.length) return "至少选择一道工序";
  if (!processIds.some((processId) => state.data.processes.find((process) => process.id === processId)?.name !== "质检")) return "质检前至少选择一道生产工序";
  return "";
}

function dashboard(data) {
  const workOrders = filterWorkOrdersBySource(data.workOrders, state.dashboardSource === "all" ? "" : state.dashboardSource, "")
    .filter((workOrder) => workOrder.creationStatus !== "pending");
  const workOrderIds = new Set(workOrders.map((workOrder) => workOrder.id));
  const dashboardData = { ...data, workOrders, routes: data.routes.filter((route) => workOrderIds.has(route.workOrderId)) };
  const overdue = workOrders.filter((w) => w.overdue).length;
  const openExceptions = data.exceptions.filter((e) => e.status !== "已解决").length;
  const active = workOrders.filter((w) => w.status !== "已完成").length;
  const finished = workOrders.filter((w) => {
    if (w.status !== "已完成") return false;
    const completedDate = shanghaiDateKey(w.completedAt);
    return completedDate && completedDate >= state.dashboardFinishedFrom && completedDate <= state.dashboardFinishedTo;
  }).length;
  const dispatchBoardButton = data.permissions?.viewBoardCustomer
    ? '<button class="btn secondary" data-action="openDispatchBoard">派工看板</button>'
    : "";
  return `
    <div class="topbar"><div><div class="dashboard-heading"><h2>生产总览</h2><button type="button" class="chart-center-link" data-view="charts" aria-label="打开图表中心" title="图表中心"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h17M7 15l4-4 3 2 6-7"></path><circle cx="7" cy="15" r="1"></circle><circle cx="11" cy="11" r="1"></circle><circle cx="14" cy="13" r="1"></circle><circle cx="20" cy="6" r="1"></circle></svg></button></div>${dashboardSourceTabs()}</div><div class="actions">${dispatchBoardButton}<button class="btn secondary" data-action="openMobileTv">手机横屏看板</button><button class="btn secondary" data-action="openTv">打开大屏看板</button><button class="btn secondary" data-action="refresh">刷新</button></div></div>
    <section class="grid cols-4">
      <div class="card metric"><span>生产中工单</span><strong>${active}</strong></div>
      <div class="card metric finished-metric"><button type="button" class="metric-link" data-action="openFinishedHistory"><span>已完成工单</span><strong>${finished}</strong></button><div class="metric-date-range"><input id="dashboardFinishedFrom" type="date" value="${state.dashboardFinishedFrom}" aria-label="完成开始日期"><span>至</span><input id="dashboardFinishedTo" type="date" value="${state.dashboardFinishedTo}" aria-label="完成结束日期"></div></div>
      <div class="card metric"><span>延期风险</span><strong>${overdue}</strong></div>
      <div class="card metric"><span>待处理异常</span><strong>${openExceptions}</strong></div>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>工序负荷</h3>
      <div class="grid cols-3">
        ${processLoadCards(dashboardData)}
      </div>
    </section>
    ${workOrderTable(dashboardData, { productionBoard: true })}
  `;
}

function chartCenterPage(data) {
  const workOrders = filterWorkOrdersBySource(data.workOrders, state.dashboardSource === "all" ? "" : state.dashboardSource, "")
    .filter((workOrder) => workOrder.creationStatus !== "pending");
  const workOrderIds = new Set(workOrders.map((workOrder) => workOrder.id));
  const dashboardData = { ...data, workOrders, routes: data.routes.filter((route) => workOrderIds.has(route.workOrderId)) };
  const insights = scheduleInsightData(dashboardData, new Date(), state.dashboardInsightDays)
    .filter((item) => !state.dashboardProcess || item.name === state.dashboardProcess);
  const trends = dashboardTrendData(data);
  const reportTrendValues = trends.map((item) => ({ date: item.date, reportCount: item.reportCount }));
  const trendRange = `<div class="insight-period" role="group" aria-label="图表统计范围">${[7, 30, 90].map((days) => `<button type="button" class="${state.dashboardInsightDays === days ? "active" : ""}" data-insight-days="${days}">近${days}天</button>`).join("")}</div>`;
  return `<div class="topbar chart-center-topbar"><div><h2>图表中心</h2>${dashboardSourceTabs()}</div><div class="actions"><button type="button" class="btn secondary" data-view="dashboard">返回生产总览</button></div></div>
    <section class="chart-center-toolbar"><div><strong>统计范围</strong>${trendRange}<span class="muted">按北京时间自然日统计，含今天</span></div></section>
    <div class="daily-trend-grid">${trendLineChart("每日新增订单", trends.map((item) => ({ date: item.date, orders: item.orderCount })), "orders", [{ key: "orders", label: "订单数", color: "#2873a5" }])}${trendLineChart("每日报工总次数", reportTrendValues, "reports", [{ key: "reportCount", label: "报工总次数", color: "#118477" }])}</div>
    <section class="insight-toolbar"><div><h3>排产诊断</h3><p class="muted">按工序查看排期风险和计划执行情况；点击有数据的色块查看工单清单。</p></div><label>工序筛选 <select id="dashboardProcess"><option value="">全部工序</option>${dashboardProcesses(dashboardData).map((process) => `<option value="${escapeHtml(process.name)}" ${state.dashboardProcess === process.name ? "selected" : ""}>${escapeHtml(process.name)}</option>`).join("")}</select></label></section>
    ${scheduleInsightCharts(insights)}
    ${dashboardInsightModal(insights)}
    ${dashboardTrendModal(data)}`;
}

function visibleWorkOrders(data, options = {}) {
  return data.workOrders
    .filter((workOrder) => workOrder.status !== "已完成")
    .filter((workOrder) => options.includePending || workOrder.creationStatus !== "pending")
    .slice()
    .sort((a, b) => {
      if (options.pendingFirst && a.creationStatus !== b.creationStatus) return a.creationStatus === "pending" ? -1 : 1;
      return String(a.order?.dueDate || "9999-12-31").localeCompare(String(b.order?.dueDate || "9999-12-31"));
    });
}

function workOrderTable(data, options = {}) {
  const canDelete = Boolean(options.allowDelete) && (canManageRole(state.user?.role) || data.permissions?.forceDeleteWorkOrders);
  const canEdit = Boolean(options.allowEdit) && data.permissions?.editOrders;
  const canConfirm = Boolean(options.allowConfirm) && data.permissions?.editOrders;
  const workOrders = visibleWorkOrders(data, options);
  return `
    <section class="panel" style="margin-top:14px">
      <h3>生产进度看板</h3>
      <div class="table-wrap">
        <table class="work-order-table">
          <thead><tr><th>工单</th><th>客户/产品/数量</th><th>创建时间</th><th>当前工序</th><th>交期</th><th>状态</th><th>进度</th><th>图纸</th><th>异常</th><th>备注</th>${canDelete || canEdit || canConfirm ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${workOrders
              .map(
                (w) => `
                  <tr>
                    <td>${escapeHtml(w.workNo)}<br>${options.productionBoard ? productionSourceBadge(w) : orderSourceBadge(w, data.permissions?.viewOrderFinancials)}</td>
                    <td>${escapeHtml(workOrderCustomerName(w))}<br><span class="muted">${escapeHtml(workOrderProductName(w))}</span><br><span class="muted">${escapeHtml(w.planQty)} ${workOrderQuantityUnit(w)}</span></td>
                    <td>${escapeHtml(formatDateTime(w.order?.createdAt || w.createdAt))}</td>
                    <td>${escapeHtml(w.currentProcess || "-")}</td>
                    <td>${escapeHtml(w.order?.dueDate || "")}${w.overdue ? " " + tag("延期") : ""}</td>
                    <td>${tag(workOrderDisplayStatus(w))}</td>
                    <td><div class="progress"><div style="width:${w.progress}%"></div></div><span class="muted">${w.progress}%</span></td>
                    <td>${attachmentGroupButton(workOrderDrawings(data, w), `${w.workNo} ${w.productName}`)}</td>
                    <td>${w.hasException ? tag("异常") : tag("正常")}</td>
                    <td class="note-cell">${escapeHtml(w.order?.note || "-")}</td>
                    ${canDelete || canEdit || canConfirm ? `<td><div class="actions">${canEdit ? `<button class="btn secondary compact" data-edit-order="${w.orderId}">编辑</button>` : ""}${canConfirm && w.creationStatus === "pending" ? `<button class="btn compact" data-confirm-platform-order="${w.orderId}">确认创建</button>` : ""}${canDelete ? `<button class="btn danger compact" data-delete-work-order="${w.id}">删除</button>` : ""}</div></td>` : ""}
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function ordersPage(data, source = "all") {
  const sourceValue = source === "all" ? "" : source;
  const filteredWorkOrders = filterWorkOrdersBySource(data.workOrders, sourceValue, source === "platform" ? state.orderSourceChannel : "");
  const pageData = { ...data, workOrders: filteredWorkOrders };
  const channelFilter = source === "platform" ? `<label class="field"><span>平台渠道</span><select id="orderSourceChannel"><option value="">全部平台渠道</option>${Object.entries(sourceChannelLabels).map(([value, label]) => `<option value="${value}" ${state.orderSourceChannel === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>` : "";
  const financialFields = data.permissions?.viewOrderFinancials ? `<label class="field"><span>单价（元）</span><input id="unitPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="选填"></label><label class="field"><span>总金额（元）</span><input id="totalAmount" type="text" readonly value=""></label>` : "";
  return `
    <div class="topbar"><h2>订单与工单</h2><button class="btn" data-action="showOrderForm">新建订单</button></div>
    ${channelFilter}
    <section class="panel" id="orderForm" style="display:none;margin-bottom:14px">
      <h3>新建订单</h3>
      <div class="form-grid">
        <label class="field"><span>订单号</span><input id="orderNo" value="${todayCompact()}" /></label>
        <label class="field"><span>客户</span><select id="customerId"><option value="">请选择客户</option>${data.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select></label>
        <label class="field"><span>产品名称</span><input id="productName" value="非标钣金件" /></label>
        <label class="field"><span>激光编号</span><input id="drawingNo" placeholder="请输入激光编号" /></label>
        <label class="field"><span>数量</span><div class="quantity-control"><input id="quantity" type="number" value="10" min="1" step="1" /><select id="quantityUnit"><option value="件" selected>件</option><option value="套">套</option></select></div></label>
        <label class="field"><span>交期</span><div class="date-combo"><input id="dueDate" placeholder="yyyy/mm/dd" inputmode="numeric" /><button class="date-pick-trigger" type="button" data-action="openDueDatePicker">选择</button><input id="dueDatePicker" class="date-hidden-picker" type="date" /></div></label>
        ${financialFields}
        <label class="field"><span>优先级</span><select id="priority"><option>普通</option><option>急单</option></select></label>
        <label class="field"><span>重量（KG）</span><input id="weightKg" type="number" min="0" step="1" placeholder="请输入总重量" /></label>
        <label class="field wide"><span>图纸附件</span><input id="drawingFiles" type="file" accept=".jpg,.jpeg,.png,.pdf,.dwg,.dxf" multiple /><small class="muted">支持图片、PDF、DWG、DXF；图片可直接缩略预览，CAD 先保存原文件。</small></label>
        <div class="field wide"><span>选择工序</span><div class="checks">${activeTechProcesses(data).map((p) => `<label class="check-pill"><input type="checkbox" name="process" value="${p.id}" ${["设计", "激光", "折弯", "焊接", "打磨", "质检"].includes(p.name) ? "checked" : ""}>${p.name}</label>`).join("")}</div></div>
        <label class="field wide"><span>备注</span><textarea id="note" placeholder="特殊要求、包装、交货说明"></textarea></label>
      </div>
      <button class="btn" data-action="createOrder">保存订单并生成工单</button>
    </section>
    ${workOrderTable(pageData, { allowDelete: true, allowEdit: true, allowConfirm: source === "platform", includePending: true, pendingFirst: source === "platform" })}
    ${orderEditModal(data)}
    ${platformConfirmModal(data)}
  `;
}

function platformConfirmModal(data) {
  const order = data.orders.find((item) => item.id === state.confirmingPlatformOrderId);
  const workOrder = data.workOrders.find((item) => item.orderId === order?.id);
  if (!order || !workOrder) return "";
  const productName = platformOrderProductName(order) === "待补产品信息" ? "" : platformOrderProductName(order);
  return `<div class="dialog-backdrop" data-action="closePlatformConfirm"><section class="dialog" onclick="event.stopPropagation()">
    <div class="topbar"><div><h3>确认创建平台工单</h3><p class="muted">${escapeHtml(order.orderNo)} / ${escapeHtml(productName || "待补产品信息")}</p></div><button class="btn secondary compact" data-action="closePlatformConfirm">关闭</button></div>
    <div class="form-grid">
      <label class="field"><span>产品名称</span><input id="confirmProductName" value="${escapeHtml(productName)}" placeholder="请补充实际产品名称" required></label>
      <label class="field"><span>激光编号</span><input id="confirmDrawingNo" value="${escapeHtml(order.drawingNo || "")}" placeholder="请输入激光编号"></label>
      <label class="field"><span>数量</span><div class="quantity-control"><input id="confirmQuantity" type="number" min="1" step="1" value="${Number(order.quantity || 1)}"><select id="confirmQuantityUnit"><option value="件" ${quantityUnit(order.quantityUnit) === "件" ? "selected" : ""}>件</option><option value="套" ${quantityUnit(order.quantityUnit) === "套" ? "selected" : ""}>套</option></select></div></label>
      <label class="field"><span>交期</span><input id="confirmDueDate" type="date" value="${escapeHtml(order.dueDate || "")}"></label>
      <label class="field"><span>优先级</span><select id="confirmPriority"><option ${order.priority !== "急单" ? "selected" : ""}>普通</option><option ${order.priority === "急单" ? "selected" : ""}>急单</option></select></label>
      <label class="field"><span>重量（KG）</span><input id="confirmWeightKg" type="number" min="0" step="1" value="${escapeHtml(order.weightKg ?? "")}" placeholder="请输入总重量"></label>
      <label class="field"><span>配送地区</span><input id="confirmRegion" value="${escapeHtml(order.region || order.externalRegion || "")}" placeholder="已读取客户下单地址，可手动修正"></label>
      <label class="field"><span>详细配送地址</span><input id="confirmDeliveryAddress" value="${escapeHtml(order.deliveryAddress || order.externalDeliveryAddress || "")}" placeholder="已读取客户下单地址，可手动修正"></label>
      <label class="field wide"><span>图纸附件</span><input id="confirmDrawingFiles" type="file" accept=".jpg,.jpeg,.png,.pdf,.dwg,.dxf" multiple><small class="muted">支持图片、PDF、DWG、DXF；会随确认创建关联到本工单。</small></label>
      <label class="field wide"><span>备注</span><textarea id="confirmNote">${escapeHtml(order.note || "")}</textarea></label>
    </div>
    <div class="field wide"><span>选择工序</span><div class="checks">${activeTechProcesses(data).map((process) => `<label class="check-pill"><input type="checkbox" name="confirmProcess" value="${process.id}">${process.name}</label>`).join("")}</div></div>
    <div class="actions"><button class="btn" data-action="submitPlatformConfirm">确认创建工单</button></div>
  </section></div>`;
}

function orderEditModal(data) {
  const order = data.orders.find((item) => item.id === state.editingOrderId);
  if (!order) return "";
  const orderWorkOrder = data.workOrders.find((item) => item.orderId === order.id);
  const productName = orderWorkOrder?.creationStatus === "pending" && platformOrderProductName(order) === "待补产品信息" ? "" : order.productName || "";
  const drawings = data.drawings.filter((item) => item.orderId === order.id && !item.removedAt);
  const financialFields = data.permissions?.viewOrderFinancials ? `<label class="field"><span>单价（元）</span><input id="editUnitPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(order.unitPrice ?? "")}" placeholder="选填"></label><label class="field"><span>总金额（元）</span><input id="editTotalAmount" type="text" readonly value="${escapeHtml(order.totalAmount ?? "")}"></label>` : "";
  return `<div class="dialog-backdrop order-edit-backdrop" data-action="closeOrderEdit"><section class="dialog order-edit-dialog" onclick="event.stopPropagation()">
    <div class="topbar"><h3>编辑订单</h3><button class="btn secondary compact" data-action="closeOrderEdit">关闭</button></div>
    <div class="form-grid">
      <label class="field"><span>订单号</span><input id="editOrderNo" value="${escapeHtml(order.orderNo)}"></label>
      <label class="field"><span>客户</span><select id="editCustomerId">${data.customers.map((c) => `<option value="${c.id}" ${c.id === order.customerId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
      <label class="field"><span>产品名称</span><input id="editProductName" value="${escapeHtml(productName)}" placeholder="${productName ? "" : "请补充实际产品名称"}"></label>
      <label class="field"><span>激光编号</span><input id="editDrawingNo" value="${escapeHtml(order.drawingNo || "")}"></label>
      <label class="field"><span>数量</span><div class="quantity-control"><input id="editQuantity" type="number" min="1" step="1" value="${escapeHtml(order.quantity)}"><select id="editQuantityUnit"><option value="件" ${quantityUnit(order.quantityUnit) === "件" ? "selected" : ""}>件</option><option value="套" ${quantityUnit(order.quantityUnit) === "套" ? "selected" : ""}>套</option></select></div></label>
      <label class="field"><span>交期</span><input id="editDueDate" type="date" value="${escapeHtml(order.dueDate || "")}"></label>
      ${financialFields}
      <label class="field"><span>优先级</span><select id="editPriority"><option ${order.priority === "普通" ? "selected" : ""}>普通</option><option ${order.priority === "急单" ? "selected" : ""}>急单</option></select></label>
      <label class="field"><span>重量（KG）</span><input id="editWeightKg" type="number" min="0" step="1" value="${escapeHtml(order.weightKg ?? "")}"></label>
      <label class="field wide"><span>备注</span><textarea id="editNote">${escapeHtml(order.note || "")}</textarea></label>
      <div class="field wide"><span class="attachment-field-title">现有附件 ${attachmentGroupButton(drawings, `${order.orderNo} ${order.productName}`)}</span><div class="attachment-list">${drawings.map((drawing) => `<label><input type="checkbox" data-remove-edit-drawing="${drawing.id}" ${state.editRemovedDrawingIds.includes(drawing.id) ? "checked" : ""}> 移除 ${escapeHtml(drawing.name)}</label>`).join("") || `<span class="muted">无</span>`}</div></div>
      <label class="field wide"><span>新增/更换附件</span><input id="editDrawingFiles" type="file" accept=".jpg,.jpeg,.png,.pdf,.dwg,.dxf" multiple></label>
    </div>
    <div class="actions"><button class="btn" data-action="saveOrderEdit">保存修改</button></div>
  </section></div>`;
}

function updateFinancialTotal(quantityId, priceId, totalId) {
  const quantity = Number(el(quantityId)?.value);
  const priceText = String(el(priceId)?.value || "").trim();
  const total = el(totalId);
  if (!total) return;
  if (!priceText) {
    total.value = "";
    return;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || !Number.isFinite(quantity)) {
    total.value = "";
    return;
  }
  total.value = (Number(priceText) * quantity).toFixed(2);
}

function customersPage(data) {
  const canDelete = Boolean(data.permissions?.deleteCustomers);
  return `
    <div class="topbar"><h2>客户资料</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    <section class="panel" style="margin-bottom:14px">
      <h3>新增客户</h3>
      <div class="form-grid">
        <label class="field"><span>客户名称</span><input id="customerName" placeholder="客户公司/联系人名称" /></label>
        <label class="field"><span>联系人</span><input id="customerContact" placeholder="联系人" /></label>
        <label class="field"><span>电话</span><input id="customerPhone" placeholder="联系电话" /></label>
        <label class="field"><span>地址</span><input id="customerAddress" placeholder="交货/开票地址" /></label>
        <label class="field wide"><span>备注</span><textarea id="customerNote" placeholder="付款、包装、交付要求等"></textarea></label>
      </div>
      <button class="btn" data-action="createCustomer">保存客户</button>
    </section>
    <section class="panel">
      <h3>客户列表</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户</th><th>联系人</th><th>电话</th><th>地址</th><th>备注</th>${canDelete ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${data.customers
              .map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.contact || "")}</td><td>${escapeHtml(c.phone || "")}</td><td>${escapeHtml(c.address || "")}</td><td>${escapeHtml(c.note || "")}</td>${canDelete ? `<td><button class="btn danger compact" data-delete-customer="${c.id}">停用</button></td>` : ""}</tr>`)
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function dispatchPage(data) {
  const workOrders = data.workOrders.filter((item) => item.status !== "已完成" || scheduleDraftsFor(item.id).length);
  return `
    <div class="topbar"><h2>派工与工艺路线</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    <section class="panel">
      ${workOrders
        .map(
          (w) => {
            const collapsed = isDispatchCollapsed(w.id);
            return `
            <div class="card dispatch-work-card ${collapsed ? "collapsed" : ""}" data-dispatch-work="${w.id}">
              <div class="task-title dispatch-work-head">
                <div><h3>${escapeHtml(w.workNo)} ${escapeHtml(w.productName)}</h3><p>${orderSourceBadge(w)}</p><p class="muted">${escapeHtml(w.customer?.name || "")} / 交期 ${escapeHtml(w.order?.dueDate || "")}</p><p class="muted">创建时间 ${escapeHtml(formatDateTime(w.order?.createdAt || w.createdAt))}</p></div>
                <button class="dispatch-collapse-toggle" data-toggle-dispatch-collapse="${w.id}" title="${collapsed ? "展开工序" : "收起工序"}" aria-label="${collapsed ? "展开工序" : "收起工序"}">${collapsed ? "v" : "^"}</button>
                <div class="actions">${tag(w.status)}<button class="btn secondary compact" data-print-qr-sheet="${w.id}">打印二维码</button></div>
              </div>
              ${collapsed ? "" : `<div class="dispatch-work-body">
                ${w.routes
                .map(
                  (r) => `
                    <div class="route-row ${state.scheduleErrors[w.id]?.routeId === r.id ? "schedule-conflict" : ""}">
                      <strong>${r.sequence}. ${escapeHtml(r.processName)}</strong>
                      <div><div class="progress"><div style="width:${Math.round((r.completedQty / r.planQty) * 100)}%"></div></div><span class="muted">${r.completedQty}/${r.planQty} ${workOrderQuantityUnit(w)}</span></div>
                      <select data-route="${r.id}" class="assignSelect">
                        <option value="">按工种自动派工</option>
                        ${assigneeOptions(data, r.assignedTo, r.processName)}
                      </select>
                      ${routeScheduleControl(r.id, r.plannedStartDate, r.plannedEndDate || r.targetFinishTime)}
                      ${tag(r.status)}
                      ${Number(r.completedQty || 0) > 0 || r.status === "已完成" ? `<span class="route-delete-disabled">不可删除</span>` : `<button class="btn secondary compact" data-delete-route="${r.id}">删除</button>`}
                    </div>
                  `
                )
                .join("")}
              </div>`}
              ${collapsed ? "" : `<div class="dispatch-work-footer">
                <div class="add-route-row">
                  <select id="newProcess_${w.id}" data-new-process="${w.id}">${processOptions(data)}</select>
                  <button class="btn" data-add-route="${w.id}">新增工序</button>
                </div>
                <div class="actions schedule-toolbar" data-schedule-toolbar="${w.id}">${scheduleToolbar(w.id)}</div>
              </div>`}
            </div>
          `;
          }
        )
        .join("")}
    </section>
  `;
}

function qualityInspectionCandidates(data) {
  return data.workOrders
    .map((workOrder) => {
      const routes = data.routes
        .filter((route) => route.workOrderId === workOrder.id)
        .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
      const qualityRoute = routes.find((route) => route.processName === "质检" && route.routeType !== "rework");
      const sourceRoute = routes
        .filter((route) => route.sequence < Number(qualityRoute?.sequence || 0) && route.processName !== "质检" && route.routeType !== "rework")
        .at(-1);
      const completedRoutes = routes.filter((route) => route.processName !== "质检" && route.routeType !== "rework" && route.status === "已完成");
      return { workOrder, qualityRoute, sourceRoute, completedRoutes };
    })
    .filter((item) => item.qualityRoute && item.sourceRoute?.status === "已完成" && ["待开始", "进行中"].includes(item.qualityRoute.status) && Number(item.qualityRoute.inspectionAvailableQty || 0) > 0);
}

function qualityInspectionForm(data) {
  const candidates = qualityInspectionCandidates(data);
  const selected = candidates.find((item) => item.workOrder.id === state.qualityInspection.workOrderId) || null;
  const availableQty = Number(selected?.qualityRoute.inspectionAvailableQty || 0);
  const unit = workOrderQuantityUnit(selected?.workOrder);
  const routeOptions = selected?.completedRoutes || [];
  return `
    <section class="panel" style="margin-bottom:14px">
      <h3>后台质检报工</h3>
      <div class="form-grid">
        <label class="field"><span>可质检工单</span><select id="qualityInspectionWorkOrder"><option value="">请选择工单</option>${candidates.map((item) => `<option value="${item.workOrder.id}" ${selected?.workOrder.id === item.workOrder.id ? "selected" : ""}>${escapeHtml(item.workOrder.workNo)} / ${escapeHtml(item.workOrder.customer?.name || "")} / ${escapeHtml(item.workOrder.productName)}</option>`).join("")}</select></label>
        <label class="field"><span>本次送检数量（${unit}）</span><input id="qualityInspectionSubmittedQty" type="number" min="1" value="${availableQty}" ${selected ? "" : "disabled"} /></label>
        <label class="field"><span>本次检验数量（${unit}）</span><input id="qualityInspectionInspectedQty" type="number" min="1" value="${availableQty}" ${selected ? "" : "disabled"} /></label>
        <label class="field"><span>合格数量（${unit}）</span><input id="qualityInspectionGoodQty" type="number" min="0" value="${availableQty}" ${selected ? "" : "disabled"} /></label>
        <label class="field"><span>不合格数量（${unit}）</span><input id="qualityInspectionBadQty" type="number" min="0" value="0" ${selected ? "" : "disabled"} /></label>
        <label class="field"><span>处置方式</span><select id="qualityInspectionDisposition" ${selected ? "" : "disabled"}><option>无需处理</option><option>返工</option><option>让步接收</option><option>报废</option></select></label>
        <label class="field"><span>问题工序</span><select id="qualityInspectionIssueRoute" ${selected ? "" : "disabled"}><option value="">请选择问题工序</option>${routeOptions.map((route) => `<option value="${route.id}">${escapeHtml(route.sequence)}. ${escapeHtml(route.processName)}</option>`).join("")}</select></label>
        <label class="field"><span>返工工序</span><select id="qualityInspectionReworkRoute" ${selected ? "" : "disabled"}><option value="">请选择返工工序</option>${routeOptions.map((route) => `<option value="${route.id}">${escapeHtml(route.sequence)}. ${escapeHtml(route.processName)}</option>`).join("")}</select></label>
        <label class="field wide"><span>问题说明</span><textarea id="qualityInspectionDescription" placeholder="不合格时填写问题、位置、数量和处理建议" ${selected ? "" : "disabled"}></textarea></label>
        <label class="field wide"><span>问题照片</span><input id="qualityInspectionImages" type="file" accept=".jpg,.jpeg,.png" multiple ${selected ? "" : "disabled"} /></label>
      </div>
      <button class="btn" data-action="submitQualityInspection" ${selected ? "" : "disabled"}>提交质检结果</button>
    </section>
  `;
}

function exceptionsPage(data) {
  const filters = state.exceptionFilters;
  const items = data.exceptions
    .filter((e) => {
      const wo = data.workOrders.find((w) => w.id === e.workOrderId);
      const route = data.routes.find((r) => r.id === e.routeId);
      const dateText = String(e.createdAt || "").slice(0, 10);
      if (filters.customerId && wo?.customer?.id !== filters.customerId) return false;
      if (filters.processName && route?.processName !== filters.processName) return false;
      if (filters.status && e.status !== filters.status) return false;
      if (filters.from && dateText < filters.from) return false;
      if (filters.to && dateText > filters.to) return false;
      return true;
    });
  return `
    <div class="topbar"><h2>质检详情</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    ${qualityInspectionForm(data)}
    <section class="panel filter-panel">
      <select id="exceptionCustomerFilter"><option value="">全部客户</option>${data.customers.map((c) => `<option value="${c.id}" ${filters.customerId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
      <select id="exceptionProcessFilter"><option value="">全部工序</option>${techProcessNames.map((name) => `<option value="${name}" ${filters.processName === name ? "selected" : ""}>${name}</option>`).join("")}</select>
      <select id="exceptionStatusFilter"><option value="">全部状态</option>${["待处理", "已解决"].map((name) => `<option value="${name}" ${filters.status === name ? "selected" : ""}>${name}</option>`).join("")}</select>
      <input id="exceptionFromFilter" type="date" value="${escapeHtml(filters.from)}" />
      <input id="exceptionToFilter" type="date" value="${escapeHtml(filters.to)}" />
    </section>
    <section class="panel">
      ${items.length ? exceptionListTable(items, data, true) : `<div class="empty">暂无异常</div>`}
    </section>
  `;
}

function customerFeedbackPage(data) {
  const selectedCustomerId = state.customerFeedback.customerId;
  const completedWorkOrders = data.workOrders.filter((item) => item.status === "已完成" && (!selectedCustomerId || item.customer?.id === selectedCustomerId));
  const selectedWorkOrder = completedWorkOrders.find((item) => item.id === state.customerFeedback.workOrderId);
  const feedbacks = (data.customerFeedbacks || []).slice().sort((a, b) => String(b.feedbackAt || b.createdAt).localeCompare(String(a.feedbackAt || a.createdAt)));
  return `<div class="topbar"><h2>客户反馈</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    <section class="panel" style="margin-bottom:14px"><h3>新增客户反馈</h3><div class="form-grid">
      <label class="field"><span>客户</span><select id="feedbackCustomerId"><option value="">请选择客户</option>${data.customers.map((item) => `<option value="${item.id}" ${selectedCustomerId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
      <label class="field"><span>订单工单</span><select id="feedbackWorkOrderId" ${selectedCustomerId ? "" : "disabled"}><option value="">请选择已完成工单</option>${completedWorkOrders.map((item) => `<option value="${item.id}" ${selectedWorkOrder?.id === item.id ? "selected" : ""}>${escapeHtml(item.workNo)} / ${escapeHtml(item.productName)}</option>`).join("")}</select></label>
      <label class="field"><span>问题工序</span><select id="feedbackRouteId" ${selectedWorkOrder ? "" : "disabled"}><option value="">请选择工序</option>${(selectedWorkOrder?.routes || []).map((route) => `<option value="${route.id}">${escapeHtml(route.sequence)}. ${escapeHtml(route.processName)}</option>`).join("")}</select></label>
      <label class="field"><span>反馈时间</span><input id="feedbackAt" type="date" value="${isoDate(0)}"></label>
      <label class="field wide"><span>问题描述</span><textarea id="feedbackDescription" placeholder="记录客户反馈的问题、位置、数量及影响"></textarea></label>
      <label class="field wide"><span>问题照片</span><input id="feedbackImages" type="file" accept=".jpg,.jpeg,.png" multiple></label>
    </div><button class="btn" data-action="createCustomerFeedback">保存客户反馈</button></section>
    <section class="panel"><h3>反馈记录</h3><div class="feedback-list">${feedbacks.length ? feedbacks.map((item) => {
      const workOrder = data.workOrders.find((entry) => entry.id === item.workOrderId);
      const route = data.routes.find((entry) => entry.id === item.routeId);
      return `<article class="detail-record"><div class="task-title"><div><strong>${escapeHtml(workOrder?.customer?.name || "")} / ${escapeHtml(workOrder?.workNo || "")}</strong><p class="muted">${escapeHtml(route?.processName || "")} / ${escapeHtml(item.feedbackAt)}</p></div>${tag(item.status)}</div><p>${escapeHtml(item.description)}</p>${imageActions(item.images || [])}${item.status === "待处理" ? `<div class="compact-resolve"><input id="feedbackSolution_${item.id}" placeholder="填写处理结果"><button class="btn compact" data-resolve-feedback="${item.id}">标记已处理</button></div>` : `<p><strong>处理结果：</strong>${escapeHtml(item.solution || "")}</p>`}</article>`;
    }).join("") : `<div class="empty">暂无客户反馈</div>`}</div></section>`;
}

function historyPage(data) {
  const filters = state.historyFilters;
  const workOrders = state.historyResults.workOrders || [];
  return `
    <div class="topbar"><h2>历史查询</h2><button class="btn" data-action="searchHistory">查询</button></div>
    <section class="panel filter-panel">
      <select id="historyDateType"><option value="createdAt" ${filters.dateType === "createdAt" ? "selected" : ""}>创建时间</option><option value="dueDate" ${filters.dateType === "dueDate" ? "selected" : ""}>交期时间</option><option value="completedAt" ${filters.dateType === "completedAt" ? "selected" : ""}>完工时间</option></select>
      <div class="date-combo"><input id="historyFrom" placeholder="开始时间" inputmode="numeric" value="${escapeHtml(slashDateFromIso(filters.from))}" /><button class="date-pick-trigger" type="button" data-history-date="from">选择</button><input id="historyFromPicker" class="date-hidden-picker" type="date" value="${escapeHtml(filters.from)}" /></div>
      <div class="date-combo"><input id="historyTo" placeholder="结束时间" inputmode="numeric" value="${escapeHtml(slashDateFromIso(filters.to))}" /><button class="date-pick-trigger" type="button" data-history-date="to">选择</button><input id="historyToPicker" class="date-hidden-picker" type="date" value="${escapeHtml(filters.to)}" /></div>
      <select id="historyCustomer"><option value="">全部客户</option>${data.customers.map((c) => `<option value="${c.id}" ${filters.customerId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
      <select id="historyStatus"><option value="">全部状态</option>${["生产中", "已完成", "已发货", "已开票"].map((name) => `<option value="${name}" ${filters.status === name ? "selected" : ""}>${name}</option>`).join("")}</select>
      <label class="field"><span>来源筛选</span><select id="historySource"><option value="">全部来源</option><option value="factory" ${filters.source === "factory" ? "selected" : ""}>工厂单</option><option value="platform" ${filters.source === "platform" ? "selected" : ""}>平台单</option></select></label>
      <label class="field"><span>平台渠道</span><select id="historySourceChannel"><option value="">全部平台渠道</option>${Object.entries(sourceChannelLabels).map(([value, label]) => `<option value="${value}" ${filters.sourceChannel === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="field"><span>工单号</span><input id="historyWorkNo" placeholder="输入工单号" value="${escapeHtml(filters.workNo || "")}" /></label>
    </section>
    <section class="panel" style="margin-bottom:14px">
      <h3>历史工单</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>工单</th><th>客户/产品/数量</th><th>重量</th><th>创建时间</th><th>交期</th><th>完工时间</th><th>状态</th><th>异常记录</th><th>图纸</th></tr></thead>
          <tbody>
            ${workOrders.length ? workOrders.map((item) => `
              <tr>
                <td><button class="history-order-link" type="button" data-history-order="${item.id}">${escapeHtml(item.workNo)}</button><br>${orderSourceBadge(item)}</td>
                <td>${escapeHtml(item.customerName)}<br><span class="muted">${escapeHtml(item.productName)}</span><br><span class="muted">${escapeHtml(item.planQty)} ${quantityUnit(item.quantityUnit)}</span></td>
                <td>${item.weightKg === null || item.weightKg === undefined ? "-" : `${escapeHtml(item.weightKg)} KG`}</td>
                <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
                <td>${escapeHtml(item.dueDate || "")}</td>
                <td>${escapeHtml(formatDateTime(item.completedAt))}</td>
                <td>${fulfillmentStatusControl(item, data.permissions?.manageOrderFulfillment)}</td>
                <td>${(item.qualityExceptions?.length || item.customerFeedbacks?.length) ? `<button class="btn secondary compact" data-history-detail="${item.id}">详情</button>` : `<span class="muted">无</span>`}</td>
                <td>${attachmentGroupButton(item.drawings || [], `${item.workNo} ${item.productName}`)}</td>
              </tr>
            `).join("") : `<tr><td colspan="9" class="empty">${state.historyResults.loaded ? "暂无历史工单" : "请选择条件后查询"}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${historyDetailModal()}
    ${historyOrderModal(data)}
  `;
}

function historyOrderModal(data) {
  const item = state.historyResults.workOrders.find((entry) => entry.id === state.historyOrderId);
  if (!item) return "";
  const repeatMode = state.repeatOrderMode;
  const canRepeat = item.productionStatus === "已完成" && userRoles(state.user).some(canManageRole);
  const editable = repeatMode ? "" : "readonly";
  const disabled = repeatMode ? "" : "disabled";
  const routes = (item.routes || []).filter((route) => route.routeType !== "rework").sort((a, b) => a.sequence - b.sequence);
  return `<div class="dialog-backdrop" data-action="closeHistoryOrder"><section class="dialog history-order-dialog ${repeatMode ? "history-order-editing" : "history-order-readonly"}" onclick="event.stopPropagation()">
    <div class="topbar"><div><h3>${repeatMode ? "创建返单" : "订单详情"}</h3><p>${orderSourceBadge(item)}</p><p class="muted">原工单：${escapeHtml(item.workNo)} / 原订单：${escapeHtml(item.orderNo)} / 状态：${escapeHtml(item.productionStatus)}${item.completedAt ? ` / 完工：${escapeHtml(formatDateTime(item.completedAt))}` : ""}</p></div><button class="btn secondary compact" data-action="closeHistoryOrder">关闭</button></div>
    <div class="form-grid history-order-fields" ${repeatMode ? "" : 'inert aria-disabled="true"'}>
      <label class="field"><span>订单号</span><input id="repeatOrderNo" value="${escapeHtml(item.orderNo)}" ${editable}></label>
      <label class="field locked-field"><span>客户</span><input value="${escapeHtml(item.customerName)}" readonly></label>
      <label class="field locked-field"><span>产品名称</span><input value="${escapeHtml(item.productName)}" readonly></label>
      <label class="field locked-field"><span>激光编号</span><input value="${escapeHtml(item.drawingNo || "")}" readonly></label>
      <label class="field"><span>数量</span><div class="quantity-control"><input id="repeatQuantity" type="number" min="1" step="1" value="${escapeHtml(item.planQty)}" ${editable}><input class="locked-control" value="${escapeHtml(quantityUnit(item.quantityUnit))}" readonly></div></label>
      <label class="field"><span>交期</span><input id="repeatDueDate" type="date" value="${escapeHtml(item.dueDate || "")}" ${editable}></label>
      <label class="field"><span>优先级</span><select id="repeatPriority" ${disabled}><option ${item.priority === "普通" ? "selected" : ""}>普通</option><option ${item.priority === "急单" ? "selected" : ""}>急单</option></select></label>
      <label class="field"><span>重量（KG）</span><input id="repeatWeightKg" type="number" min="0" step="1" value="${escapeHtml(item.weightKg ?? "")}" ${editable}></label>
      <div class="field wide locked-field"><span>工序路线</span><div class="history-route-list">${routes.map((route) => `<div class="history-route-item"><strong>${escapeHtml(route.sequence)}. ${escapeHtml(route.processName)}</strong>${tag(route.status)}<span>${escapeHtml(route.completedQty || 0)} / ${escapeHtml(route.planQty || item.planQty)} ${escapeHtml(quantityUnit(item.quantityUnit))}</span></div>`).join("") || `<span class="muted">无正式工序</span>`}</div></div>
      <label class="field wide"><span>备注</span><textarea id="repeatNote" ${editable}>${escapeHtml(item.note || "")}</textarea></label>
    </div>
    <div class="history-order-attachments"><span class="attachment-field-title">图纸附件 ${attachmentGroupButton(item.drawings || [], `${item.workNo} ${item.productName}`)}</span></div>
    <div class="actions"><button class="btn" data-action="saveRepeatOrder" ${repeatMode ? "" : "disabled"}>保存修改</button>${canRepeat && !repeatMode ? `<button class="btn secondary" data-action="enableRepeatOrder">返单</button>` : ""}</div>
  </section>${state.repeatOrderConfirmOpen ? `<div class="repeat-confirm-backdrop" onclick="event.stopPropagation()"><section class="repeat-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="repeatConfirmTitle"><h3 id="repeatConfirmTitle">确认返单</h3><p>确认基于该工单创建返单？原订单不会被修改。</p><div class="actions"><button class="btn" data-action="confirmRepeatOrder">确定</button><button class="btn secondary" data-action="cancelRepeatOrder">取消</button></div></section></div>` : ""}</div>`;
}

function fulfillmentStatusControl(item, canManage) {
  if (item.productionStatus !== "已完成" || !canManage) return tag(item.status);
  const open = state.openFulfillmentOrderId === item.orderId;
  return `<div class="fulfillment-control"><button class="tag ${statusClass[item.status] || ""} fulfillment-status" type="button" data-fulfillment-toggle="${item.orderId}" aria-expanded="${open}">${escapeHtml(item.status)}</button>${open ? `<div class="fulfillment-popover"><label><input type="checkbox" data-fulfillment="shipped" data-order-id="${item.orderId}" ${item.shippedAt ? "checked" : ""}> 已发货</label><label><input type="checkbox" data-fulfillment="invoiced" data-order-id="${item.orderId}" ${item.invoicedAt ? "checked" : ""}> 已开票</label></div>` : ""}</div>`;
}

function historyDetailModal() {
  const item = state.historyResults.workOrders.find((entry) => entry.id === state.historyDetailId);
  if (!item) return "";
  const records = (list, emptyText) => list?.length ? list.map((record) => `<article class="detail-record"><div class="task-title"><strong>${escapeHtml(record.processName || record.type || "")}</strong>${tag(record.status)}</div><p>${escapeHtml(record.description || "")}</p>${imageActions(record.images || [])}<p class="muted">记录：${escapeHtml(record.reporterName || "-")} / ${escapeHtml(formatDateTime(record.feedbackAt || record.createdAt))}</p>${record.solution ? `<p><strong>处理结果：</strong>${escapeHtml(record.solution)}</p><p class="muted">处理：${escapeHtml(record.resolvedByName || "-")} / ${escapeHtml(formatDateTime(record.resolvedAt))}</p>` : ""}</article>`).join("") : `<div class="empty">${emptyText}</div>`;
  return `<div class="dialog-backdrop" data-action="closeHistoryDetail"><section class="dialog detail-dialog" onclick="event.stopPropagation()"><div class="topbar"><h3>${escapeHtml(item.workNo)} 异常详情</h3><button class="btn secondary compact" data-action="closeHistoryDetail">关闭</button></div><h4>质检异常记录</h4>${records(item.qualityExceptions, "无质检异常")}<h4>客户反馈</h4>${records(item.customerFeedbacks, "无客户反馈")}</section></div>`;
}

function exceptionHistoryCard(e) {
  return `
    <div class="card">
      <div class="task-title">
        <div><h3>${escapeHtml(e.type)}</h3><p class="muted">${escapeHtml(e.customerName || "")} / ${escapeHtml(e.workNo || "")} / ${escapeHtml(e.processName || "")}</p></div>
        ${tag(e.status)}
      </div>
      <p>${escapeHtml(e.description || "")}</p>
      ${attachmentGroupButton(e.images || [], `${e.workNo || ""} 问题图片`)}
      <p class="muted">${escapeHtml(formatDateTime(e.createdAt))}</p>
    </div>
  `;
}

function imageActions(images = []) {
  return attachmentGroupButton(images, "问题图片");
}

function exceptionListTable(items, data, manage) {
  return `
    <div class="table-wrap">
      <table class="exception-list-table">
        <thead><tr><th>订单号/客户/产品</th><th>问题工序</th><th>报工人</th><th>问题描述</th><th>问题图片</th><th>时间/状态</th><th>处理</th></tr></thead>
        <tbody>
          ${items.map((e) => {
            const wo = data.workOrders.find((w) => w.id === e.workOrderId);
            const route = data.routes.find((r) => r.id === e.routeId);
            const reporterName = userNameText(data, e.reporterId);
            return `
              <tr>
                <td class="exception-main">
                  <div class="exception-main-stack">
                    <strong>${escapeHtml(wo?.workNo || "")}</strong>
                    <span>${escapeHtml(wo?.customer?.name || "")}</span>
                    <span>${escapeHtml(wo?.productName || "")}</span>
                  </div>
                </td>
                <td>${escapeHtml(e.type || route?.processName || "")}</td>
                <td>${escapeHtml(reporterName)}</td>
                <td class="exception-desc">${escapeHtml(e.description || "")}</td>
                <td>${imageActions(e.images || [])}</td>
                <td>${tag(e.status)}<br><span class="muted">${escapeHtml(formatDateTime(e.createdAt))}</span></td>
                <td class="exception-resolve-cell">${exceptionResolveContent(e, manage)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function exceptionCard(e, data, manage) {
  const wo = data.workOrders.find((w) => w.id === e.workOrderId);
  const route = data.routes.find((r) => r.id === e.routeId);
  const reporterName = userNameText(data, e.reporterId);
  return `
    <div class="card">
      <div class="task-title">
        <div><h3>${escapeHtml(e.type)}</h3><p class="muted">${escapeHtml(wo?.workNo || "")} / ${escapeHtml(route?.processName || "")} / ${escapeHtml(reporterName)}</p></div>
        ${tag(e.status)}
      </div>
      <p>${escapeHtml(e.description)}</p>
      ${attachmentGroupButton(e.images || [], `${wo?.workNo || ""} 异常图片`)}
      <p class="muted">${new Date(e.createdAt).toLocaleString()}</p>
      ${exceptionResolveContent(e, manage)}
    </div>
  `;
}

function exceptionResolveContent(e, manage) {
  if (e.status === "已解决") {
    return `<div class="exception-solution-box">${escapeHtml(e.solution || "已标记解决")}</div>`;
  }
  return manage ? `<div class="compact-resolve"><input id="solution_${e.id}" placeholder="处理说明" /><button class="btn compact" data-resolve="${e.id}">标记已解决</button></div>` : "-";
}

function reportUserSummaries(data) {
  const byId = new Map();
  data.users.filter((u) => isShopWorkerRole(u.role)).forEach((u) => byId.set(u.id, { ...u, deleted: false }));
  (data.deletedUsers || [])
    .filter((u) => data.reports.some((r) => r.reporterId === u.id))
    .forEach((u) => byId.set(u.id, { ...u, deleted: true }));
  return Array.from(byId.values());
}

function employeeRow(u) {
  const isSelf = u.id === state.user.id;
  const actionButtons = isSelf
    ? `<button class="btn secondary compact employee-self" disabled>当前账号</button>`
    : `<button class="btn danger compact" data-delete-user="${u.id}">删除</button>`;
  return `
    <div class="employee-row">
      <strong>${escapeHtml(u.name)}</strong>
      <span>${escapeHtml(u.phone)}</span>
      ${roleTags(userRoles(u))}
      ${tag(u.active !== false ? "启用" : "停用")}
      <div class="employee-actions">${actionButtons}</div>
    </div>
  `;
}

function employeeRoleGroups(users) {
  const groups = new Map(roleOrder.map((role) => [role, { role, users: [] }]));
  users.filter((u) => u.active !== false).forEach((user) => {
    const roles = userRoles(user);
    (roles.length ? roles : ["other"]).forEach((role) => {
      if (!groups.has(role)) groups.set(role, { role, users: [] });
      groups.get(role).users.push(user);
    });
  });
  return Array.from(groups.values()).filter((group) => group.users.length);
}

function employeeRoleGroupList(users) {
  return employeeRoleGroups(users)
    .map((group) => {
      const collapsed = isEmployeeRoleCollapsed(group.role);
      const label = roleNames[group.role] || "其他";
      return `
        <section class="employee-role-group ${collapsed ? "collapsed" : ""}">
          <button class="employee-role-toggle" type="button" data-toggle-employee-role="${escapeHtml(group.role)}" aria-expanded="${String(!collapsed)}">
            <span>${escapeHtml(label)}<em>${group.users.length} 人</em></span>
            <span aria-hidden="true">${collapsed ? "v" : "^"}</span>
          </button>
          ${collapsed ? "" : `<div class="employee-role-users">${group.users.map((user) => employeeRow(user)).join("")}</div>`}
        </section>
      `;
    })
    .join("");
}

function reportsPage(data) {
  const filteredReports = data.reports.filter((report) => {
    const date = shanghaiDateKey(report.createdAt);
    return date >= state.reportsFrom && date <= state.reportsTo;
  });
  const visibleReports = sortReportsByNewest(filteredReports);
  const sourceRows = completionSourceSummaryRows(data.completionSourceSummary);
  return `
    <div class="topbar report-topbar"><h2>基础报表</h2><div class="actions report-actions">
      <div class="report-date-group">
      <label class="compact-date-field"><span>开始日期</span><input id="reportsFrom" type="date" value="${state.reportsFrom}" /></label>
      <label class="compact-date-field"><span>结束日期</span><input id="reportsTo" type="date" value="${state.reportsTo}" /></label>
      </div>
      <div class="report-button-group">
      <button class="btn" data-action="exportManagementReport">导出管理分析</button>
      <button class="btn secondary" data-action="exportReportsCsv">导出报工 CSV</button><button class="btn secondary" data-action="export">导出完整数据</button>
      </div>
    </div></div>
    <section class="grid cols-3">
      ${reportUserSummaries(data)
        .map((u) => {
          const reports = filteredReports.filter((r) => r.reporterId === u.id);
          const totals = reports.reduce((result, report) => {
            const workOrder = data.workOrders.find((item) => item.id === report.workOrderId);
            result[workOrderQuantityUnit(workOrder)] += Number(report.completedQty || 0);
            return result;
          }, { 件: 0, 套: 0 });
          const quantityText = [totals.件 ? `${totals.件} 件` : "", totals.套 ? `${totals.套} 套` : ""].filter(Boolean).join(" / ") || "0 件";
          return `<div class="card metric"><span>${escapeHtml(u.name)}${u.deleted ? "（已删除）" : ""} 报工数量</span><strong>${quantityText}</strong></div>`;
        })
        .join("")}
    </section>
    <section class="panel" style="margin-top:14px"><h3>来源统计</h3><p class="muted">近30天完工来源</p><div class="grid cols-4">${sourceRows.map(([label, count]) => `<div class="card metric"><span>${label}</span><strong>${count} 单</strong><small>${label} ${count} 单</small></div>`).join("")}</div></section>
    <section class="panel" style="margin-top:14px">
      <div class="section-heading"><h3>报工记录</h3><span class="muted">${state.reportsFrom} 至 ${state.reportsTo}，共 ${visibleReports.length} 条</span></div>
      <div class="table-wrap"><table data-sort-table="reports" data-default-sort-column="0" data-default-sort-direction="desc"><thead><tr><th>时间</th><th>人员</th><th>工单</th><th>工序</th><th>报工数量</th><th>质量/返工结果</th><th>备注</th></tr></thead><tbody>
        ${visibleReports
          .map((r) => {
            const reporterName = userNameText(data, r.reporterId);
            const route = data.routes.find((item) => item.id === r.routeId);
            const wo = data.workOrders.find((w) => w.id === r.workOrderId);
            const unit = workOrderQuantityUnit(wo);
            const isQuality = r.reportType === "quality" || route?.processName === "质检";
            const quantityText = isQuality
              ? `送检 ${Number(r.submittedQty || 0)} ${unit} / 检验 ${Number(r.inspectedQty || 0)} ${unit}`
              : `完成 ${Number(r.completedQty || 0)} ${unit}`;
            const resultText = isQuality
              ? `合格 ${Number(r.goodQty || 0)} ${unit} / 不合格 ${Number(r.badQty || 0)} ${unit}${r.disposition ? ` / ${escapeHtml(r.disposition)}` : ""}`
              : `返工 ${Number(r.reworkQty || 0)} ${unit}`;
            return `<tr><td data-sort-value="${escapeHtml(r.createdAt || "")}">${new Date(r.createdAt).toLocaleString()}</td><td data-sort-value="${escapeHtml(reporterName)}">${escapeHtml(reporterName)}</td><td data-sort-value="${escapeHtml(wo?.workNo || "")}">${escapeHtml(wo?.workNo || "")}<br>${orderSourceBadge(wo)}</td><td data-sort-value="${escapeHtml(route?.processName || "")}">${escapeHtml(route?.processName || "")}</td><td data-sort-value="${Number(r.completedQty || r.inspectedQty || 0)}">${quantityText}</td><td data-sort-value="${Number(r.badQty || r.reworkQty || 0)}">${resultText}</td><td data-sort-value="${escapeHtml(r.note || "")}">${escapeHtml(r.note || "")}</td></tr>`;
          })
          .join("")}
      </tbody></table></div>
    </section>
  `;
}

function settingsPage(data) {
  return `
    <div class="topbar"><h2>基础设置</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    <section class="panel" style="margin-bottom:14px">
      <h3>新增员工</h3>
      <div class="form-grid">
        <label class="field"><span>姓名</span><input id="newUserName" placeholder="员工姓名" /></label>
        <label class="field"><span>手机号</span><input id="newUserPhone" placeholder="登录手机号" /></label>
        <div class="field"><span>岗位角色（可多选）</span>${rolePicker("newUserRoles", ["laser_worker"])}</div>
        <label class="field"><span>初始密码</span><input id="newUserPassword" value="123456" /></label>
      </div>
      <button class="btn" data-action="createUser">保存员工</button>
    </section>
    <section class="grid cols-2">
      <div class="panel"><h3>员工账号</h3>${employeeRoleGroupList(data.users)}</div>
      <div class="panel"><h3>标准工序</h3>${sortedTechProcesses(data).map((p, index) => `
        <div class="process-setting-row">
          <strong>${index + 1}. ${p.name}</strong>
          ${tag(p.active !== false ? "启用" : "停用")}
          <label class="switch">
            <input type="checkbox" data-process-status="${p.id}" ${p.active !== false ? "checked" : ""} />
            <span></span>
          </label>
        </div>
      `).join("")}</div>
    </section>
  `;
}

function deliveriesPage(data) {
  const pureDriver = userRoles(state.user).length === 1 && userRoles(state.user)[0] === "driver";
  if (pureDriver) return driverDeliveriesPage(data);
  const items = (data.deliveries || []).filter((delivery) => !pureDriver || delivery.driverId === state.user.id || delivery.status === "waiting").map((delivery) => {
    const order = data.orders.find((item) => item.id === delivery.orderId) || {};
    const driver = data.users.find((item) => item.id === delivery.driverId) || {};
    const proofs = (delivery.proofAttachmentIds || []).map((attachmentId) => data.attachments.find((attachment) => attachment.id === attachmentId)).filter(Boolean);
    return `<tr><td>${escapeHtml(order.orderNo || delivery.orderId)}<br><span class="muted">${escapeHtml(order.productName || "")}</span></td><td>${escapeHtml(delivery.addressSnapshot?.region || order.region || "地址待补全")}<br>${escapeHtml(delivery.addressSnapshot?.deliveryAddress || order.deliveryAddress || "")}</td><td>${deliveryStatusBadge(delivery.status)}</td><td>${escapeHtml(driver.name || "-")}</td><td>${escapeHtml(formatDateTime(delivery.startedAt || ""))}</td><td>${escapeHtml(formatDateTime(delivery.deliveredAt || ""))}</td><td>${deliveryProofButton(proofs, order)}</td><td>${["delivering", "delivered"].includes(delivery.status) ? `<button class="btn secondary compact" data-release-delivery="${order.id}">${delivery.status === "delivered" ? "纠正状态" : "退回待配送"}</button>` : "-"}</td></tr>`;
  }).join("");
  return `<div class="topbar"><h2>配送管理</h2><button class="btn secondary" data-action="refresh">刷新</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>订单</th><th>配送地址</th><th>状态</th><th>司机</th><th>出发时间</th><th>送达时间</th><th>送达凭证</th><th>操作</th></tr></thead><tbody>${items || `<tr><td colspan="8" class="muted">暂无配送记录</td></tr>`}</tbody></table></div></section>`;
}

function deliveryStatusBadge(status) {
  const labels = { waiting: "待配送", delivering: "配送中", delivered: "已送达", legacy_shipped: "旧数据已发货待确认" };
  const kind = Object.hasOwn(labels, status) ? status : "unknown";
  return `<span class="delivery-status delivery-status--${kind}">${escapeHtml(labels[status] || status)}</span>`;
}

function deliveryProofButton(proofs, order) {
  return attachmentGroupButton(proofs, `${order.orderNo || order.id || "订单"} 送达凭证`);
}

function deliveryOrder(data, delivery) {
  return data.orders.find((item) => item.id === delivery.orderId) || {};
}

function deliveryAddress(order, delivery) {
  const region = delivery.addressSnapshot?.region || order.region || "";
  const address = delivery.addressSnapshot?.deliveryAddress || order.deliveryAddress || "";
  return { region, address, searchText: `${region} ${address}`.toLowerCase() };
}

function driverDeliveriesPage(data) {
  const filter = state.deliveryRegion.trim().toLowerCase();
  const ownDeliveries = (data.deliveries || []).filter((delivery) => delivery.driverId === state.user.id);
  const waiting = (data.deliveries || [])
    .filter((delivery) => delivery.status === "waiting")
    .filter((delivery) => {
      const address = deliveryAddress(deliveryOrder(data, delivery), delivery);
      return Boolean(address.region.trim() && address.address.trim());
    })
    .filter((delivery) => !filter || deliveryAddress(deliveryOrder(data, delivery), delivery).searchText.includes(filter));
  const delivering = ownDeliveries.filter((delivery) => delivery.status === "delivering");
  const delivered = ownDeliveries.filter((delivery) => delivery.status === "delivered");
  const legacy = ownDeliveries.filter((delivery) => delivery.status === "legacy_shipped");
  const waitingRows = waiting.map((delivery) => {
    const order = deliveryOrder(data, delivery);
    const address = deliveryAddress(order, delivery);
    return `<tr><td><input type="checkbox" data-delivery-select="${escapeHtml(order.id)}" aria-label="选择订单 ${escapeHtml(order.orderNo || order.id)}" /></td><td><strong>${escapeHtml(order.orderNo || order.id)}</strong><br><span class="muted">${escapeHtml(order.productName || "")}</span></td><td>${escapeHtml(address.region || "地址待补全")}<br>${escapeHtml(address.address)}</td><td>${deliveryStatusBadge(delivery.status)}</td></tr>`;
  }).join("");
  const activeCards = delivering.map((delivery) => {
    const order = deliveryOrder(data, delivery);
    const address = deliveryAddress(order, delivery);
    return `<article class="delivery-card"><div class="delivery-card-head"><div><strong>${escapeHtml(order.orderNo || order.id)}</strong><span>${escapeHtml(order.productName || "")}</span></div>${deliveryStatusBadge("delivering")}</div><p>${escapeHtml(address.region || "地址待补全")} ${escapeHtml(address.address)}</p><div class="delivery-proof-form"><label class="field"><span>送达照片（1～3 张）</span><input id="deliveryPhotos_${escapeHtml(order.id)}" type="file" accept="image/*" multiple /></label><label class="field"><span>送达备注（选填）</span><textarea id="deliveryNote_${escapeHtml(order.id)}" placeholder="例如：客户本人签收"></textarea></label></div><div class="delivery-actions"><button class="btn secondary compact" data-release-delivery="${escapeHtml(order.id)}">退回待配送</button><button class="btn compact" data-complete-delivery="${escapeHtml(order.id)}">确认送达</button></div></article>`;
  }).join("");
  const deliveredRows = delivered.map((delivery) => {
    const order = deliveryOrder(data, delivery);
    const proofs = (delivery.proofAttachmentIds || []).map((attachmentId) => data.attachments.find((attachment) => attachment.id === attachmentId)).filter(Boolean);
    return `<tr><td>${escapeHtml(order.orderNo || order.id)}</td><td>${deliveryStatusBadge(delivery.status)}</td><td>${escapeHtml(formatDateTime(delivery.deliveredAt || ""))}</td><td>${deliveryProofButton(proofs, order)}</td><td>${escapeHtml(delivery.note || "-")}</td></tr>`;
  }).join("");
  const legacyRows = legacy.map((delivery) => {
    const order = deliveryOrder(data, delivery);
    return `<tr><td>${escapeHtml(order.orderNo || order.id)}</td><td>${deliveryStatusBadge(delivery.status)}</td><td>${escapeHtml(formatDateTime(delivery.startedAt || ""))}</td></tr>`;
  }).join("");
  return `
    <div class="topbar"><h2>配送任务</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    <section class="panel delivery-section">
      <div class="delivery-section-head"><div><h3>待配送平台单</h3><p class="muted">可按地区或地址筛选，并一次领取多个订单。</p></div><div class="delivery-filter"><input id="deliveryRegion" value="${escapeHtml(state.deliveryRegion)}" placeholder="输入地区或地址" /><button class="btn secondary compact" data-filter-deliveries>筛选</button></div></div>
      <div class="table-wrap"><table class="delivery-waiting-table"><thead><tr><th>选择</th><th>订单</th><th>配送地址</th><th>状态</th></tr></thead><tbody>${waitingRows || `<tr><td colspan="4" class="muted">暂无符合条件的待配送订单</td></tr>`}</tbody></table></div>
      <div class="delivery-start"><span>共 ${waiting.length} 个待配送订单</span><button class="btn" data-start-delivery-trip>开始配送所选订单</button></div>
    </section>
    <section class="panel delivery-section"><h3>配送中</h3><div class="delivery-card-list">${activeCards || `<p class="muted">暂无配送中的订单</p>`}</div></section>
    <section class="panel delivery-section"><h3>已送达记录</h3><div class="table-wrap"><table><thead><tr><th>订单</th><th>状态</th><th>送达时间</th><th>送达凭证</th><th>备注</th></tr></thead><tbody>${deliveredRows || `<tr><td colspan="5" class="muted">暂无已送达记录</td></tr>`}</tbody></table></div></section>
    ${legacyRows ? `<section class="panel delivery-section"><h3>旧配送记录</h3><p class="muted">历史发货状态尚未确认送达，仅供查看。</p><div class="table-wrap"><table><thead><tr><th>订单</th><th>状态</th><th>发货时间</th></tr></thead><tbody>${legacyRows}</tbody></table></div></section>` : ""}
  `;
}

async function startDriverDeliveryTrip(orderIds) {
  const selected = [...new Set(orderIds.map(String).filter(Boolean))];
  if (!selected.length) return toast("请至少选择一个待配送订单");
  try {
    await api("/api/delivery-trips/start", { method: "POST", body: JSON.stringify({ orderIds: selected }) });
    toast(`已开始配送 ${selected.length} 个订单`);
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

async function completeDriverDelivery(orderId, files, note) {
  const selected = Array.from(files || []);
  if (selected.length < 1 || selected.length > 3) return toast("请上传 1 至 3 张送达照片");
  try {
    const photos = [];
    for (const file of selected) photos.push({ name: file.name || "送达照片.jpg", dataUrl: await fileToDataUrl(file) });
    await api("/api/deliveries/complete", { method: "POST", body: JSON.stringify({ orderId, photos, note: String(note || "").trim() }) });
    toast("送达信息已提交");
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

function adminNavigation(permissions, pureDriver) {
  if (pureDriver) return [["deliveries", "配送任务"]];
  const views = [
    ["dashboard", "生产总览"],
    ["customers", "客户资料"],
    ["dispatch", "派工路线"],
    ["exceptions", "质检详情"],
  ];
  if (permissions?.manageDeliveries) views.push(["deliveries", "配送管理"]);
  if (permissions?.manageCustomerFeedback) views.push(["customerFeedback", "客户反馈"]);
  views.push(["history", "历史查询"], ["reports", "基础报表"]);
  if (permissions?.viewAuditLogs) views.push(["auditLogs", "操作日志"]);
  views.push(["settings", "基础设置"]);
  return views;
}

function adminShell() {
  const data = state.data;
  const pureDriver = userRoles(state.user).length === 1 && userRoles(state.user)[0] === "driver";
  const views = adminNavigation(data.permissions, pureDriver);
  const pages = {
    dashboard: () => dashboard(data),
    charts: () => chartCenterPage(data),
    customers: () => customersPage(data),
    ordersAll: () => ordersPage(data, "all"),
    ordersFactory: () => ordersPage(data, "factory"),
    ordersPlatform: () => ordersPage(data, "platform"),
    dispatch: () => dispatchPage(data),
    exceptions: () => exceptionsPage(data),
    customerFeedback: () => data.permissions?.manageCustomerFeedback ? customerFeedbackPage(data) : dashboard(data),
    history: () => historyPage(data),
    reports: () => reportsPage(data),
    auditLogs: () => auditLogsPage(data),
    settings: () => settingsPage(data),
    deliveries: () => deliveriesPage(data),
    mobile: () => mobileShell(true),
  };
  const content = (pages[state.view] || pages.dashboard)();
  const ordersNav = ordersNavigation(data, pureDriver);
  return `
    <div class="app-shell">
      <aside class="side">
        <div class="brand">钣金工单云</div>
        <div class="user-chip"><strong>${escapeHtml(roleNames[state.user.role] || state.user.role)}</strong><span>${escapeHtml(state.user.name)}</span></div>
        <nav class="nav">${views.map(([key, name], index) => `${!pureDriver && index === 2 ? ordersNav : ""}<button class="${state.view === key ? "active" : ""}" data-view="${key}">${name}</button>`).join("")}${!pureDriver && views.length < 3 ? ordersNav : ""}<button data-action="logout">退出登录</button></nav>
      </aside>
      <main class="main">${content}</main>
    </div>
  `;
}

function auditLogsPage(data) {
  const result = state.auditData;
  return `<div class="topbar"><h2>操作日志</h2><button class="btn" data-action="searchAuditLogs">查询</button></div>
    <section class="panel">
      <div class="form-grid audit-filters">
        <label class="field"><span>开始日期</span><input id="auditStartDate" type="date"></label>
        <label class="field"><span>结束日期</span><input id="auditEndDate" type="date"></label>
        <label class="field"><span>操作者</span><select id="auditActorId"><option value="">全部</option>${data.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("")}</select></label>
        <label class="field"><span>动作</span><input id="auditAction" placeholder="例如 order-update"></label>
        <label class="field"><span>关键词</span><input id="auditKeyword" placeholder="对象、编号、内容"></label>
      </div>
      <div class="table-wrap"><table data-sort-table="auditLogs" data-server-sort="audit"><thead><tr><th data-sort-key="createdAt">时间</th><th data-sort-key="actorName">操作者</th><th data-sort-key="action">动作</th><th data-sort-key="target">对象</th><th data-sort-key="detail">详情</th></tr></thead><tbody>
        ${result.items.map((item) => `<tr><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.actorName)}<br><span class="muted">${escapeHtml(item.actorPhone)}</span></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.targetType)} / ${escapeHtml(item.targetId)}</td><td><pre class="audit-detail">${escapeHtml(JSON.stringify(item.detail, null, 2))}</pre></td></tr>`).join("") || `<tr><td colspan="5" class="muted">点击查询加载日志</td></tr>`}
      </tbody></table></div><p class="muted">共 ${result.total} 条，日志保留3个月（90天）。</p>
    </section>`;
}

function mobileShell(embedded = false) {
  const data = state.data;
  return `
    <div class="mobile-shell">
      <div class="phone">
        <header class="phone-head">
          <div>
            <h1>非标钣金工单</h1>
            <div class="muted" style="color:#d5e9e5">${state.user.name} / ${userRoles(state.user).map((role) => roleNames[role]).join("、")}</div>
          </div>
          <button class="phone-logout" data-action="logout">切换账号</button>
        </header>
        <nav class="phone-tabs">
          <button class="${state.mobileTab === "tasks" ? "active" : ""}" data-mobile="tasks">我的任务</button>
          <button class="${state.mobileTab === "board" ? "active" : ""}" data-mobile="board">看板</button>
          <button class="${state.mobileTab === "exceptions" ? "active" : ""}" data-mobile="exceptions">异常</button>
        </nav>
        <main class="phone-body">${mobileContent(data)}</main>
      </div>
    </div>
  `;
}

function mobileContent(data) {
  if (state.mobileTab === "board") {
    const activeWorkOrders = data.workOrders.filter((item) => item.status !== "已完成");
    return `
      <section class="grid cols-2">
        <div class="card metric"><span>生产中</span><strong>${data.workOrders.filter((w) => w.status !== "已完成").length}</strong></div>
        <div class="card metric"><span>异常</span><strong>${data.exceptions.filter((e) => e.status !== "已解决").length}</strong></div>
      </section>
      ${activeWorkOrders.map((w) => `<div class="card"><div class="task-title"><div><h3>${escapeHtml(w.productName)}</h3><p class="muted">${escapeHtml(w.workNo)} / ${escapeHtml(w.currentProcess || "-")} / 交期 ${escapeHtml(w.order?.dueDate || "")}</p></div>${tag(w.status)}</div>${mobileProcessTrack(w)}<p class="muted">当前工序：${escapeHtml(w.currentProcess || "-")} / ${w.progress}%</p></div>`).join("")}
    `;
  }
  if (state.mobileTab === "exceptions") {
    return data.exceptions.length ? data.exceptions.map((e) => exceptionCard(e, data, ["manager", "quality", "admin", "owner"].includes(state.user.role))).join("") : `<div class="card empty">暂无异常</div>`;
  }
  const tasks = data.routes
    .filter((route) => {
      if (route.status === "已完成") return false;
      if (!userRoles(state.user).some(isShopWorkerRole)) return true;
      if (route.assignedTo) return route.assignedTo === state.user.id;
      return userHasRole(state.user, route.assignedRole || processRoleMap[route.processName]);
    })
    .map((r) => ({ ...r, workOrder: data.workOrders.find((w) => w.id === r.workOrderId) }));
  return tasks.length
    ? tasks.map(taskCard).join("")
    : `<div class="card empty">当前没有待报工任务</div>`;
}

function taskCard(t) {
  const remain = Math.max(0, Number(t.planQty) - Number(t.completedQty || 0));
  const unit = workOrderQuantityUnit(t.workOrder);
  const isQuality = t.processName === "质检";
  const reworkTargets = isQuality
    ? state.data.routes
      .filter((route) => route.workOrderId === t.workOrderId && route.processName !== "质检" && route.routeType !== "rework")
      .sort((a, b) => a.sequence - b.sequence)
    : [];
  const quantityFields = isQuality ? `
        <label class="field"><span>本次送检数量</span><input type="number" min="1" value="${remain || 1}" id="submitted_${t.id}" /></label>
        <label class="field"><span>本次检验数量</span><input type="number" min="1" value="${remain || 1}" id="inspected_${t.id}" /></label>
        <label class="field"><span>合格数量</span><input type="number" min="0" value="${remain || 1}" id="good_${t.id}" /></label>
        <label class="field"><span>不合格数量</span><input type="number" min="0" value="0" id="bad_${t.id}" /></label>
        <label class="field"><span>处理方式</span><select id="disposition_${t.id}"><option>无需处理</option><option>返工</option><option>让步接收</option><option>报废</option></select></label>
        <label class="field"><span>返工工序（选择返工时必填）</span><select id="reworkTarget_${t.id}"><option value="">请选择</option>${reworkTargets.map((route) => `<option value="${route.id}">${route.sequence}. ${escapeHtml(route.processName)}</option>`).join("")}</select></label>
  ` : `
        <label class="field"><span>完成数量（${unit}）</span><input type="number" min="1" value="${remain || 1}" id="done_${t.id}" /></label>
        <label class="field"><span>返工数量</span><input type="number" min="0" value="0" id="rework_${t.id}" /></label>
  `;
  const reportForm = t.status === "进行中" ? `
      <div class="form-grid" style="margin-top:12px">
        ${quantityFields}
        <label class="field wide"><span>备注</span><textarea id="note_${t.id}" placeholder="现场说明"></textarea></label>
        <label class="field wide"><span>现场图片</span><input type="file" accept="image/*" id="image_${t.id}" /></label>
        <label class="field wide"><span>异常类型</span><input id="exType_${t.id}" placeholder="没有异常可不填" /></label>
        <label class="field wide"><span>异常说明</span><textarea id="exDesc_${t.id}" placeholder="尺寸错误、缺料、设备故障等"></textarea></label>
      </div>
  ` : "";
  const actions = t.status === "待开始"
    ? `<div class="actions"><button class="btn" data-status-route="${t.id}" data-status="进行中">开始</button></div>`
    : t.status === "进行中"
      ? `<div class="actions"><button class="btn secondary" data-status-route="${t.id}" data-status="暂停">暂停</button><button class="btn" data-report="${t.id}">提交报工</button></div>`
      : t.status === "暂停"
        ? `<div class="actions"><button class="btn" data-status-route="${t.id}" data-status="进行中">继续</button></div>`
        : "";
  return `
    <div class="card">
      <div class="task-title">
        <div><h3>${escapeHtml(t.processName)} · ${escapeHtml(t.workOrder?.productName || "")}</h3><p>${orderSourceBadge(t.workOrder)}</p><p class="muted">${escapeHtml(t.workOrder?.workNo || "")} / 剩余 ${remain} ${unit}</p></div>
        ${tag(t.status)}
      </div>
      <div class="progress"><div style="width:${Math.round((t.completedQty / t.planQty) * 100)}%"></div></div>
      ${reportForm}
      ${actions}
    </div>
  `;
}

function filePreviewModal() {
  const file = state.previewFiles[state.previewIndex];
  if (!file) return "";
  const downloadUrl = escapeHtml(file.url || "");
  const rawUrl = file.previewPageUrl || file.previewUrl || file.url || "";
  const name = escapeHtml(file.name || fileNameFromUrl(file.url));
  const ext = String(file.fileType || rawUrl.split("?")[0].split(".").pop() || "").toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);
  const url = escapeHtml(ext === "pdf" ? pdfNativePreviewUrl(rawUrl) : rawUrl);
  const body = file.previewError
    ? `<div class="file-preview-error">${escapeHtml(file.previewError)}</div>`
    : isImage
      ? `<img class="file-preview-image" src="${url}" alt="${name}" />`
      : `<iframe class="file-preview-frame" src="${url}" title="${name}"></iframe>`;
  const singleFile = state.previewFiles.length === 1;
  return `
    <div class="file-preview-modal" data-close-preview="overlay">
      <div class="file-preview-dialog attachment-preview-dialog ${singleFile ? "single-file" : ""}">
        <div class="file-preview-head">
          <div class="attachment-preview-title"><strong>${escapeHtml(state.previewTitle)}</strong><span>${name}</span></div>
          <div class="attachment-preview-head-actions"><a class="download" href="${downloadUrl}" download="${name}">下载</a><button class="file-preview-close" data-close-preview="button" type="button">关闭</button></div>
        </div>
        <div class="attachment-preview-layout">
          ${singleFile ? "" : `<nav class="attachment-file-list">${state.previewFiles.map((item, index) => `<button type="button" class="${index === state.previewIndex ? "active" : ""}" data-preview-index="${index}" title="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.fileType.toUpperCase())}</small></button>`).join("")}</nav>`}
          <div class="file-preview-body">${body}</div>
        </div>
      </div>
    </div>
  `;
}

function pdfNativePreviewUrl(url) {
  const base = String(url || "").split("#")[0];
  return `${base}#page=1&zoom=page-fit&view=Fit&pagemode=none&navpanes=0`;
}

async function selectPreviewFile(index) {
  const file = state.previewFiles[index];
  if (!file) return;
  state.previewIndex = index;
  const isCad = ["dwg", "dxf"].includes(String(file.fileType || "").toLowerCase());
  if (isCad && file.drawingId) {
    try {
      const preview = await api("/api/drawings/preview", {
        method: "POST",
        body: JSON.stringify({ drawingId: file.drawingId }),
      });
      file.previewUrl = preview.previewUrl || "";
      file.previewPageUrl = preview.previewPageUrl || "";
      file.previewError = preview.previewError || "";
    } catch (error) {
      file.previewError = error.message || "CAD 预览生成失败";
    }
  }
  if (isCad && !file.previewUrl && !file.previewError) file.previewError = "CAD 预览生成失败";
  render();
}

function openFilePreviewGroup(groupId) {
  const group = attachmentGroups.get(groupId);
  if (!group?.files.length) return;
  state.previewFiles = group.files;
  state.previewIndex = 0;
  state.previewTitle = group.title;
  selectPreviewFile(0);
}

function closeFilePreview() {
  state.previewFiles = [];
  state.previewIndex = 0;
  state.previewTitle = "";
  render();
}

function render() {
  const root = el("app");
  attachmentGroups.clear();
  attachmentGroupSequence = 0;
  if (!state.user) {
    root.innerHTML = loginPage();
    bindLogin();
    return;
  }
  if (!state.data) {
    root.innerHTML = `<div class="empty">正在加载...</div>`;
    refresh().catch((err) => toast(err.message));
    return;
  }
  if (isShopWorkerRole(state.user.role) && state.view !== "mobile") {
    state.view = "mobile";
  }
  if (userRoles(state.user).length === 1 && userRoles(state.user)[0] === "driver") state.view = "deliveries";
  root.innerHTML = `${state.view === "mobile" ? mobileShell() : adminShell()}${filePreviewModal()}`;
  bindEvents();
  if (state.view !== "mobile") activateSortableTables();
}

function sortReportsByNewest(reports) {
  return [...reports].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function sortableValue(cell) {
  if (!cell) return "";
  const raw = cell.dataset.sortValue ?? cell.textContent.trim();
  if (/^-?\d+(?:\.\d+)?%?$/.test(raw.replaceAll(",", ""))) return Number(raw.replaceAll(",", "").replace("%", ""));
  const timestamp = Date.parse(raw);
  if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw) && !Number.isNaN(timestamp)) return timestamp;
  return raw;
}

function compareSortableValues(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true, sensitivity: "base" });
}

function applyTableSort(table, columnIndex, direction) {
  const body = table.tBodies[0];
  if (!body) return;
  const rows = [...body.rows];
  rows.sort((left, right) => compareSortableValues(sortableValue(left.cells[columnIndex]), sortableValue(right.cells[columnIndex])) * (direction === "asc" ? 1 : -1));
  rows.forEach((row) => body.appendChild(row));
  [...table.tHead.rows[0].cells].forEach((header, index) => {
    const indicator = header.querySelector(".sort-indicator");
    if (!indicator) return;
    indicator.textContent = index === columnIndex ? (direction === "asc" ? "▲" : "▼") : "↕";
    header.setAttribute("aria-sort", index === columnIndex ? (direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function activateSortableTables() {
  const excluded = /^(操作|图纸|图片|问题图片|异常|异常记录|处理)$/;
  document.querySelectorAll(".main table").forEach((table, tableIndex) => {
    const headerRow = table.tHead?.rows?.[0];
    if (!headerRow || !table.tBodies[0]) return;
    const tableKey = `${state.view}:${table.dataset.sortTable || tableIndex}`;
    [...headerRow.cells].forEach((header, columnIndex) => {
      const label = header.textContent.trim();
      if (!label || excluded.test(label)) return;
      header.classList.add("sortable-header");
      header.tabIndex = 0;
      header.insertAdjacentHTML("beforeend", `<span class="sort-indicator" aria-hidden="true">↕</span>`);
      const sort = () => {
        if (table.dataset.serverSort === "audit") {
          const sortBy = header.dataset.sortKey;
          const direction = state.auditSort.sortBy === sortBy && state.auditSort.sortDir === "asc" ? "desc" : "asc";
          state.auditSort = { sortBy, sortDir: direction };
          loadAuditLogs();
          return;
        }
        const current = state.tableSorts[tableKey];
        const direction = current?.columnIndex === columnIndex && current.direction === "asc" ? "desc" : "asc";
        state.tableSorts[tableKey] = { columnIndex, direction };
        applyTableSort(table, columnIndex, direction);
      };
      header.onclick = sort;
      header.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sort(); } };
    });
    if (table.dataset.serverSort === "audit") {
      const serverColumn = [...headerRow.cells].findIndex((header) => header.dataset.sortKey === state.auditSort.sortBy);
      if (serverColumn >= 0) {
        const indicator = headerRow.cells[serverColumn].querySelector(".sort-indicator");
        if (indicator) indicator.textContent = state.auditSort.sortDir === "asc" ? "▲" : "▼";
      }
      return;
    }
    const saved = state.tableSorts[tableKey];
    const defaultColumn = Number(table.dataset.defaultSortColumn);
    if (saved) applyTableSort(table, saved.columnIndex, saved.direction);
    else if (Number.isInteger(defaultColumn)) applyTableSort(table, defaultColumn, table.dataset.defaultSortDirection || "asc");
  });
}

function bindLogin() {
  el("loginBtn").onclick = async () => {
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify({ phone: el("phone").value, password: el("password").value }) });
      state.user = data.user;
      localStorage.setItem("work_user", JSON.stringify(state.user));
      const pureDriver = userRoles(state.user).length === 1 && userRoles(state.user)[0] === "driver";
      state.view = pureDriver ? "deliveries" : isShopWorkerRole(state.user.role) ? "mobile" : "dashboard";
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  };
  ["phone", "password"].forEach((id) => {
    el(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") el("loginBtn").click();
    });
  });
}

function bindEvents() {
  const financialInputPairs = [
    ["quantity", "unitPrice", "totalAmount"],
    ["editQuantity", "editUnitPrice", "editTotalAmount"],
  ];
  financialInputPairs.forEach(([quantityId, priceId, totalId]) => {
    [quantityId, priceId].forEach((inputId) => {
      const input = el(inputId);
      if (input) input.oninput = () => updateFinancialTotal(quantityId, priceId, totalId);
    });
  });
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = async () => {
      if (state.view !== btn.dataset.view && !allowScheduleLeave()) return;
      state.view = btn.dataset.view;
      if (state.view === "auditLogs") await loadAuditLogs();
      render();
    };
  });
  document.querySelectorAll("[data-mobile]").forEach((btn) => {
    btn.onclick = () => {
      state.mobileTab = btn.dataset.mobile;
      render();
    };
  });
  ["reportsFrom", "reportsTo"].forEach((id) => {
    const input = el(id);
    if (!input) return;
    input.onchange = () => {
      const from = el("reportsFrom").value;
      const to = el("reportsTo").value;
      if (!from || !to || from > to) {
        toast("开始日期不能晚于结束日期");
        render();
        return;
      }
      state.reportsFrom = from;
      state.reportsTo = to;
      render();
    };
  });
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.onclick = () => handleAction(btn.dataset.action);
  });
  const qualityInspectionWorkOrder = el("qualityInspectionWorkOrder");
  if (qualityInspectionWorkOrder) {
    qualityInspectionWorkOrder.onchange = () => {
      state.qualityInspection.workOrderId = qualityInspectionWorkOrder.value;
      render();
    };
  }
  document.querySelectorAll("[data-toggle-dispatch-collapse]").forEach((btn) => {
    btn.onclick = () => toggleDispatchCollapse(btn.dataset.toggleDispatchCollapse);
  });
  document.querySelectorAll("[data-toggle-employee-role]").forEach((btn) => {
    btn.onclick = () => toggleEmployeeRoleCollapse(btn.dataset.toggleEmployeeRole);
  });
  document.querySelectorAll(".assignSelect").forEach((select) => {
    select.onchange = async () => {
      await api("/api/assign", { method: "POST", body: JSON.stringify({ routeId: select.dataset.route, userId: select.value }) });
      toast("派工已更新");
      await refresh();
    };
  });
  document.querySelectorAll(".planDateInput").forEach((input) => {
    input.oninput = () => editScheduleDraft(input);
    input.onchange = () => editScheduleDraft(input);
  });
  for (const workOrderId of state.schedulePublishing) {
    const card = document.querySelector('[data-dispatch-work="' + workOrderId + '"]');
    card?.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  }
  document.querySelectorAll("[data-add-route]").forEach((btn) => {
    btn.onclick = () => addRoute(btn.dataset.addRoute);
  });
  bindRolePickers();
  document.querySelectorAll("[data-process-status]").forEach((input) => {
    input.onchange = async () => {
      input.disabled = true;
      try {
        await api("/api/processes/update-status", {
          method: "POST",
          body: JSON.stringify({ processId: input.dataset.processStatus, active: input.checked }),
        });
        toast(input.checked ? "工序已启用" : "工序已停用");
        await refresh();
      } catch (err) {
        input.checked = !input.checked;
        input.disabled = false;
        toast(err.message);
      }
    };
  });
  document.querySelectorAll("[data-delete-route]").forEach((btn) => {
    btn.onclick = () => deleteRoute(btn.dataset.deleteRoute);
  });
  document.querySelectorAll("[data-delete-work-order]").forEach((btn) => {
    btn.onclick = () => deleteWorkOrder(btn.dataset.deleteWorkOrder);
  });
  document.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.onclick = () => {
      state.editingOrderId = btn.dataset.editOrder;
      state.editRemovedDrawingIds = [];
      render();
    };
  });
  document.querySelectorAll("[data-confirm-platform-order]").forEach((btn) => {
    btn.onclick = () => { state.confirmingPlatformOrderId = btn.dataset.confirmPlatformOrder; render(); };
  });
  const deliveryRegion = el("deliveryRegion");
  const applyDeliveryFilter = () => {
    state.deliveryRegion = deliveryRegion?.value.trim() || "";
    render();
  };
  document.querySelectorAll("[data-filter-deliveries]").forEach((btn) => { btn.onclick = applyDeliveryFilter; });
  if (deliveryRegion) deliveryRegion.onkeydown = (event) => { if (event.key === "Enter") applyDeliveryFilter(); };
  document.querySelectorAll("[data-start-delivery-trip]").forEach((btn) => {
    btn.onclick = () => startDriverDeliveryTrip([...document.querySelectorAll("[data-delivery-select]:checked")].map((input) => input.dataset.deliverySelect));
  });
  document.querySelectorAll("[data-complete-delivery]").forEach((btn) => {
    btn.onclick = () => completeDriverDelivery(btn.dataset.completeDelivery, el(`deliveryPhotos_${btn.dataset.completeDelivery}`)?.files, el(`deliveryNote_${btn.dataset.completeDelivery}`)?.value || "");
  });
  document.querySelectorAll("[data-release-delivery]").forEach((btn) => {
    btn.onclick = async () => {
      const pureDriver = userRoles(state.user).length === 1 && userRoles(state.user)[0] === "driver";
      const reason = pureDriver ? "" : window.prompt("退回原因（管理者纠正已送达状态时必填）", "");
      if (reason === null) return;
      try {
        await api("/api/deliveries/release", { method: "POST", body: JSON.stringify({ orderId: btn.dataset.releaseDelivery, reason: reason.trim() }) });
        toast("配送状态已退回");
        await refresh();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  document.querySelectorAll("[data-dashboard-source]").forEach((btn) => {
    btn.onclick = () => { state.dashboardSource = btn.dataset.dashboardSource; state.dashboardInsight = null; state.dashboardInsightOrder = null; state.dashboardTrendDetail = null; render(); };
  });
  const dashboardProcess = el("dashboardProcess");
  if (dashboardProcess) dashboardProcess.onchange = () => { state.dashboardProcess = dashboardProcess.value; state.dashboardInsight = null; render(); };
  document.querySelectorAll("[data-insight-days]").forEach((btn) => {
    btn.onclick = () => { state.dashboardInsightDays = Number(btn.dataset.insightDays); state.dashboardInsight = null; state.dashboardInsightOrder = null; state.dashboardTrendDetail = null; render(); };
  });
  document.querySelectorAll("[data-insight-kind]").forEach((btn) => {
    btn.onclick = () => {
      state.dashboardInsight = { kind: btn.dataset.insightKind, processName: btn.dataset.insightProcess, segment: btn.dataset.insightSegment };
      state.dashboardInsightOrder = null;
      state.dashboardInsightLoading = false;
      state.dashboardInsightError = "";
      state.dashboardInsightRequest += 1;
      render();
    };
  });
  document.querySelectorAll("[data-dashboard-insight-order]").forEach((btn) => {
    btn.onclick = async () => {
      const requestId = ++state.dashboardInsightRequest;
      state.dashboardInsightOrder = null;
      state.dashboardInsightLoading = true;
      state.dashboardInsightError = "";
      render();
      try {
        const result = await api(`/api/history/work-orders?workOrderId=${encodeURIComponent(btn.dataset.dashboardInsightOrder)}`);
        if (requestId !== state.dashboardInsightRequest) return;
        state.dashboardInsightOrder = result.items?.[0] || null;
        if (!state.dashboardInsightOrder) state.dashboardInsightError = "未找到该工单记录";
      } catch (error) {
        if (requestId !== state.dashboardInsightRequest) return;
        state.dashboardInsightError = error.message || "订单详情加载失败";
      } finally {
        if (requestId !== state.dashboardInsightRequest) return;
        state.dashboardInsightLoading = false;
        render();
      }
    };
  });
  document.querySelectorAll("[data-trend-point]").forEach((point) => {
    const openDetail = () => {
      state.dashboardTrendDetail = { type: point.dataset.trendPoint, date: point.dataset.trendDate };
      render();
    };
    point.onclick = openDetail;
    point.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    };
  });
  const orderSourceChannel = el("orderSourceChannel");
  if (orderSourceChannel) orderSourceChannel.onchange = () => { state.orderSourceChannel = orderSourceChannel.value; render(); };
  document.querySelectorAll("[data-history-order]").forEach((btn) => {
    btn.onclick = () => {
      state.historyOrderId = btn.dataset.historyOrder;
      state.repeatOrderMode = false;
      state.repeatOrderConfirmOpen = false;
      render();
    };
  });
  document.querySelectorAll("[data-remove-edit-drawing]").forEach((input) => {
    input.onchange = () => {
      state.editRemovedDrawingIds = [...document.querySelectorAll("[data-remove-edit-drawing]:checked")].map((item) => item.dataset.removeEditDrawing);
    };
  });
  document.querySelectorAll("[data-delete-customer]").forEach((btn) => {
    btn.onclick = () => deleteCustomer(btn.dataset.deleteCustomer);
  });
  document.querySelectorAll("[data-print-qr-sheet]").forEach((btn) => {
    btn.onclick = () => window.open(`/qr-print.html?v=20260906-customer-title&workOrderId=${encodeURIComponent(btn.dataset.printQrSheet)}`, "_blank");
  });
  document.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.onclick = () => deleteUser(btn.dataset.deleteUser);
  });
  document.querySelectorAll("[data-report]").forEach((btn) => {
    btn.onclick = () => submitReport(btn.dataset.report);
  });
  document.querySelectorAll("[data-status-route]").forEach((btn) => {
    btn.onclick = () => updateRouteStatus(btn.dataset.statusRoute, btn.dataset.status);
  });
  document.querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.onclick = () => resolveException(btn.dataset.resolve);
  });
  document.querySelectorAll("[data-history-detail]").forEach((btn) => {
    btn.onclick = () => { state.historyDetailId = btn.dataset.historyDetail; render(); };
  });
  document.querySelectorAll("[data-fulfillment-toggle]").forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      state.openFulfillmentOrderId = state.openFulfillmentOrderId === btn.dataset.fulfillmentToggle ? "" : btn.dataset.fulfillmentToggle;
      render();
    };
  });
  document.querySelectorAll(".fulfillment-popover").forEach((menu) => { menu.onclick = (event) => event.stopPropagation(); });
  document.querySelectorAll("[data-fulfillment]").forEach((input) => {
    input.onchange = async () => {
      const orderId = input.dataset.orderId;
      const controls = [...document.querySelectorAll(`[data-fulfillment][data-order-id="${orderId}"]`)];
      controls.forEach((control) => { control.disabled = true; });
      try {
        const result = await api("/api/orders/fulfillment", { method: "POST", body: JSON.stringify({ orderId, shipped: controls.find((item) => item.dataset.fulfillment === "shipped")?.checked === true, invoiced: controls.find((item) => item.dataset.fulfillment === "invoiced")?.checked === true }) });
        if (result?.platformSync === "pending") toast("BOBO状态已保存，平台同步排队重试中");
        await refresh();
        await searchHistory();
      } catch (error) { toast(error.message); await searchHistory(); }
    };
  });
  document.querySelectorAll("[data-resolve-feedback]").forEach((btn) => {
    btn.onclick = () => resolveCustomerFeedback(btn.dataset.resolveFeedback);
  });
  document.querySelectorAll("[data-preview-group]").forEach((btn) => { btn.onclick = () => openFilePreviewGroup(btn.dataset.previewGroup); });
  document.querySelectorAll("[data-preview-index]").forEach((btn) => { btn.onclick = () => selectPreviewFile(Number(btn.dataset.previewIndex)); });
  document.querySelectorAll("[data-close-preview]").forEach((node) => {
    node.onclick = (event) => {
      if (event.target === node || node.dataset.closePreview === "button") closeFilePreview();
    };
  });
  document.onclick = (event) => {
    if (state.openFulfillmentOrderId && !event.target.closest(".fulfillment-control")) {
      state.openFulfillmentOrderId = "";
      render();
    }
  };
  document.onkeydown = (event) => {
    if (event.key !== "Escape") return;
    if (state.previewFiles.length) return closeFilePreview();
    if (state.dashboardTrendDetail) { state.dashboardTrendDetail = null; return render(); }
    if (state.dashboardInsight) { state.dashboardInsightRequest += 1; state.dashboardInsight = null; state.dashboardInsightOrder = null; state.dashboardInsightLoading = false; state.dashboardInsightError = ""; return render(); }
    if (state.historyDetailId) { state.historyDetailId = ""; return render(); }
    if (state.openFulfillmentOrderId) { state.openFulfillmentOrderId = ""; render(); }
  };
  const drawingFiles = el("drawingFiles");
  if (drawingFiles) {
    drawingFiles.onchange = () => uploadOrderDrawings(drawingFiles.files);
  }
  ["Customer", "Process", "Status", "From", "To"].forEach((name) => {
    const input = el(`exception${name}Filter`);
    if (!input) return;
    input.onchange = () => {
      state.exceptionFilters = {
        customerId: el("exceptionCustomerFilter")?.value || "",
        processName: el("exceptionProcessFilter")?.value || "",
        status: el("exceptionStatusFilter")?.value || "",
        from: el("exceptionFromFilter")?.value || "",
        to: el("exceptionToFilter")?.value || "",
      };
      render();
    };
  });
  const dueDatePicker = el("dueDatePicker");
  if (dueDatePicker) {
    dueDatePicker.onchange = () => {
      el("dueDate").value = slashDateFromIso(dueDatePicker.value);
    };
  }
  const finishedFrom = el("dashboardFinishedFrom");
  const finishedTo = el("dashboardFinishedTo");
  [finishedFrom, finishedTo].filter(Boolean).forEach((input) => { input.onchange = () => { state.dashboardFinishedFrom = finishedFrom.value; state.dashboardFinishedTo = finishedTo.value; render(); }; });
  const feedbackCustomer = el("feedbackCustomerId");
  if (feedbackCustomer) feedbackCustomer.onchange = () => { state.customerFeedback = { customerId: feedbackCustomer.value, workOrderId: "" }; render(); };
  const feedbackWorkOrder = el("feedbackWorkOrderId");
  if (feedbackWorkOrder) feedbackWorkOrder.onchange = () => { state.customerFeedback.workOrderId = feedbackWorkOrder.value; render(); };
  document.querySelectorAll("[data-history-date]").forEach((btn) => {
    btn.onclick = () => {
      const picker = el(btn.dataset.historyDate === "from" ? "historyFromPicker" : "historyToPicker");
      if (picker?.showPicker) picker.showPicker();
      else picker?.click();
    };
  });
  ["From", "To"].forEach((name) => {
    const input = el(`history${name}`);
    const picker = el(`history${name}Picker`);
    const key = name === "From" ? "from" : "to";
    if (picker) {
      picker.onchange = () => {
        state.historyFilters = { ...state.historyFilters, period: "custom", [key]: picker.value };
        render();
      };
    }
    if (input) {
      input.onchange = () => {
        state.historyFilters = { ...state.historyFilters, period: "custom", [key]: normalizeDateInput(input.value) };
        render();
      };
    }
  });
}

async function addRoute(workOrderId) {
  try {
    await api("/api/routes", {
      method: "POST",
      body: JSON.stringify({
        workOrderId,
        processId: el(`newProcess_${workOrderId}`).value,
        assignedTo: "",
        plannedStartDate: "",
        plannedEndDate: "",
      }),
    });
    toast("工序已新增");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteRoute(routeId) {
  try {
    if (!confirm("确定删除这道未报工工序吗？")) return;
    await api("/api/routes/delete", { method: "POST", body: JSON.stringify({ routeId }) });
    toast("工序已删除");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteWorkOrder(workOrderId) {
  try {
    const item = state.data.workOrders.find((w) => w.id === workOrderId);
    const forceDelete = Boolean(state.data.permissions?.forceDeleteWorkOrders);
    const warning = forceDelete
      ? "您拥有最高权限：该操作会删除订单、工单、工艺路线、报工和异常记录，且无法恢复。"
      : "仅允许删除未报工的输错工单。";
    if (!confirm(`确定删除工单：${item?.workNo || ""}？\n${warning}`)) return;
    const result = await api("/api/work-orders/delete", { method: "POST", body: JSON.stringify({ workOrderId }) });
    toast(result.forceDelete ? "工单及关联记录已强制删除" : "工单已删除");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteCustomer(customerId) {
  try {
    const item = state.data.customers.find((c) => c.id === customerId);
    if (!confirm(`确定删除客户：${item?.name || ""}？\n已有订单关联的客户不能删除。`)) return;
    await api("/api/customers/delete", { method: "POST", body: JSON.stringify({ customerId }) });
    toast("客户已删除");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteUser(userId) {
  try {
    const user = state.data.users.find((item) => item.id === userId);
    if (!confirm(`确定删除员工账号：${user?.name || ""}？\n账号会从员工列表移除；未完成派工会变为未派工；历史报工记录仍会保留姓名。`)) return;
    await api("/api/users/delete", { method: "POST", body: JSON.stringify({ userId }) });
    toast("员工账号已删除");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function handleAction(action) {
  if (action === "logout") {
    if (!allowScheduleLeave()) return;
    try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
    localStorage.removeItem("work_user");
    state.user = null;
    state.data = null;
    render();
  }
  if (action === "refresh") {
    await refresh();
    toast("已刷新");
  }
  if (action === "openTv") {
    if (state.dashboardSource === "all") window.open("/tv.html", "_blank");
    else window.open(`/tv.html?source=${encodeURIComponent(state.dashboardSource)}`, "_blank");
  }
  if (action === "openMobileTv") {
    try {
      const data = await api("/api/tv-viewer-token");
      window.open(`/tv.html?mobile=1&source=${encodeURIComponent(state.dashboardSource)}&viewerToken=${encodeURIComponent(data.token)}`, "_blank");
    } catch (err) {
      toast(err.message);
    }
  }
  if (action === "openDispatchBoard") {
    try {
      const data = await api("/api/dispatch-board-token");
      window.open(`/tv.html?mobile=1&dispatch=1&viewerToken=${encodeURIComponent(data.token)}`, "_blank");
    } catch (err) {
      toast(err.message);
    }
  }
  if (action === "closeOrderEdit") {
    state.editingOrderId = "";
    state.editRemovedDrawingIds = [];
    render();
  }
  if (action === "closePlatformConfirm") { state.confirmingPlatformOrderId = ""; render(); }
  if (action === "submitPlatformConfirm") await submitPlatformConfirm();
  if (action === "closeHistoryDetail") { state.historyDetailId = ""; render(); }
  if (action === "closeDashboardTrend") { state.dashboardTrendDetail = null; render(); }
  if (action === "closeDashboardInsight") { state.dashboardInsightRequest += 1; state.dashboardInsight = null; state.dashboardInsightOrder = null; state.dashboardInsightLoading = false; state.dashboardInsightError = ""; render(); }
  if (action === "backDashboardInsight") { state.dashboardInsightRequest += 1; state.dashboardInsightOrder = null; state.dashboardInsightLoading = false; state.dashboardInsightError = ""; render(); }
  if (action === "closeHistoryOrder") { state.historyOrderId = ""; state.repeatOrderMode = false; state.repeatOrderConfirmOpen = false; render(); }
  if (action === "enableRepeatOrder") {
    state.repeatOrderConfirmOpen = true;
    render();
  }
  if (action === "cancelRepeatOrder") { state.repeatOrderConfirmOpen = false; render(); }
  if (action === "confirmRepeatOrder") { state.repeatOrderConfirmOpen = false; state.repeatOrderMode = true; render(); }
  if (action === "saveRepeatOrder") await saveRepeatOrder();
  if (action === "openFinishedHistory") {
    state.view = "history";
    state.historyFilters = { dateType: "completedAt", from: state.dashboardFinishedFrom, to: state.dashboardFinishedTo, customerId: "", status: "", source: "", sourceChannel: "", workNo: "" };
    await searchHistory(true);
  }
  if (action === "saveOrderEdit") await saveOrderEdit();
  if (action === "searchAuditLogs") await loadAuditLogs();
  if (action === "showOrderForm") {
    const form = el("orderForm");
    form.style.display = form.style.display === "none" ? "block" : "none";
  }
  if (action === "openDueDatePicker") {
    const picker = el("dueDatePicker");
    if (picker?.showPicker) picker.showPicker();
    else picker?.click();
  }
  if (action === "createOrder") {
    if (state.creatingOrder) return;
    state.creatingOrder = true;
    const createButton = document.querySelector('[data-action="createOrder"]');
    if (createButton) createButton.disabled = true;
    try {
      const processIds = [...document.querySelectorAll('input[name="process"]:checked')].map((item) => item.value);
      const formError = validateOrderForm(processIds);
      if (formError) {
        toast(formError);
        return;
      }
      await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          orderNo: el("orderNo").value.trim(),
          customerId: el("customerId").value,
          productName: el("productName").value.trim(),
          drawingNo: el("drawingNo").value,
          weightKg: el("weightKg").value.trim(),
          quantity: el("quantity").value,
          quantityUnit: el("quantityUnit").value,
          ...(state.data?.permissions?.viewOrderFinancials ? { unitPrice: el("unitPrice").value } : {}),
          dueDate: normalizeDateInput(el("dueDate").value),
          priority: el("priority").value,
          processIds,
          drawingIds: state.pendingDrawingIds,
          note: el("note").value,
        }),
      });
      state.pendingDrawingIds = [];
      toast("订单和工单已创建");
      await refresh();
    } catch (err) {
      toast(err.message);
    } finally {
      state.creatingOrder = false;
      if (createButton?.isConnected) createButton.disabled = false;
    }
  }
  if (action === "searchHistory") {
    await searchHistory();
  }
  if (action === "submitQualityInspection") {
    await submitQualityInspection();
  }
  if (action === "createCustomerFeedback") await createCustomerFeedback();
  if (action === "createCustomer") {
    await api("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: el("customerName").value,
        contact: el("customerContact").value,
        phone: el("customerPhone").value,
        address: el("customerAddress").value,
        note: el("customerNote").value,
      }),
    });
    toast("客户已新增");
    await refresh();
  }
  if (action === "export") {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "work-order-export.json";
    link.click();
  }
  if (action === "exportReportsCsv") {
    downloadCsv("报工记录.csv", buildReportsCsv(state.data));
  }
  if (action === "exportManagementReport") await downloadManagementReport();
  if (action === "createUser") {
    const selectedRoles = selectedPickerRoles("newUserRoles");
    if (!selectedRoles.length) {
      toast("至少选择一个岗位角色");
      return;
    }
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name: el("newUserName").value,
        phone: el("newUserPhone").value,
        roles: selectedRoles,
        password: el("newUserPassword").value,
      }),
    });
    toast("员工已新增");
    await refresh();
  }
}

async function downloadManagementReport() {
  if (!state.reportsFrom || !state.reportsTo || state.reportsFrom > state.reportsTo) {
    toast("请选择有效的开始和结束日期");
    return;
  }
  try {
    const response = await fetch(`/api/reports/management-export?from=${encodeURIComponent(state.reportsFrom)}&to=${encodeURIComponent(state.reportsTo)}`, {
      headers: { "x-user-id": state.user.id },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "管理分析导出失败");
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `波波工单报工管理分析_${state.reportsFrom}_${state.reportsTo}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    toast(error.message);
  }
}

async function updateRouteStatus(routeId, status) {
  try {
    await api("/api/route-status", { method: "POST", body: JSON.stringify({ routeId, status }) });
    toast(`工序已${status}`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

function buildReportsCsv(data) {
  const rows = [["时间", "人员", "工单", "产品", "单位", "工序", "报工类型", "送检数量", "检验数量", "计入完成", "合格数量", "不合格数量", "返工数量", "处理方式", "计划开始日", "计划结束日", "实际报工日", "计划判定", "超计划原因", "备注"]];
  data.reports.forEach((r) => {
    const reporterName = userNameText(data, r.reporterId);
    const route = data.routes.find((item) => item.id === r.routeId);
    const wo = data.workOrders.find((w) => w.id === r.workOrderId);
    const isQuality = r.reportType === "quality" || route?.processName === "质检";
    rows.push([
      new Date(r.createdAt).toLocaleString(),
      reporterName,
      wo?.workNo || "",
      wo?.productName || "",
      workOrderQuantityUnit(wo),
      route?.processName || "",
      isQuality ? "质检" : "生产报工",
      isQuality ? Number(r.submittedQty || 0) : "",
      isQuality ? Number(r.inspectedQty || 0) : "",
      Number(r.completedQty || 0),
      isQuality ? Number(r.goodQty || 0) : "",
      isQuality ? Number(r.badQty || 0) : "",
      Number(r.reworkQty || 0),
      isQuality ? r.disposition || "" : "",
      r.plannedStartDate || "",
      r.plannedEndDate || "",
      r.reportDate || String(r.createdAt || "").slice(0, 10),
      ["on_time", "early"].includes(r.scheduleStatus) ? "计划内" : r.scheduleStatus === "outside_plan" ? "计划外" : "未排期",
      r.scheduleReason || "",
      r.note || "",
    ]);
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(fileName, csvText) {
  const blob = new Blob(["\ufeff" + csvText], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
}

async function submitReport(routeId) {
  try {
    const isQuality = Boolean(el(`inspected_${routeId}`));
    const images = [];
    const file = el(`image_${routeId}`)?.files?.[0];
    if (file) {
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await api("/api/upload", { method: "POST", body: JSON.stringify({ dataUrl, name: file.name }) });
      images.push(uploaded.url);
    }
    await api("/api/report", {
      method: "POST",
      body: JSON.stringify({
        routeId,
        completedQty: isQuality ? 0 : el(`done_${routeId}`).value,
        submittedQty: isQuality ? el(`submitted_${routeId}`).value : 0,
        inspectedQty: isQuality ? el(`inspected_${routeId}`).value : 0,
        goodQty: isQuality ? el(`good_${routeId}`).value : 0,
        badQty: isQuality ? el(`bad_${routeId}`).value : 0,
        reworkQty: isQuality ? 0 : el(`rework_${routeId}`).value,
        disposition: isQuality ? el(`disposition_${routeId}`).value : "",
        reworkTargetRouteId: isQuality ? el(`reworkTarget_${routeId}`).value : "",
        note: el(`note_${routeId}`).value,
        exceptionType: el(`exType_${routeId}`).value,
        exceptionDescription: el(`exDesc_${routeId}`).value,
        images,
      }),
    });
    toast("报工已提交");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadOrderDrawings(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;
  state.pendingDrawingIds = [];
  try {
    for (const file of selected) {
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await api("/api/drawings/upload", {
        method: "POST",
        body: JSON.stringify({ dataUrl, name: file.name }),
      });
      state.pendingDrawingIds.push(uploaded.id);
    }
    toast(`已上传 ${state.pendingDrawingIds.length} 个图纸附件`);
  } catch (err) {
    state.pendingDrawingIds = [];
    toast(err.message);
  }
}

async function uploadDrawingFiles(files) {
  const drawingIds = [];
  for (const file of Array.from(files || [])) {
    const dataUrl = await fileToDataUrl(file);
    const uploaded = await api("/api/drawings/upload", {
      method: "POST",
      body: JSON.stringify({ dataUrl, name: file.name }),
    });
    drawingIds.push(uploaded.id);
  }
  return drawingIds;
}

async function saveOrderEdit() {
  const orderId = state.editingOrderId;
  if (!orderId) return;
  try {
    const addDrawingIds = await uploadDrawingFiles(el("editDrawingFiles")?.files);
    await api("/api/orders/update", {
      method: "POST",
      body: JSON.stringify({
        orderId,
        orderNo: el("editOrderNo").value.trim(),
        customerId: el("editCustomerId").value,
        productName: el("editProductName").value.trim(),
        drawingNo: el("editDrawingNo").value.trim(),
        quantity: el("editQuantity").value,
        quantityUnit: el("editQuantityUnit").value,
        ...(state.data?.permissions?.viewOrderFinancials ? { unitPrice: el("editUnitPrice").value } : {}),
        weightKg: el("editWeightKg").value.trim(),
        dueDate: el("editDueDate").value,
        priority: el("editPriority").value,
        note: el("editNote").value,
        addDrawingIds,
        removeDrawingIds: state.editRemovedDrawingIds,
      }),
    });
    state.editingOrderId = "";
    state.editRemovedDrawingIds = [];
    toast("订单已更新");
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

async function submitPlatformConfirm() {
  const orderId = state.confirmingPlatformOrderId;
  const processIds = [...document.querySelectorAll('input[name="confirmProcess"]:checked')].map((input) => input.value);
  if (!processIds.length) return toast("至少选择一道工序");
  if (!el("confirmProductName").value.trim()) return toast("请填写产品名称");
  try {
    const drawingIds = await uploadDrawingFiles(el("confirmDrawingFiles")?.files);
    await api("/api/platform-orders/confirm", { method: "POST", body: JSON.stringify({
      orderId,
      processIds,
      productName: el("confirmProductName").value.trim(),
      drawingNo: el("confirmDrawingNo").value.trim(),
      quantity: Number(el("confirmQuantity").value),
      quantityUnit: el("confirmQuantityUnit").value,
      weightKg: el("confirmWeightKg").value.trim(),
      drawingIds,
      dueDate: el("confirmDueDate").value,
      priority: el("confirmPriority").value,
      region: el("confirmRegion").value.trim(),
      deliveryAddress: el("confirmDeliveryAddress").value.trim(),
      note: el("confirmNote").value.trim(),
    }) });
    state.confirmingPlatformOrderId = "";
    toast("平台工单已正式创建");
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

async function saveRepeatOrder() {
  const source = state.historyResults.workOrders.find((item) => item.id === state.historyOrderId);
  if (!source || !state.repeatOrderMode) return;
  const orderNo = el("repeatOrderNo").value.trim();
  if (!orderNo) return toast("新订单号必填");
  if (orderNo === source.orderNo) return toast("新订单号不能与原订单号相同");
  try {
    await api("/api/orders/repeat", {
      method: "POST",
      body: JSON.stringify({
        sourceWorkOrderId: source.id,
        orderNo,
        quantity: el("repeatQuantity").value,
        dueDate: el("repeatDueDate").value,
        priority: el("repeatPriority").value,
        weightKg: el("repeatWeightKg").value.trim(),
        note: el("repeatNote").value,
      }),
    });
    state.historyOrderId = "";
    state.repeatOrderMode = false;
    state.repeatOrderConfirmOpen = false;
    toast("返单订单和工单已创建");
    await refresh();
    await searchHistory(true);
  } catch (error) {
    toast(error.message);
  }
}

async function loadAuditLogs() {
  try {
    const params = new URLSearchParams({ page: "1", pageSize: "50", sortBy: state.auditSort.sortBy, sortDir: state.auditSort.sortDir });
    const fields = {
      startDate: el("auditStartDate")?.value,
      endDate: el("auditEndDate")?.value,
      actorId: el("auditActorId")?.value,
      action: el("auditAction")?.value,
      keyword: el("auditKeyword")?.value,
    };
    Object.entries(fields).forEach(([key, value]) => { if (value) params.set(key, value); });
    state.auditData = await api(`/api/audit-logs?${params.toString()}`);
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function uploadImageFiles(files) {
  const urls = [];
  for (const file of Array.from(files || [])) {
    const dataUrl = await fileToDataUrl(file);
    const uploaded = await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({ dataUrl, name: file.name }),
    });
    urls.push(uploaded.url);
  }
  return urls;
}

async function submitQualityInspection() {
  try {
    const candidate = qualityInspectionCandidates(state.data).find((item) => item.workOrder.id === (el("qualityInspectionWorkOrder")?.value || ""));
    if (!candidate) {
      toast("请选择可质检工单");
      return;
    }
    const submittedQty = Number(el("qualityInspectionSubmittedQty")?.value || 0);
    const inspectedQty = Number(el("qualityInspectionInspectedQty")?.value || 0);
    const goodQty = Number(el("qualityInspectionGoodQty")?.value || 0);
    const badQty = Number(el("qualityInspectionBadQty")?.value || 0);
    const disposition = el("qualityInspectionDisposition")?.value || "无需处理";
    const issueRouteId = el("qualityInspectionIssueRoute")?.value || "";
    const reworkTargetRouteId = el("qualityInspectionReworkRoute")?.value || "";
    const description = el("qualityInspectionDescription")?.value.trim() || "";
    if (submittedQty < 1 || inspectedQty !== submittedQty || goodQty < 0 || badQty < 0 || goodQty + badQty !== inspectedQty) {
      toast("请检查送检、检验、合格与不合格数量");
      return;
    }
    if (submittedQty > Number(candidate.qualityRoute.inspectionAvailableQty || 0)) {
      toast(`本次最多可送检 ${candidate.qualityRoute.inspectionAvailableQty} ${workOrderQuantityUnit(candidate.workOrder)}`);
      return;
    }
    if (badQty > 0 && (!issueRouteId || !description || disposition === "无需处理")) {
      toast("不合格时请选择问题工序、处置方式并填写问题说明");
      return;
    }
    if (disposition === "返工" && !reworkTargetRouteId) {
      toast("请选择返工工序");
      return;
    }
    const images = await uploadImageFiles(el("qualityInspectionImages")?.files);
    await api("/api/report", {
      method: "POST",
      body: JSON.stringify({
        routeId: candidate.qualityRoute.id,
        autoStartQuality: true,
        completedQty: 0,
        submittedQty,
        inspectedQty,
        goodQty,
        badQty,
        disposition,
        issueRouteId,
        reworkTargetRouteId,
        exceptionDescription: description,
        images,
      }),
    });
    state.qualityInspection.workOrderId = "";
    toast("质检结果已提交");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function searchHistory(useState = false) {
  try {
    if (!useState) state.historyFilters = {
      dateType: el("historyDateType")?.value || "createdAt",
      from: normalizeDateInput(el("historyFrom")?.value || "") || el("historyFromPicker")?.value || "",
      to: normalizeDateInput(el("historyTo")?.value || "") || el("historyToPicker")?.value || "",
      customerId: el("historyCustomer")?.value || "",
      status: el("historyStatus")?.value || "",
      source: el("historySource")?.value || "",
      sourceChannel: el("historySourceChannel")?.value || "",
      workNo: el("historyWorkNo")?.value.trim() || "",
    };
    const query = Object.entries({
      from: state.historyFilters.from,
      to: state.historyFilters.to,
      customerId: state.historyFilters.customerId,
      dateType: state.historyFilters.dateType,
      status: state.historyFilters.status,
      source: state.historyFilters.source,
      sourceChannel: state.historyFilters.sourceChannel,
      workNo: state.historyFilters.workNo,
    })
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    const workOrders = await api(`/api/history/work-orders${query ? `?${query}` : ""}`);
    state.historyResults = {
      workOrders: workOrders.items || [],
      loaded: true,
    };
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function createCustomerFeedback() {
  try {
    const images = await uploadImageFiles(el("feedbackImages")?.files);
    await api("/api/customer-feedbacks", { method: "POST", body: JSON.stringify({ customerId: el("feedbackCustomerId")?.value || "", workOrderId: el("feedbackWorkOrderId")?.value || "", routeId: el("feedbackRouteId")?.value || "", feedbackAt: el("feedbackAt")?.value || "", description: el("feedbackDescription")?.value.trim() || "", images }) });
    state.customerFeedback = { customerId: "", workOrderId: "" };
    toast("客户反馈已保存");
    await refresh();
  } catch (error) { toast(error.message); }
}

async function resolveCustomerFeedback(id) {
  try {
    await api("/api/customer-feedbacks/resolve", { method: "POST", body: JSON.stringify({ id, solution: el(`feedbackSolution_${id}`)?.value.trim() || "" }) });
    toast("客户反馈已处理");
    await refresh();
  } catch (error) { toast(error.message); }
}

async function resolveException(id) {
  await api("/api/exceptions/resolve", { method: "POST", body: JSON.stringify({ id, solution: el(`solution_${id}`)?.value || "", status: "已解决" }) });
  toast("异常已处理");
  await refresh();
}

render();


document.addEventListener("input", (event) => {
  const input = event.target;
  if (!input.matches?.(".planDateInput")) return;
  if (/^\d{5,}-/.test(input.value)) {
    input.value = input.dataset.validDate || input.defaultValue;
    toast("年份最多输入4位数字");
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(input.value)) input.dataset.validDate = input.value;
});
