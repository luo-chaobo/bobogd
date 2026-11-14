'use strict';
const crypto = require('node:crypto');

function createPlatformWebhookSender({ url, secret, fetchImpl = globalThis.fetch, now = Date.now, nonce = crypto.randomUUID, timeoutMs = 10000 }) {
  const destination = new URL(url);
  if (destination.protocol !== 'https:' || destination.username || destination.password) throw new TypeError('Platform webhook requires an HTTPS URL without credentials');
  if (typeof secret !== 'string' || !secret || typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof nonce !== 'function') throw new TypeError('Invalid webhook configuration');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TypeError('Invalid webhook timeout');
  return async (event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.eventId !== 'string' || !event.eventId.trim()) throw new TypeError('Invalid webhook event');
    const timestamp = String(now());
    const requestNonce = nonce();
    if (!/^\d+$/.test(timestamp) || typeof requestNonce !== 'string' || !requestNonce) throw new TypeError('Invalid webhook timestamp or nonce');
    const body = JSON.stringify(event);
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${requestNonce}.${body}`).digest('hex');
    const response = await fetchImpl(destination.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-integration-timestamp': timestamp, 'x-integration-nonce': requestNonce, 'x-integration-signature': signature },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response || !response.ok) throw new Error(`平台返回 ${response?.status ?? '无响应'}`);
  };
}

module.exports = { createPlatformWebhookSender };
