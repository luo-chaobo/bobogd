const STATUS_RANK = Object.freeze({ ready: 4, shipped: 5, completed: 6 });
const EVENT_STATUS = Object.freeze({ "shipment.shipped": "shipped", "delivery.completed": "completed" });
const EVENT_TITLE = Object.freeze({ shipped: "订单配送中", completed: "订单已送达" });

function eventTypeFromAudit(detail) {
  const source = String(detail || "");
  try {
    const parsed = JSON.parse(source);
    return parsed.kind === "bobo_webhook" ? String(parsed.eventType || "") : "";
  } catch {
    return source.match(/^(shipment\.shipped|delivery\.completed):/)?.[1] || "";
  }
}

function findBoboStatusRepairs(db) {
  const orders = new Map(db.prepare("SELECT id, order_number, status FROM orders").all().map((row) => [row.id, row]));
  const candidates = new Map();
  const consider = (orderId, eventType, occurredAt) => {
    const order = orders.get(orderId);
    const toStatus = EVENT_STATUS[eventType];
    if (!order || !toStatus || (STATUS_RANK[toStatus] || 0) <= (STATUS_RANK[order.status] || 0)) return;
    const current = candidates.get(orderId);
    if (!current || STATUS_RANK[toStatus] > STATUS_RANK[current.toStatus]) {
      candidates.set(orderId, { orderId, orderNumber: order.order_number, fromStatus: order.status, toStatus, eventType, occurredAt: String(occurredAt || "") });
    }
  };
  const columns = new Set(db.prepare("PRAGMA table_info(bobo_webhook_events)").all().map((item) => item.name));
  if (columns.has("event_type")) {
    for (const row of db.prepare("SELECT order_id, event_type, occurred_at, received_at FROM bobo_webhook_events").all()) {
      consider(row.order_id, row.event_type, row.occurred_at || row.received_at);
    }
  }
  for (const row of db.prepare("SELECT entity_id, detail, created_at FROM audit_logs WHERE action = 'webhook_event' AND entity_type = 'order'").all()) {
    consider(row.entity_id, eventTypeFromAudit(row.detail), row.created_at);
  }
  return [...candidates.values()].sort((left, right) => left.orderId - right.orderId);
}

function applyBoboStatusRepairs(db, repairedAt = new Date().toISOString()) {
  const repairs = findBoboStatusRepairs(db);
  if (!repairs.length) return 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const repair of repairs) {
      const completedAt = repair.toStatus === "completed" ? repair.occurredAt || repairedAt : "";
      db.prepare(`UPDATE orders SET status = ?, completed_at = CASE WHEN ? != '' AND completed_at = '' THEN ? ELSE completed_at END WHERE id = ?`)
        .run(repair.toStatus, completedAt, completedAt, repair.orderId);
      const existing = db.prepare("SELECT id FROM order_events WHERE order_id = ? AND status = ? LIMIT 1").get(repair.orderId, repair.toStatus);
      if (!existing) db.prepare("INSERT INTO order_events (order_id, status, title, occurred_at) VALUES (?, ?, ?, ?)")
        .run(repair.orderId, repair.toStatus, EVENT_TITLE[repair.toStatus], repair.occurredAt || repairedAt);
      db.prepare(`INSERT INTO audit_logs
        (operator, action, entity_type, entity_id, detail, created_at, actor_user_id, actor_role)
        VALUES ('system', 'bobo_status_repair', 'order', ?, ?, ?, 'system', 'system')`)
        .run(repair.orderId, JSON.stringify({ fromStatus: repair.fromStatus, toStatus: repair.toStatus, sourceEvent: repair.eventType }), repairedAt);
    }
    db.exec("COMMIT");
    return repairs.length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { applyBoboStatusRepairs, findBoboStatusRepairs };
