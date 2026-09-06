import assert from "node:assert/strict";
import {
  TARGET_PAYOUT_USD,
  blendAskLadderToPayout,
  formatBlendedPayoutFlag,
  americanToImpliedProb,
} from "./blendAskLadder.js";

assert.equal(TARGET_PAYOUT_USD, 1000);

// ── known ladder → known blended American + flag
// +200 $100 stake → face 300; +100 $400 stake → face 800.
// Walk $1,000 face: all of +200 (300) + 700 of +100 face (stake 350).
// VWAP p = 450/1000 = 0.45 → +122.
{
  const blend = blendAskLadderToPayout([
    { american: 200, size: 100 },
    { american: 100, size: 400 },
  ]);
  assert.ok(blend);
  assert.equal(blend.american, 122);
  assert.equal(blend.complete, true);
  assert.equal(blend.levelsUsed, 2);
  assert.ok(Math.abs(blend.stakeFilled - 450) < 1e-6);
  assert.ok(Math.abs(blend.payoutFilled - 1000) < 1e-6);
  assert.equal(blend.flag, "blended to $1,000 payout");
  assert.equal(formatBlendedPayoutFlag(blend), "blended to $1,000 payout");
}

// Thin top is not the hedge line when deeper size exists.
{
  const thin = blendAskLadderToPayout([
    { american: 104, size: 54 },
    { american: 100, size: 420 },
    { american: -105, size: 1100 },
  ]);
  assert.ok(thin);
  assert.equal(thin.complete, true);
  assert.notEqual(thin.american, 104, "must walk past the $54 top");
  assert.equal(thin.flag, "blended to $1,000 payout");
  const p104 = americanToImpliedProb(104);
  const p100 = 0.5;
  const p105 = americanToImpliedProb(-105);
  const face1 = 54 / p104;
  const face2 = 420 / p100;
  const take3 = 1000 - face1 - face2;
  const stake = 54 + 420 + take3 * p105;
  const expectP = stake / 1000;
  const expectAm = expectP >= 0.5
    ? -Math.round((100 * expectP) / (1 - expectP))
    : Math.round((100 * (1 - expectP)) / expectP);
  assert.equal(thin.american, expectAm);
}

// ── short book: use what's there, partial-fill flag
{
  const short = blendAskLadderToPayout([{ american: 150, size: 50 }]);
  assert.ok(short);
  assert.equal(short.american, 150);
  assert.equal(short.complete, false);
  assert.ok(Math.abs(short.payoutFilled - 125) < 1e-6); // 50 / 0.4
  assert.equal(short.flag, "blended · $125 of $1,000 payout available");
  assert.equal(formatBlendedPayoutFlag(short), "blended · $125 of $1,000 payout available");
}

// ── empty / invalid: no invented blend
assert.equal(blendAskLadderToPayout(null), null);
assert.equal(blendAskLadderToPayout([]), null);
assert.equal(blendAskLadderToPayout([{ american: 100, size: 0 }]), null);
assert.equal(blendAskLadderToPayout([{ american: 100, size: -10 }]), null);
assert.equal(blendAskLadderToPayout([{ american: 0, size: 50 }]), null);
assert.equal(blendAskLadderToPayout([{ foo: 1 }]), null);
assert.equal(formatBlendedPayoutFlag(null), "");
assert.equal(formatBlendedPayoutFlag({}), "");

// Single deep level that covers $1,000 face: blend equals that price.
{
  const one = blendAskLadderToPayout([{ american: -110, size: 600 }]);
  assert.ok(one);
  assert.equal(one.american, -110);
  assert.equal(one.complete, true);
  assert.equal(one.levelsUsed, 1);
  assert.equal(one.flag, "blended to $1,000 payout");
}

// Unsorted ladder is walked best-American-first (do not invent extra levels).
{
  const blend = blendAskLadderToPayout([
    { american: 100, size: 400 },
    { american: 200, size: 100 },
  ]);
  assert.equal(blend.american, 122);
}

console.log("blendAskLadder.test.js ok");
