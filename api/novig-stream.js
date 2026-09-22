'use strict';

// GET /api/novig-stream?league=NFL|NCAAF|MLB
// Same-origin SSE of Novig best asks for game moneylines, plus the main
// spread and total when the book has both sides and a clean line.
//
// OAuth client credentials (NOVIG_CLIENT_ID / NOVIG_CLIENT_SECRET) stay on
// the server. Unset credentials emit one needs-credentials note and do not
// open the tape. A 401 does not throw — the column stays blank.

const {
  parseLeague,
  beginSse,
  attachHub,
  defaultHubs,
} = require('../lib/venue-live');
const { novigConfigured, startNovig } = require('../lib/novig-live');

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
  const configured = novigConfigured(deps);
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    attachHub(res, req, {
      hubs,
      key: `novig:${league}`,
      source: 'novig',
      mode: configured ? 'ws' : 'needs-credentials',
      start(emit) {
        return startNovig(league, deps || {}, emit);
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
