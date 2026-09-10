const tvRoot = document.getElementById("tv");
const tvState = {
  data: null,
  screenPage: 0,
  processPage: 0,
  processDirection: 1,
  routeOffsets: {},
  routeDirections: {},
  drawingPreview: null,
};
let screenTimer = null;
let processTimer = null;
let routeTimer = null;
let screenTimerKey = "";
let processTimerKey = "";
let routeTimerKey = "";
let pdfJsPromise = null;

function isMobileTv() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mobile") === "1";
}

function isCompactMobileTv() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mobile") === "1" && params.get("compact") === "1";
}

function isDispatchBoard() {
  const params = new URLSearchParams(window.location.search);
  return params.get("dispatch") === "1";
}

function viewerToken() {
  return new URLSearchParams(location.search).get("viewerToken") || "";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusNodeClass(route, order) {
  if (route.status === "已完成") return "done";
  if (route.scheduleOverdue) return "delay";
  if (route.qualityIssueActive) return "quality-issue";
  if (route.status === "异常" || route.status === "返工") return "error";
  if (order.dueLevel === "overdue") return "delay";
  if (Number(route.completedQty || 0) > 0 || route.lastReportTime) return "reported";
  if (route.status === "进行中") return "active";
  return "";
}

function shortDay(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function plannedRange(route) {
  if (!route.plannedStartDate || !route.plannedEndDate) return "未排期";
  const start = route.plannedStartDate.slice(5).replace("-", ".");
  const end = route.plannedEndDate.slice(5).replace("-", ".");
  return `${start}-${end}`;
}

function mobilePlanText(route) {
  return plannedRange(route);
}

function mobilePlanHidden(route) {
  return Boolean(route.mobilePlanHidden);
}

function clockText(value = new Date()) {
  const d = new Date(value);
  const source = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${source.getFullYear()}/${String(source.getMonth() + 1).padStart(2, "0")}/${String(source.getDate()).padStart(2, "0")} ${String(source.getHours()).padStart(2, "0")}:${String(source.getMinutes()).padStart(2, "0")}:${String(source.getSeconds()).padStart(2, "0")}`;
}

function metric(label, value, cls = "") {
  return `<div class="metric ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function orderBadges(order) {
  const badges = [];
  if (order.dueLevel === "overdue") badges.push({ text: "延期", cls: "delay" });
  else if (order.dueLevel === "urgent") badges.push({ text: "加急", cls: "urgent" });
  if (order.isRush) badges.push({ text: "急单", cls: "rush" });
  return badges.length ? badges : [{ text: "执行中", cls: "" }];
}

function dueShort(order) {
  const raw = order.order?.dueDate || "";
  if (!raw) return "--";
  const parts = raw.split("-");
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return raw;
}

function routeCarouselKey(order) {
  return String(order.id || order.workNo || order.orderId || "");
}

function captureMobileRouteScroll() {
  const offsets = {};
  document.querySelectorAll("body.mobile-tv .routes[data-route-key]").forEach((route) => {
    offsets[route.dataset.routeKey] = route.scrollLeft;
  });
  return offsets;
}

function restoreMobileRouteScroll(offsets) {
  document.querySelectorAll("body.mobile-tv .routes[data-route-key]").forEach((route) => {
    const maxScrollLeft = Math.max(0, route.scrollWidth - route.clientWidth);
    const savedScrollLeft = Number(offsets[route.dataset.routeKey] || 0);
    route.scrollLeft = Math.min(maxScrollLeft, Math.max(0, savedScrollLeft));
  });
}

function routeCarouselPosition(order) {
  const key = routeCarouselKey(order);
  const maxOffset = Math.max(0, order.routes.length - 7);
  const offset = Math.min(maxOffset, Math.max(0, Number(tvState.routeOffsets[key] || 0)));
  tvState.routeOffsets[key] = offset;
  if (!tvState.routeDirections[key]) tvState.routeDirections[key] = 1;
  return { key, maxOffset, offset };
}

function orderRow(order, mobileMode = false) {
  const badges = orderBadges(order);
  const routeCarousel = !mobileMode && order.routes.length > 7;
  const carousel = routeCarousel ? routeCarouselPosition(order) : null;
  const routeNodes = order.routes.map((route) => {
    const planText = mobileMode ? mobilePlanText(route) : plannedRange(route);
    const planClass = mobileMode && mobilePlanHidden(route) ? " mobile-plan-hidden" : "";
    const nodeClass = statusNodeClass(route, order);
    const dispatchClickable = isDispatchBoard() && (
      (nodeClass === "" && ["待开始", "暂停"].includes(route.status)) ||
      (nodeClass === "active" && route.status === "进行中")
    );
    return `
      <div class="route-node ${nodeClass} ${route.lastReportScheduleStatus || ""}${dispatchClickable ? " dispatch-clickable" : ""}"${dispatchClickable ? ` data-route-id="${esc(route.id)}" data-route-status="${esc(route.status)}"` : ""}>
        <div class="circle${planClass}">${esc(planText)}</div>
        <div class="route-name">${esc(route.processName)}</div>
        <div class="route-report"><span class="route-time">${route.lastReportTime ? shortDay(route.lastReportTime) : "--"}</span><span class="route-worker">${esc(route.reporterName || "")}</span></div>
      </div>
    `;
  }).join("");
  const drawings = mobileMode && Array.isArray(order.drawings) ? order.drawings : [];
  const drawingSlot = drawings.length
    ? `<button class="order-drawing-button" type="button" data-drawing-order-id="${esc(order.id)}" aria-label="查看${drawings.length}份图纸"><span class="drawing-icon">图</span><span class="drawing-count">${drawings.length > 99 ? "99+" : drawings.length}</span></button>`
    : '<span class="order-drawing-placeholder" aria-hidden="true"></span>';
  return `
    <div class="order-row ${order.dueLevel || ""}">
      <div class="order-badges">${badges.map((badge) => `<div class="badge ${badge.cls}">${badge.text}</div>`).join("")}</div>
      <div class="work-no">${esc(order.workNo)}</div>
      <div class="order-product">
        <div class="order-name">${esc(order.productName)}</div>
        ${order.customer?.name ? `<div class="muted">${esc(order.customer.name)}</div>` : ""}
        ${mobileMode
          ? `<div class="order-meta-row"><div class="order-qty">${order.planQty} ${order.order?.quantityUnit === "套" ? "套" : "件"}</div><div class="order-drawing-slot">${drawingSlot}</div></div>`
          : `<div class="order-qty">${order.planQty} ${order.order?.quantityUnit === "套" ? "套" : "件"}</div>`}
      </div>
      <div class="progress-line"><div class="progress-track"><span style="width:${order.progress}%"></span></div><span class="progress-percent">${order.progress}%</span></div>
      <div class="routes${routeCarousel ? " route-carousel" : ""}" data-route-key="${esc(routeCarouselKey(order))}"${routeCarousel ? ` data-route-max="${carousel.maxOffset}"` : ""}>
        ${routeCarousel ? `<div class="route-track">${routeNodes}</div>` : routeNodes}
      </div>
      <div class="due-cell ${order.dueLevel || "normal"}">交期 ${esc(dueShort(order))}</div>
    </div>
  `;
}

function drawingFileUrl(drawing, download = false) {
  const query = new URLSearchParams({ viewerToken: viewerToken() });
  if (download) query.set("download", "1");
  return `/api/tv-drawings/${encodeURIComponent(drawing.id)}/file?${query}`;
}

function isImageDrawing(drawing) {
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(String(drawing?.fileType || "").toLowerCase());
}

function isCompactPdfPreview(preview) {
  return isCompactMobileTv() && String(preview?.drawings?.[preview.index]?.fileType || "").toLowerCase() === "pdf";
}

function nativePdfPreviewUrl(preview) {
  const drawing = preview?.drawings?.[preview.index];
  const url = String(preview?.previewUrl || "");
  if (String(drawing?.fileType || "").toLowerCase() !== "pdf") return url;
  return `${url.split("#")[0]}#page=1&zoom=page-fit&view=Fit&pagemode=none&navpanes=0`;
}

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/pdfjs/pdf.min.js";
    script.onload = () => {
      if (!window.pdfjsLib) {
        reject(new Error("PDF预览组件加载失败"));
        return;
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("PDF预览组件加载失败，请检查静态资源是否已上传"));
    document.head.appendChild(script);
  }).catch((error) => {
    pdfJsPromise = null;
    throw error;
  });
  return pdfJsPromise;
}

function releaseDrawingPdf(preview) {
  if (!preview) return;
  preview.selectionId = Number(preview.selectionId || 0) + 1;
  preview.pdfRenderId = Number(preview.pdfRenderId || 0) + 1;
  preview.pdfRenderTask?.cancel();
  preview.pdfLoadingTask?.destroy();
  preview.pdfDocument?.destroy();
  preview.pdfRenderTask = null;
  preview.pdfLoadingTask = null;
  preview.pdfDocument = null;
}

async function loadCompactPdfDocument(preview, url) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ url });
  preview.pdfLoadingTask = loadingTask;
  const document = await loadingTask.promise;
  if (tvState.drawingPreview !== preview || !isCompactPdfPreview(preview)) {
    document.destroy();
    return;
  }
  preview.pdfLoadingTask = null;
  preview.pdfDocument = document;
  preview.pdfPage = 1;
  preview.pdfPages = document.numPages;
}

async function renderCompactPdfPage(preview) {
  const canvas = document.querySelector(".compact-pdf-canvas");
  if (!canvas || !preview.pdfDocument || tvState.drawingPreview !== preview) return;
  const renderId = Number(preview.pdfRenderId || 0) + 1;
  preview.pdfRenderId = renderId;
  preview.pdfRenderTask?.cancel();
  try {
    const page = await preview.pdfDocument.getPage(preview.pdfPage);
    if (preview.pdfRenderId !== renderId || tvState.drawingPreview !== preview) return;
    const stage = canvas.parentElement;
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.min(
      Math.max(0.1, (stage.clientWidth - 20) / baseViewport.width),
      Math.max(0.1, (stage.clientHeight - 20) / baseViewport.height)
    );
    const viewport = page.getViewport({ scale: fitScale * preview.zoom });
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const task = page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
    preview.pdfRenderTask = task;
    await task.promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    preview.error = error.message || "PDF页面渲染失败";
    renderDrawingPreview();
  } finally {
    if (preview.pdfRenderId === renderId) preview.pdfRenderTask = null;
  }
}

function previewFileBody(preview) {
  const drawing = preview.drawings[preview.index];
  if (preview.loading) return '<div class="drawing-preview-status">正在加载图纸...</div>';
  if (preview.error) return `<div class="drawing-preview-status error">${esc(preview.error)}</div>`;
  if (isImageDrawing(drawing)) {
    return `<div class="drawing-image-stage"><img class="drawing-preview-image" src="${esc(preview.previewUrl)}" alt="${esc(drawing.name)}" style="transform:scale(${preview.zoom})"></div>`;
  }
  if (isCompactPdfPreview(preview)) return '<div class="compact-pdf-stage"><canvas class="compact-pdf-canvas" aria-label="PDF图纸页面"></canvas></div>';
  return `<iframe class="drawing-preview-frame" src="${esc(nativePdfPreviewUrl(preview))}" title="${esc(drawing.name)}"></iframe>`;
}

function renderDrawingPreview() {
  document.querySelector(".drawing-preview-modal")?.remove();
  const preview = tvState.drawingPreview;
  document.body.classList.toggle("drawing-preview-open", Boolean(preview));
  if (!preview) return;
  const drawing = preview.drawings[preview.index];
  const imageType = isImageDrawing(drawing);
  const compactPdf = isCompactPdfPreview(preview);
  const compactPdfReady = compactPdf && Boolean(preview.pdfDocument) && !preview.loading && !preview.error;
  const modal = document.createElement("div");
  modal.className = "drawing-preview-modal";
  modal.innerHTML = `
    <section class="drawing-preview-dialog" role="dialog" aria-modal="true" aria-label="工单图纸预览">
      <header class="drawing-preview-head">
        <div class="drawing-preview-title"><strong>${esc(preview.order.workNo)}</strong><span>${esc(preview.order.productName)}</span><span class="current-drawing-name">${esc(drawing.name)}</span></div>
        <div class="drawing-preview-actions">
          ${compactPdfReady ? `<button type="button" data-pdf-page="prev" title="上一页"${preview.pdfPage <= 1 ? " disabled" : ""}>‹</button><span class="pdf-page-count">${preview.pdfPage}/${preview.pdfPages}</span><button type="button" data-pdf-page="next" title="下一页"${preview.pdfPage >= preview.pdfPages ? " disabled" : ""}>›</button>` : ""}
          ${imageType || compactPdfReady ? '<button type="button" data-drawing-zoom="out" title="缩小">−</button><button type="button" data-drawing-zoom="reset" title="重置">1:1</button><button type="button" data-drawing-zoom="in" title="放大">＋</button>' : ""}
          <a href="${esc(drawingFileUrl(drawing, true))}" download="${esc(drawing.name)}" title="下载原图">下载</a>
          <button type="button" data-close-drawing-preview title="关闭">×</button>
        </div>
      </header>
      <div class="drawing-preview-layout ${preview.drawings.length === 1 ? "single-file" : ""}">
        ${preview.drawings.length === 1 ? "" : `<nav class="drawing-file-list" aria-label="图纸文件列表">${preview.drawings.map((item, index) => `<button type="button" class="${index === preview.index ? "active" : ""}" data-drawing-index="${index}" title="${esc(item.name)}"><span>${esc(item.name)}</span><small>${esc(String(item.fileType || "").toUpperCase())}</small></button>`).join("")}</nav>`}
        <main class="drawing-preview-body">${previewFileBody(preview)}</main>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  if (compactPdf && preview.pdfDocument && !preview.loading && !preview.error) requestAnimationFrame(() => renderCompactPdfPage(preview));
}

async function selectDrawing(index) {
  const preview = tvState.drawingPreview;
  if (!preview || !preview.drawings[index]) return;
  releaseDrawingPdf(preview);
  const selectionId = Number(preview.selectionId || 0) + 1;
  preview.selectionId = selectionId;
  preview.index = index;
  preview.zoom = 1;
  preview.loading = true;
  preview.error = "";
  preview.previewUrl = "";
  renderDrawingPreview();
  try {
    const response = await fetch("/api/tv-drawings/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${viewerToken()}` },
      body: JSON.stringify({ drawingId: preview.drawings[index].id })
    });
    const data = await response.json().catch(() => ({}));
    if (tvState.drawingPreview !== preview || preview.selectionId !== selectionId) return;
    if (!response.ok) throw new Error(data.error || "图纸预览失败");
    preview.previewUrl = data.previewUrl || "";
    preview.error = data.previewError || (!data.previewUrl ? "图纸预览失败" : "");
    if (!preview.error && isCompactPdfPreview(preview)) await loadCompactPdfDocument(preview, preview.previewUrl);
  } catch (error) {
    if (tvState.drawingPreview !== preview || preview.selectionId !== selectionId) return;
    preview.error = error.message || "图纸预览失败";
  } finally {
    if (tvState.drawingPreview !== preview || preview.selectionId !== selectionId) return;
    preview.loading = false;
    if (tvState.drawingPreview === preview) renderDrawingPreview();
  }
}

function openDrawingPreview(orderId) {
  if (!isMobileTv()) return;
  const order = (tvState.data?.activeOrders || []).find((item) => String(item.id) === String(orderId));
  if (!order?.drawings?.length) return;
  tvState.drawingPreview = { order, drawings: order.drawings, index: 0, previewUrl: "", error: "", loading: true, zoom: 1 };
  selectDrawing(0);
}

function closeDrawingPreview() {
  releaseDrawingPdf(tvState.drawingPreview);
  tvState.drawingPreview = null;
  renderDrawingPreview();
}

function rowsThatFit(height) {
  const rowHeight = 72;
  const rowGap = 6;
  return Math.max(1, Math.min(14, Math.floor((height + rowGap) / (rowHeight + rowGap))));
}

function tvContentHeight() {
  const rootHeight = tvRoot.clientHeight || window.innerHeight;
  const headerHeight = 52;
  const rootGap = 8;
  return Math.max(0, rootHeight - headerHeight - rootGap);
}

function tvOrderPages(orders) {
  const contentHeight = tvContentHeight();
  const sectionTitleSpace = 28;
  const summarySpace = 72 + 8 + 150 + 8;
  const firstPageSize = rowsThatFit(contentHeight - summarySpace - sectionTitleSpace);
  const laterPageSize = rowsThatFit(contentHeight - sectionTitleSpace);
  const firstPage = orders.slice(0, firstPageSize);
  const laterPages = [];

  for (let index = firstPageSize; index < orders.length; index += laterPageSize) {
    laterPages.push(orders.slice(index, index + laterPageSize));
  }

  return {
    firstPage,
    laterPages,
    totalOrderPages: Math.max(1, 1 + laterPages.length),
  };
}

function processLoadBar(process, maxLoad) {
  const completed = Number(process.completedToday || process.done || 0);
  const remaining = Number(process.remaining || process.todo || 0);
  return `
    <div class="process-load-bar-item">
      <div class="process-load-bar" title="${esc(process.name)}">
        <div class="process-load-value completed-value">${completed}</div>
        <div class="process-load-value remaining-value">${remaining}</div>
        <span class="completed" style="height:${Math.max(0, (completed / maxLoad) * 100)}%"></span>
        <span class="remaining" style="height:${Math.max(4, (remaining / maxLoad) * 100)}%"></span>
      </div>
      <div class="process-load-name">${esc(process.name)}</div>
    </div>
  `;
}

function processLoadChart(processLoad, maxLoad, mobileMode) {
  if (mobileMode) {
    return `<div class="process-load-bars">${processLoad.map((process) => processLoadBar(process, maxLoad)).join("")}</div>`;
  }

  const groups = [];
  for (let index = 0; index < processLoad.length; index += 5) {
    groups.push(processLoad.slice(index, index + 5));
  }
  if (!groups.length) groups.push([]);
  if (tvState.processPage >= groups.length) {
    tvState.processPage = 0;
    tvState.processDirection = 1;
  }

  return `
    <div class="process-load-window">
      <div class="process-load-track" style="transform:translate3d(-${tvState.processPage * 100}%,0,0)">
        ${groups.map((group) => `
          <div class="process-load-page">
            ${group.map((process) => processLoadBar(process, maxLoad)).join("")}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function trendChart(trend = []) {
  const items = trend.length ? trend : Array.from({ length: 7 }, (_, index) => ({ label: `--.${index + 1}`, value: 0 }));
  const maxValue = Math.max(1, ...items.map((item) => Number(item.value || 0)));
  const width = 420;
  const height = 104;
  const padX = 22;
  const padTop = 18;
  const padBottom = 28;
  const step = (width - padX * 2) / Math.max(1, items.length - 1);
  const points = items.map((item, index) => {
    const x = padX + index * step;
    const y = padTop + (1 - Number(item.value || 0) / maxValue) * (height - padTop - padBottom);
    return { ...item, x, y };
  });
  return `
    <svg class="trend-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="近7日报工趋势">
      <polyline class="trend-grid-line" points="${padX},${padTop} ${width - padX},${padTop}"></polyline>
      <polyline class="trend-grid-line" points="${padX},${height - padBottom} ${width - padX},${height - padBottom}"></polyline>
      <polyline class="trend-line" points="${points.map((p) => `${p.x},${p.y}`).join(" ")}"></polyline>
      ${points.map((p) => `
        <circle class="trend-dot" cx="${p.x}" cy="${p.y}" r="4"></circle>
        <text class="trend-value" x="${p.x}" y="${Math.max(12, p.y - 8)}">${esc(p.value)}</text>
        <text class="trend-label" x="${p.x}" y="${height - 6}">${esc(p.label)}</text>
      `).join("")}
    </svg>
  `;
}

function render(data, { preserveScroll = false } = {}) {
  const mobileMode = isMobileTv();
  const savedScrollY = mobileMode && preserveScroll ? window.scrollY : 0;
  const savedRouteScroll = mobileMode && preserveScroll ? captureMobileRouteScroll() : {};
  document.body.dataset.tvRatio = data.settings?.tvDisplayRatio || "auto";
  document.body.classList.toggle("mobile-tv", mobileMode);
  document.body.classList.toggle("compact-mobile", isCompactMobileTv());
  document.body.classList.toggle("dispatch-board", isDispatchBoard());
  document.body.classList.toggle("tv-carousel-mode", !mobileMode);
  const maxLoad = Math.max(1, ...data.processLoad.map((p) => Number(p.completedToday || p.done || 0) + Number(p.remaining || p.todo || 0)));
  const dist = data.statusDistribution;
  const statusTotal = Math.max(0, Number(dist.active || 0) + Number(dist.delayed || 0) + Number(dist.finishedToday || 0));
  const statusActiveEnd = statusTotal ? (Number(dist.active || 0) / statusTotal) * 100 : 0;
  const statusDelayedEnd = statusTotal
    ? statusActiveEnd + (Number(dist.delayed || 0) / statusTotal) * 100
    : 0;
  const activeOrders = data.activeOrders || [];
  const orderPages = mobileMode ? null : tvOrderPages(activeOrders);
  const totalScreens = mobileMode ? 1 : 1 + orderPages.laterPages.length;
  if (tvState.screenPage >= totalScreens) tvState.screenPage = 0;

  const headerHtml = `
    <header class="header">
      <div class="title">
        <div class="logo">◇</div>
        <div>
          <h1>${isDispatchBoard() ? "派工看板" : "生产状态监控看板"}</h1>
          <div class="subtitle">PRODUCTION CONTROL</div>
        </div>
      </div>
      <div class="company-name">宁波未来机械</div>
      <div class="live"><span class="dot"></span><span>LIVE</span><span id="clock">${esc(clockText(data.generatedAt))}</span></div>
    </header>
  `;

  const metricsHtml = `
    <section class="metrics">
      ${metric("急单", data.summary.rushWorkOrders || 0, "warn")}
      ${metric("延期工单", data.summary.delayedWorkOrders, "danger")}
      ${metric("48h加急", data.summary.urgentWorkOrders || 0, "danger")}
      ${metric("待加工工序", data.summary.waitingRoutes)}
      ${metric("工单总数", data.summary.totalWorkOrders)}
      ${metric("今日完成工单", data.summary.finishedWorkOrdersToday || 0)}
    </section>
  `;

  const chartsHtml = `
    <section class="charts">
      <div class="panel">
        <h2>在产准时率</h2>
        <div class="gauge" style="--rate:${data.summary.onTimeRate}"><strong>${data.summary.onTimeRate}%</strong></div>
      </div>
      <div class="panel">
        <h2>工单状态分布</h2>
        <div class="donut-legend">
          <span><i class="legend-dot"></i>执行中 ${dist.active}</span>
          <span><i class="legend-dot red"></i>延期 ${dist.delayed}</span>
          <span><i class="legend-dot green"></i>今日完成 ${dist.finishedToday}</span>
        </div>
        <div class="gauge compact-gauge status-donut${statusTotal ? "" : " empty"}" style="--status-active-end:${statusActiveEnd}%;--status-delayed-end:${statusDelayedEnd}%"><strong>${statusTotal}</strong></div>
      </div>
      <div class="panel">
        <h2>车间工序负荷</h2>
        ${processLoadChart(data.processLoad, maxLoad, mobileMode)}
      </div>
      <div class="panel">
        <h2>近7日完工工单趋势</h2>
        ${trendChart(data.reportTrend)}
      </div>
    </section>
  `;

  if (mobileMode) {
    tvRoot.innerHTML = `
      ${headerHtml}
      ${metricsHtml}
      ${chartsHtml}
      <section class="orders">
        <div class="section-title"><strong>加工工单</strong><span class="muted">共 ${activeOrders.length} 个加工工单，可上下滑动查看</span></div>
        <div class="order-list">
          ${activeOrders.length ? activeOrders.map((order) => orderRow(order, true)).join("") : '<div class="panel empty-orders">暂无加工工单</div>'}
        </div>
      </section>
    `;
  } else {
    const orderTitle = (pageNumber) => `
      <div class="section-title">
        <strong>加工工单</strong>
        <span class="muted">按交期排序：橙红=延期，浅红=48小时内加急，正常单按交期先后排列 · 第 ${pageNumber}/${orderPages.totalOrderPages} 页</span>
      </div>
    `;
    const orderList = (orders) => `
      <div class="order-list">
        ${orders.length ? orders.map((order) => orderRow(order, false)).join("") : '<div class="panel empty-orders">暂无加工工单</div>'}
      </div>
    `;
    const orderScreens = orderPages.laterPages.map((orders, pageIndex) => `
      <section class="tv-screen tv-orders-screen">
        ${orderTitle(pageIndex + 2)}
        ${orderList(orders)}
      </section>
    `).join("");

    tvRoot.innerHTML = `
      ${headerHtml}
      <div class="tv-screen-viewport">
        <div class="tv-screen-track" style="transform:translate3d(0,-${tvState.screenPage * 100}%,0)">
          <section class="tv-screen tv-summary-screen">
            ${metricsHtml}
            ${chartsHtml}
            <section class="orders">
              ${orderTitle(1)}
              ${orderList(orderPages.firstPage)}
            </section>
          </section>
          ${orderScreens}
        </div>
      </div>
    `;
  }

  if (mobileMode && preserveScroll) {
    requestAnimationFrame(() => {
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.min(savedScrollY, maxScrollY));
      restoreMobileRouteScroll(savedRouteScroll);
    });
  }
}

async function load() {
  try {
    const preserveScroll = Boolean(tvState.data) && isMobileTv();
    const token = viewerToken();
    const endpoint = token
      ? `/api/tv-dashboard?viewerToken=${encodeURIComponent(token)}`
      : "/api/tv-dashboard";
    const res = await fetch(endpoint);
    const data = await res.json();
    tvState.data = data;
    render(data, { preserveScroll });
    syncCarousel(data.settings || {});
  } catch (error) {
    tvRoot.innerHTML = `<section class="loading">看板加载失败：${esc(error.message)}</section>`;
  }
}

function showDispatchMessage(message, isError = false) {
  const previous = document.querySelector(".dispatch-message");
  if (previous) previous.remove();
  const node = document.createElement("div");
  node.className = `dispatch-message${isError ? " error" : ""}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

async function toggleDispatchRoute(node) {
  if (node.classList.contains("dispatch-pending")) return;
  node.classList.add("dispatch-pending");
  try {
    const token = viewerToken();
    const response = await fetch("/api/dispatch-board/route-toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        routeId: node.dataset.routeId,
        expectedStatus: node.dataset.routeStatus
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "派工操作失败");
    showDispatchMessage(data.route.status === "进行中" ? "工序已开始" : "工序已暂停");
    await load();
  } catch (error) {
    node.classList.remove("dispatch-pending");
    showDispatchMessage(error.message, true);
    await load();
  }
}

function screenCount() {
  if (!tvState.data) return 1;
  return 1 + tvOrderPages(tvState.data.activeOrders || []).laterPages.length;
}

function processGroupCount() {
  if (!tvState.data) return 1;
  return Math.max(1, Math.ceil((tvState.data.processLoad || []).length / 5));
}

function updateCarouselPositions() {
  const screenTrack = document.querySelector(".tv-screen-track");
  if (screenTrack) {
    screenTrack.style.transform = `translate3d(0,-${tvState.screenPage * 100}%,0)`;
  }
  const processTrack = document.querySelector(".process-load-track");
  if (processTrack) {
    processTrack.style.transform = `translate3d(-${tvState.processPage * 100}%,0,0)`;
  }
  document.querySelectorAll(".routes.route-carousel").forEach((viewport) => {
    const key = viewport.dataset.routeKey || "";
    const maxOffset = Number(viewport.dataset.routeMax || 0);
    const offset = Math.min(maxOffset, Math.max(0, Number(tvState.routeOffsets[key] || 0)));
    const node = viewport.querySelector(".route-node");
    const gap = Number.parseFloat(getComputedStyle(viewport).getPropertyValue("--route-gap")) || 0;
    const track = viewport.querySelector(".route-track");
    if (track && node) track.style.transform = `translate3d(-${offset * (node.offsetWidth + gap)}px,0,0)`;
  });
}

function turnScreenPage() {
  if (!tvState.data || isMobileTv()) return;
  tvState.screenPage = (tvState.screenPage + 1) % screenCount();
  updateCarouselPositions();
}

function turnProcessPage() {
  if (!tvState.data || isMobileTv()) return;
  const totalGroups = processGroupCount();
  if (totalGroups <= 1) return;

  if (tvState.processPage <= 0) tvState.processDirection = 1;
  if (tvState.processPage >= totalGroups - 1) tvState.processDirection = -1;
  tvState.processPage += tvState.processDirection;
  updateCarouselPositions();
}

function turnRouteCarousel() {
  if (!tvState.data || isMobileTv()) return;
  document.querySelectorAll(".routes.route-carousel").forEach((viewport) => {
    const key = viewport.dataset.routeKey || "";
    const maxOffset = Number(viewport.dataset.routeMax || 0);
    if (maxOffset <= 0) return;
    const currentOffset = Math.min(maxOffset, Math.max(0, Number(tvState.routeOffsets[key] || 0)));
    let direction = Number(tvState.routeDirections[key] || 1);
    if (currentOffset <= 0) direction = 1;
    if (currentOffset >= maxOffset) direction = -1;
    tvState.routeOffsets[key] = currentOffset + direction;
    tvState.routeDirections[key] = direction;
  });
  updateCarouselPositions();
}

function syncCarousel(settings) {
  const mobileMode = isMobileTv();
  const enabled = !mobileMode && settings.tvCarouselEnabled !== false;
  const screenSeconds = Math.max(30, Math.min(600, Number(settings.tvCarouselSeconds || 30)));
  const nextScreenKey = `${mobileMode}:${enabled}:${screenSeconds}:${screenCount()}`;
  if (screenTimerKey !== nextScreenKey) {
    screenTimerKey = nextScreenKey;
    if (screenTimer) clearInterval(screenTimer);
    screenTimer = null;
    if (enabled && screenCount() > 1) {
      screenTimer = setInterval(turnScreenPage, screenSeconds * 1000);
    } else {
      tvState.screenPage = 0;
    }
  }

  const groups = processGroupCount();
  const nextProcessKey = `${mobileMode}:${enabled}:${groups}`;
  if (processTimerKey !== nextProcessKey) {
    processTimerKey = nextProcessKey;
    if (processTimer) clearInterval(processTimer);
    processTimer = null;
    if (enabled && groups > 1) {
      processTimer = setInterval(turnProcessPage, 10000);
    } else {
      tvState.processPage = 0;
      tvState.processDirection = 1;
    }
  }

  if (tvState.screenPage >= screenCount()) tvState.screenPage = 0;
  if (tvState.processPage >= groups) {
    tvState.processPage = 0;
    tvState.processDirection = 1;
  }
  const longRouteCount = (tvState.data?.activeOrders || []).filter((order) => order.routes.length > 7).length;
  const nextRouteKey = `${mobileMode}:${enabled}:${longRouteCount}`;
  if (routeTimerKey !== nextRouteKey) {
    routeTimerKey = nextRouteKey;
    if (routeTimer) clearInterval(routeTimer);
    routeTimer = null;
    if (enabled && longRouteCount > 0) routeTimer = setInterval(turnRouteCarousel, 3000);
  }
  updateCarouselPositions();
}

load();
document.addEventListener("click", (event) => {
  const drawingButton = event.target.closest("[data-drawing-order-id]");
  if (drawingButton) {
    event.preventDefault();
    event.stopPropagation();
    openDrawingPreview(drawingButton.dataset.drawingOrderId);
    return;
  }
  const drawingIndex = event.target.closest("[data-drawing-index]");
  if (drawingIndex) {
    selectDrawing(Number(drawingIndex.dataset.drawingIndex));
    return;
  }
  const zoomButton = event.target.closest("[data-drawing-zoom]");
  if (zoomButton && tvState.drawingPreview) {
    const action = zoomButton.dataset.drawingZoom;
    if (action === "in") tvState.drawingPreview.zoom = Math.min(3, tvState.drawingPreview.zoom + 0.25);
    if (action === "out") tvState.drawingPreview.zoom = Math.max(0.5, tvState.drawingPreview.zoom - 0.25);
    if (action === "reset") tvState.drawingPreview.zoom = 1;
    renderDrawingPreview();
    return;
  }
  const pdfPageButton = event.target.closest("[data-pdf-page]");
  if (pdfPageButton && tvState.drawingPreview?.pdfDocument) {
    const preview = tvState.drawingPreview;
    preview.pdfPage = Math.min(preview.pdfPages, Math.max(1, preview.pdfPage + (pdfPageButton.dataset.pdfPage === "next" ? 1 : -1)));
    renderDrawingPreview();
    return;
  }
  if (event.target.closest("[data-close-drawing-preview]") || event.target.classList.contains("drawing-preview-modal")) {
    closeDrawingPreview();
    return;
  }
  if (!isDispatchBoard()) return;
  const node = event.target.closest(".route-node.dispatch-clickable");
  if (node) toggleDispatchRoute(node);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && tvState.drawingPreview) closeDrawingPreview();
});
window.addEventListener("resize", () => {
  if (tvState.data) {
    render(tvState.data, { preserveScroll: isMobileTv() });
    syncCarousel(tvState.data.settings || {});
  }
});
setInterval(load, 15000);
setInterval(() => {
  const clock = document.getElementById("clock");
  if (!clock) return;
  clock.textContent = clockText();
}, 1000);
