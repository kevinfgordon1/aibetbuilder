import assert from "node:assert/strict";
import { lockCheckAvailable, lockCheckView, LOCK_CHECK_SECONDS } from "./comboLockCheck.js";
import { buyerSeesFromNoPrice, quotedYesPrice } from "./buyerOdds.js";

const me = { id: "u1" };
const lock = { id: "L", user_id: "u1", active: true, fill_american: 302, combo_ticker: "KXMVESPORTSMULTIGAMEEXTENDED-S1-X" };
assert.equal(LOCK_CHECK_SECONDS, 10);
assert.deepEqual(lockCheckAvailable(lock, me), { show: true, disabled: false });
assert.equal(lockCheckAvailable(lock, { id: "other" }).show, false, "only on your own locks");
assert.equal(lockCheckAvailable({ ...lock, combo_ticker: "caoc-1" }, me).disabled, true);
assert.match(lockCheckAvailable({ ...lock, combo_ticker: "caoc-1" }, me).reason, /Polymarket/);

const ourYes = quotedYesPrice(302, { makerRate: 0 });
// Competitor cheaper for the buyer → we lose.
{
  const no = Math.round((1 - (ourYes - 0.02)) * 1000) / 1000;
  const v = lockCheckView({ ok: true, bestNoBid: no, competitorCount: 3, makerRate: 0, checkedAt: "2026-10-10T23:45:00Z", marketTicker: lock.combo_ticker }, lock);
  assert.equal(v.win, "lose");
  assert.equal(v.theirs.text, buyerSeesFromNoPrice(no).text);
  assert.ok(v.theirs.american > v.ours.american);
  assert.match(v.text, /You'd lose · 3 other sellers · checked Oct 10, 7:45 PM ET/);
}
// Competitor worse → we win.
{
  const no = Math.round((1 - (ourYes + 0.02)) * 1000) / 1000;
  const v = lockCheckView({ ok: true, bestNoBid: no, competitorCount: 1, makerRate: 0, checkedAt: "2026-10-10T23:45:00Z" }, lock);
  assert.equal(v.win, "win");
  assert.match(v.text, /^You'd win · 1 other seller ·/);
}
// Same price → tie.
assert.equal(lockCheckView({ ok: true, bestNoBid: 1 - ourYes, competitorCount: 1, makerRate: 0 }, lock).win, "tie");
// Nobody quoted.
{
  const v = lockCheckView({ ok: true, bestNoBid: null, competitorCount: 0, makerRate: 0, checkedAt: "2026-10-10T23:45:00Z" }, lock);
  assert.equal(v.kind, "none");
  assert.match(v.text, /No other sellers quoted in 10s/);
}
assert.equal(lockCheckView({ ok: false, error: "boom" }, lock).text, "boom");
assert.equal(lockCheckView(null, lock), null);
console.log("comboLockCheck.test.js ok");
