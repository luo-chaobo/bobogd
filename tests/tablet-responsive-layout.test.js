const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const activity = fs.readFileSync(path.join(root, "tv-apk", "tablet", "src", "main", "java", "com", "bobogd", "tablet", "MainActivity.java"), "utf8");
const manifest = fs.readFileSync(path.join(root, "tv-apk", "tablet", "src", "main", "AndroidManifest.xml"), "utf8");

assert.ok(activity.includes("GeckoSessionSettings.VIEWPORT_MODE_DESKTOP"), "APK必须使用桌面视口，避免触发服务器的全屏移动导航");
assert.match(manifest, /android:screenOrientation="landscape"/, "手机和平板APP必须强制横屏");
assert.ok(activity.includes("FLAG_KEEP_SCREEN_ON"), "看板APP必须保持屏幕常亮");

console.log("tablet-responsive-layout: ok");
