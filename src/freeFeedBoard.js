// New Odds Board fixture list and prices from keyless feeds only.
// Polymarket CLOB, Kalshi public markets, Underdog phone. No Betstamp
// fixtures and no DraftKings / FanDuel / Pinnacle columns.
//
// NFL and MLB sides join on the Combo Locks team index (city, nickname,
// and code are the same team). NCAAF joins on the team-name matcher.
// A game that has already started and still has a quote stays on LIVE
// for a few hours — Kalshi does not flag in-game.

import { canonicalTeamName, identifyTeam } from "./comboPrefill.js";
import { sportByLeague, visibleBetstampBooks } from "./betstampBooks.js";
import { applyStreamMarkets, emptyBookOddsForBooks } from "./betstampNormalize.js";
import { teamsLikelySame } from "./promoBookmaker.js";
import { applyUnderdogPhoneQuotes } from "./underdogPredictionQuote.js";

export const FREE_FEED_BOOK_ORDER = Object.freeze(["polymarket", "kalshi", "underdog_predict"]);
export const FREE_FEED_POLL_MS = 20_000;
export const FREE_FEED_LIVE_POLL_MS = 30_000;
// Open quote after kickoff, before we treat the game as finished.
const LIVE_AFTER_START_MS = 6 * 3600 * 1000;

const FREE_BOOKS = visibleBetstampBooks({ email: "kev120909@gmail.com" }).filter((b) => (
  FREE_FEED_BOOK_ORDER.includes(b.key)
));

export function freeFeedBooks(user, env) {
  const allowed = new Map(visibleBetstampBooks(user, env).map((b) => [b.key, b]));
  return FREE_FEED_BOOK_ORDER.map((key) => allowed.get(key)).filter(Boolean);
}

function sportKey(league) {
  const l = String(league || "").toUpperCase();
  if (l === "NFL") return "nfl";
  if (l === "MLB") return "mlb";
  return null;
}

function teamCode(name, league) {
  const sport = sportKey(league);
  if (!sport || !name) return null;
  return identifyTeam(name, sport);
}

function sameTeam(a, b, league) {
  if (!a || !b) return false;
  const sport = sportKey(league);
  if (sport) {
    const ia = identifyTeam(a, sport);
    const ib = identifyTeam(b, sport);
    if (ia && ib) return ia === ib;
  }
  return teamsLikelySame(a, b);
}

function pairId(league, away, home) {
  const a = teamCode(away, league);
  const h = teamCode(home, league);
  if (!a || !h || a === h) return null;
  const [x, y] = [a, h].sort();
  return `ff:${league}:${x}:${y}`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function betterName(current, incoming) {
  if (!incoming) return current || "";
  if (!current) return incoming;
  const cw = current.trim().split(/\s+/).length;
  const iw = incoming.trim().split(/\s+/).length;
  if (iw !== cw) return iw > cw ? incoming : current;
  return incoming.length > current.length ? incoming : current;
}

function displayName(raw, league) {
  const sport = sportKey(league);
  if (sport) {
    const full = canonicalTeamName(raw, sport);
    if (full) return full;
  }
  return String(raw || "").trim();
}

function emptyShell({ id, league, away, home, commence, isLive }) {
  const sport = sportByLeague(league)?.id || "americanfootball_nfl";
  return {
    id,
    sport,
    league,
    away: away || "Away",
    home: home || "Home",
    awayAbbr: teamCode(away, league) || "",
    homeAbbr: teamCode(home, league) || "",
    awayId: null,
    homeId: null,
    commence_time: commence || null,
    is_live: !!isLive,
    status: isLive ? "live" : "pregame",
    home_score: null,
    away_score: null,
    bookOdds: emptyBookOddsForBooks(FREE_BOOKS),
    bookUpdatedAt: {},
    bookLineUpdatedAt: {},
    bookLineConfirmedAt: {},
    bookLineSuspended: {},
  };
}

function findGame(games, league, away, home) {
  const id = pairId(league, away, home);
  if (id) {
    const byId = games.find((g) => g && g.id === id);
    if (byId) return byId;
  }
  if (!away || !home) return null;
  const hits = [];
  for (const game of games) {
    if (!game || String(game.league || "").toUpperCase() !== league) continue;
    const direct = sameTeam(away, game.away, league) && sameTeam(home, game.home, league);
    const flipped = sameTeam(away, game.home, league) && sameTeam(home, game.away, league);
    if (direct || flipped) hits.push(game);
  }
  return hits.length === 1 ? hits[0] : null;
}

function enrich(game, away, home, commence, isLive) {
  const league = game.league;
  let srcAway = away;
  let srcHome = home;
  const aligned = sameTeam(srcAway, game.away, league) && sameTeam(srcHome, game.home, league);
  const flipped = sameTeam(srcAway, game.home, league) && sameTeam(srcHome, game.away, league);
  if (!aligned && flipped) {
    srcAway = home;
    srcHome = away;
  }
  if (srcAway && sameTeam(game.away, srcAway, league)) {
    game.away = displayName(betterName(game.away, srcAway), league) || game.away;
  }
  if (srcHome && sameTeam(game.home, srcHome, league)) {
    game.home = displayName(betterName(game.home, srcHome), league) || game.home;
  }
  const awayAbbr = teamCode(game.away, league);
  const homeAbbr = teamCode(game.home, league);
  if (awayAbbr) game.awayAbbr = awayAbbr;
  if (homeAbbr) game.homeAbbr = homeAbbr;
  if (!game.commence_time && commence) game.commence_time = commence;
  if (isLive) {
    game.is_live = true;
    game.status = "live";
  }
}

function inferLive(commence, nowMs) {
  const t = Date.parse(commence || "");
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age < LIVE_AFTER_START_MS;
}

function ensureGame(games, { league, away, home, commence, isLive, nowMs }) {
  const lg = String(league || "").toUpperCase();
  if (!lg || !away || !home) return null;
  let game = findGame(games, lg, away, home);
  const live = !!isLive || inferLive(commence, nowMs);
  if (!game) {
    const id = pairId(lg, away, home) || `ff:${lg}:${slug(away)}:${slug(home)}`;
    if (games.some((g) => g.id === id)) return null;
    game = emptyShell({
      id,
      league: lg,
      away: displayName(away, lg),
      home: displayName(home, lg),
      commence,
      isLive: live,
    });
    games.push(game);
    return game;
  }
  enrich(game, away, home, commence, live);
  return game;
}

function phoneLive(game) {
  if (!game) return false;
  if (game.live === true || game.is_live === true) return true;
  const s = String(game.status || "").toLowerCase();
  return s === "scoring" || s === "live" || s === "inprogress" || s === "in_progress" || s === "in-play" || s === "inplay";
}

function quoteSideType(game, quote) {
  const league = game.league;
  if (sameTeam(quote.side, game.away, league)) return "Away";
  if (sameTeam(quote.side, game.home, league)) return "Home";
  return null;
}

function marketsFromQuotes(games, quotes, fallbackLeague) {
  const markets = [];
  for (const quote of quotes || []) {
    if (!quote || quote.odds == null) continue;
    if (quote.bet_type && quote.bet_type !== "moneyline") continue;
    const league = String(quote.league || fallbackLeague || "").toUpperCase();
    const game = findGame(games, league, quote.away, quote.home);
    if (!game) continue;
    const sideType = quoteSideType(game, quote);
    if (!sideType) continue;
    markets.push({
      fixture_id: game.id,
      odd_provider_id: quote.book_id,
      bet_type: "Moneyline",
      period: "FT",
      is_alt: false,
      side: quote.side,
      side_type: sideType,
      odds: quote.odds,
      size: quote.size,
      is_live: quote.is_live === true || game.is_live === true,
      updated_at: quote.updated_at,
    });
  }
  return markets;
}

export function quoteMergeKey(quote) {
  if (!quote) return "";
  return quote.token_id || quote.ticker || `${quote.book}|${quote.league}|${quote.away}|${quote.home}|${quote.side}|${quote.bet_type || "moneyline"}`;
}

export function mergeVenueQuotes(prev, incoming) {
  const map = new Map();
  for (const quote of prev || []) {
    if (quote) map.set(quoteMergeKey(quote), quote);
  }
  for (const quote of incoming || []) {
    if (quote) map.set(quoteMergeKey(quote), quote);
  }
  return [...map.values()];
}

export function gamesFromFreeFeeds({
  league,
  polymarket = [],
  kalshi = [],
  underdog = null,
  nowMs = Date.now(),
} = {}) {
  const lg = String(league || "NFL").toUpperCase();
  const seenAt = Number.isFinite(nowMs) ? nowMs : Date.now();
  const games = [];
  const phoneGames = underdog && Array.isArray(underdog.games) ? underdog.games : [];
  for (const game of phoneGames) {
    if (!game) continue;
    const sport = String(game.sport || game.league || "").toUpperCase();
    if (sport && sport !== lg) continue;
    ensureGame(games, {
      league: lg,
      away: game.away,
      home: game.home,
      commence: game.scheduledAt || game.commence_time || null,
      isLive: phoneLive(game),
      nowMs: seenAt,
    });
  }
  for (const quote of [...(polymarket || []), ...(kalshi || [])]) {
    if (!quote) continue;
    const quoteLeague = String(quote.league || lg).toUpperCase();
    if (quoteLeague !== lg) continue;
    ensureGame(games, {
      league: lg,
      away: quote.away,
      home: quote.home,
      commence: quote.start || null,
      isLive: quote.is_live === true,
      nowMs: seenAt,
    });
  }
  for (const game of games) {
    if (inferLive(game.commence_time, seenAt)) {
      game.is_live = true;
      game.status = "live";
    }
  }
  const markets = marketsFromQuotes(games, [...(polymarket || []), ...(kalshi || [])].filter((q) => (
    q && String(q.league || lg).toUpperCase() === lg
  )), lg);
  const painted = applyStreamMarkets(games, markets, {
    receivedAt: seenAt,
    nowMs: seenAt,
    allowNewGames: false,
  }).games;
  const withPhone = underdog ? applyUnderdogPhoneQuotes(painted, underdog) : painted;
  return withPhone.filter((g) => g && String(g.league || "").toUpperCase() === lg);
}

// Main lines already on the board. These feeds do not publish an alt ladder.
export function mainLaddersFromGame(game) {
  if (!game) return { moneyline: null, spreads: [], totals: [] };
  const odds = Object.values(game.bookOdds || {});
  const has = (pred) => odds.some(pred);
  const spreadLine = odds.map((o) => o && o.spr_away_line).find((n) => n != null) ?? null;
  const totalLine = odds.map((o) => o && o.tot_line).find((n) => n != null) ?? null;
  return {
    moneyline: has((o) => o && (o.ml_away != null || o.ml_home != null))
      ? { game, isMain: true }
      : null,
    spreads: has((o) => o && (o.spr_away != null || o.spr_home != null))
      ? [{ line: spreadLine, game, isMain: true }]
      : [],
    totals: has((o) => o && (o.tot_over != null || o.tot_under != null))
      ? [{ line: totalLine, game, isMain: true }]
      : [],
  };
}
