import assert from "node:assert/strict";
import {
  submittedLegLines,
  submittedFillDisplay,
  buildLockSubmittedToast,
  buildLockSubmitError,
  LOCK_SUBMITTED_TITLE,
  LOCK_SUBMITTED_NOTE,
  LOCK_SUBMITTED_AUTO_MS,
} from "./comboLockSubmitted.js";
import { allInFromExchange } from "./comboCredits.js";

assert.deepEqual(
  submittedLegLines([
    { label: "Green Bay Packers ML" },
    { label: " New York Jets ML " },
    { ticker: "KX", side: "yes" },
    null,
  ]),
  ["Green Bay Packers ML", "New York Jets ML", "KX (YES)"],
);

const feeFree = submittedFillDisplay(1200, { feesEnabled: false });
assert.equal(feeFree.text, "+1200");
assert.equal(feeFree.feesEnabled, false);

const feeOn = submittedFillDisplay(1150, { feesEnabled: true });
assert.equal(feeOn.text, allInFromExchange(1150) > 0 ? `+${allInFromExchange(1150)}` : `${allInFromExchange(1150)}`);
assert.equal(feeOn.exchangeAmerican, 1150);

const toast = buildLockSubmittedToast({
  legs: [{ label: "A ML" }, { label: "B ML" }],
  fill_american: 900,
}, { feesEnabled: false });
assert.equal(toast.kind, "ok");
assert.equal(toast.title, LOCK_SUBMITTED_TITLE);
assert.deepEqual(toast.legs, ["A ML", "B ML"]);
assert.equal(toast.fillText, "+900");
assert.equal(toast.fillLabel, "Your sell price");
assert.equal(toast.note, LOCK_SUBMITTED_NOTE);
assert.equal(toast.autoMs, LOCK_SUBMITTED_AUTO_MS);

const feeToast = buildLockSubmittedToast({ legs: [{ label: "X" }], fill_american: 1150 }, { feesEnabled: true });
assert.equal(feeToast.fillLabel, "Your all-in price");
assert.ok(feeToast.fillText.startsWith("+") || feeToast.fillText.startsWith("-"));

assert.equal(buildLockSubmittedToast(null), null);

const err = buildLockSubmitError("network down");
assert.equal(err.kind, "error");
assert.match(err.message, /Save failed: network down/);
assert.equal(err.autoMs, 0);
assert.equal(buildLockSubmitError("Save failed: nope").message, "Save failed: nope");

console.log("comboLockSubmitted.test.js ok");
