import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCK_QUOTE_LIMIT,
  LOCK_SKIP_LIMIT,
  LOCK_QUOTE_OR,
  LOCK_SKIP_OR,
  LOCK_SUBMISSION_COLUMNS,
  LIVING_SUBS_POLL_MS,
  IDLE_SUBS_POLL_MS,
  isNoisySkipReason,
  isLockQuoteRow,
  mergeSubmissionRows,
  livingLockSubmissionQueries,
  archivedLockSubmissionQueries,
  lockSubmissionQueriesForParlays,
  livingLocksDue,
  lockQuotesLive,
  settleInBatches,
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
  assert.equal(client.calls[0].select, LOCK_SUBMISSION_COLUMNS);
  assert.equal(client.calls[1].select, LOCK_SUBMISSION_COLUMNS);
  assert.doesNotMatch(LOCK_SUBMISSION_COLUMNS, /\*/);
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

{
  const m = await import("./comboLockSubmissions.js");
  const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, parlay_id: "big", status: "unfilled", quote_id: "q" + i }))
    .concat([{ id: "s", parlay_id: "small", status: "unfilled", quote_id: "x" }]);
  assert.deepEqual(m.cappedLockIds(rows), ["big"]);
  assert.equal(m.notFilledTotal({ shown: 420, loadedUnfilledQuotes: 400, countedUnfilledQuotes: 668 }), 688);
  assert.equal(m.notFilledTotal({ shown: 10, loadedUnfilledQuotes: 10, countedUnfilledQuotes: 10 }), 10);
  assert.equal(m.notFilledTotal({ shown: 10, loadedUnfilledQuotes: 10, countedUnfilledQuotes: null }), 10);
  const view = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocksView.jsx"), "utf8");
  assert.match(view, /showing newest/);
  const locks = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  assert.doesNotMatch(locks, /count:\s*"exact"/);
  assert.doesNotMatch(locks, /lockUnfilledCountQuery/);
}

console.log("comboLockSubmissions.test.js ok");

// Every lock is parlay_id equality (user_id + parlay_id), never parlay_id = ANY(chunk).
// The ANY plan sorted every match in the chunk before LIMIT (~2s, ~10MB heap per call).
{
  const calls = [];
  const mk = () => { const b = new Proxy({}, { get: (_t, k) => (...a) => { calls.push([k, ...a]); return b; } }); return b; };
  const client = { from: () => mk() };
  calls.length = 0;
  archivedLockSubmissionQueries(client, { userId: "u", parlayIds: ["a", "b"] });
  assert.equal(calls.filter(([k, c]) => k === "eq" && c === "parlay_id").length, 4);
  assert.equal(calls.filter(([k, c]) => k === "eq" && c === "user_id").length, 4);
  assert.equal(calls.some(([k]) => k === "in"), false);
  assert.ok(calls.filter(([k]) => k === "select").every(([, cols]) => cols === LOCK_SUBMISSION_COLUMNS));
  calls.length = 0;
  livingLockSubmissionQueries(client, { userId: "u", parlayId: "a" });
  assert.equal(calls.filter(([k, c]) => k === "eq" && c === "user_id").length, 2);
  assert.equal(calls.filter(([k, c]) => k === "eq" && c === "parlay_id").length, 2);
}

{
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20261106190000_combo_submissions_history_created_idx.sql"), "utf8");
  assert.match(sql, /create index concurrently if not exists combo_submissions_quote_history_created_idx/i);
  assert.match(sql, /create index concurrently if not exists combo_submissions_skip_history_created_idx/i);
  assert.match(sql, /on public\.combo_submissions \(created_at desc, parlay_id\)/i);
  assert.equal((sql.match(/create index concurrently if not exists/gi) || []).length, 2);
}

{
  const { lockQuoteFillLine } = await import("./comboLockSubmissions.js");
  assert.equal(lockQuoteFillLine([], { fills: 0 }), "");
  assert.equal(lockQuoteFillLine([{ status: "declined", skip_reason: "x" }]), "");
  const rows = [
    { id: 1, status: "filled", quote_id: "a" },
    { id: 2, status: "unfilled", quote_id: "b" },
    { id: 3, status: "unfilled", quote_id: "c" },
    { id: 4, status: "declined", skip_reason: "game_started" },
  ];
  assert.equal(lockQuoteFillLine(rows, { fills: 1 }), "3 quotes · 1 fill");
  assert.equal(lockQuoteFillLine(rows, { fills: 1, countedUnfilledQuotes: 30 }), "31 quotes · 1 fill");
  assert.equal(lockQuoteFillLine(rows, { fills: 1, capped: true }), "3+ quotes · 1 fill");
  assert.equal(lockQuoteFillLine([rows[1]], { fills: 0 }), "1 quote · 0 fills");
  console.log("lockQuoteFillLine ok");
}

{
  const now = Date.parse("2026-11-09T18:00:00Z");
  const quoting = { id: "q", active: true, starts_at: "2026-11-09T20:00:00Z" };
  const started = { id: "s", active: true, starts_at: "2026-11-09T16:00:00Z" };
  const paused = { id: "p", active: false, starts_at: "2026-11-09T20:00:00Z" };
  assert.equal(lockQuotesLive(quoting, { now }), true);
  assert.equal(lockQuotesLive(started, { now }), false, "game already started");
  assert.equal(lockQuotesLive(started, { now, live: true }), true, "a live quote still refreshes");
  assert.equal(lockQuotesLive(paused, { now }), false);
  const lastAt = new Map([["q", now - 30_000], ["s", now - 60_000], ["p", now - 60_000]]);
  const due = livingLocksDue([quoting, started, paused], { now, lastAt });
  assert.deepEqual(due.map((r) => r.id), [], "quoting lock is inside 60s; idle locks are inside 5min");
  const later = livingLocksDue([quoting, started, paused], { now: now + LIVING_SUBS_POLL_MS, lastAt });
  assert.deepEqual(later.map((r) => r.id), ["q"]);
  const idle = livingLocksDue([started, paused], { now: now + IDLE_SUBS_POLL_MS, lastAt });
  assert.deepEqual(idle.map((r) => r.id), ["s", "p"]);
  const forced = livingLocksDue([paused], { now, lastAt, force: true });
  assert.deepEqual(forced.map((r) => r.id), ["p"]);
  const filled = livingLocksDue([started], { now, lastAt, alsoIds: new Set(["s"]) });
  assert.deepEqual(filled.map((r) => r.id), ["s"], "a new confirmed fill refreshes that lock now");
}

{
  let current = 0;
  let max = 0;
  const tasks = Array.from({ length: 7 }, (_, i) => ({
    then(resolve, reject) {
      (async () => {
        current += 1;
        max = Math.max(max, current);
        await new Promise((r) => setTimeout(r, 15));
        current -= 1;
        return i;
      })().then(resolve, reject);
    },
  }));
  const settled = await settleInBatches(tasks, 3);
  assert.equal(max <= 3, true, "submission reads do not all fly at once");
  assert.deepEqual(settled.map((r) => r.value), [0, 1, 2, 3, 4, 5, 6]);
}

{
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../sql/20261109_combo_submissions_venue_quote_created_idx.sql"), "utf8");
  assert.match(sql, /create index concurrently if not exists combo_submissions_venue_quote_created_idx/i);
  assert.match(sql, /on public\.combo_submissions \(venue, created_at desc\)/i);
  assert.match(sql, /where quote_id is not null/i);
  const locks = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  assert.match(locks, /livingLocksDue/);
  assert.match(locks, /settleInBatches/);
  assert.match(locks, /reload\("poll"\)/);
  assert.match(locks, /visibilityState === "hidden"/);
  const tape = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboTape.jsx"), "utf8");
  assert.match(tape, /LOCK_SUBMISSION_COLUMNS/);
  assert.match(tape, /inflightRef/);
  assert.doesNotMatch(tape, /from\("combo_submissions"\)\.select\("\*"\)/);
}
