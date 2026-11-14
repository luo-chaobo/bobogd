'use strict';

const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const { readForwardSnapshot, writeForwardSnapshot } = require('../lib/forward-row-migration');

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' },
    target: { type: 'string' },
    'server-uuid': { type: 'string' },
    'apply-sha256': { type: 'string' },
    'audit-cutoff': { type: 'string' }
  } });
  const { source, target, 'server-uuid': uuid, 'apply-sha256': applyHash, 'audit-cutoff': cutoffText } = values;
  const { MYSQL_HOST: host, MYSQL_PORT: portText, MYSQL_SOCKET: socketPath, MYSQL_USER: user, MYSQL_PASSWORD: password } = process.env;
  const port = Number(portText);
  const validTransport = socketPath
    ? process.platform === 'win32' && socketPath.startsWith('\\\\.\\pipe\\') && /^[a-z0-9_-]+$/i.test(socketPath.slice(9)) && !host && !portText
    : Boolean(host && /^\d+$/.test(portText ?? '') && Number.isInteger(port) && port >= 1 && port <= 65535);
  const cutoff = Date.parse(cutoffText);
  const schemaName = /^[a-z][a-z0-9_]{0,63}$/;
  if (!Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== cutoffText || !schemaName.test(source ?? '') || !schemaName.test(target ?? '') || source === target ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid ?? '') ||
      (applyHash !== undefined && !/^[a-f0-9]{64}$/.test(applyHash)) ||
      !validTransport || !user || password === undefined) {
    throw new Error('Provide distinct --source and --target, --server-uuid, --audit-cutoff (UTC ISO with milliseconds), and explicit MYSQL connection settings');
  }

  const { createPool } = require('mysql2/promise');
  const transport = socketPath ? { socketPath } : { host, port };
  const config = { ...transport, user, password, dateStrings: true, connectionLimit: 1 };
  const sourcePool = createPool({ ...config, database: source });
  const targetPool = createPool({ ...config, database: target });
  try {
    for (const [pool, database] of [[sourcePool, source], [targetPool, target]]) {
      const [[identity]] = await pool.query('SELECT @@server_uuid AS uuid, DATABASE() AS database_name');
      if (identity.uuid.toLowerCase() !== uuid.toLowerCase() || identity.database_name !== database) {
        throw new Error('Database identity mismatch');
      }
    }
    const [[targetState]] = await targetPool.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()');
    if (Number(targetState.count) !== 0) throw new Error('Row target database must be empty');
    const snapshot = await readForwardSnapshot(sourcePool);
    const sha256 = createHash('sha256')
      .update(JSON.stringify([uuid.toLowerCase(), source, target, cutoffText, snapshot])).digest('hex');
    if (applyHash !== undefined && applyHash !== sha256) throw new Error('Source changed or preview fingerprint does not match');
    const counts = Object.fromEntries(Object.entries(snapshot.state).map(([name, records]) => [name, Object.keys(records).length]));
    if (applyHash !== undefined) await writeForwardSnapshot(targetPool, snapshot, cutoff);
    console.log(JSON.stringify({ applied: applyHash !== undefined, sha256, counts, legacyAuditArchived: snapshot.legacyAudit.length }, null, 2));
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
