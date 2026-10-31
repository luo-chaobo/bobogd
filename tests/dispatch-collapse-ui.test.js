const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.ok(source.includes("collapsedDispatchWorkOrders"), "派工页面必须维护工单折叠状态");
assert.ok(source.includes("work_dispatch_collapsed"), "折叠状态必须保存到 localStorage");
assert.ok(source.includes("data-toggle-dispatch-collapse"), "工单卡片必须渲染折叠开关");
assert.ok(source.includes("toggleDispatchCollapse"), "必须绑定折叠开关事件");
assert.ok(source.includes("dispatch-work-card"), "派工工单卡片必须有独立样式类");
assert.ok(source.includes("dispatch-work-head"), "工单头部必须支持三段布局");
assert.ok(source.includes("dispatch-collapse-toggle"), "折叠按钮必须有独立样式类");
assert.ok(source.includes("dispatch-work-body"), "工序明细和新增工序必须包在可隐藏区域");
assert.ok(source.includes("isDispatchCollapsed(w.id)"), "默认渲染必须按工单折叠状态决定是否显示明细");
assert.ok(source.includes("saved ? JSON.parse(saved) : null"), "首次进入时必须能区分未保存状态");
assert.ok(source.includes("return !savedState ? true"), "未保存折叠状态时默认全部折叠");

assert.ok(styles.includes(".dispatch-work-head"), "CSS 必须定义工单头部三段布局");
assert.ok(styles.includes(".dispatch-collapse-toggle"), "CSS 必须定义小折叠按钮");
assert.ok(styles.includes(".dispatch-work-card.collapsed"), "CSS 必须定义收起卡片状态");
assert.ok(styles.includes("left: 50%"), "折叠按钮必须相对工单卡片水平居中");
assert.ok(styles.includes("transform: translateX(-50%)"), "折叠按钮必须用位移修正自身宽度");

console.log("dispatch-collapse-ui: ok");
