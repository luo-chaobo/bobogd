const assert = require("assert");
const clientMode = require("../public/client-mode.js");

function run() {
  assert.deepStrictEqual(
    clientMode.interactiveBoardNavigation("token value", false, "?tabletApp=1"),
    {
      url: "/tv.html?mobile=1&viewerToken=token+value&tabletApp=1",
      target: "self",
    },
    "平板APP必须在当前页面打开手机横屏看板并保留客户端标记"
  );

  assert.deepStrictEqual(
    clientMode.interactiveBoardNavigation("token value", true, ""),
    {
      url: "/tv.html?mobile=1&dispatch=1&viewerToken=token+value",
      target: "blank",
    },
    "普通浏览器的派工看板必须继续在新窗口打开"
  );

  assert.strictEqual(
    clientMode.pdfPreviewMode("pdf", "?mobile=1&tabletApp=1", false),
    "iframe",
    "平板APP中的PDF必须优先使用iframe"
  );
  assert.strictEqual(
    clientMode.pdfPreviewMode("pdf", "?mobile=1&tabletApp=1", true),
    "canvas",
    "平板APP切换兼容预览后必须使用PDF.js Canvas"
  );
  assert.strictEqual(
    clientMode.pdfPreviewMode("pdf", "?mobile=1&compact=1", false),
    "canvas",
    "小程序紧凑横屏必须继续使用PDF.js Canvas"
  );
  assert.strictEqual(
    clientMode.pdfPreviewMode("pdf", "?mobile=1", false),
    "iframe",
    "普通手机浏览器必须保持原生iframe预览"
  );
  assert.strictEqual(
    clientMode.pdfPreviewMode("png", "?mobile=1&tabletApp=1", true),
    "native",
    "图片不能进入PDF渲染分支"
  );

  let fallbackCount = 0;
  let scheduledCallback;
  let cancelledTimer = null;
  const cancelFallback = clientMode.startPdfIframeFallback(
    () => { fallbackCount += 1; },
    (callback, delay) => {
      assert.strictEqual(delay, 8000, "PDF iframe默认应在8秒后进入兼容预览");
      scheduledCallback = callback;
      return 19;
    },
    (timer) => { cancelledTimer = timer; }
  );
  scheduledCallback();
  assert.strictEqual(fallbackCount, 1, "PDF iframe超时后必须执行一次兼容预览回调");
  cancelFallback();
  assert.strictEqual(cancelledTimer, 19, "正常加载或关闭预览时必须取消iframe超时任务");

  console.log("tablet-app-mode: ok");
}

run();
