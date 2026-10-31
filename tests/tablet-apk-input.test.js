const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = fs.readFileSync(path.join(root, "tv-apk", "tablet", "src", "main", "AndroidManifest.xml"), "utf8");
const styles = fs.readFileSync(path.join(root, "tv-apk", "tablet", "src", "main", "res", "values", "styles.xml"), "utf8");
const activity = fs.readFileSync(path.join(root, "tv-apk", "tablet", "src", "main", "java", "com", "bobogd", "tablet", "MainActivity.java"), "utf8");

assert.match(
  manifest,
  /android:windowSoftInputMode="stateUnspecified\|adjustResize"/,
  "平板Activity必须让软键盘缩放网页窗口"
);
assert.ok(
  !styles.includes('<item name="android:windowFullscreen">true</item>'),
  "窗口主题不能使用会阻止adjustResize的强制全屏标志"
);
assert.ok(
  activity.includes("WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE"),
  "Activity必须显式启用软键盘窗口缩放"
);
assert.ok(
  activity.includes("setContentDelegate(new GeckoSession.ContentDelegate()"),
  "GeckoSession必须安装内容代理以支持输入焦点切换"
);
assert.ok(
  activity.includes("geckoView.setFocusableInTouchMode(true)"),
  "GeckoView必须允许触摸切换输入焦点"
);

console.log("tablet-apk-input: ok");
