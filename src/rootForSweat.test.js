import assert from "node:assert/strict";
import { slateKey, firstKickoff, decideBaseline, gaugeFrac } from "./rootForSweat.js";
assert.equal(slateKey(Date.parse("2026-10-16T23:00:00Z")), "2026-10-13"); // Fri → Tue
assert.equal(slateKey(Date.parse("2026-10-20T02:00:00Z")), "2026-10-13"); // Mon night ET still same week
assert.equal(slateKey(Date.parse("2026-10-20T16:00:00Z")), "2026-10-20"); // Tue → new week
assert.equal(firstKickoff([{ event: "KXNFLGAME-A", start: "2026-10-18T17:00Z" }, { event: "KXNFLGAME-B", start: "2026-10-18T13:00Z" }, { event: "KXNCAAFGAME-C", start: "2026-10-17T00:00Z" }, {}]), Date.parse("2026-10-18T13:00Z"), "NFL only");
assert.equal(firstKickoff([{ event: "KXNCAAFGAME-C", start: "2026-10-17T00:00Z" }]), null);
const key = "2026-10-13", kickoff = Date.parse("2026-10-18T17:00Z");
let r = decideBaseline(null, { now: kickoff - 1000, ev: 2600.123, kickoff, key });
assert.equal(r.write.ev, 2600.12); assert.equal(r.sweat.started, false);
r = decideBaseline(r.write, { now: kickoff - 500, ev: 2700, kickoff, key });
assert.equal(r.write.ev, 2700, "keeps refreshing until kickoff");
const frozen = r.write;
r = decideBaseline(frozen, { now: kickoff + 1000, ev: 4000, kickoff: kickoff + 9e6, key });
assert.equal(r.write, null); assert.equal(r.sweat.started, true); assert.equal(r.sweat.baseline, 2700);
r = decideBaseline(null, { now: kickoff + 1, ev: 1, kickoff, key });
assert.equal(r.sweat.baseline, null); assert.equal(r.sweat.started, true);
assert.equal(gaugeFrac(2600, -4000, 2600, 15000), 0.5);
assert.equal(gaugeFrac(-4000, -4000, 2600, 15000), 0);
assert.equal(gaugeFrac(99999, -4000, 2600, 15000), 1);
console.log("rootForSweat tests ok");
