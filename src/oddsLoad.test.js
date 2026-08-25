import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENT_ODDS_LOOKBACK_MS,
  loadModeForTab,
  sportKeysForPromoLoad,
  buildOddsQueryPlan,
  shouldRunEvScan,
  shouldFetchFullBoard,
  shouldFetchPromoOdds,
  promoNeedsReload,
  queryOddsCaches,
  evHeaderValues,
} from "./oddsLoad.js";
import { TRUSTED_BOOK_KEYS, SPORT_KEYS } from "../lib/promo-ev.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FUTURES_KEYS = [
  "baseball_mlb_world_series_winner",
  "americanfootball_nfl_super_bowl_winner",
  "americanfootball_ncaaf_championship_winner",
  "basketball_nba_championship_winner",
  "basketball_ncaab_championship_winner",
  "icehockey_nhl_championship_winner",
];
const NOW = new Date("2026-08-25T15:00:00.000Z");

function createMockClient() {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, select: null, in: null, gte: null };
      calls.push(state);
      const chain = {
        select(cols) { state.select = cols; return chain; },
        in(col, vals) { state.in = { col, vals: [...vals] }; return chain; },
        gte(col, val) { state.gte = { col, val }; return chain; },
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function promoPlan(promoSports) {
  return buildOddsQueryPlan({
    mode: "promo",
    promoSports,
    now: NOW,
    featuredSportKeys: SPORT_KEYS,
    futuresKeys: FUTURES_KEYS,
  });
}

function fullPlan() {
  return buildOddsQueryPlan({
    mode: "full",
    now: NOW,
    featuredSportKeys: SPORT_KEYS,
    futuresKeys: FUTURES_KEYS,
  });
}

// ── Tab → load mode
{
  assert.equal(loadModeForTab("promo"), "promo");
  assert.equal(loadModeForTab("combo"), "promo");
  assert.equal(loadModeForTab("missTape"), "promo");
  assert.equal(loadModeForTab("ev"), "full");
  assert.equal(loadModeForTab("odds"), "full");
}

// ── Promo-only plan: selected sports, no futures, no EV scan
{
  const plan = promoPlan(new Set(["baseball_mlb"]));
  assert.deepEqual(plan.featuredSports, ["baseball_mlb"]);
  assert.deepEqual(plan.eventSports, ["baseball_mlb"]);
  assert.equal(plan.futures, false);
  assert.deepEqual(plan.futuresKeys, []);
  assert.equal(plan.computeEv, false);
  assert.equal(shouldRunEvScan(plan.mode), false);
  assert.equal(plan.eventSince, new Date(NOW.getTime() - EVENT_ODDS_LOOKBACK_MS).toISOString());

  let evCalled = false;
  if (plan.computeEv) evCalled = true;
  assert.equal(evCalled, false, "promo-only load path does not call buildAllLegsAllBooks");
}

// ── All 6 featured sports still skip futures
{
  const plan = promoPlan(new Set(SPORT_KEYS));
  assert.deepEqual(plan.featuredSports, SPORT_KEYS);
  assert.equal(plan.futures, false);
  assert.equal(plan.computeEv, false);
}

// ── Promo sports subset
{
  const plan = promoPlan(new Set(["baseball_mlb", "americanfootball_nfl"]));
  assert.deepEqual(plan.featuredSports, ["baseball_mlb", "americanfootball_nfl"]);
  assert.ok(!plan.featuredSports.includes("basketball_nba"));
}

// ── Full board plan matches today's all-sports + futures + EV
{
  const plan = fullPlan();
  assert.deepEqual(plan.featuredSports, SPORT_KEYS);
  assert.equal(plan.eventSince, null);
  assert.equal(plan.futures, true);
  assert.deepEqual(plan.futuresKeys, FUTURES_KEYS);
  assert.equal(plan.computeEv, true);
  assert.equal(shouldRunEvScan(plan.mode), true);
}

// ── queryOddsCaches: promo does not query FUTURES_KEYS
{
  const client = createMockClient();
  await queryOddsCaches(client, promoPlan(new Set(["baseball_mlb"])));
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].table, "odds_cache");
  assert.deepEqual(client.calls[0].in, { col: "sport", vals: ["baseball_mlb"] });
  assert.equal(client.calls[1].table, "event_odds_cache");
  assert.deepEqual(client.calls[1].in, { col: "sport", vals: ["baseball_mlb"] });
  assert.equal(client.calls[1].gte.col, "commence_time");
  assert.equal(client.calls[1].gte.val, new Date(NOW.getTime() - EVENT_ODDS_LOOKBACK_MS).toISOString());
  assert.ok(!client.calls.some((c) => c.in && FUTURES_KEYS.some((k) => c.in.vals.includes(k))));
}

// ── queryOddsCaches: promo subset queries only those sport keys
{
  const client = createMockClient();
  const sports = ["basketball_nba", "icehockey_nhl"];
  await queryOddsCaches(client, promoPlan(new Set(sports)));
  for (const call of client.calls) {
    assert.deepEqual(call.in.vals, sports);
  }
}

// ── queryOddsCaches: full board includes futures, no commence_time floor
{
  const client = createMockClient();
  await queryOddsCaches(client, fullPlan());
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls[0].in.vals, SPORT_KEYS);
  assert.equal(client.calls[1].gte, null);
  assert.deepEqual(client.calls[2].in, { col: "sport", vals: FUTURES_KEYS });
}

// ── Visiting ev/odds without a full board triggers load; second visit does not
{
  assert.equal(shouldFetchFullBoard({ tab: "promo", fullBoardLoaded: false, forceRefresh: false }), false);
  assert.equal(shouldFetchFullBoard({ tab: "ev", fullBoardLoaded: false, forceRefresh: false }), true);
  assert.equal(shouldFetchFullBoard({ tab: "odds", fullBoardLoaded: false, forceRefresh: false }), true);
  assert.equal(shouldFetchFullBoard({ tab: "ev", fullBoardLoaded: true, forceRefresh: false }), false);
  assert.equal(shouldFetchFullBoard({ tab: "odds", fullBoardLoaded: true, forceRefresh: false }), false);
}

// ── Refresh on ev refetches the full board
{
  assert.equal(shouldFetchFullBoard({ tab: "ev", fullBoardLoaded: true, forceRefresh: true }), true);
  assert.equal(shouldFetchFullBoard({ tab: "odds", fullBoardLoaded: true, forceRefresh: true }), true);
  assert.equal(shouldFetchPromoOdds({ tab: "ev", forceRefresh: true, promoLoaded: true }), false);
}

// ── Promo refresh / first load; combo Refresh is promo-cheap, not full
{
  assert.equal(shouldFetchPromoOdds({ tab: "promo", forceRefresh: false, promoLoaded: false }), true);
  assert.equal(shouldFetchPromoOdds({ tab: "promo", forceRefresh: false, promoLoaded: true }), false);
  assert.equal(shouldFetchPromoOdds({ tab: "promo", forceRefresh: true, promoLoaded: true }), true);
  assert.equal(shouldFetchPromoOdds({ tab: "combo", forceRefresh: true, promoLoaded: true }), true);
  assert.equal(shouldFetchPromoOdds({ tab: "missTape", forceRefresh: true, promoLoaded: true }), true);
  assert.equal(shouldFetchFullBoard({ tab: "combo", fullBoardLoaded: false, forceRefresh: true }), false);
}

// ── Adding a promo sport that is not loaded yet requires a reload
{
  assert.equal(promoNeedsReload(new Set(["baseball_mlb"]), new Set(["baseball_mlb"])), false);
  assert.equal(promoNeedsReload(new Set(["baseball_mlb", "americanfootball_nfl"]), new Set(["baseball_mlb"])), true);
  assert.equal(promoNeedsReload(new Set(["baseball_mlb"]), new Set(["baseball_mlb", "americanfootball_nfl"])), false);
}

// ── Header stats: snapshot or em-dash, never a fake 0 from a skipped scan
{
  assert.deepEqual(evHeaderValues({ evScan: null, showLoading: false }), {
    total: "—", plusEv: "—", bestValue: "—", bestSub: "",
  });
  assert.deepEqual(evHeaderValues({ evScan: null, showLoading: true }), {
    total: "...", plusEv: "...", bestValue: "...", bestSub: "",
  });
  const scan = {
    allEvLegs: [{}, {}, {}],
    evBets: [{ ev: 4.2, name: "Yankees ML" }],
    positiveEV: [{}],
  };
  assert.deepEqual(evHeaderValues({ evScan: scan, showLoading: false }), {
    total: 3, plusEv: 1, bestValue: "+$4.20", bestSub: "Yankees ML",
  });
}

// ── sportKeysForPromoLoad keeps featured order
{
  assert.deepEqual(sportKeysForPromoLoad(new Set(["icehockey_nhl", "baseball_mlb"]), SPORT_KEYS), [
    "baseball_mlb",
    "icehockey_nhl",
  ]);
}

// ── promo-ev.js trusted set unchanged
{
  const ev = fs.readFileSync(path.join(dir, "../lib/promo-ev.js"), "utf8");
  const evTrusted = ev.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(evTrusted, "promo-ev.js TRUSTED_BOOK_KEYS block");
  const listed = [...evTrusted[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(listed, [
    "draftkings", "fanduel", "williamhill_us", "betmgm", "betrivers",
    "fanatics", "hardrockbet", "espnbet", "bovada", "mybookieag", "betonlineag",
    "kalshi", "novig", "prophetx", "polymarket",
  ]);
  assert.equal(TRUSTED_BOOK_KEYS.has("betanysports"), false);
  assert.equal(TRUSTED_BOOK_KEYS.has("betopenly"), false);
  assert.match(ev, /this EV-scanner copy always uses the full TRUSTED_BOOK_KEYS set/);
}

// ── App.jsx wires promo vs full-board paths
{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/oddsLoad\.js"/);
  assert.match(app, /buildAllLegsForBook\(promoOddsData,/);
  assert.match(app, /if \(!shouldRunEvScan\(loadModeForTab\(activeTab\)\)\) return null;\s*const allEvLegs = buildAllLegsAllBooks\(allOddsData,/);
  assert.match(app, /queryOddsCaches\(supabase, plan\)/);
  assert.match(app, /shouldFetchFullBoard\(\{ tab: activeTab, fullBoardLoaded, forceRefresh: false \}\)/);
  assert.match(app, /fetchOdds\(\{ forceRefresh: true \}\)/);
  assert.match(app, /setPromoBoardData/);
  assert.doesNotMatch(app, /in\("sport", SPORT_KEYS\)/);
  assert.doesNotMatch(app, /in\("sport", FUTURES_KEYS\)/);
}

console.log("oddsLoad.test.js: ok");
