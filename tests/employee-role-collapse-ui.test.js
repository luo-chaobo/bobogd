const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

assert.ok(source.includes("collapsedEmployeeRoles"), "员工工种分组必须维护折叠状态");
assert.ok(source.includes("employeeRoleGroups"), "员工账号必须按工种分组");
assert.ok(source.includes("data-toggle-employee-role"), "每个工种组必须有展开折叠开关");
assert.ok(source.includes("isEmployeeRoleCollapsed"), "工种组默认应为折叠状态");
assert.ok(styles.includes(".employee-role-group"), "员工工种分组必须有独立样式");

console.log("employee-role-collapse-ui: ok");
