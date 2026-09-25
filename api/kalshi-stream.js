'use strict';

// GET /api/kalshi-stream?league=NFL|NCAAF|MLB
// Same-origin SSE of Kalshi game-moneyline yes-asks.
//
// The public REST market payload includes yes_ask_dollars (keyless). With
// KALSHI_KEY_ID + Kalshi_combo_key (same names as the Railway combo-worker)
// this route also holds the orderbook WebSocket. A snapshot builds the book.
// Deltas apply only when seq is contiguous; a gap asks for get_snapshot.
// Ticker frames do not override a book that has been snapshotted. A missing
// key does not 503 the board: REST still polls
// about every 1s, which stays inside a 2s repaint. The SSE response itself
// ends before Vercel's 300s maxDuration so the browser reconnects.

const { authHeaders } = require('./kalshi-sign');
const {
  parseLeague,
  beginSse,
  attachHub,
  startKalshiPoll,
  defaultHubs,
  KALSHI_WS_SIGN_PATH,
} = require('../lib/venue-live');

// Handshake for wss://external-api-ws.kalshi.com/trade-api/ws/v2.
// Same RSA-PSS key as Combo Locks probe. This route does not connect:
// without the key the public REST poll below still runs.
function kalshiWsHeaders(creds, ts = Date.now()) {
  return authHeaders({
    keyId: creds.keyId,
    pem: creds.pem,
    method: 'GET',
    signPath: KALSHI_WS_SIGN_PATH,
    ts,
  });
}

function readLeague(req) {
  let raw = '';
  if (req && req.query && req.query.league != null) raw = req.query.league;
  if (!raw && req && req.url) {
    try { raw = new URL(req.url, 'http://localhost').searchParams.get('league') || ''; } catch (_) { raw = ''; }
  }
  return parseLeague(raw || 'NFL');
}

async function handler(req, res, deps) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  const league = readLeague(req);
  if (!league) {
    res.status(400).json({ ok: false, error: 'league must be NFL, NCAAF, or MLB' });
    return;
  }

  beginSse(res);
  const hubs = (deps && deps.hubs) || defaultHubs;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    attachHub(res, req, {
      hubs,
      key: `kalshi:${league}`,
      source: 'kalshi',
      mode: 'rest-poll',
      start(emit) {
        return startKalshiPoll(league, deps || {}, emit);
      },
    });
    if (req && typeof req.on === 'function') {
      req.on('close', finish);
      req.on('aborted', finish);
    } else {
      finish();
    }
  });
}

module.exports = handler;
module.exports.kalshiWsHeaders = kalshiWsHeaders;
module.exports.config = { maxDuration: 300 };
