// Betstamp market snapshot → Odds Board row model.
// Isolated from The Odds API transform so the existing board stays untouched.

import {
  bookById,
  BETSTAMP_TRIAL_BOOKS,
  isPmWinProbBook,
  sportByLeague,
  UNDERDOG_PREDICT_BOOK_KEY,
} from "./betstampBooks.js";
import { americanToImpliedProb, impliedProbToAmerican } from "./blendAskLadder.js";
import { BETSTAMP_RECONCILE_CLEAR_GRACE_MS } from "./betstampLive.js";

export { isPmWinProbBook };

export function decimalToAmerican(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n <= 1) return null;
  if (n >= 2) return Math.round((n - 1) * 100);
  return Math.round(-100 / (n - 1));
}

// Betstamp docs show decimal odds. Some feeds may already send American.
// 0 < n < 1 is a PM contract / win probability (same as OddsBoard / unhedgedTape).
export function toAmericanOdds(odds) {
  if (odds == null || odds === "") return null;
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return null;
  if (n > 0 && n < 1) return impliedProbToAmerican(n);
  if (n <= -100 || n >= 100) return Math.round(n);
  if (n > 1) return decimalToAmerican(n);
  return null;
}

// Same American → implied win-prob as OddsBoard.jsx / +EV (`impliedProb`).
export function formatWinProb(american) {
  const p = americanToImpliedProb(american);
  if (p == null) return null;
  return `${(p * 100).toFixed(1)}%`;
}

export function cellShowsWinProb(bookKey, books) {
  if (isPmWinProbBook(bookKey)) return true;
  if (bookKey === "best") {
    return (books || []).some((b) => isPmWinProbBook(b.key));
  }
  return false;
}

export function marketSize(market) {
  if (!market || typeof market !== "object") return null;
  const raw = market.size ?? market.bet_limit ?? market.limit ?? market.max_bet ?? market.liquidity;
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

export function marketEventTime(market) {
  if (!market || typeof market !== "object") return null;
  return market.updated_at || market.updatedAt || market.timestamp || market.ts || market.created_at || null;
}

export function marketUpdatedAtMs(market, fallbackMs) {
  const raw = marketEventTime(market);
  if (raw != null && raw !== "") {
    const parsed = typeof raw === "number" ? raw : Date.parse(raw);
    if (isFinite(parsed) && parsed > 0) return parsed;
  }
  if (fallbackMs != null && isFinite(fallbackMs)) return fallbackMs;
  return null;
}

export function lineFieldFor(betType, side) {
  if (betType === "moneyline") {
    if (side === "away") return "ml_away";
    if (side === "home") return "ml_home";
    if (side === "draw") return "ml_draw";
  }
  if (betType === "spread") {
    if (side === "away") return "spr_away";
    if (side === "home") return "spr_home";
  }
  if (betType === "total") {
    if (side === "over") return "tot_over";
    if (side === "under") return "tot_under";
  }
  return null;
}

export function cellLineFields(marketKey) {
  if (marketKey === "ml") return { top: "ml_away", bot: "ml_home" };
  if (marketKey === "spr") return { top: "spr_away", bot: "spr_home" };
  if (marketKey === "tot") return { top: "tot_over", bot: "tot_under" };
  return { top: null, bot: null };
}

export function formatCompactAge(updatedAt, now = Date.now()) {
  if (updatedAt == null || !isFinite(updatedAt)) return null;
  const ms = Math.max(0, now - updatedAt);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  // Keep the second count through 1m59s. Only coarsen at 2 minutes.
  if (sec < 120) return `1m${String(sec - 60).padStart(2, "0")}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.max(1, Math.floor(ms / 3_600_000))}h`;
  return `${Math.max(1, Math.floor(ms / 86_400_000))}d`;
}

/** Amber once the second-count window ends so a frozen 5m stamp is obvious. */
export function compactAgeTone(updatedAt, now = Date.now()) {
  if (updatedAt == null || !isFinite(updatedAt)) return "#6b7280";
  const ms = Math.max(0, now - updatedAt);
  if (ms >= 120_000) return "#f59e0b";
  if (ms >= 60_000) return "#ca8a04";
  return "#6b7280";
}

// Quiet soft books (no SSE) whose newest Betstamp print is ≥2m old.
export function staleLiveBookLabels(games, books, nowMs, { staleMs = 120_000 } = {}) {
  const now = nowMs != null && isFinite(nowMs) ? nowMs : Date.now();
  const out = [];
  for (const book of books || []) {
    if (!book?.key) continue;
    let newest = null;
    for (const game of games || []) {
      if (!game?.is_live) continue;
      const stamps = game.bookLineUpdatedAt?.[book.key] || {};
      for (const t of Object.values(stamps)) {
        if (typeof t === "number" && isFinite(t) && (newest == null || t > newest)) newest = t;
      }
    }
    if (newest != null && now - newest >= staleMs) {
      out.push({ key: book.key, label: book.label, updatedAt: newest, age: formatCompactAge(newest, now) });
    }
  }
  return out;
}

export function lineUpdatedAt(game, bookKey, field) {
  if (!game || !bookKey || !field) return null;
  const n = game.bookLineUpdatedAt?.[bookKey]?.[field];
  return typeof n === "number" && isFinite(n) ? n : null;
}

// Best-column age: newest tick among books currently offering that best price.
export function bestLineUpdatedAt(game, field, books) {
  let newest = null;
  for (const b of books || []) {
    const t = lineUpdatedAt(game, b.key, field);
    if (t != null && (newest == null || t > newest)) newest = t;
  }
  return newest;
}

function setLineUpdatedAt(game, bookKey, field, ts) {
  if (!game || !bookKey || !field || ts == null || !isFinite(ts)) return;
  if (!game.bookLineUpdatedAt) game.bookLineUpdatedAt = {};
  if (!game.bookLineUpdatedAt[bookKey]) game.bookLineUpdatedAt[bookKey] = {};
  game.bookLineUpdatedAt[bookKey][field] = ts;
}

export function lineIsSuspended(game, bookKey, field) {
  if (!game || !bookKey || !field) return false;
  return game.bookLineSuspended?.[bookKey]?.[field] === true;
}

export function lineConfirmedAt(game, bookKey, field) {
  const n = game?.bookLineConfirmedAt?.[bookKey]?.[field];
  return typeof n === "number" && isFinite(n) ? n : null;
}

// Last time *we* saw this quote (receive / reconcile), not Betstamp's print time.
export function quoteLastSeenMs(game, bookKey, field) {
  return lineConfirmedAt(game, bookKey, field) ?? lineUpdatedAt(game, bookKey, field);
}

const NOT_OFFERED_MARKET_STATUSES = new Set([
  "suspended",
  "suspend",
  "taken_down",
  "unavailable",
  "inactive",
  "closed",
  "removed",
  "offline",
  "halted",
  "locked",
  "disabled",
  "dead",
  "void",
  "hidden",
  "pulled",
]);

export function marketIsOtB(market) {
  if (!market || typeof market !== "object") return false;
  return market.is_otb === true
    || market.otb === true
    || market.off_the_board === true
    || market.is_off_the_board === true;
}

export function marketHasOfferableOdds(market) {
  return toAmericanOdds(market?.odds) != null;
}

// Explicit take-down — not mere is_otb. Live soft books flap is_otb with and
// without a decimal; that must not paint OFF. Suspend / inactive / taken_down
// still tombs immediately.
export function marketIsExplicitlySuspended(market) {
  if (!market || typeof market !== "object") return false;
  if (market.suspended === true || market.is_suspended === true || market.isSuspended === true) return true;
  if (market.active === false || market.is_active === false || market.isActive === false) return true;
  if (market.available === false || market.is_available === false || market.isAvailable === false) return true;
  const status = String(
    market.status ?? market.market_status ?? market.line_status ?? market.odds_status ?? "",
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return !!(status && NOT_OFFERED_MARKET_STATUSES.has(status));
}

// Public Betstamp docs do not document a suspend/tombstone field. Honor one
// when a payload actually sends it; otherwise presence in the REST snapshot
// is the availability signal.
//
// Live soft-book mains often arrive with is_otb=true AND a finite decimal
// Kevin can still bet (FanDuel/DK/Caesars etc.). Do not hide those. OTB
// alone is only OFF when there is no offerable price *and* reconcile has
// held that miss past the last-seen grace (SSE must not yank on the flap).
export function marketIsOffered(market) {
  if (!market || typeof market !== "object") return false;
  if (marketIsExplicitlySuspended(market)) return false;
  if (marketIsOtB(market) && !marketHasOfferableOdds(market)) return false;
  return true;
}

export function marketIsLiveQuote(market) {
  if (!market || typeof market !== "object") return false;
  if (market.is_live === true || market.live === true) return true;
  const status = String(market.status ?? market.market_status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return status === "live" || status === "in_play" || status === "inplay";
}

export function quotePresenceKey({ fixtureId, bookKey, betType, side } = {}) {
  const fid = fixtureId != null ? String(fixtureId) : "";
  const book = bookKey || "";
  const bt = normalizeBetType(betType);
  const s = String(side || "").trim().toLowerCase();
  if (!fid || !book || !bt || !s) return null;
  return `${fid}|${book}|${bt}|${s}`;
}

// fixture + book + bet_type + side, plus Betstamp's number for spread/total mains.
export function quoteOfferKey({ fixtureId, bookKey, betType, side, line } = {}) {
  const presence = quotePresenceKey({ fixtureId, bookKey, betType, side });
  if (!presence) return null;
  const bt = normalizeBetType(betType);
  if (bt === "spread" || bt === "total") {
    const n = line == null || line === "" ? "" : String(Number(line));
    return `${presence}|${n}`;
  }
  return presence;
}

const BOARD_QUOTE_SPECS = [
  { betType: "moneyline", side: "away", field: "ml_away" },
  { betType: "moneyline", side: "home", field: "ml_home" },
  { betType: "moneyline", side: "draw", field: "ml_draw" },
  { betType: "spread", side: "away", field: "spr_away", lineField: "spr_away_line" },
  { betType: "spread", side: "home", field: "spr_home", lineField: "spr_home_line" },
  { betType: "total", side: "over", field: "tot_over", lineField: "tot_line" },
  { betType: "total", side: "under", field: "tot_under", lineField: "tot_line" },
];

const PAINT_ODDS_FIELDS = [
  "ml_away", "ml_home", "ml_draw",
  "spr_away", "spr_away_line", "spr_home", "spr_home_line",
  "tot_over", "tot_under", "tot_line",
];

// Display identity for the live grid. Price / line / OFF / score / break —
// not updatedAt. Age-only SSE heartbeats must not rebuild every cell
// (Kevin's recording: whole slate blanks ~1s then snaps back).
export function liveBoardPaintKey(games) {
  if (!games?.length) return "";
  const chunks = [];
  for (const g of games) {
    chunks.push(
      g?.id ?? "",
      g?.is_live ? "1" : "0",
      g?.away_score ?? "",
      g?.home_score ?? "",
      g?.status ?? "",
      g?.period ?? "",
      g?.is_halftime ? "1" : "0",
      g?.in_break ? "1" : "0",
    );
    const odds = g?.bookOdds || {};
    const sus = g?.bookLineSuspended || {};
    const books = Object.keys(odds).sort();
    for (const book of books) {
      const o = odds[book] || {};
      const s = sus[book] || {};
      chunks.push(book);
      for (const field of PAINT_ODDS_FIELDS) {
        chunks.push(o[field] ?? "");
      }
      for (const field of PAINT_ODDS_FIELDS) {
        chunks.push(s[field] ? "1" : "0");
      }
    }
  }
  return chunks.join("\x1f");
}

export function liveGamePaintKey(game) {
  return liveBoardPaintKey(game ? [game] : []);
}

export function listedBoardQuotes(game) {
  const out = [];
  for (const [bookKey, odds] of Object.entries(game?.bookOdds || {})) {
    if (!odds) continue;
    for (const spec of BOARD_QUOTE_SPECS) {
      if (odds[spec.field] == null) continue;
      out.push({
        bookKey,
        betType: spec.betType,
        side: spec.side,
        field: spec.field,
        lineField: spec.lineField || null,
        price: odds[spec.field],
        line: spec.lineField ? odds[spec.lineField] ?? null : null,
        updatedAt: lineUpdatedAt(game, bookKey, spec.field),
      });
    }
  }
  return out;
}

export function offeredPresenceKeysFromMarkets(markets, gamesById) {
  const keys = new Set();
  for (const market of asList(markets, ["markets", "data"])) {
    if (!isMainMarket(market) || !marketIsOffered(market)) continue;
    if (toAmericanOdds(market.odds) == null) continue;
    const bookKey = bookKeyForMarket(market);
    const fid = market.fixture_id != null ? String(market.fixture_id) : null;
    if (!bookKey || !fid) continue;
    const game = gamesById && typeof gamesById.get === "function" ? gamesById.get(fid) : null;
    const side = marketSide(market, game);
    const key = quotePresenceKey({ fixtureId: fid, bookKey, betType: market.bet_type, side });
    if (key) keys.add(key);
  }
  return keys;
}

// Fixtures the snapshot actually mentioned (any FT main, even unoffered).
// A live game with zero rows is a truncated pull, not "every book went OFF".
export function fixtureIdsFromMarkets(markets) {
  const ids = new Set();
  for (const market of asList(markets, ["markets", "data"])) {
    if (!isMainMarket(market)) continue;
    const fid = market.fixture_id != null ? String(market.fixture_id) : null;
    if (fid) ids.add(fid);
  }
  return ids;
}

function cloneBookMap(src) {
  const out = {};
  for (const [k, v] of Object.entries(src || {})) out[k] = { ...v };
  return out;
}

function cloneBoardGames(games) {
  return (games || []).map((g) => ({
    ...g,
    bookOdds: cloneBookMap(g.bookOdds),
    bookUpdatedAt: { ...(g.bookUpdatedAt || {}) },
    bookLineUpdatedAt: cloneBookMap(g.bookLineUpdatedAt),
    bookLineConfirmedAt: cloneBookMap(g.bookLineConfirmedAt),
    bookLineSuspended: cloneBookMap(g.bookLineSuspended),
  }));
}

function confirmSideQuote(game, bookKey, field, nowMs) {
  if (!game || !bookKey || !field) return;
  if (nowMs != null && isFinite(nowMs)) {
    if (!game.bookLineConfirmedAt) game.bookLineConfirmedAt = {};
    if (!game.bookLineConfirmedAt[bookKey]) game.bookLineConfirmedAt[bookKey] = {};
    game.bookLineConfirmedAt[bookKey][field] = nowMs;
  }
  if (game.bookLineSuspended?.[bookKey]) {
    game.bookLineSuspended[bookKey][field] = false;
  }
}

function clearSideQuote(game, bookKey, betType, side) {
  if (!game || !bookKey || !side) return;
  const field = lineFieldFor(betType, side);
  if (!field) return;
  if (!game.bookOdds[bookKey]) game.bookOdds[bookKey] = emptyBookOdds();
  const odds = game.bookOdds[bookKey];
  if (betType === "moneyline") {
    if (side === "away") {
      odds.ml_away = null;
      odds.ml_away_size = null;
    } else if (side === "home") {
      odds.ml_home = null;
      odds.ml_home_size = null;
    } else if (side === "draw") {
      odds.ml_draw = null;
      odds.ml_draw_size = null;
    }
  } else if (betType === "spread") {
    if (side === "away") {
      odds.spr_away = null;
      odds.spr_away_size = null;
      odds.spr_away_line = null;
    } else if (side === "home") {
      odds.spr_home = null;
      odds.spr_home_size = null;
      odds.spr_home_line = null;
    }
  } else if (betType === "total") {
    if (side === "over") {
      odds.tot_over = null;
      odds.tot_over_size = null;
    } else if (side === "under") {
      odds.tot_under = null;
      odds.tot_under_size = null;
    }
    if (odds.tot_over == null && odds.tot_under == null) odds.tot_line = null;
  }
  if (game.bookLineUpdatedAt?.[bookKey]) {
    delete game.bookLineUpdatedAt[bookKey][field];
  }
  if (!game.bookLineSuspended) game.bookLineSuspended = {};
  if (!game.bookLineSuspended[bookKey]) game.bookLineSuspended[bookKey] = {};
  game.bookLineSuspended[bookKey][field] = true;
}

export function asList(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys || []) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  const vals = Object.values(payload);
  if (
    vals.length &&
    vals.every((v) => v && typeof v === "object" && !Array.isArray(v) && (v.id || v.fixture_id || v.name))
  ) {
    return vals;
  }
  return [];
}

export function normalizeBetType(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "ml" || s === "h2h" || s === "money_line" || s === "winner") return "moneyline";
  if (s === "spread" || s === "spreads" || s === "handicap" || s === "run_line" || s === "puck_line") return "spread";
  if (s === "total" || s === "totals" || s === "over_under" || s === "ou") return "total";
  return s;
}

export function normalizePeriod(raw) {
  const s = String(raw || "FT").trim().toUpperCase();
  if (s === "FULL" || s === "FULLTIME" || s === "FULL_TIME" || s === "REG" || s === "REGULATION") return "FT";
  return s;
}

function emptyBookOdds() {
  return {
    ml_away: null,
    ml_home: null,
    ml_draw: null,
    ml_away_size: null,
    ml_home_size: null,
    ml_draw_size: null,
    ml_away_no: null,
    ml_home_no: null,
    ml_draw_no: null,
    ml_away_no_size: null,
    ml_home_no_size: null,
    ml_draw_no_size: null,
    spr_away: null,
    spr_away_line: null,
    spr_away_size: null,
    spr_home: null,
    spr_home_line: null,
    spr_home_size: null,
    tot_line: null,
    tot_over: null,
    tot_over_size: null,
    tot_under: null,
    tot_under_size: null,
  };
}

export function emptyBookOddsForBooks(books = BETSTAMP_TRIAL_BOOKS) {
  const out = {};
  for (const b of books) out[b.key] = emptyBookOdds();
  return out;
}

function teamField(team, ...keys) {
  if (!team) return "";
  if (typeof team === "string") return team;
  for (const k of keys) {
    if (team[k]) return String(team[k]);
  }
  return "";
}

export function indexById(list) {
  const map = new Map();
  for (const row of list || []) {
    const id = row?.id ?? row?.fixture_id ?? row?.team_id;
    if (id != null) map.set(String(id), row);
  }
  return map;
}

export function fixtureHomeAway(fixture, teamsById) {
  const homeObj = fixture?.home_team || fixture?.home || fixture?.homeTeam || null;
  const awayObj = fixture?.away_team || fixture?.away || fixture?.awayTeam || null;
  const homeId = fixture?.home_team_id ?? fixture?.home_id ?? homeObj?.id ?? null;
  const awayId = fixture?.away_team_id ?? fixture?.away_id ?? awayObj?.id ?? null;
  const homeTeam = (homeId != null && teamsById.get(String(homeId))) || homeObj || {};
  const awayTeam = (awayId != null && teamsById.get(String(awayId))) || awayObj || {};
  return {
    homeId: homeId != null ? String(homeId) : null,
    awayId: awayId != null ? String(awayId) : null,
    home: teamField(homeTeam, "name", "full_name", "display_name", "team_name") || teamField(homeObj, "name", "full_name", "display_name"),
    away: teamField(awayTeam, "name", "full_name", "display_name", "team_name") || teamField(awayObj, "name", "full_name", "display_name"),
    homeAbbr: teamField(homeTeam, "abbreviation", "abbr", "short_name", "code") || teamField(homeObj, "abbreviation", "abbr", "short_name"),
    awayAbbr: teamField(awayTeam, "abbreviation", "abbr", "short_name", "code") || teamField(awayObj, "abbreviation", "abbr", "short_name"),
  };
}

function firstParseableTime(...vals) {
  for (const raw of vals) {
    if (raw == null || raw === "") continue;
    if (typeof raw === "number" && isFinite(raw) && raw > 0) {
      const ms = raw < 1e12 ? raw * 1000 : raw;
      return new Date(ms).toISOString();
    }
    const s = String(raw).trim();
    if (!s) continue;
    if (isFinite(Date.parse(s))) return s;
  }
  return null;
}

export function fixtureCommence(fixture) {
  if (!fixture || typeof fixture !== "object") return null;
  // Betstamp fixtures use `date` (ISO kickoff). Keep the older aliases too.
  return firstParseableTime(
    fixture.start_date,
    fixture.start_time,
    fixture.commence_time,
    fixture.starts_at,
    fixture.scheduled_at,
    fixture.start,
    fixture.date,
    fixture.kickoff,
    fixture.kickoff_time,
    fixture.game_time,
    fixture.game_date,
    fixture.datetime,
    fixture.startDate,
    fixture.startTime,
  );
}

export function fixtureStatus(fixture) {
  if (!fixture || typeof fixture !== "object") return "";
  return String(fixture.status || fixture.state || fixture.fixture_status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function firstScalar(...vals) {
  for (const v of vals) {
    if (v == null || typeof v === "object") continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

// Clock / period tokens used by the live Best age gate (60s moving, 4 min at half).
export function fixtureLiveMeta(fixture) {
  if (!fixture || typeof fixture !== "object") {
    return { status: null, period: null, clock: null, is_halftime: false, in_break: false };
  }
  const live = fixture.live && typeof fixture.live === "object" ? fixture.live : null;
  const clockObj = fixture.clock && typeof fixture.clock === "object" ? fixture.clock : null;
  return {
    status: firstScalar(fixture.status, fixture.state, fixture.fixture_status, live?.status),
    period: firstScalar(
      fixture.period,
      fixture.live_period,
      fixture.clock_period,
      fixture.period_name,
      fixture.game_period,
      fixture.current_period,
      live?.period,
      clockObj?.period,
    ),
    clock: firstScalar(
      typeof fixture.clock === "string" || typeof fixture.clock === "number" ? fixture.clock : null,
      fixture.display_clock,
      fixture.game_clock,
      live?.clock,
      clockObj?.display,
      clockObj?.time,
    ),
    is_halftime: !!(fixture.is_halftime || live?.is_halftime),
    in_break: !!(fixture.in_break || live?.in_break),
  };
}

export function applyFixtureMeta(games, fixtures) {
  if (!games?.length) return games || [];
  const byId = new Map();
  for (const fixture of fixtures || []) {
    const id = fixture?.id ?? fixture?.fixture_id;
    if (id != null) byId.set(String(id), fixture);
  }
  if (!byId.size) return games;
  let changed = false;
  const next = games.map((game) => {
    const fixture = byId.get(String(game.id));
    if (!fixture) return game;
    const meta = fixtureLiveMeta(fixture);
    const isLive = fixtureIsLive(fixture) || !!game.is_live;
    if (
      (game.status || null) === meta.status
      && (game.period || null) === meta.period
      && (game.clock || null) === meta.clock
      && !!game.is_halftime === meta.is_halftime
      && !!game.in_break === meta.in_break
      && game.is_live === isLive
    ) {
      return game;
    }
    changed = true;
    return { ...game, ...meta, is_live: isLive };
  });
  return changed ? next : games;
}

const CLOSED_FIXTURE_STATUSES = new Set([
  "closed",
  "final",
  "completed",
  "complete",
  "finished",
  "ended",
  "settled",
  "official",
  "finalized",
]);

export function fixtureIsClosed(fixture) {
  return CLOSED_FIXTURE_STATUSES.has(fixtureStatus(fixture));
}

export function fixtureIsLive(fixture) {
  if (!fixture) return false;
  if (fixtureIsClosed(fixture)) return false;
  if (fixture.is_live === true) return true;
  const status = fixtureStatus(fixture);
  return status === "live" || status === "in" || status === "in_play" || status === "inplay";
}

function namesEqual(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function marketSide(market, game) {
  const type = String(market?.side_type || "").trim().toLowerCase();
  if (type === "away") return "away";
  if (type === "home") return "home";
  if (type === "over") return "over";
  if (type === "under") return "under";
  const side = String(market?.side || "").trim();
  const sideLow = side.toLowerCase();
  if (sideLow === "over" || sideLow === "o") return "over";
  if (sideLow === "under" || sideLow === "u") return "under";
  if (game) {
    if (namesEqual(side, game.away) || namesEqual(side, game.awayAbbr)) return "away";
    if (namesEqual(side, game.home) || namesEqual(side, game.homeAbbr)) return "home";
    const teamId = market.team_id != null ? String(market.team_id) : "";
    if (teamId && game.awayId && teamId === String(game.awayId)) return "away";
    if (teamId && game.homeId && teamId === String(game.homeId)) return "home";
  }
  return null;
}

export function bookKeyForMarket(market) {
  const id = market?.odd_provider_id ?? market?.book_id ?? market?.provider_id;
  return bookById(id)?.key || null;
}

function applySideToOdds(odds, betType, side, price, size, line) {
  if (!odds || !side) return;
  if (betType === "moneyline") {
    if (side === "away") {
      odds.ml_away = price;
      odds.ml_away_size = size;
    } else if (side === "home") {
      odds.ml_home = price;
      odds.ml_home_size = size;
    }
    return;
  }
  if (betType === "spread") {
    if (side === "away") {
      odds.spr_away = price;
      odds.spr_away_size = size;
      if (line != null) odds.spr_away_line = line;
    } else if (side === "home") {
      odds.spr_home = price;
      odds.spr_home_size = size;
      if (line != null) odds.spr_home_line = line;
    }
    return;
  }
  if (betType === "total") {
    if (line != null) odds.tot_line = line;
    if (side === "over") {
      odds.tot_over = price;
      odds.tot_over_size = size;
    } else if (side === "under") {
      odds.tot_under = price;
      odds.tot_under_size = size;
    }
  }
}

export function marketLine(market) {
  const n = market?.number ?? market?.line ?? market?.point;
  if (n == null || n === "") return null;
  const v = Number(n);
  return isFinite(v) ? v : null;
}

export function isBoardMarket(market) {
  if (!market) return false;
  if (normalizePeriod(market.period) !== "FT") return false;
  const bt = normalizeBetType(market.bet_type);
  return bt === "moneyline" || bt === "spread" || bt === "total";
}

export function isMainMarket(market) {
  return isBoardMarket(market) && market.is_alt !== true;
}

export function spreadAwayLine(market, game) {
  const line = marketLine(market);
  if (line == null) return null;
  const side = marketSide(market, game);
  if (side === "home") return -line;
  if (side === "away") return line;
  return null;
}

function cloneGameShell(game) {
  return {
    id: game.id,
    sport: game.sport,
    league: game.league,
    away: game.away,
    home: game.home,
    awayAbbr: game.awayAbbr,
    homeAbbr: game.homeAbbr,
    awayId: game.awayId,
    homeId: game.homeId,
    commence_time: game.commence_time,
    is_live: game.is_live,
    home_score: game.home_score,
    away_score: game.away_score,
    status: game.status,
    bookOdds: emptyBookOddsForBooks(),
    bookUpdatedAt: {},
    bookLineUpdatedAt: {},
    bookLineConfirmedAt: {},
    bookLineSuspended: {},
  };
}

export function gameHasMarketPrices(game, marketKey) {
  for (const odds of Object.values(game?.bookOdds || {})) {
    if (!odds) continue;
    if (marketKey === "ml" && (odds.ml_away != null || odds.ml_home != null)) return true;
    if (marketKey === "spr" && (odds.spr_away != null || odds.spr_home != null)) return true;
    if (marketKey === "tot" && (odds.tot_over != null || odds.tot_under != null)) return true;
  }
  return false;
}

function lineMapGet(map, line) {
  const key = Number(line);
  if (!map.has(key)) {
    map.set(key, { line: key, isMain: false, game: null });
  }
  return map.get(key);
}

// Full FT moneyline / spread / total ladder for one fixture, including alts.
// Main-board snapshot path stays mains-only via isMainMarket.
export function fixtureAltLadders({ markets, game, nowMs } = {}) {
  const seenAt = nowMs != null && isFinite(nowMs) ? nowMs : Date.now();
  if (!game) return { moneyline: null, spreads: [], totals: [] };
  const fid = String(game.id);
  const list = asList(markets, ["markets", "data"]).filter((m) => {
    if (!m || String(m.fixture_id) !== fid) return false;
    return isBoardMarket(m);
  });
  const mlGame = cloneGameShell(game);
  let mlMain = false;
  const spreads = new Map();
  const totals = new Map();

  for (const market of list) {
    const bt = normalizeBetType(market.bet_type);
    const main = market.is_alt !== true;
    if (bt === "moneyline") {
      applyMarketToGame(mlGame, market, { receivedAt: seenAt, allowAlt: true });
      if (main) mlMain = true;
      continue;
    }
    if (bt === "spread") {
      const line = spreadAwayLine(market, game);
      if (line == null) continue;
      const row = lineMapGet(spreads, line);
      if (!row.game) row.game = cloneGameShell(game);
      applyMarketToGame(row.game, market, { receivedAt: seenAt, allowAlt: true });
      if (main) row.isMain = true;
      continue;
    }
    if (bt === "total") {
      const line = marketLine(market);
      if (line == null) continue;
      const row = lineMapGet(totals, line);
      if (!row.game) row.game = cloneGameShell(game);
      applyMarketToGame(row.game, market, { receivedAt: seenAt, allowAlt: true });
      if (main) row.isMain = true;
    }
  }

  const sortRows = (map, marketKey) => [...map.values()]
    .filter((r) => r.game && gameHasMarketPrices(r.game, marketKey))
    .sort((a, b) => a.line - b.line);

  return {
    moneyline: gameHasMarketPrices(mlGame, "ml") ? { game: mlGame, isMain: mlMain } : null,
    spreads: sortRows(spreads, "spr"),
    totals: sortRows(totals, "tot"),
  };
}

function tickLabel(market, game, side, betType) {
  const away = game?.awayAbbr || game?.away || "AWAY";
  const home = game?.homeAbbr || game?.home || "HOME";
  if (betType === "moneyline") return `${side === "home" ? home : away} ML`;
  if (betType === "spread") {
    const line = marketLine(market);
    const team = side === "home" ? home : away;
    return `${team} ${line == null ? "spread" : (line > 0 ? `+${line}` : `${line}`)}`;
  }
  if (betType === "total") {
    const line = marketLine(market);
    return `${side === "under" ? "u" : "o"}${line == null ? "" : line}`;
  }
  return betType || "mkt";
}

export function unwrapStreamPayload(data) {
  if (!data || typeof data !== "object") return { markets: [], ingestTs: null };
  const ingestTs = data.ingest_ts ?? data.ingestTs ?? null;
  const payload = data.payload !== undefined ? data.payload : data;
  if (!payload || typeof payload !== "object") return { markets: [], ingestTs };
  if (Array.isArray(payload)) return { markets: payload, ingestTs };
  if (Array.isArray(payload.markets)) return { markets: payload.markets, ingestTs };
  if (payload.market && typeof payload.market === "object") return { markets: [payload.market], ingestTs };
  if (payload.odds != null || payload.bet_type || payload.fixture_id) return { markets: [payload], ingestTs };
  return { markets: [], ingestTs };
}

function newGameFromFixture(fixture, teamsById, nowMs) {
  const sides = fixtureHomeAway(fixture, teamsById);
  const league = String(fixture.league || fixture.sport || "NFL").toUpperCase();
  const sport = sportByLeague(league)?.id || "americanfootball_nfl";
  const commence = fixtureCommence(fixture);
  const game = {
    id: String(fixture.id || fixture.fixture_id),
    sport,
    league,
    away: sides.away || sides.awayAbbr || "Away",
    home: sides.home || sides.homeAbbr || "Home",
    awayAbbr: sides.awayAbbr,
    homeAbbr: sides.homeAbbr,
    awayId: sides.awayId,
    homeId: sides.homeId,
    commence_time: commence,
    ...fixtureLiveMeta(fixture),
    is_live: fixtureIsLive(fixture),
    home_score: fixture.home_score ?? fixture.homeScore ?? null,
    away_score: fixture.away_score ?? fixture.awayScore ?? null,
    bookOdds: emptyBookOddsForBooks(),
    bookUpdatedAt: {},
    bookLineUpdatedAt: {},
    bookLineConfirmedAt: {},
    bookLineSuspended: {},
  };
  return game;
}

function stubGameFromMarket(market, nowMs) {
  const league = String(market.league || "NFL").toUpperCase();
  const sport = sportByLeague(league)?.id || "americanfootball_nfl";
  const sideName = String(market.side || "").trim();
  const type = String(market.side_type || "").toLowerCase();
  const game = {
    id: String(market.fixture_id || market.id),
    sport,
    league,
    away: type === "away" ? sideName : "Away",
    home: type === "home" ? sideName : "Home",
    awayAbbr: type === "away" ? sideName : "",
    homeAbbr: type === "home" ? sideName : "",
    awayId: null,
    homeId: null,
    commence_time: fixtureCommence(market),
    ...fixtureLiveMeta(market),
    is_live: fixtureIsLive(market),
    home_score: null,
    away_score: null,
    bookOdds: emptyBookOddsForBooks(),
    bookUpdatedAt: {},
    bookLineUpdatedAt: {},
    bookLineConfirmedAt: {},
    bookLineSuspended: {},
  };
  return game;
}

export function applyMarketToGame(game, market, { receivedAt, allowAlt } = {}) {
  if (!game || !market) return false;
  if (!(allowAlt ? isBoardMarket(market) : isMainMarket(market))) return false;
  const bookKey = bookKeyForMarket(market);
  if (!bookKey) return false;
  // Book 196 is not the Underdog phone price. Live NYG decimal 3.4 converts
  // to +240 (LAR 1.33 → −303) while the phone is still +245. Do not paint
  // that American, and do not fee-adjust it into a phone quote. Phone odds
  // are odds.prediction, which this feed does not carry, so the cell stays
  // empty. Promo joins prediction separately and omits the leg when missing.
  if (bookKey === UNDERDOG_PREDICT_BOOK_KEY) return false;
  const betType = normalizeBetType(market.bet_type);
  const side = marketSide(market, game);
  if (!side) return false;
  const field = lineFieldFor(betType, side);
  if (!field) return false;
  const existingPrice = game.bookOdds?.[bookKey]?.[field];
  const existingTs = lineUpdatedAt(game, bookKey, field);
  const incomingLive = marketIsLiveQuote(market);
  const incomingMarketTs = marketUpdatedAtMs(market, null);
  const hasQuote = existingPrice != null && isFinite(Number(existingPrice));
  if (!marketIsOffered(market)) {
    // SSE owns prices. Unpriced is_otb / pregame leftovers / blank cells must
    // not paint OFF — live soft books flap those flags every few hundred ms.
    // Only an explicit suspend / inactive / taken_down tombs immediately.
    // REST reconcile (last-seen grace) is availability truth.
    if (!hasQuote) return false;
    if (!marketIsExplicitlySuspended(market)) return false;
    clearSideQuote(game, bookKey, betType, side);
    return {
      bookKey,
      betType,
      side,
      price: null,
      suspended: true,
      label: tickLabel(market, game, side, betType),
      updatedAt: null,
    };
  }
  if (hasQuote && game.is_live && !incomingLive) return false;
  // Held live print wins unless Betstamp sends a strictly newer updated_at.
  if (hasQuote && incomingMarketTs == null) return false;
  if (hasQuote && existingTs != null && incomingMarketTs <= existingTs) return false;
  const price = toAmericanOdds(market.odds);
  if (price == null) return false;
  if (!game.bookOdds[bookKey]) game.bookOdds[bookKey] = emptyBookOdds();
  applySideToOdds(game.bookOdds[bookKey], betType, side, price, marketSize(market), marketLine(market));
  if (market.is_live) game.is_live = true;
  // Stamp ages from Betstamp's updated_at only. Receive-time fallbacks were
  // blocking later live ticks whose market stamp is older than "now".
  if (incomingMarketTs != null) {
    game.bookUpdatedAt[bookKey] = incomingMarketTs;
    setLineUpdatedAt(game, bookKey, field, incomingMarketTs);
  }
  // confirmedAt is last-seen wall time so reconcile grace survives stale prints.
  confirmSideQuote(game, bookKey, field, receivedAt ?? incomingMarketTs);
  return { bookKey, betType, side, price, label: tickLabel(market, game, side, betType), updatedAt: incomingMarketTs };
}

export function gamesFromBetstampSnapshot({ markets, fixtures, teams, nowMs } = {}) {
  const seenAt = nowMs != null && isFinite(nowMs) ? nowMs : Date.now();
  const marketList = asList(markets, ["markets", "data"]);
  const fixtureList = asList(fixtures, ["fixtures", "data"]);
  const teamList = asList(teams, ["teams", "data"]);
  const teamsById = indexById(teamList);
  const games = new Map();
  const closedIds = new Set();

  for (const fixture of fixtureList) {
    const id = fixture?.id ?? fixture?.fixture_id;
    if (id == null) continue;
    if (fixtureIsClosed(fixture)) {
      closedIds.add(String(id));
      continue;
    }
    games.set(String(id), newGameFromFixture(fixture, teamsById, nowMs));
  }

  for (const market of marketList) {
    if (!isMainMarket(market) || !marketIsOffered(market)) continue;
    const fid = market.fixture_id != null ? String(market.fixture_id) : null;
    if (!fid || closedIds.has(fid)) continue;
    if (!games.has(fid)) games.set(fid, stubGameFromMarket(market, nowMs));
    applyMarketToGame(games.get(fid), market, { receivedAt: seenAt });
  }

  const list = [...games.values()].filter((g) => (g.away || g.home) && !gameIsFinished(g, seenAt));
  list.sort((a, b) => {
    const ta = Date.parse(a.commence_time) || 0;
    const tb = Date.parse(b.commence_time) || 0;
    return ta - tb;
  });
  return list;
}

export function applyStreamMarkets(games, markets, { receivedAt, nowMs, allowNewGames = true } = {}) {
  const next = cloneBoardGames(games);
  const byId = new Map(next.map((g) => [String(g.id), g]));
  const applied = [];
  const seenAt = nowMs != null && isFinite(nowMs) ? nowMs : Date.now();
  for (const market of markets || []) {
    const fid = market?.fixture_id != null ? String(market.fixture_id) : null;
    if (!fid) continue;
    if (!byId.has(fid)) {
      // Live board passes allowNewGames:false — a stray tick must not inject
      // a stub row (often sorts first, remounts the Live now group).
      if (allowNewGames === false) continue;
      const stub = stubGameFromMarket(market, nowMs);
      if (gameIsFinished(stub, seenAt)) continue;
      byId.set(fid, stub);
      next.push(stub);
    }
    const game = byId.get(fid);
    if (gameIsFinished(game, seenAt)) continue;
    const hit = applyMarketToGame(game, market, { receivedAt });
    if (hit) applied.push({ fixtureId: fid, ...hit, eventTime: marketEventTime(market) });
  }
  const kept = next.filter((g) => !gameIsFinished(g, seenAt));
  kept.sort((a, b) => (Date.parse(a.commence_time) || 0) - (Date.parse(b.commence_time) || 0));
  return { games: kept, applied };
}

// LIVE availability truth: REST mains listing vs previously shown quotes.
// Present → apply if Betstamp's updated_at is newer (quiet soft books), else
// keep the held SSE print. Absent → clear / OFF and out of Best *after*
// last-seen grace. Silence alone is not a suspend. Halftime still reconciles.
// `markets == null` or an empty list is a no-op so a botched / truncated
// payload cannot wipe the board. A fixture the snap never mentioned is
// treated as incomplete, not "every book went OFF".
export function reconcileLiveGames(games, {
  markets,
  fixtures,
  teams,
  nowMs,
  clearGraceMs = BETSTAMP_RECONCILE_CLEAR_GRACE_MS,
} = {}) {
  if (markets == null) return games || [];
  const marketList = asList(markets, ["markets", "data"]);
  if (!marketList.length) return games || [];
  const seenAt = nowMs != null && isFinite(nowMs) ? nowMs : Date.now();
  const next = cloneBoardGames(games);
  const byId = new Map(next.map((g) => [String(g.id), g]));

  const snapGames = gamesFromBetstampSnapshot({ markets, fixtures, teams, nowMs: seenAt });
  for (const sg of snapGames) {
    if (!byId.has(String(sg.id))) {
      next.push(sg);
      byId.set(String(sg.id), sg);
    }
  }

  const offered = offeredPresenceKeysFromMarkets(markets, byId);
  const mentioned = fixtureIdsFromMarkets(marketList);

  for (const game of next) {
    if (!game?.is_live || gameIsFinished(game, seenAt)) continue;
    if (!mentioned.has(String(game.id))) continue;
    for (const market of marketList) {
      if (!isMainMarket(market)) continue;
      if (market.fixture_id == null || String(market.fixture_id) !== String(game.id)) continue;
      applyMarketToGame(game, market, { receivedAt: seenAt });
    }
    for (const quote of listedBoardQuotes(game)) {
      const key = quotePresenceKey({
        fixtureId: game.id,
        bookKey: quote.bookKey,
        betType: quote.betType,
        side: quote.side,
      });
      if (key && offered.has(key)) {
        confirmSideQuote(game, quote.bookKey, quote.field, seenAt);
        continue;
      }
      const lastSeen = quoteLastSeenMs(game, quote.bookKey, quote.field);
      if (
        lastSeen != null
        && isFinite(lastSeen)
        && clearGraceMs > 0
        && (seenAt - lastSeen) < clearGraceMs
      ) {
        continue;
      }
      clearSideQuote(game, quote.bookKey, quote.betType, quote.side);
    }
  }

  const kept = next.filter((g) => !gameIsFinished(g, seenAt));
  kept.sort((a, b) => (Date.parse(a.commence_time) || 0) - (Date.parse(b.commence_time) || 0));
  return kept;
}

export function gameIsFinished(game, now = Date.now()) {
  if (!game) return true;
  if (fixtureIsClosed(game)) return true;
  if (game.is_live) return false;
  const t = Date.parse(game.commence_time);
  return isFinite(t) && t <= now;
}

export function gameVisibleOnBoard(game, { liveOnly, now = Date.now() } = {}) {
  if (!game || gameIsFinished(game, now)) return false;
  if (liveOnly) return !!game.is_live;
  if (game.is_live) return false;
  return true;
}

export function quantile(values, q) {
  const nums = (values || []).filter((v) => typeof v === "number" && isFinite(v));
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function emptyTickStats() {
  return {
    lastEventAt: null,
    lastLagMs: null,
    lastEventTime: null,
    lastArrivalAt: null,
    arrivals: [],
    ticks: [],
    perBook: {},
    eventCount: 0,
  };
}

export function recordTicks(stats, applied, { receivedAt, maxArrivals = 80, maxTicks = 24 } = {}) {
  const next = {
    ...stats,
    arrivals: [...(stats.arrivals || [])],
    ticks: [...(stats.ticks || [])],
    perBook: { ...(stats.perBook || {}) },
  };
  if (next.lastArrivalAt != null) {
    next.arrivals.push(receivedAt - next.lastArrivalAt);
    if (next.arrivals.length > maxArrivals) {
      next.arrivals.splice(0, next.arrivals.length - maxArrivals);
    }
  }
  next.lastArrivalAt = receivedAt;
  next.lastEventAt = receivedAt;
  next.eventCount = (next.eventCount || 0) + 1;

  let lag = null;
  for (const row of applied || []) {
    const eventMs = row.eventTime != null ? Date.parse(row.eventTime) || Number(row.eventTime) : null;
    if (eventMs && isFinite(eventMs)) {
      lag = Math.max(0, receivedAt - eventMs);
      next.lastEventTime = eventMs;
    }
    if (row.bookKey) {
      next.perBook[row.bookKey] = { lastAt: receivedAt, lastLagMs: lag, eventTime: eventMs };
    }
    next.ticks.unshift({
      t: receivedAt,
      bookKey: row.bookKey,
      fixtureId: row.fixtureId,
      label: row.label,
      price: row.price,
      lagMs: lag,
    });
  }
  next.lastLagMs = lag;
  if (next.ticks.length > maxTicks) next.ticks.length = maxTicks;
  return next;
}

export function summarizeTickStats(stats, now = Date.now()) {
  const arrivals = stats?.arrivals || [];
  return {
    lastTickAgeMs: stats?.lastEventAt == null ? null : Math.max(0, now - stats.lastEventAt),
    lastLagMs: stats?.lastLagMs ?? null,
    p50InterArrivalMs: quantile(arrivals, 0.5),
    p95InterArrivalMs: quantile(arrivals, 0.95),
    eventCount: stats?.eventCount || 0,
    perBook: stats?.perBook || {},
    ticks: stats?.ticks || [],
  };
}
