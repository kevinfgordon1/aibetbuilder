'use strict';

// GET /api/kalshi-stream?league=NFL|NCAAF|MLB
// Same-origin SSE of Kalshi game-moneyline yes-asks.
//
// The public REST market payload includes yes_ask_dollars (keyless). This
// route polls that about every 2s and every event is the whole moneyline
// book, including polls where no ask moved. One loop per league is shared,
// and a client that connects later is replayed that full book — not the
// last ticker that traded.
//
// Kalshi's WebSocket (ticker / orderbook_delta) is the true tick feed, but
// the handshake requires the same RSA-PSS key as Combo Locks probe
// (KALSHI_KEY_ID + Kalshi_combo_key). lib/venue-live.js builds those
// headers and the subscribe frame. This route does not open that socket:
// a missing key must not 503 the board, and we do not invent one. The
// poll is the working keyless path. It is not tick-by-tick.

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
