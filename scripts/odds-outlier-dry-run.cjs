#!/usr/bin/env node
'use strict';
// Dry-run the odds outlier guard against the live caches without writing anything.
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/odds-outlier-dry-run.cjs ['{"logitMax":0.35}']
// Prints every price the guard would drop (American odds, consensus, reason).
const G = require('../lib/odds-outlier-guard');

async function get(path) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = process.env.SUPABASE_ANON_KEY;
  const r = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

(async () => {
  const config = { ...G.readConfig({}), ...JSON.parse(process.argv[2] || '{}'), mode: 'dry' };
  const [odds, events] = await Promise.all([
    get('odds_cache?select=sport,data'),
    get('event_odds_cache?select=sport,data'),
  ]);
  const featuredById = new Map();
  const flags = [];
  for (const r of odds) {
    if (!Array.isArray(r.data) || /winner|championship/.test(r.sport)) continue;
    for (const g of r.data) featuredById.set(g.id, g);
    flags.push(...G.guardSportData(r.sport, r.data, { config }).flags);
  }
  for (const r of events) {
    flags.push(...G.guardSportData(r.sport, [r.data], { config, contextById: featuredById }).flags);
  }
  const am = (n) => (n == null ? '?' : n > 0 ? `+${n}` : String(n));
  for (const f of flags.sort((a, b) => (b.gap_logit || 0) - (a.gap_logit || 0))) {
    console.log([f.sport, `${f.away_team} @ ${f.home_team}`, f.book, f.market,
      `${f.outcome_name}${f.outcome_description ? ` (${f.outcome_description})` : ''} ${f.point ?? ''} ${am(f.price)}`,
      `fair ${am(f.consensus_price)} (${f.consensus_books} books)`, `gap ${f.gap_logit} edge ${f.edge_pct}%`, f.reason, f.detail].join(' | '));
  }
  console.log(`${flags.length} flagged`);
})().catch((err) => { console.error(err); process.exit(1); });
