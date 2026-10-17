// History: every lock loaded (paged), stable order, real fill prices, sportsbook tie rule.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchAllRows, chunkIds } from "./comboPaging.js";
import { lockSubmissionQueriesForParlays, ARCHIVED_ID_CHUNK, ARCHIVED_SUBS_TTL_MS } from "./comboLockSubmissions.js";
import {
  buildComboStatement, sortStatementLines, lockFillReceipt, pushHedgeValue,
  reducedParlayDecimal, pushLockPnl,
} from "./comboStatement.js";

// fetchAllRows pages past 1000 until a short page.
const all = Array.from({ length: 2447 }, (_, i) => ({ id: i }));
let calls = 0;
const makeQuery = () => ({ range: async (a, b) => { calls += 1; return { data: all.slice(a, b + 1), error: null }; } });
const got = await fetchAllRows(makeQuery);
assert.equal(got.data.length, 2447); assert.equal(calls, 3);
const bad = await fetchAllRows(() => ({ range: async () => ({ data: null, error: { message: "x" } }) }));
assert.equal(bad.data, null); assert.ok(bad.error);
assert.deepEqual(chunkIds(["a", "b", "c"], 2), [["a", "b"], ["c"]]);

// The History query is no longer capped at 100 and has an id tiebreak.
const src = readFileSync(new URL("./ComboLocks.jsx", import.meta.url), "utf8");
assert.ok(!/not\("archived_at", "is", null\)[^\n]*\.limit\(100\)/.test(src), "History must not stop at 100 locks");
assert.match(src, /fetchAllRows\(\(\) => supabase\.from\("combo_parlays"\)[^\n]*order\("id"/);

// Archived submission reads are chunked.
const q = () => { const b = { select: () => b, eq: () => b, neq: () => b, in: () => b, is: () => b, or: () => b, order: () => b, limit: () => b }; return b; };
const client = { from: q };
const ids = Array.from({ length: 447 }, (_, i) => "id" + i);
const reqs = lockSubmissionQueriesForParlays(client, { userId: "u", living: [], archivedIds: ids });
assert.equal(reqs.length, 2 * Math.ceil(447 / ARCHIVED_ID_CHUNK));

// Stable sort: same sortAt -> createdAt desc -> id desc, regardless of input order.
const L = [
  { id: "a", sortAt: "2026-10-11T23:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
  { id: "c", sortAt: "2026-10-11T23:00:00Z", createdAt: "2026-10-02T00:00:00Z" },
  { id: "b", sortAt: "2026-10-11T23:00:00Z", createdAt: "2026-10-02T00:00:00Z" },
];
assert.deepEqual(sortStatementLines(L).map((x) => x.id), ["c", "b", "a"]);
assert.deepEqual(sortStatementLines(L.slice().reverse()).map((x) => x.id), ["c", "b", "a"]);

// Real fill prices: priced Kalshi rows used as-is, unpriced (Polymarket) rows estimated at fill_american.
const lock = { id: "p1", fill_american: 400, parlay_stake: 100, parlay_american: 500, legs: [{}, {}], created_at: "2026-10-01T00:00:00Z", archived_at: "2026-10-02T00:00:00Z", underlying_result: "lost", underlying_source: "kalshi_legs", underlying_settled_at: "2026-10-02T00:00:00Z" };
const fills = [
  { parlay_id: "p1", count: 100, yes_price: 0.25, no_price: 0.75, is_combo: true, is_taker: false, fee: 1 },
  { parlay_id: "p1", count: 50, yes_price: null, no_price: null, is_combo: true, is_taker: false },
  { parlay_id: "p1", count: 999, yes_price: 0.5, is_combo: true, is_taker: true },
];
const rec = lockFillReceipt(lock, fills, 150);
assert.equal(rec.pricedContracts, 100); assert.equal(rec.estimatedContracts, 50);
assert.ok(Math.abs(rec.received - (25 + 50 * 0.2 - 1)) < 1e-9);
const st = buildComboStatement({ parlays: [lock], fillsById: { p1: 150 }, fills });
const line = st.lines[0];
// Parlay missed: book -100, hedge keeps receipt: 25 + 10 - 1 = 34 -> -66.
assert.equal(line.side, "miss");
assert.equal(line.pnl, -66);

// Tie rule: Kalshi/Polymarket pay $0.50 per tied leg; book drops the leg.
assert.equal(pushHedgeValue(1), 0.5);
assert.equal(pushHedgeValue(2), 0.25);
const pk = {
  id: "pk", parlay_stake: 100, parlay_american: 716, fill_american: 595,
  legs: [{}, {}, {}],
  leg_results: [{ status: "won" }, { status: "won" }, { status: "push" }],
  underlying_result: "push", underlying_source: "kalshi_legs", underlying_settled_at: "2026-10-11T21:15:19Z",
  created_at: "2026-10-05T19:54:25Z", archived_at: "2026-10-11T23:00:00Z",
};
const dRed = reducedParlayDecimal(pk, 1);
assert.ok(Math.abs(dRed - Math.pow(8.16, 2 / 3)) < 1e-9);
// Unhedged push: profit at the 2-leg price, not $0.
assert.equal(pushLockPnl(pk, { filled: 0, fills: [] }), Math.round(100 * (dRed - 1) * 100) / 100);
const pkFills = [
  { parlay_id: "pk", count: 153, yes_price: 0.147, is_combo: true, is_taker: false },
  { parlay_id: "pk", count: 640.41, yes_price: null, is_combo: true, is_taker: false },
];
const pkLine = buildComboStatement({ parlays: [pk], fillsById: { pk: 793.41 }, fills: pkFills }).lines[0];
const expect = 100 * (dRed - 1) + 153 * 0.147 + 640.41 * (100 / 695) - 793.41 * 0.5;
assert.equal(pkLine.side, "push");
assert.ok(pkLine.settled);
assert.ok(Math.abs(pkLine.pnl - expect) < 0.01, `push pnl ${pkLine.pnl} vs ${expect}`);
assert.notEqual(pkLine.pnl, 0);
// All legs tied: stake back on the book.
assert.equal(reducedParlayDecimal({ parlay_american: 500, legs: [{}] }, 1), 1);

console.log("comboHistoryAll.test.js ok");

// Load speed: the lists draw as soon as the fast core reads land (locks, kill switch, archived
// locks, fills); the slow reads (booked contracts, match counts, per-lock attempts) no longer
// hold Waiting / Filled / History behind "Loading…".
{
  const page = readFileSync(new URL("./ComboLocks.jsx", import.meta.url), "utf8");
  const core = page.indexOf("const coreP = Promise.allSettled([");
  const extra = page.indexOf("const extraP = Promise.allSettled([");
  const ready = page.indexOf("setDeskLoading(false);\n\n      const [historyRes");
  const awaitExtra = page.indexOf("(await extraP)");
  assert.ok(core > 0 && extra > core, "core and secondary reads start together");
  assert.ok(ready > 0 && ready < awaitExtra, "lists stop loading before the slow reads are awaited");
  const coreBlock = page.slice(core, extra);
  assert.doesNotMatch(coreBlock, /is_live\.eq\.true|combo_match_counts|combo_parlay_bets/, "slow reads stay out of the core");
  assert.match(page, /archFresh \? \[\] : allArchivedIds/, "archived per-lock reads are cached between polls");
}
assert.equal(ARCHIVED_SUBS_TTL_MS, 10 * 60 * 1000);
