const assert = require("assert");
const fs = require("fs");
const path = require("path");

const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

assert.ok(styles.includes(".repeat-confirm-backdrop"), "确认层必须有独立样式");
assert.ok(styles.includes("place-items: center"), "确认框必须在可视区域水平垂直居中");
assert.ok(styles.includes(".history-order-readonly .history-order-fields"), "只读内容必须有独立灰态规则");
assert.ok(styles.includes("user-select: none"), "只读内容必须禁止鼠标选中文字");
assert.ok(styles.includes("pointer-events: none"), "只读控件必须禁止鼠标聚焦");
assert.ok(styles.includes("width: min(860px, 100%)"), "详情弹框必须使用紧凑宽度");
assert.ok(styles.includes("max-height: calc(100dvh - 32px)"), "详情弹框必须限制在当前可视区域内");

console.log("repeat-order-compact-style: ok");
