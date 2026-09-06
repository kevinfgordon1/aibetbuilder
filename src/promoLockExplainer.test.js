import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calcNoSweatLock } from "./promoNoSweat.js";
import { calcFreeBetConversion } from "./promoFreeBet.js";
import {
  describePromoLock,
  hedgeContractsFromStake,
  formatHedgeContracts,
} from "./promoLockExplainer.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

// Boost: $100 at +100 boosted (win $100), hedge +100 (d_h=2)
// H = (100+100)/2 = 100; lock = 0 — invalid, so skip. Use +150 boost / -110 hedge.
// Boosted profit $150, stake $100, hedge -110 (d_h=1.90909…)
// H = 250 / (1+100/110) = 250 / (210/110) = 250 * 110/210 ≈ 130.952
{
  const d_h = 1 + 100 / 110;
  const lock = {
    valid: true,
    hedgeStake: (150 + 100) / d_h,
    lockedProfit: 150 - (150 + 100) / d_h,
    d_h,
  };
  const d = describePromoLock({
    variant: "boost",
    stake: 100,
    winProfit: 150,
    lock,
    promoBookLabel: "DraftKings",
    promoOdds: 150,
    promoSelection: "Lakers ML",
    hedgeBookLabel: "Pinnacle",
    hedgeOdds: -110,
    hedgeSelection: "Celtics ML",
  });
  assert.ok(d);
  assert.equal(d.kind, "boost");
  assert.equal(d.promo.label, "Promo stake");
  assert.equal(d.promo.stakeText, "$100.00");
  assert.equal(d.promo.winText, "$150.00");
  assert.equal(d.promo.book, "DraftKings");
  assert.equal(d.promo.odds, "+150");
  assert.equal(d.promo.oddsNote, "with boost");
  assert.equal(d.hedge.book, "Pinnacle");
  assert.equal(d.hedge.odds, "-110");
  assert.equal(d.hedge.selection, "Celtics ML");
  assert.equal(d.hedge.contracts, null);
  assert.equal(d.hedge.contractsText, null);
  assert.equal(d.hedge.availableText, null);
  assert.ok(Math.abs(d.eitherWay.ifHits.net - d.locked) < 1e-9);
  assert.ok(Math.abs(d.eitherWay.ifLoses.net - d.locked) < 1e-9);
  assert.match(d.eitherWay.ifHits.label, /If promo hits/);
  assert.match(d.eitherWay.ifLoses.label, /If promo loses/);
  assert.match(d.eitherWay.ifHits.detail, /\$150\.00 win/);
  assert.match(d.eitherWay.ifLoses.detail, /hedge − \$100\.00 stake/);
}

// Missing hedge book / price / size — omit, do not invent fills
{
  const lock = { valid: true, hedgeStake: 80, lockedProfit: 40, d_h: 2 };
  const d = describePromoLock({
    variant: "boost",
    stake: 100,
    winProfit: 120,
    lock,
    promoBookLabel: "FanDuel",
    promoOdds: 120,
  });
  assert.equal(d.hedge.book, null);
  assert.equal(d.hedge.odds, null);
  assert.equal(d.hedge.selection, null);
  assert.equal(d.hedge.availableText, null);
  assert.equal(d.hedge.contractsText, null);
  assert.equal(d.hedge.stakeText, "$80.00");
}

// Exchange hedge: contracts from known $ and known decimal only
{
  const lock = { valid: true, hedgeStake: 40, lockedProfit: 20, d_h: 2.5 };
  const d = describePromoLock({
    variant: "boost",
    stake: 100,
    winProfit: 60,
    lock,
    hedgeBookLabel: "Kalshi",
    hedgeOdds: 150,
    hedgeIsExchange: true,
    hedgeAvailableSize: 54,
    hedgeNote: "after Kalshi fee",
  });
  assert.equal(hedgeContractsFromStake(40, 2.5), 100);
  assert.equal(d.hedge.contractsText, "100 contracts");
  assert.equal(d.hedge.availableText, "$54 currently available");
  assert.equal(d.hedge.note, "after Kalshi fee");
  assert.equal(d.hedge.odds, "+150");
}

// Sportsbook hedge never shows invented contracts even if decimal is known
{
  const lock = { valid: true, hedgeStake: 40, lockedProfit: 20, d_h: 2.5 };
  const d = describePromoLock({
    variant: "boost",
    stake: 100,
    winProfit: 60,
    lock,
    hedgeBookLabel: "FanDuel",
    hedgeOdds: 150,
    hedgeIsExchange: false,
  });
  assert.equal(d.hedge.contractsText, null);
}

// Size 0 / missing is omitted (do not invent liquidity)
{
  const lock = { valid: true, hedgeStake: 40, lockedProfit: 20, d_h: 2 };
  const none = describePromoLock({
    variant: "boost", stake: 100, winProfit: 60, lock, hedgeAvailableSize: 0,
  });
  const missing = describePromoLock({
    variant: "boost", stake: 100, winProfit: 60, lock,
  });
  assert.equal(none.hedge.availableText, null);
  assert.equal(missing.hedge.availableText, null);
}

// No-sweat: $100 +100 vs +100 hedge, V=$70 → H=65, lock=35
{
  const lock = calcNoSweatLock({
    winProfit: 100,
    stake: 100,
    creditValue: 70,
    hedgeDecimal: 2,
  });
  const d = describePromoLock({
    variant: "nosweat",
    stake: 100,
    winProfit: 100,
    lock,
    promoBookLabel: "DraftKings",
    promoOdds: 100,
    hedgeBookLabel: "FanDuel",
    hedgeOdds: 100,
    creditValue: 70,
    refund: 100,
    conversionPct: 70,
  });
  assert.equal(d.kind, "nosweat");
  assert.equal(d.promo.label, "No-sweat stake");
  assert.equal(d.promo.oddsNote, "no-sweat");
  assert.equal(d.locked, 35);
  assert.equal(d.hedge.stakeText, "$65.00");
  assert.ok(Math.abs(d.eitherWay.ifHits.net - 35) < 1e-9);
  assert.ok(Math.abs(d.eitherWay.ifLoses.net - 35) < 1e-9);
  assert.match(d.promo.extras[0], /\$100\.00 credit ≈ \$70\.00 cash/);
  assert.match(d.eitherWay.ifLoses.detail, /credit/);
  assert.match(d.eitherWay.ifHits.label, /no-sweat hits/);
}

// Free-bet: $100 at +100, hedge +100 → H=50, cash=50
{
  const lock = calcFreeBetConversion(100, 100, 100);
  const d = describePromoLock({
    variant: "freebet",
    stake: 100,
    winProfit: 100,
    lock,
    promoBookLabel: "BetMGM",
    promoOdds: 100,
    hedgeBookLabel: "Pinnacle",
    hedgeOdds: 100,
  });
  assert.equal(d.kind, "freebet");
  assert.equal(d.promo.label, "Free bet");
  assert.equal(d.locked, 50);
  assert.equal(d.hedge.stakeText, "$50.00");
  assert.ok(Math.abs(d.eitherWay.ifHits.net - 50) < 1e-9);
  assert.ok(Math.abs(d.eitherWay.ifLoses.net - 50) < 1e-9);
  assert.match(d.eitherWay.ifLoses.detail, /costs \$0/);
  assert.match(d.promo.extras[0], /not returned/);
}

// Invalid / missing lock → null (no invented panel)
{
  assert.equal(describePromoLock({ variant: "boost", stake: 100, winProfit: 50, lock: null }), null);
  assert.equal(describePromoLock({ variant: "boost", stake: 100, winProfit: 50, lock: { valid: false, hedgeStake: 0, lockedProfit: 0 } }), null);
}

{
  assert.equal(hedgeContractsFromStake(0, 2), null);
  assert.equal(hedgeContractsFromStake(40, 1), null);
  assert.equal(formatHedgeContracts(100.02), "100");
  assert.equal(formatHedgeContracts(40.4), "40.4");
}

// App wires the explainer into Guaranteed Profit and debounces odds bounds
{
  assert.match(app, /describePromoLock/);
  assert.match(app, /If promo hits|ifHits\.label/);
  assert.match(app, /useDebouncedValue\(minFinalOdds/);
  assert.match(app, /useDebouncedValue\(maxFinalOdds/);
  assert.match(app, /useDebouncedValue\(minLegOdds/);
  assert.match(app, /useDebouncedValue\(maxLegOdds/);
  assert.match(app, /scanMinFinalOdds !== ""\) \? Number\(scanMinFinalOdds\)/);
  assert.match(app, /scanMaxFinalOdds !== ""\) \? Number\(scanMaxFinalOdds\)/);
  assert.match(app, /scanMinLegOdds !== ""\) \? Number\(scanMinLegOdds\)/);
  assert.match(app, /scanMaxLegOdds !== ""\) \? Number\(scanMaxLegOdds\)/);
}

console.log("promoLockExplainer.test.js: ok");
