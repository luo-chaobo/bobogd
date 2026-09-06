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
  addColumn(db, "orders", "customer_id", "INTEGER REFERENCES customers(id)");
  addColumn(db, "orders", "bobo_order_id", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "bobo_work_order_id", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "orders", "bobo_sync_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumn(db, "orders", "bobo_last_sequence", "INTEGER NOT NULL DEFAULT 0");
  return db;
}

function addColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function nextNumber(db, table, column, prefix, date) {
  const dateText = date.toISOString().slice(0, 10).replaceAll("-", "");
  const fullPrefix = `${prefix}-${dateText}-`;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} LIKE ?`).get(`${fullPrefix}%`);
  return `${fullPrefix}${String(Number(row.count) + 1).padStart(4, "0")}`;
}

module.exports = { nextNumber, openDatabase };
