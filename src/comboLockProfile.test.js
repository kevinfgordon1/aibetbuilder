import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentUnhedged,
  currentStanding,
  targetHedge,
  hedgePayoffs,
  lockProfile,
  formatTargetLine,
  formatFillProgress,
  signedMoney,
  moneyAbs,
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
  assert.equal(p.current.hit, 650);
  assert.equal(p.current.miss, -100);
  assert.equal(p.current.risk, 100);
  assert.equal(p.current.profit, 650);
  assert.equal(p.current.text, "risk $100 for $650 profit");
  assert.equal(p.current.standing, undefined);
  assert.equal(formatFillProgress(p), "0 of 750 toward target");
}

{
  const halfway = lockProfile(ariJax, 375);
  assert.equal(halfway.filled, 375);
  assert.equal(halfway.remaining, 375);
  assert.equal(halfway.pct, 50);
  assert.ok(halfway.soFar.hit > 200 && halfway.soFar.hit < 400);
  assert.ok(halfway.soFar.miss < 0);
  // CURRENT standing = fills so far, not the original book-only line
  assert.equal(halfway.current.hit, halfway.soFar.hit);
  assert.equal(halfway.current.miss, halfway.soFar.miss);
  assert.equal(halfway.current.standing, true);
  assert.ok(halfway.current.risk < 100, `remaining risk ${halfway.current.risk}`);
  assert.equal(halfway.current.risk, Math.abs(halfway.soFar.miss));
  assert.equal(halfway.current.profit, halfway.soFar.hit);
  assert.equal(halfway.current.text, `risk ${moneyAbs(halfway.current.risk)} for ${moneyAbs(halfway.soFar.hit)} profit`);
  assert.notEqual(halfway.current.text, "risk $100 for $650 profit");
  assert.equal(halfway.target.hit, targetHedge(ariJax).hit);
  assert.equal(halfway.target.miss, targetHedge(ariJax).miss);
}

assert.equal(targetHedge({ parlay_stake: 100, parlay_american: 650 }), null);
assert.equal(formatTargetLine(null), "target TBD");
assert.equal(lockProfile({ parlay_stake: 100, parlay_american: 650 }, 0).targetTbd, true);
assert.equal(formatFillProgress(lockProfile({ parlay_stake: 100, parlay_american: 650 }, 0)), "target TBD");
assert.equal(currentUnhedged({}), null);
assert.equal(signedMoney(5.63), "+$5.63");
assert.equal(signedMoney(-100), "-$100.00");
assert.equal(moneyAbs(100), "$100");
assert.equal(moneyAbs(650), "$650");
assert.equal(hedgePayoffs({ stake: 100, american: 650, fillAmerican: 610, contracts: 0 }).hit, 650);

{
  // Seattle-style partial fill: CURRENT must leave the book-only $50 line
  const seattle = {
    parlay_stake: 50,
    parlay_american: 2447,
    fill_american: 1993,
    max_contracts: 1274,
  };
  const book = currentUnhedged(seattle);
  assert.equal(book.risk, 50);
  assert.equal(book.profit, 1223.5);
  assert.equal(book.text, "risk $50 for $1223.50 profit");
  const zero = lockProfile(seattle, 0);
  assert.equal(zero.current.text, book.text);
  assert.equal(zero.current.hit, book.hit);
  assert.equal(zero.current.miss, book.miss);
  const partial = lockProfile(seattle, 387.26);
  assert.equal(partial.current.hit, partial.soFar.hit);
  assert.equal(partial.current.miss, partial.soFar.miss);
  assert.equal(partial.current.standing, true);
  assert.ok(partial.current.risk < 50);
  assert.notEqual(partial.current.text, book.text);
  assert.equal(partial.soFar.hit, hedgePayoffs({
    stake: 50, american: 2447, fillAmerican: 1993, contracts: 387.26,
  }).hit);
  const locked = currentStanding(book, { hit: 5.63, miss: 5.63 });
  assert.equal(locked.risk, 0);
  assert.equal(locked.text, "standing +$5.63 / +$5.63");
}

{
  const locksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  assert.match(locksSrc, /moneyAbs\(profile\.current\.risk\)/);
  assert.match(locksSrc, /moneyAbs\(profile\.current\.profit\)/);
  assert.match(locksSrc, /<span className="neg">\{moneyAbs\(profile\.current\.risk\)\}<\/span>/);
  assert.match(locksSrc, /<span className="pos">\{moneyAbs\(profile\.current\.profit\)\}<\/span>/);
  assert.match(locksSrc, /If it hits <span className="pos">\{signedMoney\(profile\.current\.hit\)\}<\/span>/);
  assert.match(locksSrc, /if it loses <span className="neg">\{signedMoney\(profile\.current\.miss\)\}<\/span>/);
  assert.match(locksSrc, /Current \(standing\)/);
  assert.match(locksSrc, /Current \(unhedged\)/);
  assert.match(locksSrc, /profile\.filled > 0 \? "Current \(standing\)" : "Current \(unhedged\)"/);
  assert.match(locksSrc, /\.cl \.pos\{color:#34d399\}\.cl \.neg\{color:#f87171\}\.cl \.muted\{color:#8a8f98\}/);
  assert.doesNotMatch(locksSrc, /className="v num">\{profile\.current\.text\}/);
}

console.log("comboLockProfile.test.js ok");
