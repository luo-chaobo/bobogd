const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const taskSource = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.js"), "utf8");
const taskTemplate = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.wxml"), "utf8");
const taskStyle = fs.readFileSync(path.join(root, "miniprogram", "pages", "tasks", "tasks.wxss"), "utf8");

assert.ok(appSource.includes("attachmentGroupButton"), "后台附件应使用统一的图+数量入口");
assert.ok(appSource.includes("previewFiles"), "附件预览状态应保存整个文件组");
assert.ok(appSource.includes("single-file"), "单附件预览应隐藏系统文件列表");
assert.ok(appSource.includes("pdfNativePreviewUrl"), "桌面后台PDF应追加原生预览隐藏侧栏参数");
assert.ok(appSource.includes("zoom=page-fit") && appSource.includes("view=Fit"), "桌面PDF默认应使用适应页面视图");
assert.ok(appSource.includes("CAD 预览生成失败"), "CAD 预览失败需要明确提示");
assert.ok(taskSource.includes("planRange"), "任务数据应包含计划日期区间");
assert.ok(taskTemplate.includes("{{item.planRange}}"), "任务卡应显示计划日期区间");
assert.ok(taskStyle.includes("task-meta-grid"), "任务状态与计划日期应使用固定信息网格");

console.log("attachment-preview-ui: ok");
