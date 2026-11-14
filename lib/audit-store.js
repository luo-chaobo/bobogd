'use strict';

const CREATE_AUDIT_TABLE = `CREATE TABLE IF NOT EXISTS bobo_audit_logs_v2 (
  id VARCHAR(80) PRIMARY KEY,
  actor_id VARCHAR(80) NOT NULL DEFAULT '',
  action VARCHAR(120) NOT NULL DEFAULT '',
  target_type VARCHAR(120) NOT NULL DEFAULT '',
  target_id VARCHAR(160) NOT NULL DEFAULT '',
  detail JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  payload JSON NOT NULL,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_actor_created (actor_id, created_at),
  INDEX idx_audit_action_created (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function auditValues(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid audit record');
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 80) throw new TypeError('Invalid audit id');
  const fields = [['actorId', 80], ['action', 120], ['targetType', 120], ['targetId', 160]];
  const values = fields.map(([field, limit]) => {
    const value = item[field] == null ? '' : item[field];
    if (typeof value !== 'string' || value.length > limit) throw new TypeError(`Invalid audit ${field}`);
    return value;
  });
  if (typeof item.createdAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(item.createdAt) || !Number.isFinite(Date.parse(item.createdAt))) {
    throw new TypeError('Invalid audit createdAt');
  }
  const timestamp = new Date(item.createdAt).toISOString().slice(0, 23).replace('T', ' ');
  return [item.id, ...values, JSON.stringify(item.detail === undefined ? {} : item.detail), timestamp, JSON.stringify(item)];
}

async function insertAudit(connection, item) {
  await connection.execute(
    'INSERT INTO bobo_audit_logs_v2 (id, actor_id, action, target_type, target_id, detail, created_at, payload) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))',
    auditValues(item)
  );
}

module.exports = { CREATE_AUDIT_TABLE, auditValues, insertAudit };
