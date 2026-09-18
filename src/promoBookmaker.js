// Overlay Betstamp Bookmaker (book id 642) mains onto Odds API Promo events.
// Odds API games stay the row identity. A Betstamp blip omits Bookmaker cells
// instead of failing the scan. Dropped Betstamp lines are stripped — never
// left as zombie prices (The Odds API has no `bookmaker` key).
//
// Join is unique name-level only (both teams) and only onto fixtures that
// already have a 642 row. /fixtures is the full slate — a KU name hit with
// no 642 market must not inherit Kansas State's line. No 642 row for that
// fixture+side → omit Bookmaker. After overlay, drop 642 if any ML side
// conflicts with the other books on that Odds API event (inverted +163 on
// the favorite becomes displayed −163 / 62% true).
// side_type Home/Away is Betstamp orientation and is remapped when Odds API
// home/away is swapped.
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
  const tx = teamTokens(a);
  const ty = teamTokens(b);
  if (!tx.length || !ty.length) return false;
  const shorter = tx.length <= ty.length ? tx : ty;
  const longer = tx.length <= ty.length ? ty : tx;
  // Token containment only — "arkansas".includes("kansas") is not a match.
  return shorter.every((t) => longer.includes(t));
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

// Abbr-only hits (score 1) are too loose for NCAAF: KAN→Kansas Jayhawks and
// IOWA→Iowa State will join Kansas State vs Iowa onto the Jayhawks game.
// Require a unique name-level pair (score >= 2 each side, no cross hits).
export function uniquePairScore(event, sides) {
  if (!event || !sides) return { score: 0, swapped: false };
  const hh = teamMatchScore(event.home_team, sides.home, sides.homeAbbr);
  const ha = teamMatchScore(event.home_team, sides.away, sides.awayAbbr);
  const ah = teamMatchScore(event.away_team, sides.home, sides.homeAbbr);
  const aa = teamMatchScore(event.away_team, sides.away, sides.awayAbbr);
  const alignedOk = hh >= 2 && aa >= 2 && ha < 2 && ah < 2;
  const swappedOk = ha >= 2 && ah >= 2 && hh < 2 && aa < 2;
  if (alignedOk && !swappedOk) return { score: hh + aa, swapped: false };
  if (swappedOk && !alignedOk) return { score: ha + ah, swapped: true };
  return { score: 0, swapped: false };
}

export function fixtureIdsPricedByBookmaker(snapshot) {
  const ids = new Set();
  for (const market of asList(snapshot?.markets, ["markets", "data"])) {
    if (!marketIsBookmaker(market) || market.fixture_id == null || market.fixture_id === "") continue;
    ids.add(String(market.fixture_id));
  }
  return ids;
}

export function joinOddsEventToBetstampFixture(event, snapshot, { windowMs = BOOKMAKER_COMMENCE_WINDOW_MS } = {}) {
  if (!event || !snapshot) return null;
  const sport = event.sport_key || event.sport;
  const league = BETSTAMP_SPORTS.find((s) => s.id === sport)?.league;
  if (!league) return null;
  const pricedIds = fixtureIdsPricedByBookmaker(snapshot);
  const teamsById = indexById(asList(snapshot.teams, ["teams", "data"]));
  const fixtures = asList(snapshot.fixtures, ["fixtures", "data"]).filter((f) => {
    const raw = String(f?.league || f?.sport || "").toUpperCase();
    if (raw !== league) return false;
    const id = f?.id ?? f?.fixture_id;
    if (id == null) return false;
    return pricedIds.has(String(id));
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

    const pair = uniquePairScore(event, sides);
    if (pair.score < 4) continue;

    let timeScore = 0;
    if (isFinite(eventMs) && isFinite(fixMs)) {
      timeScore = Math.max(0, 50 - Math.abs(eventMs - fixMs) / (60 * 60 * 1000));
    }
    const total = pair.score * 1000 + timeScore;
    if (total > bestScore + 1e-6) {
      bestScore = total;
      ties = 0;
      best = { fixture, sides, swapped: pair.swapped, commence };
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

// Map a Betstamp 642 market onto the Odds API team/total name for this event.
// side_type Home/Away is Betstamp fixture orientation — remap when home/away
// is swapped. Prefer team_id / team name so we never attach the other side.
export function oddsApiOutcomeName(market, event, join) {
  if (!market || !event || !join) return null;
  const bt = normalizeBetType(market.bet_type);
  const type = String(market.side_type || "").trim().toLowerCase();
  const sideRaw = String(market.side || "").trim();
  const sideLow = sideRaw.toLowerCase();
  if (
    bt === "total"
    || type === "over" || type === "under"
    || sideLow === "over" || sideLow === "under" || sideLow === "o" || sideLow === "u"
  ) {
    if (type === "over" || sideLow === "over" || sideLow === "o") return "Over";
    if (type === "under" || sideLow === "under" || sideLow === "u") return "Under";
    return null;
  }

  const stampName = (stampSide) => (
    stampSide === "home"
      ? (join.swapped ? event.away_team : event.home_team)
      : (join.swapped ? event.home_team : event.away_team)
  );

  const teamId = market.team_id != null ? String(market.team_id) : "";
  if (teamId && join.sides.homeId && teamId === String(join.sides.homeId)) return stampName("home");
  if (teamId && join.sides.awayId && teamId === String(join.sides.awayId)) return stampName("away");

  if (sideRaw) {
    const homeByOdds = teamMatchScore(event.home_team, sideRaw, null);
    const awayByOdds = teamMatchScore(event.away_team, sideRaw, null);
    if (homeByOdds >= 2 && awayByOdds < 2) return event.home_team;
    if (awayByOdds >= 2 && homeByOdds < 2) return event.away_team;

    const stampHome = teamMatchScore(join.sides.home, sideRaw, join.sides.homeAbbr);
    const stampAway = teamMatchScore(join.sides.away, sideRaw, join.sides.awayAbbr);
    if (stampHome >= 2 && stampAway < 2) return stampName("home");
    if (stampAway >= 2 && stampHome < 2) return stampName("away");
  }

  if (type === "home") return stampName("home");
  if (type === "away") return stampName("away");

  const stampGame = {
    away: join.sides.away,
    home: join.sides.home,
    awayAbbr: join.sides.awayAbbr,
    homeAbbr: join.sides.homeAbbr,
    awayId: join.sides.awayId,
    homeId: join.sides.homeId,
  };
  const stampSide = marketSide(market, stampGame);
  if (stampSide === "home" || stampSide === "away") return stampName(stampSide);
  return null;
}

export function bookmakerBookmakerFromSnapshot(event, snapshot, joinHit) {
  const join = joinHit || joinOddsEventToBetstampFixture(event, snapshot);
  if (!join) return null;
  const h2h = [];
  const spreads = [];
  const totals = [];

  for (const market of asList(snapshot.markets, ["markets", "data"])) {
    if (market == null || String(market.fixture_id) !== join.fixtureId) continue;
    if (!marketIsBookmaker(market)) continue;
    if (!isMainMarket(market) || !marketIsOffered(market)) continue;
    const price = toAmericanOdds(market.odds);
    if (price == null) continue;
    const name = oddsApiOutcomeName(market, event, join);
    if (!name) continue;
    const size = marketSize(market);
    const line = marketLine(market);
    const bt = normalizeBetType(market.bet_type);
    if (bt === "moneyline") {
      pushOutcome(h2h, outcomePayload(name, price, size));
    } else if (bt === "spread" && line != null) {
      pushOutcome(spreads, outcomePayload(name, price, size, line));
    } else if (bt === "total" && line != null) {
      pushOutcome(totals, outcomePayload(name, price, size, line));
    }
  }

  const markets = [];
  if (h2h.length) markets.push({ key: "h2h", outcomes: h2h });
  if (spreads.length) markets.push({ key: "spreads", outcomes: spreads });
  if (totals.length) markets.push({ key: "totals", outcomes: totals });
  if (!markets.length) return null;
  return { key: BOOKMAKER_BOOK_KEY, title: BOOKMAKER_TITLE, markets };
}

function h2hOutcomeOnBook(book, teamName) {
  const market = (book?.markets || []).find((m) => m && m.key === "h2h");
  if (!market) return null;
  return (market.outcomes || []).find((o) => o && teamsLikelySame(o.name, teamName)) || null;
}

function americanSign(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function medianAmerican(prices) {
  const s = (prices || []).map(Number).filter((n) => isFinite(n) && n !== 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 642 landed on the opposite side of the rest of the board (KU +163 attached
// to Arizona State). Complement of that +163 is displayed −163 / 62% true.
// Sign vs median is enough — the 40% inverted-opp guard misses this ~25pt gap.
export function bookmakerConflictsWithEventBooks(event, bm) {
  const h2h = (bm?.markets || []).find((m) => m && m.key === "h2h");
  if (!h2h) return false;
  const others = (event?.bookmakers || []).filter((b) => b && b.key !== BOOKMAKER_BOOK_KEY);
  if (!others.length) return false;
  for (const outcome of h2h.outcomes || []) {
    if (!outcome || outcome.price == null || !outcome.name) continue;
    const consensus = [];
    for (const book of others) {
      const hit = h2hOutcomeOnBook(book, outcome.name);
      if (hit && hit.price != null) consensus.push(hit.price);
    }
    if (consensus.length < 2) continue;
    const med = medianAmerican(consensus);
    const medSign = americanSign(med);
    const bmSign = americanSign(outcome.price);
    if (medSign && bmSign && medSign !== bmSign) return true;
  }
  return false;
}

export function overlayBookmakerOnGame(game, snapshot) {
  if (!game || typeof game !== "object") return game;
  const bookmakers = (game.bookmakers || []).filter((b) => b && b.key !== BOOKMAKER_BOOK_KEY);
  const stripped = { ...game, bookmakers };
  let bm = snapshot ? bookmakerBookmakerFromSnapshot(stripped, snapshot) : null;
  if (bm && bookmakerConflictsWithEventBooks(stripped, bm)) bm = null;
  return { ...stripped, bookmakers: bm ? [...bookmakers, bm] : bookmakers };
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
