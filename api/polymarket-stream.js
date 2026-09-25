'use strict';

// GET /api/polymarket-stream?league=NFL|NCAAF|MLB
// Same-origin SSE of Polymarket CLOB best asks for game moneylines.
// Public, keyless. One CLOB snapshot plus the market-channel WebSocket per
// league is fanned out to every connected board. Each event is the whole
// moneyline book. The socket is the fast path (a venue change is relayed
// on the next frame). CLOB /prices refreshes the book about every 2s so a
// missed frame cannot sit. The SSE response ends before Vercel's 300s cap
// and the browser reconnects onto a fresh snapshot.
//
// Quote odds are the best ask as a 0–1 probability (the board converts
// that to American). Spreads and totals exist on Gamma but are alt ladders;
// this spike does not guess which rung is the main line.

const {
  parseLeague,
  beginSse,
  attachHub,
  startPolymarket,
  defaultHubs,
} = require('../lib/venue-live');

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
      key: `polymarket:${league}`,
      source: 'polymarket',
      mode: 'ws',
      start(emit) {
        return startPolymarket(league, deps || {}, emit);
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
module.exports.config = { maxDuration: 300 };
