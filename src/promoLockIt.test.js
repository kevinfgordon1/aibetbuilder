import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPromoComboPrefill, lockItNote, mapPromoLegsToKalshi } from "./comboPrefill.js";

// Promo single-leg free bet -> Combo Locks single-leg lock prefill.
const leg = { name: "Corey Kiner 1+ TD", market: "TD", game: "Cincinnati Bengals @ Pittsburgh Steelers", commence_time: "2026-10-25T17:00:00Z", sport: "americanfootball_nfl" };
const pf = buildPromoComboPrefill({ stake: 50, american: 450, combinedProb: 0.2, legs: [leg], kind: "freebet", promoType: "freebet", sportsbook: "DraftKings", source: "promo-lock-it", nonce: 1 });
assert.equal(pf.legs.length, 1);
assert.equal(pf.kind, "freebet");
assert.equal(pf.stake, 50);
assert.equal(pf.boost, 450);           // book odds from the Promo row (American)
assert.equal(pf.fair, 400);            // 20% -> +400 fair
assert.equal(pf.fill, 400);
assert.equal(pf.sportsbook, "DraftKings");
assert.equal(pf.source, "promo-lock-it");
assert.equal(pf.starts, "2026-10-25T17:00:00.000Z");
assert.equal(lockItNote(pf), "Lock it from Promo: Corey Kiner 1+ TD — $50 free bet at DraftKings at +450. Check the leg and sell odds, then tap Save. Nothing is saved until you confirm.");
assert.match(lockItNote({ ...pf, boost: -120, stake: 12.5 }), /\$12\.50 free bet at DraftKings at -120/);
// Plain "Send to Combo Locks" prefills carry no banner.
assert.equal(lockItNote(buildPromoComboPrefill({ stake: 50, american: 450, combinedProb: 0.2, legs: [leg, leg], kind: "freebet", promoType: "freebet" })), null);
assert.equal(lockItNote(null), null);

// The NFL anytime-TD leg maps onto the Kalshi KXNFLTD 1+ rung like any other prefill.
const sports = { nfl: [{ key: "26OCT25CINPIT", title: "Cincinnati vs Pittsburgh", date: "2026-10-25", starts_at: "2026-10-25T17:00:00Z", markets: { side: [{ ticker: "KXNFLGAME-26OCT25CINPIT-PIT", side: "yes", label: "Pittsburgh" }, { ticker: "KXNFLGAME-26OCT25CINPIT-CIN", side: "yes", label: "Cincinnati" }], prop: [{ ticker: "KXNFLTD-26OCT25CINPIT-CINCKINER23-1", side: "yes", label: "Corey Kiner: 1+", player: "Corey Kiner", kind: "td", line: 1 }] } }] };
const m = mapPromoLegsToKalshi(pf.legs, sports, Date.parse("2026-10-25T12:00:00Z"));
assert.equal(m.unmatched.length, 0, JSON.stringify(m.unmatched));
assert.equal(m.rows[0].marketVal, "KXNFLTD-26OCT25CINPIT-CINCKINER23-1|yes");

// App wiring: singles get "Lock it", multi-leg keep "Send to Combo Locks".
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
assert.match(app, /canSeeComboLocks\(user\) && isSingle && \(\s*<LockItButton onLock=\{\(\) => sendToComboLocks\(p, "freebet", "promo-lock-it"\)\} \/>/);
assert.match(app, /source,\n    \}\)\);\n    setActiveTab\("combo"\)/);
const cl = readFileSync(new URL("./ComboLocks.jsx", import.meta.url), "utf8");
assert.match(cl, /data-testid="lock-it-note"/);
// Saving still goes through the single-leg heads-up confirm.
assert.match(cl, /buildSingleLegConfirm\(legs, exFill/);
console.log("promo Lock it tests passed");
