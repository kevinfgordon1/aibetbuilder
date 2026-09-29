import assert from "node:assert/strict";
import { reconcilePosition, fillInstrumentDelta, reachesOpen, filterFills, readFillsFilter, writeFillsFilter, FILLS_FILTER_KEY } from "./liveDeskPositionFills.js";

const slug = "aec-nfl-phi-chi-2026-09-28";
let t = 0;
function fill(action, outcome, contracts, cost, extra = {}) {
  t += 1;
  return {
    id: "T" + t,
    orderId: "O" + t,
    marketSlug: slug,
    time: new Date(Date.UTC(2026, 8, 29, 0, t)).toISOString(),
    action,
    outcome,
    contracts,
    contractsLabel: String(contracts),
    cost,
    costLabel: "$" + cost.toFixed(2),
    fillMicro: Math.round((cost / contracts) * 1e6),
    ...extra,
  };
}

assert.equal(fillInstrumentDelta({ action: "buy", outcome: "long", contracts: 5 }), 5);
assert.equal(fillInstrumentDelta({ action: "sell", outcome: "short", contracts: 5 }), 5);
assert.equal(fillInstrumentDelta({ action: "buy", outcome: "short", contracts: 5 }), -5);
assert.equal(fillInstrumentDelta({ action: "sell", outcome: "long", contracts: 5 }), -5);
assert.equal(fillInstrumentDelta({ action: "", outcome: "", contracts: 5 }), null);

// Two buys reconcile exactly to the card.
{
  t = 0;
  const fills = [fill("buy", "long", 100, 55), fill("buy", "long", 50, 30)];
  const r = reconcilePosition({ slug, instrumentNet: 150, cost: 85, team: "Philadelphia Eagles" }, fills, { complete: true });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].id, "T2", "newest first");
  assert.equal(r.subtotal.contracts, 150);
  assert.equal(r.subtotal.cost, 85);
  assert.equal(r.reconciled, true);
  assert.equal(r.partial, false);
  assert.equal(r.note, "");
  assert.equal(r.buys.count, 2);
}

// Fills before the last flat point are closed out and excluded; a partial sell reduces cost pro rata.
{
  t = 0;
  const fills = [
    fill("buy", "long", 10, 5), // opened and fully closed
    fill("sell", "long", 10, 6),
    fill("buy", "long", 100, 60), // current position opens here
    fill("sell", "long", 20, 14),
    fill("buy", "long", 20, 11),
  ];
  // Book: 100 @ .60 = 60 -> sell 20 -> 80 @ 48 -> buy 20 @ 11 -> 100 / 59.
  const r = reconcilePosition({ slug, instrumentNet: 100, cost: 59 }, fills, { complete: true });
  assert.equal(r.rows.length, 3);
  assert.equal(r.olderClosedCount, 2);
  assert.equal(r.subtotal.contracts, 100);
  assert.equal(r.subtotal.cost, 59);
  assert.equal(r.reconciled, true);
  assert.equal(r.sells.count, 1);
  assert.ok(reachesOpen({ slug, instrumentNet: 100 }, fills));
}

// Short instrument (held team = short side), a flip fill opens it.
{
  t = 0;
  const fills = [
    fill("buy", "long", 10, 4),
    fill("buy", "short", 30, 18), // covers 10 long, opens 20 short @ .60
  ];
  const r = reconcilePosition({ slug, instrumentNet: -20, cost: 12, team: "Chicago Bears" }, fills, { complete: true });
  assert.equal(r.rows.length, 1);
  assert.equal(r.heldSide, "short");
  assert.equal(r.subtotal.contracts, 20);
  assert.equal(r.subtotal.cost, 12);
  assert.equal(r.reconciled, true);
}

// History window does not reach the open: partial, with the remainder called out.
{
  t = 0;
  const fills = [fill("buy", "long", 50, 27.5)];
  const r = reconcilePosition({ slug, instrumentNet: 150, cost: 85 }, fills, { complete: false });
  assert.equal(r.partial, true);
  assert.equal(r.reconciled, false);
  assert.equal(r.subtotal.contracts, 50);
  assert.match(r.note, /Partial: fetched fills explain 50 of 150 contracts\. 100 contracts \(≈\$57\.50\) come from older fills/);
  assert.equal(reachesOpen({ slug, instrumentNet: 150 }, fills), false);
}

// Cost gap is surfaced, other slugs are ignored.
{
  t = 0;
  const fills = [fill("buy", "long", 100, 55), { ...fill("buy", "long", 5, 2), marketSlug: "other" }];
  const r = reconcilePosition({ slug, instrumentNet: 100, cost: 55.4 }, fills, { complete: true });
  assert.equal(r.rows.length, 1);
  assert.equal(r.contractsMatch, true);
  assert.equal(r.reconciled, false);
  assert.match(r.note, /Cost differs from the card by \$0\.40/);
}

// Bet Protect fields pass through untouched.
{
  t = 0;
  const protect = { line: "Submitted -130 → Filled -125 · Bet Protect" };
  const r = reconcilePosition({ slug, instrumentNet: 10, cost: 5.56 }, [fill("buy", "long", 10, 5.56, { protect, source: "desk" })], { complete: true });
  assert.equal(r.rows[0].protect.line, protect.line);
}

// Filled orders filter.
{
  const rows = [{ id: 1, source: "desk" }, { id: 2, source: "combo" }, { id: 3, source: "" }, { id: 4, protect: { line: "x" } }];
  assert.deepEqual(filterFills(rows, "desk").map((r) => r.id), [1, 4]);
  assert.equal(filterFills(rows, "all").length, 4);
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.equal(readFillsFilter(storage), "desk", "default desk only");
  writeFillsFilter(storage, "all");
  assert.equal(mem.get(FILLS_FILTER_KEY), "all");
  assert.equal(readFillsFilter(storage), "all");
  assert.equal(readFillsFilter({ getItem: () => { throw new Error("blocked"); } }), "desk");
}


// Selling the other team adds to the held side; adds/reduces reflect that.
{
  t = 0;
  const fills = [fill("sell", "long", 10, 4), fill("buy", "short", 5, 3), fill("sell", "short", 3, 2)];
  const r = reconcilePosition({ slug, instrumentNet: -12 }, fills, { complete: true });
  assert.deepEqual(r.rows.map((x) => x.effect), [-1, 1, 1]);
  assert.deepEqual(r.adds, { count: 2, contracts: 15 });
  assert.deepEqual(r.reduces, { count: 1, contracts: 3 });
  assert.equal(r.subtotal.contracts, 12);
}
console.log("liveDeskPositionFills tests passed");
