'use strict';
const { SECTIONS } = require('./state-sql-rehearsal');
const { allocatePosition } = require('./row-sequence');

const CORE = new Set(['orders', 'workOrders', 'routes', 'reports', 'exceptions', 'platformWebhookEvents']);
const RAW = new Map(SECTIONS.filter(([name]) => !CORE.has(name)).map(([name, table, kind]) => [name, { table: `raw_${table}`, kind }]));

function sectionInfo(section, kind) {
  const info = RAW.get(section);
  if (!info || info.kind !== kind) throw new TypeError('Unknown raw section or kind');
  return info;
}

function payload(item) {
  const value = JSON.stringify(item);
  if (value === undefined) throw new TypeError('Invalid raw payload');
  return value;
}

function recordId(item) {
  const id = item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string' ? item.id : null;
  if (id !== null && id.length > 191) throw new TypeError('Raw record ID is too long');
  return id;
}

function objectKey(key) {
  if (typeof key !== 'string' || key.length > 191) throw new TypeError('Invalid raw object key');
  return key;
}

function rowPosition(position) {
  if (!Number.isSafeInteger(position) || position < 0) throw new TypeError('Invalid raw row position');
  return String(position);
}

// All mutations require a caller-owned transaction and business authorization.
async function appendRawArray(connection, section, item) {
  const { table } = sectionInfo(section, 'array');
  const id = recordId(item);
  const data = payload(item);
  const position = await allocatePosition(connection, section);
  await connection.execute(`INSERT INTO \`${table}\` (position, record_key, record_id, payload) VALUES (?, NULL, ?, CAST(? AS JSON))`, [position, id, data]);
  return Number(position);
}

async function updateRawArray(connection, section, position, item) {
  const { table } = sectionInfo(section, 'array');
  const [result] = await connection.execute(
    `UPDATE \`${table}\` SET payload = CAST(? AS JSON) WHERE position = ? AND record_id <=> ?`,
    [payload(item), rowPosition(position), recordId(item)]
  );
  if (result.affectedRows !== 1) throw new Error('Raw row missing or record ID changed');
}

async function deleteRawArray(connection, section, position, expectedId) {
  const { table } = sectionInfo(section, 'array');
  if (expectedId !== null && (typeof expectedId !== 'string' || expectedId.length > 191)) throw new TypeError('Invalid expected record ID');
  const [result] = await connection.execute(`DELETE FROM \`${table}\` WHERE position = ? AND record_id <=> ?`, [rowPosition(position), expectedId]);
  if (result.affectedRows !== 1) throw new Error('Raw row missing or record ID changed');
}

async function insertRawObject(connection, section, key, item) {
  const { table } = sectionInfo(section, 'object');
  const validKey = objectKey(key);
  const data = payload(item);
  const position = await allocatePosition(connection, section);
  await connection.execute(`INSERT INTO \`${table}\` (position, record_key, record_id, payload) VALUES (?, ?, NULL, CAST(? AS JSON))`, [position, validKey, data]);
}

async function updateRawObject(connection, section, key, item) {
  const { table } = sectionInfo(section, 'object');
  const [result] = await connection.execute(`UPDATE \`${table}\` SET payload = CAST(? AS JSON) WHERE record_key = ?`, [payload(item), objectKey(key)]);
  if (result.affectedRows !== 1) throw new Error('Raw object key not found');
}

async function deleteRawObject(connection, section, key) {
  const { table } = sectionInfo(section, 'object');
  const [result] = await connection.execute(`DELETE FROM \`${table}\` WHERE record_key = ?`, [objectKey(key)]);
  if (result.affectedRows !== 1) throw new Error('Raw object key not found');
}

module.exports = { appendRawArray, updateRawArray, deleteRawArray, insertRawObject, updateRawObject, deleteRawObject };
