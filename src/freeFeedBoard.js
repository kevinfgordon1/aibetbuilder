// New Odds Board fixture list and prices from first-party feeds only.
// Polymarket CLOB, Kalshi public markets, Novig tape and 4Casters price
// stream (when credentials are set), Underdog phone. No Betstamp fixtures
// and no DraftKings / FanDuel / Pinnacle columns.
//
// NFL and MLB sides join on the Combo Locks team index (city, nickname,
// and code are the same team). NCAAF joins on the team-name matcher.
// A game that has already started and still has a quote stays on LIVE
// for a few hours — Kalshi does not flag in-game.

import { canonicalTeamName, identifyTeam } from "./comboPrefill.js";
import { FOURCASTERS_BOARD_BOOK, NOVIG_BOARD_BOOK, sportByLeague, visibleBetstampBooks } from "./betstampBooks.js";
import { applyStreamMarkets, emptyBookOddsForBooks, lineUpdatedAt } from "./betstampNormalize.js";
import { teamsLikelySame } from "./promoBookmaker.js";
import { applyUnderdogPhoneQuotes } from "./underdogPredictionQuote.js";

export const FREE_FEED_BOOK_ORDER = Object.freeze(["polymarket", "kalshi", "novig", "fourcasters", "underdog_predict"]);
export const FREE_FEED_POLL_MS = 20_000;
export const FREE_FEED_LIVE_POLL_MS = 30_000;
// Live Polymarket / Kalshi JSON snapshots. SSE should be faster; this is the
// backstop when a stream replays one ticker or a chunk sits in a proxy buffer.
export const FREE_FEED_LIVE_BOARD_POLL_MS = 3_000;
// Open quote after kickoff, before we treat the game as finished.
const LIVE_AFTER_START_MS = 6 * 3600 * 1000;

function freeFeedCatalog(user, env) {
  const allowed = new Map(visibleBetstampBooks(user, env).map((b) => [b.key, b]));
  allowed.set(NOVIG_BOARD_BOOK.key, NOVIG_BOARD_BOOK);
  allowed.set(FOURCASTERS_BOARD_BOOK.key, FOURCASTERS_BOARD_BOOK);
  return FREE_FEED_BOOK_ORDER.map((key) => allowed.get(key)).filter(Boolean);
}

const FREE_BOOKS = freeFeedCatalog({ email: "kev120909@gmail.com" });

export function freeFeedBooks(user, env) {
  return freeFeedCatalog(user, env);
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
    const betType = String(quote.bet_type || "moneyline").toLowerCase();
    if (betType !== "moneyline" && betType !== "spread" && betType !== "total") continue;
    const league = String(quote.league || fallbackLeague || "").toUpperCase();
    const game = findGame(games, league, quote.away, quote.home);
    if (!game) continue;
    let sideType = null;
    if (betType === "total") {
      const side = String(quote.side || quote.side_type || "").toLowerCase();
      if (side === "over" || side === "o") sideType = "Over";
      else if (side === "under" || side === "u") sideType = "Under";
    } else {
      sideType = quoteSideType(game, quote);
    }
    if (!sideType) continue;
    const line = quote.line != null ? quote.line : quote.number;
    markets.push({
      fixture_id: game.id,
      odd_provider_id: quote.book_id,
      bet_type: betType,
      period: "FT",
      is_alt: quote.is_alt === true,
      side: betType === "total" ? sideType : quote.side,
      side_type: sideType,
      odds: quote.odds,
      size: quote.size,
      line,
      number: line,
      is_live: quote.is_live === true || game.is_live === true,
      updated_at: quote.updated_at,
    });
  }
  return markets;
}

// JSON body from GET /api/kalshi-board. Null means "keep whatever the stream
// already merged" — an empty or failed body must not wipe a book we have.
function quotesFromBoardBody(body, book, bookId) {
  const quotes = body && Array.isArray(body.quotes) ? body.quotes : null;
  if (!quotes || !quotes.length) return null;
  const kept = quotes.filter((q) => (
    q && q.odds != null && (q.book === book || Number(q.book_id) === bookId)
  ));
  return kept.length ? kept : null;
}

export function kalshiQuotesFromBoardBody(body) {
  return quotesFromBoardBody(body, "kalshi", 194);
}

export function polymarketQuotesFromBoardBody(body) {
  return quotesFromBoardBody(body, "polymarket", 193);
}

// A complete SSE payload is the whole book. Merging a one-contract tick
// into an older book is what left Atlanta stuck at the pregame price.
export function quotesAfterVenueEvent(prev, payload) {
  const quotes = payload && Array.isArray(payload.quotes) ? payload.quotes.filter(Boolean) : [];
  if (!quotes.length) return prev || [];
  if (payload.complete === true) return quotes;
  return mergeVenueQuotes(prev, quotes);
}

const TICK_FIELDS = [
  ["ml_away", "away"],
  ["ml_home", "home"],
];

export function boardPriceTicks(prevGames, nextGames) {
  const prevById = new Map((prevGames || []).map((game) => [String(game && game.id), game]));
  const out = [];
  for (const game of nextGames || []) {
    if (!game) continue;
    const prev = prevById.get(String(game.id));
    for (const [bookKey, odds] of Object.entries(game.bookOdds || {})) {
      if (!odds) continue;
      for (const [field, side] of TICK_FIELDS) {
        if (odds[field] == null) continue;
        const before = prev && prev.bookOdds && prev.bookOdds[bookKey];
        if (before && before[field] === odds[field]) continue;
        const who = side === "away" ? (game.awayAbbr || game.away) : (game.homeAbbr || game.home);
        out.push({
          bookKey,
          fixtureId: game.id,
          label: `${who} ML`,
          price: odds[field],
          eventTime: lineUpdatedAt(game, bookKey, field),
        });
      }
    }
  }
  return out;
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
  novig = [],
  fourcasters = [],
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
  for (const quote of [...(polymarket || []), ...(kalshi || []), ...(novig || []), ...(fourcasters || [])]) {
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
  const markets = marketsFromQuotes(games, [...(polymarket || []), ...(kalshi || []), ...(novig || []), ...(fourcasters || [])].filter((q) => (
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
