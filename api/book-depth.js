'use strict';

// On-demand rest-of-book for Promo true-odds lines. Display only.
// POST { legs: [{ bestOppBook, sport, market, game, bestOppName, commence_time }] }
// Never calls The Odds API (includeBetLimits is already top-only on cron).

const { resolveLegsDepth, DEPTH_VENUES, MAX_LEGS } = require('../lib/book-depth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only', venues: [...DEPTH_VENUES] });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const legs = Array.isArray(body.legs) ? body.legs.slice(0, MAX_LEGS) : [];
    const results = await resolveLegsDepth(legs);
    res.status(200).json({ results });
  } catch (e) {
    res.status(200).json({ results: [], error: String(e && e.message || e) });
  }
};

module.exports.DEPTH_VENUES = DEPTH_VENUES;
module.exports.MAX_LEGS = MAX_LEGS;
