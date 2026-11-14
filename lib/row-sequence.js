'use strict';
const { SECTIONS } = require('./state-sql-rehearsal');
const sectionNames = new Set(SECTIONS.map(([name]) => name));

const CREATE_SEQUENCES_TABLE = `CREATE TABLE IF NOT EXISTS bobo_section_sequences (
  section VARCHAR(80) NOT NULL PRIMARY KEY,
  next_position BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;

async function initializeSequence(connection, section, nextPosition) {
  if (!sectionNames.has(section) || !Number.isSafeInteger(nextPosition) || nextPosition < 0) throw new TypeError('Invalid section sequence');
  await connection.execute('INSERT INTO bobo_section_sequences (section, next_position) VALUES (?, ?)', [section, String(nextPosition)]);
}

// Must be called inside the transaction that writes the corresponding row.
async function allocatePosition(connection, section) {
  if (!sectionNames.has(section)) throw new TypeError('Unknown section');
  const [rows] = await connection.execute('SELECT next_position FROM bobo_section_sequences WHERE section = ? FOR UPDATE', [section]);
  if (rows.length !== 1) throw new Error('Missing section sequence');
  const position = Number(rows[0].next_position);
  if (!Number.isSafeInteger(position) || position < 0 || position >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid section sequence value');
  await connection.execute('UPDATE bobo_section_sequences SET next_position = ? WHERE section = ?', [String(position + 1), section]);
  return String(position);
}

module.exports = { CREATE_SEQUENCES_TABLE, initializeSequence, allocatePosition };
