const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { repairWorkOrderCompletion } = require("../lib/work-order-completion-repair");

function parseArgs(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") result.apply = true;
    else if (arg === "--work-no") result.workNo = argv[++index];
    else if (arg === "--operator-id") result.operatorId = argv[++index];
    else throw new Error(`未知参数: ${arg}`);
  }
  if (!result.workNo) throw new Error("必须提供 --work-no");
  if (!result.operatorId) throw new Error("必须提供 --operator-id");
  return result;
}

function backupKey(date) {
  const stamp = date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `main_backup_completion_${stamp}`;
}

function mysqlOptions() {
  const database = String(process.env.MYSQL_DATABASE || "").trim();
  const user = String(process.env.MYSQL_USER || "").trim();
  if (!database || !user) throw new Error("必须配置 MYSQL_DATABASE 和 MYSQL_USER");
  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    charset: "utf8mb4",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connection = await mysql.createConnection(mysqlOptions());
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const stateBackupKey = backupKey(nowDate);
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT value_json FROM app_state WHERE name = ? FOR UPDATE", ["main"]);
    if (!rows.length) throw new Error("app_state.main 不存在");
    const originalJson = typeof rows[0].value_json === "string" ? rows[0].value_json : JSON.stringify(rows[0].value_json);
    const db = JSON.parse(originalJson);
    const result = repairWorkOrderCompletion(db, {
      workNo: args.workNo,
      operatorId: args.operatorId,
      backupKey: stateBackupKey,
      now,
      makeId: (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`,
    });
    if (!args.apply || !result.changed) {
      await connection.rollback();
      console.log(JSON.stringify({ mode: "preview", backupKey: stateBackupKey, ...result }, null, 2));
      return;
    }
    await connection.execute(
      "INSERT INTO app_state (name, value_json, updated_at) VALUES (?, CAST(? AS JSON), NOW())",
      [stateBackupKey, originalJson]
    );
    await connection.execute(
      "UPDATE app_state SET value_json = CAST(? AS JSON), updated_at = NOW() WHERE name = ?",
      [JSON.stringify(db), "main"]
    );
    await connection.commit();
    console.log(JSON.stringify({ mode: "apply", backupKey: stateBackupKey, ...result }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`修复失败: ${error.message}`);
  process.exitCode = 1;
});
