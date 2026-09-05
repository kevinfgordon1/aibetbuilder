import assert from "node:assert/strict";
import {
  currentUnhedged,
  targetHedge,
  hedgePayoffs,
  lockProfile,
  formatTargetLine,
  formatFillProgress,
  signedMoney,
} from "./comboLockProfile.js";

// Ari + Jax — Kevin's example: risk $100 for $650 profit, ~$5 either way at 750 @ +610
const ariJax = {
  parlay_stake: 100,
  parlay_american: 650,
  fill_american: 610,
  fair_american: 600,
  max_contracts: 750,
  hedge_mode: "1x",
};

{
  const cur = currentUnhedged(ariJax);
  assert.equal(cur.risk, 100);
  assert.equal(cur.profit, 650);
  assert.equal(cur.text, "risk $100 for $650 profit");
  assert.equal(cur.hit, 650);
  assert.equal(cur.miss, -100);
}

{
  const t = targetHedge(ariJax);
  assert.equal(t.contracts, 750);
  assert.equal(t.fillAmerican, 610);
  assert.ok(Math.abs(t.hit - 5.63) < 0.02, `hit ${t.hit}`);
  assert.ok(Math.abs(t.miss - 5.63) < 0.02, `miss ${t.miss}`);
  assert.equal(t.locks, true);
  assert.match(formatTargetLine(t), /750 contracts/);
  assert.match(formatTargetLine(t), /locked either way/);
}

{
  const p = lockProfile(ariJax, 0);
  assert.equal(p.targetTbd, false);
  assert.equal(p.filled, 0);
  assert.equal(p.targetContracts, 750);
  assert.equal(p.remaining, 750);
  assert.equal(p.soFar.hit, 650);
  assert.equal(p.soFar.miss, -100);
  assert.equal(formatFillProgress(p), "0 of 750 toward target");
}

{
  const halfway = lockProfile(ariJax, 375);
  assert.equal(halfway.filled, 375);
  assert.equal(halfway.remaining, 375);
  assert.equal(halfway.pct, 50);
  assert.ok(halfway.soFar.hit > 200 && halfway.soFar.hit < 400);
  assert.ok(halfway.soFar.miss < 0);
}

assert.equal(targetHedge({ parlay_stake: 100, parlay_american: 650 }), null);
assert.equal(formatTargetLine(null), "target TBD");
assert.equal(lockProfile({ parlay_stake: 100, parlay_american: 650 }, 0).targetTbd, true);
assert.equal(formatFillProgress(lockProfile({ parlay_stake: 100, parlay_american: 650 }, 0)), "target TBD");
assert.equal(currentUnhedged({}), null);
assert.equal(signedMoney(5.63), "+$5.63");
assert.equal(signedMoney(-100), "-$100.00");
assert.equal(hedgePayoffs({ stake: 100, american: 650, fillAmerican: 610, contracts: 0 }).hit, 650);

console.log("comboLockProfile.test.js ok");
