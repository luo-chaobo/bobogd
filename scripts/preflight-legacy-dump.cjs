'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { validateForwardState } = require('../lib/forward-row-migration');
const { verifyUploads } = require('./verify-restored-uploads.cjs');

// This preview accepts the verified mysqldump format with main as the first tuple.
function extractMain(sql) {
  const marker = /^INSERT INTO `app_state` VALUES \('main','/gm;
  const rows = [...sql.matchAll(marker)];
  if (rows.length !== 1 || /NO_BACKSLASH_ESCAPES/i.test(sql.slice(0, rows[0].index))) {
    throw new Error('Unsupported app_state dump format');
  }
  const start = rows[0].index + rows[0][0].length;
  let end = start;
  while (end < sql.length && sql[end] !== "'") {
    end += sql[end] === '\\' ? 2 : 1;
  }
  if (sql[end + 1] !== ',') throw new Error('Invalid main state tuple');
  const escapes = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', "'": "'", '"': '"', '\\': '\\' };
  const payload = sql.slice(start, end).replace(/\\(.)/g, (_, escaped) => {
    if (!Object.hasOwn(escapes, escaped)) throw new Error('Unsupported SQL string escape');
    return escapes[escaped];
  });
  try { return JSON.parse(payload); }
  catch { throw new Error('Invalid main state JSON'); }
}

async function main() {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Provide a local mysqldump .sql.gz file and optionally a restored uploads directory');
  const sql = gunzipSync(fs.readFileSync(process.argv[2]), { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8');
  const state = extractMain(sql);
  validateForwardState(state);
  const counts = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, Object.keys(records).length]));
  const sha256 = createHash('sha256').update(JSON.stringify(state)).digest('hex');
  const uploads = process.argv[3] ? await verifyUploads(state, path.resolve(process.argv[3])) : undefined;
  console.log(JSON.stringify({ counts, sha256, scope: 'app_state.main only', uploads }, null, 2));
  if (uploads?.missing) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { extractMain };
