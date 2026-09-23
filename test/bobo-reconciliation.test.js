const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase } = require("../src/database");
const { applyBoboStatusRepairs, findBoboStatusRepairs } = require("../src/bobo-reconciliation");

function addOrder(db, suffix, status) {
  const createdAt = `2026-09-22T1${suffix}:00:00.000Z`;
  const inquiry = db.prepare(`INSERT INTO inquiries
    (inquiry_number, drawing_mode, contact_name, phone, region, quantity, expected_date, description, created_at)
    VALUES (?, 'none', '客户', ?, '宁波', 1, '2026-09-30', '测试件', ?)`)
    .run(`XQ-REPAIR-${suffix}`, `1380000000${suffix}`, createdAt);
  const order = db.prepare(`INSERT INTO orders
    (inquiry_id, order_number, contact_name, phone, status, payment_status, total_amount, created_at)
    VALUES (?, ?, '客户', ?, ?, 'paid', 100, ?)`)
    .run(Number(inquiry.lastInsertRowid), `WL-REPAIR-${suffix}`, `1380000000${suffix}`, status, createdAt);
  return Number(order.lastInsertRowid);
}

test("repairs accepted delivery callbacks monotonically and idempotently", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-bobo-repair-"));
  const db = openDatabase(path.join(directory, "test.sqlite"));
  try {
    const delivered = addOrder(db, "1", "shipped");
    const delivering = addOrder(db, "2", "ready");
    const untouched = addOrder(db, "3", "completed");
    db.prepare("INSERT INTO audit_logs (operator, action, entity_type, entity_id, detail, created_at) VALUES ('bobo', 'webhook_event', 'order', ?, ?, ?)")
      .run(delivered, "delivery.completed:legacy-delivery", "2026-09-22T15:02:00.000Z");
    db.prepare("INSERT INTO audit_logs (operator, action, entity_type, entity_id, detail, created_at) VALUES ('bobo', 'webhook_event', 'order', ?, ?, ?)")
      .run(delivering, "shipment.shipped:legacy-shipment", "2026-09-22T15:01:00.000Z");
    db.prepare("INSERT INTO audit_logs (operator, action, entity_type, entity_id, detail, created_at) VALUES ('bobo', 'webhook_event', 'order', ?, ?, ?)")
      .run(untouched, "shipment.shipped:stale-shipment", "2026-09-22T15:00:00.000Z");

    assert.deepEqual(findBoboStatusRepairs(db).map((item) => [item.orderNumber, item.fromStatus, item.toStatus]), [
      ["WL-REPAIR-1", "shipped", "completed"],
      ["WL-REPAIR-2", "ready", "shipped"]
    ]);
    assert.equal(applyBoboStatusRepairs(db, "2026-09-23T01:00:00.000Z"), 2);
    assert.deepEqual(db.prepare("SELECT order_number, status FROM orders ORDER BY id").all().map((item) => [item.order_number, item.status]), [
      ["WL-REPAIR-1", "completed"],
      ["WL-REPAIR-2", "shipped"],
      ["WL-REPAIR-3", "completed"]
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'bobo_status_repair'").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_events WHERE status IN ('shipped', 'completed')").get().count, 2);
    assert.equal(applyBoboStatusRepairs(db, "2026-09-23T01:05:00.000Z"), 0);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
