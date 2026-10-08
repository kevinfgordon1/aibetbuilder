import assert from "node:assert/strict";
import fs from "node:fs";
import {
  noBidFromFill, usd, etTime, balanceCell, balancesByUser, cellText, cellNote, lockNeedUsd, comboShortfall, filledByParlay, adminBalanceText, BALANCE_STALE_MS,
} from "./comboBalances.js";

// Same math as ComboLocks fillView / worker engine.fillView (cent floor).
assert.equal(noBidFromFill(1100), 0.91);
assert.equal(noBidFromFill(-110), 0.47);
assert.equal(noBidFromFill(50), null);
assert.equal(noBidFromFill("x"), null);

assert.equal(usd(1234.5), "$1,234.50");
assert.equal(usd(1234.5, { cents: false }), "$1,235");
assert.equal(usd(null), "—");

const now = new Date("2026-10-08T18:20:00Z"); // 2:20 PM ET
assert.equal(etTime("2026-10-08T18:15:00Z", now), "2:15 PM ET");
assert.equal(etTime("2026-10-07T18:15:00Z", now), "Oct 7, 2:15 PM ET");
assert.equal(etTime(null, now), "");

const fresh = { user_id: "u", venue: "kalshi", shard: 1, available_usd: "987.65", ok: true, fetched_at: "2026-10-08T18:19:00Z", checked_at: "2026-10-08T18:19:00Z" };
assert.deepEqual(balanceCell(fresh, now).state, "ok");
assert.equal(balanceCell(fresh, now).amount, 987.65);
assert.equal(balanceCell(null, now).state, "waiting");
assert.equal(balanceCell({ ...fresh, ok: false, error: "HTTP 401" }, now).state, "error");
assert.equal(balanceCell({ ...fresh, checked_at: new Date(now.getTime() - BALANCE_STALE_MS - 1000).toISOString() }, now).state, "stale");

assert.equal(cellText(balanceCell(fresh, now)), "$987.65");
assert.equal(cellText(balanceCell(null, now)), "Checking…");
assert.equal(cellText({ state: "error", amount: null }), "Couldn't load");
assert.equal(cellText({ state: "error", amount: 5 }), "$5.00");
assert.match(cellNote({ state: "error", at: "2026-10-08T18:10:00Z" }, now), /Couldn't refresh · last loaded 2:10 PM ET/);
assert.match(cellNote({ state: "stale", checkedAt: "2026-10-08T18:00:00Z" }, now), /Not updated since 2:00 PM ET/);

const by = balancesByUser([
  fresh,
  { ...fresh, shard: 0, available_usd: 5000 },
  { user_id: "u", venue: "polymarket_us", shard: 0, available_usd: 250.25, buying_power_usd: 250.25, ok: true, fetched_at: "2026-10-08T18:19:30Z", checked_at: "2026-10-08T18:19:30Z" },
  { user_id: "v", venue: "kalshi", shard: 1, available_usd: null, ok: false, error: "HTTP 401", fetched_at: null, checked_at: "2026-10-08T18:19:00Z" },
], now);
assert.equal(by.u.kalshiCombo.amount, 987.65);
assert.equal(by.u.kalshiMain.amount, 5000);
assert.equal(by.u.poly.amount, 250.25);
assert.equal(by.u.updatedAt, "2026-10-08T18:19:30Z");
assert.equal(by.v.kalshiCombo.state, "error");
assert.equal(by.v.kalshiMain.state, "waiting");
assert.equal(adminBalanceText(by.u, { kalshi: true, poly: true }), "Combo $988 · Main $5,000 · PM $250");
assert.equal(adminBalanceText(by.v), "Combo — · Main …");
assert.equal(adminBalanceText({ kalshiCombo: { state: "error", amount: null, error: "HTTP 401" }, kalshiMain: { state: "error", amount: null, error: "HTTP 401" }, poly: { state: "waiting", amount: null } }), "Couldn't load (HTTP 401)");
assert.equal(adminBalanceText({ kalshiCombo: { state: "stale", amount: 10 }, kalshiMain: { state: "ok", amount: 5 }, poly: {} }), "Combo $10* · Main $5");
assert.equal(adminBalanceText(undefined), "—");

// Worst-case need: remaining contracts x NO price.
assert.equal(lockNeedUsd({ max_contracts: 100, fill_american: 1100 }, 40), 54.6);
assert.equal(lockNeedUsd({ max_contracts: 100, fill_american: 1100 }, 200), 0);
assert.equal(lockNeedUsd({ max_contracts: null, fill_american: 1100 }), null);
assert.deepEqual(filledByParlay([{ parlay_id: "a", count: 10 }, { parlay_id: "a", count: "5" }, { parlay_id: "b", count: 1 }]), { a: 15, b: 1 });
{
  const parlays = [
    { id: "a", label: "A", max_contracts: 100, fill_american: 1100 },
    { id: "b", label: "B", max_contracts: 1000, fill_american: 1100, paused: true },
    { id: "c", label: "C", max_contracts: 1000, fill_american: 1100, archived_at: "2026-10-01T00:00:00Z" },
    { id: "d", label: "D", max_contracts: 200, fill_american: -110 },
  ];
  const s = comboShortfall({ comboUsd: 50, parlays, filledById: { a: 0 } });
  assert.equal(s.short, true);
  assert.equal(s.parlay.id, "d", "largest active need: 200 x 0.47 = 94 beats 100 x 0.91 = 91; paused/archived ignored");
  assert.equal(s.need, 94);
  assert.equal(s.gap, 44);
  assert.equal(comboShortfall({ comboUsd: 94, parlays }).short, false);
  assert.equal(comboShortfall({ comboUsd: null, parlays }).short, false);
  assert.equal(comboShortfall({ comboUsd: 10, parlays: [] }).short, false);
}
// The old bucket-monitor Main/Combo readout is gone from the page; "Available to trade" replaces it.
{
  const locks = fs.readFileSync(new URL("./ComboLocks.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(locks, /BucketReadout|bucket-readout|\/api\/combo-bucket/);
  const testers = fs.readFileSync(new URL("./ComboTesters.jsx", import.meta.url), "utf8");
  assert.match(testers, /Available to trade/);
}
console.log("comboBalances.test.js ok");
