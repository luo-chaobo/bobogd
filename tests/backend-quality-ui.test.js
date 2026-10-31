const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert.ok(source.includes("qualityInspectionWorkOrder"), "后台必须提供质检工单选择");
assert.ok(source.includes("qualityInspectionIssueRoute"), "后台必须按工单提供问题工序选择");
assert.ok(source.includes("autoStartQuality"), "后台质检必须请求自动开启待开始质检节点");
assert.ok(source.includes("submittedQty"), "后台必须提供送检数量");
assert.ok(source.includes("disposition"), "后台必须提供质检处置方式");
assert.ok(!source.includes('id="qualityExceptionProcess"'), "后台不得继续使用全局问题工序下拉");

console.log("backend-quality-ui: ok");
