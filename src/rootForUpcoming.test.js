// Not-started games are never "live" (Kevin, Nov 1 2026 2:36 PM ET: PHI @ WAS, the 8:20 PM SNF game, showed
// "Washington leading, live −218 · hurting −$6"). A lock that froze at its 1 PM leg's kickoff also froze the SNF
// leg's price then; the per-lock bars (PR #545) gave every priced game a bar, so the SNF line drifting pregame
// looked like an in-play move. Now: upcoming games go to `upcoming` (what's at stake, no impact bar) and their
// pregame drift is reported separately so live + finished + upcoming drift still equal Now − Pregame.
import assert from "node:assert/strict";
import { liveLegMoves, lockedPregameEv, expectedProfit, isUpcoming } from "./rootForSweat.js";
import { rootForRows } from "./rootForGroups.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const ONE = "KXNFLGAME-26NOV01MIANE"; const SNF = "KXNFLGAME-26NOV01PHIWAS"; const LATE = "KXNFLGAME-26NOV01NYJLV";
const starts = { [ONE]: "2026-11-01T18:00:00Z", [LATE]: "2026-11-01T21:25:00Z", [SNF]: "2026-11-02T01:20:00Z" };
const nowMs = Date.parse("2026-11-01T19:36:00Z"); // 2:36 PM ET
const L1 = { id: "L1", legs: [{ event: ONE, allowed: ["MIA"] }, { event: SNF, allowed: ["PHI"] }], hit: 900, miss: -100 };
const L2 = { id: "L2", legs: [{ event: LATE, allowed: ["NYJ"] }], hit: 300, miss: -100 };
const positions = [L1, L2];
const lockPre = { L1: { pos: L1, probs: { [ONE]: { MIA: 0.4, NE: 0.6 }, [SNF]: { PHI: 0.7, WAS: 0.3 } }, adds: 0 } }; // L2: no leg started yet
const probs = { [ONE]: { MIA: 0.55, NE: 0.45 }, [SNF]: { PHI: 0.685, WAS: 0.315 }, [LATE]: { NYJ: 0.45, LV: 0.55 } }; // SNF drifted pregame
const pre = lockedPregameEv(positions, probs, lockPre);
const now = expectedProfit(positions, probs);

assert.equal(isUpcoming(SNF, starts, new Set(), nowMs), true);
assert.equal(isUpcoming(ONE, starts, new Set(), nowMs), false);
assert.equal(isUpcoming("NOSTART", starts, new Set(), nowMs), false, "unknown kickoff keeps the old behaviour");

const r = liveLegMoves(positions, probs, {}, starts, new Set(), { lockPre, now, pregame: pre, nowMs });
assert.deepEqual(r.legs.map((l) => l.event), [ONE], "only the started game is live");
assert.deepEqual(r.upcoming.map((l) => l.event), [LATE, SNF], "upcoming in kickoff order (4:25 PM, then 8:20 PM)");
const snf = r.upcoming.find((l) => l.event === SNF);
assert.ok(snf.move < 0, "SNF pregame drift is reported on the upcoming row, not as a live bar");
assert.equal(snf.root, "PHI"); assert.ok(Number.isFinite(snf.rootIf) && Number.isFinite(snf.notIf), "upcoming rows keep what's at stake");
near(r.legs.reduce((a, l) => a + l.move, 0) + r.settled + r.upcomingMove, now - pre, "live + finished + upcoming drift = Now − Pregame");
near(r.upcoming.find((l) => l.event === LATE).move, 0, "a lock not frozen yet has no drift");

// once SNF kicks off it becomes live
const later = liveLegMoves(positions, probs, {}, starts, new Set(), { lockPre, now, pregame: pre, nowMs: Date.parse("2026-11-02T01:30:00Z") });
assert.deepEqual(later.legs.map((l) => l.event).sort(), [LATE, ONE, SNF].sort()); assert.equal(later.upcoming.length, 0);

// game-level (no lockPre) path: an upcoming game is never live even with a frozen price
const g = liveLegMoves(positions, probs, { [ONE]: { MIA: 0.4, NE: 0.6 }, [SNF]: { PHI: 0.7, WAS: 0.3 } }, starts, new Set(), { nowMs });
assert.deepEqual(g.legs.map((l) => l.event), [ONE]); assert.deepEqual(g.upcoming.map((l) => l.event), [LATE, SNF]);

// layout (Kevin, Nov 1 2:48 PM): one row per leg, no per-game grouping; Finished sits under the needle in kickoff order
const st = { ...starts, "KXNFLGAME-26NOV01JACLV": "2026-11-01T18:00:00Z", "KXNFLSPREAD-26NOV01JACLV": "2026-11-01T18:00:00Z", "KXNFLGAME-26NOV01BALBUF": "2026-11-01T17:00:00Z", "KXNFLTOTAL-26NOV01BALBUF": "2026-11-01T17:00:00Z" };
const R = rootForRows({
  legs: [{ event: "KXNFLGAME-26NOV01JACLV", move: 5, stakes: 100 }, { event: "KXNFLSPREAD-26NOV01JACLV", move: -3, stakes: 400 }, { event: "KXNFLGAME-26NOV01MIANE", move: 20, stakes: 300 }],
  upcoming: [{ event: SNF, move: -6, stakes: 900 }, { event: LATE, move: 0, stakes: 10 }],
  done: [{ event: "__residual", move: 2, residual: true }, { event: ONE, move: -40 }, { event: "KXNFLTOTAL-26NOV01BALBUF", move: 7 }, { event: "KXNFLGAME-26NOV01BALBUF", move: 90 }],
}, st);
assert.deepEqual(R.live.map((x) => x.event), ["KXNFLSPREAD-26NOV01JACLV", "KXNFLGAME-26NOV01MIANE", "KXNFLGAME-26NOV01JACLV"], "every leg its own row, biggest swing first");
assert.deepEqual(R.upcoming.map((x) => x.event), [LATE, SNF], "upcoming by kickoff");
assert.deepEqual(R.finished.map((x) => x.event), ["KXNFLGAME-26NOV01BALBUF", "KXNFLTOTAL-26NOV01BALBUF", ONE, "__residual"], "finished per leg by kickoff, residual last");
near(R.finished.reduce((a, l) => a + l.move, 0), 59, "finished rows keep every bar (sum = Finished total)");
console.log("rootForUpcoming ok");
