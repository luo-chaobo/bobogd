const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const tvSource = fs.readFileSync(path.join(root, "public", "tv.js"), "utf8");
const legacyTvSource = fs.readFileSync(path.join(root, "public", "30。1600", "tv.js"), "utf8");

assert.ok(
  serverSource.includes("active.length ? Math.round(((active.length - delayed.length) / active.length) * 100) : 100"),
  "The dashboard on-time rate must only use active work orders"
);
assert.ok(!serverSource.includes("((orders.length - delayed.length) / orders.length)"));
assert.ok(tvSource.includes("在产准时率"));
assert.ok(legacyTvSource.includes("在产准时率"));

console.log("tv-on-time-rate: ok");
