import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockProbeView } from "./comboProbe.js";
import { buyerSeesAfterFees, buyerSeesFromNoPrice } from "./buyerOdds.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const at = "2026-10-10T23:52:05.000Z";
const ours = buyerSeesAfterFees(1188, { ticker: null });
// Competitor worse for the buyer than us → we win.
{
  const v = lockProbeView({ ok: true, bestNoBid: 0.9, usableQuoteCount: 3, checkedAt: at }, { fillAmerican: 1188 });
  assert.equal(v.verdict, "win");
  assert.equal(v.ours, ours.american);
  assert.equal(v.theirs, buyerSeesFromNoPrice(0.9).american);
  assert.match(v.oursText, /^Buyer sees \+\d+ after fees$/);
  assert.match(v.theirsText, /^Buyer sees \+\d+ after fees$/);
  assert.equal(v.checkedText, "Checked 7:52:05 PM ET");
}
// Competitor better for the buyer → we lose.
{
  const v = lockProbeView({ ok: true, bestNoBid: 0.95, usableQuoteCount: 2, checkedAt: at }, { fillAmerican: 1188 });
  assert.equal(v.verdict, "lose");
  assert.ok(v.theirs > v.ours);
  assert.match(v.text, /Raise your odds/);
}
// Nobody else quoted.
assert.equal(lockProbeView({ ok: true, bestNoBid: null, usableQuoteCount: 0, checkedAt: at }, { fillAmerican: 1188 }).verdict, "alone");
// Errors / Poly.
assert.equal(lockProbeView({ ok: false, error: "x", notAvailable: true }).kind, "na");
assert.equal(lockProbeView({ ok: false, error: "Connect Kalshi to check price", needKalshiKey: true }).kind, "need-key");
assert.equal(lockProbeView(null), null);

// Card wiring: button on pending locks, posts parlay_id to /api/combo-probe.
{
  const src = fs.readFileSync(path.join(__dirname, "ComboLockOrders.jsx"), "utf8");
  assert.match(src, /data-testid="lock-check-market"/);
  assert.match(src, /JSON\.stringify\(\{ parlay_id: parlayId \}\)/);
  assert.match(src, /<LockMarketCheck parlay=\{parlay\}/);
  const main = fs.readFileSync(path.join(__dirname, "ComboLocks.jsx"), "utf8");
  assert.match(main, /probeAllowed=\{canSeeOwnerTools\(user\) \|\| kalshiKeyConnected !== false\}/);
}
console.log("comboLockProbe tests passed");
