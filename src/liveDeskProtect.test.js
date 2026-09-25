import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROTECT_X_CENTS,
  DEFAULT_PROTECT_Y_CENTS,
  MAX_PROTECTS_PER_LINEAGE,
  centsToMicro,
  evaluateProtect,
  improveFromMid,
  protectContracts,
  yesMidFromBbo,
  outcomeMidMicro,
  formatProtectTelegram,
  readProtectRequest,
  parseProtectCents,
  originalSubmittedMicro,
  protectFillForPosition,
} from "./liveDeskProtect.js";

const here = path.dirname(fileURLToPath(import.meta.url));

assert.equal(DEFAULT_PROTECT_X_CENTS, 3);
assert.equal(DEFAULT_PROTECT_Y_CENTS, 1);
assert.equal(MAX_PROTECTS_PER_LINEAGE, 8);
assert.equal(centsToMicro(3), 30_000);
assert.equal(centsToMicro(1), 10_000);
assert.equal(centsToMicro(0.5), 5_000);

assert.equal(readProtectRequest({}).on, true, "Bet Protect is on when the flag is omitted");
assert.equal(readProtectRequest({}).xCents, 3);
assert.equal(readProtectRequest({}).yCents, 1);
assert.equal(readProtectRequest({}).defaulted, true);
assert.equal(readProtectRequest({ protect: true }).defaulted, false);
assert.equal(readProtectRequest({ protect: null }).on, true);
assert.equal(readProtectRequest({ protect: false }).on, false);
assert.equal(readProtectRequest({ protect: 0 }).on, false);
assert.equal(readProtectRequest({ protect: "false" }).on, false);
assert.equal(readProtectRequest({ protect: "off" }).on, false);
assert.equal(readProtectRequest({}, { riskDollars: 100 }).on, true, "exactly at the cap is protected");
{
  const over = readProtectRequest({}, { riskDollars: 100.5 });
  assert.equal(over.ok, true);
  assert.equal(over.on, false);
  assert.equal(over.overCap, true);
  assert.match(over.note, /\$100 Bet Protect cap/);
  const overExplicit = readProtectRequest({ protect: true }, { riskDollars: 150 });
  assert.equal(overExplicit.ok, true, "over the cap is sent unprotected, not blocked");
  assert.equal(overExplicit.on, false);
  assert.equal(overExplicit.overCap, true);
  assert.equal(readProtectRequest({ protect: false }, { riskDollars: 150 }).overCap, undefined);
}
assert.equal(readProtectRequest({ protect: true }).xCents, 3);
assert.equal(readProtectRequest({ protect: true }).yCents, 1);
assert.equal(readProtectRequest({ protect: true, protectXCents: 0 }).ok, false);
assert.equal(parseProtectCents(4.24, 3, { min: 0.1 }).cents, 4.2);

{
  const bbo = yesMidFromBbo({
    marketData: {
      bestBid: { value: "0.55", currency: "USD" },
      bestAsk: { value: "0.57", currency: "USD" },
    },
  });
  assert.equal(bbo, 0.56);
  assert.equal(yesMidFromBbo({ marketData: { bestBid: { value: "0.55" } } }), null);
  assert.equal(yesMidFromBbo({ marketData: { bestBid: { value: "0.60" }, bestAsk: { value: "0.50" } } }), null);
  assert.equal(outcomeMidMicro(0.62, "short"), 380_000);
  assert.equal(outcomeMidMicro(0.62, "long"), 620_000);
}

{
  // Buy 60¢, mid 57¢, X = 3¢ → exactly 3¢ through. Spec is more than X, so this stays.
  const exact = evaluateProtect({ action: "buy", restingOutcomeMicro: 600_000, midOutcomeMicro: 570_000, xCents: 3 });
  assert.equal(exact.fire, false);
  assert.equal(exact.reason, "inside");
  assert.equal(exact.gapMicro, 30_000);
  // 4¢ through fires once.
  const hit = evaluateProtect({ action: "buy", restingOutcomeMicro: 600_000, midOutcomeMicro: 560_000, xCents: 3 });
  assert.equal(hit.fire, true);
  assert.equal(hit.reason, "through");
  assert.equal(hit.gapMicro, 40_000);
  // 2¢ through is inside the cushion.
  const inside = evaluateProtect({ action: "buy", restingOutcomeMicro: 600_000, midOutcomeMicro: 580_000, xCents: 3 });
  assert.equal(inside.fire, false);
  assert.equal(inside.reason, "inside");
  // Market ran up through the bid. Do not chase.
  const away = evaluateProtect({ action: "buy", restingOutcomeMicro: 500_000, midOutcomeMicro: 620_000, xCents: 3 });
  assert.equal(away.fire, false);
  assert.equal(away.reason, "ran-away");
}

{
  // Sell 36¢, mid 40¢ → 4¢ through (offering below the mid).
  const hit = evaluateProtect({ action: "sell", restingOutcomeMicro: 360_000, midOutcomeMicro: 400_000, xCents: 3 });
  assert.equal(hit.fire, true);
  assert.equal(hit.gapMicro, 40_000);
  // Market ran down, his offer is now above mid. Park it.
  const away = evaluateProtect({ action: "sell", restingOutcomeMicro: 500_000, midOutcomeMicro: 400_000, xCents: 3 });
  assert.equal(away.fire, false);
  assert.equal(away.reason, "ran-away");
}

{
  const buy = improveFromMid({
    outcome: "long",
    action: "buy",
    midOutcomeMicro: 560_000,
    yCents: 1,
    tick: 0.01,
    restingOutcomeMicro: 600_000,
    xCents: 3,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.outcomeMicro, 550_000);
  assert.equal(buy.yesPriceValue, "0.55");
  assert.equal(buy.snappedAmericanLabel, "-122");
  assert.equal(buy.centsLabel, "55¢");
  assert.equal(buy.intent, "ORDER_INTENT_BUY_LONG");
  assert.ok(buy.outcomeMicro < 600_000);
  const still = evaluateProtect({
    action: "buy",
    restingOutcomeMicro: buy.outcomeMicro,
    midOutcomeMicro: 560_000,
    xCents: 3,
  });
  assert.equal(still.fire, false);
}

{
  const sell = improveFromMid({
    outcome: "long",
    action: "sell",
    midOutcomeMicro: 400_000,
    yCents: 1,
    tick: 0.01,
    restingOutcomeMicro: 360_000,
    xCents: 3,
  });
  assert.equal(sell.ok, true);
  assert.equal(sell.outcomeMicro, 410_000);
  assert.equal(sell.snappedAmericanLabel, "+144");
  assert.equal(sell.centsLabel, "41¢");
  assert.ok(sell.outcomeMicro > 360_000);
}

{
  // Buy the short team. YES mid 62¢ → NO mid 38¢. Re-rest NO at 37¢ (YES book 63¢).
  const buyNo = improveFromMid({
    outcome: "short",
    action: "buy",
    midOutcomeMicro: 380_000,
    yCents: 1,
    tick: 0.01,
    restingOutcomeMicro: 420_000,
    xCents: 3,
  });
  assert.equal(buyNo.ok, true);
  assert.equal(buyNo.intent, "ORDER_INTENT_BUY_SHORT");
  assert.equal(buyNo.outcomeMicro, 370_000);
  assert.equal(buyNo.yesPriceValue, "0.63");
  assert.equal(buyNo.snappedAmericanLabel, "+170");
  assert.equal(buyNo.centsLabel, "37¢");
}

{
  // Off-tick target still snaps in his favor: buy floors, sell ceils.
  const buy = improveFromMid({
    outcome: "long",
    action: "buy",
    midOutcomeMicro: 573_000,
    yCents: 1,
    tick: 0.005,
    restingOutcomeMicro: 610_000,
    xCents: 3,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.outcomeMicro, 560_000);
  assert.ok(buy.outcomeMicro <= 563_000);
  assert.equal(buy.outcomeMicro % 5_000, 0);
  const sell = improveFromMid({
    outcome: "long",
    action: "sell",
    midOutcomeMicro: 573_000,
    yCents: 1,
    tick: 0.005,
    restingOutcomeMicro: 540_000,
    xCents: 3,
  });
  assert.equal(sell.ok, true);
  assert.equal(sell.outcomeMicro, 585_000);
  assert.ok(sell.outcomeMicro >= 583_000);
  assert.equal(sell.outcomeMicro % 5_000, 0);
}

{
  const same = improveFromMid({
    outcome: "long",
    action: "buy",
    midOutcomeMicro: 560_000,
    yCents: 0,
    tick: 0.01,
    restingOutcomeMicro: 560_000,
    xCents: 3,
  });
  assert.equal(same.ok, false);
  assert.equal(same.code, "no-improve");
}

{
  const keep = protectContracts({ leaves: 41, outcomeMicro: 600_000, action: "buy", minQty: 1 });
  assert.equal(keep.ok, true);
  assert.equal(keep.contracts, 41);
  assert.ok(keep.riskDollars <= 100);
  const capped = protectContracts({ leaves: 500, outcomeMicro: 600_000, action: "buy", minQty: 1 });
  assert.equal(capped.ok, true);
  assert.equal(capped.contracts, 166);
  assert.ok(capped.riskDollars <= 100);
}

{
  const text = formatProtectTelegram({
    title: "Los Angeles vs. Tennessee",
    action: "buy",
    outcomeName: "Los Angeles Chargers",
    oldAmerican: "-150",
    newAmerican: "-122",
    oldCents: "60¢",
    newCents: "55¢",
    contracts: 41,
  });
  assert.match(text, /Los Angeles vs\. Tennessee/);
  assert.match(text, /Buy Los Angeles Chargers -150 \(60¢\) → -122 \(55¢\)/);
  assert.match(text, /Cancelled → re-rested/);
  assert.match(text, /41 contracts/);
  const capped = formatProtectTelegram({
    title: "Los Angeles vs. Tennessee",
    action: "sell",
    outcomeName: "Titans",
    oldAmerican: "+150",
    oldCents: "40¢",
    contracts: 10,
    cancelledOnly: true,
    reason: "capped",
  });
  assert.match(text, /^Bet Protect · /);
  assert.match(capped, /Cancelled · Bet Protect cap/);
  assert.match(capped, /^Bet Protect · /);
  assert.doesNotMatch(capped, /→/);
}

{
  const submitted = 434783;
  assert.equal(originalSubmittedMicro({ protect_count: 0, outcome_micro: 600000 }), 600000);
  assert.equal(originalSubmittedMicro({ protect_count: 2, outcome_micro: 400000, submitted_outcome_micro: submitted }), submitted);
  assert.equal(originalSubmittedMicro({ protect_count: 2, outcome_micro: 400000 }), null);
  const packers = protectFillForPosition({
    slug: "aec-nfl-atl-gb-2026-09-24",
    side: "short",
    team: "Packers",
    net: -10,
    cost: 4,
  }, [
    {
      market_slug: "aec-nfl-atl-gb-2026-09-24",
      outcome: "short",
      action: "buy",
      protect_count: 1,
      outcome_micro: 420000,
      submitted_outcome_micro: 450000,
      updated_at: "2026-09-24T00:00:00Z",
    },
    {
      market_slug: "aec-nfl-atl-gb-2026-09-24",
      outcome: "short",
      action: "buy",
      protect_count: 2,
      outcome_micro: 400000,
      submitted_outcome_micro: submitted,
      updated_at: "2026-09-24T00:01:00Z",
    },
  ]);
  assert.equal(packers, "Packers +150 (submitted +130 · improved by Bet Protect)");
  assert.doesNotMatch(packers, /¢/);
  assert.equal(protectFillForPosition({
    slug: "aec-nfl-atl-gb-2026-09-24",
    side: "short",
    team: "Packers",
    net: -10,
    cost: 4,
  }, [{
    market_slug: "aec-nfl-atl-gb-2026-09-24",
    outcome: "short",
    action: "buy",
    protect_count: 0,
    outcome_micro: submitted,
    submitted_outcome_micro: submitted,
  }]), null);
  assert.equal(protectFillForPosition({
    slug: "aec-nfl-atl-gb-2026-09-24",
    side: "short",
    team: "Packers",
    net: -10,
    cost: 4,
  }, [{
    market_slug: "aec-nfl-atl-gb-2026-09-24",
    outcome: "short",
    action: "sell",
    protect_count: 1,
    outcome_micro: 400000,
    submitted_outcome_micro: submitted,
  }]), null);
  const fromLimit = protectFillForPosition({
    slug: "m",
    side: "long",
    team: "Falcons",
    net: 10,
  }, [{
    market_slug: "m",
    outcome: "long",
    action: "buy",
    protect_count: 1,
    outcome_micro: 400000,
    submitted_outcome_micro: submitted,
  }]);
  assert.equal(fromLimit, "Falcons +150 (submitted +130 · improved by Bet Protect)");
}

{
  const ui = fs.readFileSync(path.join(here, "LiveTradingDesk.jsx"), "utf8");
  assert.match(ui, /Bet Protect <span[^>]*>\(adverse pickoff\)<\/span>/);
  assert.match(ui, /Bet Protect armed/);
  assert.doesNotMatch(ui, /Bet Protect on/);
  assert.match(ui, / · Bet Protect/);
  assert.match(ui, /Cancel if mid blows through your rest, then re-rest better\. Does not chase if the market runs away\./);
  assert.match(ui, /useState\(false\)/);
  assert.match(ui, /setProtect\(reset\.protect\)/);
  const submitFn = ui.slice(ui.indexOf("async function submit"), ui.indexOf("async function cancel"));
  assert.ok(submitFn.indexOf("Order was not accepted") < submitFn.indexOf("clearRestForm()"));
  assert.match(ui, /useState\(String\(DEFAULT_PROTECT_X_CENTS\)\)/);
  assert.match(ui, /useState\(String\(DEFAULT_PROTECT_Y_CENTS\)\)/);
  assert.match(ui, /protectXCents/);
  assert.match(ui, /protectFill/);
  assert.doesNotMatch(ui, /canSeeComboLocks/);
  const desk = fs.readFileSync(path.join(here, "../api/live-trading-desk.js"), "utf8");
  assert.match(desk, /canSeeOwnerTools/);
  assert.doesNotMatch(desk, /canSeeUnderdog|UNDERDOG_PREDICT_ALLOWLIST/);
}

console.log("liveDeskProtect.test.js ok");
