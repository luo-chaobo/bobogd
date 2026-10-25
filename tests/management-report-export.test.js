const assert = require("assert");
const JSZip = require("jszip");

const {
  buildManagementReportData,
  buildManagementWorkbook,
  validateReportDateRange,
} = require("../lib/management-report-export");

const db = {
  users: [
    { id: "excluded", name: "罗朝波" },
    { id: "worker", name: "张师傅" },
    { id: "worker-duplicate", name: "张师傅" },
  ],
  customers: [
    { id: "c1", name: "海天" },
    { id: "c2", name: "福尔威" },
  ],
  orders: [
    { id: "o1", customerId: "c1", dueDate: "2026-08-02" },
    { id: "o2", customerId: "c2", dueDate: "2026-08-04" },
  ],
  workOrders: [
    { id: "w1", orderId: "o1", workNo: "WO-1", productName: "机架" },
    { id: "w2", orderId: "o2", workNo: "WO-2", productName: "护罩" },
  ],
  routes: [
    { id: "r1", workOrderId: "w1", processName: "激光", plannedStartDate: "2026-08-01", plannedEndDate: "2026-08-02", status: "已完成" },
    { id: "r2", workOrderId: "w2", processName: "折弯", plannedStartDate: "", plannedEndDate: "" },
  ],
  reports: [
    { id: "excluded-report", reporterId: "excluded", workOrderId: "w1", routeId: "r1", completedQty: 1, createdAt: "2026-08-02T01:00:00.000Z", scheduleStatus: "on_time" },
    { id: "on-time", reporterId: "worker", workOrderId: "w1", routeId: "r1", completedQty: 2, createdAt: "2026-08-02T02:00:00.000Z", scheduleStatus: "on_time" },
    { id: "late", reporterId: "worker", workOrderId: "w1", routeId: "r1", completedQty: 3, createdAt: "2026-08-03T02:00:00.000Z", scheduleStatus: "outside_plan" },
    { id: "unplanned", reporterId: "worker", workOrderId: "w2", routeId: "r2", completedQty: 4, createdAt: "2026-08-04T02:00:00.000Z", scheduleStatus: "unplanned" },
    { id: "outside-range", reporterId: "worker", workOrderId: "w2", routeId: "r2", completedQty: 5, createdAt: "2026-09-01T00:00:00.000Z", scheduleStatus: "unplanned" },
  ],
};

assert.deepStrictEqual(validateReportDateRange("2026-08-01", "2026-08-31"), { from: "2026-08-01", to: "2026-08-31" });
assert.throws(() => validateReportDateRange("2026-08-31", "2026-08-01"), /开始日期不能晚于结束日期/);
assert.throws(() => validateReportDateRange("2026-8-1", "2026-08-31"), /日期格式/);

const result = buildManagementReportData(db, "2026-08-01", "2026-08-31");
assert.deepStrictEqual(result.reports.map((item) => item.id), ["unplanned", "late", "on-time"]);
assert.strictEqual(result.metrics.reportCount, 3);
assert.strictEqual(result.metrics.workOrderCount, 2);
assert.strictEqual(result.metrics.plannedCount, 2);
assert.strictEqual(result.metrics.onTimeCount, 1);
assert.strictEqual(result.metrics.lateCount, 1);
assert.strictEqual(result.metrics.unplannedCount, 1);
assert.strictEqual(result.metrics.lateWorkOrderCount, 1);
assert.strictEqual(result.metrics.delayedWorkOrderCount, 1);
assert.strictEqual(result.workOrders.find((item) => item.id === "w1").status, "延误工单");
assert.strictEqual(result.workOrders.find((item) => item.id === "w2").status, "正常工单");
assert.strictEqual(result.reports.find((item) => item.id === "on-time").customerName, "海天");
assert.strictEqual(result.processes.find((item) => item.name === "激光").late, 1);
assert.strictEqual(result.processes.find((item) => item.name === "折弯").unplanned, 1);
assert.strictEqual(result.completionSample, 1, "应保留旧版已完成工序计划内/计划外统计");
assert.strictEqual(result.completion.find((item) => item.name === "激光").late, 1);

const weldingDb = {
  ...db,
  orders: [
    { id: "o1", orderNo: "SO-1", customerId: "c1", dueDate: "2026-08-02", unitPrice: 5.25 },
    { id: "o2", orderNo: "SO-2", customerId: "c2", dueDate: "2026-08-04" },
  ],
  workOrders: [
    ...db.workOrders,
    { id: "w3", orderId: "o1", workNo: "WO-WELD-1", productName: "机架焊接" },
    { id: "w7", orderId: "o1", workNo: "WO-WELD-2", productName: "机架焊接" },
    { id: "w4", orderId: "o1", workNo: "WO-REWORK", productName: "返工件" },
    { id: "w5", orderId: "o2", workNo: "WO-QUALITY", productName: "质检件" },
    { id: "w6", orderId: "o2", workNo: "WO-WELD-2", productName: "无价焊接件" },
  ],
  routes: [
    ...db.routes,
    { id: "r3", workOrderId: "w3", processName: "焊接" },
    { id: "r7", workOrderId: "w7", processName: "焊接" },
    { id: "r4", workOrderId: "w4", processName: "焊接", routeType: "rework" },
    { id: "r5", workOrderId: "w5", processName: "质检" },
    { id: "r6", workOrderId: "w6", processName: "焊接" },
  ],
  reports: [
    ...db.reports,
    { id: "weld-priced", reporterId: "worker", workOrderId: "w3", routeId: "r3", completedQty: 4, createdAt: "2026-08-05T02:00:00.000Z", reportType: "production" },
    { id: "weld-fractional", reporterId: "worker-duplicate", workOrderId: "w7", routeId: "r7", completedQty: 1.5, createdAt: "2026-08-05T03:00:00.000Z", reportType: "production" },
    { id: "weld-unpriced", reporterId: "worker", workOrderId: "w6", routeId: "r6", completedQty: 2, createdAt: "2026-08-06T02:00:00.000Z", reportType: "production" },
    { id: "weld-rework", reporterId: "worker", workOrderId: "w4", routeId: "r4", completedQty: 100, createdAt: "2026-08-06T03:00:00.000Z", reportType: "production" },
    { id: "weld-quality", reporterId: "worker", workOrderId: "w3", routeId: "r5", completedQty: 100, createdAt: "2026-08-06T04:00:00.000Z", reportType: "quality" },
    { id: "weld-outside", reporterId: "worker", workOrderId: "w3", routeId: "r3", completedQty: 100, createdAt: "2026-09-02T00:00:00.000Z", reportType: "production" },
    { id: "weld-excluded", reporterId: "excluded", workOrderId: "w3", routeId: "r3", completedQty: 100, createdAt: "2026-08-06T05:00:00.000Z", reportType: "production" },
  ],
};
const weldingResult = buildManagementReportData(weldingDb, "2026-08-01", "2026-08-31");
assert.deepStrictEqual(weldingResult.weldingReports.map((item) => item.id), ["weld-unpriced", "weld-fractional", "weld-priced"]);
assert.equal(weldingResult.weldingReports.find((item) => item.id === "weld-priced").orderNo, "SO-1");
assert.equal(weldingResult.weldingReports.find((item) => item.id === "weld-fractional").amount, 7.88);
assert.equal(weldingResult.weldingSummary.length, 2);
assert.equal(weldingResult.weldingSummary.find((item) => item.reporterId === "worker").pricedValue, 21);
assert.equal(weldingResult.weldingSummary.find((item) => item.reporterId === "worker-duplicate").pricedValue, 7.88);
assert.equal(weldingResult.weldingSummary.find((item) => item.reporterId === "worker").unpricedReportCount, 1);
assert.equal(weldingResult.weldingSummary.find((item) => item.reporterId === "worker").completeness, "部分统计");

(async () => {
  const buffer = await buildManagementWorkbook(result);
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 10000, "应生成有效的 XLSX 文件");
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepStrictEqual(workbook.worksheets.map((sheet) => sheet.name), ["管理总览", "清洗后明细", "工单汇总", "工序分析", "人员分析", "指标口径与来源"]);
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("D4").value, 3);
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("L4").value, 2 / 3);
  assert.strictEqual(workbook.model.media.length, 0, "管理总览不应再使用静态图片图表");
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("B8").value, 1, "管理总览应显示延误工单数量");
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("D8").value, "2026-08-01 至 2026-08-31");
  assert.strictEqual(workbook.getWorksheet("清洗后明细").getCell("D3").value, "客户名称");
  assert.strictEqual(workbook.getWorksheet("清洗后明细").getCell("D4").value, "福尔威");
  assert.strictEqual(workbook.getWorksheet("清洗后明细").getCell("A4").alignment.horizontal, "center");
  assert.strictEqual(workbook.getWorksheet("工单汇总").getCell("B3").value, "客户名称", "应保留线上版工单汇总客户列");
  assert.strictEqual(workbook.getWorksheet("工单汇总").getCell("B4").value, "福尔威");
  const zip = await JSZip.loadAsync(buffer);
  const chartFiles = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
  assert.strictEqual(chartFiles.length, 5, "管理总览应保留计划内完工率并包含原有四张 XLSX 图表");
  assert.ok(!Object.keys(zip.files).some((name) => name.startsWith("xl/media/")), "XLSX 不应包含图表 PNG");
  const charts = await Promise.all(chartFiles.map((name) => zip.file(name).async("string")));
  assert.ok(charts.some((xml) => xml.includes("计划内完工率")), "应保留旧版计划内完工率图表");
  assert.ok(charts.filter((xml) => xml.includes("<c:barChart>")).length === 3, "应包含旧版完工率图表和两张柱状图");
  assert.ok(charts.filter((xml) => xml.includes("<c:pieChart>")).length === 2, "应包含两张饼图");
  assert.ok(charts.filter((xml) => xml.includes("<c:dLbls>")).length === 4, "原有四张图表应包含数据标签配置");
  const financialWorkbook = await buildManagementWorkbook(weldingResult, { includeFinancials: true });
  const financialBook = new ExcelJS.Workbook();
  await financialBook.xlsx.load(financialWorkbook);
  assert.deepStrictEqual(financialBook.worksheets.map((sheet) => sheet.name), ["管理总览", "清洗后明细", "工单汇总", "工序分析", "人员分析", "焊接统计", "指标口径与来源"]);
  const weldingSheet = financialBook.getWorksheet("焊接统计");
  assert.equal(weldingSheet.getCell("B5").value, 21);
  assert.equal(weldingSheet.getCell("C5").value, 1);
  assert.equal(weldingSheet.getCell("D5").value, "部分统计");
  assert.match(weldingSheet.getCell("A5").value, /worker/);
  assert.match(weldingSheet.getCell("A6").value, /worker-duplicate/);
  assert.equal(weldingSheet.getCell("A8").value, "报工时间");
  assert.equal(weldingSheet.getCell("B9").value, "SO-2");
  assert.equal(weldingSheet.getCell("J9").value, null);
  assert.equal(weldingSheet.getCell("B10").value, "SO-1");
  assert.equal(weldingSheet.getCell("J10").value, 7.88);
  assert.match(weldingSheet.getCell("D10").value, /worker-duplicate/);
  assert.equal(weldingSheet.getCell("B11").value, "SO-1");
  assert.equal(weldingSheet.getCell("J11").value, 21);
  const ordinaryWorkbook = await buildManagementWorkbook(weldingResult, { includeFinancials: false });
  const ordinaryBook = new ExcelJS.Workbook();
  await ordinaryBook.xlsx.load(ordinaryWorkbook);
  assert.equal(ordinaryBook.getWorksheet("焊接统计"), undefined);
  console.log("management-report-export: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
