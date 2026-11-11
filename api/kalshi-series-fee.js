'use strict';
// api/kalshi-series-fee.js — same-origin proxy of Kalshi GET /series/{ticker} fee terms for the
// Combo Locks card (browser avoids CORS). ?series=KXMVECROSSCATEGORY0,KXMVECROSSCATEGORY
// → { ok, series: { KXMVECROSSCATEGORY0: { fee_type, fee_multiplier } } }. Public, keyless.
// The maker rate itself is derived client-side (src/buyerOdds.js makerRateFromSeries) — same
// table as combo-worker series-fee.js.
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const SERIES_RE = /^[A-Z0-9_.]{2,64}$/;
const cache = new Map(); // warm-instance cache: series → { at, v }
const TTL_MS = 15 * 60 * 1000;

function parseSeries(q) {
  const raw = String((q && q.series) || '');
  return [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => SERIES_RE.test(s)))].slice(0, 20);
}

async function lookup(series, fetchImpl = fetch) {
  const hit = cache.get(series);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const r = await fetchImpl(`${KALSHI}/series/${encodeURIComponent(series)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
  if (!r.ok) { console.warn(`Kalshi fee lookup fallback ${series}: HTTP ${r.status}`); return null; }
  const j = await r.json();
  const s = (j && j.series) || {};
  if (!['quadratic','quadratic_with_maker_fees','quadratic_with_combo_maker_fees'].includes(s.fee_type)) { console.warn(`Unsupported Kalshi fee_type ${series}`); return null; }
  const v = { fee_type: s.fee_type, fee_multiplier: s.fee_multiplier, fetched_at: Date.now() };
  cache.set(series, { at: Date.now(), v });
  return v;
}

async function handler(req, res) {
  const list = parseSeries(req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams));
  const out = {};
  await Promise.all(list.map(async (s) => { try { const v = await lookup(s); if (v) out[s] = v; } catch (err) { console.warn(`Kalshi fee lookup fallback ${s}: ${err.message}`); } }));
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true, series: out });
}

module.exports = handler;
module.exports._helpers = { parseSeries, lookup };
