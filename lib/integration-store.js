'use strict';
const { allocatePosition } = require('./row-sequence');

const CREATE_OUTBOX_TABLE = `CREATE TABLE IF NOT EXISTS bobo_outbox_v2 (
  event_id VARCHAR(160) NOT NULL PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  external_order_number VARCHAR(128) NOT NULL,
  event_sequence BIGINT UNSIGNED NOT NULL,
  source_position BIGINT UNSIGNED NOT NULL,
  lease_token VARCHAR(64) NULL,
  lease_until DATETIME(3) NULL,
  payload JSON NOT NULL,
  UNIQUE KEY idx_outbox_source_position (source_position),
  UNIQUE KEY idx_outbox_order_sequence (external_order_number, event_sequence),
  KEY idx_outbox_status (status, source_position),
  KEY idx_outbox_lease (lease_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

function outboxValues(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !item.event || typeof item.event !== 'object' || Array.isArray(item.event)) {
    throw new TypeError('Invalid outbox event');
  }
  const eventId = item.event.eventId;
  if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 160) throw new TypeError('Invalid outbox event ID');
  if (!['pending', 'delivered'].includes(item.status)) throw new TypeError('Invalid outbox status');
  const externalOrderNumber = item.event.externalOrderNumber;
  const sequence = item.event.sequence;
  if (typeof externalOrderNumber !== 'string' || !externalOrderNumber.trim() || externalOrderNumber.length > 128) throw new TypeError('Invalid external order number');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('Invalid outbox event sequence');
  if (item.nextAttemptAt != null && item.nextAttemptAt !== '') {
    if (typeof item.nextAttemptAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.nextAttemptAt) ||
        !Number.isFinite(Date.parse(item.nextAttemptAt)) || new Date(item.nextAttemptAt).toISOString() !== item.nextAttemptAt) throw new TypeError('Invalid outbox retry time');
  }
  if (item.attempts != null && (!Number.isSafeInteger(item.attempts) || item.attempts < 0)) throw new TypeError('Invalid outbox attempts');
  return [eventId, item.status, externalOrderNumber, String(sequence), JSON.stringify(item)];
}

async function insertOutbox(connection, item) {
  const [eventId, status, externalOrderNumber, sequence, payload] = outboxValues(item);
  const position = await allocatePosition(connection, 'platformWebhookEvents');
  await connection.execute('INSERT INTO bobo_outbox_v2 (event_id, status, external_order_number, event_sequence, source_position, payload) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))', [eventId, status, externalOrderNumber, sequence, position, payload]);
}

module.exports = { CREATE_OUTBOX_TABLE, outboxValues, insertOutbox };
