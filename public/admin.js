const tokenInput = document.getElementById("admin-token");
const list = document.getElementById("inquiry-list");
const summary = document.getElementById("admin-summary");
const orderList = document.getElementById("order-list");
const dialog = document.getElementById("workflow-dialog");
const form = document.getElementById("workflow-form");
const result = document.getElementById("workflow-result");
const eventDialog = document.getElementById("event-dialog");
const eventForm = document.getElementById("event-form");
tokenInput.value = sessionStorage.getItem("adminToken") || "";

function headers() { return { authorization: `Bearer ${tokenInput.value}`, "content-type": "application/json" }; }
async function api(url, options = {}) { const response = await fetch(url, { ...options, headers: headers() }); const body = await response.json(); if (!response.ok) throw new Error(body.message || "操作失败"); return body; }

function element(tagName, text, className = "") {
  const node = document.createElement(tagName);
  node.textContent = text;
  node.className = className;
  return node;
}

function inquiryCard(row) {
  const article = document.createElement("article");
  article.append(
    element("b", row.inquiryNumber),
    element("h3", `${row.contactName} · ${row.region}`),
    element("p", row.description),
    element("p", `数量 ${row.quantity} · 交期 ${row.expectedDate}`),
    element("p", row.claimedAt ? `已由 ${row.claimedBy} 认领` : row.slaStatus === "overdue" ? "响应已超时" : "等待认领")
  );
  const button = element("button", "处理", "button button-small");
  button.dataset.id = String(row.id);
  button.dataset.number = row.inquiryNumber;
  article.append(button);
  return article;
}

function orderCard(order) {
  const article = document.createElement("article");
  article.append(
    element("b", order.orderNumber),
    element("h3", order.contactName),
    element("p", order.phone),
    element("p", `当前状态：${order.status}`),
    element("p", `波波同步：${order.bobo_sync_status || "pending"}`)
  );
  const button = element("button", "更新进度", "button button-small");
  button.dataset.orderId = String(order.id);
  article.append(button);
  if (order.bobo_sync_status !== "synced") {
    const retry = element("button", "重试波波同步", "button button-small button-ghost");
    retry.dataset.boboRetry = String(order.id);
    article.append(retry);
  }
  return article;
}

async function loadInquiries() {
  sessionStorage.setItem("adminToken", tokenInput.value);
  try {
    const rows = await api("/api/admin/inquiries");
    const orders = await api("/api/admin/orders");
    const overdue = rows.filter((row) => row.slaStatus === "overdue" && !row.claimedAt).length;
    summary.replaceChildren(
      element("span", `需求 ${rows.length}`),
      element("span", `待认领 ${rows.filter((row) => !row.claimedAt).length}`),
      element("span", `响应超时 ${overdue}`)
    );
    list.replaceChildren(...(rows.length ? rows.map(inquiryCard) : [element("p", "暂无需求")]));
    orderList.replaceChildren(...(orders.length ? orders.map(orderCard) : [element("p", "暂无订单")]));
  } catch (error) { list.replaceChildren(element("p", error.message, "form-result error")); }
}

document.getElementById("load-admin").addEventListener("click", loadInquiries);
list.addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (!button) return; form.elements.inquiryId.value = button.dataset.id; document.getElementById("workflow-title").textContent = `处理 ${button.dataset.number}`; result.textContent = ""; dialog.showModal(); });
form.querySelector("[data-close]").addEventListener("click", () => dialog.close());
orderList.addEventListener("click", async (event) => { const retry = event.target.closest("[data-bobo-retry]"); if (retry) { try { await api(`/api/admin/orders/${retry.dataset.boboRetry}/bobo-retry`, { method: "POST", body: "{}" }); await loadInquiries(); } catch (error) { summary.replaceChildren(element("span", error.message)); } return; } const button = event.target.closest("[data-order-id]"); if (!button) return; eventForm.elements.orderId.value = button.dataset.orderId; document.getElementById("event-result").textContent = ""; eventDialog.showModal(); });
eventForm.querySelector("[data-event-close]").addEventListener("click", () => eventDialog.close());
eventForm.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(eventForm); try { await api(`/api/admin/orders/${data.get("orderId")}/events`, { method: "POST", body: JSON.stringify({ operator: data.get("operator"), status: data.get("status"), title: data.get("title") }) }); document.getElementById("event-result").textContent = "进度已发布"; await loadInquiries(); } catch (error) { document.getElementById("event-result").textContent = error.message; } });
form.addEventListener("click", async (event) => {
  if (!event.target.value) return;
  const id = form.elements.inquiryId.value; const operator = form.elements.operator.value;
  try {
    if (event.target.value === "claim") await api(`/api/admin/inquiries/${id}/claim`, { method: "POST", body: JSON.stringify({ operator }) });
    if (event.target.value === "quote") await api(`/api/admin/inquiries/${id}/quotes`, { method: "POST", body: JSON.stringify({ operator, amount: Number(form.elements.amount.value), validUntil: form.elements.validUntil.value, confirmed: true }) });
    if (event.target.value === "pay") { const order = await api(`/api/admin/inquiries/${id}/payment-confirmation`, { method: "POST", body: JSON.stringify({ operator }) }); result.textContent = `已建订单 ${order.orderNumber}`; return; }
    result.textContent = "操作成功"; await loadInquiries();
  } catch (error) { result.className = "form-result error"; result.textContent = error.message; }
});
