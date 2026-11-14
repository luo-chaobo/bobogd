'use strict';
const { SECTIONS } = require('./state-sql-rehearsal');
const { ROW_METADATA } = require('./row-state-reader');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function identity(section, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Invalid ${section} record`);
  const key = section === 'integrationNonces' ? item.nonce : section === 'platformWebhookEvents' ? item.event?.eventId : item.id;
  if (typeof key !== 'string' || !key.trim()) throw new TypeError(`Missing stable ID in ${section}`);
  return key;
}

function planRowChanges(state) {
  const metadata = state && state[ROW_METADATA];
  if (!(metadata instanceof Map)) throw new TypeError('Row snapshot metadata required');
  const expected = new Set(SECTIONS.map(([section]) => section));
  if (Object.keys(state).length !== expected.size || Object.keys(state).some((key) => !expected.has(key))) throw new Error('Unknown or missing state section');
  const plan = {};
  for (const [section, , kind] of SECTIONS) {
    const original = metadata.get(section);
    const current = state[section];
    if (!Array.isArray(original) || (kind === 'array' ? !Array.isArray(current) : !current || typeof current !== 'object' || Array.isArray(current))) throw new TypeError(`Invalid ${section} section`);
    const previous = new Map();
    for (const row of original) {
      const item = JSON.parse(row.payload);
      const key = kind === 'array' ? identity(section, item) : row.key;
      if (typeof key !== 'string' || previous.has(key)) throw new Error(`Duplicate or invalid original identity in ${section}`);
      previous.set(key, { position: row.position, item });
    }
    const entries = kind === 'array' ? current.map((item) => [identity(section, item), item]) : Object.entries(current);
    const seen = new Set();
    const changes = { inserted: [], updated: [], deleted: [], desired: [], requiresReorder: false };
    let lastPosition = -1;
    let insertedSeen = false;
    for (const [key, item] of entries) {
      if (seen.has(key)) throw new Error(`Duplicate current identity in ${section}`);
      seen.add(key);
      const prior = previous.get(key);
      if (!prior) {
        insertedSeen = true;
        changes.inserted.push({ key, item });
        changes.desired.push({ key, item, existing: false });
        continue;
      }
      if (insertedSeen || prior.position <= lastPosition) changes.requiresReorder = true;
      lastPosition = prior.position;
      changes.desired.push({ key, item, existing: true, position: prior.position, expectedPayload: JSON.stringify(prior.item) });
      if (JSON.stringify(stable(prior.item)) !== JSON.stringify(stable(item))) changes.updated.push({ key, position: prior.position, item, expectedPayload: JSON.stringify(prior.item) });
    }
    for (const [key, prior] of previous) if (!seen.has(key)) changes.deleted.push({ key, position: prior.position, expectedPayload: JSON.stringify(prior.item) });
    plan[section] = changes;
  }
  return plan;
}

module.exports = { planRowChanges };
