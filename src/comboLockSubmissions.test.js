import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCK_QUOTE_LIMIT,
  LOCK_SKIP_LIMIT,
  LOCK_QUOTE_OR,
  LOCK_SKIP_OR,
  isNoisySkipReason,
  isLockQuoteRow,
  mergeSubmissionRows,
  livingLockSubmissionQueries,
  archivedLockSubmissionQueries,
  lockSubmissionQueriesForParlays,
} from "./comboLockSubmissions.js";

assert.equal(isNoisySkipReason("game_started"), true);
assert.equal(isNoisySkipReason("no_lock_overlap:no_shared_game"), true);
assert.equal(isNoisySkipReason("no_lock_overlap"), true);
assert.equal(isNoisySkipReason("oversized"), false);
assert.equal(isNoisySkipReason("limit_reached"), false);
assert.equal(isNoisySkipReason(null), false);

assert.equal(isLockQuoteRow({ quote_id: "q1", status: "unfilled" }), true);
assert.equal(isLockQuoteRow({ order_id: "o1", status: "unfilled" }), true);
assert.equal(isLockQuoteRow({ status: "filled" }), true);
assert.equal(isLockQuoteRow({ status: "declined", skip_reason: "game_started" }), false);

{
  const merged = mergeSubmissionRows(
    [{ id: "a", created_at: "2026-09-16T16:55:00Z" }],
    [{ id: "a", created_at: "2026-09-16T16:55:00Z" }, { id: "b", created_at: "2026-09-16T21:00:00Z" }],
  );
  assert.deepEqual(merged.map((r) => r.id), ["b", "a"]);
}

// Guardians/Yankees/Giants: last 80 newest-first are declines; Poly quotes
// from 12:55–1:10 ET must still appear when quotes are fetched separately.
{
  const polyQuotes = [];
  for (let i = 0; i < 115; i++) {
    polyQuotes.push({
      id: `poly-q-${i}`,
      venue: "polymarket",
      status: "unfilled",
      quote_id: `quote-${i}`,
      created_at: new Date(Date.parse("2026-09-16T16:55:00Z") + i * 6000).toISOString(),
    });
  }
  const laterDeclines = [];
  for (let i = 0; i < 80; i++) {
    laterDeclines.push({
      id: `dec-${i}`,
      venue: i < 15 ? "polymarket" : "kalshi",
      status: "declined",
      quote_id: null,
      skip_reason: "game_started",
      created_at: new Date(Date.parse("2026-09-16T21:00:00Z") + i * 1000).toISOString(),
    });
  }
  const newestFirst = [...laterDeclines, ...polyQuotes]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const capped = newestFirst.slice(0, 80);
  assert.equal(capped.filter(isLockQuoteRow).length, 0, "limit(80) newest-first drops every Poly quote");

  const quotePage = newestFirst.filter(isLockQuoteRow).slice(0, LOCK_QUOTE_LIMIT);
  const skipPage = newestFirst
    .filter((r) => r.status === "declined" && !r.quote_id && !isNoisySkipReason(r.skip_reason))
    .slice(0, LOCK_SKIP_LIMIT);
  const recovered = mergeSubmissionRows(quotePage, skipPage);
  assert.equal(recovered.filter((r) => r.venue === "polymarket" && r.quote_id).length, 115);
  assert.ok(recovered.every((r) => r.skip_reason !== "game_started"));
}

function mockClient() {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const chain = {
        select(v) { call.select = v; return chain; },
        eq(k, v) { call.filters.push(["eq", k, v]); return chain; },
        neq(k, v) { call.filters.push(["neq", k, v]); return chain; },
        in(k, v) { call.filters.push(["in", k, v]); return chain; },
        is(k, v) { call.filters.push(["is", k, v]); return chain; },
        or(v) { call.or = v; return chain; },
        order(k, o) { call.order = [k, o]; return chain; },
        limit(n) { call.limit = n; return chain; },
      };
      return chain;
    },
  };
}

{
  const client = mockClient();
  const reqs = livingLockSubmissionQueries(client, {
    userId: "u1",
    parlayId: "aee3b29d-2a4b-4dd6-8dd5-37358b0aa294",
  });
  assert.equal(reqs.length, 2);
  assert.equal(client.calls[0].or, LOCK_QUOTE_OR);
  assert.equal(client.calls[0].limit, LOCK_QUOTE_LIMIT);
  assert.ok(client.calls[0].filters.some((f) => f[0] === "eq" && f[1] === "parlay_id"));
  assert.equal(client.calls[1].or, LOCK_SKIP_OR);
  assert.equal(client.calls[1].limit, LOCK_SKIP_LIMIT);
  assert.ok(client.calls[1].filters.some((f) => f[0] === "eq" && f[1] === "status" && f[2] === "declined"));
}

{
  const client = mockClient();
  assert.deepEqual(archivedLockSubmissionQueries(client, { userId: "u1", parlayIds: [] }), []);
  const reqs = lockSubmissionQueriesForParlays(client, {
    userId: "u1",
    living: [{ id: "p1" }, { id: "p2" }],
    archivedIds: ["arch1"],
  });
  assert.equal(reqs.length, 6);
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.match(locks, /lockSubmissionQueriesForParlays|livingLockSubmissionQueries/);
  assert.match(locks, /mergeSubmissionRows/);
  assert.doesNotMatch(
    locks,
    /\.neq\("status", "shadow"\)\.order\("created_at", \{ ascending: false \}\)\.limit\(80\)/,
    "per-lock History must not use a single newest-first limit(80)",
  );
}

console.log("comboLockSubmissions.test.js ok");
