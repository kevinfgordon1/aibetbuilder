// Betstamp market snapshot → Odds Board row model.
// Isolated from The Odds API transform so the existing board stays untouched.

import {
  bookById,
  BETSTAMP_TRIAL_BOOKS,
  isMnfFixture,
  isPmWinProbBook,
  sportByLeague,
} from "./betstampBooks.js";
import { americanToImpliedProb, impliedProbToAmerican } from "./blendAskLadder.js";

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
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
  return `${Math.max(1, Math.round(ms / 86_400_000))}d`;
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

export function fixtureCommence(fixture) {
  return fixture?.start_date || fixture?.start_time || fixture?.commence_time || fixture?.starts_at || fixture?.scheduled_at || fixture?.start || null;
}

export function fixtureIsLive(fixture) {
  if (!fixture) return false;
  if (fixture.is_live === true) return true;
  const status = String(fixture.status || fixture.state || "").toLowerCase();
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

export function isMainMarket(market) {
  if (!market) return false;
  if (market.is_alt === true) return false;
  if (normalizePeriod(market.period) !== "FT") return false;
  const bt = normalizeBetType(market.bet_type);
  return bt === "moneyline" || bt === "spread" || bt === "total";
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
    is_live: fixtureIsLive(fixture),
    home_score: fixture.home_score ?? fixture.homeScore ?? null,
    away_score: fixture.away_score ?? fixture.awayScore ?? null,
    bookOdds: emptyBookOddsForBooks(),
    bookUpdatedAt: {},
    bookLineUpdatedAt: {},
    is_mnf: false,
  };
  game.is_mnf = isMnfFixture(game, nowMs);
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
    commence_time: market.start_date || market.commence_time || null,
    is_live: !!market.is_live,
    home_score: null,
    away_score: null,
    bookOdds: emptyBookOddsForBooks(),
    bookUpdatedAt: {},
    bookLineUpdatedAt: {},
    is_mnf: false,
  };
  game.is_mnf = isMnfFixture(game, nowMs);
  return game;
}

export function applyMarketToGame(game, market, { receivedAt } = {}) {
  if (!game || !market || !isMainMarket(market)) return false;
  const bookKey = bookKeyForMarket(market);
  if (!bookKey) return false;
  const betType = normalizeBetType(market.bet_type);
  const side = marketSide(market, game);
  const price = toAmericanOdds(market.odds);
  if (price == null || !side) return false;
  if (!game.bookOdds[bookKey]) game.bookOdds[bookKey] = emptyBookOdds();
  applySideToOdds(game.bookOdds[bookKey], betType, side, price, marketSize(market), marketLine(market));
  if (market.is_live) game.is_live = true;
  const ts = marketUpdatedAtMs(market, receivedAt);
  if (ts != null) {
    game.bookUpdatedAt[bookKey] = ts;
    setLineUpdatedAt(game, bookKey, lineFieldFor(betType, side), ts);
  }
  return { bookKey, betType, side, price, label: tickLabel(market, game, side, betType), updatedAt: ts };
}

export function gamesFromBetstampSnapshot({ markets, fixtures, teams, nowMs } = {}) {
  const seenAt = nowMs != null && isFinite(nowMs) ? nowMs : Date.now();
  const marketList = asList(markets, ["markets", "data"]);
  const fixtureList = asList(fixtures, ["fixtures", "data"]);
  const teamList = asList(teams, ["teams", "data"]);
  const teamsById = indexById(teamList);
  const games = new Map();

  for (const fixture of fixtureList) {
    const id = fixture?.id ?? fixture?.fixture_id;
    if (id == null) continue;
    games.set(String(id), newGameFromFixture(fixture, teamsById, nowMs));
  }

  for (const market of marketList) {
    if (!isMainMarket(market)) continue;
    const fid = market.fixture_id != null ? String(market.fixture_id) : null;
    if (!fid) continue;
    if (!games.has(fid)) games.set(fid, stubGameFromMarket(market, nowMs));
    applyMarketToGame(games.get(fid), market, { receivedAt: seenAt });
  }

  const list = [...games.values()].filter((g) => g.away || g.home);
  list.sort((a, b) => {
    if (a.is_mnf && !b.is_mnf) return -1;
    if (!a.is_mnf && b.is_mnf) return 1;
    const ta = Date.parse(a.commence_time) || 0;
    const tb = Date.parse(b.commence_time) || 0;
    return ta - tb;
  });
  return list;
}

export function applyStreamMarkets(games, markets, { receivedAt, nowMs } = {}) {
  const next = games.map((g) => ({
    ...g,
    bookOdds: { ...g.bookOdds },
    bookUpdatedAt: { ...g.bookUpdatedAt },
    bookLineUpdatedAt: { ...g.bookLineUpdatedAt },
  }));
  for (const g of next) {
    const copy = {};
    for (const [k, v] of Object.entries(g.bookOdds || {})) copy[k] = { ...v };
    g.bookOdds = copy;
    const lineCopy = {};
    for (const [k, v] of Object.entries(g.bookLineUpdatedAt || {})) lineCopy[k] = { ...v };
    g.bookLineUpdatedAt = lineCopy;
  }
  const byId = new Map(next.map((g) => [String(g.id), g]));
  const applied = [];
  for (const market of markets || []) {
    const fid = market?.fixture_id != null ? String(market.fixture_id) : null;
    if (!fid) continue;
    if (!byId.has(fid)) {
      const stub = stubGameFromMarket(market, nowMs);
      byId.set(fid, stub);
      next.push(stub);
    }
    const hit = applyMarketToGame(byId.get(fid), market, { receivedAt });
    if (hit) applied.push({ fixtureId: fid, ...hit, eventTime: marketEventTime(market) });
  }
  next.sort((a, b) => {
    if (a.is_mnf && !b.is_mnf) return -1;
    if (!a.is_mnf && b.is_mnf) return 1;
    return (Date.parse(a.commence_time) || 0) - (Date.parse(b.commence_time) || 0);
  });
  return { games: next, applied };
}

export function gameVisibleOnBoard(game, { liveOnly, now = Date.now() } = {}) {
  if (!game) return false;
  if (liveOnly) return !!game.is_live;
  if (game.is_live) return false;
  const t = Date.parse(game.commence_time);
  if (isFinite(t) && t <= now) return false;
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
