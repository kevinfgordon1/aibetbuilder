// Active-game gate for the multi-user needle cron.
import assert from "node:assert/strict";
import { activeReason, planUsers, legKickoff, tickerWhen, gameId } from "./rootForActive.js";

const T = (iso) => Date.parse(iso);
assert.equal(gameId("KXNFLGAME-26OCT18HOUJAC-HOU"), "26OCT18HOUJAC");
assert.deepEqual(tickerWhen("KXNFLGAME-26OCT18HOUJAC-HOU"), { date: "2026-10-18", at: null });
assert.equal(new Date(tickerWhen("KXMLBGAME-26OCT181905LADNYM-LAD").at).toISOString(), "2026-10-18T23:05:00.000Z"); // 7:05 PM EDT

const single = { user_id: "a", starts_at: "2026-10-18T17:00:00Z", legs: [{ ticker: "KXNFLGAME-26OCT18CHIATL-ATL" }, { ticker: "KXNFLTOTAL-26OCT18CHIATL-45" }] };
// single-game lock: lock start is every leg's kickoff
assert.equal(legKickoff(single.legs[1], single), T("2026-10-18T17:00:00Z"));
assert.equal(activeReason([single], {}, T("2026-10-18T16:30:00Z")), null); // 30 min before: idle
assert.equal(activeReason([single], {}, T("2026-10-18T16:45:00Z")), "kickoff-soon"); // 15 min before: baseline capture
assert.equal(activeReason([single], {}, T("2026-10-18T19:00:00Z")), "in-progress");
assert.equal(activeReason([single], {}, T("2026-10-18T22:30:00Z")), null); // 5.5h after kickoff: settle only

// multi-game lock: Sunday 1 PM + Monday night (saved kickoff for the Monday game)
const multi = { user_id: "b", starts_at: "2026-10-18T17:00:00Z", legs: [{ ticker: "KXNFLGAME-26OCT18CHIATL-ATL" }, { ticker: "KXNFLGAME-26OCT19DETTB-DET" }] };
const ko = { "26OCT18CHIATL": "2026-10-18T17:00:00Z", "26OCT19DETTB": "2026-10-20T00:15:00Z" };
assert.equal(activeReason([multi], ko, T("2026-10-18T18:00:00Z")), "in-progress");
assert.equal(activeReason([multi], ko, T("2026-10-19T15:00:00Z")), null); // Monday 11 AM: nothing in progress
assert.equal(activeReason([multi], ko, T("2026-10-20T00:00:00Z")), "kickoff-soon");
assert.equal(activeReason([multi], ko, T("2026-10-20T02:00:00Z")), "in-progress");
// unknown kickoff for the Monday leg: only on its ET game date (from 9 AM ET)
assert.equal(activeReason([multi], { "26OCT18CHIATL": ko["26OCT18CHIATL"] }, T("2026-10-19T12:00:00Z")), null); // 8 AM ET
assert.equal(activeReason([multi], { "26OCT18CHIATL": ko["26OCT18CHIATL"] }, T("2026-10-19T14:00:00Z")), "game-day");
// a lock that hasn't started never counts as game-day
const later = { user_id: "c", starts_at: "2026-10-25T17:00:00Z", legs: [{ ticker: "KXNFLGAME-26OCT25CINBAL-BAL" }, { ticker: "KXNFLGAME-26OCT26TBCAR-TB" }] };
assert.equal(activeReason([later], {}, T("2026-10-19T14:00:00Z")), null);

const p = planUsers([single, multi, later], ko, T("2026-10-18T18:00:00Z"));
assert.deepEqual(p.live.map((x) => x.uid).sort(), ["a", "b"]);
assert.deepEqual(p.idle.map((x) => x.uid), ["c"]);
assert.equal(planUsers([], {}, 0).live.length, 0);
console.log("rootForActive tests ok");
