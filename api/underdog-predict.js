'use strict';

// GET /api/underdog-predict — Underdog phone prices for Promo and the
// New Odds Board. Reads UNDERDOG_STATE_CONFIG_ID (and optional
// UNDERDOG_PRODUCT_EXPERIENCE_ID / UNDERDOG_CLIENT_VERSION) on the server.
// Never returns Betstamp book 196. A missing config yields games: [] so
// callers omit the Underdog line instead of filling from Betstamp.

const { fetchUnderdogPhone } = require('../lib/underdog-lobby');

async function handler(req, res, deps) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ ok: false, error: 'GET only', games: [] });
    return;
  }
  try {
    const result = await fetchUnderdogPhone(deps);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Underdog-Cache', result.cacheStatus || 'MISS');
    res.status(200).json({
      ok: result.ok !== false,
      missingConfig: !!result.missingConfig,
      configRejected: !!result.configRejected,
      games: result.games || [],
      error: result.error || null,
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      ok: false,
      missingConfig: false,
      configRejected: false,
      games: [],
      error: (e && e.message) || 'Underdog request failed',
    });
  }
}

module.exports = handler;
