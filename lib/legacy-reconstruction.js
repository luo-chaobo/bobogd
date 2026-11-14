'use strict';
const { SECTIONS } = require('./state-sql-rehearsal');
const { readRowState, withConsistentRowRead } = require('./row-state-reader');
const { withTransaction } = require('./production-store');
const { insertAudit } = require('./audit-store');
const { isDeepStrictEqual } = require('node:util');

function buildLegacyState(state, auditLogs) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Invalid state');
  const expected = new Set(SECTIONS.map(([name]) => name));
  const keys = Object.keys(state);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) throw new Error('Unknown or missing state section');
  for (const [name, , kind] of SECTIONS) {
    const value = state[name];
    if (kind === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`Invalid state section: ${name}`);
    }
  }
  if (!Array.isArray(auditLogs)) throw new TypeError('Invalid audit logs');
  const ids = new Set();
  for (const item of auditLogs) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error('Invalid or duplicate audit ID');
    ids.add(item.id);
  }
  return JSON.parse(JSON.stringify({ ...state, auditLogs }));
}

function readLegacyState(pool, { requireIdleOutbox = false } = {}) {
  return withConsistentRowRead(pool, async (connection) => {
    if (requireIdleOutbox) {
      const [leases] = await connection.query('SELECT event_id FROM bobo_outbox_v2 WHERE lease_token IS NOT NULL OR lease_until IS NOT NULL LIMIT 1');
      if (leases.length) throw new Error('An outbox event has an unresolved lease');
    }
    const state = await readRowState(connection, { auditBuffer: true, trackChanges: false });
    const [rows] = await connection.query(
      'SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload_json FROM bobo_audit_logs_v2 ORDER BY created_at, id'
    );
    return buildLegacyState(state, rows.map((row) => JSON.parse(row.payload_json)));
  });
}

async function restoreEmptyLegacyMysql(pool, snapshot) {
  const { auditLogs, ...state } = buildLegacyState(snapshot, snapshot.auditLogs);
  return withTransaction(pool, async (connection) => {
    const [marker] = await connection.query("SELECT name FROM bobo_schema_migrations WHERE name = 'audit_logs_out_of_app_state_v1' FOR UPDATE");
    if (marker.length !== 1) throw new Error('Legacy audit migration marker missing');
    const [states] = await connection.query('SELECT name FROM app_state LIMIT 1');
    const [audits] = await connection.query('SELECT id FROM bobo_audit_logs_v2 LIMIT 1');
    if (states.length || audits.length) throw new Error('Legacy restore target is not empty');
    await connection.execute("INSERT INTO app_state (name, value_json, updated_at) VALUES ('main', CAST(? AS JSON), NOW())", [JSON.stringify(state)]);
    for (const audit of auditLogs) await insertAudit(connection, audit);
    const [[restored]] = await connection.query("SELECT CAST(value_json AS CHAR CHARACTER SET utf8mb4) AS payload FROM app_state WHERE name = 'main'");
    const [restoredAudits] = await connection.query('SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM bobo_audit_logs_v2');
    const expectedAudits = new Map(auditLogs.map((audit) => [audit.id, audit]));
    const actualAudits = new Map(restoredAudits.map(({ payload }) => {
      const audit = JSON.parse(payload);
      return [audit.id, audit];
    }));
    if (!isDeepStrictEqual(JSON.parse(restored.payload), state) || !isDeepStrictEqual(actualAudits, expectedAudits)) {
      throw new Error('Legacy restore reconciliation failed');
    }
    return { orders: state.orders.length, reports: state.reports.length, auditLogs: auditLogs.length, events: state.platformWebhookEvents.length };
  });
}

module.exports = { buildLegacyState, readLegacyState, restoreEmptyLegacyMysql };
