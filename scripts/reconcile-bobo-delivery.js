const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { applyBoboStatusRepairs, findBoboStatusRepairs } = require("../src/bobo-reconciliation");

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
if (dbIndex < 0 || !args[dbIndex + 1]) {
  process.stderr.write("用法：node scripts/reconcile-bobo-delivery.js --db <数据库路径> [--apply]\n");
  process.exitCode = 2;
} else {
  const db = new DatabaseSync(path.resolve(args[dbIndex + 1]));
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const repairs = findBoboStatusRepairs(db);
    const applied = args.includes("--apply") ? applyBoboStatusRepairs(db) : 0;
    process.stdout.write(`${JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", count: repairs.length, applied, repairs }, null, 2)}\n`);
  } finally {
    db.close();
  }
}
