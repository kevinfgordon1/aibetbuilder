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
  DEFAULT_EV_DATE_RANGE,
  selectEvScanView,
  evScanFromLegs,
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

// ── Promo-only plan: selected featured + event sports, no futures / +EV-tab scan
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
  assert.equal(evCalled, false, "promo-only load path does not run the full-board +EV-tab scan");
}

// ── Default Promo filters (MLB+NCAAF) load only those two featured boards
{
  const plan = promoPlan(new Set(["baseball_mlb", "americanfootball_ncaaf"]));
  assert.deepEqual(plan.featuredSports, ["baseball_mlb", "americanfootball_ncaaf"]);
  assert.deepEqual(plan.eventSports, ["baseball_mlb", "americanfootball_ncaaf"]);
  assert.ok(!plan.featuredSports.includes("basketball_nba"));
  assert.ok(!plan.featuredSports.includes("americanfootball_nfl"));
  assert.equal(plan.futures, false);
  assert.equal(plan.computeEv, false);
}

// ── All 6 featured sports still skip futures
{
  const plan = promoPlan(new Set(SPORT_KEYS));
  assert.deepEqual(plan.featuredSports, SPORT_KEYS);
  assert.equal(plan.futures, false);
  assert.equal(plan.computeEv, false);
}

// ── Promo featured + events stay scoped to the selected sports
{
  const plan = promoPlan(new Set(["baseball_mlb", "americanfootball_nfl"]));
  assert.deepEqual(plan.featuredSports, ["baseball_mlb", "americanfootball_nfl"]);
  assert.deepEqual(plan.eventSports, ["baseball_mlb", "americanfootball_nfl"]);
  assert.ok(!plan.eventSports.includes("basketball_nba"));
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

// ── queryOddsCaches: promo featured + events stay scoped to selected sports
{
  const client = createMockClient();
  const sports = ["basketball_nba", "icehockey_nhl"];
  await queryOddsCaches(client, promoPlan(new Set(sports)));
  assert.deepEqual(client.calls[0].in.vals, sports);
  assert.deepEqual(client.calls[1].in.vals, sports);
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

// ── +EV tab view: live scan wins, else cached; no promo-board header scan
{
  assert.equal(DEFAULT_EV_DATE_RANGE, "today");
  const live = { allEvLegs: [1, 2], evBets: [{ ev: 9, name: "Full" }], positiveEV: [{}] };
  const cached = { allEvLegs: [1], evBets: [{ ev: 1, name: "Cached" }], positiveEV: [] };
  assert.equal(selectEvScanView({ liveEvScan: live, cachedEvScan: cached }), live);
  assert.equal(selectEvScanView({ liveEvScan: null, cachedEvScan: cached }), cached);
  assert.equal(selectEvScanView({ liveEvScan: null, cachedEvScan: null }), null);
}

// ── evScanFromLegs ranks by EV and counts +EV
{
  const legs = [
    { name: "A", dk: 100, bestOpp: -110 },
    { name: "B", dk: 120, bestOpp: -110 },
  ];
  const out = evScanFromLegs(legs, (dk, opp) => ({
    prob: 0.5,
    ev: dk === 120 ? 3 : -1,
    profit: dk,
  }));
  assert.equal(out.allEvLegs.length, 2);
  assert.equal(out.evBets[0].name, "B");
  assert.equal(out.evBets[0].ev, 3);
  assert.equal(out.positiveEV.length, 1);
}

// ── Promo hard refresh does not fetch the full board (header cards are gone)
{
  assert.equal(shouldFetchFullBoard({ tab: "promo", fullBoardLoaded: false, forceRefresh: false }), false);
  assert.equal(shouldFetchFullBoard({ tab: "promo", fullBoardLoaded: false, forceRefresh: true }), false);
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
  assert.match(app, /if \(!shouldRunEvScan\(loadModeForTab\(activeTab\)\)\) return null;/);
  assert.match(app, /buildAllLegsAllBooks\(allOddsData,/);
  assert.doesNotMatch(app, /buildAllLegsAllBooks\(promoBoardData,/);
  assert.doesNotMatch(app, /shouldComputePromoHeaderScan/);
  assert.doesNotMatch(app, /setPromoHeaderEvScan/);
  assert.doesNotMatch(app, /promoHeaderEvScan/);
  assert.doesNotMatch(app, /evHeaderShowLoading/);
  assert.doesNotMatch(app, /evHeaderValues/);
  assert.doesNotMatch(app, /function StatCard/);
  assert.doesNotMatch(app, /Total Bets Analyzed/);
  assert.doesNotMatch(app, /Best Single EV/);
  assert.match(app, /selectEvScanView\(/);
  assert.match(app, /setPromoLoadedSports\(new Set\(plan\.eventSports\)\)/);
  assert.match(app, /queryOddsCaches\(supabase, plan\)/);
  assert.match(app, /shouldFetchFullBoard\(\{ tab: activeTab, fullBoardLoaded, forceRefresh: false \}\)/);
  assert.match(app, /fetchOdds\(\{ forceRefresh: true \}\)/);
  assert.match(app, /setPromoBoardData/);
  assert.doesNotMatch(app, /in\("sport", SPORT_KEYS\)/);
  assert.doesNotMatch(app, /in\("sport", FUTURES_KEYS\)/);
  assert.match(app, /const DEFAULT_PROMO_SPORT_KEYS = \["baseball_mlb", "americanfootball_ncaaf"\]/);
  assert.match(app, /const DEFAULT_PROMO_DATE_RANGE = "7d"/);
  assert.match(app, /\[promoDateRange, setPromoDateRange\] = useState\(DEFAULT_PROMO_DATE_RANGE\)/);
  assert.match(app, /\[promoSports, setPromoSports\] = useState\(new Set\(DEFAULT_PROMO_SPORT_KEYS\)\)/);
  assert.match(app, /\[evDateRange, setEvDateRange\] = useState\(DEFAULT_EV_DATE_RANGE\)/);
  assert.doesNotMatch(app, /\[evDateRange, setEvDateRange\] = useState\("any"\)/);
  assert.match(app, /\[boardSport, setBoardSport\] = useState\("baseball_mlb"\)/);
}

console.log("oddsLoad.test.js: ok");
