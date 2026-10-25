import assert from "node:assert/strict";
import { refreshMs } from "./rootForRefresh.js";
assert.equal(refreshMs(Date.parse("2026-10-25T18:20:00Z")), 5 * 60 * 1000); // Kevin, Oct 25: every 5 min
assert.equal(refreshMs(Date.parse("2026-10-18T18:00:00Z")), 2 * 60 * 1000); // Oct 18 one-off fast day
console.log("rootForRefresh tests ok");
