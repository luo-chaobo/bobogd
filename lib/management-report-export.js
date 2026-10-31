const EXCLUDED_REPORTER_NAME = "罗朝波";
const STANDARD_PROCESSES = ["设计", "激光", "切管", "折弯", "压铆", "攻丝", "焊接", "机加", "打磨", "喷塑", "装配", "质检"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COLORS = {
  navy: "14213D",
  teal: "0F766E",
  blue: "1D6A8A",
  green: "16805D",
  orange: "D97706",
  red: "C23B32",
  gray: "94A3B8",
  line: "D8DEE9",
  paper: "F5F7FA",
  white: "FFFFFF",
};

const SOURCE_CHANNEL_LABELS = {
  website: "企业官网",
  order_platform: "接单平台",
  miniprogram: "未来机械小程序",
};
const { normalizeUnitPrice, calculateOrderTotal } = require("./order-financials");

function validateReportDateRange(from, to) {
  if (!DATE_PATTERN.test(String(from || "")) || !DATE_PATTERN.test(String(to || ""))) {
    throw new Error("日期格式必须为 YYYY-MM-DD");
  }
  const fromDate = new Date(`${from}T00:00:00+08:00`);
  const toDate = new Date(`${to}T00:00:00+08:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) throw new Error("日期格式无效");
  if (from > to) throw new Error("开始日期不能晚于结束日期");
  return { from, to };
}

function shanghaiDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function scheduleStatus(report, route) {
  if (report.scheduleStatus === "unplanned") return "unplanned";
  const reportDate = report.reportDate || shanghaiDate(report.createdAt);
  const start = report.plannedStartDate || route?.plannedStartDate || "";
  const end = report.plannedEndDate || route?.plannedEndDate || "";
  if (!start || !end) return "unplanned";
  return reportDate > end ? "outside_plan" : "on_time";
}

function buildManagementReportData(db, from, to) {
  validateReportDateRange(from, to);
  const users = new Map([...(db.users || []), ...(db.deletedUsers || [])].map((item) => [item.id, item]));
  const routes = new Map((db.routes || []).map((item) => [item.id, item]));
  const workOrders = new Map((db.workOrders || []).map((item) => [item.id, item]));
  const orders = new Map((db.orders || []).map((item) => [item.id, item]));
  const customers = new Map((db.customers || []).map((item) => [item.id, item]));
  const reports = (db.reports || [])
    .filter((report) => {
      const date = shanghaiDate(report.createdAt);
      return date >= from && date <= to && users.get(report.reporterId)?.name !== EXCLUDED_REPORTER_NAME;
    })
    .map((report) => {
      const route = routes.get(report.routeId);
      const workOrder = workOrders.get(report.workOrderId);
      const order = orders.get(workOrder?.orderId);
      const isPlatform = order?.orderOrigin === "platform" && SOURCE_CHANNEL_LABELS[order?.sourceChannel];
      const isQuality = report.reportType === "quality" || route?.processName === "质检";
      return {
        ...report,
        reporterName: users.get(report.reporterId)?.name || "",
        processName: route?.processName || "",
        workNo: workOrder?.workNo || "",
        orderNo: order?.orderNo || "",
        productName: workOrder?.productName || "",
        customerName: customers.get(order?.customerId)?.name || "",
        orderOriginLabel: isPlatform ? "平台单" : "工厂单",
        sourceChannelLabel: isPlatform ? SOURCE_CHANNEL_LABELS[order.sourceChannel] : "工厂单",
        dueDate: order?.dueDate || "",
        quantityUnit: order?.quantityUnit === "套" ? "套" : "件",
        reportTypeName: isQuality ? "质检" : "生产报工",
        plannedStartDate: report.plannedStartDate || route?.plannedStartDate || "",
        plannedEndDate: report.plannedEndDate || route?.plannedEndDate || "",
        reportDate: report.reportDate || shanghaiDate(report.createdAt),
        normalizedScheduleStatus: scheduleStatus(report, route),
      };
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const processMap = new Map();
  const personMap = new Map();
  const workOrderMap = new Map();
  const createSummary = (name) => ({ name, reports: 0, planned: 0, onTime: 0, late: 0, unplanned: 0, completedQty: 0, reworkQty: 0, badQty: 0 });

  for (const report of reports) {
    const status = report.normalizedScheduleStatus;
    const process = processMap.get(report.processName) || createSummary(report.processName || "未识别");
    const person = personMap.get(report.reporterName) || createSummary(report.reporterName || "未识别");
    const workOrder = workOrderMap.get(report.workOrderId) || {
      id: report.workOrderId,
      workNo: report.workNo,
      productName: report.productName,
      customerName: report.customerName,
      dueDate: report.dueDate,
      reports: 0,
      planned: 0,
      onTime: 0,
      late: 0,
      unplanned: 0,
      completedQty: 0,
      reworkQty: 0,
      badQty: 0,
      firstReportAt: report.createdAt,
      lastReportAt: report.createdAt,
    };
    for (const summary of [process, person, workOrder]) {
      summary.reports += 1;
      summary.completedQty += Number(report.completedQty || 0);
      summary.reworkQty += Number(report.reworkQty || 0);
      summary.badQty += Number(report.badQty || 0);
      if (status === "on_time") { summary.planned += 1; summary.onTime += 1; }
      else if (status === "outside_plan") { summary.planned += 1; summary.late += 1; }
      else summary.unplanned += 1;
    }
    workOrder.firstReportAt = String(workOrder.firstReportAt) < String(report.createdAt) ? workOrder.firstReportAt : report.createdAt;
    workOrder.lastReportAt = String(workOrder.lastReportAt) > String(report.createdAt) ? workOrder.lastReportAt : report.createdAt;
    processMap.set(process.name, process);
    personMap.set(person.name, person);
    workOrderMap.set(workOrder.id, workOrder);
  }

  const finalize = (item) => ({ ...item, onTimeRate: item.planned ? item.onTime / item.planned : null });
  const processes = STANDARD_PROCESSES.map((name) => finalize(processMap.get(name) || createSummary(name)));
  const latestReports = new Map();
  for (const report of db.reports || []) {
    const previous = latestReports.get(report.routeId);
    if (!previous || String(report.createdAt || "") > String(previous.createdAt || "")) latestReports.set(report.routeId, report);
  }
  const completionMap = new Map(STANDARD_PROCESSES.map((name) => [name, { name, onTime: 0, late: 0 }]));
  for (const route of db.routes || []) {
    const item = completionMap.get(route.processName);
    if (!item || route.status !== "已完成" || workOrders.get(route.workOrderId)?.creationStatus === "pending") continue;
    const report = latestReports.get(route.id);
    const start = report?.plannedStartDate || route.plannedStartDate;
    const end = report?.plannedEndDate || route.plannedEndDate;
    const completedAt = new Date(report?.createdAt || route.completedAt || route.lastReportedAt || "");
    const completedDate = shanghaiDate(completedAt);
    const deadline = new Date(`${end}T23:59:59.999+08:00`);
    if (!DATE_PATTERN.test(start || "") || !DATE_PATTERN.test(end || "") || shanghaiDate(`${start}T12:00:00+08:00`) !== start
      || shanghaiDate(deadline) !== end || start > end || report?.scheduleStatus === "unplanned"
      || completedDate < from || completedDate > to) continue;
    const onTime = completedAt <= deadline;
    item[onTime ? "onTime" : "late"] += 1;
  }
  const completion = Array.from(completionMap.values());
  const completionSample = completion.reduce((sum, item) => sum + item.onTime + item.late, 0);
  const people = Array.from(personMap.values()).map(finalize).sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name, "zh-CN"));
  const workOrderItems = Array.from(workOrderMap.values()).map((item) => {
    const delayed = Boolean(item.dueDate && shanghaiDate(item.lastReportAt) > item.dueDate);
    return { ...finalize(item), delayed, status: delayed ? "延误工单" : item.late ? "超时工单" : "正常工单" };
  })
    .sort((a, b) => String(b.lastReportAt).localeCompare(String(a.lastReportAt)));
  const onTimeCount = reports.filter((item) => item.normalizedScheduleStatus === "on_time").length;
  const lateCount = reports.filter((item) => item.normalizedScheduleStatus === "outside_plan").length;
  const unplannedCount = reports.length - onTimeCount - lateCount;
  const plannedCount = onTimeCount + lateCount;
  const groupReports = (definitions, field) => definitions.map(([key, name]) => {
    const items = reports.filter((report) => report[field] === name);
    return { key, name, reports: items.length, completedQty: items.reduce((sum, report) => sum + Number(report.completedQty || 0), 0) };
  });
  const sourceGroups = groupReports([["factory", "工厂单"], ["platform", "平台单"]], "orderOriginLabel");
  const channelGroups = groupReports(Object.entries(SOURCE_CHANNEL_LABELS), "sourceChannelLabel");
  const weldingReports = reports.filter((report) => {
    const route = routes.get(report.routeId);
    return report.processName === "焊接" && report.reportTypeName === "生产报工" && route?.routeType !== "rework";
  }).map((report) => {
    const order = orders.get(workOrders.get(report.workOrderId)?.orderId);
    const price = normalizeUnitPrice(order?.unitPrice).value;
    const completedQty = Number(report.completedQty || 0);
    return { ...report, unitPrice: price, amount: price === null ? null : calculateOrderTotal(price, completedQty) };
  });
  const weldingSummaryMap = new Map();
  for (const report of weldingReports) {
    const reporterKey = report.reporterId || `unknown:${report.reporterName}`;
    const summary = weldingSummaryMap.get(reporterKey) || { reporterId: report.reporterId || "", name: report.reporterName || "未识别", pricedValueCents: 0, reportCount: 0, unpricedReportCount: 0 };
    summary.reportCount += 1;
    if (report.amount === null) summary.unpricedReportCount += 1;
    else summary.pricedValueCents += Math.round(report.amount * 100);
    weldingSummaryMap.set(reporterKey, summary);
  }
  const weldingSummary = Array.from(weldingSummaryMap.values())
    .map((item) => ({ ...item, pricedValue: item.pricedValueCents / 100, completeness: item.unpricedReportCount ? "部分统计" : "完整统计" }))
    .sort((a, b) => b.pricedValue - a.pricedValue || a.name.localeCompare(b.name, "zh-CN"));
  const weldingNameCounts = new Map();
  weldingSummary.forEach((item) => weldingNameCounts.set(item.name, (weldingNameCounts.get(item.name) || 0) + 1));
  weldingSummary.forEach((item) => {
    if (weldingNameCounts.get(item.name) > 1) item.displayName = `${item.name}（${item.reporterId || "未知账号"}）`;
  });
  weldingReports.forEach((item) => {
    if (weldingNameCounts.get(item.reporterName || "未识别") > 1) item.displayReporterName = `${item.reporterName || "未识别"}（${item.reporterId || "未知账号"}）`;
  });

  return {
    from,
    to,
    reports,
    processes,
    completion,
    completionSample,
    people,
    weldingReports,
    weldingSummary,
    sourceGroups,
    channelGroups,
    workOrders: workOrderItems,
    metrics: {
      reportCount: reports.length,
      workOrderCount: workOrderItems.length,
      plannedCount,
      onTimeCount,
      lateCount,
      unplannedCount,
      scheduleCoverage: reports.length ? plannedCount / reports.length : 0,
      onTimeRate: plannedCount ? onTimeCount / plannedCount : 0,
      lateWorkOrderCount: workOrderItems.filter((item) => item.late > 0).length,
      delayedWorkOrderCount: workOrderItems.filter((item) => item.delayed).length,
    },
  };
}

const PROCESS_COLORS = ["1D6A8A", "0F766E", "16805D", "D97706", "C23B32", "7C3AED", "0891B2", "64748B", "E11D48", "2563EB", "16A34A", "A16207", "BE185D", "0369A1", "4D7C0F", "9333EA"];

function xmlText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function processColor(name, used) {
  let hash = 0;
  for (const char of String(name || "")) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  for (let offset = 0; offset < PROCESS_COLORS.length; offset += 1) {
    const color = PROCESS_COLORS[(hash + offset) % PROCESS_COLORS.length];
    if (!used.has(color)) { used.add(color); return color; }
  }
  return PROCESS_COLORS[hash % PROCESS_COLORS.length];
}

function pointColors(colors) {
  return colors.map((color, index) => `<c:dPt><c:idx val="${index}"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join("");
}

function categoryCache(labels) {
  return `<c:strLit><c:ptCount val="${labels.length}"/>${labels.map((label, index) => `<c:pt idx="${index}"><c:v>${xmlText(label)}</c:v></c:pt>`).join("")}</c:strLit>`;
}

function numberCache(values, format = "0") {
  return `<c:numLit><c:formatCode>${xmlText(format)}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${Number(value || 0)}</c:v></c:pt>`).join("")}</c:numLit>`;
}

function chartTitle(title) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1400" b="1"/><a:t>${xmlText(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
}

function chartSpace(content) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="zh-CN"/><c:roundedCorners val="0"/><c:chart>${content}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function valueLabels(values, percent) {
  const labels = values.map((value, index) => {
    if (Number(value) <= 0) return "";
    const label = percent ? `${Math.round(Number(value) * 100)}%` : String(Number(value));
    return `<c:dLbl><c:idx val="${index}"/><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="900"/><a:t>${label}</a:t></a:r></a:p></c:rich></c:tx><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbl>`;
  }).join("");
  return `<c:dLbls>${labels}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbls>`;
}

function barChartXml({ title, labels, values, colors, valueFormat, maximum, axisTitle }) {
  const catAxisId = 55000001;
  const valueAxisId = 55000002;
  const series = `<c:ser><c:idx val="0"/><c:order val="0"/>${pointColors(colors)}${valueLabels(values, valueFormat === "0%")}<c:cat>${categoryCache(labels)}</c:cat><c:val>${numberCache(values, valueFormat)}</c:val></c:ser>`;
  const maxXml = maximum == null ? "" : `<c:max val="${maximum}"/>`;
  return chartSpace(`${chartTitle(title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="1"/>${series}<c:gapWidth val="80"/><c:axId val="${catAxisId}"/><c:axId val="${valueAxisId}"/></c:barChart><c:catAx><c:axId val="${catAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valueAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="${valueAxisId}"/><c:scaling>${maxXml}<c:min val="0"/><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:title><c:tx><c:rich><a:bodyPr rot="-5400000"/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="900"/><a:t>${xmlText(axisTitle)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/></c:title><c:numFmt formatCode="${xmlText(valueFormat)}" sourceLinked="0"/><c:majorTickMark val="out"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>`);
}

function completionChartXml(items, sample) {
  const labels = items.map((item) => {
    const total = item.onTime + item.late;
    return `${item.name}  ${total ? Math.round(item.onTime / total * 100) + "%" : "—"}`;
  });
  const series = [["计划内", "16805D", items.map((item) => item.onTime)], ["计划外", "C23B32", items.map((item) => item.late)]]
    .map(([name, color, values], index) => `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${name}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:cat>${categoryCache(labels)}</c:cat><c:val>${numberCache(values)}</c:val></c:ser>`).join("");
  return chartSpace(`${chartTitle(`计划内完工率 · ${sample} 条工序`)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${series}<c:gapWidth val="45"/><c:overlap val="100"/><c:axId val="55000003"/><c:axId val="55000004"/></c:barChart><c:catAx><c:axId val="55000003"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="55000004"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="55000004"/><c:scaling><c:min val="0"/><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:tickLblPos val="nextTo"/><c:crossAx val="55000003"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>`);
}

function pieChartXml({ title, labels, values, colors }) {
  const active = labels.map((label, index) => ({ label, value: values[index], color: colors[index] })).filter((item) => item.value > 0);
  const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xmlText(title)}</c:v></c:tx>${pointColors(active.map((item) => item.color))}<c:cat>${categoryCache(active.map((item) => item.label))}</c:cat><c:val>${numberCache(active.map((item) => item.value))}</c:val></c:ser>`;
  return chartSpace(`${chartTitle(title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/>${series}<c:dLbls><c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/></c:dLbls><c:firstSliceAng val="270"/></c:pieChart></c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>`);
}

function chartAnchor(id, relationshipId, fromColumn, fromRow, toColumn, toRow, name) {
  return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xmlText(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relationshipId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

async function addNativeCharts(buffer, charts) {
  if (!charts.length) return buffer;
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  charts.forEach((chart, index) => zip.file(`xl/charts/chart${index + 1}.xml`, chart.xml));
  const anchors = charts.map((chart, index) => chartAnchor(index + 2, `rId${index + 1}`, chart.fromColumn, chart.fromRow, chart.toColumn, chart.toRow, chart.name)).join("");
  zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`).join("")}</Relationships>`);

  const sheetPath = "xl/worksheets/sheet1.xml";
  let sheetXml = await zip.file(sheetPath).async("string");
  if (!sheetXml.includes("xmlns:r=")) sheetXml = sheetXml.replace("<worksheet ", "<worksheet xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ");
  sheetXml = sheetXml.replace("</worksheet>", '<drawing r:id="rId1"/></worksheet>');
  zip.file(sheetPath, sheetXml);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');

  let contentTypes = await zip.file("[Content_Types].xml").async("string");
  const overrides = [`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`, ...charts.map((_, index) => `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)].join("");
  contentTypes = contentTypes.replace("</Types>", `${overrides}</Types>`);
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function styleTitle(sheet, title, subtitle, endColumn) {
  sheet.mergeCells(1, 1, 1, endColumn);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { name: "微软雅黑", size: 20, bold: true, color: { argb: COLORS.white } };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
  sheet.getCell(1, 1).alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(1).height = 34;
  sheet.mergeCells(2, 1, 2, endColumn);
  sheet.getCell(2, 1).value = subtitle;
  sheet.getCell(2, 1).font = { name: "微软雅黑", size: 9, color: { argb: "5E6B82" } };
  sheet.getCell(2, 1).alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(2).height = 22;
}

function styleTable(sheet, headerRow, lastRow, lastColumn, longTextColumns = []) {
  const header = sheet.getRow(headerRow);
  header.height = 25;
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = header.getCell(column);
    cell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = sheet.getRow(row).getCell(column);
      cell.font = { name: "微软雅黑", size: 9, color: { argb: "172033" } };
      cell.alignment = { horizontal: longTextColumns.includes(column) ? "left" : "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: COLORS.line } } };
      if (row % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paper } };
    }
  }
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastRow, column: lastColumn } };
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
}

function addSheet(workbook, name, title, subtitle, headers, rows, widths, longTextColumns = []) {
  const sheet = workbook.addWorksheet(name, { properties: { defaultRowHeight: 20 } });
  styleTitle(sheet, title, subtitle, headers.length);
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  styleTable(sheet, 3, Math.max(3, sheet.rowCount), headers.length, longTextColumns);
  return sheet;
}

function scheduleLabel(value) {
  return value === "on_time" ? "计划内" : value === "outside_plan" ? "计划外" : "未排期";
}

function dateTimeText(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

async function buildManagementWorkbook(data, { includeFinancials = false } = {}) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "bobogd";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const overview = workbook.addWorksheet("管理总览", { properties: { defaultRowHeight: 20 } });
  styleTitle(overview, "波波工单报工管理分析", "", 18);
  overview.getRow(2).height = 8;
  const metricRows = [
    ["有效报工", data.metrics.reportCount, "涉及工单", data.metrics.workOrderCount, "排期覆盖率", data.metrics.scheduleCoverage, "已排期准时率", data.metrics.onTimeRate],
    ["计划内报工", data.metrics.onTimeCount, "计划外报工", data.metrics.lateCount, "未排期报工", data.metrics.unplannedCount, "超时工单", data.metrics.lateWorkOrderCount],
  ];
  metricRows.forEach((row, index) => {
    const targetRow = 4 + index * 2;
    [[1, 3, 4], [5, 7, 9], [10, 12, 13], [14, 16, 18]].forEach(([labelColumn, valueColumn, endColumn], index) => {
      overview.mergeCells(targetRow, labelColumn, targetRow, valueColumn - 1);
      overview.mergeCells(targetRow, valueColumn, targetRow, endColumn);
      const label = overview.getCell(targetRow, labelColumn);
      const value = overview.getCell(targetRow, valueColumn);
      label.value = row[index * 2];
      value.value = row[index * 2 + 1];
      label.font = { name: "微软雅黑", size: 9, bold: true, color: { argb: "5E6B82" } };
      value.font = { name: "微软雅黑", size: 16, bold: true, color: { argb: COLORS.navy } };
      label.alignment = value.alignment = { horizontal: "center", vertical: "middle" };
      label.fill = value.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EEF2F7" } };
    });
  });
  overview.getCell("L4").numFmt = "0.0%";
  overview.getCell("P4").numFmt = "0.0%";
  overview.getCell("A8").value = "延误工单";
  overview.getCell("B8").value = data.metrics.delayedWorkOrderCount;
  overview.mergeCells("D8:R8");
  overview.getCell("C8").value = "统计范围";
  overview.getCell("D8").value = `${data.from} 至 ${data.to}`;
  ["A8", "B8", "C8", "D8"].forEach((address) => {
    const cell = overview.getCell(address);
    cell.font = { name: "微软雅黑", size: address === "D8" ? 12 : address === "B8" ? 16 : 9, bold: true, color: { argb: address === "B8" || address === "D8" ? COLORS.navy : "5E6B82" } };
    cell.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EEF2F7" } };
  });
  for (let i = 1; i <= 18; i += 1) overview.getColumn(i).width = 10.5;

  const processLabels = data.processes.map((item) => item.name);
  const processRates = data.processes.map((item) => item.onTimeRate || 0);
  const processLate = data.processes.map((item) => item.late);
  const processOnTime = data.processes.map((item) => item.onTime);
  const usedColors = new Set();
  const chartColors = processLabels.map((label) => processColor(label, usedColors));
  const sourceStart = 39;
  overview.mergeCells("A38:R38");
  overview.getCell("A38").value = "工序报工数据";
  overview.getCell("A38").font = { name: "微软雅黑", size: 14, bold: true, color: { argb: COLORS.navy } };
  overview.getRow(38).height = 28;
  const tableColumns = [1, 4, 7, 10, 13, 16];
  const headings = ["工序", "计划内率", "超时报工", "计划内报工", "计划内占比", "超时占比"];
  const onTimeTotal = processOnTime.reduce((sum, value) => sum + value, 0);
  const lateTotal = processLate.reduce((sum, value) => sum + value, 0);
  headings.forEach((heading, index) => overview.getCell(sourceStart, tableColumns[index]).value = heading);
  processLabels.forEach((label, index) => {
    const row = sourceStart + 1 + index;
    [label, data.processes[index].planned ? processRates[index] : "—", processLate[index], processOnTime[index], onTimeTotal ? processOnTime[index] / onTimeTotal : "—", lateTotal ? processLate[index] / lateTotal : "—"]
      .forEach((value, column) => { overview.getCell(row, tableColumns[column]).value = value; });
    [4, 13, 16].forEach((column) => { overview.getCell(row, column).numFmt = "0%"; });
  });
  styleTable(overview, sourceStart, sourceStart + Math.max(1, processLabels.length), 18);
  overview.getCell("I110").value = "来源";
  overview.getCell("J110").value = "报工数";
  data.sourceGroups.forEach((item, index) => {
    overview.getCell(111 + index, 9).value = item.name;
    overview.getCell(111 + index, 10).value = item.reports;
  });
  overview.views = [{ state: "frozen", ySplit: 2 }];

  const detailRows = data.reports.map((report) => [
    dateTimeText(report.createdAt), report.reporterName, report.workNo, report.customerName, report.orderOriginLabel, report.sourceChannelLabel, report.productName, report.quantityUnit, report.processName, report.reportTypeName,
    Number(report.completedQty || 0), Number(report.submittedQty || 0), Number(report.inspectedQty || 0),
    Number(report.goodQty || 0), Number(report.badQty || 0), Number(report.reworkQty || 0), report.disposition || "",
    report.plannedStartDate, report.plannedEndDate, report.reportDate, scheduleLabel(report.normalizedScheduleStatus),
    report.scheduleReason || "", report.note || "", report.id,
  ]);
  const detail = addSheet(workbook, "清洗后明细", "清洗后报工明细", `统计范围 ${data.from} 至 ${data.to}；已排除“${EXCLUDED_REPORTER_NAME}”`,
    ["时间", "人员", "工单", "客户名称", "来源", "渠道", "产品", "单位", "工序", "报工类型", "计入完成", "送检", "检验", "合格", "不合格", "返工", "处理方式", "计划开始日", "计划结束日", "实际报工日", "计划判定", "超计划原因", "备注", "记录ID"],
    detailRows, [20, 13, 18, 22, 12, 18, 34, 9, 12, 13, 12, 10, 10, 10, 10, 10, 14, 14, 14, 14, 12, 24, 30, 22], [4, 7, 22, 23]);
  data.reports.forEach((report, index) => {
    const row = detail.getRow(index + 4);
    if (report.normalizedScheduleStatus === "outside_plan") row.getCell(21).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FDECEC" } };
    if (report.normalizedScheduleStatus === "unplanned") row.getCell(21).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5E7EB" } };
  });

  const summaryRows = data.workOrders.map((item) => [item.workNo, item.customerName, item.productName, item.reports, item.planned, item.onTime, item.late, item.unplanned, item.onTimeRate ?? "", item.status, dateTimeText(item.firstReportAt), dateTimeText(item.lastReportAt), item.completedQty, item.reworkQty, item.badQty]);
  const workOrderSheet = addSheet(workbook, "工单汇总", "工单汇总", `超时工单：范围内至少存在一条计划外报工`,
    ["工单", "客户名称", "产品", "报工数", "已排期", "计划内", "计划外", "未排期", "计划内率", "工单标记", "首次报工", "最近报工", "完成数量", "返工", "不良"],
    summaryRows, [19, 22, 36, 11, 11, 11, 11, 11, 12, 14, 20, 20, 14, 11, 11], [2, 3]);
  data.workOrders.forEach((item, index) => {
    const row = workOrderSheet.getRow(index + 4);
    if (item.status === "超时工单") row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E0" } };
    if (item.status === "延误工单") {
      row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "8B0000" } };
      row.getCell(10).font = { name: "微软雅黑", size: 9, bold: true, color: { argb: COLORS.white } };
    }
    if (typeof row.getCell(9).value === "number") row.getCell(9).numFmt = "0.0%";
  });

  const analysisRows = (items) => items.map((item) => [item.name, item.reports, item.planned, item.onTime, item.late, item.unplanned, item.onTimeRate ?? "", item.completedQty, item.reworkQty, item.badQty]);
  for (const [name, title, items] of [["工序分析", "工序分析", data.processes], ["人员分析", "人员分析", data.people]]) {
    const sheet = addSheet(workbook, name, title, `统计范围 ${data.from} 至 ${data.to}`,
      [name === "工序分析" ? "工序" : "人员", "报工数", "已排期", "计划内", "计划外", "未排期", "计划内率", "完成数量", "返工", "不良"],
      analysisRows(items), [18, 12, 12, 12, 12, 12, 14, 16, 12, 12]);
    for (let row = 4; row <= sheet.rowCount; row += 1) if (typeof sheet.getCell(row, 7).value === "number") sheet.getCell(row, 7).numFmt = "0.0%";
  }

  if (includeFinancials) {
    const weldingSheet = workbook.addWorksheet("焊接统计", { properties: { defaultRowHeight: 20 } });
    styleTitle(weldingSheet, "焊接产值统计", `统计范围 ${data.from} 至 ${data.to}；已排除“${EXCLUDED_REPORTER_NAME}”及返工、质检报工`, 10);
    weldingSheet.mergeCells("A3:D3");
    weldingSheet.getCell("A3").value = "焊接工产值汇总（未计价报工需补充单价后再核算）";
    weldingSheet.getCell("A3").font = { name: "微软雅黑", size: 11, bold: true, color: { argb: COLORS.navy } };
    weldingSheet.addRow(["焊接工", "已计价产值小计（元）", "未计价报工数", "统计完整性"]);
    data.weldingSummary.forEach((item) => weldingSheet.addRow([item.displayName || item.name, item.pricedValue, item.unpricedReportCount, item.completeness]));
    styleTable(weldingSheet, 4, Math.max(4, 4 + data.weldingSummary.length), 4);
    for (let row = 5; row <= 4 + data.weldingSummary.length; row += 1) weldingSheet.getCell(row, 2).numFmt = '"¥"#,##0.00';

    const detailHeadingRow = 5 + data.weldingSummary.length;
    weldingSheet.mergeCells(detailHeadingRow, 1, detailHeadingRow, 10);
    weldingSheet.getCell(detailHeadingRow, 1).value = "焊接生产报工明细";
    weldingSheet.getCell(detailHeadingRow, 1).font = { name: "微软雅黑", size: 11, bold: true, color: { argb: COLORS.navy } };
    const headerRow = detailHeadingRow + 1;
    weldingSheet.addRow(["报工时间", "订单", "工单", "焊接工", "产品", "工序", "单位", "计入完成数量", "单价（元）", "本次产值（元）"]);
    const rows = data.weldingReports.map((item) => [dateTimeText(item.createdAt), item.orderNo, item.workNo, item.displayReporterName || item.reporterName, item.productName, item.processName, item.quantityUnit, Number(item.completedQty || 0), item.unitPrice, item.amount]);
    rows.forEach((row) => weldingSheet.addRow(row));
    styleTable(weldingSheet, headerRow, Math.max(headerRow, headerRow + rows.length), 10, [2, 3, 5]);
    for (let row = headerRow + 1; row <= headerRow + rows.length; row += 1) {
      weldingSheet.getCell(row, 9).numFmt = '"¥"#,##0.00';
      weldingSheet.getCell(row, 10).numFmt = '"¥"#,##0.00';
    }
    [21, 20, 20, 14, 30, 12, 10, 16, 16, 18].forEach((width, index) => { weldingSheet.getColumn(index + 1).width = width; });
  }

  addSheet(workbook, "指标口径与来源", "指标口径与来源", "系统事实口径与外部方法来源",
    ["项目", "定义/公式", "说明/来源"], [
      ["排期覆盖率", "已排期报工数 ÷ 有效报工数", "完整计划区间才能判定"],
      ["计划内率", "计划内报工数 ÷ 已排期报工数", "未排期不进入分母；提前或结束日当日报工计计划内，仅晚于结束日计计划外"],
      ["超时工单", "至少包含一条计划外报工", "内部工序排期失守，不等同客户订单逾期"],
      ["人员数据", "按报工人汇总", "不含标准工时和复杂度，不直接用于个人绩效"],
      ["排除人员", `报工汇总不含“${EXCLUDED_REPORTER_NAME}”操作记录`, "仅影响报工相关指标；工序完工率按已完成工序计算"],
      ["标准工序", "仅展示现行 12 道标准工序", "历史非标准工序报工保留在清洗后明细，不计入工序图表"],
      ["计划内完工率", "选定日期内已完成且有完整计划区间的工序；计划内 ÷ (计划内 + 计划外)", "按北京时间判断；未排期不计分母，提前或结束日当日完工计计划内，仅晚于结束日计计划外"],
      ["ISO 22400-2", "制造运行 KPI 的公式和适用范围", "https://www.iso.org/standard/54497.html"],
      ["ISO 18828-4", "生产计划 KPI 的企业边界", "https://www.iso.org/obp/ui/#iso:std:iso:18828:-4:ed-1:v1:en"],
      ["NIST MEP", "准时交付、响应、质量的平衡指标", "https://www.nist.gov/feature-stories/how-small-manufacturers-can-develop-risk-management-strategies-their-supply-chains"],
      ["Lean Enterprise Institute", "作业车间流动与交付周期", "https://www.lean.org/the-lean-post/articles/how-does-lean-apply-in-a-job-shop/"],
    ], [24, 60, 78], [2, 3]);

  const chartDefinitions = [];
  const addChart = (name, xml, fromColumn, fromRow, toColumn, toRow, values) => {
    if (!processLabels.length || values.every((value) => Number(value) <= 0)) {
      const cell = overview.getCell(fromRow + 5, fromColumn + 2);
      cell.value = `${name}：暂无数据`;
      cell.font = { name: "微软雅黑", size: 12, color: { argb: COLORS.gray } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      return;
    }
    chartDefinitions.push({ name, xml, fromColumn, fromRow, toColumn, toRow });
  };
  addChart("计划内完工率", completionChartXml(data.completion, data.completionSample), 0, 9, 18, 35, data.completion.map((item) => item.onTime + item.late));
  addChart("各工序已排期准时率", barChartXml({ title: "各工序已排期准时率", labels: processLabels, values: processRates, colors: chartColors, valueFormat: "0%", maximum: 1.12, axisTitle: "准时率" }), 0, 54, 9, 79, processRates);
  addChart("各工序超时报工数量", barChartXml({ title: "各工序超时报工数量", labels: processLabels, values: processLate, colors: chartColors, valueFormat: "0", maximum: null, axisTitle: "报工数量" }), 9, 54, 18, 79, processLate);
  addChart("各工序计划内报工数量占比", pieChartXml({ title: "各工序计划内报工数量占比", labels: processLabels, values: processOnTime, colors: chartColors }), 0, 82, 9, 107, processOnTime);
  addChart("各工序超时报工数量占比", pieChartXml({ title: "各工序超时报工数量占比", labels: processLabels, values: processLate, colors: chartColors }), 9, 82, 18, 107, processLate);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return addNativeCharts(buffer, chartDefinitions);
}

module.exports = {
  EXCLUDED_REPORTER_NAME,
  buildManagementReportData,
  buildManagementWorkbook,
  shanghaiDate,
  validateReportDateRange,
};
