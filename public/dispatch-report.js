let dispatchGesture = null;
let dispatchReportModal = null;
let dispatchIgnoreClickUntil = 0;
let dispatchRefreshDeferred = false;

function dispatchInteractionBlocked() {
  return Boolean(dispatchGesture || dispatchReportModal || document.querySelector(".dispatch-edit-backdrop"));
}

function closeDispatchReport(refresh = true) {
  if (dispatchReportModal?.dataset.busy === "true") return;
  dispatchReportModal?.remove();
  dispatchReportModal = null;
  dispatchRefreshDeferred = false;
  if (refresh) void load();
}

function dispatchDialog(title, content) {
  const modal = document.createElement("div");
  modal.className = "dispatch-report-backdrop";
  modal.innerHTML = `<section class="dispatch-report-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button type="button" data-proxy-close>关闭</button></header>${content}<p class="proxy-error" role="alert"></p></section>`;
  document.body.appendChild(modal);
  dispatchReportModal = modal;
  modal.querySelector("[data-proxy-close]").onclick = () => closeDispatchReport();
  return modal;
}

async function dispatchReportApi(path, body) {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${viewerToken()}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `请求失败（HTTP ${response.status}）`), { status: response.status });
  return result;
}

function confirmDispatchTap(node) {
  const routeId = node.dataset.routeId;
  const order = tvState.data?.activeOrders.find((item) => item.routes.some((route) => route.id === routeId));
  const route = order?.routes.find((item) => item.id === routeId);
  if (!route || route.status === "已完成") return;
  const status = route.status;
  const action = status === "进行中" ? "暂停" : status === "暂停" ? "继续" : "开始";
  const canToggle = ["待开始", "暂停", "进行中"].includes(status);
  const modal = dispatchDialog("工序操作确认", `<p>${esc(order.workNo)} · ${esc(route.processName)}</p><p>当前状态：${esc(status)}</p><div class="proxy-actions"><button type="button" data-proxy-schedule>修改排期</button>${canToggle ? `<button type="button" class="primary" data-proxy-toggle>确认${action}</button>` : ""}</div>`);
  modal.querySelector("[data-proxy-schedule]").onclick = () => {
    modal.remove(); dispatchReportModal = null;
    openDispatchEditDialog("schedule", { routeId, routeName: route.processName, workNo: order.workNo, startDate: route.plannedStartDate || "", endDate: route.plannedEndDate || "" });
  };
  const button = modal.querySelector("[data-proxy-toggle]");
  if (button) button.onclick = async () => {
    if (modal.dataset.busy === "true") return;
    modal.dataset.busy = "true";
    modal.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    try {
      const result = await dispatchReportApi("/api/dispatch-board/route-toggle", { routeId, expectedStatus: status });
      modal.dataset.busy = "false";
      closeDispatchReport(false);
      applyDispatchRoute(result.route);
      showDispatchMessage(result.route.status === "进行中" ? "工序已开始" : "工序已暂停");
      void load();
    } catch (error) {
      modal.querySelector(".proxy-error").textContent = error.message;
      modal.dataset.busy = "false";
      modal.querySelectorAll("button").forEach((item) => { item.disabled = false; });
      if (error.status === 409) {
        button.disabled = true;
        const refreshButton = document.createElement("button");
        refreshButton.type = "button";
        refreshButton.textContent = "关闭并刷新，重新确认";
        refreshButton.onclick = () => closeDispatchReport();
        modal.querySelector(".proxy-error").appendChild(refreshButton);
      }
    }
  };
}

async function openDispatchReport(routeId) {
  const modal = dispatchDialog("管理者代报工", "<p data-proxy-content>正在读取最新工序…</p>");
  try {
    const context = await dispatchReportApi(`/api/dispatch-board/report-context?${new URLSearchParams({ routeId })}`);
    if (dispatchReportModal !== modal) return;
    const route = context.route;
    const quality = route.processName === "质检";
    const remaining = Math.max(0, Number(route.planQty) - Number(route.completedQty || 0));
    const available = Number(route.inspectionAvailableQty || 0);
    const numberField = (label, name, value, readonly = false) => `<label>${label}<input type="number" min="0" step="any" name="${name}" value="${value}" ${readonly ? "readonly" : "required"}></label>`;
    const options = context.issueRoutes.map((item) => `<option value="${esc(item.id)}">${esc(item.sequence)}. ${esc(item.processName)}</option>`).join("");
    const content = modal.querySelector("[data-proxy-content]");
    content.outerHTML = `<form class="proxy-form"><p>${esc(context.workNo)} · ${esc(context.productName)} · ${esc(route.processName)}</p><p>计划 ${esc(route.planQty)} / 已完成 ${esc(route.completedQty || 0)} / 剩余 ${remaining} ${esc(context.quantityUnit)}</p><p class="proxy-attribution">本次报工将记在当前管理者 ${esc(context.managerName)} 名下</p>${quality ? `<p>当前可送检 ${available} ${esc(context.quantityUnit)}</p>${available <= 0 ? '<p class="proxy-error">暂无可送检数量，请等待前序生产或返工完成</p>' : ""}<div class="proxy-fields">${numberField("送检数量", "submittedQty", available)}${numberField("检验数量", "inspectedQty", available, true)}${numberField("合格数量", "goodQty", available)}${numberField("不合格数量", "badQty", 0)}</div><label>处理方式<select name="disposition"><option>无需处理</option><option>返工</option><option>让步接收</option><option>报废</option></select></label><label>问题工序<select name="issueRouteId">${options}</select></label><label>返工目标<select name="reworkTargetRouteId">${options}</select></label><label>问题说明<textarea name="exceptionDescription"></textarea></label>` : `<div class="proxy-fields">${numberField(`本次完成数量（${esc(context.quantityUnit)}）`, "completedQty", remaining)}${numberField("返工数量", "reworkQty", 0)}</div>`}<label>备注<textarea name="note"></textarea></label><label>现场图片<input type="file" name="image" accept="image/*"></label><p data-proxy-summary></p><button type="submit" class="primary" ${quality && available <= 0 ? "disabled" : ""}>确认提交${quality ? "质检结果" : "报工"}</button></form>`;
    const form = modal.querySelector("form");
    const value = (name) => form.elements.namedItem(name)?.value || "";
    const updateSummary = (event) => {
      if (quality && event?.target.name === "submittedQty") {
        form.elements.namedItem("inspectedQty").value = value("submittedQty");
        form.elements.namedItem("goodQty").value = value("submittedQty");
        form.elements.namedItem("badQty").value = 0;
      }
      form.querySelector("[data-proxy-summary]").textContent = quality ? `本次送检 ${value("submittedQty")}，合格 ${value("goodQty")}，不合格 ${value("badQty")} ${context.quantityUnit}` : `本次确认报工 ${value("completedQty")} ${context.quantityUnit}，返工 ${value("reworkQty")}`;
    };
    form.addEventListener("input", updateSummary);
    updateSummary();
    let pendingPayload = null;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (modal.dataset.busy === "true") return;
      const errorNode = modal.querySelector(".dispatch-report-dialog > .proxy-error");
      errorNode.textContent = "";
      if (!form.reportValidity()) return;
      const payload = { routeId, source: sourceView(), expectedCompletedQty: Number(route.completedQty || 0), expectedInspectionAvailableQty: available, note: value("note"), images: [] };
      for (const name of quality ? ["submittedQty", "inspectedQty", "goodQty", "badQty", "disposition", "issueRouteId", "reworkTargetRouteId", "exceptionDescription"] : ["completedQty", "reworkQty"]) payload[name] = value(name);
      modal.dataset.busy = "true";
      modal.querySelectorAll("button, input, select, textarea").forEach((item) => { item.disabled = true; });
      try {
        if (!pendingPayload) {
          const file = form.elements.namedItem("image").files[0];
          if (file) {
            if (file.size > 5 * 1024 * 1024) throw new Error("图片请控制在5MB以内");
            const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); });
            const image = await dispatchReportApi("/api/dispatch-board/report-upload", { dataUrl, name: file.name });
            payload.images = [image.url];
          }
          pendingPayload = { ...payload, submissionId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("") };
        }
        const result = await dispatchReportApi("/api/dispatch-board/report", pendingPayload);
        modal.dataset.busy = "false";
        closeDispatchReport(false);
        applyDispatchDashboard(result.dashboard);
        void load();
        showDispatchMessage("代报工成功");
      } catch (error) {
        if ([400, 413].includes(error.status)) pendingPayload = null;
        errorNode.textContent = pendingPayload ? `${error.message}。再次提交会重试同一笔报工；如需改数，请关闭并重新打开。` : error.message;
        modal.dataset.busy = "false";
        modal.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        if (!pendingPayload) modal.querySelectorAll("input, select, textarea").forEach((item) => { item.disabled = false; });
      }
    };
  } catch (error) {
    if (dispatchReportModal === modal) modal.querySelector(".proxy-error").textContent = error.message;
  }
}

function cancelDispatchGesture() {
  if (!dispatchGesture) return;
  clearTimeout(dispatchGesture.timer);
  dispatchGesture.progress?.remove();
  dispatchGesture = null;
  dispatchIgnoreClickUntil = Date.now() + 800;
  if (dispatchRefreshDeferred && !dispatchInteractionBlocked()) void load();
}

document.addEventListener("pointerdown", (event) => {
  if (!isDispatchBoard()) return;
  if (dispatchGesture) { cancelDispatchGesture(); return; }
  if (event.button !== 0 || !event.isPrimary) return;
  const node = event.target.closest(".route-node[data-route-id]");
  if (!node || dispatchReportModal || document.querySelector(".dispatch-edit-backdrop")) return;
  const gesture = { node, id: event.pointerId, x: event.clientX, y: event.clientY, fired: false, pointerType: event.pointerType };
  dispatchGesture = gesture;
  if (node.dataset.routeStatus === "进行中") {
    const progress = document.createElement("span");
    progress.className = "dispatch-hold-progress";
    progress.textContent = "长按5秒代报工";
    node.appendChild(progress);
    gesture.progress = progress;
    gesture.timer = setTimeout(() => {
      if (dispatchGesture !== gesture) return;
      gesture.fired = true;
      progress.remove();
      void openDispatchReport(node.dataset.routeId);
    }, 5000);
  }
}, true);

document.addEventListener("pointermove", (event) => {
  if (dispatchGesture && event.pointerId === dispatchGesture.id && Math.hypot(event.clientX - dispatchGesture.x, event.clientY - dispatchGesture.y) > 12) cancelDispatchGesture();
}, true);
document.addEventListener("pointerup", (event) => {
  const gesture = dispatchGesture;
  if (!gesture || event.pointerId !== gesture.id) return;
  const shortTap = !gesture.fired && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 12;
  clearTimeout(gesture.timer); gesture.progress?.remove(); dispatchGesture = null;
  dispatchIgnoreClickUntil = Date.now() + 800;
  if (shortTap) confirmDispatchTap(gesture.node);
  else if (dispatchRefreshDeferred && !dispatchInteractionBlocked()) void load();
}, true);
document.addEventListener("pointercancel", cancelDispatchGesture, true);
document.addEventListener("scroll", cancelDispatchGesture, true);
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelDispatchGesture(); });
document.addEventListener("contextmenu", (event) => { if (dispatchGesture) event.preventDefault(); }, true);
for (const name of ["click", "dblclick"]) document.addEventListener(name, (event) => {
  if (Date.now() < dispatchIgnoreClickUntil && event.target.closest(".route-node")) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && dispatchReportModal) closeDispatchReport(); });

window.addEventListener("blur", cancelDispatchGesture);
document.addEventListener("pointerout", (event) => {
  const gesture = dispatchGesture;
  if (!gesture || event.pointerId !== gesture.id) return;
  if (!event.relatedTarget || (gesture.pointerType === "mouse" && !gesture.node.contains(event.relatedTarget))) cancelDispatchGesture();
}, true);
