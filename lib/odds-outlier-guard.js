'use strict';

// Automatic outlier guard for game-line odds, run at ingestion (next to
// lib/leg-blocklist.js) before anything is written to odds_cache /
// event_odds_cache. A price that pays far more than the rest of the market is
// almost always a stale or mistyped line (DK WKU -19.5 +1140 vs FanDuel +630).
// Leaving it in the cache puts it in every Promo / Optimize! / Free Bet / +EV
// pick, so flagged outcomes are dropped from the cached data and logged to
// public.odds_outlier_flags (owner-only) instead.
//
// Two checks, per game:
//  1. consensus — for each market/line/side, compare a book's offered price
//     (with vig, as the bettor gets it) to the weighted median no-vig
//     probability of the OTHER books (clone feeds collapsed to one vote, sharp
//     books weighted up). Flag when it pays more than the consensus fair price
//     by more than a log-odds gap AND an edge floor (tighter for near-even
//     lines, wider for longshots — see DEFAULT_CONFIG).
//     Needs `minBooks` independent comparison books; with fewer (but >= 2) only
//     an egregious gap (`egregiousLogit`) is flagged.
//  2. ladder — within one book, an easier alt line (e.g. -15.5) must not pay
//     more than a harder one (-17.5). The easier, over-paying rung is flagged
//     unless the consensus says it is fairly priced (then the harder rung is
//     just stingy, which is harmless for picks).
// Only over-paying prices are flagged; a stingy price never becomes a pick.
//
// Config: ODDS_OUTLIER_GUARD=off|dry|on (dry = log, do not drop). Thresholds
// can be overridden with ODDS_OUTLIER_* env vars (see readConfig).

const GUARDED_MARKETS = Object.freeze({
  h2h: 'h2h',
  spreads: 'spread',
  alternate_spreads: 'spread',
  totals: 'total',
  alternate_totals: 'total',
  team_totals: 'team_total',
  alternate_team_totals: 'team_total',
});
const ALT_MARKETS = new Set(['alternate_spreads', 'alternate_totals', 'team_totals', 'alternate_team_totals']);

// Books that share a pricing feed count as one vote in the consensus, so five
// Kambi skins cannot outvote everyone else (or prop up their own error).
const CLONE_GROUPS = Object.freeze({
  betrivers: 'kambi',
  unibet_se: 'kambi',
  unibet_nl: 'kambi',
  unibet_fr: 'kambi',
  unibet: 'kambi',
  leovegas_se: 'kambi',
  betparx: 'kambi',
  ballybet: 'kambi',
  lowvig: 'betonline',
  betonlineag: 'betonline',
  winamax_de: 'winamax',
  winamax_fr: 'winamax',
  hardrockbet: 'hardrock',
  hardrockbet_fl: 'hardrock',
  hardrockbet_oh: 'hardrock',
  hardrockbet_az: 'hardrock',
  nordicbet: 'betsson',
  betsson: 'betsson',
  polymarket: 'polymarket',
  polymarket_us: 'polymarket',
  mybookieag: 'mybookie',
  betus: 'betus',
  // Courtside quotes DK's numbers with a different margin (WKU alt ladder:
  // +547/+720/+790/+950 vs DK +547/+720/+790/+950).
  courtside: 'draftkings',
  draftkings: 'draftkings',
});

// Sharp / exchange books get more weight in the consensus median on main
// lines. On alt lines prediction-market books are often thin or stale (Polymarket
// WKU -16.5 and -17.5 both +698), so alt lines use weight 1 for everyone but
// Pinnacle/Circa.
const BOOK_WEIGHTS = Object.freeze({
  pinnacle: 3,
  circasports: 3,
  bet105: 2,
  betfair_ex_eu: 2,
  betfair_ex_uk: 2,
  matchbook: 1.5,
  betonline: 1.5,
  novig: 1.5,
  prophetx: 1.5,
  kalshi: 1.5,
  polymarket: 1.5,
});

const DEFAULT_CONFIG = Object.freeze({
  mode: 'on',
  minBooks: 3,
  // log-odds gap (fair logit − offered logit) above which a price is an
  // outlier, plus a floor on the edge vs fair (fair prob × decimal − 1). Two
  // tiers: near-even lines (fair prob >= shortProb) disperse very little across
  // books, so a smaller gap is already a mistake; longshots (+300 and up)
  // legitimately spread wider (Betfair Ipswich +1250 vs fair +1003), so they
  // need a bigger gap and edge.
  shortProb: 0.25,
  logitMaxShort: 0.25,
  minEdgeShort: 0.1,
  logitMax: 0.4,
  minEdge: 0.2,
  // with only 2 comparison books: a bigger edge floor, similar gap. Alt ladders
  // on small games are often quoted by just two US books (WKU -19.5: FanDuel
  // +630, Fanatics +550), so this is where most bad rungs sit.
  egregiousLogit: 0.45,
  egregiousMinEdge: 0.4,
  // easier rung may pay at most this much more (decimal ratio) than a harder one.
  ladderTol: 0.02,
  // a ladder violation only flags the easier rung if it is also at least this
  // generous vs consensus (or has no consensus). Otherwise the harder rung is
  // just stingy, which never becomes a pick.
  ladderMinGap: 0.15,
  // vig assumed when a book does not quote the other side.
  fallbackVig: 0.045,
  // A book's own two sides must sum to an overround in this band to count as
  // a comparison quote. Exchange placeholders (Polymarket KSU -20.5 -10421 next
  // to +20.5 -851) are incoherent and would poison the median.
  minOverround: 0.85,
  maxOverround: 1.3,
  // One-sided quotes this short are placeholders (Novig -33233), not prices.
  maxOneSidedImplied: 0.97,
  // Live games move faster than the 5-min refresh; books disagree because of
  // staleness, not mistakes. Pregame only by default.
  skipStarted: true,
});

function numEnv(env, key, fallback) {
  const v = env && env[key];
  if (v == null || String(v).trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readConfig(env = process.env) {
  const rawMode = String((env && env.ODDS_OUTLIER_GUARD) || DEFAULT_CONFIG.mode).trim().toLowerCase();
  const mode = ['off', 'dry', 'on'].includes(rawMode) ? rawMode : DEFAULT_CONFIG.mode;
  return {
    mode,
    minBooks: numEnv(env, 'ODDS_OUTLIER_MIN_BOOKS', DEFAULT_CONFIG.minBooks),
    shortProb: numEnv(env, 'ODDS_OUTLIER_SHORT_PROB', DEFAULT_CONFIG.shortProb),
    logitMaxShort: numEnv(env, 'ODDS_OUTLIER_LOGIT_MAX_SHORT', DEFAULT_CONFIG.logitMaxShort),
    minEdgeShort: numEnv(env, 'ODDS_OUTLIER_MIN_EDGE_SHORT', DEFAULT_CONFIG.minEdgeShort),
    logitMax: numEnv(env, 'ODDS_OUTLIER_LOGIT_MAX', DEFAULT_CONFIG.logitMax),
    minEdge: numEnv(env, 'ODDS_OUTLIER_MIN_EDGE', DEFAULT_CONFIG.minEdge),
    egregiousLogit: numEnv(env, 'ODDS_OUTLIER_EGREGIOUS_LOGIT', DEFAULT_CONFIG.egregiousLogit),
    egregiousMinEdge: numEnv(env, 'ODDS_OUTLIER_EGREGIOUS_MIN_EDGE', DEFAULT_CONFIG.egregiousMinEdge),
    ladderTol: numEnv(env, 'ODDS_OUTLIER_LADDER_TOL', DEFAULT_CONFIG.ladderTol),
    ladderMinGap: numEnv(env, 'ODDS_OUTLIER_LADDER_MIN_GAP', DEFAULT_CONFIG.ladderMinGap),
    fallbackVig: DEFAULT_CONFIG.fallbackVig,
    minOverround: DEFAULT_CONFIG.minOverround,
    maxOverround: DEFAULT_CONFIG.maxOverround,
    maxOneSidedImplied: DEFAULT_CONFIG.maxOneSidedImplied,
    skipStarted: String((env && env.ODDS_OUTLIER_INCLUDE_LIVE) || '') !== '1',
  };
}

function americanToDecimal(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0 || (n > -100 && n < 100)) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function decimalToAmerican(d) {
  if (!Number.isFinite(d) || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

function logit(p) {
  return Math.log(p / (1 - p));
}

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function groupOf(book) {
  return CLONE_GROUPS[book] || book;
}

const ALT_WEIGHT_BOOKS = new Set(['pinnacle', 'circasports']);

function weightOf(group, alt = false) {
  if (alt && !ALT_WEIGHT_BOOKS.has(group)) return 1;
  return BOOK_WEIGHTS[group] || 1;
}

function weightedMedian(items) {
  // items: [{ v, w }]
  const sorted = items.filter((x) => Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
  if (!sorted.length) return null;
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].w;
    if (acc > total / 2) return sorted[i].v;
    if (acc === total / 2) return (sorted[i].v + sorted[i + 1].v) / 2;
  }
  return sorted[sorted.length - 1].v;
}

function median(nums) {
  const s = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m] + s[m - 1]) / 2;
}

function pointKey(point) {
  const n = Number(point);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}

// Side key for one outcome inside a market family (game-level).
// h2h carries its outcome count: EU books list NHL h2h as a 3-way regulation
// market (Blues +123 / Sharks +190 / Draw +320) that must not be compared with
// the 2-way moneyline (Blues -145).
function sideKey(family, outcome, market) {
  const desc = family === 'team_total' ? norm(outcome.description) : '';
  const pt = family === 'h2h' ? `${((market && market.outcomes) || []).length}way` : pointKey(outcome.point);
  return `${family}|${desc}|${norm(outcome.name)}|${pt}`;
}

function collectQuotes(game, { context = false } = {}) {
  const quotes = [];
  for (const bm of (game && game.bookmakers) || []) {
    for (const m of bm.markets || []) {
      const family = GUARDED_MARKETS[m.key];
      if (!family) continue;
      for (const o of m.outcomes || []) {
        const dec = americanToDecimal(o.price);
        if (!dec) continue;
        if (family !== 'h2h' && !Number.isFinite(Number(o.point))) continue;
        quotes.push({
          book: bm.key,
          group: groupOf(bm.key),
          marketKey: m.key,
          family,
          alt: ALT_MARKETS.has(m.key),
          name: o.name,
          description: o.description,
          point: family === 'h2h' ? null : Number(o.point),
          price: Number(o.price),
          dec,
          implied: 1 / dec,
          side: sideKey(family, o, m),
          context,
          outcome: o,
          market: m,
        });
      }
    }
  }
  return quotes;
}

// No-vig probability of each quote using the same book's other side(s).
function attachFair(quotes, cfg) {
  const byBook = new Map();
  for (const q of quotes) {
    if (!byBook.has(q.book)) byBook.set(q.book, new Map());
    const m = byBook.get(q.book);
    // A book can list the same side in spreads and alternate_spreads; keep the first.
    if (!m.has(q.side)) m.set(q.side, q);
  }
  for (const q of quotes) {
    const sides = byBook.get(q.book);
    let others = [];
    if (q.family === 'h2h') {
      others = (q.market.outcomes || [])
        .filter((o) => o !== q.outcome)
        .map((o) => americanToDecimal(o.price))
        .filter(Boolean)
        .map((d) => ({ implied: 1 / d }));
      const expected = (q.market.outcomes || []).length - 1;
      if (others.length !== expected || expected < 1) others = [];
    } else if (q.family === 'spread') {
      for (const o of sides.values()) {
        if (o.family === 'spread' && norm(o.name) !== norm(q.name) && Math.abs(o.point + q.point) < 1e-9) {
          others = [o];
          break;
        }
      }
    } else {
      const want = norm(q.name) === 'over' ? 'under' : norm(q.name) === 'under' ? 'over' : null;
      if (want) {
        for (const o of sides.values()) {
          if (o.family === q.family && norm(o.name) === want && Math.abs(o.point - q.point) < 1e-9
            && (q.family !== 'team_total' || norm(o.description) === norm(q.description))) {
            others = [o];
            break;
          }
        }
      }
    }
    if (others.length) {
      const total = q.implied + others.reduce((s, o) => s + o.implied, 0);
      q.fair = total > 0 ? q.implied / total : null;
      q.fairFrom = 'novig';
      q.overround = total;
      q.junk = !(total >= cfg.minOverround && total <= cfg.maxOverround);
    } else {
      q.fair = q.implied / (1 + cfg.fallbackVig);
      q.fairFrom = 'implied';
      q.junk = q.implied > cfg.maxOneSidedImplied;
    }
  }
}

function consensusFor(quote, sideQuotes) {
  const byGroup = new Map();
  for (const o of sideQuotes) {
    if (o.group === quote.group || o.junk) continue;
    if (!Number.isFinite(o.fair) || o.fair <= 0 || o.fair >= 1) continue;
    if (!byGroup.has(o.group)) byGroup.set(o.group, []);
    byGroup.get(o.group).push(o.fair);
  }
  const items = [...byGroup.entries()].map(([g, vals]) => ({ v: median(vals), w: weightOf(g, quote.family !== 'h2h' && quote.alt), g }));
  return { fair: weightedMedian(items), books: items.length, groups: items.map((x) => x.g) };
}

// Difficulty order for ladder checks. Higher = harder to win (should pay more).
function difficulty(q) {
  if (q.family === 'spread') return -q.point;
  const nm = norm(q.name);
  if (nm === 'over') return q.point;
  if (nm === 'under') return -q.point;
  return null;
}

function ladderKey(q) {
  if (q.family === 'h2h') return null;
  return `${q.book}|${q.family}|${q.family === 'team_total' ? norm(q.description) : ''}|${norm(q.name)}`;
}

/**
 * Evaluate one game. `contextGame` (e.g. the featured main-line game for an
 * event-markets pull) adds comparison quotes but is never flagged/stripped.
 * Returns every own quote with its metrics plus the flagged subset.
 */
function hasStarted(game, nowMs) {
  const t = new Date(game && game.commence_time).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

function evaluateGame(game, { contextGame = null, config = DEFAULT_CONFIG, nowMs = Date.now() } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (cfg.skipStarted && hasStarted(game, nowMs)) return { quotes: [], flags: [], skipped: 'started' };
  const own = collectQuotes(game);
  const ctx = contextGame ? collectQuotes(contextGame, { context: true }) : [];
  // Context quotes only fill sides a book does not already quote in `game`.
  const ownKeys = new Set(own.map((q) => `${q.book}|${q.side}`));
  const all = own.concat(ctx.filter((q) => !ownKeys.has(`${q.book}|${q.side}`)));
  attachFair(all, cfg);

  const bySide = new Map();
  for (const q of all) {
    if (!bySide.has(q.side)) bySide.set(q.side, []);
    bySide.get(q.side).push(q);
  }

  for (const q of own) {
    const c = consensusFor(q, bySide.get(q.side) || []);
    q.consensusFair = c.fair;
    q.consensusBooks = c.books;
    q.consensusGroups = c.groups;
    if (Number.isFinite(c.fair) && c.fair > 0 && c.fair < 1) {
      q.gap = logit(c.fair) - logit(q.implied);
      q.edge = c.fair * q.dec - 1;
    } else {
      q.gap = null;
      q.edge = null;
    }
    const short = Number.isFinite(c.fair) && c.fair >= cfg.shortProb;
    const thr = short ? cfg.logitMaxShort : cfg.logitMax;
    const edgeFloor = short ? cfg.minEdgeShort : cfg.minEdge;
    q.flag = null;
    if (q.gap != null) {
      if (q.consensusBooks >= cfg.minBooks && q.gap > thr && q.edge > edgeFloor) {
        q.flag = 'consensus';
      } else if (q.consensusBooks >= 2 && q.consensusBooks < cfg.minBooks && q.gap > cfg.egregiousLogit && q.edge > cfg.egregiousMinEdge) {
        q.flag = 'consensus_egregious';
      }
    }
  }

  // Ladder: same book, same side family, easier rung paying more than a harder one.
  const ladders = new Map();
  for (const q of all) {
    const k = ladderKey(q);
    if (!k || difficulty(q) == null) continue;
    if (!ladders.has(k)) ladders.set(k, new Map());
    const rungs = ladders.get(k);
    const d = difficulty(q);
    if (q.junk) continue;
    const prev = rungs.get(d);
    if (!prev || (prev.context && !q.context)) rungs.set(d, q);
  }
  for (const rungs of ladders.values()) {
    const list = [...rungs.values()].sort((a, b) => difficulty(a) - difficulty(b));
    for (let i = 0; i < list.length; i++) {
      const easy = list[i];
      if (easy.context || easy.flag) continue;
      for (let j = i + 1; j < list.length; j++) {
        const hard = list[j];
        if (easy.dec > hard.dec * (1 + cfg.ladderTol)) {
          // Any consensus says the easy rung is (near) fair: the hard rung is
          // the stale/stingy one (Polymarket SHSU -20.5 +1736 under -13.5 +1848).
          if (easy.gap != null && easy.consensusBooks >= 1 && easy.gap <= cfg.ladderMinGap) continue;
          easy.flag = 'ladder';
          easy.ladderRef = { point: hard.point, price: hard.price, marketKey: hard.marketKey };
          break;
        }
      }
    }
  }

  const flags = own.filter((q) => q.flag);
  return { quotes: own, flags };
}

function stripFlagged(game, flags) {
  if (!flags.length) return game;
  const drop = new Set(flags.map((f) => f.outcome));
  return {
    ...game,
    bookmakers: (game.bookmakers || []).map((bm) => ({
      ...bm,
      markets: (bm.markets || [])
        .map((m) => (GUARDED_MARKETS[m.key]
          ? { ...m, outcomes: (m.outcomes || []).filter((o) => !drop.has(o)) }
          : m))
        .filter((m) => !GUARDED_MARKETS[m.key] || m.outcomes.length > 0),
    })),
  };
}

function flagRecord(sport, game, q) {
  return {
    sport,
    event_id: game.id || null,
    commence_time: game.commence_time || null,
    home_team: game.home_team || null,
    away_team: game.away_team || null,
    book: q.book,
    market: q.marketKey,
    outcome_name: q.name,
    outcome_description: q.description || null,
    point: q.point,
    price: q.price,
    consensus_price: Number.isFinite(q.consensusFair) ? decimalToAmerican(1 / q.consensusFair) : null,
    consensus_books: q.consensusBooks || 0,
    gap_logit: q.gap == null ? null : Math.round(q.gap * 1000) / 1000,
    edge_pct: q.edge == null ? null : Math.round(q.edge * 1000) / 10,
    reason: q.flag,
    detail: q.flag === 'ladder' && q.ladderRef
      ? `pays more than ${q.ladderRef.point} at ${q.ladderRef.price}`
      : `vs fair ${Number.isFinite(q.consensusFair) ? decimalToAmerican(1 / q.consensusFair) : '?'} from ${(q.consensusGroups || []).join(',')}`,
  };
}

/**
 * Guard a sport's game list. `contextById` maps game id → featured game used as
 * extra comparison quotes. In mode "on" flagged outcomes are removed; in "dry"
 * they are only reported; "off" returns data untouched.
 */
function guardSportData(sport, games, { config = readConfig(), contextById = null, nowMs = Date.now() } = {}) {
  if (!Array.isArray(games) || config.mode === 'off') return { data: games, flags: [] };
  const flags = [];
  const data = games.map((g) => {
    if (!g || !Array.isArray(g.bookmakers)) return g;
    const ctx = contextById && g.id ? contextById.get(g.id) : null;
    const res = evaluateGame(g, { contextGame: ctx, config, nowMs });
    for (const q of res.flags) flags.push(flagRecord(sport, g, q));
    return config.mode === 'on' ? stripFlagged(g, res.flags) : g;
  });
  return { data, flags };
}

function flagKey(f) {
  return [f.event_id, f.book, f.market, f.outcome_name, f.outcome_description || '', f.point == null ? '' : f.point].join('|');
}

/**
 * Upsert flags into public.odds_outlier_flags (one row per event/book/line,
 * last_seen_at refreshed every run). Best-effort: callers wrap in a timeout.
 */
async function logOutlierFlags(supabaseClient, flags, { signal, mode = readConfig().mode } = {}) {
  if (!supabaseClient || !Array.isArray(flags) || !flags.length) return null;
  const nowIso = new Date().toISOString();
  const seen = new Map();
  for (const f of flags) {
    if (!f.event_id) continue;
    seen.set(flagKey(f), { flag_key: flagKey(f), ...f, mode, last_seen_at: nowIso });
  }
  const rows = [...seen.values()];
  if (!rows.length) return null;
  let q = supabaseClient.from('odds_outlier_flags').upsert(rows, { onConflict: 'flag_key' });
  if (signal && q && typeof q.abortSignal === 'function') q = q.abortSignal(signal);
  const res = await q;
  return res && res.error ? res.error : null;
}

module.exports = {
  logOutlierFlags,
  flagKey,
  GUARDED_MARKETS,
  CLONE_GROUPS,
  BOOK_WEIGHTS,
  DEFAULT_CONFIG,
  readConfig,
  americanToDecimal,
  decimalToAmerican,
  weightedMedian,
  evaluateGame,
  stripFlagged,
  guardSportData,
};
