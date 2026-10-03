// Betstamp Odds Board (Kevin only) polling + column helpers.
//
// Live-update design: this board never opens /api/betstamp-stream. The
// Betstamp trial key allows ONE upstream SSE connection per key, and
// api/betstamp-stream.js opens a fresh upstream for every browser request (it
// does not fan out one upstream to many clients). A second SSE client would
// hit "connection limit reached" or bump whoever holds the slot. Instead the
// board polls REST snapshots through /api/betstamp-markets with refresh=1 so
// the 5-minute Promo cache does not freeze prices. Each poll is 3 upstream
// GETs per league (markets + fixtures + teams), far under 25 req/s.

import { betstampSnapshotUrl } from "./betstampLive.js";
import { applyUnderdogPhoneQuotes, findUnderdogPhoneGame, phoneSlateConfirmedAt } from "./underdogPredictionQuote.js";
import { teamsLikelySame } from "./promoBookmaker.js";
import { novigQuotePrice } from "./venueTakerFee.js";
import {
  betstampOddsBoardBooks,
  bookByKey,
  NOVIG_BOARD_BOOK,
  NOVIG_BOARD_BOOK_ID,
  UNDERDOG_PREDICT_BOOK_KEY,
} from "./betstampBooks.js";
import {
  isMainMarket,
  lineFieldFor,
  marketIsBetstampPolymarketOtB,
  marketSide,
  normalizeBetType,
} from "./betstampNormalize.js";

// LIVE: every 5s → 3 × 720 = 2,160 Betstamp GETs per visible hour.
// Pregame: every 15s → 720 GETs per visible hour. Hidden tabs skip polls.
export const BETSTAMP_BOARD_LIVE_POLL_MS = 5_000;
export const BETSTAMP_BOARD_PREGAME_POLL_MS = 15_000;
export const BETSTAMP_BOARD_GETS_PER_LEAGUE = 3;

export function betstampBoardSnapshotUrl({ league, live, bookIds } = {}) {
  // refresh=1 always: pregame would otherwise read a 5-minute cached snapshot.
  return betstampSnapshotUrl({ league, live: !!live, bookIds, refresh: true });
}

export function betstampBoardRequestsPerPoll(league) {
  const n = String(league || "NFL").split(/[,\s]+/).filter(Boolean).length || 1;
  return n * BETSTAMP_BOARD_GETS_PER_LEAGUE;
}

/** Betstamp GETs per hour of a visible tab at the given poll interval. */
export function betstampBoardHourlyRequests(pollMs, league = "NFL") {
  if (!(pollMs > 0)) return 0;
  return Math.round((3_600_000 / pollMs) * betstampBoardRequestsPerPoll(league));
}

const PRICE_FIELDS = ["ml_away", "ml_home", "ml_draw", "spr_away", "spr_home", "tot_over", "tot_under"];

/** Book keys with at least one priced main-line cell on any game. */
export function booksWithBoardData(games) {
  const out = new Set();
  for (const g of games || []) {
    const odds = g && g.bookOdds;
    if (!odds || typeof odds !== "object") continue;
    for (const [key, row] of Object.entries(odds)) {
      if (out.has(key) || !row) continue;
      if (PRICE_FIELDS.some((f) => row[f] != null && Number.isFinite(Number(row[f])))) out.add(key);
    }
  }
  return out;
}

/**
 * localStorage wrapper that prefixes keys, so this board's drag order does
 * not overwrite the New Odds Board's saved order (same oddsBoardOrder.js).
 */
export function wrapNamespacedStorage(namespace, storage) {
  const ns = String(namespace || "board");
  const store = () => storage ?? globalThis.localStorage;
  return {
    getItem(key) {
      const s = store();
      return s ? s.getItem(`${ns}:${key}`) : null;
    },
    setItem(key, value) {
      const s = store();
      if (s) s.setItem(`${ns}:${key}`, value);
    },
  };
}

// ── Underdog Predict column ────────────────────────────────────────────
// Same source, matching, and conversion as the New Odds Board: poll
// /api/underdog-predict (Underdog phone odds.prediction, never Betstamp
// book 196), join by teams + same-kickoff window (findUnderdogPhoneGame),
// and paint through applyUnderdogPhoneQuotes. Same poll cadence as the New
// Odds Board so both boards show identical Underdog prices.

export const BETSTAMP_BOARD_UNDERDOG_POLL_MS = 20_000; // = FREE_FEED_POLL_MS
export const BETSTAMP_BOARD_UNDERDOG_LIVE_POLL_MS = 10_000; // = FREE_FEED_LIVE_POLL_MS

/**
 * Column catalog: Betstamp books (ending ProphetX / Polymarket / Kalshi), then
 * Novig (its own public feed via the odds relay), then Underdog Predict
 * (phone feed).
 */
export function betstampOddsBoardColumns() {
  const ud = bookByKey(UNDERDOG_PREDICT_BOOK_KEY);
  return [...betstampOddsBoardBooks(), NOVIG_BOARD_BOOK, ud].filter(Boolean);
}

// Listed (column + filter chip) even when the slate has no price for them,
// so Kevin can see the book is wired. Other empty columns stay hidden.
// BetUS (614): Betstamp REST returns NFL pregame rows for it but no is_live
// rows (checked Sep 28 2026 during MNF), so it used to vanish on LIVE.
export const BETSTAMP_BOARD_PINNED_BOOK_KEYS = Object.freeze(["betmgm", "betus", NOVIG_BOARD_BOOK.key]);

/** Keep only this league's phone games (Underdog sport NFL / NCAAF / MLB). */
export function underdogSlateForLeague(slate, league) {
  if (!slate || !Array.isArray(slate.games)) return slate;
  const lg = String(league || "NFL").toUpperCase();
  return {
    ...slate,
    games: slate.games.filter((g) => {
      const sport = String((g && (g.sport || g.league)) || "").toUpperCase();
      return !sport || sport === lg;
    }),
  };
}

/**
 * Paint Underdog Predict cells onto Betstamp board games. A null slate (phone
 * not back yet) leaves games alone; a failed/empty slate clears the cells.
 */
export function withUnderdogPhone(games, slate, league, nowMs = Date.now()) {
  if (!slate) return games || [];
  // Pro board only: age Underdog cells from the slate fetch (see stampPhone).
  return applyUnderdogPhoneQuotes(games || [], underdogSlateForLeague(slate, league), {
    confirmedAt: phoneSlateConfirmedAt(slate, nowMs),
  });
}

// ── Polymarket (193) OTB hold ──────────────────────────────────────────
// Betstamp's 193 feed briefly swaps a cell's real row for an is_otb row from
// another Polymarket contract; marketIsOffered drops those, which would blank
// the cell for that poll. On the snapshot rebuild, keep the last good
// (non-OTB) 193 price for that cell for up to POLYMARKET_OTB_HOLD_MS instead.
// Only cells whose snapshot row is a 193 OTB row are held; a row that is
// simply gone still blanks.
export const POLYMARKET_OTB_HOLD_MS = 60_000;
const PM_KEY = "polymarket";
const PM_LINE_FIELD = { spr_away: "spr_away_line", spr_home: "spr_home_line", tot_over: "tot_line", tot_under: "tot_line" };
const PM_OPPOSITE = { spr_away: "spr_home", spr_home: "spr_away" };

/**
 * Remember good Polymarket cells and fill 193-OTB gaps from that memory.
 * `memory` is a Map owned by the caller (one per board session). Returns a
 * new games array; games with no held cell keep their identity.
 */
export function holdPolymarketOtbCells(games, markets, memory, { nowMs = Date.now(), holdMs = POLYMARKET_OTB_HOLD_MS } = {}) {
  const list = games || [];
  if (!(memory instanceof Map)) return list;
  // 1. Record every good (painted) Polymarket cell.
  for (const g of list) {
    const row = g?.bookOdds?.[PM_KEY];
    if (!row) continue;
    for (const field of PRICE_FIELDS) {
      const price = row[field];
      if (price == null || !Number.isFinite(Number(price))) continue;
      const lineField = PM_LINE_FIELD[field];
      memory.set(`${g.id}|${field}`, {
        price,
        size: row[`${field}_size`] ?? null,
        line: lineField ? row[lineField] ?? null : null,
        updatedAt: g.bookLineUpdatedAt?.[PM_KEY]?.[field] ?? null,
        at: nowMs,
      });
    }
  }
  // 2. Drop expired memory.
  for (const [k, v] of memory) if (!(nowMs - v.at <= holdMs)) memory.delete(k);
  // 3. Fill cells whose snapshot row was a 193 OTB substitute.
  const byId = new Map(list.map((g, i) => [String(g.id), i]));
  let out = null;
  for (const market of markets || []) {
    if (!marketIsBetstampPolymarketOtB(market) || !isMainMarket(market)) continue;
    const idx = byId.get(String(market.fixture_id));
    if (idx == null) continue;
    const game = (out || list)[idx];
    const field = lineFieldFor(normalizeBetType(market.bet_type), marketSide(market, game));
    if (!field) continue;
    const row = game.bookOdds?.[PM_KEY] || {};
    if (row[field] != null) continue;
    const held = memory.get(`${game.id}|${field}`);
    if (!held) continue;
    const lineField = PM_LINE_FIELD[field];
    if (field === "tot_over" || field === "tot_under") {
      if (row.tot_line != null && held.line != null && Number(row.tot_line) !== Number(held.line)) continue;
    } else if (PM_OPPOSITE[field]) {
      const opp = PM_OPPOSITE[field];
      const oppLine = row[`${opp}_line`];
      if (row[opp] != null && oppLine != null && held.line != null && Number(oppLine) !== -Number(held.line)) continue;
    }
    if (!out) out = list.slice();
    const nextRow = { ...row, [field]: held.price, [`${field}_size`]: held.size };
    if (lineField && held.line != null) nextRow[lineField] = held.line;
    const next = { ...game, bookOdds: { ...game.bookOdds, [PM_KEY]: nextRow } };
    if (held.updatedAt != null) {
      next.bookLineUpdatedAt = {
        ...(game.bookLineUpdatedAt || {}),
        [PM_KEY]: { ...(game.bookLineUpdatedAt?.[PM_KEY] || {}), [field]: held.updatedAt },
      };
    }
    out[idx] = next;
  }
  return out || list;
}

// ── Novig column ───────────────────────────────────────────────────────
// Same source as the New Odds Board (#240): Novig's free public v3 book
// (about 9s behind) through the odds relay /stream?venue=novig, or
// /api/novig-stream when VITE_ODDS_RELAY_URL is unset. Novig is not a
// Betstamp provider. Games join exactly like the Underdog column: the Novig
// quotes are grouped into one row per event and matched with
// findUnderdogPhoneGame (teams + same-kickoff window, same New York date).
// Cells show American odds; the age badge is the book's last change.

export const NOVIG_BOARD_KEY = NOVIG_BOARD_BOOK.key;

function novigNamesMatch(a, b) {
  if (!a || !b) return false;
  if (String(a).trim().toLowerCase() === String(b).trim().toLowerCase()) return true;
  return teamsLikelySame(a, b);
}

// All-in price: a quote Novig reports as in-game is painted after the live
// taker fee (c·P·(1−P) on top of the ask, c = the market's fee_coefficient,
// default 0.03). Pregame quotes stay raw. raw keeps the displayed ask.
function novigPrice(q) {
  const priced = novigQuotePrice(q);
  return priced.american == null ? null : priced;
}

function novigStampMs(raw) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Group Novig relay quotes into phone-slate shaped rows (one per event) so
 * findUnderdogPhoneGame can match them the way the Underdog column does.
 */
export function novigSlateFromQuotes(quotes, league) {
  const lg = String(league || "NFL").toUpperCase();
  const byEvent = new Map();
  for (const q of quotes || []) {
    if (!q) continue;
    if (q.book && q.book !== NOVIG_BOARD_KEY && Number(q.book_id) !== NOVIG_BOARD_BOOK_ID) continue;
    if (String(q.league || lg).toUpperCase() !== lg) continue;
    if (!q.away || !q.home || q.is_alt === true) continue;
    const priced = novigPrice(q);
    if (priced == null) continue;
    const american = priced.american;
    const key = `${q.away}|${q.home}|${q.start || ""}`;
    let ev = byEvent.get(key);
    if (!ev) {
      ev = { sport: lg, away: q.away, home: q.home, scheduledAt: q.start || null, live: q.is_live === true, lines: [] };
      byEvent.set(key, ev);
    }
    if (q.is_live === true) ev.live = true;
    ev.lines.push({
      betType: String(q.bet_type || "moneyline").toLowerCase(),
      side: q.side,
      line: q.line != null ? Number(q.line) : null,
      american,
      rawAmerican: priced.rawAmerican,
      prob: Number(q.odds),
      size: q.size != null && Number.isFinite(Number(q.size)) ? Number(q.size) : null,
      marketId: q.market_id || `${q.bet_type}|${q.line ?? ""}`,
      updatedAt: novigStampMs(q.updated_at),
    });
  }
  return { ok: true, games: [...byEvent.values()] };
}

function blankNovigOdds() {
  return {
    ml_away: null, ml_home: null, ml_draw: null, ml_away_size: null, ml_home_size: null,
    spr_away: null, spr_away_line: null, spr_away_size: null,
    spr_home: null, spr_home_line: null, spr_home_size: null,
    tot_line: null, tot_over: null, tot_over_size: null, tot_under: null, tot_under_size: null,
  };
}

// Main spread / total: the two-sided market priced closest to a coin flip.
function pickMainMarket(lines) {
  const byMarket = new Map();
  for (const l of lines) {
    if (!byMarket.has(l.marketId)) byMarket.set(l.marketId, []);
    byMarket.get(l.marketId).push(l);
  }
  let best = null;
  let bestGap = Infinity;
  for (const list of byMarket.values()) {
    if (list.length < 2) continue;
    const probs = list.map((l) => (Number.isFinite(l.prob) ? l.prob : 0.5));
    const gap = Math.abs(probs[0] - probs[1]);
    if (gap < bestGap) {
      bestGap = gap;
      best = list;
    }
  }
  if (best) return best;
  return byMarket.size ? [...byMarket.values()][0] : [];
}

function fillNovigOdds(odds, stamps, away, home, lines) {
  const put = (field, l, lineField) => {
    odds[field] = l.american;
    // Raw ask only when a live fee was added (tooltip: "after live fee").
    if (l.rawAmerican != null) odds[`${field}_raw`] = l.rawAmerican;
    odds[`${field}_size`] = l.size;
    if (lineField) odds[lineField] = l.line;
    if (l.updatedAt != null) stamps[field] = l.updatedAt;
  };
  for (const l of lines) {
    if (l.betType !== "moneyline") continue;
    if (novigNamesMatch(l.side, away)) put("ml_away", l);
    else if (novigNamesMatch(l.side, home)) put("ml_home", l);
  }
  for (const l of pickMainMarket(lines.filter((x) => x.betType === "spread" && x.line != null))) {
    if (novigNamesMatch(l.side, away)) put("spr_away", l, "spr_away_line");
    else if (novigNamesMatch(l.side, home)) put("spr_home", l, "spr_home_line");
  }
  for (const l of pickMainMarket(lines.filter((x) => x.betType === "total" && x.line != null))) {
    const side = String(l.side || "").toLowerCase();
    if (side.startsWith("over")) put("tot_over", l, "tot_line");
    else if (side.startsWith("under")) put("tot_under", l, "tot_line");
  }
  return odds;
}

/**
 * Paint Novig cells onto Betstamp board games. null quotes (stream not back
 * yet) leave games alone; an event with no Novig match clears its cells.
 */
export function withNovigQuotes(games, quotes, league) {
  if (quotes == null) return games || [];
  const slate = novigSlateFromQuotes(quotes, league);
  return (games || []).map((game) => {
    if (!game) return game;
    const away = game.away || game.away_team;
    const home = game.home || game.home_team;
    const hit = slate.games.length
      ? findUnderdogPhoneGame(slate, away, home, game.commence_time || game.scheduledAt || game.scheduled_at || null)
      : null;
    const odds = blankNovigOdds();
    const stamps = {};
    if (hit) fillNovigOdds(odds, stamps, away, home, hit.lines);
    return {
      ...game,
      bookOdds: { ...(game.bookOdds || {}), [NOVIG_BOARD_KEY]: odds },
      bookLineUpdatedAt: { ...(game.bookLineUpdatedAt || {}), [NOVIG_BOARD_KEY]: stamps },
      bookLineSuspended: { ...(game.bookLineSuspended || {}), [NOVIG_BOARD_KEY]: {} },
    };
  });
}
