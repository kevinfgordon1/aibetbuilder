import assert from "node:assert/strict";
import {
  isLockPaused, pauseUpdate, isMissingPausedColumn, bucketReadoutRows, bucketAgeLabel, pauseToggleTitle,
} from "./comboLockPause.js";

assert.equal(isLockPaused({ paused: true }), true);
assert.equal(isLockPaused({ paused: false }), false);
assert.equal(isLockPaused({}), false);          // column missing => enabled
assert.equal(isLockPaused({ paused: "true" }), false);
assert.equal(isLockPaused(null), false);

const now = new Date("2026-10-02T22:00:00Z");
assert.deepEqual(pauseUpdate(true, now), { paused: true, paused_at: "2026-10-02T22:00:00.000Z" });
assert.deepEqual(pauseUpdate(false, now), { paused: false, paused_at: null });

assert.equal(isMissingPausedColumn({ message: "Could not find the 'paused' column of 'combo_parlays' in the schema cache" }), true);
assert.equal(isMissingPausedColumn({ message: 'column "paused" of relation "combo_parlays" does not exist' }), true);
assert.equal(isMissingPausedColumn({ message: "permission denied for table combo_parlays" }), false);
assert.equal(isMissingPausedColumn(null), false);
assert.match(pauseToggleTitle(true), /Paused/);
assert.match(pauseToggleTitle(false), /kill switch is separate/);

assert.deepEqual(bucketReadoutRows(null), []);
const rows = bucketReadoutRows({ main_cash: 4862, combo_cash: 9271, combo_positions: 12731, target: 12000, ceiling: 22000, gameday: true });
assert.deepEqual(rows.map((r) => [r.label, r.value]), [
  ["Main", "$4,862"], ["Combo", "$9,271"], ["Combo positions", "$12,731"], ["Target", "$12,000"], ["Ceiling", "$22,000"],
]);
assert.equal(rows.find((r) => r.key === "ceiling").sub, "cash only");
assert.equal(bucketReadoutRows({ main_cash: null }).find((r) => r.key === "main").value, "—");
assert.equal(bucketAgeLabel({ at: "2026-10-02T21:59:30Z" }, Date.parse("2026-10-02T22:00:00Z")), "30s ago");
assert.equal(bucketAgeLabel({ at: "2026-10-02T21:00:00Z" }, Date.parse("2026-10-02T22:00:00Z")), "60m ago");
assert.equal(bucketAgeLabel(null), "");
console.log("comboLockPause.test.js ok");
