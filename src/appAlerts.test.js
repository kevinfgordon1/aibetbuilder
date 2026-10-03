import assert from "node:assert/strict";
import {
  canSeeAppAlerts,
  normalizeAppAlert,
  unreadAppAlerts,
  alertAgeLabel,
  bellLabel,
  fetchUnreadAppAlerts,
  markAppAlertsRead,
  isSelfHealedAlert,
  bannerAlerts,
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

{
  const mk = (o) => normalizeAppAlert({ id: o.id, title: "T", created_at: "2026-10-03T05:00:00Z", ...o });
  const healed = mk({ id: "h", kind: "poly_ws_stall", severity: "info", resolved_at: "2026-10-03T05:00:01Z" });
  const healedWarnLegacy = mk({ id: "hw", kind: "poly_ws_stall", severity: "warn", resolved_at: "2026-10-03T05:00:01Z" });
  const open = mk({ id: "o", kind: "poly_ws_stall", severity: "info" });
  const esc = mk({ id: "e", kind: "poly_ws_stall_escalated", severity: "warn" });
  const escResolved = mk({ id: "er", kind: "poly_ws_stall_escalated", severity: "warn", resolved_at: "2026-10-03T06:00:00Z" });
  const lowCashResolved = mk({ id: "l", kind: "combo_low_cash", severity: "warn", resolved_at: "2026-10-03T05:00:01Z" });
  assert.equal(healed.resolvedAt, "2026-10-03T05:00:01Z");
  assert.equal(isSelfHealedAlert(healed), true, "resolved stall auto-hides");
  assert.equal(isSelfHealedAlert(healedWarnLegacy), true, "old warn-severity resolved stalls hide too");
  assert.equal(isSelfHealedAlert(open), false, "an unrecovered stall stays");
  assert.equal(isSelfHealedAlert(esc), false, "escalation (repeat/unrecovered) keeps its banner");
  assert.equal(isSelfHealedAlert(lowCashResolved), false, "other kinds are untouched");
  assert.deepEqual(bannerAlerts([healed, healedWarnLegacy, open, esc, escResolved, lowCashResolved]).map((a) => a.id), ["o", "e", "er", "l"]);
  assert.deepEqual(bannerAlerts(null), []);
  const sb = fakeSupabase({ data: [{ id: "h", title: "T", kind: "poly_ws_stall", resolved_at: "2026-10-03T05:00:01Z" }] });
  const got = await fetchUnreadAppAlerts(sb, kevin);
  assert.equal(got.length, 1, "history keeps the resolved row (read_at null)");
  assert.equal(got[0].resolvedAt, "2026-10-03T05:00:01Z");
}

console.log("appAlerts.test.js ok");
