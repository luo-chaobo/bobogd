'use strict';
const crypto = require('node:crypto');
const { withTransaction } = require('./production-store');

function mysqlTime(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Invalid outbox time');
  return new Date(timestamp).toISOString().slice(0, 23).replace('T', ' ');
}

async function lockState(connection) {
  const [rows] = await connection.execute('SELECT id FROM bobo_state_write_lock WHERE id = 1 FOR UPDATE');
  if (rows.length !== 1) throw new Error('Missing state write lock');
}

async function processOneOutbox(pool, send, now = Date.now) {
  if (typeof send !== 'function' || typeof now !== 'function') throw new TypeError('Outbox sender and clock required');
  const claimTime = now();
  const token = crypto.randomUUID();
  const claimed = await withTransaction(pool, async (connection) => {
    await lockState(connection);
    const [rows] = await connection.execute(`SELECT t.event_id, t.status, t.external_order_number, t.event_sequence, CAST(t.payload AS CHAR CHARACTER SET utf8mb4) AS payload_json
      FROM bobo_outbox_v2 t
      WHERE t.status = 'pending'
        AND (t.lease_until IS NULL OR t.lease_until <= ?)
        AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.payload, '$.nextAttemptAt')), '') = ''
          OR JSON_UNQUOTE(JSON_EXTRACT(t.payload, '$.nextAttemptAt')) <= ?)
        AND NOT EXISTS (SELECT 1 FROM bobo_outbox_v2 prior WHERE prior.external_order_number = t.external_order_number AND prior.event_sequence < t.event_sequence AND prior.status <> 'delivered')
      ORDER BY t.source_position LIMIT 1 FOR UPDATE`, [mysqlTime(claimTime), new Date(claimTime).toISOString()]);
    if (!rows.length) return null;
    const item = JSON.parse(rows[0].payload_json);
    if (!item.event || item.event.eventId !== rows[0].event_id || item.status !== rows[0].status ||
        item.event.externalOrderNumber !== rows[0].external_order_number || Number(item.event.sequence) !== Number(rows[0].event_sequence)) throw new Error('Invalid stored outbox event');
    await connection.execute('UPDATE bobo_outbox_v2 SET lease_token = ?, lease_until = ? WHERE event_id = ?', [token, mysqlTime(claimTime + 60000), rows[0].event_id]);
    return { id: rows[0].event_id, event: item.event, eventJson: JSON.stringify(item.event) };
  });
  if (!claimed) return { claimed: false };
  let failed = false;
  let failure;
  try { await send(claimed.event); } catch (error) { failed = true; failure = error; }
  return withTransaction(pool, async (connection) => {
    await lockState(connection);
    const [rows] = await connection.execute('SELECT lease_token, CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload_json FROM bobo_outbox_v2 WHERE event_id = ? FOR UPDATE', [claimed.id]);
    if (rows.length !== 1 || rows[0].lease_token !== token) return { claimed: true, lostLease: true };
    const item = JSON.parse(rows[0].payload_json);
    if (!item.event || item.event.eventId !== claimed.id) throw new Error('Invalid stored outbox event');
    if (item.status === 'delivered' || JSON.stringify(item.event) !== claimed.eventJson) {
      const [released] = await connection.execute('UPDATE bobo_outbox_v2 SET lease_token = NULL, lease_until = NULL WHERE event_id = ? AND lease_token = ?', [claimed.id, token]);
      if (released.affectedRows !== 1) throw new Error('Outbox lease changed during release');
      return { claimed: true, alreadyDelivered: item.status === 'delivered', eventChanged: JSON.stringify(item.event) !== claimed.eventJson };
    }
    if (item.status !== 'pending') throw new Error('Invalid stored outbox status');
    if (failed) {
      const attempts = Number(item.attempts || 0);
      if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid outbox attempts');
      item.status = 'pending';
      item.attempts = attempts + 1;
      item.lastError = String(failure?.message ?? failure ?? 'delivery failed').slice(0, 512);
      item.nextAttemptAt = new Date(now() + Math.min(60000, 1000 * 2 ** Math.min(item.attempts, 6))).toISOString();
    } else {
      item.status = 'delivered';
      item.lastError = '';
      item.nextAttemptAt = '';
    }
    const [updated] = await connection.execute('UPDATE bobo_outbox_v2 SET status = ?, payload = CAST(? AS JSON), lease_token = NULL, lease_until = NULL WHERE event_id = ? AND lease_token = ?', [item.status, JSON.stringify(item), claimed.id, token]);
    if (updated.affectedRows !== 1) throw new Error('Outbox lease changed during update');
    return { claimed: true, delivered: !failed };
  });
}

module.exports = { processOneOutbox };
