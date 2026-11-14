'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');

function collectReferences(snapshot) {
  const paths = new Set();
  let references = 0;
  const pending = [snapshot];
  while (pending.length) {
    const value = pending.pop();
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) pending.push(child);
      continue;
    }
    if (typeof value !== 'string') continue;
    const match = /^(?:https?:\/\/[^/?#]+)?\/uploads\/([^?#]+)(?:[?#].*)?$/i.exec(value);
    if (!match) continue;
    let relative;
    try { relative = decodeURIComponent(match[1]); }
    catch { throw new Error('Malformed attachment URL'); }
    if (/[\\:\x00-\x1f]/.test(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe attachment path');
    }
    paths.add(relative);
    references++;
  }
  return { paths, references };
}

async function hashFile(filename) {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

async function verifyUploads(snapshot, uploads) {
  if (!fs.lstatSync(uploads).isDirectory()) throw new Error('Uploads root must be a regular directory');
  const { paths, references } = collectReferences(snapshot);
  const files = new Map();
  for (const entry of fs.readdirSync(uploads, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) throw new Error('Unexpected linked or special entry in uploads');
    const filename = path.join(entry.parentPath, entry.name);
    files.set(path.relative(uploads, filename).split(path.sep).join('/'), filename);
  }
  const missing = [...paths].filter((name) => !files.has(name)).length;
  const digest = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    digest.update(JSON.stringify([name, await hashFile(files.get(name))]) + '\n');
  }
  return { references, uniqueReferences: paths.size, files: files.size, missing,
    unreferenced: files.size - paths.size + missing, uploadsSha256: digest.digest('hex') };
}

async function main() {
  const { values } = parseArgs({ options: {
    'snapshot-json': { type: 'string' },
    'reference-index': { type: 'string' },
    uploads: { type: 'string' },
    'expect-sha256': { type: 'string' }
  } });
  if (Boolean(values['snapshot-json']) === Boolean(values['reference-index']) || !values.uploads ||
      (values['expect-sha256'] !== undefined && !/^[0-9a-f]{64}$/.test(values['expect-sha256']))) {
    throw new Error('Provide --snapshot-json or --reference-index, --uploads and optionally --expect-sha256');
  }
  const input = fs.readFileSync(values['snapshot-json'] || values['reference-index'], 'utf8').replace(/^\uFEFF/, '');
  let snapshot;
  try { snapshot = JSON.parse(input); }
  catch { throw new Error('Invalid snapshot JSON'); }
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot must be a JSON object or array');
  if (values['reference-index']) {
    if (!Array.isArray(snapshot)) throw new Error('Reference index must be an array');
    snapshot = snapshot.map((entry) => {
      if (typeof entry?.path !== 'string' || !entry.path) throw new Error('Invalid indexed attachment path');
      const relative = entry.path.replace(/^\/?uploads\//, '');
      return '/uploads/' + relative.split('/').map(encodeURIComponent).join('/');
    });
  }
  const report = await verifyUploads(snapshot, path.resolve(values.uploads));
  console.log(JSON.stringify(report, null, 2));
  if (report.missing || (values['expect-sha256'] && report.uploadsSha256 !== values['expect-sha256'])) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});

module.exports = { collectReferences, verifyUploads };
