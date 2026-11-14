'use strict';

const INDEXES = [
  { table: 'bobo_routes_v2', name: 'idx_route_work_order_position' },
  { table: 'bobo_reports_v2', name: 'idx_report_work_order_position' }
];
const REPORT_DATE_INDEX = { table: 'bobo_reports_v2', name: 'idx_report_created_at' };

// MySQL DDL commits implicitly; callers must stop writes and retain a backup.
async function ensureIndexes(connection, indexes, expectedColumns) {
  const result = { created: 0, existing: 0 };
  const missing = [];
  for (const index of indexes) {
    const [rows] = await connection.query(`SHOW INDEX FROM \`${index.table}\` WHERE Key_name = '${index.name}'`);
    if (rows.length) {
      const columns = [...rows].sort((a, b) => a.Seq_in_index - b.Seq_in_index);
      if (columns.length !== expectedColumns.length || columns.some((row, i) => row.Seq_in_index !== i + 1 || row.Column_name !== expectedColumns[i] || Number(row.Non_unique) !== 1 || row.Sub_part !== null)) {
        throw new Error(`Unexpected index definition: ${index.name}`);
      }
      result.existing++;
      continue;
    }
    missing.push(index);
  }
  for (const index of missing) {
    await connection.query(`ALTER TABLE \`${index.table}\` ADD INDEX \`${index.name}\` (${expectedColumns.join(', ')})`);
    result.created++;
  }
  return result;
}

function ensureWorkOrderIndexes(connection) {
  return ensureIndexes(connection, INDEXES, ['work_order_id', 'source_position']);
}

function ensureReportDateIndex(connection) {
  return ensureIndexes(connection, [REPORT_DATE_INDEX], ['created_at']);
}

module.exports = { ensureWorkOrderIndexes, ensureReportDateIndex };
