const tvRoot = document.getElementById("tv");
const tvState = {
  data: null,
  page: 0,
};
let carouselTimer = null;
let carouselKey = "";

function isMobileTv() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mobile") === "1" || (window.innerWidth <= 980 && window.innerWidth > window.innerHeight);
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
  if (route.status === "异常" || route.status === "返工") return "error";
  if (order.dueLevel === "overdue") return "delay";
  if (Number(route.completedQty || 0) > 0 || route.lastReportTime) return "reported";
  if (route.status === "进行中") return "active";
  return "";
}

function shortTime(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

function orderRow(order, mobileMode = false) {
  const badges = orderBadges(order);
  return `
    <div class="order-row ${order.dueLevel || ""}">
      <div class="order-badges">${badges.map((badge) => `<div class="badge ${badge.cls}">${badge.text}</div>`).join("")}</div>
      <div class="work-no">${esc(order.workNo)}</div>
      <div class="order-product">
        <div class="order-name">${esc(order.productName)}</div>
        <div class="muted">${esc(order.customer?.name || "")}</div>
        <div class="order-qty">${order.planQty} 件</div>
      </div>
      <div class="progress-line"><div class="progress-track"><span style="width:${order.progress}%"></span></div><span class="progress-percent">${order.progress}%</span></div>
      <div class="routes">
        ${order.routes.map((route) => {
          const showReportTime = route.status === "已完成" || (mobileMode && route.lastReportTime);
          const partialReportTime = mobileMode && route.status !== "已完成" && route.lastReportTime;
          return `
            <div class="route-node ${statusNodeClass(route, order)}${partialReportTime ? " partial-report-time" : ""}">
              <div class="circle">${route.progress || 0}</div>
              <div class="route-name">${esc(route.processName)}</div>
              <div class="route-time">${showReportTime ? shortTime(route.lastReportTime) : "待完成"}</div>
              <div class="route-target">${route.targetFinishTime ? shortTime(route.targetFinishTime) : "--"}</div>
              <div class="route-worker">${esc(route.reporterName || "")}</div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="due-cell ${order.dueLevel || "normal"}">交期 ${esc(dueShort(order))}</div>
    </div>
  `;
}

function rowsPerPage() {
  if (isMobileTv()) return Math.max(1, Math.min(3, Math.floor((window.innerHeight - 240) / 68)));
  return Math.max(4, Math.min(8, Math.floor((window.innerHeight - 380) / 96)));
}

function pagedOrders(orders) {
  const size = rowsPerPage();
  const totalPages = Math.max(1, Math.ceil(orders.length / size));
  if (tvState.page >= totalPages) tvState.page = 0;
  const start = tvState.page * size;
  return {
    totalPages,
    size,
    rows: orders.slice(start, start + size),
  };
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
  document.body.dataset.tvRatio = data.settings?.tvDisplayRatio || "auto";
  document.body.classList.toggle("mobile-tv", mobileMode);
  const maxLoad = Math.max(1, ...data.processLoad.map((p) => Number(p.completedToday || p.done || 0) + Number(p.remaining || p.todo || 0)));
  const dist = data.statusDistribution;
  const statusTotal = Math.max(0, Number(dist.active || 0) + Number(dist.delayed || 0) + Number(dist.finishedToday || 0));
  const statusActiveEnd = statusTotal ? (Number(dist.active || 0) / statusTotal) * 100 : 0;
  const statusDelayedEnd = statusTotal
    ? statusActiveEnd + (Number(dist.delayed || 0) / statusTotal) * 100
    : 0;
  const activeOrders = data.activeOrders || [];
  const page = mobileMode
    ? { totalPages: 1, size: activeOrders.length, rows: activeOrders }
    : pagedOrders(activeOrders);
  const orderListHint = mobileMode
    ? `共 ${activeOrders.length} 个加工工单，可上下滑动查看`
    : `按交期排序：橙红=延期，浅红=48小时内加急，正常单按交期先后排列 · 第 ${page.totalPages ? tvState.page + 1 : 1}/${page.totalPages} 页`;
  tvRoot.innerHTML = `
    <header class="header">
      <div class="title">
        <div class="logo">◇</div>
        <div>
          <h1>生产状态监控看板</h1>
          <div class="subtitle">PRODUCTION CONTROL</div>
        </div>
      </div>
      <div class="company-name">宁波未来机械</div>
      <div class="live"><span class="dot"></span><span>LIVE</span><span id="clock">${esc(clockText(data.generatedAt))}</span></div>
    </header>

    <section class="metrics">
      ${metric("急单", data.summary.rushWorkOrders || 0, "warn")}
      ${metric("延期工单", data.summary.delayedWorkOrders, "danger")}
      ${metric("48h加急", data.summary.urgentWorkOrders || 0, "danger")}
      ${metric("待加工工序", data.summary.waitingRoutes)}
      ${metric("工单总数", data.summary.totalWorkOrders)}
      ${metric("今日完成工单", data.summary.finishedWorkOrdersToday || 0)}
    </section>

    <section class="charts">
      <div class="panel">
        <h2>在产准时率</h2>
        <div class="gauge" style="--rate:${data.summary.onTimeRate}"><strong>${data.summary.onTimeRate}%</strong></div>
      </div>
      <div class="panel">
        <h2>工单状态分布</h2>
        <div class="donut-legend">
          <span><i class="legend-dot"></i>正常在产 ${dist.active}</span>
          <span><i class="legend-dot red"></i>延期 ${dist.delayed}</span>
          <span><i class="legend-dot green"></i>今日完成 ${dist.finishedToday}</span>
        </div>
        <div class="gauge compact-gauge status-donut${statusTotal ? "" : " empty"}" style="--status-active-end:${statusActiveEnd}%;--status-delayed-end:${statusDelayedEnd}%"><strong>${statusTotal}</strong></div>
      </div>
      <div class="panel">
        <h2>车间工序负荷</h2>
        <div class="process-load-bars">
          ${data.processLoad.map((p) => `
            <div class="process-load-bar-item">
              <div class="process-load-bar" title="${esc(p.name)}">
                <div class="process-load-value completed-value">${p.completedToday || 0}</div>
                <div class="process-load-value remaining-value">${p.remaining || 0}</div>
                <span class="completed" style="height:${Math.max(0, (Number(p.completedToday || 0) / maxLoad) * 100)}%"></span><span class="remaining" style="height:${Math.max(4, (Number(p.remaining || 0) / maxLoad) * 100)}%"></span>
              </div>
              <div class="process-load-name">${esc(p.name)}</div>
            </div>
            `).join("")}
        </div>
      </div>
      <div class="panel">
        <h2>近日报工趋势</h2>
        ${trendChart(data.reportTrend)}
      </div>
    </section>

    <section class="orders">
      <div class="section-title"><strong>加工工单</strong><span class="muted">${orderListHint}</span></div>
      <div class="order-list">
        ${page.rows.length ? page.rows.map((order) => orderRow(order, mobileMode)).join("") : '<div class="panel loading">暂无加工工单</div>'}
      </div>
    </section>

  `;

  if (mobileMode && preserveScroll) {
    requestAnimationFrame(() => {
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.min(savedScrollY, maxScrollY));
    });
  }
}

async function load() {
  try {
    const preserveScroll = Boolean(tvState.data) && isMobileTv();
    const res = await fetch("/api/tv-dashboard");
    const data = await res.json();
    tvState.data = data;
    render(data, { preserveScroll });
    syncCarousel(data.settings || {});
  } catch (error) {
    tvRoot.innerHTML = `<section class="loading">看板加载失败：${esc(error.message)}</section>`;
  }
}

function turnPage() {
  if (!tvState.data || isMobileTv()) return;
  const totalPages = Math.max(1, Math.ceil((tvState.data.activeOrders || []).length / rowsPerPage()));
  tvState.page = (tvState.page + 1) % totalPages;
  render(tvState.data);
}

function syncCarousel(settings) {
  const mobileMode = isMobileTv();
  const enabled = !mobileMode && settings.tvCarouselEnabled !== false;
  const seconds = Math.max(30, Math.min(600, Number(settings.tvCarouselSeconds || 120)));
  const nextKey = `${mobileMode}:${enabled}:${seconds}`;
  if (carouselKey === nextKey) return;
  carouselKey = nextKey;
  if (carouselTimer) clearInterval(carouselTimer);
  carouselTimer = null;
  if (enabled) carouselTimer = setInterval(turnPage, seconds * 1000);
}

load();
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
