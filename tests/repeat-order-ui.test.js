const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert.ok(source.includes('data-history-order="${item.id}"'), "历史工单号必须是详情链接");
assert.ok(source.includes("historyOrderModal"), "历史页必须渲染订单详情弹框");
assert.ok(source.includes("readonly"), "详情字段默认必须只读");
assert.ok(source.includes("data-action=\"enableRepeatOrder\""), "已完成订单必须提供返单按钮");
assert.ok(source.includes("确认基于该工单创建返单"), "进入返单模式前必须二次确认");
assert.ok(source.includes('/api/orders/repeat'), "返单保存必须调用独立创建接口");
assert.ok(source.includes("route.routeType !== \"rework\""), "详情工序必须排除返工路线");
assert.ok(source.includes("repeatOrderConfirmOpen"), "返单确认框必须使用独立前端状态");
assert.ok(source.includes("repeat-confirm-backdrop"), "返单必须使用应用内居中确认层");
assert.ok(source.includes('data-action="confirmRepeatOrder"'), "确认按钮必须明确进入返单模式");
assert.ok(source.includes('data-action="cancelRepeatOrder"'), "取消按钮必须返回只读详情");
assert.ok(!source.includes('if (confirm("确认基于该工单创建返单'), "返单不得继续使用浏览器原生确认框");
assert.ok(source.includes("history-order-readonly"), "详情弹框必须提供明确的只读状态类");
assert.ok(source.includes("history-order-fields"), "详情字段必须能与附件操作隔离");

console.log("repeat-order-ui: ok");
