'use strict';

// love23 loss-rebate optimizer: match love23 lines to our odds, price each side
// at a sharp fair, find the best opposing prediction-market hedge (fees in,
// depth as potential profit) and rank by EV including the rebate.
//
// Fair reference: Pinnacle no-vig from odds_cache / event_odds_cache.
// BetOnline is the prop reference when a prop feed exists (none cached yet for
// NBA points, so props are listed as "no fair" and never ranked).
// Odds API Pinnacle trailed love23 by ~3-10 min in the Oct 30 study, so a fair
// is "confirmed" only when the prediction-market no-vig agrees within
// cfg.confirmPts; otherwise the more conservative fair is used and flagged.
// Recommendations only. Nothing here can place a bet.

const R = require('./love23-rebate');
const Wk = require('./love23-weekly');

const HEDGE_VENUES = Object.freeze(['kalshi', 'polymarket', 'novig', 'prophetx']);
const VENUE_LABEL = Object.freeze({ kalshi: 'Kalshi', polymarket: 'Polymarket', novig: 'Novig', prophetx: 'ProphetX' });

const STOP = new Set(['the', 'of', 'university', 'univ', 'at']);
const ALIASES = { st: 'state', so: 'southern', no: 'northern', intl: 'international', fla: 'florida', miss: 'mississippi', tenn: 'tennessee' };

// love23 school names that share no token with the Odds API name.
const PHRASE_ALIASES = [
  [/^MIAMI FLORIDA$/i, 'Miami'],
  [/^MIAMI OHIO$/i, 'Miami OH'],
  [/^CENTRAL FLORIDA$/i, 'UCF'],
  [/^CONNECTICUT$/i, 'UConn'],
  [/^SOUTHERN CALIFORNIA$/i, 'USC'],
  [/^LOUISIANA STATE$/i, 'LSU'],
  [/^TEXAS CHRISTIAN$/i, 'TCU'],
  [/^BRIGHAM YOUNG$/i, 'BYU'],
  [/^SOUTHERN METHODIST$/i, 'SMU'],
  [/^ALABAMA BIRMINGHAM$/i, 'UAB'],
  [/^TEXAS EL PASO$/i, 'UTEP'],
  [/^TEXAS SAN ANTONIO$/i, 'UTSA'],
  [/^NEVADA LAS VEGAS$/i, 'UNLV'],
  [/^MASSACHUSETTS$/i, 'UMass'],
];

function aliasPhrase(name) {
  const s = String(name || '').trim();
  for (const [re, to] of PHRASE_ALIASES) if (re.test(s)) return to;
  return s;
}

function tokens(name) {
  return aliasPhrase(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((t) => ALIASES[t] || t).filter((t) => !STOP.has(t));
}

/** Score how well a love23 team name (often city/school only, upper-case) matches an Odds API team name. 0..1 */
function teamScore(l23Name, oddsName) {
  const a = tokens(l23Name);
  const b = tokens(oddsName);
  if (!a.length || !b.length) return 0;
  let hit = 0;
  for (const t of a) if (b.some((u) => u === t || (t.length >= 4 && u.startsWith(t)))) hit += 1;
  if (hit < a.length) return 0; // every love23 token must appear
  return hit / Math.max(a.length, b.length);
}

/** Find the odds_cache game for a love23 game (same orientation, kickoff within 3h). */
function matchGame(g, oddsGames) {
  let best = null;
  for (const og of oddsGames || []) {
    const t = Date.parse(og.commence_time);
    if (!Number.isFinite(t) || Math.abs(t - g.kickoffMs) > 3 * 3600 * 1000) continue;
    const sh = teamScore(g.home, og.home_team);
    const sa = teamScore(g.away, og.away_team);
    if (!sh || !sa) continue;
    const score = sh + sa - Math.abs(t - g.kickoffMs) / (24 * 3600 * 1000);
    if (!best || score > best.score) best = { game: og, score };
  }
  return best ? best.game : null;
}

function samePoint(a, b) { return a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9; }

// Market keys in the Odds API for each love23 market (main first, then alternates).
const MARKET_KEYS = {
  h2h: ['h2h'],
  spreads: ['spreads', 'alternate_spreads'],
  totals: ['totals', 'alternate_totals'],
  team_totals: ['team_totals', 'alternate_team_totals'],
};

/** All markets a bookmaker offers for this love23 market across featured + event payloads. */
function bookMarkets(sources, bookKey, market) {
  const keys = MARKET_KEYS[market] || [];
  const out = [];
  for (const src of sources) {
    if (!src) continue;
    for (const b of src.bookmakers || []) {
      if (b.key !== bookKey) continue;
      for (const m of b.markets || []) if (keys.includes(m.key)) out.push(m);
    }
  }
  return out;
}

/**
 * Outcome pair [ours, opposite] for a love23 selection inside one Odds API market, or null.
 * Names must be the matched odds game's team names.
 */
function pairFor(sel, m, names) {
  const outs = m.outcomes || [];
  if (sel.market === 'h2h') {
    const me = outs.find((o) => o.name === names.me);
    const op = outs.find((o) => o.name === names.opp);
    return me && op ? [me, op] : null;
  }
  if (sel.market === 'spreads') {
    const me = outs.find((o) => o.name === names.me && samePoint(o.point, sel.point));
    const op = outs.find((o) => o.name === names.opp && samePoint(o.point, -sel.point));
    return me && op ? [me, op] : null;
  }
  if (sel.market === 'totals') {
    const want = sel.side === 'over' ? 'Over' : 'Under';
    const other = sel.side === 'over' ? 'Under' : 'Over';
    const me = outs.find((o) => o.name === want && samePoint(o.point, sel.point));
    const op = outs.find((o) => o.name === other && samePoint(o.point, sel.point));
    return me && op ? [me, op] : null;
  }
  if (sel.market === 'team_totals') {
    const want = sel.side === 'over' ? 'Over' : 'Under';
    const other = sel.side === 'over' ? 'Under' : 'Over';
    const forTeam = (o) => o.description === names.team;
    const me = outs.find((o) => o.name === want && forTeam(o) && samePoint(o.point, sel.point));
    const op = outs.find((o) => o.name === other && forTeam(o) && samePoint(o.point, sel.point));
    return me && op ? [me, op] : null;
  }
  return null;
}

function namesFor(sel, og) {
  if (sel.market === 'h2h' || sel.market === 'spreads') {
    const me = sel.side === 'home' ? og.home_team : og.away_team;
    const opp = sel.side === 'home' ? og.away_team : og.home_team;
    return { me, opp };
  }
  if (sel.market === 'team_totals') {
    const team = teamScore(sel.team, og.home_team) >= teamScore(sel.team, og.away_team) ? og.home_team : og.away_team;
    return { team };
  }
  return {};
}

function firstPair(sel, sources, bookKey, names) {
  for (const m of bookMarkets(sources, bookKey, sel.market)) {
    const pr = pairFor(sel, m, names);
    if (pr) return { pair: pr, marketKey: m.key };
  }
  return null;
}

/** Pinnacle main point for this market (to spot a line love23 has moved to and Odds API hasn't). */
function pinnacleMainPoint(sel, featured, names) {
  if (sel.market !== 'spreads' && sel.market !== 'totals') return null;
  const ms = bookMarkets([featured], 'pinnacle', sel.market).filter((m) => m.key === sel.market);
  const m = ms[0];
  if (!m) return null;
  if (sel.market === 'spreads') {
    const o = (m.outcomes || []).find((x) => x.name === names.me);
    return o ? Number(o.point) : null;
  }
  const o = (m.outcomes || []).find((x) => x.name === 'Over');
  return o ? Number(o.point) : null;
}

function outcomeDepthProfit(o) {
  const raw = o && (o.size ?? o.bet_limit);
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return R.profitAtAmerican(n, o.price);
}

/**
 * Evaluate every selection. Inputs:
 *   selections: from love23-parse
 *   games:      Map(link -> love23 game)
 *   odds:       { [sportKey]: { fetchedAt, games: [odds_cache game] } }
 *   events:     { [oddsEventId]: event_odds_cache data }
 *   state:      { carry, weekNet }  carry entering this love23 week, net so far this week
 */
function evaluateAll({ selections, games, odds, events = {}, state = {}, cfg, nowMs = Date.now() } = {}) {
  const c = R.withDefaults(cfg);
  const matchCache = new Map();
  const rows = [];
  // Weekly rebate valuation, built once. Bets on games that settle after the
  // current love23 week ends are valued against next week (same carry assumed).
  const ctx = state.ctx || Wk.buildContext({ state, cfg: c, nowMs });
  const thisWeek = Wk.weekStartOf(Wk.etDate(nowMs), c.weekStartDow);
  let ctxNext = null;
  const ctxFor = (kickoffMs) => {
    if (!kickoffMs || Wk.weekStartOf(Wk.etDate(kickoffMs), c.weekStartDow) <= thisWeek) return { ctx, next: false };
    if (!ctxNext && !(c.weeksLeft > 1)) ctxNext = { none: true }; // promo over before it settles
    if (!ctxNext) {
      ctxNext = Wk.buildContext({
        state: { carry: state.carry, weekNet: 0, betsLeftThisWeek: c.betsPerWeek },
        cfg: { ...c, weeksLeft: Math.max(1, c.weeksLeft - 1) },
        nowMs,
      });
    }
    return { ctx: ctxNext, next: true };
  };
  for (const sel of selections || []) {
    if (sel.kickoffMs && sel.kickoffMs <= nowMs) continue; // started
    if (!MARKET_KEYS[sel.market]) {
      rows.push({ sel, flags: ['no_fair_feed'], skipped: true });
      continue;
    }
    const g = games.get(sel.gameLink);
    const book = odds[sel.sportKey];
    if (!g || !book) { rows.push({ sel, flags: ['no_odds_sport'], skipped: true }); continue; }
    let og = matchCache.get(sel.gameLink);
    if (og === undefined) { og = matchGame(g, book.games); matchCache.set(sel.gameLink, og); }
    if (!og) { rows.push({ sel, flags: ['no_match'], skipped: true }); continue; }
    const ev = events[og.id] || null;
    const sources = [og, ev];
    const names = namesFor(sel, og);
    const flags = [];

    const stale = book.fetchedAt && nowMs - Date.parse(book.fetchedAt) > c.staleMs;
    if (stale) flags.push('stale_odds');

    const pin = firstPair(sel, sources, 'pinnacle', names);
    let pinFair = null;
    if (pin) {
      const nv = R.noVig(pin.pair[0].price, pin.pair[1].price);
      if (nv) pinFair = nv[0];
    }
    const mainPt = pinnacleMainPoint(sel, og, names);
    if (sel.kind === 'main' && mainPt != null && !samePoint(mainPt, sel.point)) flags.push('line_moved');

    // Prediction-market fairs (fee-adjusted pairs, no-vig) and best opposing hedge.
    const pmFairs = [];
    let hedge = null;
    for (const v of HEDGE_VENUES) {
      const pr = firstPair(sel, sources, v, names);
      if (!pr) continue;
      const nv = R.noVig(pr.pair[0].price, pr.pair[1].price);
      if (nv) pmFairs.push(nv[0]);
      const opp = pr.pair[1];
      const d = R.americanToDecimal(opp.price);
      if (!d) continue;
      if (!hedge || d > hedge.decimal) {
        hedge = { venue: v, american: Number(opp.price), decimal: d, depthProfit: outcomeDepthProfit(opp), name: opp.name, point: opp.point ?? null, marketKey: pr.marketKey };
      }
    }
    const pmFair = pmFairs.length ? pmFairs.reduce((s, x) => s + x, 0) / pmFairs.length : null;

    let fairP = pinFair;
    let fairSource = 'pinnacle';
    if (pinFair == null && pmFair != null) { fairP = pmFair; fairSource = 'prediction_markets'; flags.push('pm_fair_only'); }
    if (pinFair != null && pmFair != null && Math.abs(pinFair - pmFair) > c.confirmPts) {
      flags.push('unconfirmed');
      fairP = Math.min(pinFair, pmFair); // conservative for the love23 side
      fairSource = 'conservative';
    }
    if (pinFair != null && pmFair == null) flags.push('no_pm_confirm');
    if (fairP == null) { rows.push({ sel, game: og, flags: [...flags, 'no_fair_at_line'], skipped: true }); continue; }

    const wk = ctxFor(sel.kickoffMs);
    if (wk.next) flags.push('next_week');
    const res = R.evaluateBet({ sel, fairP, hedge, state: { ctx: wk.ctx }, cfg: c });
    if (!res) { rows.push({ sel, game: og, flags: [...flags, 'bad_price'], skipped: true }); continue; }
    if (!hedge) flags.push('no_hedge');
    else if (res.hedge.depthOk === false) flags.push('thin_hedge');
    else if (res.hedge.depthOk == null) flags.push('depth_unknown');
    rows.push({
      sel,
      game: og,
      fairSource,
      pinFair,
      pmFair,
      flags,
      ...res,
      hedgeVenueLabel: hedge ? VENUE_LABEL[hedge.venue] : null,
      hedgeName: hedge ? hedge.name : null,
      hedgePoint: hedge ? hedge.point : null,
    });
  }
  return rows;
}

// Flags that keep a pick out of the ranked list (still shown in "all lines").
const BLOCKING_FLAGS = new Set(['stale_odds', 'line_moved', 'no_hedge', 'thin_hedge']);

function rankPicks(rows, { includeFlagged = false } = {}) {
  return (rows || [])
    .filter((r) => !r.skipped && r.hedge)
    .filter((r) => includeFlagged || !r.flags.some((f) => BLOCKING_FLAGS.has(f)))
    .sort((a, b) => b.totalHedged - a.totalHedged);
}

module.exports = {
  HEDGE_VENUES,
  VENUE_LABEL,
  BLOCKING_FLAGS,
  tokens,
  aliasPhrase,
  teamScore,
  matchGame,
  pairFor,
  namesFor,
  evaluateAll,
  rankPicks,
};
