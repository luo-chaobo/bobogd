const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "miniprogram");

test("司机角色和配送页已接入小程序", () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const roles = fs.readFileSync(path.join(root, "utils", "roles.js"), "utf8");
  const tab = fs.readFileSync(path.join(root, "custom-tab-bar", "index.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "pages", "deliveries", "deliveries.js"), "utf8");

  assert.ok(app.pages.includes("pages/deliveries/deliveries"));
  assert.ok(app.tabBar.list.some((item) => item.pagePath === "pages/deliveries/deliveries"));
  assert.match(roles, /driver:\s*["']司机["']/);
  assert.match(tab, /pages\/deliveries\/deliveries/);
  assert.match(page, /\/api\/deliveries\/available/);
  assert.match(page, /\/api\/delivery-trips\/start/);
  assert.match(page, /\/api\/deliveries\/complete/);
  assert.match(page, /wx\.chooseMedia/);
});
