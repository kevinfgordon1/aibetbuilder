import assert from "node:assert/strict";
import { capsLine, venueStatusText, userTradingState, pnlByUser, signedMoney, emptyForm, CONNECT_COPY, VENUE_HELP, KALSHI_HOWTO, money, autoFundLine, fundMoveText, AUTOFUND_COPY, effectiveCap, parseCapInput } from "./comboTesters.js";

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
assert.ok(/Full access, or with Read, Trade and Transfers/.test(CONNECT_COPY.keyAdvice));
assert.ok(/Ed25519 or RSA keys both work/.test(VENUE_HELP.kalshi.where));
assert.ok(/Full access/.test(VENUE_HELP.kalshi.where));
assert.equal(KALSHI_HOWTO.steps.length, 6);
assert.equal(KALSHI_HOWTO.steps[2], "Permissions: choose Full access (simplest), or check Read, Trade and Transfers. Leave the sub-account blank.");
assert.ok(KALSHI_HOWTO.steps.some((s) => /Check & save key/.test(s)));
assert.equal(KALSHI_HOWTO.steps[5], "The site moves money into your Combos balance for you, up to the cap you set. Nothing to do here.");
assert.equal(KALSHI_HOWTO.safe, "The site only uses this key to place your Combo Locks trades and move money between your own Kalshi balances. It never withdraws money.");
assert.equal(KALSHI_HOWTO.fallback, undefined, "no manual shard steps in the guide");
const allGuide = KALSHI_HOWTO.steps.join(" ") + KALSHI_HOWTO.safe;
assert.ok(!/check only Read all data and Trade|Advance shard settings|can only read your account|can't move or withdraw/.test(allGuide), "old trade-only copy is gone");
// Auto-funding line.
assert.equal(autoFundLine({ connected: false }, null), null);
assert.equal(autoFundLine({ connected: true, scopeStatus: "ok", autoFund: false }, { perDayUsd: 250 }).text, AUTOFUND_COPY.off);
assert.ok(/reconnect with a key that has Transfers or Full access/.test(AUTOFUND_COPY.off) && /trades keep working/.test(AUTOFUND_COPY.off));
assert.equal(autoFundLine({ connected: true, scopeStatus: "ok", autoFund: true }, { perDayUsd: 250 }).tone, "ok");
assert.ok(/topped up to \$250\./.test(autoFundLine({ connected: true, scopeStatus: "ok", autoFund: true }, { perDayUsd: 250 }).text));
assert.ok(/topped up to \$120\./.test(autoFundLine({ connected: true, scopeStatus: "ok", autoFund: true }, { perDayUsd: 250 }, 120).text));
assert.equal(autoFundLine({ connected: true, scopeStatus: "ok", autoFund: true }, { perDayUsd: 250 }, 0).text, AUTOFUND_COPY.paused);
assert.equal(effectiveCap(null, 250), 250);
assert.equal(effectiveCap(900, 250), 250, "never above the daily limit");
assert.equal(effectiveCap(80, 250), 80);
assert.equal(effectiveCap(80, null), null);
assert.equal(parseCapInput(""), null);
assert.equal(parseCapInput("$1,200.50"), 1200.5);
assert.ok(Number.isNaN(parseCapInput("abc")));
assert.ok(Number.isNaN(parseCapInput("-5")));
assert.equal(autoFundLine({ connected: true, scopeStatus: "ok", autoFund: true }, { perDayUsd: null }).text, AUTOFUND_COPY.noCap);
assert.equal(autoFundLine({ connected: true, scopeStatus: "unverified", autoFund: false }, { perDayUsd: 250 }).text, AUTOFUND_COPY.review);
assert.equal(fundMoveText({ amount_usd: "40", status: "confirmed" }), "$40.00 Default → Combos · done");
assert.equal(fundMoveText({ amount_usd: 12.5, status: "failed" }), "$12.50 Default → Combos · failed");
assert.equal(fundMoveText({ amount_usd: 60, status: "confirmed", from_shard: 1, to_shard: 0 }), "$60.00 Combos → Default · done");
assert.ok(/Never share your exchange password/.test(CONNECT_COPY.never));
console.log("comboTesters.test.js ok");
