const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");

assert.ok(source.includes('<span>重量（KG）</span><input id="weightKg" type="number"'), "新建订单必须提供重量输入框");
assert.ok(source.includes('step="1"'), "重量输入必须按整数 KG 填写");
assert.ok(source.includes('<span>重量（KG）</span><input id="editWeightKg" type="number"'), "编辑订单必须允许修改重量");
assert.ok(source.includes('weightKg: el("weightKg").value.trim()'), "新建订单必须提交重量");
assert.ok(source.includes('weightKg: el("editWeightKg").value.trim()'), "编辑订单必须提交重量");

console.log("order-weight-ui: ok");
