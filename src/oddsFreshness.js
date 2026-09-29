// Frozen / suspended price masking for the Betstamp Odds Board and the New
// Odds Board. Pure: maskStaleOdds(game, { nowMs }) returns the game with
// hidden prices nulled out and the reason in game.bookLineMasked[book][field].
// Both boards run it on the row before Best is picked, so a hidden price never
// counts toward Best Odds; the cell shows a muted "—" with the reason.
//
// Order of signals, per price:
//  1. The source's own flag (game.bookLineFlags[book][field]):
//     - Betstamp is_otb / i_hidden on a priced row ("off the board"). This is
//       the flag Betstamp raises while a book has the line pulled mid-play,
//       with the last price and updated_at frozen.
//     - Underdog option / line status other than "active".
//     - Kalshi / Polymarket / Novig quotes that carry a closed / paused /
//       inactive status (applyMarketToGame tombs explicit suspends already).
//     A Betstamp row that disappears from the REST snapshot (how Circa pulls
//     its line) is still cleared by reconcileLiveGames after the last-seen
//     grace; that path is unchanged.
//  2. Book profile: a book in NON_LIVE_BOOKS, or a quote last stamped before
//     kickoff, is hidden as soon as the game is live ("pregame line").
//  3. Age / consensus fallback, for books that give no flag:
//     - LIVE: older than LIVE_MAX_AGE_MS → hidden; older than
//       LIVE_FROZEN_MIN_AGE_MS and the consensus (median of Pinnacle + the
//       exchanges, this book excluded, same line) has moved at least
//       CONSENSUS_MOVE_CENTS since the price was stamped → hidden.
//     - Pregame: same consensus rule after PREGAME_FROZEN_MIN_AGE_MS; no
//       absolute pregame age cap (soft books legitimately sit for hours).

export const ODDS_FRESHNESS = Object.freeze({
  LIVE_FROZEN_MIN_AGE_MS: 90_000,
  LIVE_MAX_AGE_MS: 5 * 60_000,
  PREGAME_FROZEN_MIN_AGE_MS: 30 * 60_000,
  PREGAME_MAX_AGE_MS: null,
  // 15 American cents (−135 → −150, −105 → +110). Beyond ±200 cents inflate,
  // so there the move is measured as implied probability instead.
  CONSENSUS_MOVE_CENTS: 15,
  CONSENSUS_MOVE_PROB: 0.03,
  CENTS_RANGE_MAX_ABS: 200,
  CONSENSUS_MIN_BOOKS: 2,
  // A reference book only counts toward consensus while this fresh.
  CONSENSUS_REF_MAX_AGE_LIVE_MS: 90_000,
  CONSENSUS_REF_MAX_AGE_PREGAME_MS: 30 * 60_000,
  CONSENSUS_TAPE_MS: 45 * 60_000,
  CONSENSUS_TAPE_MIN_STEP_MS: 2_000,
  CONSENSUS_BOOKS: Object.freeze(["pinnacle", "prophetx", "polymarket", "kalshi", "novig", "fourcasters", "underdog_predict"]),
  // Books that do not take live bets. Their lines vanish when the game goes live.
  NON_LIVE_BOOKS: Object.freeze([]),
  // Slow live books: shorter frozen gate. BetCris (Betstamp 642) moved a
  // median 38s after Pinnacle / the exchanges on PHI @ CHI 2026-09-28
  // (p75 169s) while Betstamp delivered its prints ~0.1s after updated_at.
  LIVE_FROZEN_MIN_AGE_BY_BOOK_MS: Object.freeze({ betcris: 45_000 }),
});

const FIELDS = [
  { field: "ml_away", lineField: null, size: "ml_away_size" },
  { field: "ml_home", lineField: null, size: "ml_home_size" },
  { field: "ml_draw", lineField: null, size: null },
  { field: "spr_away", lineField: "spr_away_line", size: "spr_away_size" },
  { field: "spr_home", lineField: "spr_home_line", size: "spr_home_size" },
  { field: "tot_over", lineField: "tot_line", size: "tot_over_size" },
  { field: "tot_under", lineField: "tot_line", size: "tot_under_size" },
];

const defaultTape = new Map();

function num(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
}

export function americanToProb(american) {
  const a = num(american);
  if (a == null || (a > -100 && a < 100)) return null;
  return a > 0 ? 100 / (a + 100) : -a / (-a + 100);
}

export function probToAmerican(p) {
  if (p == null || !(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -(100 * p) / (1 - p) : (100 * (1 - p)) / p;
}

// −110 → −10, +110 → +10: distance on this ladder is "cents".
function centsValue(american) {
  return american > 0 ? american - 100 : american + 100;
}

export function consensusMoved(fromAmerican, toAmerican, c = ODDS_FRESHNESS) {
  const a = num(fromAmerican);
  const b = num(toAmerican);
  if (a == null || b == null) return false;
  if (Math.abs(a) <= c.CENTS_RANGE_MAX_ABS && Math.abs(b) <= c.CENTS_RANGE_MAX_ABS) {
    return Math.abs(centsValue(a) - centsValue(b)) >= c.CONSENSUS_MOVE_CENTS;
  }
  const pa = americanToProb(a);
  const pb = americanToProb(b);
  return pa != null && pb != null && Math.abs(pa - pb) >= c.CONSENSUS_MOVE_PROB;
}

export function formatFrozenAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function median(values) {
  const s = values.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stampOf(game, book, field) {
  const n = game?.bookLineUpdatedAt?.[book]?.[field];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function flagOf(game, book, field) {
  const f = game?.bookLineFlags?.[book]?.[field];
  return f ? String(f) : null;
}

function lineOf(odds, spec) {
  return spec.lineField ? num(odds?.[spec.lineField]) : null;
}

function gameStartMs(game) {
  const t = Date.parse(game?.started_at || game?.commence_time || "");
  return Number.isFinite(t) ? t : null;
}

// Reference probabilities for one field/line, keyed by book.
function referenceProbs(game, spec, line, nowMs, live, c) {
  const maxAge = live ? c.CONSENSUS_REF_MAX_AGE_LIVE_MS : c.CONSENSUS_REF_MAX_AGE_PREGAME_MS;
  const out = new Map();
  for (const book of c.CONSENSUS_BOOKS) {
    const odds = game?.bookOdds?.[book];
    const price = num(odds?.[spec.field]);
    if (price == null) continue;
    if (lineOf(odds, spec) !== line) continue;
    if (flagOf(game, book, spec.field)) continue;
    const ts = stampOf(game, book, spec.field);
    if (ts != null && nowMs - ts > maxAge) continue;
    const p = americanToProb(price);
    if (p != null) out.set(book, p);
  }
  return out;
}

function tapeKey(game, spec, line) {
  return `${game.id}|${spec.field}|${line ?? ""}`;
}

function recordTape(tape, key, nowMs, prob, c) {
  let rows = tape.get(key);
  if (!rows) {
    rows = [];
    tape.set(key, rows);
  }
  const last = rows[rows.length - 1];
  if (last && nowMs - last[0] < c.CONSENSUS_TAPE_MIN_STEP_MS) {
    last[1] = prob;
  } else if (!last || nowMs > last[0]) {
    rows.push([nowMs, prob]);
  }
  while (rows.length && nowMs - rows[0][0] > c.CONSENSUS_TAPE_MS) rows.shift();
}

function tapeAt(tape, key, t) {
  const rows = tape.get(key);
  if (!rows || !rows.length || rows[0][0] > t) return null;
  let hit = null;
  for (const row of rows) {
    if (row[0] <= t) hit = row[1];
    else break;
  }
  return hit;
}

/**
 * Why this book's price should be hidden right now, or null.
 * ctx: { nowMs, live, tape, constants }
 */
export function staleOddsReason(game, book, spec, ctx) {
  const c = ctx.constants || ODDS_FRESHNESS;
  const odds = game?.bookOdds?.[book];
  const price = num(odds?.[spec.field]);
  if (price == null) return null;
  const flag = flagOf(game, book, spec.field);
  if (flag) return flag === "off the board" ? "suspended (off the board)" : "suspended";
  const { nowMs, live } = ctx;
  if (live && c.NON_LIVE_BOOKS.includes(book)) return "not offered live";
  const ts = stampOf(game, book, spec.field);
  if (ts == null) return null;
  const start = gameStartMs(game);
  if (live && start != null && ts < start) return "pregame line (not updated since kickoff)";
  const age = nowMs - ts;
  const maxAge = live ? c.LIVE_MAX_AGE_MS : c.PREGAME_MAX_AGE_MS;
  if (maxAge != null && age >= maxAge) return `frozen ${formatFrozenAge(age)}`;
  const frozenAge = live
    ? (c.LIVE_FROZEN_MIN_AGE_BY_BOOK_MS?.[book] ?? c.LIVE_FROZEN_MIN_AGE_MS)
    : c.PREGAME_FROZEN_MIN_AGE_MS;
  if (age < frozenAge) return null;
  const line = lineOf(odds, spec);
  const refs = referenceProbs(game, spec, line, nowMs, live, c);
  refs.delete(book);
  if (refs.size < c.CONSENSUS_MIN_BOOKS) return null;
  const nowProb = median([...refs.values()]);
  const nowAmerican = probToAmerican(nowProb);
  const thenProb = ctx.tape ? tapeAt(ctx.tape, tapeKey(game, spec, line), ts) : null;
  // With consensus history: did the market move since this price was stamped?
  // Without it (tape started later): is the price that far from the market now?
  const from = thenProb != null ? probToAmerican(thenProb) : price;
  if (consensusMoved(from, nowAmerican, c)) return `frozen ${formatFrozenAge(age)}, market moved`;
  return null;
}

/**
 * Record consensus for every field/line on this game into the tape.
 */
export function recordConsensus(game, { nowMs = Date.now(), tape = defaultTape, constants = ODDS_FRESHNESS } = {}) {
  if (!game || game.id == null) return;
  const live = !!game.is_live;
  const lines = new Map();
  for (const spec of FIELDS) {
    for (const book of constants.CONSENSUS_BOOKS) {
      const odds = game.bookOdds?.[book];
      if (num(odds?.[spec.field]) == null) continue;
      const line = lineOf(odds, spec);
      const k = `${spec.field}|${line ?? ""}`;
      if (!lines.has(k)) lines.set(k, { spec, line });
    }
  }
  for (const { spec, line } of lines.values()) {
    const refs = referenceProbs(game, spec, line, nowMs, live, constants);
    if (!refs.size) continue;
    recordTape(tape, tapeKey(game, spec, line), nowMs, median([...refs.values()]), constants);
  }
}

/**
 * Game copy with frozen / suspended prices removed. Returns the same object
 * when nothing is hidden. bookLineMasked[book][field] carries the reason.
 */
export function maskStaleOdds(game, { nowMs = Date.now(), tape = defaultTape, constants = ODDS_FRESHNESS, record = true } = {}) {
  if (!game || !game.bookOdds) return game;
  if (record && tape) recordConsensus(game, { nowMs, tape, constants });
  const ctx = { nowMs, live: !!game.is_live, tape, constants };
  let masked = null;
  for (const [book, odds] of Object.entries(game.bookOdds)) {
    if (!odds) continue;
    for (const spec of FIELDS) {
      const reason = staleOddsReason(game, book, spec, ctx);
      if (!reason) continue;
      if (!masked) masked = { odds: { ...game.bookOdds }, reasons: {} };
      if (masked.odds[book] === odds) masked.odds[book] = { ...odds };
      masked.odds[book][spec.field] = null;
      if (spec.size) masked.odds[book][spec.size] = null;
      (masked.reasons[book] ||= {})[spec.field] = reason;
    }
  }
  if (!masked) return game;
  // Drop a spread / total line only when both of its sides are hidden.
  for (const [book, reasons] of Object.entries(masked.reasons)) {
    const o = masked.odds[book];
    if (reasons.spr_away && o.spr_home == null) o.spr_away_line = null;
    if (reasons.spr_home && o.spr_away == null) o.spr_home_line = null;
    if ((reasons.tot_over || reasons.tot_under) && o.tot_over == null && o.tot_under == null) o.tot_line = null;
  }
  return { ...game, bookOdds: masked.odds, bookLineMasked: masked.reasons };
}

export function maskedOddsReason(game, book, field) {
  return game?.bookLineMasked?.[book]?.[field] || null;
}

// Copy-on-write so cloned board games never share a flag map.
export function setLineFlag(game, book, field, flag) {
  if (!game || !book || !field) return;
  const cur = game.bookLineFlags?.[book]?.[field] || null;
  const next = flag || null;
  if (cur === next) return;
  game.bookLineFlags = {
    ...(game.bookLineFlags || {}),
    [book]: { ...(game.bookLineFlags?.[book] || {}), [field]: next },
  };
}

export function resetConsensusTape(tape = defaultTape) {
  tape.clear();
}
