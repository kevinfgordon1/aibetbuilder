import assert from "node:assert/strict";
import { anchorWhatIf, slateKey, expectedProfit, pregameBaseline, gaugeFrac, outcomeSig, liveLegMoves, finishedCarry } from "./rootForSweat.js";
assert.equal(slateKey(Date.parse("2026-10-16T23:00:00Z")), "2026-10-13");
assert.equal(slateKey(Date.parse("2026-10-20T02:00:00Z")), "2026-10-13");
assert.equal(slateKey(Date.parse("2026-10-20T16:00:00Z")), "2026-10-20");
// two games; one lock needs A in G1 and X in G2
const positions = [{ legs: [{ event: "G1", allowed: ["A"] }, { event: "G2", allowed: ["X"] }], hit: 100, miss: -10 }];
const pre = { G1: { A: 0.5, B: 0.5 }, G2: { X: 0.5, Y: 0.5 } };
assert.equal(expectedProfit(positions, pre), 0.25 * 100 + 0.75 * -10);
const starts = { G1: "2026-10-18T17:00:00Z", G2: "2026-10-18T20:00:00Z" }; const t1 = Date.parse(starts.G1);
// before any kickoff: everything overwritten, baseline == live
let r = pregameBaseline({ model: { positions, probs: pre }, starts, now: t1 - 1, key: "w", rows: [] });
assert.equal(r.overwrite.length, 2); assert.equal(r.started.length, 0); assert.equal(r.baseline, expectedProfit(positions, pre));
const rows = r.overwrite;
// G1 in progress (A now 0.9) and G2 price drifted pregame (X 0.6): only G1 is frozen
const live = { G1: { A: 0.9, B: 0.1 }, G2: { X: 0.6, Y: 0.4 } };
r = pregameBaseline({ model: { positions, probs: live }, starts, now: t1 + 1, key: "w", rows });
assert.deepEqual(r.started, ["G1"]); assert.equal(r.overwrite.length, 1);
assert.equal(r.baseline, expectedProfit(positions, { G1: pre.G1, G2: live.G2 }));
// a game first seen after kickoff is saved once at its current value
r = pregameBaseline({ model: { positions, probs: live }, starts, now: t1 + 1, key: "w", rows: [] });
assert.equal(r.insertOnce.length, 1); assert.equal(r.baseline, expectedProfit(positions, live));
assert.equal(outcomeSig({ b: 1, a: 2 }), "a|b");
assert.equal(gaugeFrac(2600, -4000, 2600, 15000), 0.5);
assert.equal(gaugeFrac(-4000, -4000, 2600, 15000), 0);
assert.equal(gaugeFrac(99999, -4000, 2600, 15000), 1);
// live leg chart: shares add up exactly to now − pregame; decided games go to `settled`
{
  const ps = [{ legs: [{ event: "A", allowed: ["a"] }, { event: "B", allowed: ["b"] }], hit: 1000, miss: -100 }, { legs: [{ event: "B", allowed: ["b"] }, { event: "C", allowed: ["c"] }], hit: 500, miss: -80 }];
  const live = { A: { a: 0.7, x: 0.3 }, B: { b: 0.3, y: 0.7 }, C: { c: 0.99, z: 0.01 } };
  const fz = { A: { a: 0.5, x: 0.5 }, B: { b: 0.45, y: 0.55 }, C: { c: 0.6, z: 0.4 } };
  const r = liveLegMoves(ps, live, fz, {});
  const want = expectedProfit(ps, live) - expectedProfit(ps, fz);
  assert.ok(Math.abs(r.total - want) < 1e-9);
  assert.ok(Math.abs(r.legs.reduce((a, l) => a + l.move, 0) + r.settled - want) < 1e-9);
  assert.deepEqual(r.legs.map((l) => l.event), ["B", "A", "C"]); // C at 99% in play is NOT final (no authoritative result)
  assert.equal(liveLegMoves(ps, live, {}, {}).legs.length, 0);
}
// All view: finished games kept at last live chances for 12h after they end, then forgotten
{
  const H = 3600 * 1000; const now = Date.parse("2026-10-18T23:00:00Z");
  const L1 = { id: "L1", legs: [{ event: "F", allowed: ["f"] }, { event: "G", allowed: ["g"] }], hit: 1000, miss: -100 }; // F finished, G live
  const L2 = { id: "L2", legs: [{ event: "G", allowed: ["g"] }], hit: 200, miss: -50 }; // still in the live model
  const L3 = { id: "L3", legs: [{ event: "OLD", allowed: ["o"] }], hit: 300, miss: -60 }; // game ended 13h ago
  const probs = { G: { g: 0.6, h: 0.4 } }; const frozen = { G: { g: 0.5, h: 0.5 } };
  const snap = { positions: { L1, L2, L3 }, last: { F: { f: 0.97, x: 0.03 }, OLD: { o: 0.99, p: 0.01 }, G: { g: 0.55, h: 0.45 } },
    lastAt: { F: new Date(now - 2 * H).toISOString(), OLD: new Date(now - 13 * H).toISOString() }, frozen: { F: { f: 0.4, x: 0.6 }, OLD: { o: 0.5, p: 0.5 }, G: frozen.G } };
  // Oct 25 regression: unpriced but not settled on Kalshi -> still live (stale), carried at last live chances
  const r0 = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap, updatedAt: new Date(now).toISOString() }], now });
  assert.deepEqual(r0.finished, []); assert.deepEqual(r0.stale, ["F"]); assert.deepEqual(r0.kept.map((p) => p.id), ["L1"]);
  assert.ok(Math.abs(r0.nowAdd - (0.97 * 0.6 * 1000 + (1 - 0.97 * 0.6) * -100)) < 1e-9);
  assert.equal(liveLegMoves([L2, ...r0.kept], { ...r0.last, ...probs }, { ...r0.frozen, ...frozen }, {}, new Set(r0.finished)).done.length, 0);
  // settled (snap.final from Kalshi finalized/settled/determined) -> finished, counted at its actual result
  snap.final = { F: { f: 1, x: 0 } };
  const r = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap, updatedAt: new Date(now).toISOString() }], now });
  assert.deepEqual(r.finished, ["F"]);
  assert.deepEqual(r.kept.map((p) => p.id), ["L1"]); // L2 is live (not double counted), L3's game is forgotten
  // L1 Now: F at its settled result 1, G at current 0.6; Pregame: F at kickoff 0.4, G at kickoff 0.5
  assert.ok(Math.abs(r.nowAdd - (1 * 0.6 * 1000 + (1 - 0.6) * -100)) < 1e-9);
  assert.ok(Math.abs(r.baseAdd - (0.4 * 0.5 * 1000 + (1 - 0.4 * 0.5) * -100)) < 1e-9);
  assert.equal(r.finishedDay.F, "2026-10-18");
  // 12h later F is forgotten too: L1 leaves both Now and Pregame
  const r2 = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap, updatedAt: new Date(now).toISOString() }], now: now + 11 * H });
  assert.equal(r2.kept.length, 0); assert.equal(r2.nowAdd, 0); assert.equal(r2.baseAdd, 0);
  // older snaps without lastAt: ended = min(row updated_at, kickoff + 4h)
  const old = { ...snap, lastAt: undefined, final: { F: { f: 1, x: 0 }, OLD: { o: 1, p: 0 } } };
  const r3 = finishedCarry({ positions: [L2], probs, frozen, days: [{ day: "2026-10-18", snap: old, updatedAt: new Date(now).toISOString() }], kickoffs: { F: new Date(now - 20 * H).toISOString() }, now });
  assert.ok(!r3.finished.includes("F")); assert.ok(r3.finished.includes("OLD")); // F kicked off 20h ago → ended ~16h ago; OLD falls back to updated_at
  // chart: kept finished game goes to the "Finished games" line and everything still sums to now − pregame
  const pos = [L2, ...r.kept]; const P = { ...r.last, ...probs }; const Fz = { ...r.frozen, ...frozen };
  const m = liveLegMoves(pos, P, Fz, {}, new Set(r.finished));
  assert.deepEqual(m.legs.map((l) => l.event), ["G"]);
  assert.ok(Math.abs(m.total - (expectedProfit(pos, P) - expectedProfit(pos, { ...P, ...Fz }))) < 1e-9);
  assert.ok(Math.abs(m.legs[0].move + m.settled - m.total) < 1e-9 && m.settled !== 0);
}
// Today & beyond: finished games of today's sheet day count at any age; yesterday's don't (even within 12h)
{
  const H = 3600 * 1000; const now = Date.parse("2026-10-18T14:00:00Z");
  const A = { id: "A", legs: [{ event: "T", allowed: ["t"] }], hit: 100, miss: -10 }; // today's game, ended 14h ago
  const B = { id: "B", legs: [{ event: "Y", allowed: ["y"] }], hit: 100, miss: -10 }; // yesterday's game, ended 6h ago
  const days = [
    { day: "2026-10-17", snap: { positions: { B }, last: { Y: { y: 0.98, n: 0.02 } }, frozen: { Y: { y: 0.5, n: 0.5 } }, lastAt: { Y: new Date(now - 6 * H).toISOString() } } },
    { day: "2026-10-18", snap: { positions: { A }, last: { T: { t: 0.98, n: 0.02 } }, frozen: { T: { t: 0.5, n: 0.5 } }, lastAt: { T: new Date(now - 14 * H).toISOString() } } },
  ];
  const all = finishedCarry({ days, now });
  assert.deepEqual(all.kept.map((p) => p.id), ["B"]); // 12h rule
  const tu = finishedCarry({ days, now, keep: (ev, endedMs, day) => day === "2026-10-18" });
  assert.deepEqual(tu.kept.map((p) => p.id), ["A"]);
}
console.log("rootForSweat tests ok");

// finished games: liveLegMoves lists them in `done`
{
  const pos = [{ id: "a", legs: [{ event: "G", allowed: ["H"] }], hit: 100, miss: -10 }];
  const r = liveLegMoves(pos, { G: { H: 1, J: 0 } }, { G: { H: 0.5, J: 0.5 } }, {}, new Set(["G"]));
  assert.equal(r.legs.length, 0); assert.equal(r.done.length, 1); assert.equal(Math.round(r.done[0].move), 55);
}
// live legs: "if final" / "if it flips" = EV with that leg settled (others at current prices) − current EV
{
  const pos = [{ id: "a", legs: [{ event: "G", allowed: ["H"] }, { event: "K", allowed: ["k"] }], hit: 1000, miss: -100 }];
  const P = { G: { H: 0.6, J: 0.4 }, K: { k: 0.5, m: 0.5 } }; const r = liveLegMoves(pos, P, { G: { H: 0.5, J: 0.5 }, K: P.K }, {});
  const g = r.legs.find((l) => l.event === "G"); const now = 0.3 * 1000 + 0.7 * -100; // 230
  assert.equal(g.leader, "H"); assert.ok(Math.abs(g.ifFinal - ((0.5 * 1000 + 0.5 * -100) - now)) < 1e-9); // +220
  assert.equal(g.flip, "J"); assert.ok(Math.abs(g.ifFlip - (-100 - now)) < 1e-9); // −330
  assert.ok(Math.abs(0.6 * g.ifFinal + 0.4 * g.ifFlip) < 1e-9); // probability-weighted what-ifs net to zero
  // totals = expected profit with that leg final and every other leg at live odds; leader's chance exposed
  assert.ok(Math.abs(r.nowEv - now) < 1e-9);
  assert.ok(Math.abs(g.ifFinalTotal - (0.5 * 1000 + 0.5 * -100)) < 1e-9); assert.ok(Math.abs(g.ifFlipTotal - -100) < 1e-9);
  assert.equal(g.leaderP, 0.6); assert.equal(g.flipP, 0.4);
}
// spread game: "if final" for team S keeps its margin buckets' split; flip = the other team (not a bucket)
{
  const pos = [{ id: "s", legs: [{ event: "G", allowed: ["S>=7"] }], hit: 1000, miss: -100 }];
  const P = { G: { "S>=7": 0.3, "S<7": 0.3, O: 0.4 } }; const r = liveLegMoves(pos, P, { G: { "S>=7": 0.2, "S<7": 0.3, O: 0.5 } }, {});
  const g = r.legs[0]; const now = 0.3 * 1000 + 0.7 * -100;
  assert.equal(g.leader, "S"); assert.ok(Math.abs(g.ifFinal - (0.5 * 1000 + 0.5 * -100 - now)) < 1e-9);
  assert.equal(g.flip, "O"); assert.ok(Math.abs(g.ifFlip - (-100 - now)) < 1e-9);
}
// what-if totals = page headline "Now $X expected" + change (headline counts settled locks the leg model doesn't)
{
  const pos = [{ id: "a", legs: [{ event: "G", allowed: ["H"] }], hit: 1000, miss: -100 }];
  const r = liveLegMoves(pos, { G: { H: 0.6, J: 0.4 } }, { G: { H: 0.5, J: 0.5 } }, {});
  const headline = 12345.67; const [g] = anchorWhatIf(r.legs, headline);
  assert.equal(g.ifFinalTotal, headline + g.ifFinal); assert.equal(g.ifFlipTotal, headline + g.ifFlip);
  assert.equal(anchorWhatIf(r.legs, undefined)[0].ifFinalTotal, r.nowEv + r.legs[0].ifFinal); // no headline → leg-model total
}
// root for = the side whose win helps most (not necessarily the leader); if not = it loses; sorted by stakes
{
  const pos = [{ id: "a", legs: [{ event: "G", allowed: ["J"] }], hit: 1000, miss: -100 }, { id: "b", legs: [{ event: "K", allowed: ["k"] }], hit: 100, miss: -10 }];
  const P = { G: { H: 0.6, J: 0.4 }, K: { k: 0.5, m: 0.5 } }; const r = liveLegMoves(pos, P, P, {});
  const now = 0.4 * 1000 + 0.6 * -100 + 0.5 * 100 + 0.5 * -10; const g = r.legs[0];
  assert.equal(g.event, "G"); // bigger swing first
  assert.equal(g.leader, "H"); assert.equal(g.root, "J"); assert.equal(g.rootP, 0.4);
  assert.ok(Math.abs(g.rootIf - (1000 + 45 - now)) < 1e-9); assert.ok(Math.abs(g.notIf - (-100 + 45 - now)) < 1e-9);
  assert.ok(Math.abs(g.stakes - 1100) < 1e-9);
  const [a] = anchorWhatIf(r.legs, 5000); assert.equal(a.rootIfTotal, 5000 + g.rootIf); assert.equal(a.notIfTotal, 5000 + g.notIf);
  // spread: rooting for S >=7 leg → root S (buckets keep split); if not → O
  const sp = [{ id: "s", legs: [{ event: "S1", allowed: ["S>=7"] }], hit: 1000, miss: -100 }];
  const q = liveLegMoves(sp, { S1: { "S>=7": 0.3, "S<7": 0.3, O: 0.4 } }, { S1: { "S>=7": 0.3, "S<7": 0.3, O: 0.4 } }, {}).legs[0];
  assert.equal(q.root, "S"); assert.ok(Math.abs(q.notIf - (-100 - (0.3 * 1000 + 0.7 * -100))) < 1e-9);
}
// adaptPregame: drop "neither" (rescale), sum buckets into a team, refuse a split it can't make, ignore late rows
{
  const { adaptPregame } = await import("./rootForSweat.js");
  const ko = Date.parse("2026-10-18T17:00:00Z");
  const rows = [{ event: "E", sig: "A<7|A>=7|B|__neither", probs: { B: 0.275, "A<7": 0.2075, "A>=7": 0.5075, __neither: 0.01 }, captured_at: "2026-10-18T16:59:54Z" },
    { event: "E", sig: "A<7|A>=7|B", probs: { B: 0.3, "A<7": 0.2, "A>=7": 0.5 }, captured_at: "2026-10-18T17:10:09Z" }];
  const a = adaptPregame(rows, "E", { "A<7": 0, "A>=7": 0, B: 0 }, ko);
  assert.ok(Math.abs(a.probs.B - 0.275 / 0.99) < 1e-9); assert.equal(a.sig, "A<7|A>=7|B");
  const t = adaptPregame(rows, "E", { A: 0, B: 0 }, ko); assert.ok(Math.abs(t.probs.A - 0.715 / 0.99) < 1e-9);
  assert.equal(adaptPregame([{ event: "E", probs: { A: 0.6, B: 0.4 }, captured_at: "2026-10-18T16:59:00Z" }], "E", { "A<7": 0, "A>=7": 0, B: 0 }, ko), null);
  assert.equal(adaptPregame([rows[1]], "E", { "A<7": 0, "A>=7": 0, B: 0, __neither: 0 }, ko), null);
}
console.log("rootForSweat finished/adapt ok");
