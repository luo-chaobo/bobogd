(function attachAdminTools(root, factory) {
  const tools = factory();
  if (typeof module === "object" && module.exports) module.exports = tools;
  else root.AdminTools = tools;
})(typeof globalThis === "object" ? globalThis : this, function createAdminTools() {
  const PROCESS_ORDER = ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "机加", "打磨", "喷塑", "装配", "质检"];

  function mergeRequirements(requirement, technicalRequirements) {
    const parts = [requirement, technicalRequirements].map((value) => String(value || "").trim()).filter(Boolean);
    return [...new Set(parts)].join("\n");
  }

  function serializeProcesses(selected, other = "") {
    const choices = new Set((selected || []).map((value) => String(value).trim()).filter(Boolean));
    const fixed = PROCESS_ORDER.filter((value) => choices.has(value));
    const extras = String(other || "").split(/[、,，]/).map((value) => value.trim()).filter(Boolean);
    return [...new Set([...fixed, ...extras])].join("、");
  }

  function parseAdminHash(hash) {
    const source = String(hash || "").replace(/^#/, "");
    const [view = "dashboard", query = ""] = source.split("?");
    return { view: view || "dashboard", params: Object.fromEntries(new URLSearchParams(query)) };
  }

  function buildAdminHash(view, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (String(value || "").trim()) query.set(key, value);
    return `#${view}${query.size ? `?${query}` : ""}`;
  }

  function orderScopeParams(scope) {
    const queue = String(scope || "").trim();
    return queue && queue !== "all" ? { view: "active", queue } : { view: "active" };
  }

  function resetOrderQuery() {
    return orderScopeParams("all");
  }

  function createOrderScopeController(options) {
    let navigate = options.navigate;
    return {
      setNavigate(next) { navigate = next; },
      async change(scope) {
        options.setBusy(true);
        try {
          await navigate(scope === "all" ? resetOrderQuery() : orderScopeParams(scope));
          return true;
        } catch (error) {
          options.onError(error);
          return false;
        } finally {
          options.setBusy(false);
        }
      }
    };
  }

  function priorityTaskTarget(task = {}) {
    const entityId = Number(task.entityId);
    if (["order", "inquiry"].includes(task.entityType) && Number.isSafeInteger(entityId) && entityId > 0) {
      return { kind: "drawer", entityType: task.entityType, entityId };
    }
    if (task.entityType === "payment" && Number.isSafeInteger(entityId) && entityId > 0) {
      return { kind: "payment", view: "payments", params: { status: "pending" }, entityId };
    }
    return { kind: "view", view: task.view || "dashboard", params: task.params || {} };
  }

  function createLoadingDelay(options) {
    const setTimeoutFn = options.setTimeoutFn || setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
    let timer = null;
    return {
      start() { if (timer === null) timer = setTimeoutFn(options.show, 300); },
      stop() { if (timer !== null) clearTimeoutFn(timer); timer = null; }
    };
  }

  function createRefreshController(options) {
    const setIntervalFn = options.setIntervalFn || setInterval;
    const clearIntervalFn = options.clearIntervalFn || clearInterval;
    let timer = null;
    let running = false;
    let queued = false;
    let queuedForce = false;
    let latestPromise = null;
    let resolveLatest = null;

    function queueLatest() {
      queued = true;
      queuedForce = true;
      if (!latestPromise) latestPromise = new Promise((resolve) => { resolveLatest = resolve; });
      return latestPromise;
    }

    function resume() {
      if (running || !queued) return;
      const forceNext = queuedForce;
      if (forceNext && options.canForceRefresh && !options.canForceRefresh()) return;
      if (!forceNext && !options.canRefresh()) { queued = false; return; }
      queued = false;
      queuedForce = false;
      const resolve = resolveLatest;
      latestPromise = null;
      resolveLatest = null;
      run(forceNext).then((result) => { if (resolve) resolve(result); });
    }

    async function run(force = false) {
      if (running) { queued = true; queuedForce ||= force; return false; }
      if (force && options.canForceRefresh && !options.canForceRefresh()) return false;
      if (!force && !options.canRefresh()) return false;
      running = true;
      try {
        await options.refresh();
        if (options.onUpdated) options.onUpdated();
        return true;
      } catch (error) {
        if (options.onError) options.onError(error);
        return false;
      } finally {
        running = false;
        resume();
      }
    }

    function runLatest() {
      if (running || (options.canForceRefresh && !options.canForceRefresh())) return queueLatest();
      return run(true);
    }

    function start() {
      if (timer === null) timer = setIntervalFn(run, 15000);
    }

    function stop() {
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
    }

    return { run, runLatest, resume, start, stop };
  }

  function syncOrderRow(row, detail, createBadge) {
    if (!row?.cells || row.cells.length < 4) return false;
    row.cells[2].replaceChildren(createBadge(detail.status, detail.statusText));
    row.cells[3].textContent = detail.currentProcess;
    return true;
  }

  function parseDxf(source) {
    const text = String(source || "");
    if (/AutoCAD Binary DXF/i.test(text)) throw new Error("暂不支持二进制 DXF 预览");
    const lines = text.replace(/\r/g, "").split("\n");
    const chunks = [];
    let current = null;
    for (let index = 0; index + 1 < lines.length; index += 2) {
      const code = Number(lines[index].trim());
      const value = lines[index + 1].trim();
      if (!Number.isFinite(code)) continue;
      if (code === 0) {
        if (current) chunks.push(current);
        current = { name: value.toUpperCase(), groups: [] };
      } else if (current) current.groups.push([code, value]);
    }
    if (current) chunks.push(current);

    const value = (chunk, code, fallback = 0) => {
      const group = chunk.groups.find(([groupCode]) => groupCode === code);
      const number = Number(group?.[1]);
      return Number.isFinite(number) ? number : fallback;
    };
    const points = (chunk) => {
      const result = [];
      for (let index = 0; index < chunk.groups.length; index += 1) {
        if (chunk.groups[index][0] !== 10) continue;
        const x = Number(chunk.groups[index][1]);
        const yGroup = chunk.groups.slice(index + 1).find(([code]) => code === 20 || code === 10);
        if (yGroup?.[0] === 20 && Number.isFinite(x) && Number.isFinite(Number(yGroup[1]))) result.push({ x, y: Number(yGroup[1]) });
      }
      return result;
    };

    const entities = [];
    let inEntities = false;
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk.name === "SECTION") { inEntities = chunk.groups.some(([code, item]) => code === 2 && item.toUpperCase() === "ENTITIES"); continue; }
      if (chunk.name === "ENDSEC") { inEntities = false; continue; }
      if (!inEntities) continue;
      if (chunk.name === "LINE") entities.push({ type: "line", x1: value(chunk, 10), y1: value(chunk, 20), x2: value(chunk, 11), y2: value(chunk, 21) });
      if (chunk.name === "LWPOLYLINE") entities.push({ type: "polyline", points: points(chunk), closed: Boolean(value(chunk, 70) & 1) });
      if (chunk.name === "POLYLINE") {
        const vertices = [];
        let cursor = index + 1;
        while (cursor < chunks.length && chunks[cursor].name !== "SEQEND") {
          if (chunks[cursor].name === "VERTEX") vertices.push({ x: value(chunks[cursor], 10), y: value(chunks[cursor], 20) });
          cursor += 1;
        }
        entities.push({ type: "polyline", points: vertices, closed: Boolean(value(chunk, 70) & 1) });
        index = cursor;
      }
      if (chunk.name === "CIRCLE") entities.push({ type: "circle", x: value(chunk, 10), y: value(chunk, 20), radius: Math.abs(value(chunk, 40)) });
      if (chunk.name === "ARC") entities.push({ type: "arc", x: value(chunk, 10), y: value(chunk, 20), radius: Math.abs(value(chunk, 40)), start: value(chunk, 50), end: value(chunk, 51) });
    }
    const usable = entities.filter((entity) => entity.type !== "polyline" || entity.points.length > 1);
    if (!usable.length) throw new Error("DXF 中没有可预览的二维实体");

    const coordinates = [];
    for (const entity of usable) {
      if (entity.type === "line") coordinates.push([entity.x1, entity.y1], [entity.x2, entity.y2]);
      if (entity.type === "polyline") coordinates.push(...entity.points.map((point) => [point.x, point.y]));
      if (entity.type === "circle" || entity.type === "arc") coordinates.push([entity.x - entity.radius, entity.y - entity.radius], [entity.x + entity.radius, entity.y + entity.radius]);
    }
    const xs = coordinates.map(([x]) => x);
    const ys = coordinates.map(([, y]) => y);
    return { entities: usable, bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
  }

  function drawReceipt(context, receipt) {
    context.fillStyle = "#f4f5f4"; context.fillRect(0, 0, 1600, 1000);
    context.fillStyle = "#fff"; context.fillRect(80, 70, 1440, 860);
    context.fillStyle = "#0e1a24"; context.fillRect(80, 70, 1440, 210);
    context.fillStyle = "#f36b2d"; context.fillRect(80, 280, 1440, 12);
    context.textAlign = "center";
    context.fillStyle = "#fff"; context.font = "700 46px Microsoft YaHei"; context.fillText(receipt.companyName, 800, 155);
    context.font = "700 58px Microsoft YaHei"; context.fillText("收 款 收 据", 800, 225);
    context.textAlign = "left";
    context.fillStyle = "#101820"; context.font = "500 30px Microsoft YaHei";
    const rows = [["收据号", receipt.receiptNumber], ["订单号", receipt.orderNumber], ["付款方", receipt.payerName], ["收款事由", receipt.purpose], ["付款方式", receipt.paymentMethod], ["到账金额", receipt.amountText], ["到账时间", receipt.receivedAtText], ["核验人", receipt.verifiedBy]];
    rows.forEach(([label, item], index) => { const y = 360 + index * 65; context.fillStyle = "#62707a"; context.fillText(label, 130, y); context.fillStyle = "#101820"; context.fillText(item || "—", 360, y); });
    context.fillStyle = "#62707a"; context.font = "400 24px Microsoft YaHei"; context.fillText("本收据仅作为本次款项到账凭证，不替代发票。", 130, 890);
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const source = String(text || "—");
    const lines = [];
    for (const paragraph of source.split("\n")) {
      let line = "";
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = character; }
        else line = candidate;
      }
      if (line) lines.push(line);
    }
    lines.slice(0, maxLines).forEach((item, index) => context.fillText(item, x, y + index * lineHeight));
  }

  function drawQuoteSheet(context, quote) {
    const specification = quote.specification || {};
    context.fillStyle = "#f4f5f4"; context.fillRect(0, 0, 1600, 1200);
    context.fillStyle = "#fff"; context.fillRect(70, 55, 1460, 1090);
    context.fillStyle = "#0e1a24"; context.fillRect(70, 55, 1460, 190);
    context.fillStyle = "#f36b2d"; context.fillRect(70, 245, 1460, 10);
    context.textAlign = "center"; context.fillStyle = "#fff";
    context.font = "700 42px Microsoft YaHei"; context.fillText(quote.companyName, 800, 130);
    context.font = "700 56px Microsoft YaHei"; context.fillText("报 价 单", 800, 205);
    context.textAlign = "left"; context.fillStyle = "#101820"; context.font = "500 27px Microsoft YaHei";
    const header = [["报价单号", `${quote.inquiryNumber}-V${quote.version}`], ["客户", quote.customerName], ["报价日期", quote.quotedAtText], ["报价有效期", quote.validUntil]];
    header.forEach(([label, value], index) => {
      const column = index % 2; const row = Math.floor(index / 2); const x = 120 + column * 730; const y = 315 + row * 58;
      context.fillStyle = "#62707a"; context.fillText(label, x, y); context.fillStyle = "#101820"; context.fillText(value || "—", x + 145, y);
    });
    context.strokeStyle = "#d7dde1"; context.lineWidth = 2; context.strokeRect(110, 425, 1380, 450);
    const rows = [
      ["加工需求", mergeRequirements(specification.requirement, specification.technicalRequirements)],
      ["材料", specification.material], ["厚度", specification.thickness], ["尺寸", specification.dimensions],
      ["加工工艺", specification.process], ["数量", specification.quantity], ["期望交期", specification.expectedDate], ["备注", specification.remark]
    ];
    rows.forEach(([label, value], index) => {
      const y = 480 + index * 44;
      context.fillStyle = "#62707a"; context.fillText(label, 145, y);
      context.fillStyle = "#101820"; drawWrappedText(context, value, 340, y, 1100, 32, 1);
    });
    context.fillStyle = "#eef1f2"; context.fillRect(110, 910, 1380, 145);
    const totals = [["报价总价", quote.amountText], ["付款条件", quote.paymentTerms], ["约定开工款", quote.startAmountText]];
    totals.forEach(([label, value], index) => {
      const y = 960 + index * 38;
      context.fillStyle = "#62707a"; context.fillText(label, 145, y);
      context.fillStyle = index === 0 ? "#f36b2d" : "#101820";
      context.font = index === 0 ? "700 32px Microsoft YaHei" : "500 27px Microsoft YaHei";
      context.fillText(value || "—", 340, y);
    });
    context.fillStyle = "#62707a"; context.font = "400 22px Microsoft YaHei";
    context.fillText("本报价按上述需求制作；需求、材料或工艺变更时，价格与交期需重新确认。", 110, 1105);
  }

  function quoteFormValues(inquiry) {
    return {
      requirement: mergeRequirements(inquiry.description, inquiry.technicalRequirements),
      material: String(inquiry.material || ""),
      thickness: "",
      dimensions: String(inquiry.dimensions || ""),
      process: "",
      quantity: Math.max(1, Number(inquiry.quantity) || 1),
      expectedDate: String(inquiry.expectedDate || ""),
      technicalRequirements: "",
      remark: ""
    };
  }

  function paymentVerificationMessage(result) {
    if (result.boboAutoSubmitted) return "到账已确认，波波同步已自动提交";
    if (["not_ready", "awaiting_confirmation"].includes(result.boboSyncStatus)) return "到账已确认，累计金额尚未达到开工款";
    if (result.boboSyncStatus === "synced") return "到账已确认，波波订单已同步";
    return "到账已确认，波波同步任务正在处理";
  }

  function paymentRegistrationState(payment) {
    if (Number(payment.pendingAmount) > 0) return "pending";
    if (Number(payment.remainingAmount) <= 0) return "paid";
    if (Number(payment.verifiedAmount) > 0) return "followup";
    return "initial";
  }

  const auditActionNames = {
    claim: "认领询价", link_customer: "关联客户", create_quote: "保存确认报价", close_inquiry: "关闭未成交询价",
    create_order: "生成正式订单", confirm_payment: "确认历史收款", register_payment: "登记收款", verify_payment: "确认到账",
    reject_payment: "驳回收款", void_payment: "作废收款", create_payment_receipt: "生成收据", manual_progress_override: "更新履约状态",
    confirm_bobo_sync: "首次同步波波", auto_submit_bobo_sync: "到账后自动提交波波同步", retry_bobo_sync: "重试波波同步", retry_notification: "重试消息通知", bobo_order_synced: "波波同步成功",
    wecom_alert_failed: "企业微信告警失败", webhook_event: "接收波波回调", bobo_status_repair: "修复波波履约状态", mock_login: "模拟登录", bind_phone: "绑定手机号",
    stage_upload: "暂存附件", subscription: "更新订阅", create_inquiry: "提交询价", update_inquiry: "更新询价",
    request_inquiry_change: "申请修改询价", supplement_inquiry: "补充询价资料"
  };

  function auditActionLabel(action) {
    return auditActionNames[action] || "其他系统操作";
  }

  function formatAuditDetail(detail) {
    const source = String(detail || "").trim();
    if (!source) return "—";
    try {
      const parsed = JSON.parse(source);
      if (parsed.kind === "bobo_webhook") {
        const suffix = parsed.eventId ? ` · 事件 ${parsed.eventId}` : "";
        if (parsed.eventType === "process.updated") return `工序：${parsed.process?.name || "未命名工序"} · ${parsed.process?.status || "状态已更新"}${suffix}`;
        if (parsed.eventType === "shipment.shipped") return `配送状态：配送中${suffix}`;
        if (parsed.eventType === "delivery.completed") return `配送状态：已送达${suffix}`;
      }
    } catch {}
    const legacyBobo = source.match(/^(process\.updated|shipment\.shipped|delivery\.completed):(.+)$/);
    if (legacyBobo) {
      const names = { "process.updated": "生产工序已更新", "shipment.shipped": "配送状态：配送中", "delivery.completed": "配送状态：已送达" };
      return `${names[legacyBobo[1]]} · 事件 ${legacyBobo[2]}`;
    }
    const statusNames = { awaiting_payment: "待付款", awaiting_schedule: "待排产", production: "生产中", quality: "质检中", ready: "待配送", shipped: "配送中", completed: "已送达" };
    const statusSeparator = source.indexOf(":");
    const status = source.slice(0, statusSeparator);
    if (statusNames[status]) return `${statusNames[status]} · ${source.slice(statusSeparator + 1)}`;
    const labels = { order: "订单", quote: "报价", payment: "付款记录", amount: "金额" };
    const parts = source.split(";");
    if (!parts.every((part) => /^(order|quote|payment|amount):/.test(part))) return source;
    return parts.map((part) => {
      const separator = part.indexOf(":");
      const key = part.slice(0, separator);
      const value = part.slice(separator + 1);
      if (key === "amount") return `${labels[key]} ¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `${labels[key]} #${value}`;
    }).join(" · ");
  }

  const adminActions = {
    "create-order": { title: "生成正式订单", description: "确认后将冻结当前需求和已确认报价，并进入正式履约流程。", confirmLabel: "确认生成", reasonRequired: false },
    "close-inquiry": { title: "关闭未成交询价", description: "关闭后该需求将退出活动询价队列，操作会写入审计记录。", confirmLabel: "确认关闭", reasonLabel: "未成交原因", reasonRequired: true },
    "verify-payment": { title: "确认到账", description: "请核对实际到账信息和付款凭证，确认后该笔款项计入订单已收金额。", confirmLabel: "确认到账", reasonRequired: false },
    "reject-payment": { title: "驳回收款", description: "驳回后该笔登记不计入订单已收金额，并保留完整审计记录。", confirmLabel: "确认驳回", reasonLabel: "驳回原因", reasonRequired: true },
    "void-payment": { title: "作废收款", description: "作废后该笔已确认款项将从订单已收金额中扣除，并保留完整审计记录。", confirmLabel: "确认作废", reasonLabel: "作废原因", reasonRequired: true },
    "sync-bobo": { title: "首次同步波波", description: "确认后将向波波工单系统发送该订单的生产任务。", confirmLabel: "确认同步", reasonRequired: false },
    "retry-bobo": { title: "重试波波同步", description: "确认后将再次向波波工单系统发送该订单任务。", confirmLabel: "确认重试", reasonRequired: false },
    "advance-order": { title: "更新履约状态", description: "该操作会更新订单履约节点，并写入可追溯的操作记录。", confirmLabel: "确认更新", reasonLabel: "更新依据", reasonRequired: true }
  };

  function adminActionDefinition(kind, context = {}) {
    const definition = adminActions[kind];
    if (!definition) throw new Error("未知后台操作");
    return { ...definition, reference: context.reference || "" };
  }

  return { PROCESS_ORDER, createRefreshController, createOrderScopeController, createLoadingDelay, syncOrderRow, parseDxf, drawReceipt, drawQuoteSheet, quoteFormValues, mergeRequirements, serializeProcesses, parseAdminHash, buildAdminHash, orderScopeParams, resetOrderQuery, priorityTaskTarget, paymentVerificationMessage, paymentRegistrationState, auditActionLabel, formatAuditDetail, adminActionDefinition };
});
