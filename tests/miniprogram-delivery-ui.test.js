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
  const template = fs.readFileSync(path.join(root, "pages", "deliveries", "deliveries.wxml"), "utf8");
  const styles = fs.readFileSync(path.join(root, "pages", "deliveries", "deliveries.wxss"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const configExample = fs.readFileSync(path.join(__dirname, "..", "config.example.json"), "utf8");

  assert.ok(app.pages.includes("pages/deliveries/deliveries"));
  assert.ok(app.tabBar.list.some((item) => item.pagePath === "pages/deliveries/deliveries"));
  assert.match(roles, /driver:\s*["']司机["']/);
  assert.match(tab, /pages\/deliveries\/deliveries/);
  assert.match(page, /\/api\/deliveries\/available/);
  assert.match(page, /\/api\/delivery-trips\/start/);
  assert.match(page, /\/api\/deliveries\/complete/);
  assert.match(page, /wx\.chooseMedia/);
  assert.match(page, /退出登录/);
  assert.match(page, /api\.logout\(\)/);
  assert.match(page, /wx\.makePhoneCall/);
  assert.doesNotMatch(page, /navigate\(|wx\.openLocation|navigation-target/);
  assert.doesNotMatch(template, /bindtap="navigate"|>导航</);
  assert.doesNotMatch(server, /resolveDeliveryCoordinates|navigation-target|deliveryCoordinateCache|TENCENT_MAP_KEY/);
  assert.doesNotMatch(configExample, /TENCENT_MAP_KEY/);
  assert.match(template, /class="delivery-heading"/);
  assert.match(template, /class="logout-button" bindtap="logout"/);
  assert.doesNotMatch(template, /class="btn btn-secondary logout-button"/);
  assert.match(template, /class="btn delivery-complete-action"/);
  assert.match(page, /setClipboardData/);
  assert.match(template, /bindtap="logout"/);
  assert.match(template, /bindtap="callCustomer"/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /min-width: 0/);
  assert.match(styles, /\.logout-button[\s\S]*height: 64rpx/);
  assert.match(styles, /\.delivery-complete-action[\s\S]*grid-column: 1 \/ -1/);
});
