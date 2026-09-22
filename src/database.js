const { DatabaseSync } = require("node:sqlite");

function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wechat_identities (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      openid TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY,
      inquiry_number TEXT NOT NULL UNIQUE,
      drawing_mode TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      region TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL,
      expected_date TEXT NOT NULL,
      description TEXT NOT NULL,
      material TEXT NOT NULL DEFAULT '',
      dimensions TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      claimed_by TEXT,
      claimed_at TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      customer_id INTEGER REFERENCES customers(id),
      lifecycle_state TEXT NOT NULL DEFAULT 'submitted',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY,
      inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY,
      inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
      version INTEGER NOT NULL,
      amount REAL NOT NULL,
      valid_until TEXT NOT NULL,
      status TEXT NOT NULL,
      operator TEXT NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'full',
      start_amount REAL NOT NULL DEFAULT 0,
      specification_snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(inquiry_id, version)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      inquiry_id INTEGER NOT NULL UNIQUE REFERENCES inquiries(id),
      order_number TEXT NOT NULL UNIQUE,
      contact_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      total_amount REAL NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      bobo_all_processes_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_terms (
      order_id INTEGER PRIMARY KEY REFERENCES orders(id),
      payment_mode TEXT NOT NULL,
      total_amount REAL NOT NULL,
      start_amount REAL NOT NULL,
      balance_due_event TEXT NOT NULL DEFAULT 'before_shipping',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payer_name TEXT NOT NULL,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      verified_by TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      proof_original_name TEXT NOT NULL DEFAULT '',
      proof_stored_name TEXT NOT NULL DEFAULT '',
      review_reason TEXT NOT NULL DEFAULT '',
      is_legacy INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_receipts (
      id INTEGER PRIMARY KEY,
      payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
      receipt_number TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      order_number TEXT NOT NULL,
      payer_name TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      received_at TEXT NOT NULL,
      purpose TEXT NOT NULL,
      verified_by TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY,
      operator TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES admin_users(user_id),
      csrf_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_oauth_states (
      state_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inquiry_change_records (
      id INTEGER PRIMARY KEY,
      inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      operator TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscription_grants (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(id),
      enabled INTEGER NOT NULL,
      template_id TEXT NOT NULL DEFAULT '',
      available_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_jobs (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY,
      notification_job_id INTEGER NOT NULL REFERENCES notification_jobs(id),
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_todos (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS staged_uploads (
      id TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bobo_sync_jobs (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bobo_webhook_events (
      event_id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      sequence INTEGER NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integration_nonces (
      nonce TEXT PRIMARY KEY,
      received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_processes (
      order_id INTEGER NOT NULL REFERENCES orders(id),
      process_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (order_id, process_id)
    );
  `);
  addColumn(db, "inquiries", "source", "TEXT NOT NULL DEFAULT 'web'");
  addColumn(db, "inquiries", "customer_id", "INTEGER REFERENCES customers(id)");
  addColumn(db, "inquiries", "lifecycle_state", "TEXT NOT NULL DEFAULT 'submitted'");
  addColumn(db, "inquiries", "address", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "inquiries", "closed_reason", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "inquiries", "source_order_id", "INTEGER REFERENCES orders(id)");
  addColumn(db, "inquiries", "process", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "inquiries", "technical_requirements", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "quotes", "payment_mode", "TEXT NOT NULL DEFAULT 'full'");
  addColumn(db, "quotes", "start_amount", "REAL NOT NULL DEFAULT 0");
  addColumn(db, "quotes", "specification_snapshot", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, "orders", "customer_id", "INTEGER REFERENCES customers(id)");
  addColumn(db, "orders", "inquiry_number", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "quote_id", "INTEGER REFERENCES quotes(id)");
  addColumn(db, "orders", "address_snapshot", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "requirement_snapshot", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, "orders", "completed_at", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "bobo_order_id", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "bobo_work_order_id", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "bobo_sync_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumn(db, "orders", "bobo_last_sequence", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "orders", "bobo_all_processes_completed", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "audit_logs", "actor_user_id", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "audit_logs", "actor_role", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "payments", "proof_original_name", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "payments", "proof_stored_name", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "payments", "review_reason", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "payments", "is_legacy", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "payments", "note", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "subscription_grants", "template_id", "TEXT NOT NULL DEFAULT ''");
  const addedSubscriptionCount = addColumn(db, "subscription_grants", "available_count", "INTEGER NOT NULL DEFAULT 0");
  if (addedSubscriptionCount) db.prepare("UPDATE subscription_grants SET available_count = 1 WHERE enabled = 1").run();
  const legacyOrders = db.prepare(`SELECT orders.id AS order_id, orders.requirement_snapshot, inquiries.id AS inquiry_id,
    inquiries.inquiry_number, inquiries.address, inquiries.description, inquiries.material, inquiries.dimensions,
    inquiries.quantity, inquiries.expected_date, inquiries.drawing_mode, (
    SELECT id FROM quotes WHERE quotes.inquiry_id = inquiries.id AND quotes.status = 'confirmed' ORDER BY version DESC LIMIT 1
  ) AS confirmed_quote_id FROM orders JOIN inquiries ON inquiries.id = orders.inquiry_id`).all();
  for (const order of legacyOrders) {
    const snapshot = order.requirement_snapshot && order.requirement_snapshot !== "{}" ? order.requirement_snapshot : JSON.stringify({
      description: order.description,
      material: order.material,
      dimensions: order.dimensions,
      quantity: order.quantity,
      expectedDate: order.expected_date,
      drawingMode: order.drawing_mode,
      attachments: db.prepare("SELECT id, original_name AS name, size, created_at AS createdAt FROM attachments WHERE inquiry_id = ? ORDER BY id").all(order.inquiry_id)
    });
    db.prepare(`UPDATE orders SET inquiry_number = ?, quote_id = COALESCE(quote_id, ?), address_snapshot = CASE WHEN address_snapshot = '' THEN ? ELSE address_snapshot END, requirement_snapshot = ? WHERE id = ?`)
      .run(order.inquiry_number, order.confirmed_quote_id || null, order.address, snapshot, order.order_id);
  }
  db.exec(`
    INSERT INTO payment_terms (order_id, payment_mode, total_amount, start_amount, balance_due_event, created_at)
    SELECT orders.id, 'full', orders.total_amount, orders.total_amount, 'before_shipping', orders.created_at
    FROM orders
    WHERE NOT EXISTS (SELECT 1 FROM payment_terms WHERE payment_terms.order_id = orders.id)
  `);
  db.exec(`
    INSERT INTO payments
      (order_id, amount, payment_method, payer_name, received_at, status, recorded_by, verified_by, verified_at, is_legacy, note, created_at)
    SELECT orders.id, orders.total_amount, '历史已付款', orders.contact_name, orders.created_at,
      'verified', '系统迁移', '系统迁移', orders.created_at, 1, '原始收款明细未记录', orders.created_at
    FROM orders
    WHERE orders.payment_status = 'paid'
      AND NOT EXISTS (SELECT 1 FROM payments WHERE payments.order_id = orders.id)
  `);
  return db;
}

function addColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function nextNumber(db, table, column, prefix, date) {
  const dateText = date.toISOString().slice(0, 10).replaceAll("-", "");
  const fullPrefix = `${prefix}-${dateText}-`;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} LIKE ?`).get(`${fullPrefix}%`);
  return `${fullPrefix}${String(Number(row.count) + 1).padStart(4, "0")}`;
}

module.exports = { nextNumber, openDatabase };
