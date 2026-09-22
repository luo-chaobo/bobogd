const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("renders the centered branded login over the approved factory background", () => {
  const publicDir = path.join(__dirname, "..", "public");
  const page = fs.readFileSync(path.join(publicDir, "admin.html"), "utf8");
  const styles = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const image = path.join(publicDir, "assets", "images", "sales-engineer-phone-support.png");

  assert.match(page, /class="admin-login-logo"[^>]*alt="未来机械 WL 标志"/);
  assert.match(styles, /sales-engineer-phone-support\.png/);
  assert.match(styles, /\.admin-login-logo\s*\{[^}]*display:\s*block;[^}]*margin:\s*0 auto(?:\s+\d+px)?;/);
  assert.match(styles, /@media \(max-width:\s*700px\)/);
  assert.ok(fs.statSync(image).size > 100_000);
});
