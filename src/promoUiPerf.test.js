import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROMO_SPORT_RELOAD_DEBOUNCE_MS,
  PROMO_CARD_LAYER_STYLE,
  promoFilterWorkPending,
  promoSportsNeedNetworkReload,
} from "./promoUiPerf.js";
import { promoNeedsReload } from "./oddsLoad.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const board = fs.readFileSync(path.join(dir, "OddsBoard.jsx"), "utf8");
const scanSrc = fs.readFileSync(path.join(dir, "promoParlayScan.js"), "utf8");
const html = fs.readFileSync(path.join(dir, "../index.html"), "utf8");

assert.equal(PROMO_SPORT_RELOAD_DEBOUNCE_MS, 160);
assert.equal(PROMO_CARD_LAYER_STYLE.contentVisibility, "auto");
assert.ok(PROMO_CARD_LAYER_STYLE.containIntrinsicSize);

{
  const sports = new Set(["baseball_mlb"]);
  const books = new Set(["draftkings"]);
  const immediate = {
    sports,
    dateRange: "7d",
    marketScope: "all",
    promoBook: "draftkings",
    matchingBookKeys: books,
    hideLowLiquidity: true,
    numLegs: 3,
  };
  assert.equal(promoFilterWorkPending(immediate, immediate), false);
  assert.equal(promoFilterWorkPending(immediate, { ...immediate, dateRange: "today" }), true);
  assert.equal(promoFilterWorkPending(immediate, { ...immediate, hideLowLiquidity: false }), true);
  assert.equal(promoFilterWorkPending(immediate, { ...immediate, sports: new Set(["baseball_mlb"]) }), true);
  assert.equal(promoFilterWorkPending(null, immediate), false);
}

{
  const loaded = new Set(["baseball_mlb"]);
  assert.equal(promoSportsNeedNetworkReload(new Set(["baseball_mlb"]), loaded, true), false);
  assert.equal(promoSportsNeedNetworkReload(new Set(["baseball_mlb", "americanfootball_nfl"]), loaded, true), true);
  assert.equal(promoSportsNeedNetworkReload(new Set(["baseball_mlb"]), new Set(["baseball_mlb", "americanfootball_nfl"]), true), false);
  assert.equal(promoSportsNeedNetworkReload(new Set(["americanfootball_nfl"]), loaded, false), false);
  assert.equal(
    promoSportsNeedNetworkReload(new Set(["americanfootball_nfl"]), loaded, true),
    promoNeedsReload(new Set(["americanfootball_nfl"]), loaded),
  );
}

// App: chips stay urgent; rematch / pool / scan read deferred values
{
  assert.match(app, /useDeferredValue/);
  assert.match(app, /from "\.\/promoUiPerf\.js"/);
  assert.match(app, /const scanPromoSports = useDeferredValue\(promoSports\)/);
  assert.match(app, /const scanPromoDateRange = useDeferredValue\(promoDateRange\)/);
  assert.match(app, /const scanMarketScope = useDeferredValue\(marketScope\)/);
  assert.match(app, /const scanPromoBook = useDeferredValue\(promoBook\)/);
  assert.match(app, /const scanMatchingBookKeys = useDeferredValue\(matchingBookKeys\)/);
  assert.match(app, /const scanHideLowLiquidity = useDeferredValue\(hideLowLiquidity\)/);
  assert.match(app, /const scanNumLegs = useDeferredValue\(numLegs\)/);
  assert.match(app, /const deferredEvDateRange = useDeferredValue\(evDateRange\)/);
  assert.match(app, /transformOddsData\(row\.data, row\.sport, scanMatchingBookKeys\)/);
  assert.match(app, /transformEventOddsData\(row\.data, row\.sport, scanMatchingBookKeys\)/);
  assert.match(app, /buildAllLegsForBook\(promoOddsForPromo, scanPromoBook, promoSportFilter/);
  assert.match(app, /scopePromoLegs\(promoLegsAll, scanMarketScope\)/);
  assert.match(app, /filterLowLiquidityLegs\(promoLegsNamed, dropThinPoolLegs/);
  assert.match(app, /const dropThinPoolLegs = scanHideLowLiquidity/);
  assert.match(app, /filterLowLiquidityPicks\(ranked, ctx\.hideLowLiquidity\)/);
  assert.match(app, /promoFilterWorkPending\(/);
  assert.match(app, /PROMO_CARD_LAYER_STYLE/);
  assert.match(app, /PROMO_SPORT_RELOAD_DEBOUNCE_MS/);
  assert.match(app, /promoSportsNeedNetworkReload\(promoSports, promoLoadedSports, promoLoaded\)/);
  assert.match(app, /setTimeout\(\(\) => \{ loadPromoBoard\(\); \}, PROMO_SPORT_RELOAD_DEBOUNCE_MS\)/);
  assert.match(app, /buildAllLegsAllBooks\(allOddsData, null, deferredEvDateRange\)/);
  assert.doesNotMatch(
    app,
    /if \(promoNeedsReload\(promoSports, promoLoadedSports\)\) \{\s*loadPromoBoard\(\);/,
    "sport-add refetch must debounce, not fire on the chip click",
  );
}

// Reset effect: team / odds text use debounced values (not every keystroke)
{
  const resetDeps = app.match(/setExpandedFreeBet\(null\);[\s\S]*?\}, \[([^\]]+)\]/);
  assert.ok(resetDeps, "promo page reset effect");
  assert.match(resetDeps[1], /scanTeamInclude/);
  assert.match(resetDeps[1], /scanTeamExclude/);
  assert.match(resetDeps[1], /scanMinFinalOdds/);
  assert.match(resetDeps[1], /scanMatchingBookKeys/);
  assert.doesNotMatch(resetDeps[1], /(?<![A-Za-z])promoTeamInclude(?![A-Za-z])/);
  assert.doesNotMatch(resetDeps[1], /(?<![A-Za-z])minFinalOdds(?![A-Za-z])/);
}

// Shared shell: fonts once in index.html; Odds Board defers table rebuild
{
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=DM\+Sans/);
  assert.match(html, /JetBrains\+Mono/);
  assert.doesNotMatch(app, /<link href="https:\/\/fonts\.googleapis\.com/);
  assert.match(board, /useDeferredValue/);
  assert.match(board, /const deferredBoardSport = useDeferredValue\(boardSport\)/);
  assert.match(board, /const deferredSearch = useDeferredValue\(search\)/);
  assert.match(board, /const deferredSelectedBooks = useDeferredValue\(selectedBooks\)/);
  assert.match(board, /const deferredMarket = useDeferredValue\(market\)/);
}

// Scan yields before enumerating so a chip click can paint
{
  assert.match(scanSrc, /await yieldFn\(\);/);
  const start = scanSrc.indexOf("export async function findTopParlaysChunked");
  const body = scanSrc.slice(start, start + 900);
  assert.match(body, /throwIfAborted\(signal\);/);
  assert.match(body, /await yieldFn\(\);/);
}

console.log("promoUiPerf.test.js: ok");
