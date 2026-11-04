const bodyPromises = new WeakMap();
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const BODY_TIMEOUT_MS = 15000;

function readRawBody(req) {
  if (bodyPromises.has(req)) return bodyPromises.get(req);
  const promise = new Promise((resolve, reject) => {
    let chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("aborted", onAborted);
      req.removeListener("close", onClose);
      req.removeListener("error", onError);
      if (error) {
        chunks = [];
        req.once("error", () => {});
        req.resume();
        reject(error);
      } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) return finish(fail("请求体超过8MB限制", 413));
      chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onAborted = () => finish(fail("请求已中断，请重新提交", 400));
    const onClose = () => { if (!req.complete) onAborted(); };
    const onError = () => finish(fail("请求读取失败", 400));
    const timer = setTimeout(() => finish(fail("请求内容接收超时，请重新提交", 408)), BODY_TIMEOUT_MS);
    timer.unref();
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("aborted", onAborted);
    req.once("close", onClose);
    req.once("error", onError);
    if (req.aborted || req.destroyed) onAborted();
    else if (req.readableEnded) finish(fail("请求内容已被读取", 400));
  });
  bodyPromises.set(req, promise);
  return promise;
}

async function parseBody(req) {
  const raw = await readRawBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("JSON格式错误"), { statusCode: 400 });
  }
}

module.exports = { readRawBody, parseBody };
