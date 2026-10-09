import assert from "node:assert/strict";
import { capsLine, venueStatusText, userTradingState, pnlByUser, signedMoney, emptyForm, CONNECT_COPY, VENUE_HELP, KALSHI_HOWTO, money } from "./comboTesters.js";

assert.equal(capsLine({ perLockUsd: 50, perDayUsd: 250 }), "$50 per lock · $250 per day");
assert.equal(capsLine(null), "No limits");
assert.equal(money(12.5), "$12.50");
assert.equal(venueStatusText("kalshi", { connected: true, hint: "1234" }), "Kalshi connected ••••1234");
assert.equal(venueStatusText("polymarket_us", { connected: false }), "Polymarket US not connected");
assert.equal(venueStatusText("kalshi", { connected: true, label: "Kalshi connected ••••9999" }), "Kalshi connected ••••9999");

const base = { in_live_users: true, approved: true, paused: false, kill_switch: false, desk: "own_keys", keys: { kalshi: { connected: true } } };
assert.equal(userTradingState(base).key, "trading");
assert.equal(userTradingState({ ...base, paused: true }).key, "paused");
assert.equal(userTradingState({ ...base, keys: { kalshi: { connected: false } } }).key, "no_key");
assert.equal(userTradingState({ ...base, kill_switch: true }).key, "kill");
assert.equal(userTradingState({ ...base, in_live_users: false, approved: false }).key, "not_approved");
assert.equal(userTradingState({ ...base, is_owner: true, desk: "server_keys" }).label, "Trading (server keys)");

// P/L grouped per user; a stranger's lock never lands in another user's total.
const p = (id, user_id, kalshi_result) => ({
  id, user_id, label: id, parlay_stake: 100, parlay_american: 300, fill_american: 280, max_contracts: 0,
  legs: [], active: false, archived_at: "2026-10-01T00:00:00Z", kalshi_result, kalshi_status: kalshi_result ? "finalized" : null, settled_at: kalshi_result ? "2026-10-01T03:00:00Z" : null,
});
const pnl = pnlByUser([p("a", "u1", "no"), p("b", "u2", "yes"), p("c", "u2", null)], [{ parlay_id: "a", count: 10 }, { parlay_id: "b", count: 5 }]);
assert.deepEqual(Object.keys(pnl).sort(), ["u1", "u2"]);
assert.equal(pnl.u1.settled, 1);
assert.equal(pnl.u2.pending, 1);
assert.ok(Number.isFinite(pnl.u1.realized));
assert.equal(signedMoney(-3.5), "−$3.50");
assert.equal(signedMoney(2), "+$2.00");
assert.deepEqual(emptyForm(), { keyId: "", secret: "" });
assert.ok(/own money/.test(CONNECT_COPY.intro) && /own risk/.test(CONNECT_COPY.intro));
assert.ok(/trade-only/.test(CONNECT_COPY.keyAdvice));
assert.ok(/Ed25519 or RSA keys both work/.test(VENUE_HELP.kalshi.where));
assert.equal(KALSHI_HOWTO.steps.length, 6);
assert.ok(KALSHI_HOWTO.steps.some((s) => /check only Read all data and Trade/.test(s)));
assert.ok(KALSHI_HOWTO.steps.some((s) => /Check & save key/.test(s)));
assert.ok(KALSHI_HOWTO.steps.some((s) => /exchange-indexes/.test(s)));
assert.ok(/Settings > Advance shard settings/.test(KALSHI_HOWTO.steps[5]));
assert.ok(/Turn on "Disable balance management", click Transfer/.test(KALSHI_HOWTO.steps[5]));
assert.ok(/Exchange 0 \(Default\) to Exchange 1 \(Combos\)/.test(KALSHI_HOWTO.steps[5]));
assert.ok(/turn the switch back off/.test(KALSHI_HOWTO.steps[5]));
assert.ok(/can't move or withdraw money/.test(KALSHI_HOWTO.safe));
assert.ok(/Never share your exchange password/.test(CONNECT_COPY.never));
console.log("comboTesters.test.js ok");
