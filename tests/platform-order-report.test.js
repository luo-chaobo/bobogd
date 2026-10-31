const assert = require("assert");
const test = require("node:test");

const { buildManagementReportData, buildManagementWorkbook } = require("../lib/management-report-export");

const db = {
  users: [{ id: "worker", name: "张师傅" }],
  customers: [],
  orders: [
    { id: "factory-order", orderOrigin: "factory", sourceChannel: "factory_manual" },
    { id: "website-order", orderOrigin: "platform", sourceChannel: "website", externalOrderNumber: "WEB-1" },
    { id: "platform-order", orderOrigin: "platform", sourceChannel: "order_platform", externalOrderNumber: "PLATFORM-1" },
    { id: "mini-order", orderOrigin: "platform", sourceChannel: "miniprogram", externalOrderNumber: "MINI-1" },
  ],
  workOrders: [
    { id: "factory", orderId: "factory-order", workNo: "F-1", productName: "工厂件" },
    { id: "website", orderId: "website-order", workNo: "P-1", productName: "网站件" },
    { id: "platform", orderId: "platform-order", workNo: "P-PLATFORM", productName: "接单平台件" },
    { id: "mini", orderId: "mini-order", workNo: "P-2", productName: "小程序件" },
  ],
  routes: [
    { id: "factory-route", workOrderId: "factory", processName: "激光" },
    { id: "website-route", workOrderId: "website", processName: "折弯" },
    { id: "platform-route", workOrderId: "platform", processName: "焊接" },
    { id: "mini-route", workOrderId: "mini", processName: "焊接" },
  ],
  reports: [
    { id: "factory-report", reporterId: "worker", workOrderId: "factory", routeId: "factory-route", completedQty: 2, createdAt: "2026-09-10T01:00:00.000Z" },
    { id: "website-report", reporterId: "worker", workOrderId: "website", routeId: "website-route", completedQty: 3, createdAt: "2026-09-11T01:00:00.000Z" },
    { id: "platform-report", reporterId: "worker", workOrderId: "platform", routeId: "platform-route", completedQty: 4, createdAt: "2026-09-11T12:00:00.000Z" },
    { id: "mini-report", reporterId: "worker", workOrderId: "mini", routeId: "mini-route", completedQty: 5, createdAt: "2026-09-12T01:00:00.000Z" },
  ],
};

test("管理统计按来源和平台渠道分组且总计一致", () => {
  const result = buildManagementReportData(db, "2026-09-01", "2026-09-30");
  assert.deepStrictEqual(result.sourceGroups.map((item) => [item.name, item.reports, item.completedQty]), [
    ["工厂单", 1, 2],
    ["平台单", 3, 12],
  ]);
  assert.deepStrictEqual(result.channelGroups.map((item) => [item.name, item.reports, item.completedQty]), [
    ["企业官网", 1, 3],
    ["接单平台", 1, 4],
    ["未来机械小程序", 1, 5],
  ]);
  assert.strictEqual(result.sourceGroups.reduce((sum, item) => sum + item.reports, 0), result.metrics.reportCount);
  assert.strictEqual(result.sourceGroups.reduce((sum, item) => sum + item.completedQty, 0), 14);
  assert.deepStrictEqual(result.reports.map((item) => [item.orderOriginLabel, item.sourceChannelLabel]), [
    ["平台单", "未来机械小程序"],
    ["平台单", "接单平台"],
    ["平台单", "企业官网"],
    ["工厂单", "工厂单"],
  ]);
});

test("管理分析 Excel 导出来源、渠道字段和分组汇总", async () => {
  const result = buildManagementReportData(db, "2026-09-01", "2026-09-30");
  const buffer = await buildManagementWorkbook(result);
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const detail = workbook.getWorksheet("清洗后明细");
  const overview = workbook.getWorksheet("管理总览");
  assert.strictEqual(detail.getCell("E3").value, "来源");
  assert.strictEqual(detail.getCell("F3").value, "渠道");
  assert.strictEqual(detail.getCell("E4").value, "平台单");
  assert.strictEqual(overview.getCell("I67").value, "工厂单");
  assert.strictEqual(overview.getCell("I68").value, "平台单");
  assert.strictEqual(overview.getCell("J67").value + overview.getCell("J68").value, 4);
});
