"use strict";

const SECTIONS = Object.freeze([
  ["users", "users", "array"],
  ["orders", "orders", "array"],
  ["routes", "routes", "array"],
  ["reports", "reports", "array"],
  ["drawings", "drawings", "array"],
  ["auditLogs", "audit_logs", "array"],
  ["customers", "customers", "array"],
  ["processes", "processes", "array"],
  ["deliveries", "deliveries", "array"],
  ["exceptions", "exceptions", "array"],
  ["workOrders", "work_orders", "array"],
  ["attachments", "attachments", "array"],
  ["deletedUsers", "deleted_users", "array"],
  ["deliveryTrips", "delivery_trips", "array"],
  ["customerFeedbacks", "customer_feedbacks", "array"],
  ["integrationNonces", "integration_nonces", "array"],
  ["platformWebhookEvents", "platform_webhook_events", "array"],
  ["settings", "settings", "object"],
  ["orderFinancialAccessUserIds", "order_financial_access_user_ids", "object"]
]);

function databaseName(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error("database identifier must contain only lowercase letters, digits, and underscores");
  }
  return `\`${name}\``;
}

function buildStateSplitSql(sourceName, targetName) {
  const source = databaseName(sourceName);
  const target = databaseName(targetName);
  if (sourceName === targetName) throw new Error("source and target must be separate databases");
  const statements = [`CREATE DATABASE ${target} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`];
  const expectedKeys = JSON.stringify(SECTIONS.map(section => section[0]));
  const expectedTypes = SECTIONS.map(([name, , kind]) =>
    `JSON_TYPE(JSON_EXTRACT(s.value_json, '$.${name}')) = '${kind.toUpperCase()}'`
  ).join(" AND ");
  statements.push(`CREATE TABLE ${target}.migration_source_check (
  id TINYINT NOT NULL PRIMARY KEY,
  mapping_matches TINYINT NOT NULL,
  CONSTRAINT source_mapping_matches CHECK (mapping_matches = 1)
) ENGINE=InnoDB;`);
  statements.push(`INSERT INTO ${target}.migration_source_check (id, mapping_matches)
SELECT 1, COALESCE((SELECT IF(
  JSON_LENGTH(JSON_KEYS(s.value_json)) = ${SECTIONS.length}
  AND JSON_CONTAINS(JSON_KEYS(s.value_json), CAST('${expectedKeys}' AS JSON)) = 1
  AND ${expectedTypes}, 1, 0)
  FROM ${source}.app_state AS s WHERE s.name = 'main'), 0);`);
  for (const [section, table, kind] of SECTIONS) {
    statements.push(`CREATE TABLE ${target}.\`${table}\` (
  position BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  record_key VARCHAR(191) NULL,
  record_id VARCHAR(191) NULL,
  payload JSON NOT NULL,
  UNIQUE KEY record_key_unique (record_key),
  KEY record_id_lookup (record_id)
) ENGINE=InnoDB;`);
    if (kind === "array") {
      statements.push(`INSERT INTO ${target}.\`${table}\` (position, record_key, record_id, payload)
SELECT j.row_ordinal - 1, NULL, JSON_UNQUOTE(JSON_EXTRACT(j.item, '$.id')), j.item
FROM ${source}.app_state AS s
JOIN JSON_TABLE(s.value_json, '$.${section}[*]' COLUMNS (row_ordinal FOR ORDINALITY, item JSON PATH '$')) AS j
WHERE s.name = 'main';`);
    } else {
      statements.push(`INSERT INTO ${target}.\`${table}\` (position, record_key, record_id, payload)
SELECT j.row_ordinal - 1, j.object_key, NULL,
  JSON_EXTRACT(s.value_json, CONCAT('$.${section}.', JSON_QUOTE(j.object_key)))
FROM ${source}.app_state AS s
JOIN JSON_TABLE(JSON_KEYS(JSON_EXTRACT(s.value_json, '$.${section}')), '$[*]'
  COLUMNS (row_ordinal FOR ORDINALITY, object_key VARCHAR(191) PATH '$')) AS j
WHERE s.name = 'main';`);
    }
  }
  return `${statements.join("\n\n")}\n`;
}

function buildSectionReconciliationSql(sourceName, targetName, sectionName) {
  const source = databaseName(sourceName);
  const target = databaseName(targetName);
  const section = SECTIONS.find(item => item[0] === sectionName);
  if (!section) throw new Error("unknown section");
  const [name, table, kind] = section;
  const jsonPath = `$.${name}`;
  const sourceRows = kind === "array"
    ? `JOIN JSON_TABLE(s.value_json, '${jsonPath}[*]' COLUMNS (row_ordinal FOR ORDINALITY, item JSON PATH '$')) AS j`
    : `JOIN JSON_TABLE(JSON_KEYS(JSON_EXTRACT(s.value_json, '${jsonPath}')), '$[*]'
  COLUMNS (row_ordinal FOR ORDINALITY, object_key VARCHAR(191) PATH '$')) AS j`;
  const expectedPayload = kind === "array" ? "j.item" : `JSON_EXTRACT(s.value_json, CONCAT('${jsonPath}.', JSON_QUOTE(j.object_key)))`;
  const extraCheck = kind === "array"
    ? "OR NOT (t.record_id <=> JSON_UNQUOTE(JSON_EXTRACT(j.item, '$.id')))"
    : "OR NOT (t.record_key <=> j.object_key)";
  return `SELECT '${name}' AS section_name,
  (SELECT JSON_LENGTH(value_json, '${jsonPath}') FROM ${source}.app_state WHERE name='main') AS source_count,
  (SELECT COUNT(*) FROM ${target}.\`${table}\`) AS target_count,
  (SELECT COUNT(*) FROM ${source}.app_state AS s
   ${sourceRows}
   LEFT JOIN ${target}.\`${table}\` AS t ON t.position = j.row_ordinal - 1
   WHERE s.name='main' AND (t.position IS NULL OR NOT (t.payload <=> ${expectedPayload}) ${extraCheck})) AS mismatched_rows;`;
}

module.exports = { buildStateSplitSql, buildSectionReconciliationSql, SECTIONS };
