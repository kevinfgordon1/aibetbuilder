import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BOOKS, TRUSTED_BOOK_KEYS } from "../lib/promo-ev.js";
import { transformOddsData } from "./oddsTransform.js";
import {
  BETCRIS_BOOK_ID,
  BETCRIS_BOOK_KEY,
  BETCRIS_COMMENCE_WINDOW_MS,
  abbrHitsName,
  betcrisBookmakerFromSnapshot,
  betcrisSnapshotUrl,
  fetchBetcrisSnapshot,
  foldTeamName,
  joinOddsEventToBetstampFixture,
  leaguesForSports,
  overlayBetcrisOnCacheRows,
  overlayBetcrisOnGame,
  overlayBetcrisOnGames,
  teamMatchScore,
  teamsLikelySame,
} from "./promoBetcris.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

function nflEvent(overrides = {}) {
  return {
    id: "odds-den-kc",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: future,
    away_team: "Denver Broncos",
    home_team: "Kansas City Chiefs",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          { key: "h2h", outcomes: [{ name: "Denver Broncos", price: -110 }, { name: "Kansas City Chiefs", price: -110 }] },
          { key: "spreads", outcomes: [{ name: "Denver Broncos", price: -110, point: 3.5 }, { name: "Kansas City Chiefs", price: -110, point: -3.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -110, point: 44.5 }, { name: "Under", price: -110, point: 44.5 }] },
        ],
      },
    ],
    ...overrides,
  };
}

function betcrisSnapshot({ fixtureId = "fix-den-kc", commence = future, extraFixtures = [], extraMarkets = [] } = {}) {
  const den = { id: "team-den", name: "Denver Broncos", abbreviation: "DEN" };
  const kc = { id: "team-kc", name: "Kansas City Chiefs", abbreviation: "KC" };
  return {
    ok: true,
    fixtures: [
      {
        id: fixtureId,
        league: "NFL",
        start_date: commence,
        home_team_id: kc.id,
        away_team_id: den.id,
      },
      ...extraFixtures,
    ],
    teams: [den, kc],
    markets: [
      { odds: 2.20, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId, team_id: den.id, size: 250 },
      { odds: 1.71, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId, team_id: kc.id },
      { odds: 1.91, number: 2.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.91, number: -2.5, side: "KC", side_type: "Home", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.87, number: 46.5, side: "Over", side_type: "Over", bet_type: "Total", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.95, number: 46.5, side: "Under", side_type: "Under", bet_type: "Total", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.50, number: -7.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: true, odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.91, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "1H", odd_provider_id: 642, fixture_id: fixtureId },
      { odds: 1.80, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 200, fixture_id: fixtureId },
      ...extraMarkets,
    ],
  };
}

{
  assert.equal(BETCRIS_BOOK_KEY, "betcris");
  assert.equal(BETCRIS_BOOK_ID, 642);
  assert.ok(BETCRIS_COMMENCE_WINDOW_MS >= 6 * 60 * 60 * 1000);
  assert.equal(TRUSTED_BOOK_KEYS.has("betcris"), true);
  assert.equal(ALL_BOOKS.find((b) => b.key === "betcris")?.label, "BetCris");
  assert.ok(!ALL_BOOKS.find((b) => b.key === "betcris")?.exchange);
  assert.deepEqual(leaguesForSports(["americanfootball_nfl", "baseball_mlb"]), ["NFL"]);
  assert.deepEqual(leaguesForSports(new Set(["americanfootball_ncaaf", "americanfootball_nfl"])), ["NFL", "NCAAF"]);
  assert.deepEqual(leaguesForSports(["baseball_mlb"]), []);
}

{
  assert.equal(foldTeamName("Ohio St."), "ohio st");
  assert.equal(teamsLikelySame("Denver Broncos", "Denver"), true);
  assert.equal(teamsLikelySame("Kansas City Chiefs", "Kansas City"), true);
  assert.equal(teamsLikelySame("Ohio State Buckeyes", "Ohio State"), true);
  assert.equal(teamsLikelySame("Washington", "Washington State"), false);
  assert.equal(teamsLikelySame("Michigan", "Michigan State"), false);
  assert.equal(teamsLikelySame("Ohio", "Ohio State"), false);
  assert.equal(teamsLikelySame("New York Giants", "Giants"), true);
  assert.equal(abbrHitsName("DEN", "Denver Broncos"), true);
  assert.equal(teamMatchScore("Denver Broncos", "Broncos", "DEN"), 2);
  assert.equal(teamMatchScore("Denver Broncos", "", "DEN"), 1);
}

{
  const event = nflEvent();
  const snap = betcrisSnapshot();
  const join = joinOddsEventToBetstampFixture(event, snap);
  assert.equal(join.fixtureId, "fix-den-kc");
  assert.equal(join.swapped, false);
}

{
  const event = nflEvent();
  const snap = betcrisSnapshot({
    extraFixtures: [{
      id: "fix-other",
      league: "NFL",
      start_date: future,
      home_team: { name: "Buffalo Bills", abbreviation: "BUF" },
      away_team: { name: "Miami Dolphins", abbreviation: "MIA" },
    }],
  });
  assert.equal(joinOddsEventToBetstampFixture(event, snap).fixtureId, "fix-den-kc");
}

{
  const event = nflEvent();
  const far = new Date(Date.parse(future) + 20 * 60 * 60 * 1000).toISOString();
  const snap = betcrisSnapshot({ commence: far });
  assert.equal(joinOddsEventToBetstampFixture(event, snap), null);
}

{
  const event = nflEvent({ sport_key: "baseball_mlb", sport: "baseball_mlb" });
  assert.equal(joinOddsEventToBetstampFixture(event, betcrisSnapshot()), null);
}

{
  const ncaaf = {
    id: "odds-osu-um",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: future,
    away_team: "Ohio State Buckeyes",
    home_team: "Michigan Wolverines",
    bookmakers: [],
  };
  const washington = {
    id: "fix-uw-wsu",
    league: "NCAAF",
    start_date: future,
    home_team: { name: "Washington State", abbreviation: "WSU" },
    away_team: { name: "Washington", abbreviation: "UW" },
  };
  const osu = {
    id: "fix-osu-um",
    league: "NCAAF",
    start_date: future,
    home_team: { name: "Michigan", abbreviation: "MICH" },
    away_team: { name: "Ohio State", abbreviation: "OSU" },
  };
  const snap = { ok: true, fixtures: [washington, osu], teams: [], markets: [] };
  const join = joinOddsEventToBetstampFixture(ncaaf, snap);
  assert.equal(join.fixtureId, "fix-osu-um");
  assert.equal(joinOddsEventToBetstampFixture({
    ...ncaaf,
    away_team: "Washington Huskies",
    home_team: "Washington State Cougars",
  }, snap).fixtureId, "fix-uw-wsu");
}

{
  const event = nflEvent();
  const bm = betcrisBookmakerFromSnapshot(event, betcrisSnapshot());
  assert.equal(bm.key, "betcris");
  assert.equal(bm.title, "BetCris");
  const h2h = bm.markets.find((m) => m.key === "h2h");
  const spr = bm.markets.find((m) => m.key === "spreads");
  const tot = bm.markets.find((m) => m.key === "totals");
  assert.equal(h2h.outcomes.find((o) => o.name === "Denver Broncos").price, 120);
  assert.equal(h2h.outcomes.find((o) => o.name === "Kansas City Chiefs").price, -141);
  assert.equal(h2h.outcomes.find((o) => o.name === "Denver Broncos").size, 250);
  assert.equal(spr.outcomes.find((o) => o.name === "Denver Broncos").point, 2.5);
  assert.equal(spr.outcomes.find((o) => o.name === "Kansas City Chiefs").point, -2.5);
  assert.equal(tot.outcomes.find((o) => o.name === "Over").point, 46.5);
  assert.equal(tot.outcomes.find((o) => o.name === "Under").price, -105);
  assert.equal(bm.markets.some((m) => m.key === "alternate_spreads"), false);
  assert.ok(!h2h.outcomes.some((o) => o.price === -125), "DK-only / 1H / alt / other-book quotes stay out");
}

{
  const overlaid = overlayBetcrisOnGame(nflEvent(), betcrisSnapshot());
  assert.equal(overlaid.bookmakers.some((b) => b.key === "draftkings"), true);
  assert.equal(overlaid.bookmakers.filter((b) => b.key === "betcris").length, 1);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.betcris.ml_away, 120);
  assert.equal(ml.bookOdds.betcris.ml_home, -141);
  assert.equal(ml.best_away, 120);
  assert.equal(ml.best_away_book, "betcris");
  const spr = data.run_lines.find((r) => r.book === "betcris");
  assert.equal(spr.away_point, 2.5);
  assert.equal(spr.away_odds, -110);
  const tot = data.totals.find((r) => r.book === "betcris");
  assert.equal(tot.line, 46.5);
}

{
  const withZombie = overlayBetcrisOnGame(nflEvent(), betcrisSnapshot());
  assert.ok(withZombie.bookmakers.some((b) => b.key === "betcris"));
  const cleared = overlayBetcrisOnGame(withZombie, {
    ok: true,
    fixtures: betcrisSnapshot().fixtures,
    teams: betcrisSnapshot().teams,
    markets: [],
  });
  assert.equal(cleared.bookmakers.some((b) => b.key === "betcris"), false);
  const omitted = overlayBetcrisOnGame(withZombie, null);
  assert.equal(omitted.bookmakers.some((b) => b.key === "betcris"), false);
}

{
  const mlb = {
    id: "odds-nyy-bos",
    sport_key: "baseball_mlb",
    sport: "baseball_mlb",
    commence_time: future,
    away_team: "New York Yankees",
    home_team: "Boston Red Sox",
    bookmakers: [{ key: "draftkings", markets: [] }],
  };
  const rows = overlayBetcrisOnCacheRows([
    { sport: "americanfootball_nfl", data: [nflEvent()] },
    { sport: "baseball_mlb", data: [mlb] },
    { sport: "americanfootball_nfl", data: nflEvent({ id: "odds-event-row" }) },
  ], betcrisSnapshot());
  assert.equal(rows[0].data[0].bookmakers.some((b) => b.key === "betcris"), true);
  assert.equal(rows[1].data[0].bookmakers.some((b) => b.key === "betcris"), false);
  assert.equal(rows[2].data.bookmakers.some((b) => b.key === "betcris"), true);
  assert.equal(overlayBetcrisOnGames(null, betcrisSnapshot()), null);
}

{
  const url = betcrisSnapshotUrl({ leagues: ["NFL", "NCAAF", "MLB"] });
  assert.match(url, /\/api\/betstamp-markets\?/);
  assert.match(url, /league=NFL%2CNCAAF/);
  assert.match(url, /book_ids=642/);
  assert.match(url, /is_live=false/);
  assert.equal(betcrisSnapshotUrl({ leagues: ["MLB"] }), null);
}

{
  const snap = await fetchBetcrisSnapshot({
    leagues: ["NFL"],
    fetchFn: async (url) => {
      assert.match(url, /book_ids=642/);
      return { ok: true, json: async () => betcrisSnapshot() };
    },
  });
  assert.equal(snap.fixtures[0].id, "fix-den-kc");
}

{
  assert.equal(await fetchBetcrisSnapshot({ leagues: [] }), null);
  assert.equal(await fetchBetcrisSnapshot({
    leagues: ["NFL"],
    fetchFn: async () => { throw new Error("network"); },
  }), null);
  assert.equal(await fetchBetcrisSnapshot({
    leagues: ["NFL"],
    fetchFn: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, missingKey: true }) }),
  }), null);
  assert.equal(await fetchBetcrisSnapshot({
    leagues: ["NFL"],
    timeoutMs: 20,
    fetchFn: () => new Promise(() => {}),
  }), null);
}

{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const ev = fs.readFileSync(path.join(dir, "../lib/promo-ev.js"), "utf8");
  assert.match(app, /key: "betcris", label: "BetCris", color: "#f59e0b"/);
  assert.match(app, /from "\.\/promoBetcris\.js"/);
  assert.match(app, /overlayBetcrisOnCacheRows/);
  assert.match(app, /fetchBetcrisSnapshot/);
  assert.match(app, /leaguesForSports\(plan\.featuredSports\)/);
  assert.match(app, /Betstamp BetCris overlay is best-effort/);
  const appTrusted = app.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appTrusted[1].includes("betcris"));
  const evTrusted = ev.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(evTrusted[1].includes("betcris"));
  assert.match(ev, /key: "betcris", label: "BetCris"/);
}

console.log("promoBetcris.test.js ok");
