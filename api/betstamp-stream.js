'use strict';

// GET /api/betstamp-stream — same-origin SSE proxy for Betstamp live ticks.
// The browser never sees X-API-KEY. Each upstream data event is re-emitted
// with ingest_ts so the board can prove ~400ms inter-arrival.

const {
  readQuery,
  buildMarketParams,
  streamUrl,
  apiKey,
  redact,
  parseSseChunk,
  wrapSseEvent,
  betstampFetch,
} = require('../lib/betstamp');

async function handler(req, res, deps = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }

  const key = apiKey(deps.env);
  if (!key) {
    res.status(503).json({ ok: false, error: 'BETSTAMP_API_KEY is not set', missingKey: true });
    return;
  }

  const params = buildMarketParams(readQuery(req));
  const url = streamUrl(params);
  const fetchFn = deps.fetchFn || fetch;

  let upstream;
  try {
    upstream = await betstampFetch(url, {
      key,
      fetchFn,
      timeoutMs: deps.connectTimeoutMs || 20000,
      accept: 'text/event-stream',
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: redact(e && e.message ? e.message : e) });
    return;
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    const status = (upstream && upstream.status) || 502;
    res.status(status).json({ ok: false, error: 'Betstamp stream unavailable' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let closed = false;

  const abort = () => {
    closed = true;
    reader.cancel().catch(() => {});
  };
  if (req && typeof req.on === 'function') {
    req.on('close', abort);
    req.on('aborted', abort);
  }

  try {
    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buf);
      buf = parsed.rest;
      const ingestTs = Date.now();
      for (const ev of parsed.events) {
        res.write(wrapSseEvent(ev, ingestTs));
        if (typeof res.flush === 'function') res.flush();
      }
    }
  } catch (_) {
    /* client gone or upstream drop — reconnect is the browser's job */
  } finally {
    try { res.end(); } catch (_) { /* ignore */ }
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 300 };
module.exports._helpers = { buildMarketParams, streamUrl, parseSseChunk, wrapSseEvent };
