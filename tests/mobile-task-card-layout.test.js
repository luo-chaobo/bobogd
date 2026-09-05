const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.wxml"), "utf8");
const style = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.wxss"), "utf8");

assert.ok(template.includes('class="task-name"'), "产品与工序名称必须使用独立标题区");
assert.ok(template.includes('class="task-meta-grid"'), "工单、排期、图纸和状态必须使用固定信息网格");
assert.ok(template.includes('class="drawing-preview-placeholder"'), "无图纸任务必须保留图纸栏占位");
assert.ok(style.includes("-webkit-line-clamp: 2"), "长产品名必须最多显示两行");
assert.ok(style.includes("grid-template-columns: minmax(0, 1fr) 156rpx 36rpx 104rpx"), "任务信息栏必须使用稳定列宽");
assert.ok(style.includes("white-space: nowrap"), "排期和状态必须禁止换行");
assert.ok(style.includes(".task-state"), "状态徽标必须有独立固定布局样式");
assert.ok(style.includes("width: 104rpx"), "状态栏必须保持固定宽度");

console.log("mobile-task-card-layout: ok");
