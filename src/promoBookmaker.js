// Overlay Betstamp Bookmaker (book id 642) mains onto Odds API Promo events.
// Odds API games stay the row identity. A Betstamp blip omits Bookmaker cells
// instead of failing the scan. Dropped Betstamp lines are stripped — never
// left as zombie prices (The Odds API has no `bookmaker` key).
//
// New Odds Board still labels 642 as BetCris in betstampBooks.js. Promo must
// not reuse that key — filter by book id and emit key `bookmaker`.

import {
  asList,
  fixtureCommence,
  fixtureHomeAway,
  indexById,
  isMainMarket,
  marketIsOffered,
  marketLine,
  marketSide,
  marketSize,
  normalizeBetType,
  toAmericanOdds,
} from "./betstampNormalize.js";
import { BETSTAMP_SPORTS } from "./betstampBooks.js";
import { betstampSnapshotUrl } from "./betstampLive.js";

export const BOOKMAKER_BOOK_KEY = "bookmaker";
export const BOOKMAKER_BOOK_ID = 642;
export const BOOKMAKER_COMMENCE_WINDOW_MS = 12 * 60 * 60 * 1000;
export const BOOKMAKER_FETCH_TIMEOUT_MS = 8000;
export const BOOKMAKER_TITLE = "Bookmaker";

const TEAM_STOP = new Set(["the", "and", "of", "university", "univ", "college"]);
const TEAM_QUALIFIERS = new Set(["state", "st", "tech", "am", "international"]);

export function leaguesForSports(sports) {
  const selected = sports instanceof Set ? sports : new Set(sports || []);
  return BETSTAMP_SPORTS.filter((s) => selected.has(s.id)).map((s) => s.league);
}

export function foldTeamName(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function teamTokens(raw) {
  return foldTeamName(raw).split(" ").filter((t) => t && t.length >= 2 && !TEAM_STOP.has(t));
}

function qualifierTokens(tokens) {
  return (tokens || []).filter((t) => TEAM_QUALIFIERS.has(t));
}

function coreTokens(tokens) {
  return (tokens || []).filter((t) => !TEAM_QUALIFIERS.has(t));
}

export function namesLooselyEqual(a, b) {
  const x = foldTeamName(a);
  const y = foldTeamName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

export function abbrHitsName(abbr, name) {
  const a = foldTeamName(abbr);
  const words = teamTokens(name);
  if (a.length < 2 || a.length > 4 || !words.length) return false;
  if (words.some((w) => w === a)) return true;
  if (a.length === words.length) return words.every((w, i) => w[0] === a[i]);
  return words[0].startsWith(a);
}

export function teamsLikelySame(a, b) {
  const fa = foldTeamName(a);
  const fb = foldTeamName(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return false;
  const qa = qualifierTokens(ta);
  const qb = qualifierTokens(tb);
  if (qa.length !== qb.length) return false;
  for (const q of qa) {
    if (!qb.includes(q)) return false;
  }
  if (namesLooselyEqual(a, b)) return true;
  if (fa.length <= 4 && ta.length === 1 && tb.includes(fa)) return true;
  if (fb.length <= 4 && tb.length === 1 && ta.includes(fb)) return true;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  const core = coreTokens(shorter);
  if (!core.length) return false;
  return core.every((t) => longer.includes(t));
}

export function teamMatchScore(oddsName, stampName, stampAbbr) {
  if (teamsLikelySame(oddsName, stampName)) return 2;
  if (stampAbbr && (teamsLikelySame(oddsName, stampAbbr) || abbrHitsName(stampAbbr, oddsName))) return 1;
  return 0;
}

function alignmentScore(event, sides) {
  const home = teamMatchScore(event.home_team, sides.home, sides.homeAbbr);
  const away = teamMatchScore(event.away_team, sides.away, sides.awayAbbr);
  if (!home || !away) return 0;
  return home + away;
}

export function joinOddsEventToBetstampFixture(event, snapshot, { windowMs = BOOKMAKER_COMMENCE_WINDOW_MS } = {}) {
  if (!event || !snapshot) return null;
  const sport = event.sport_key || event.sport;
  const league = BETSTAMP_SPORTS.find((s) => s.id === sport)?.league;
  if (!league) return null;
  const teamsById = indexById(asList(snapshot.teams, ["teams", "data"]));
  const fixtures = asList(snapshot.fixtures, ["fixtures", "data"]).filter((f) => {
    const raw = String(f?.league || f?.sport || "").toUpperCase();
    return raw === league;
  });
  const eventMs = Date.parse(event.commence_time);
  let best = null;
  let bestScore = -1;
  let ties = 0;

  for (const fixture of fixtures) {
    const sides = fixtureHomeAway(fixture, teamsById);
    const commence = fixtureCommence(fixture);
    const fixMs = commence ? Date.parse(commence) : NaN;
    if (isFinite(eventMs) && isFinite(fixMs) && Math.abs(eventMs - fixMs) > windowMs) continue;

    const aligned = alignmentScore(event, sides);
    const swapped = alignmentScore({ home_team: event.away_team, away_team: event.home_team }, sides);
    const useSwap = swapped > aligned;
    const pair = useSwap ? swapped : aligned;
    if (pair < 2) continue;

    let timeScore = 0;
    if (isFinite(eventMs) && isFinite(fixMs)) {
      timeScore = Math.max(0, 50 - Math.abs(eventMs - fixMs) / (60 * 60 * 1000));
    }
    const total = pair * 1000 + timeScore;
    if (total > bestScore + 1e-6) {
      bestScore = total;
      ties = 0;
      best = { fixture, sides, swapped: useSwap, commence };
    } else if (Math.abs(total - bestScore) <= 1e-6) {
      ties += 1;
    }
  }

  if (!best || ties > 0) return null;
  const fixtureId = best.fixture.id ?? best.fixture.fixture_id;
  if (fixtureId == null) return null;
  return {
    fixtureId: String(fixtureId),
    fixture: best.fixture,
    sides: best.sides,
    swapped: best.swapped,
    commence: best.commence,
  };
}

function pushOutcome(list, outcome) {
  if (!outcome || !outcome.name || outcome.price == null) return;
  const pointKey = outcome.point == null ? "" : String(outcome.point);
  const key = `${outcome.name}\0${pointKey}`;
  const idx = list.findIndex((o) => `${o.name}\0${o.point == null ? "" : String(o.point)}` === key);
  if (idx >= 0) list[idx] = outcome;
  else list.push(outcome);
}

function outcomePayload(name, price, size, point) {
  const out = { name, price };
  if (size != null) out.size = size;
  if (point != null) out.point = point;
  return out;
}

export function marketIsBookmaker(market) {
  const id = Number(market?.odd_provider_id ?? market?.book_id ?? market?.provider_id);
  return id === BOOKMAKER_BOOK_ID;
}

export function bookmakerBookmakerFromSnapshot(event, snapshot, joinHit) {
  const join = joinHit || joinOddsEventToBetstampFixture(event, snapshot);
  if (!join) return null;
  const game = {
    away: event.away_team,
    home: event.home_team,
    awayAbbr: join.swapped ? join.sides.homeAbbr : join.sides.awayAbbr,
    homeAbbr: join.swapped ? join.sides.awayAbbr : join.sides.homeAbbr,
    awayId: join.swapped ? join.sides.homeId : join.sides.awayId,
    homeId: join.swapped ? join.sides.awayId : join.sides.homeId,
  };
  const h2h = [];
  const spreads = [];
  const totals = [];

  for (const market of asList(snapshot.markets, ["markets", "data"])) {
    if (market == null || String(market.fixture_id) !== join.fixtureId) continue;
    if (!marketIsBookmaker(market)) continue;
    if (!isMainMarket(market) || !marketIsOffered(market)) continue;
    const price = toAmericanOdds(market.odds);
    if (price == null) continue;
    const side = marketSide(market, game);
    if (!side) continue;
    const size = marketSize(market);
    const line = marketLine(market);
    const bt = normalizeBetType(market.bet_type);
    if (bt === "moneyline") {
      const name = side === "away" ? event.away_team : side === "home" ? event.home_team : null;
      if (name) pushOutcome(h2h, outcomePayload(name, price, size));
    } else if (bt === "spread" && line != null) {
      const name = side === "away" ? event.away_team : side === "home" ? event.home_team : null;
      if (name) pushOutcome(spreads, outcomePayload(name, price, size, line));
    } else if (bt === "total" && line != null) {
      const name = side === "under" ? "Under" : side === "over" ? "Over" : null;
      if (name) pushOutcome(totals, outcomePayload(name, price, size, line));
    }
  }

  const markets = [];
  if (h2h.length) markets.push({ key: "h2h", outcomes: h2h });
  if (spreads.length) markets.push({ key: "spreads", outcomes: spreads });
  if (totals.length) markets.push({ key: "totals", outcomes: totals });
  if (!markets.length) return null;
  return { key: BOOKMAKER_BOOK_KEY, title: BOOKMAKER_TITLE, markets };
}

export function overlayBookmakerOnGame(game, snapshot) {
  if (!game || typeof game !== "object") return game;
  const bookmakers = (game.bookmakers || []).filter((b) => b && b.key !== BOOKMAKER_BOOK_KEY);
  const bm = snapshot ? bookmakerBookmakerFromSnapshot(game, snapshot) : null;
  return { ...game, bookmakers: bm ? [...bookmakers, bm] : bookmakers };
}

export function overlayBookmakerOnGames(games, snapshot) {
  if (!Array.isArray(games)) return games;
  return games.map((game) => overlayBookmakerOnGame(game, snapshot));
}

export function overlayBookmakerOnCacheRows(rows, snapshot) {
  return (rows || []).map((row) => {
    if (!row) return row;
    if (Array.isArray(row.data)) {
      return { ...row, data: overlayBookmakerOnGames(row.data, snapshot) };
    }
    if (row.data && typeof row.data === "object") {
      return { ...row, data: overlayBookmakerOnGame(row.data, snapshot) };
    }
    return row;
  });
}

export function bookmakerSnapshotUrl({ leagues } = {}) {
  const list = [...new Set((leagues || []).map((l) => String(l).toUpperCase()).filter((l) => l === "NFL" || l === "NCAAF"))];
  if (!list.length) return null;
  return betstampSnapshotUrl({
    league: list.join(","),
    live: false,
    bookIds: [BOOKMAKER_BOOK_ID],
  });
}

export async function fetchBookmakerSnapshot({
  leagues,
  fetchFn = fetch,
  timeoutMs = BOOKMAKER_FETCH_TIMEOUT_MS,
} = {}) {
  const url = bookmakerSnapshotUrl({ leagues });
  if (!url) return null;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  try {
    const work = Promise.resolve(fetchFn(url, ctrl ? { signal: ctrl.signal } : {}));
    const res = timeoutMs > 0
      ? await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              try { ctrl?.abort(); } catch { /* ignore */ }
              reject(new Error("bookmaker timeout"));
            }, timeoutMs);
          }),
        ])
      : await work;
    if (!res || !res.ok) return null;
    const json = typeof res.json === "function" ? await res.json() : res;
    if (!json || json.ok === false) return null;
    return json;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
