const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE = 30 * 1024 * 1024;
const SERVICE_UNAVAILABLE_MESSAGE = "服务暂时不可用，请稍后重试或电话联系";
const NAV_GROUPS = [
  { label: "加工能力", href: "/capabilities.html", items: [
    ["激光切割", "/capabilities.html#laser-cutting"], ["数控折弯", "/capabilities.html#cnc-bending"],
    ["焊接加工", "/capabilities.html#welding"], ["表面处理", "/capabilities.html#finishing"],
    ["装配交付", "/capabilities.html#assembly"], ["无图协作", "/capabilities.html#no-drawing"]
  ] },
  { label: "行业方案", href: "/solutions.html", items: [
    ["自动化设备", "/solutions.html#automation"], ["电气与新能源", "/solutions.html#energy"],
    ["机架机箱", "/solutions.html#cabinet"], ["机械改造与维修件", "/solutions.html#retrofit"]
  ] },
  { label: "项目案例", href: "/cases.html", items: [
    ["电控柜", "/cases.html#control-cabinet"], ["设备罩壳", "/cases.html#machine-cover"],
    ["非标底座", "/cases.html#equipment-base"], ["金属周转箱", "/cases.html#turnover-bin"]
  ] }
].map((group) => ({ ...group, items: group.items.map(([label, href]) => ({ label, href })) }));

function customerError(message) {
  const error = new Error(message);
  error.customerMessage = true;
  return error;
}

function customerErrorMessage(error) {
  return error && error.customerMessage ? error.message : SERVICE_UNAVAILABLE_MESSAGE;
}

async function parseApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) throw customerError(SERVICE_UNAVAILABLE_MESSAGE);
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw customerError(SERVICE_UNAVAILABLE_MESSAGE);
  }
  if (!response.ok) throw customerError(result.message || result.field || "请求失败");
  return result;
}

async function runLockedRequest(form, request) {
  if (form.dataset.requestPending === "true") return undefined;
  const sequence = Number(form.dataset.requestSequence || "0") + 1;
  const button = form.querySelector('button[type="submit"]');
  form.dataset.requestPending = "true";
  form.dataset.requestSequence = String(sequence);
  form.setAttribute("aria-busy", "true");
  if (button) button.disabled = true;
  try {
    return await request(() => form.dataset.requestSequence === String(sequence));
  } finally {
    if (form.dataset.requestSequence === String(sequence)) {
      delete form.dataset.requestPending;
      form.removeAttribute("aria-busy");
      if (button) button.disabled = false;
    }
  }
}

function fileSelectionProblem(files) {
  const selected = Array.from(files || []);
  if (selected.length > MAX_ATTACHMENT_COUNT) return "附件最多3个";
  let totalSize = 0;
  for (const file of selected) {
    if (file.size > MAX_ATTACHMENT_SIZE) return "单个附件不能超过20MB";
    totalSize += file.size;
  }
  return totalSize > MAX_TOTAL_ATTACHMENT_SIZE ? "附件总大小不能超过30MB" : null;
}

function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_SIZE) return reject(customerError(`${file.name} 超过20MB`));
    const reader = new FileReader();
    reader.onerror = () => reject(customerError(`${file.name} 读取失败`));
    reader.onload = () => resolve({ name: file.name, size: file.size, content: String(reader.result).split(",")[1] });
    reader.readAsDataURL(file);
  });
}

function clearElement(element) {
  if (typeof element.replaceChildren === "function") element.replaceChildren();
  else element.textContent = "";
}

function renderOrderResult(container, result) {
  const documentRef = container.ownerDocument || document;
  const card = documentRef.createElement("div");
  const orderNumber = documentRef.createElement("strong");
  const status = documentRef.createElement("p");
  const events = documentRef.createElement("ol");
  card.className = "order-card";
  orderNumber.textContent = result.orderNumber;
  status.textContent = `当前状态：${result.status}`;
  events.className = "order-events";
  for (const item of result.events) {
    const event = documentRef.createElement("li");
    const title = documentRef.createElement("strong");
    const occurredAt = documentRef.createElement("time");
    title.textContent = item.title;
    occurredAt.textContent = new Date(item.occurredAt).toLocaleString("zh-CN");
    event.append(title, occurredAt);
    events.append(event);
  }
  card.append(orderNumber, status, events);
  clearElement(container);
  container.append(card);
}

function renderInquirySuccess(container, inquiryNumber) {
  const documentRef = container.ownerDocument || document;
  const number = documentRef.createElement("strong");
  clearElement(container);
  container.append("提交成功，需求编号：", number, "。请保存编号，客服将在工作时段尽快联系您。");
  number.textContent = inquiryNumber;
}

if (typeof module === "object" && module.exports) {
  module.exports = { NAV_GROUPS, fileSelectionProblem, fileToAttachment, localDate, parseApiResponse, renderOrderResult, runLockedRequest };
}

function enhanceNavigation(documentRef) {
  const nav = documentRef.querySelector('.site-header nav[aria-label="主导航"]');
  if (!nav || nav.dataset.enhanced === "true") return;
  for (const group of NAV_GROUPS) {
    const source = [...nav.querySelectorAll(":scope > a")].find((link) => link.textContent.trim() === group.label);
    if (!source) continue;
    const wrapper = documentRef.createElement("div");
    const button = documentRef.createElement("button");
    const menu = documentRef.createElement("div");
    wrapper.className = "nav-group";
    button.className = "nav-trigger";
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.textContent = group.label;
    if (source.getAttribute("aria-current") === "page") button.setAttribute("aria-current", "page");
    menu.className = "nav-menu";
    menu.setAttribute("aria-label", `${group.label}子菜单`);
    const overview = documentRef.createElement("a");
    overview.href = group.href;
    overview.textContent = `${group.label}总览`;
    menu.append(overview);
    for (const item of group.items) {
      const link = documentRef.createElement("a");
      link.href = item.href;
      link.textContent = item.label;
      menu.append(link);
    }
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      for (const other of nav.querySelectorAll('.nav-trigger[aria-expanded="true"]')) other.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-expanded", String(!open));
    });
    wrapper.append(button, menu);
    source.replaceWith(wrapper);
  }
  documentRef.addEventListener("click", (event) => {
    if (nav.contains(event.target)) return;
    for (const button of nav.querySelectorAll('.nav-trigger[aria-expanded="true"]')) button.setAttribute("aria-expanded", "false");
  });
  documentRef.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const button of nav.querySelectorAll('.nav-trigger[aria-expanded="true"]')) {
      button.setAttribute("aria-expanded", "false");
      button.focus();
    }
  });
  nav.dataset.enhanced = "true";
}

const inquiryForm = typeof document === "undefined" ? null : document.getElementById("inquiry-form");
const inquiryResult = typeof document === "undefined" ? null : document.getElementById("inquiry-result");
const orderForm = typeof document === "undefined" ? null : document.getElementById("order-lookup-form");
const orderResult = typeof document === "undefined" ? null : document.getElementById("order-result");

if (typeof document !== "undefined" && typeof document.querySelector === "function") enhanceNavigation(document);

if (inquiryForm && inquiryResult) {
  inquiryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runLockedRequest(inquiryForm, async (isCurrent) => {
      inquiryResult.className = "form-result";
      inquiryResult.textContent = "正在提交…";
      try {
        if (!inquiryForm.reportValidity()) throw customerError("请完整填写必填信息");
        const files = [...inquiryForm.elements.attachments.files];
        const attachmentProblem = fileSelectionProblem(files);
        if (attachmentProblem) throw customerError(attachmentProblem);
        const attachments = await Promise.all(files.map(fileToAttachment));
        const data = new FormData(inquiryForm);
        const payload = {
          drawingMode: data.get("drawingMode"), contactName: data.get("contactName"), phone: data.get("phone"), region: data.get("region"),
          quantity: Number(data.get("quantity")), expectedDate: data.get("expectedDate"), material: data.get("material"), dimensions: data.get("dimensions"),
          description: data.get("description"), attachments
        };
        const result = await parseApiResponse(await fetch(inquiryForm.action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
        if (!isCurrent()) return;
        renderInquirySuccess(inquiryResult, result.inquiryNumber);
        inquiryForm.reset();
      } catch (error) {
        if (!isCurrent()) return;
        inquiryResult.className = "form-result error";
        inquiryResult.textContent = customerErrorMessage(error);
      }
    });
  });
  inquiryForm.elements.expectedDate.min = localDate();
}

if (orderForm && orderResult) {
  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runLockedRequest(orderForm, async (isCurrent) => {
      orderResult.textContent = "正在查询…";
      try {
        const data = new FormData(orderForm);
        const params = new URLSearchParams({ orderNumber: data.get("orderNumber"), phone: data.get("phone") });
        const result = await parseApiResponse(await fetch(`${orderForm.dataset.api}?${params}`));
        if (isCurrent()) renderOrderResult(orderResult, result);
      } catch (error) {
        if (isCurrent()) orderResult.textContent = customerErrorMessage(error);
      }
    });
  });
}
