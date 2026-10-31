const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "tv.js"), "utf8");
const functions = source.slice(source.indexOf("function loadPdfScript("), source.indexOf("function releaseDrawingPdf("));

async function run() {
  const loaded = [];
  let failWorker = true;
  const context = {
    window: {},
    define: Object.assign(() => {}, { amd: {} }),
    isCompactMobileTv: () => true,
    document: {
      createElement: () => ({ remove() {} }),
      head: {
        appendChild(script) {
          loaded.push(script.src);
          if (script.src.endsWith("pdf.min.js")) {
            context.window.pdfjsLib = { GlobalWorkerOptions: {} };
            script.onload();
          } else if (failWorker) {
            script.onerror();
          } else {
            const worker = fs.readFileSync(path.join(__dirname, "..", "public", "vendor", "pdfjs", "pdf.worker.min.js"), "utf8");
            vm.runInContext(worker, context);
            script.onload();
          }
        }
      }
    }
  };
  vm.createContext(context);
  const originalDefine = context.define;
  vm.runInContext(`let pdfJsPromise = null; ${functions}`, context);
  await assert.rejects(context.loadPdfJs(), /PDF预览组件加载失败/);
  assert.strictEqual(context.define, originalDefine);
  failWorker = false;
  const first = context.loadPdfJs();
  const second = context.loadPdfJs();
  assert.strictEqual(first, second, "并发预览应复用初始化请求");
  assert.strictEqual(await first, context.window.pdfjsLib);
  assert.ok(context.pdfjsWorker.WorkerMessageHandler);
  assert.strictEqual(context.define, originalDefine, "加载结束后必须恢复原模块加载器");
  assert.deepStrictEqual(loaded, ["/vendor/pdfjs/pdf.min.js", "/vendor/pdfjs/pdf.worker.min.js", "/vendor/pdfjs/pdf.worker.min.js"]);
  console.log("pdf-worker-initialization: ok");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
