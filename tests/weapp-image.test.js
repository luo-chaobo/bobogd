const assert = require("assert");
const { weappImageType } = require("../lib/weapp-image");

assert.strictEqual(weappImageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
assert.strictEqual(weappImageType(Buffer.from([255, 216, 255, 224, 0, 16])), "image/jpeg");
assert.strictEqual(weappImageType(Buffer.from("GIF89a", "ascii")), "image/gif");
assert.strictEqual(weappImageType(Buffer.from("not an image")), "");

console.log("weapp image format test passed");
