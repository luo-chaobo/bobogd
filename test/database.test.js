const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase } = require("../src/database");

test("adds a verified payment for a legacy paid order without one", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "future-database-"));
  const file = path.join(directory, "test.sqlite");
  const createdAt = "2026-09-10T08:00:00.000Z";
  let db = openDatabase(file);
  try {
    const inquiry = db.prepare(`INSERT INTO inquiries
      (inquiry_number, drawing_mode, contact_name, phone, region, quantity, expected_date, description, created_at)
      VALUES (?, 'none', ?, ?, ?, 1, ?, ?, ?)`).run("XQ-20260910-0001", "范德萨", "15257457485", "宁波", "2026-09-25", "机罩", createdAt);
    db.prepare(`INSERT INTO orders
      (inquiry_id, order_number, contact_name, phone, status, payment_status, total_amount, created_at)
      VALUES (?, ?, ?, ?, 'paid', 'paid', 1280, ?)`)
      .run(Number(inquiry.lastInsertRowid), "WL-20260910-0001", "范德萨", "15257457485", createdAt);
  } finally {
    db.close();
  }

  db = openDatabase(file);
  try {
    const payment = db.prepare("SELECT amount, payment_method, payer_name, received_at, status, recorded_by, verified_by FROM payments").get();
    assert.deepEqual({ ...payment }, {
      amount: 1280,
      payment_method: "历史已付款",
      payer_name: "范德萨",
      received_at: createdAt,
      status: "verified",
      recorded_by: "系统迁移",
      verified_by: "系统迁移"
    });
    assert.deepEqual({ ...db.prepare("SELECT inquiry_number, address_snapshot FROM orders").get() }, {
      inquiry_number: "XQ-20260910-0001",
      address_snapshot: ""
    });
    assert.equal(JSON.parse(db.prepare("SELECT requirement_snapshot FROM orders").get().requirement_snapshot).description, "机罩");
    assert.deepEqual({ ...db.prepare("SELECT payment_mode, total_amount, start_amount FROM payment_terms").get() }, {
      payment_mode: "full",
      total_amount: 1280,
      start_amount: 1280
    });
    assert.equal(db.prepare("SELECT is_legacy, note FROM payments").get().note, "原始收款明细未记录");
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
