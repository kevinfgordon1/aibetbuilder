import assert from "node:assert/strict";
import { fetchAllRows } from "./comboPaging.js";
import { archivedRowsNeedRefetch, archivedSubsPlan, nextArchivedSubsCache, ARCHIVED_ROWS_TTL_MS, ARCHIVED_SUBS_FULL_TTL_MS } from "./comboHistoryCache.js";
import { mergeSubmissionRows } from "./comboLockSubmissions.js";
import { formatStatementDate } from "./comboStatement.js";
import { dollars, signedDollars, countText, etDateTime, etDay, etStamp } from "./comboLockView.js";

// ── fetchAllRows: parallel pages with a row hint, same rows as sequential ──
function fakeTable(n, { failPage = -1 } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls = [];
  let inflight = 0; let maxInflight = 0;
  const make = () => ({ range: async (a, z) => {
    calls.push(a); inflight += 1; maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight -= 1;
    if (Math.floor(a / 1000) === failPage) return { data: null, error: new Error("boom") };
    return { data: rows.slice(a, Math.min(z + 1, a + 1000)), error: null };
  } });
  return { make, calls, stats: () => ({ maxInflight }) };
}
for (const n of [0, 5, 999, 1000, 1001, 1268, 2000, 2500]) {
  for (const hint of [0, n, Math.max(0, n - 300), n + 1500]) {
    const t = fakeTable(n);
    const res = await fetchAllRows(t.make, { expectedRows: hint });
    assert.equal(res.error, null);
    assert.equal(res.data.length, n, `n=${n} hint=${hint}`);
    assert.deepEqual(res.data.map((r) => r.id), Array.from({ length: n }, (_, i) => i));
  }
}
{
  const t = fakeTable(1268);
  await fetchAllRows(t.make, { expectedRows: 1268 });
  assert.equal(t.stats().maxInflight, 2, "both pages requested together");
  const s = fakeTable(1268);
  await fetchAllRows(s.make);
  assert.equal(s.stats().maxInflight, 1, "no hint: one page at a time (unchanged)");
  const f = fakeTable(1268, { failPage: 0 });
  const fr = await fetchAllRows(f.make, { expectedRows: 1268 });
  assert.equal(fr.data, null); assert.ok(fr.error);
}

// ── archived lock rows: reuse unless a lock left the living list / came back / TTL ──
{
  const now = 1_000_000;
  const cache = { at: now - 1000, rows: [{ id: "a1" }, { id: "a2" }], livingIds: new Set(["l1", "l2"]) };
  assert.equal(archivedRowsNeedRefetch(null, null, now), true);
  assert.equal(archivedRowsNeedRefetch(cache, null, now), false);
  assert.equal(archivedRowsNeedRefetch(cache, new Set(["l1", "l2", "l3"]), now), false, "a new living lock does not touch History");
  assert.equal(archivedRowsNeedRefetch(cache, new Set(["l1"]), now), true, "l2 moved to History");
  assert.equal(archivedRowsNeedRefetch(cache, new Set(["l1", "l2", "a1"]), now), true, "a1 restored from History");
  assert.equal(archivedRowsNeedRefetch(cache, new Set(["l1", "l2"]), now - 1000 + ARCHIVED_ROWS_TTL_MS), true, "TTL");
}

// ── archived per-lock submissions: newly archived locks only ──
{
  const now = 5_000_000;
  const merge = mergeSubmissionRows;
  let plan = archivedSubsPlan(null, ["a", "b"], now);
  assert.deepEqual(plan, { fetchIds: ["a", "b"], full: true });
  let cache = nextArchivedSubsCache(null, { allIds: ["a", "b"], fetchIds: plan.fetchIds, full: true, fetched: [{ id: 1, parlay_id: "a" }, { id: 2, parlay_id: "b" }], failedIds: new Set(), now, merge });
  assert.deepEqual([...cache.ids].sort(), ["a", "b"]); assert.equal(cache.at, now);
  plan = archivedSubsPlan(cache, ["a", "b"], now + 1000);
  assert.deepEqual(plan.fetchIds, [], "nothing new: no reads");
  plan = archivedSubsPlan(cache, ["c", "a", "b"], now + 2000);
  assert.deepEqual(plan, { fetchIds: ["c"], full: false }, "only the newly archived lock is read");
  cache = nextArchivedSubsCache(cache, { allIds: ["c", "a", "b"], fetchIds: ["c"], full: false, fetched: [{ id: 3, parlay_id: "c" }], failedIds: new Set(), now: now + 2000, merge });
  assert.deepEqual(cache.rows.map((r) => r.id).sort(), [1, 2, 3]);
  assert.equal(cache.at, now, "a partial read keeps the full-read clock");
  // failed partial read: not marked read, retried next poll
  const failed = nextArchivedSubsCache(cache, { allIds: ["d", "c", "a", "b"], fetchIds: ["d"], full: false, fetched: [], failedIds: new Set(["d"]), now: now + 3000, merge });
  assert.equal(failed.ids.has("d"), false);
  assert.deepEqual(archivedSubsPlan(failed, ["d", "c", "a", "b"], now + 4000).fetchIds, ["d"]);
  // full refresh after TTL; a lock that left History drops out
  plan = archivedSubsPlan(cache, ["a", "c"], now + ARCHIVED_SUBS_FULL_TTL_MS);
  assert.equal(plan.full, true);
  const full = nextArchivedSubsCache(cache, { allIds: ["a", "c"], fetchIds: ["a", "c"], full: true, fetched: [{ id: 1, parlay_id: "a" }], failedIds: new Set(), now: now + ARCHIVED_SUBS_FULL_TTL_MS, merge });
  assert.deepEqual(full.rows.map((r) => r.id), [1]);
  assert.equal(full.ids.has("b"), false);
}

// ── cached Intl formatters: identical strings ──
{
  const iso = "2026-10-18T17:05:00Z";
  assert.equal(formatStatementDate(iso), new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }));
  assert.equal(etDateTime(iso), "Sun, Oct 18 · 1:05 PM ET");
  assert.equal(etDateTime(iso, { weekday: false }), "Oct 18 · 1:05 PM ET");
  assert.equal(etDay(iso), "Oct 18");
  assert.equal(etStamp(iso), "Oct 18, 1:05 PM ET");
  assert.equal(dollars(1025), "$1,025"); assert.equal(dollars(-23.214), "-$23.21"); assert.equal(dollars(30930.21), "$30,930.21");
  assert.equal(signedDollars(-4333.18), "-$4,333.18"); assert.equal(signedDollars(5), "+$5.00");
  assert.equal(countText(12345.4), "12,345");
}
console.log("combo History speed tests passed");
