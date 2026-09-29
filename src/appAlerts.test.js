import assert from "node:assert/strict";
import {
  canSeeAppAlerts,
  normalizeAppAlert,
  unreadAppAlerts,
  alertAgeLabel,
  bellLabel,
  fetchUnreadAppAlerts,
  markAppAlertsRead,
} from "./appAlerts.js";
import { OWNER_EMAIL, KENNETH_GUIDO_EMAIL } from "./comboAccess.js";

const kevin = { id: "k", email: OWNER_EMAIL };
const kenny = { id: "n", email: KENNETH_GUIDO_EMAIL };
assert.equal(canSeeAppAlerts(kevin), true);
assert.equal(canSeeAppAlerts({ email: OWNER_EMAIL.toUpperCase() }), true);
assert.equal(canSeeAppAlerts(kenny), false, "Kenneth does not see owner alerts");
assert.equal(canSeeAppAlerts(null), false);
assert.equal(canSeeAppAlerts({ id: "x", email: "someone@else.com" }), false);
assert.equal(canSeeAppAlerts({ id: "x", user_metadata: { email: OWNER_EMAIL } }), false, "metadata email is not trusted");

assert.equal(normalizeAppAlert(null), null);
assert.equal(normalizeAppAlert({ id: "1" }), null, "title required");
assert.equal(normalizeAppAlert({ id: "1", title: "T", severity: "weird" }).severity, "info");

const rows = [
  { id: "a", title: "old", created_at: "2026-09-29T10:00:00Z" },
  { id: "b", title: "new", created_at: "2026-09-29T12:00:00Z" },
  { id: "c", title: "read", created_at: "2026-09-29T13:00:00Z", read_at: "2026-09-29T13:01:00Z" },
  { id: "", title: "bad" },
];
assert.deepEqual(unreadAppAlerts(rows).map((a) => a.id), ["b", "a"]);
assert.deepEqual(unreadAppAlerts(null), []);

const now = Date.parse("2026-09-29T12:00:00Z");
assert.equal(alertAgeLabel("2026-09-29T11:59:40Z", now), "just now");
assert.equal(alertAgeLabel("2026-09-29T11:15:00Z", now), "45m ago");
assert.equal(alertAgeLabel("2026-09-29T09:00:00Z", now), "3h ago");
assert.equal(alertAgeLabel("2026-09-27T12:00:00Z", now), "2d ago");
assert.equal(alertAgeLabel("nope", now), "");
assert.equal(bellLabel(0), "");
assert.equal(bellLabel(3), "3");
assert.equal(bellLabel(12), "9+");

function fakeSupabase({ data = [], error = null, throws = false } = {}) {
  const calls = [];
  const q = {
    select() { calls.push("select"); return q; },
    is(c, v) { calls.push(`is:${c}:${v}`); return q; },
    order() { return q; },
    limit() { return Promise.resolve(throws ? (() => { throw new Error("boom"); })() : { data, error }); },
    update(patch) { calls.push(`update:${Object.keys(patch)}`); return { in: (c, ids) => { calls.push(`in:${ids}`); return Promise.resolve({ error }); } }; },
  };
  return { calls, from(t) { assert.equal(t, "app_alerts"); return q; } };
}

{
  const sb = fakeSupabase({ data: rows });
  assert.deepEqual((await fetchUnreadAppAlerts(sb, kevin)).map((a) => a.id), ["b", "a"]);
  assert.ok(sb.calls.includes("is:read_at:null"));
}
{
  const sb = fakeSupabase({ data: rows });
  assert.deepEqual(await fetchUnreadAppAlerts(sb, kenny), [], "non-owner never queries");
  assert.deepEqual(sb.calls, []);
  assert.deepEqual(await fetchUnreadAppAlerts(sb, null), []);
}
assert.deepEqual(await fetchUnreadAppAlerts(fakeSupabase({ error: { message: "rls" } }), kevin), [], "errors give an empty list");
assert.deepEqual(await fetchUnreadAppAlerts(fakeSupabase({ throws: true }), kevin), [], "throws give an empty list");

{
  const sb = fakeSupabase();
  assert.equal(await markAppAlertsRead(sb, kevin, ["a", "b"]), true);
  assert.deepEqual(sb.calls, ["update:read_at", "in:a,b"]);
  const sb2 = fakeSupabase();
  assert.equal(await markAppAlertsRead(sb2, kenny, ["a"]), false);
  assert.equal(await markAppAlertsRead(sb2, kevin, []), false);
  assert.deepEqual(sb2.calls, []);
  assert.equal(await markAppAlertsRead(fakeSupabase({ error: { message: "x" } }), kevin, ["a"]), false);
}

console.log("appAlerts.test.js ok");
