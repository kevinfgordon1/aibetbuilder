import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { americanFromMicro, formatAmerican } from "./liveDeskPrice.js";
import {
  DEFAULT_PROTECT_X_CENTS,
  DEFAULT_PROTECT_Y_CENTS,
  MAX_PROTECTS_PER_LINEAGE,
  PROTECT_CENTS_STEP,
  PROTECT_MAX_CENTS,
  PROTECT_X_MIN_CENTS,
  PROTECT_Y_MIN_CENTS,
  centsToMicro,
  evaluateProtect,
  improveFromMid,
  protectContracts,
  yesMidFromBbo,
  outcomeBookFromBbo,
  evaluateBookProtect,
  evaluateTradeProtect,
  filledBeforeTriggerLabel,
  normalizeBookLevels,
  outsideTouch,
  ownLeaves,
  outcomeMidMicro,
  formatProtectTelegram,
  readProtectRequest,
  parseProtectCents,
  browserNumberInputValidity,
  protectCentsInputBounds,
  originalSubmittedMicro,
  protectFillForPosition,
} from "./liveDeskProtect.js";

const here = path.dirname(fileURLToPath(import.meta.url));

assert.equal(DEFAULT_PROTECT_X_CENTS, 2);
assert.equal(DEFAULT_PROTECT_Y_CENTS, 0.5);
assert.equal(MAX_PROTECTS_PER_LINEAGE, 8);
assert.equal(centsToMicro(3), 30_000);
assert.equal(centsToMicro(1), 10_000);
assert.equal(centsToMicro(0.5), 5_000);

assert.equal(readProtectRequest({}).on, true, "Bet Protect is on when the flag is omitted");
assert.equal(readProtectRequest({}).xCents, 2);
assert.equal(readProtectRequest({}).yCents, 0.5);
assert.equal(readProtectRequest({}).defaulted, true);
assert.equal(readProtectRequest({ protect: true }).defaulted, false);
assert.equal(readProtectRequest({ protect: null }).on, true);
assert.equal(readProtectRequest({ protect: false }).on, false);
assert.equal(readProtectRequest({ protect: 0 }).on, false);
assert.equal(readProtectRequest({ protect: "false" }).on, false);
assert.equal(readProtectRequest({ protect: "off" }).on, false);
assert.equal(readProtectRequest({}, { riskDollars: 1000 }).on, true, "exactly at the cap is protected");
assert.equal(readProtectRequest({}, { riskDollars: 500 }).on, true, "a $500 order stays protected");
{
  const over = readProtectRequest({}, { riskDollars: 1000.5 });
  assert.equal(over.ok, true);
  assert.equal(over.on, false);
  assert.equal(over.overCap, true);
  assert.match(over.note, /\$1000 Bet Protect cap/);
  const overExplicit = readProtectRequest({ protect: true }, { riskDollars: 1500 });
  assert.equal(overExplicit.ok, true, "over the cap is sent unprotected, not blocked");
  assert.equal(overExplicit.on, false);
  assert.equal(overExplicit.overCap, true);
  assert.equal(readProtectRequest({ protect: false }, { riskDollars: 1500 }).overCap, undefined);
}
assert.equal(readProtectRequest({ protect: true }).xCents, 2);
assert.equal(readProtectRequest({ protect: true }).yCents, 0.5);
assert.equal(readProtectRequest({ protect: true, protectXCents: 0 }).ok, false);
assert.equal(parseProtectCents(4.24, 3, { min: 0.1 }).cents, 4.2);
assert.equal(parseProtectCents(1.65, 2, { min: PROTECT_X_MIN_CENTS, max: PROTECT_MAX_CENTS }).cents, 1.7);
assert.equal(parseProtectCents("abc", DEFAULT_PROTECT_X_CENTS, { min: PROTECT_X_MIN_CENTS }).ok, false);
assert.equal(parseProtectCents(25.1, DEFAULT_PROTECT_X_CENTS, protectCentsInputBounds("x")).ok, false);
assert.equal(parseProtectCents(-0.5, DEFAULT_PROTECT_Y_CENTS, { min: PROTECT_Y_MIN_CENTS, max: PROTECT_MAX_CENTS }).ok, false);
assert.equal(parseProtectCents(0, DEFAULT_PROTECT_Y_CENTS, { min: PROTECT_Y_MIN_CENTS }).cents, 0);
assert.equal(parseProtectCents("", DEFAULT_PROTECT_X_CENTS, { min: PROTECT_X_MIN_CENTS }).cents, DEFAULT_PROTECT_X_CENTS);

// Native number-input validity. The step base is min. The old through-mid
// control (min 0.1, step 0.5) rejects the default 2.0; Chrome reports the
// two nearest legal values as 1.6 and 2.1 and blocks the confirm submit.
{
  const broken = browserNumberInputValidity("2.0", { min: 0.1, max: 25, step: 0.5 });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, "stepMismatch");
  assert.deepEqual(broken.nearest, [1.6, 2.1]);
  assert.equal(broken.validationMessage, "Please enter a valid value. The two nearest valid values are 1.6 and 2.1.");
  assert.equal(browserNumberInputValidity("2", { min: 0.1, max: 25, step: 0.5 }).validationMessage, broken.validationMessage);
  assert.equal(
    browserNumberInputValidity("0.5", { min: 0.1, max: 25, step: 0.5 }).validationMessage,
    "Please enter a valid value. The two nearest valid values are 0.1 and 0.6.",
  );
  assert.equal(
    browserNumberInputValidity("25", { min: 0.1, max: 25, step: 0.5 }).validationMessage,
    "Please enter a valid value. The nearest valid value is 24.6.",
  );
  assert.equal(
    browserNumberInputValidity("0.1", { min: 0, max: 25, step: 0.5 }).validationMessage,
    "Please enter a valid value. The two nearest valid values are 0 and 0.5.",
  );
  assert.equal(
    browserNumberInputValidity("4.2", { min: 0, max: 25, step: 0.5 }).validationMessage,
    "Please enter a valid value. The two nearest valid values are 4 and 4.5.",
  );
}

{
  const xBounds = protectCentsInputBounds("x");
  const yBounds = protectCentsInputBounds("y");
  assert.equal(xBounds.min, PROTECT_X_MIN_CENTS);
  assert.equal(yBounds.min, PROTECT_Y_MIN_CENTS);
  assert.equal(xBounds.max, PROTECT_MAX_CENTS);
  assert.equal(yBounds.max, PROTECT_MAX_CENTS);
  assert.equal(xBounds.step, PROTECT_CENTS_STEP);
  assert.equal(PROTECT_CENTS_STEP, 0.1);
  assert.equal(PROTECT_X_MIN_CENTS, 0.1);
  assert.equal(PROTECT_Y_MIN_CENTS, 0);
  assert.equal(PROTECT_MAX_CENTS, 25);

  for (const raw of ["2", "2.0", "2.00", String(DEFAULT_PROTECT_X_CENTS)]) {
    const hit = browserNumberInputValidity(raw, xBounds);
    assert.equal(hit.ok, true, "through-mid default " + raw);
    assert.equal(hit.validationMessage, "");
  }
  for (const raw of ["0.5", "0.50", String(DEFAULT_PROTECT_Y_CENTS)]) {
    const hit = browserNumberInputValidity(raw, yBounds);
    assert.equal(hit.ok, true, "re-rest default " + raw);
    assert.equal(hit.validationMessage, "");
  }

  const tenths = ["0.1", "0.5", "1", "1.5", "1.6", "2", "2.1", "4.2", "25", "25.0"];
  for (const raw of tenths) {
    assert.equal(browserNumberInputValidity(raw, xBounds).ok, true, "through-mid " + raw);
    assert.equal(browserNumberInputValidity(raw, yBounds).ok, true, "re-rest " + raw);
    const parsedX = parseProtectCents(raw, null, { min: xBounds.min, max: xBounds.max });
    const parsedY = parseProtectCents(raw, null, { min: yBounds.min, max: yBounds.max });
    assert.equal(parsedX.ok, true, raw);
    assert.equal(parsedY.ok, true, raw);
  }
  for (let i = 1; i <= 250; i += 1) {
    const raw = (i / 10).toFixed(1);
    assert.equal(browserNumberInputValidity(raw, xBounds).ok, true, "x tenth " + raw);
  }
  for (let i = 0; i <= 250; i += 1) {
    const raw = (i / 10).toFixed(1);
    assert.equal(browserNumberInputValidity(raw, yBounds).ok, true, "y tenth " + raw);
  }
  assert.equal(browserNumberInputValidity("0", yBounds).ok, true);

  const underX = browserNumberInputValidity("0", xBounds);
  assert.equal(underX.ok, false);
  assert.equal(underX.reason, "rangeUnderflow");
  assert.equal(underX.validationMessage, "Value must be greater than or equal to 0.1.");
  assert.equal(parseProtectCents("0", DEFAULT_PROTECT_X_CENTS, { min: xBounds.min, max: xBounds.max }).ok, false);

  const over = browserNumberInputValidity("25.1", xBounds);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "rangeOverflow");
  assert.equal(over.validationMessage, "Value must be less than or equal to 25.");
  assert.equal(browserNumberInputValidity("25.1", yBounds).reason, "rangeOverflow");

  const offX = browserNumberInputValidity("1.65", xBounds);
  assert.equal(offX.ok, false);
  assert.equal(offX.reason, "stepMismatch");
  assert.deepEqual(offX.nearest, [1.6, 1.7]);
  assert.equal(offX.validationMessage, "Please enter a valid value. The two nearest valid values are 1.6 and 1.7.");

  const offY = browserNumberInputValidity("0.25", yBounds);
  assert.equal(offY.ok, false);
  assert.equal(offY.reason, "stepMismatch");
  assert.deepEqual(offY.nearest, [0.2, 0.3]);
  assert.equal(offY.validationMessage, "Please enter a valid value. The two nearest valid values are 0.2 and 0.3.");

  const underY = browserNumberInputValidity("-0.5", yBounds);
  assert.equal(underY.ok, false);
  assert.equal(underY.reason, "rangeUnderflow");
  assert.equal(underY.validationMessage, "Value must be greater than or equal to 0.");

  const letters = browserNumberInputValidity("abc", xBounds);
  assert.equal(letters.ok, false);
  assert.equal(letters.reason, "badInput");
  assert.equal(letters.validationMessage, "Please enter a number.");

  const blank = browserNumberInputValidity("", xBounds);
  assert.equal(blank.ok, true);
  assert.equal(blank.empty, true);
  assert.equal(blank.validationMessage, "");
}

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
  // New defaults: 2¢ through / 0.5¢ re-rest on Polymarket US 0.25¢ ticks.
  const exact2 = evaluateProtect({ action: "buy", restingOutcomeMicro: 600_000, midOutcomeMicro: 580_000, xCents: 2 });
  assert.equal(exact2.fire, false);
  assert.equal(exact2.reason, "inside");
  const hit2 = evaluateProtect({ action: "buy", restingOutcomeMicro: 600_000, midOutcomeMicro: 577_500, xCents: 2 });
  assert.equal(hit2.fire, true);
  assert.equal(hit2.reason, "through");
  assert.equal(hit2.gapMicro, 22_500);

  // mid 41¢, Y=0.5¢ → target 40.5¢, already on a 0.25¢ tick.
  const buyHalf = improveFromMid({
    outcome: "long",
    action: "buy",
    midOutcomeMicro: 410_000,
    yCents: 0.5,
    tick: 0.0025,
    restingOutcomeMicro: 452_500,
    xCents: 2,
  });
  assert.equal(buyHalf.ok, true);
  assert.equal(buyHalf.outcomeMicro, 405_000);
  assert.equal(buyHalf.yesPriceValue, "0.4050");
  assert.ok(buyHalf.outcomeMicro < 452_500);
  assert.equal(buyHalf.outcomeMicro % 2_500, 0);

  // Off-tick mid still floors buys / ceils sells onto 0.25¢ in his favor.
  const buyOff = improveFromMid({
    outcome: "long",
    action: "buy",
    midOutcomeMicro: 411_000,
    yCents: 0.5,
    tick: 0.0025,
    restingOutcomeMicro: 452_500,
    xCents: 2,
  });
  assert.equal(buyOff.ok, true);
  assert.equal(buyOff.outcomeMicro, 405_000);
  assert.ok(buyOff.outcomeMicro <= 406_000);
  assert.ok(buyOff.outcomeMicro < 452_500);

  const sellHalf = improveFromMid({
    outcome: "long",
    action: "sell",
    midOutcomeMicro: 410_000,
    yCents: 0.5,
    tick: 0.0025,
    restingOutcomeMicro: 360_000,
    xCents: 2,
  });
  assert.equal(sellHalf.ok, true);
  assert.equal(sellHalf.outcomeMicro, 415_000);
  assert.ok(sellHalf.outcomeMicro > 360_000);
  assert.equal(sellHalf.outcomeMicro % 2_500, 0);
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
  assert.ok(keep.riskDollars <= 1000);
  // 833 contracts at 60¢ is $499.80. That used to be cut to the $100 cap.
  const fiveHundred = protectContracts({ leaves: 833, outcomeMicro: 600_000, action: "buy", minQty: 1 });
  assert.equal(fiveHundred.ok, true);
  assert.equal(fiveHundred.contracts, 833);
  assert.ok(fiveHundred.riskDollars > 100);
  assert.ok(fiveHundred.riskDollars <= 1000);
  const capped = protectContracts({ leaves: 5000, outcomeMicro: 600_000, action: "buy", minQty: 1 });
  assert.equal(capped.ok, true);
  assert.equal(capped.contracts, 1666);
  assert.ok(capped.riskDollars <= 1000);
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
  assert.match(ui, /after removing every one of our remaining orders at the price/);
  assert.match(ui, /fresh exchange timestamp/);
  assert.match(ui, /missing timestamp do not cancel/);
  assert.match(ui, /Does not chase if the market runs away/);
  assert.match(ui, /useState\(false\)/);
  assert.match(ui, /setProtect\(reset\.protect\)/);
  const submitFn = ui.slice(ui.indexOf("async function submit"), ui.indexOf("async function cancel"));
  assert.ok(submitFn.indexOf("Order was not accepted") < submitFn.indexOf("clearRestForm()"));
  assert.match(ui, /useState\(String\(DEFAULT_PROTECT_X_CENTS\)\)/);
  assert.match(ui, /useState\(String\(DEFAULT_PROTECT_Y_CENTS\)\)/);
  assert.match(ui, /protectXCents/);
  assert.doesNotMatch(ui, /step="0\.5"/);
  assert.doesNotMatch(ui, /noValidate|novalidate/);
  function inputTag(id) {
    const re = new RegExp("<input\\b(?:(?!<input\\b)[\\s\\S])*?id=\"" + id + "\"(?:(?!<input\\b)[\\s\\S])*?/>");
    const m = ui.match(re);
    assert.ok(m, id);
    return m[0];
  }
  const protectX = inputTag("desk-protect-x");
  const protectY = inputTag("desk-protect-y");
  assert.match(protectX, /type="number"/);
  assert.match(protectX, /min=\{PROTECT_X_MIN_CENTS\}/);
  assert.match(protectX, /max=\{PROTECT_MAX_CENTS\}/);
  assert.match(protectX, /step=\{PROTECT_CENTS_STEP\}/);
  assert.match(protectY, /type="number"/);
  assert.match(protectY, /min=\{PROTECT_Y_MIN_CENTS\}/);
  assert.match(protectY, /max=\{PROTECT_MAX_CENTS\}/);
  assert.match(protectY, /step=\{PROTECT_CENTS_STEP\}/);
  const size = inputTag("desk-size");
  assert.match(size, /min="1"/);
  assert.match(size, /max=\{MAX_SIZE_DOLLARS\}/);
  assert.match(size, /step="1"/);
  assert.match(ui, /protectFill/);
  assert.doesNotMatch(ui, /canSeeComboLocks/);
  const desk = fs.readFileSync(path.join(here, "../api/live-trading-desk.js"), "utf8");
  assert.match(desk, /canSeeOwnerTools/);
  assert.doesNotMatch(desk, /canSeeUnderdog|UNDERDOG_PREDICT_ALLOWLIST/);
}

function americanAt(cents) {
  return formatAmerican(americanFromMicro(Math.round(cents * 10000)));
}

// Public best bid cannot be below our own resting buy while that order is
// the touch. Passing that visible bid to the old mid/bid helper does not
// create an early cancel. American: 71.25¢ is −248, 69.25¢ is −225.
{
  assert.equal(americanAt(71.25), "-248");
  assert.equal(americanAt(69.25), "-225");
  const masked = evaluateProtect({
    action: "buy",
    restingOutcomeMicro: 712500,
    midOutcomeMicro: 712500,
    bidMicro: 712500,
    askMicro: 720000,
    xCents: 2,
  });
  assert.equal(masked.fire, false);
  assert.equal(masked.refKind, "mid");
}

const own = [{ yesPrice: 0.7125, leaves: 1403.5 }];
const level = (px, qty) => ({ px: { value: String(px), currency: "USD" }, qty: String(qty) });

// Our size explains the touch and the next bid is 69¢. That is a real
// outside price, 2.25¢ through, so this snapshot can cancel.
{
  const hit = evaluateBookProtect({
    outcome: "long",
    action: "buy",
    yesPrice: 0.7125,
    bids: [level(0.7125, 1403.5), level(0.69, 800)],
    offers: [level(0.72, 500)],
    ownBids: own,
    ownOffers: [],
    xCents: 2,
    feedAgeMs: 100,
  });
  assert.equal(hit.fire, true);
  assert.equal(hit.reason, "through");
  assert.equal(hit.gapMicro, 22500);
}

// Others still bid our price. Do not cancel.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 2000), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: 100,
}).fire, false);

// Both of our orders at the price have to come off before the next level counts.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1500), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: [{ yesPrice: 0.7125, leaves: 1403.5 }, { yesPrice: 0.7125, leaves: 96.5 }],
  ownOffers: [], xCents: 2, feedAgeMs: 100,
}).fire, true);
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1500), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: [{ yesPrice: 0.7125, leaves: 1403.5 }],
  ownOffers: [], xCents: 2, feedAgeMs: 100,
}).reason, "inside");

// Book ends on our size. Next level was not in the snapshot. No cancel.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5)],
  offers: [level(0.72, 100)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: 100,
}).reason, "truncated");

// Level smaller than our leaves is a torn snapshot. No cancel.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1000), level(0.69, 800)],
  offers: [level(0.72, 100)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: 100,
}).reason, "inconsistent");

// Our price is missing. That can be exclusion or lag. Not a signal.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.69, 800)],
  offers: [level(0.70, 100)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: 100,
}).reason, "absent");

// Ask through our bid is a crossed book, not proof of protection.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.60,
  bids: [level(0.60, 41), level(0.565, 1000)],
  offers: [level(0.595, 1000)],
  ownBids: [{ yesPrice: 0.60, leaves: 41 }], ownOffers: [], xCents: 3, feedAgeMs: 100,
}).reason, "crossed");

// Short buy rests on the YES offer. Next YES offer 0.31 is outcome bid 69¢.
{
  const hit = evaluateBookProtect({
    outcome: "short", action: "buy", yesPrice: 0.2875,
    bids: [level(0.28, 100)],
    offers: [level(0.2875, 1403.5), level(0.31, 500)],
    ownBids: [], ownOffers: [{ yesPrice: 0.2875, leaves: 1403.5 }], xCents: 2, feedAgeMs: 100,
  });
  assert.equal(hit.fire, true);
  assert.equal(hit.gapMicro, 22500);
}

assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5), level(0.69, 10)],
  offers: [level(0.72, 10)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: 16000, receivedAgeMs: 0,
}).fire, true);
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5), level(0.69, 10)],
  offers: [level(0.72, 10)],
  ownBids: own, ownOffers: [], xCents: 2, receivedAgeMs: 9000,
}).reason, "stale-receipt");

assert.equal(outsideTouch([level(0.7125, 1403.5), level(0.70, 10)], own, 0.7125).price, 0.70);

// The gateway is not required to send best-first. Duplicate prices merge.
// Non-finite and out-of-range levels are dropped.
{
  const unsorted = evaluateBookProtect({
    outcome: "long", action: "buy", yesPrice: 0.60,
    bids: [
      level(0.40, 10),
      { px: { value: "nope" }, qty: "100" },
      { px: { value: "1.20" }, qty: "100" },
      { px: { value: "0.60" }, qty: "-5" },
      level(0.60, 20),
      level(0.55, 4),
      level(0.60, 21),
      level(0.55, 6),
    ],
    offers: [level(0.80, 10), level(0.70, 10)],
    ownBids: [{ yesPrice: 0.60, leaves: 41 }],
    ownOffers: [],
    xCents: 2,
    feedAgeMs: 100,
  });
  assert.equal(unsorted.fire, true);
  assert.equal(unsorted.gapMicro, 50000);
  const merged = normalizeBookLevels([
    level(0.60, 20),
    { px: { value: "NaN" }, qty: "1" },
    level(0.55, 4),
    level(0.60, 21),
    { px: { value: "0" }, qty: "9" },
    { px: { value: "1" }, qty: "9" },
  ], { better: "higher" });
  assert.deepEqual(merged, [
    { price: 0.6, qty: 41 },
    { price: 0.55, qty: 4 },
  ]);
}

// First element is not the touch. After sorting, 0.60 bid vs 0.55 ask is crossed.
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.50,
  bids: [level(0.40, 10), level(0.60, 10)],
  offers: [level(0.80, 10), level(0.55, 10)],
  ownBids: [{ yesPrice: 0.50, leaves: 1 }],
  ownOffers: [],
  xCents: 2,
  feedAgeMs: 100,
}).reason, "crossed");

assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: own, ownOffers: [], xCents: 2,
}).reason, "age-unknown");
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: null,
}).reason, "age-unknown");
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: 100, receivedAgeMs: 9000,
}).reason, "stale-receipt");
assert.equal(evaluateBookProtect({
  outcome: "long", action: "buy", yesPrice: 0.7125,
  bids: [level(0.7125, 1403.5), level(0.69, 800)],
  offers: [level(0.72, 500)],
  ownBids: own, ownOffers: [], xCents: 2, feedAgeMs: -9000,
}).reason, "stale-feed");

// Public gateway read on 2026-11-08, no credentials:
// GET https://gateway.polymarket.us/v1/markets/tec-mls-winner-2026-11-07-nas/book
// marketData.bids/offers were best-first that time. transactTime had nanoseconds.
// Sorting still runs. The exchange time is parsed, not replaced with receipt time.
{
  const publicBook = {
    marketData: {
      marketSlug: "tec-mls-winner-2026-11-07-nas",
      bids: [
        { px: { value: "0.2600", currency: "USD" }, qty: "17.0000" },
        { px: { value: "0.2130", currency: "USD" }, qty: "40.0000" },
      ],
      offers: [
        { px: { value: "0.2780", currency: "USD" }, qty: "16.0000" },
        { px: { value: "0.2790", currency: "USD" }, qty: "25.0000" },
      ],
      transactTime: "2026-11-08T23:15:20.072958363Z",
    },
  };
  const feedAt = Date.parse(publicBook.marketData.transactTime);
  assert.equal(feedAt, Date.parse("2026-11-08T23:15:20.072Z"));
  const rows = normalizeBookLevels(publicBook.marketData.bids, { better: "higher" });
  assert.equal(rows[0].price, 0.26);
  assert.equal(rows[0].qty, 17);
  const decision = evaluateBookProtect({
    outcome: "long", action: "buy", yesPrice: 0.26,
    bids: publicBook.marketData.bids,
    offers: publicBook.marketData.offers,
    ownBids: [{ yesPrice: 0.26, leaves: 17 }],
    ownOffers: [],
    xCents: 2,
    feedAgeMs: 1000,
  });
  assert.equal(decision.fire, true);
  assert.equal(decision.gapMicro, 47000);
}

assert.equal(evaluateTradeProtect({
  outcome: "long", action: "buy", yesPrice: 0.7775, tradeYes: 0.75,
  tradeAtMs: 1_000, nowMs: 2_000, xCents: 2, ownYesPrices: [0.7775],
}).reason, "trade-through");
assert.equal(evaluateTradeProtect({
  outcome: "long", action: "buy", yesPrice: 0.7775, tradeYes: 0.7775,
  tradeAtMs: 1_000, nowMs: 2_000, xCents: 2, ownYesPrices: [0.7775],
}).reason, "own-fill");
assert.equal(evaluateTradeProtect({
  outcome: "long", action: "buy", yesPrice: 0.7775, tradeYes: 0.75,
  tradeAtMs: 1_000, nowMs: 30_000, xCents: 2,
}).reason, "trade-old");
assert.equal(filledBeforeTriggerLabel({ trigger: "inside", gapCents: 0.75, xCents: 2 }), "Filled before Protect trigger");
assert.equal(filledBeforeTriggerLabel({ trigger: "through", gapCents: 3, xCents: 2 }), "");
assert.match(fs.readFileSync(new URL("./LiveDeskFilledOrders.jsx", import.meta.url), "utf8"), /Filled before Protect trigger/);

assert.equal(ownLeaves({ quantity: 100, leavesQuantity: 40 }), 40);
assert.equal(ownLeaves({ quantity: 100, leavesQuantity: 0 }), 0);
assert.equal(ownLeaves({ quantity: 100 }), 100);

console.log("liveDeskProtect.test.js ok");
