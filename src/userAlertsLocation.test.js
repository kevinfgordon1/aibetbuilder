import assert from "node:assert/strict";
import { globalUserAlerts, lowCashText, LOCATION_EXPIRED_MESSAGE } from "./lowCashAlerts.js";
const row = (o) => ({ id: "a", user_id: "u1", kind: "location_expired", created_at: "2026-10-25T13:00:00Z", ...o });
assert.equal(globalUserAlerts([row()], "u1").length, 1);
assert.equal(globalUserAlerts([row()], "u2").length, 0);
assert.equal(globalUserAlerts([row({ read_at: "x" }), row({ id: "b", resolved_at: "x" }), row({ id: "c", kind: "low_cash" })], "u1").length, 0);
assert.equal(lowCashText({ kind: "location_expired" }).body, LOCATION_EXPIRED_MESSAGE);
assert.deepEqual(lowCashText({ kind: "custom", title: "Hi", body: "B" }), { title: "Hi", body: "B" });
console.log("userAlertsLocation ok");
