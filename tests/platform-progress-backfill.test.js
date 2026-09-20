const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("backfills an existing platform report once without another shop-floor report", () => {
  const root = path.resolve(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bobo-backfill-"));
  const dbPath = path.join(directory, "data", "db.json");
  try {
    for (const name of ["data", "lib", "public"]) fs.mkdirSync(path.join(directory, name), { recursive: true });
    fs.copyFileSync(path.join(root, "server.js"), path.join(directory, "server.js"));
    fs.copyFileSync(path.join(root, "lib", "weapp-image.js"), path.join(directory, "lib", "weapp-image.js"));
    fs.writeFileSync(dbPath, JSON.stringify({
      users: [], deletedUsers: [], processes: [{ id: "laser", name: "激光", active: true }],
      customers: [{ id: "customer", name: "客户", active: true }],
      orders: [{ id: "order", orderNo: "WL-OLD", orderOrigin: "platform", sourceChannel: "order_platform", externalOrderNumber: "WL-OLD", customerId: "customer", quantity: 3 }],
      workOrders: [{ id: "work", orderId: "order", workNo: "WL-OLD" }],
      routes: [{ id: "route", workOrderId: "work", processName: "激光", processId: "laser", sequence: 1, status: "进行中", planQty: 3, completedQty: 1 }],
      reports: [{ id: "report-1", routeId: "route", workOrderId: "work", reporterId: "worker", completedQty: 1, createdAt: "2026-09-16T10:00:00.000Z" }],
      exceptions: [], attachments: [], drawings: [], auditLogs: [], settings: {}
    }));
    const run = () => spawnSync(process.execPath, ["server.js", "--backfill-platform-order", "WL-OLD"], {
      cwd: directory, encoding: "utf8", timeout: 2000,
      env: { ...process.env, DB_DRIVER: "json", FUTURE_WEBHOOK_URL: "", BOBO_INTEGRATION_SECRET: "" }
    });
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    assert.equal(db.reports.length, 1);
    assert.equal(db.platformWebhookEvents.length, 1);
    assert.deepEqual({ status: db.platformWebhookEvents[0].status, sequence: db.platformWebhookEvents[0].event.sequence, processStatus: db.platformWebhookEvents[0].event.process.status }, { status: "pending", sequence: 1, processStatus: "进行中" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
