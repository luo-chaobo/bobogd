'use strict';

function createDeferredResponse(response, maxBytes = 2 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Invalid response limit');
  let status = 200;
  let ended = false;
  let body;
  const headers = new Map();
  let proxy;
  function setStatus(code) {
    if (!Number.isInteger(code) || code < 100 || code > 599) throw new TypeError('Invalid response status');
    status = code;
  }
  const api = {
    setHeader(name, value) { if (ended) throw new Error('Response already ended'); headers.set(String(name).toLowerCase(), [name, value]); return proxy; },
    getHeader(name) { const header = headers.get(String(name).toLowerCase()); return header ? header[1] : response.getHeader(name); },
    writeHead(code, suppliedHeaders = {}) {
      if (ended) throw new Error('Response already ended');
      setStatus(code);
      for (const [name, value] of Object.entries(suppliedHeaders)) api.setHeader(name, value);
      return proxy;
    },
    end(value) {
      if (ended) throw new Error('Response already ended');
      if (value !== undefined && typeof value !== 'string' && !Buffer.isBuffer(value)) throw new TypeError('Invalid response body');
      if (value !== undefined && Buffer.byteLength(value) > maxBytes) throw new Error('Deferred response too large');
      body = Buffer.isBuffer(value) ? Buffer.from(value) : value;
      ended = true;
      return proxy;
    },
    write() { throw new Error('Streaming response cannot be deferred'); },
    flushHeaders() { throw new Error('Streaming response cannot be deferred'); }
  };
  proxy = new Proxy(response, {
    get(target, property) {
      if (Object.hasOwn(api, property)) return api[property];
      if (property === 'statusCode') return status;
      if (property === 'writableEnded') return ended;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === 'statusCode') { setStatus(value); return true; }
      return Reflect.set(target, property, value, target);
    }
  });
  return {
    response: proxy,
    get ended() { return ended; },
    get statusCode() { return status; },
    flush() {
      if (!ended) throw new Error('Deferred response not ended');
      if (response.destroyed || response.writableEnded) throw new Error('Client disconnected');
      response.writeHead(status, Object.fromEntries([...headers.values()]));
      response.end(body);
    }
  };
}

module.exports = { createDeferredResponse };
