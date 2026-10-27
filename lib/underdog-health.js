'use strict';

// Underdog Predict health check (2026-10-27). Two failure modes went
// unnoticed for weeks because nothing compared the feed to an outside truth:
//   1. Coverage: the old product experience id carried a moneyline for only
//      74 of 115 NCAAF games (Troy @ JMU missing from the phone path).
//   2. Price drift: the same id served frozen/wider prices (Troy +835 vs the
//      phone's +1070; 44% of NCAAF sides >1.5 points off Kalshi + UDX fee),
//      and the Kalshi restamp still called them fresh.
// checkUnderdogHealth() measures both from one fetchUnderdogPhone() read
// (Kalshi-confirmed, so every matched side carries kalshiDriftPts) and the
// public game_schedule table, and returns alert lines. Pure apart from the
// injected fetches; api/underdog-health.js runs it on a cron and sends the
// alert through the existing Telegram path (lib/desk-protect-notify.js).

const { fetchUnderdogPhone } = require('./underdog-lobby');

const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Healthy 2026-10-27: 110 of 115 (5 omitted by the |american| >= 2000 cap).
const NCAAF_MIN_COVERAGE = 0.85;
const DRIFT_PTS = 1.5;
// Healthy 2026-10-27: 0-6% of matched sides per sport; old id: 44% NCAAF.
const DRIFT_MAX_SHARE = 0.15;
const DRIFT_MIN_SIDES = 10;

function normTeam(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Schedule names are ESPN "location + name" (Troy Trojans); Underdog prints
// full names too. Match a schedule game when both sides share a prefix.
function sameTeam(a, b) {
  const x = normTeam(a);
  const y = normTeam(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.replace(/\bstate\b/g, 'st');
  const ys = y.replace(/\bstate\b/g, 'st');
  return xs === ys || xs.startsWith(`${ys} `) || ys.startsWith(`${xs} `);
}

function scheduleTeamNames(row, side) {
  return [row[`${side}_name`], row[`${side}_location`]].filter(Boolean);
}

// Both teams match, or one team matches and kickoff agrees within 90 min
// (App State / Appalachian State, UAlbany / University at Albany, ...).
function gameMatchesSchedule(game, row) {
  const hit = (name, side) => scheduleTeamNames(row, side).some((n) => sameTeam(name, n));
  const away = hit(game.away, 'away');
  const home = hit(game.home, 'home');
  if (away && home) return true;
  if (!away && !home) return false;
  const a = Date.parse(game.scheduledAt || '');
  const b = Date.parse(row.start_time_utc || '');
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 90 * 60 * 1000;
}

async function loadNcaafSchedule({ env = process.env, fetchFn = fetch, now = Date.now() } = {}) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, rows: [], error: 'supabase not configured' };
  const from = new Date(now).toISOString();
  const to = new Date(now + HEALTH_WINDOW_MS).toISOString();
  const q = `${url}/rest/v1/game_schedule?select=league,start_time_utc,away_name,home_name,away_location,home_location,state`
    + `&league=eq.NCAAF&start_time_utc=gte.${encodeURIComponent(from)}&start_time_utc=lt.${encodeURIComponent(to)}&limit=1000`;
  try {
    const r = await fetchFn(q, { headers: { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' } });
    if (!r.ok) return { ok: false, rows: [], error: `game_schedule ${r.status}` };
    const rows = await r.json();
    return { ok: true, rows: (rows || []).filter((row) => row && row.state !== 'post') };
  } catch (e) {
    return { ok: false, rows: [], error: 'game_schedule unreachable' };
  }
}

function coverageReport(games, scheduleRows, now) {
  const end = now + HEALTH_WINDOW_MS;
  const ncaaf = (games || []).filter((g) => g.sport === 'NCAAF' && g.lines.some((l) => l.market === 'h2h'))
    .filter((g) => { const t = Date.parse(g.scheduledAt || ''); return !Number.isFinite(t) || (t >= now - 4 * 3600e3 && t < end); });
  // One Underdog game covers at most one schedule row: exact two-team
  // matches first, then one-team + kickoff matches on what is left.
  const used = new Set();
  const matched = new Set();
  const rows = scheduleRows || [];
  for (const strict of [true, false]) {
    rows.forEach((row, i) => {
      if (matched.has(i)) return;
      const idx = ncaaf.findIndex((g, j) => !used.has(j) && (strict
        ? gameMatchesSchedule({ ...g, scheduledAt: null }, row) : gameMatchesSchedule(g, row)));
      if (idx >= 0) { used.add(idx); matched.add(i); }
    });
  }
  const covered = matched.size;
  const missing = rows.filter((_, i) => !matched.has(i))
    .map((row) => `${row.away_name || row.away_location} @ ${row.home_name || row.home_location}`);
  const scheduled = (scheduleRows || []).length;
  return {
    scheduled,
    underdogMoneylineGames: ncaaf.length,
    covered,
    coverage: scheduled ? covered / scheduled : null,
    missing,
  };
}

function driftReport(games) {
  const bySport = {};
  for (const g of games || []) {
    for (const l of g.lines || []) {
      if (l.market !== 'h2h') continue;
      const s = bySport[g.sport] || (bySport[g.sport] = { sides: 0, matched: 0, drifting: 0, worst: [] });
      s.sides += 1;
      if (l.kalshiDriftPts == null) continue;
      s.matched += 1;
      if (Math.abs(l.kalshiDriftPts) > DRIFT_PTS) {
        s.drifting += 1;
        s.worst.push({ name: l.name, american: l.american, driftPts: l.kalshiDriftPts });
      }
    }
  }
  for (const s of Object.values(bySport)) {
    s.share = s.matched ? s.drifting / s.matched : 0;
    s.worst = s.worst.sort((a, b) => Math.abs(b.driftPts) - Math.abs(a.driftPts)).slice(0, 3);
  }
  return bySport;
}

function alertsFor(coverage, drift) {
  const alerts = [];
  if (coverage && coverage.scheduled >= 10 && coverage.coverage != null && coverage.coverage < NCAAF_MIN_COVERAGE) {
    alerts.push(`Underdog NCAAF moneylines: ${coverage.covered}/${coverage.scheduled} scheduled games (${Math.round(coverage.coverage * 100)}%, want ${Math.round(NCAAF_MIN_COVERAGE * 100)}%+). Missing e.g. ${coverage.missing.slice(0, 3).join('; ')}`);
  }
  for (const [sport, s] of Object.entries(drift || {})) {
    if (s.matched >= DRIFT_MIN_SIDES && s.share > DRIFT_MAX_SHARE) {
      const eg = s.worst.map((w) => `${w.name} ${w.american > 0 ? '+' : ''}${w.american} (${w.driftPts > 0 ? '+' : ''}${w.driftPts})`).join('; ');
      alerts.push(`Underdog ${sport} prices off Kalshi+fee: ${s.drifting}/${s.matched} sides >${DRIFT_PTS} pts. e.g. ${eg}`);
    }
    if (s.sides >= DRIFT_MIN_SIDES && s.matched / s.sides < 0.5) {
      alerts.push(`Underdog ${sport}: only ${s.matched}/${s.sides} moneyline sides matched to Kalshi (name matching broken?)`);
    }
  }
  return alerts;
}

async function checkUnderdogHealth({ env = process.env, fetchFn = fetch, kalshiFetchFn = fetchFn, scheduleFetchFn = fetchFn, now = Date.now(), cache } = {}) {
  const phone = await fetchUnderdogPhone({ env, live: true, fetchFn, kalshiFetchFn, now, ...(cache ? { cache, kalshiCache: new Map() } : {}) });
  if (!phone || !phone.ok || !(phone.games || []).length) {
    const why = (phone && phone.error) || (phone && phone.ok ? 'no games returned' : 'unknown');
    return { ok: false, alerts: [`Underdog Predict fetch failed: ${why}`], coverage: null, drift: null };
  }
  const schedule = await loadNcaafSchedule({ env, fetchFn: scheduleFetchFn, now });
  const coverage = schedule.ok ? coverageReport(phone.games, schedule.rows, now) : { error: schedule.error };
  const drift = driftReport(phone.games);
  return { ok: true, alerts: alertsFor(schedule.ok ? coverage : null, drift), coverage, drift };
}

module.exports = {
  DRIFT_MAX_SHARE,
  DRIFT_PTS,
  NCAAF_MIN_COVERAGE,
  alertsFor,
  checkUnderdogHealth,
  coverageReport,
  driftReport,
  gameMatchesSchedule,
  loadNcaafSchedule,
};
