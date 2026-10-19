import assert from "node:assert/strict";
import { captureKeys, captureFairs, pickStored, storedEventProbs, heldByEvent, KICKOFF_MAX_AGE_MS } from "./rootForStored.js";

const ML = "KXNFLGAME-26OCT19WASSF";
// capture keys: both moneyline sides + the spread leg itself
{
  const keys = captureKeys({ legs: [{ ticker: "KXNFLSPREAD-26OCT19WASSF-SF4", side: "yes" }, { ticker: "KXNFLTD-26OCT19WASSF-SFCMCCAFFREY23-1", side: "no" }] }).map((k) => `${k.ticker}:${k.side}`).sort();
  assert.ok(keys.includes(`${ML}-WAS:yes`) && keys.includes(`${ML}-SF:yes`));
  assert.ok(keys.includes("KXNFLSPREAD-26OCT19WASSF-SF4:yes"));
  assert.ok(keys.includes("KXNFLTD-26OCT19WASSF-SFCMCCAFFREY23-1:no"));
}
// captureFairs uses the live inverse bet method (Kalshi $500 VWAP of the opposite side)
{
  const deep = (p) => [[p, 100000]];
  const kalshiBooks = { [`${ML}-SF`]: { yes: deep(0.71), no: deep(0.30) }, [`${ML}-WAS`]: { yes: deep(0.31), no: deep(0.70) } };
  const f = captureFairs({ legs: [{ ticker: `${ML}-SF`, side: "yes" }] }, { kalshiBooks, relay: {}, now: 1000, kalshiAt: 1000 });
  assert.ok(f[`${ML}-SF:yes`].p > 0.67 && f[`${ML}-SF:yes`].p < 0.70, JSON.stringify(f));
  assert.equal(f[`${ML}-SF:yes`].v, "kalshi");
  assert.ok(f[`${ML}-SF:yes`].a < 0);
}
// pickStored: ≤15 min before t0 → kickoff; older → early; after t0 → ignored
{
  const t0 = Date.parse("2026-10-20T00:15:00Z");
  const fairs = { x: { p: 0.5 } };
  assert.equal(pickStored({ pregame: fairs, pregame_at: new Date(t0 - 3 * 60000).toISOString(), at_lock: fairs, at_lock_at: "2026-10-19T12:00:00Z" }, t0).kind, "kickoff");
  assert.equal(pickStored({ at_lock: fairs, at_lock_at: "2026-10-19T12:00:00Z" }, t0).kind, "early");
  assert.equal(pickStored({ pregame: fairs, pregame_at: new Date(t0 + 60000).toISOString() }, t0), null);
  const mix = pickStored({ pregame: fairs, pregame_at: new Date(t0 + 60000).toISOString(), at_lock: fairs, at_lock_at: new Date(t0 - KICKOFF_MAX_AGE_MS - 1).toISOString() }, t0);
  assert.equal(mix.kind, "early"); assert.equal(mix.from, "at_lock");
}
// storedEventProbs: binary, game (one side / both sides), spread-nested game
{
  const fairs = { "KXNFLTD-X:yes": { p: 0.4 }, "KXNFLTD-Y:no": { p: 0.7 }, [`${ML}-SF:yes`]: { p: 0.68 }, [`${ML}-WAS:yes`]: { p: 0.30 }, "KXNFLSPREAD-26OCT19WASSF-SF4:yes": { p: 0.52 } };
  assert.deepEqual(storedEventProbs("KXNFLTD-X", { yes: 0.5, no: 0.5 }, fairs), { yes: 0.4, no: 0.6 });
  const n = storedEventProbs("KXNFLTD-Y", { yes: 0.5, no: 0.5 }, fairs, new Set(["no"]));
  assert.ok(Math.abs(n.no - 0.7) < 1e-9 && Math.abs(n.yes - 0.3) < 1e-9);
  assert.deepEqual(storedEventProbs(ML, { WAS: 0.3, SF: 0.7 }, fairs, new Set(["SF"])), { SF: 0.68, WAS: 1 - 0.68 });
  const both = storedEventProbs(ML, { WAS: 0.3, SF: 0.68, __neither: 0.02 }, fairs, new Set(["SF", "WAS"]));
  assert.ok(Math.abs(both.SF - 0.68) < 1e-9 && Math.abs(both.WAS - 0.30) < 1e-9 && Math.abs(both.__neither - 0.02) < 1e-9);
  const sp = storedEventProbs(ML, { "SF>=4": 0.5, "SF<4": 0.2, WAS: 0.3 }, fairs);
  assert.ok(Math.abs(sp["SF>=4"] - 0.52) < 1e-9 && Math.abs(sp["SF<4"] - 0.16) < 1e-9 && Math.abs(sp.WAS - 0.32) < 1e-9, JSON.stringify(sp));
  assert.equal(storedEventProbs("KXNFLTD-Z", { yes: 0.5, no: 0.5 }, fairs), null);
  assert.equal(storedEventProbs("KXNFLGAME-26OCT19DALDEN", { DAL: 0.5, DEN: 0.5 }, fairs), null);
}
{
  const h = heldByEvent([{ legs: [{ event: ML, allowed: ["SF"] }, { event: "B", allowed: ["no"] }] }, { legs: [{ event: ML, allowed: ["WAS", "SF<4"] }] }]);
  assert.deepEqual([...h[ML]], ["SF"]); assert.deepEqual([...h.B], ["no"]);
}
console.log("rootForStored tests passed");
