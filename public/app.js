const state = {
  user: JSON.parse(localStorage.getItem("work_user") || "null"),
  view: "dashboard",
  mobileTab: "tasks",
  data: null,
  previewFiles: [],
  previewIndex: 0,
  previewTitle: "",
  collapsedDispatchWorkOrders: loadDispatchCollapseState(),
  collapsedEmployeeRoles: {},
  pendingDrawingIds: [],
  editingOrderId: "",
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
  historyDetailId: "",
  historyOrderId: "",
  repeatOrderMode: false,
  repeatOrderConfirmOpen: false,
  openFulfillmentOrderId: "",
  customerFeedback: { customerId: "", workOrderId: "" },
  reportsFrom: monthStartDate(),
  reportsTo: isoDate(0),
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
  polish_worker: "打磨师傅",
  weld_worker: "焊接师傅",
  powder_worker: "喷塑师傅",
  assembly_worker: "装配师傅",
  quality: "质检",
  admin: "管理员",
};

const roleOrder = ["owner", "manager", "office", "design_worker", "laser_worker", "bend_worker", "rivet_worker", "tap_worker", "weld_worker", "polish_worker", "powder_worker", "assembly_worker", "quality", "worker", "admin"];
const assignableRoles = ["design_worker", "laser_worker", "bend_worker", "rivet_worker", "tap_worker", "weld_worker", "polish_worker", "powder_worker", "assembly_worker", "quality", "worker"];
const processRoleMap = {
  设计: "design_worker",
  激光: "laser_worker",
  切管: "laser_worker",
  折弯: "bend_worker",
  压铆: "rivet_worker",
  攻丝: "tap_worker",
  焊接: "weld_worker",
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
};

const techProcessNames = ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "打磨", "喷塑", "装配", "质检"];
const processColors = {
  设计: "#4f46e5",
  激光: "#e11d48",
  切管: "#059669",
  折弯: "#2563eb",
  压铆: "#d97706",
  攻丝: "#7c3aed",
  焊接: "#ea580c",
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
  if (!res.ok) throw new Error(data.error || "请求失败");
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
  state.data = await api("/api/bootstrap");
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

function tag(text) {
  return `<span class="tag ${statusClass[text] || ""}">${escapeHtml(text)}</span>`;
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
  const plannedStartDate = String(startValue || "").slice(0, 10);
  const plannedEndDate = String(endValue || "").slice(0, 10);
  return `
    <div class="route-schedule">
      <label><span>计划开始</span><input id="plannedStart_${id}" class="planDateInput" data-route="${id}" type="date" value="${plannedStartDate}" /></label>
      <label><span>计划结束</span><input id="plannedEnd_${id}" class="planDateInput" data-route="${id}" type="date" value="${plannedEndDate}" /></label>
    </div>
  `;
}

function routeScheduleValues(routeId) {
  const plannedStartDate = el(`plannedStart_${routeId}`)?.value || "";
  const plannedEndDate = el(`plannedEnd_${routeId}`)?.value || "";
  return { plannedStartDate, plannedEndDate, targetFinishTime: plannedEndDate ? `${plannedEndDate}T23:00` : "" };
}

function sortedTechProcesses(data) {
  return data.processes
    .filter((p) => techProcessNames.includes(p.name))
    .sort((a, b) => techProcessNames.indexOf(a.name) - techProcessNames.indexOf(b.name))
}

function activeTechProcesses(data) {
  return sortedTechProcesses(data).filter((process) => process.active !== false);
}

function processLoadCards(data) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return sortedTechProcesses(data)
    .map((p) => {
      const matchedRoutes = data.routes.filter((r) => r.processName === p.name || r.processId === p.id);
      const completedToday = matchedRoutes.filter((route) => {
        if (route.status !== "已完成") return false;
        const completedAt = new Date(route.completedAt || route.lastReportedAt || "");
        return !Number.isNaN(completedAt.getTime()) && completedAt >= start && completedAt < end;
      }).length;
      const remaining = matchedRoutes.filter((route) => route.status !== "已完成").length;
      return `<div class="card process-load-card"><strong>${escapeHtml(p.name)}</strong><p class="muted">今日完成 ${completedToday} / 待完成 ${remaining}</p></div>`;
    })
    .join("");
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
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
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
  const overdue = data.workOrders.filter((w) => w.overdue).length;
  const openExceptions = data.exceptions.filter((e) => e.status !== "已解决").length;
  const active = data.workOrders.filter((w) => w.status !== "已完成").length;
  const finished = data.workOrders.filter((w) => w.status === "已完成" && String(w.completedAt || "").slice(0, 10) >= state.dashboardFinishedFrom && String(w.completedAt || "").slice(0, 10) <= state.dashboardFinishedTo).length;
  const dispatchBoardButton = data.permissions?.viewBoardCustomer
    ? '<button class="btn secondary" data-action="openDispatchBoard">派工看板</button>'
    : "";
  return `
    <div class="topbar"><h2>生产总览</h2><div class="actions">${dispatchBoardButton}<button class="btn secondary" data-action="openMobileTv">手机横屏看板</button><button class="btn secondary" data-action="openTv">打开大屏看板</button><button class="btn secondary" data-action="refresh">刷新</button></div></div>
    <section class="grid cols-4">
      <div class="card metric"><span>生产中工单</span><strong>${active}</strong></div>
      <div class="card metric finished-metric"><button type="button" class="metric-link" data-action="openFinishedHistory"><span>已完成工单</span><strong>${finished}</strong></button><div class="metric-date-range"><input id="dashboardFinishedFrom" type="date" value="${state.dashboardFinishedFrom}" aria-label="完成开始日期"><span>至</span><input id="dashboardFinishedTo" type="date" value="${state.dashboardFinishedTo}" aria-label="完成结束日期"></div></div>
      <div class="card metric"><span>延期风险</span><strong>${overdue}</strong></div>
      <div class="card metric"><span>待处理异常</span><strong>${openExceptions}</strong></div>
    </section>
    <section class="panel" style="margin-top:14px">
      <h3>工序负荷</h3>
      <div class="grid cols-3">
        ${processLoadCards(data)}
      </div>
    </section>
    ${workOrderTable(data)}
  `;
}

function visibleWorkOrders(data) {
  return data.workOrders
    .filter((workOrder) => workOrder.status !== "已完成")
    .slice()
    .sort((a, b) => String(a.order?.dueDate || "9999-12-31").localeCompare(String(b.order?.dueDate || "9999-12-31")));
}

function workOrderTable(data, options = {}) {
  const canDelete = Boolean(options.allowDelete) && (canManageRole(state.user?.role) || data.permissions?.forceDeleteWorkOrders);
  const canEdit = Boolean(options.allowEdit) && data.permissions?.editOrders;
  const workOrders = visibleWorkOrders(data);
  return `
    <section class="panel" style="margin-top:14px">
      <h3>生产进度看板</h3>
      <div class="table-wrap">
        <table class="work-order-table">
          <thead><tr><th>工单</th><th>客户/产品/数量</th><th>创建时间</th><th>当前工序</th><th>交期</th><th>状态</th><th>进度</th><th>图纸</th><th>异常</th><th>备注</th>${canDelete || canEdit ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${workOrders
              .map(
                (w) => `
                  <tr>
                    <td>${escapeHtml(w.workNo)}</td>
                    <td>${escapeHtml(w.customer?.name || "")}<br><span class="muted">${escapeHtml(w.productName)}</span><br><span class="muted">${escapeHtml(w.planQty)} ${workOrderQuantityUnit(w)}</span></td>
                    <td>${escapeHtml(formatDateTime(w.order?.createdAt || w.createdAt))}</td>
                    <td>${escapeHtml(w.currentProcess || "-")}</td>
                    <td>${escapeHtml(w.order?.dueDate || "")}${w.overdue ? " " + tag("延期") : ""}</td>
                    <td>${tag(w.status)}</td>
                    <td><div class="progress"><div style="width:${w.progress}%"></div></div><span class="muted">${w.progress}%</span></td>
                    <td>${attachmentGroupButton(workOrderDrawings(data, w), `${w.workNo} ${w.productName}`)}</td>
                    <td>${w.hasException ? tag("异常") : tag("正常")}</td>
                    <td class="note-cell">${escapeHtml(w.order?.note || "-")}</td>
                    ${canDelete || canEdit ? `<td><div class="actions">${canEdit ? `<button class="btn secondary compact" data-edit-order="${w.orderId}">编辑</button>` : ""}${canDelete ? `<button class="btn danger compact" data-delete-work-order="${w.id}">删除</button>` : ""}</div></td>` : ""}
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

function ordersPage(data) {
  return `
    <div class="topbar"><h2>订单与工单</h2><button class="btn" data-action="showOrderForm">新建订单</button></div>
    <section class="panel" id="orderForm" style="display:none;margin-bottom:14px">
      <h3>新建订单</h3>
      <div class="form-grid">
        <label class="field"><span>订单号</span><input id="orderNo" value="${todayCompact()}" /></label>
        <label class="field"><span>客户</span><select id="customerId"><option value="">请选择客户</option>${data.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select></label>
        <label class="field"><span>产品名称</span><input id="productName" value="非标钣金件" /></label>
        <label class="field"><span>激光编号</span><input id="drawingNo" placeholder="请输入激光编号" /></label>
        <label class="field"><span>数量</span><div class="quantity-control"><input id="quantity" type="number" value="10" min="1" step="1" /><select id="quantityUnit"><option value="件" selected>件</option><option value="套">套</option></select></div></label>
        <label class="field"><span>交期</span><div class="date-combo"><input id="dueDate" placeholder="yyyy/mm/dd" inputmode="numeric" /><button class="date-pick-trigger" type="button" data-action="openDueDatePicker">选择</button><input id="dueDatePicker" class="date-hidden-picker" type="date" /></div></label>
        <label class="field"><span>优先级</span><select id="priority"><option>普通</option><option>急单</option></select></label>
        <label class="field"><span>重量（KG）</span><input id="weightKg" type="number" min="0" step="1" placeholder="请输入总重量" /></label>
        <label class="field wide"><span>图纸附件</span><input id="drawingFiles" type="file" accept=".jpg,.jpeg,.png,.pdf,.dwg,.dxf" multiple /><small class="muted">支持图片、PDF、DWG、DXF；图片可直接缩略预览，CAD 先保存原文件。</small></label>
        <div class="field wide"><span>选择工序</span><div class="checks">${activeTechProcesses(data).map((p) => `<label class="check-pill"><input type="checkbox" name="process" value="${p.id}" ${["设计", "激光", "折弯", "焊接", "打磨", "质检"].includes(p.name) ? "checked" : ""}>${p.name}</label>`).join("")}</div></div>
        <label class="field wide"><span>备注</span><textarea id="note" placeholder="特殊要求、包装、交货说明"></textarea></label>
      </div>
      <button class="btn" data-action="createOrder">保存订单并生成工单</button>
    </section>
    ${workOrderTable(data, { allowDelete: true, allowEdit: true })}
    ${orderEditModal(data)}
  `;
}

function orderEditModal(data) {
  const order = data.orders.find((item) => item.id === state.editingOrderId);
  if (!order) return "";
  const drawings = data.drawings.filter((item) => item.orderId === order.id && !item.removedAt);
  return `<div class="dialog-backdrop" data-action="closeOrderEdit"><section class="dialog" onclick="event.stopPropagation()">
    <div class="topbar"><h3>编辑订单</h3><button class="btn secondary compact" data-action="closeOrderEdit">关闭</button></div>
    <div class="form-grid">
      <label class="field"><span>订单号</span><input id="editOrderNo" value="${escapeHtml(order.orderNo)}"></label>
      <label class="field"><span>客户</span><select id="editCustomerId">${data.customers.map((c) => `<option value="${c.id}" ${c.id === order.customerId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
      <label class="field"><span>产品名称</span><input id="editProductName" value="${escapeHtml(order.productName)}"></label>
      <label class="field"><span>激光编号</span><input id="editDrawingNo" value="${escapeHtml(order.drawingNo || "")}"></label>
      <label class="field"><span>数量</span><div class="quantity-control"><input id="editQuantity" type="number" min="1" step="1" value="${escapeHtml(order.quantity)}"><select id="editQuantityUnit"><option value="件" ${quantityUnit(order.quantityUnit) === "件" ? "selected" : ""}>件</option><option value="套" ${quantityUnit(order.quantityUnit) === "套" ? "selected" : ""}>套</option></select></div></label>
      <label class="field"><span>交期</span><input id="editDueDate" type="date" value="${escapeHtml(order.dueDate || "")}"></label>
      <label class="field"><span>优先级</span><select id="editPriority"><option ${order.priority === "普通" ? "selected" : ""}>普通</option><option ${order.priority === "急单" ? "selected" : ""}>急单</option></select></label>
      <label class="field"><span>重量（KG）</span><input id="editWeightKg" type="number" min="0" step="1" value="${escapeHtml(order.weightKg ?? "")}"></label>
      <label class="field wide"><span>备注</span><textarea id="editNote">${escapeHtml(order.note || "")}</textarea></label>
      <div class="field wide"><span class="attachment-field-title">现有附件 ${attachmentGroupButton(drawings, `${order.orderNo} ${order.productName}`)}</span><div class="attachment-list">${drawings.map((drawing) => `<label><input type="checkbox" data-remove-edit-drawing="${drawing.id}" ${state.editRemovedDrawingIds.includes(drawing.id) ? "checked" : ""}> 移除 ${escapeHtml(drawing.name)}</label>`).join("") || `<span class="muted">无</span>`}</div></div>
      <label class="field wide"><span>新增/更换附件</span><input id="editDrawingFiles" type="file" accept=".jpg,.jpeg,.png,.pdf,.dwg,.dxf" multiple></label>
    </div>
    <div class="actions"><button class="btn" data-action="saveOrderEdit">保存修改</button></div>
  </section></div>`;
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
  const workOrders = data.workOrders.filter((item) => item.status !== "已完成");
  return `
    <div class="topbar"><h2>派工与工艺路线</h2><button class="btn secondary" data-action="refresh">刷新</button></div>
    <section class="panel">
      ${workOrders
        .map(
          (w) => {
            const collapsed = isDispatchCollapsed(w.id);
            return `
            <div class="card dispatch-work-card ${collapsed ? "collapsed" : ""}">
              <div class="task-title dispatch-work-head">
                <div><h3>${escapeHtml(w.workNo)} ${escapeHtml(w.productName)}</h3><p class="muted">${escapeHtml(w.customer?.name || "")} / 交期 ${escapeHtml(w.order?.dueDate || "")}</p><p class="muted">创建时间 ${escapeHtml(formatDateTime(w.order?.createdAt || w.createdAt))}</p></div>
                <button class="dispatch-collapse-toggle" data-toggle-dispatch-collapse="${w.id}" title="${collapsed ? "展开工序" : "收起工序"}" aria-label="${collapsed ? "展开工序" : "收起工序"}">${collapsed ? "v" : "^"}</button>
                <div class="actions">${tag(w.status)}<button class="btn secondary compact" data-print-qr-sheet="${w.id}">打印二维码</button></div>
              </div>
              ${collapsed ? "" : `<div class="dispatch-work-body">
                ${w.routes
                .map(
                  (r) => `
                    <div class="route-row">
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
                <div class="add-route-row">
                  <select id="newProcess_${w.id}" data-new-process="${w.id}">${processOptions(data)}</select>
                  <button class="btn" data-add-route="${w.id}">新增工序</button>
                </div>
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
    </section>
    <section class="panel" style="margin-bottom:14px">
      <h3>历史工单</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>工单</th><th>客户/产品/数量</th><th>重量</th><th>创建时间</th><th>交期</th><th>完工时间</th><th>状态</th><th>异常记录</th><th>图纸</th></tr></thead>
          <tbody>
            ${workOrders.length ? workOrders.map((item) => `
              <tr>
                <td><button class="history-order-link" type="button" data-history-order="${item.id}">${escapeHtml(item.workNo)}</button></td>
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
    <div class="topbar"><div><h3>${repeatMode ? "创建返单" : "订单详情"}</h3><p class="muted">原工单：${escapeHtml(item.workNo)} / 原订单：${escapeHtml(item.orderNo)} / 状态：${escapeHtml(item.productionStatus)}${item.completedAt ? ` / 完工：${escapeHtml(formatDateTime(item.completedAt))}` : ""}</p></div><button class="btn secondary compact" data-action="closeHistoryOrder">关闭</button></div>
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
  return `
    <div class="topbar report-topbar"><h2>基础报表</h2><div class="actions report-actions">
      <label class="compact-date-field"><span>开始日期</span><input id="reportsFrom" type="date" value="${state.reportsFrom}" /></label>
      <label class="compact-date-field"><span>结束日期</span><input id="reportsTo" type="date" value="${state.reportsTo}" /></label>
      <button class="btn" data-action="exportManagementReport">导出管理分析</button>
      <button class="btn secondary" data-action="exportReportsCsv">导出报工 CSV</button><button class="btn secondary" data-action="export">导出完整数据</button>
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
            return `<tr><td data-sort-value="${escapeHtml(r.createdAt || "")}">${new Date(r.createdAt).toLocaleString()}</td><td data-sort-value="${escapeHtml(reporterName)}">${escapeHtml(reporterName)}</td><td data-sort-value="${escapeHtml(wo?.workNo || "")}">${escapeHtml(wo?.workNo || "")}</td><td data-sort-value="${escapeHtml(route?.processName || "")}">${escapeHtml(route?.processName || "")}</td><td data-sort-value="${Number(r.completedQty || r.inspectedQty || 0)}">${quantityText}</td><td data-sort-value="${Number(r.badQty || r.reworkQty || 0)}">${resultText}</td><td data-sort-value="${escapeHtml(r.note || "")}">${escapeHtml(r.note || "")}</td></tr>`;
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

function adminShell() {
  const data = state.data;
  const views = [
    ["dashboard", "生产总览"],
    ["customers", "客户资料"],
    ["orders", "订单工单"],
    ["dispatch", "派工路线"],
    ["exceptions", "质检详情"],
    ["history", "历史查询"],
    ["reports", "基础报表"],
    ["settings", "基础设置"],
  ];
  if (data.permissions?.manageCustomerFeedback) views.splice(5, 0, ["customerFeedback", "客户反馈"]);
  if (data.permissions?.viewAuditLogs) views.splice(views.length - 1, 0, ["auditLogs", "操作日志"]);
  const content = {
    dashboard: dashboard(data),
    customers: customersPage(data),
    orders: ordersPage(data),
    dispatch: dispatchPage(data),
    exceptions: exceptionsPage(data),
    customerFeedback: data.permissions?.manageCustomerFeedback ? customerFeedbackPage(data) : dashboard(data),
    history: historyPage(data),
    reports: reportsPage(data),
    auditLogs: auditLogsPage(data),
    settings: settingsPage(data),
    mobile: mobileShell(true),
  }[state.view];
  return `
    <div class="app-shell">
      <aside class="side">
        <div class="brand">钣金工单云</div>
        <div class="user-chip"><strong>${escapeHtml(roleNames[state.user.role] || state.user.role)}</strong><span>${escapeHtml(state.user.name)}</span></div>
        <nav class="nav">${views.map(([key, name]) => `<button class="${state.view === key ? "active" : ""}" data-view="${key}">${name}</button>`).join("")}<button data-action="logout">退出登录</button></nav>
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
      </tbody></table></div><p class="muted">共 ${result.total} 条，日志保留两年。</p>
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
        <div><h3>${escapeHtml(t.processName)} · ${escapeHtml(t.workOrder?.productName || "")}</h3><p class="muted">${escapeHtml(t.workOrder?.workNo || "")} / 剩余 ${remain} ${unit}</p></div>
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
      state.view = isShopWorkerRole(state.user.role) ? "mobile" : "dashboard";
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
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = async () => {
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
      await api("/api/assign", { method: "POST", body: JSON.stringify({ routeId: select.dataset.route, userId: select.value, ...routeScheduleValues(select.dataset.route) }) });
      toast("派工已更新");
      await refresh();
    };
  });
  document.querySelectorAll(".planDateInput").forEach((input) => {
    input.onchange = async () => {
      const assignee = document.querySelector(`.assignSelect[data-route="${input.dataset.route}"]`)?.value || "";
      await api("/api/assign", { method: "POST", body: JSON.stringify({ routeId: input.dataset.route, userId: assignee, ...routeScheduleValues(input.dataset.route) }) });
      toast("计划日期已更新");
      await refresh();
    };
  });
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
        await api("/api/orders/fulfillment", { method: "POST", body: JSON.stringify({ orderId, shipped: controls.find((item) => item.dataset.fulfillment === "shipped")?.checked === true, invoiced: controls.find((item) => item.dataset.fulfillment === "invoiced")?.checked === true }) });
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
    window.open("/tv.html", "_blank");
  }
  if (action === "openMobileTv") {
    try {
      const data = await api("/api/tv-viewer-token");
      window.open(`/tv.html?mobile=1&viewerToken=${encodeURIComponent(data.token)}`, "_blank");
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
  if (action === "closeHistoryDetail") { state.historyDetailId = ""; render(); }
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
    state.historyFilters = { dateType: "completedAt", from: state.dashboardFinishedFrom, to: state.dashboardFinishedTo, customerId: "", status: "" };
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
      r.scheduleStatus === "on_time" ? "计划内" : r.scheduleStatus === "outside_plan" ? "计划外" : "未排期",
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
    };
    const query = Object.entries({
      from: state.historyFilters.from,
      to: state.historyFilters.to,
      customerId: state.historyFilters.customerId,
      dateType: state.historyFilters.dateType,
      status: state.historyFilters.status,
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
