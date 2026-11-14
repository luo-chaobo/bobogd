'use strict';

const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const { readLegacyState, restoreEmptyLegacyMysql } = require('../lib/legacy-reconstruction');

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string' },
    target: { type: 'string' },
    'server-uuid': { type: 'string' },
    'apply-sha256': { type: 'string' }
  } });
  const { source, target, 'server-uuid': uuid, 'apply-sha256': applyHash } = values;
  const { MYSQL_HOST: host, MYSQL_PORT: portText, MYSQL_SOCKET: socketPath, MYSQL_USER: user, MYSQL_PASSWORD: password } = process.env;
  const port = Number(portText);
  const validTransport = socketPath
    ? process.platform === 'win32' && socketPath.startsWith('\\\\.\\pipe\\') && /^[a-z0-9_-]+$/i.test(socketPath.slice(9)) && !host && !portText
    : Boolean(host && /^\d+$/.test(portText ?? '') && Number.isInteger(port) && port >= 1 && port <= 65535);
  const schemaName = /^[a-z][a-z0-9_]{0,63}$/;
  if (!schemaName.test(source ?? '') || !schemaName.test(target ?? '') || source === target ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid ?? '') ||
      (applyHash !== undefined && !/^[a-f0-9]{64}$/.test(applyHash)) ||
      !validTransport || !user || password === undefined) {
    throw new Error('Provide distinct --source and --target, --server-uuid and explicit MYSQL connection settings');
  }

  const { createPool } = require('mysql2/promise');
  const transport = socketPath ? { socketPath } : { host, port };
  const config = { ...transport, user, password, connectionLimit: 1 };
  const sourcePool = createPool({ ...config, database: source });
  const targetPool = createPool({ ...config, database: target });
  try {
    for (const [pool, database] of [[sourcePool, source], [targetPool, target]]) {
      const [[identity]] = await pool.query('SELECT @@server_uuid AS uuid, DATABASE() AS database_name');
      if (identity.uuid.toLowerCase() !== uuid.toLowerCase() || identity.database_name !== database) {
        throw new Error('Database identity mismatch');
      }
    }
    const [[targetState]] = await targetPool.query(`SELECT
      EXISTS(SELECT 1 FROM bobo_schema_migrations WHERE name = 'audit_logs_out_of_app_state_v1') AS ready,
      EXISTS(SELECT 1 FROM app_state) AS has_state,
      EXISTS(SELECT 1 FROM bobo_audit_logs_v2) AS has_audit`);
    if (targetState.ready !== 1 || targetState.has_state || targetState.has_audit) {
      throw new Error('Legacy target must be initialized and empty');
    }

    const snapshot = await readLegacyState(sourcePool, { requireIdleOutbox: true });
    const sha256 = createHash('sha256')
      .update(JSON.stringify([uuid.toLowerCase(), source, target, snapshot])).digest('hex');
    if (applyHash !== undefined && applyHash !== sha256) throw new Error('Source changed or preview fingerprint does not match');
    const counts = Object.fromEntries(Object.entries(snapshot).map(([name, records]) => [name, Object.keys(records).length]));
    if (applyHash !== undefined) await restoreEmptyLegacyMysql(targetPool, snapshot);
    console.log(JSON.stringify({ applied: applyHash !== undefined, sha256, counts }, null, 2));
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
