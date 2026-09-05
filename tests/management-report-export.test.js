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
    { id: "r1", workOrderId: "w1", processName: "激光", plannedStartDate: "2026-08-01", plannedEndDate: "2026-08-02" },
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

(async () => {
  const buffer = await buildManagementWorkbook(result);
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 10000, "应生成有效的 XLSX 文件");
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepStrictEqual(workbook.worksheets.map((sheet) => sheet.name), ["管理总览", "清洗后明细", "工单汇总", "工序分析", "人员分析", "指标口径与来源"]);
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("B4").value, 3);
  assert.strictEqual(workbook.model.media.length, 0, "管理总览不应再使用静态图片图表");
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("B8").value, 1, "管理总览应显示延误工单数量");
  assert.strictEqual(workbook.getWorksheet("管理总览").getCell("D8").value, "2026-08-01 至 2026-08-31");
  assert.strictEqual(workbook.getWorksheet("清洗后明细").getCell("D3").value, "客户名称");
  assert.strictEqual(workbook.getWorksheet("清洗后明细").getCell("D4").value, "福尔威");
  assert.strictEqual(workbook.getWorksheet("清洗后明细").getCell("A4").alignment.horizontal, "center");
  const zip = await JSZip.loadAsync(buffer);
  const chartFiles = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
  assert.strictEqual(chartFiles.length, 4, "管理总览应包含四张原生 XLSX 图表");
  assert.ok(!Object.keys(zip.files).some((name) => name.startsWith("xl/media/")), "XLSX 不应包含图表 PNG");
  const charts = await Promise.all(chartFiles.map((name) => zip.file(name).async("string")));
  assert.ok(charts.filter((xml) => xml.includes("<c:barChart>")).length === 2, "应包含两张柱状图");
  assert.ok(charts.filter((xml) => xml.includes("<c:pieChart>")).length === 2, "应包含两张饼图");
  assert.ok(charts.every((xml) => xml.includes("<c:dLbls>")), "图表应包含数据标签配置");
  console.log("management-report-export: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
