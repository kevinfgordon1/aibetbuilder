import assert from "node:assert/strict";
import { relayIndex } from "./rootForPrices.js";
const now = Date.parse("2026-10-18T18:33:00Z"); const iso = (ms) => new Date(ms).toISOString();
const kb = [{ bet_type: "moneyline", ticker: "KXNFLGAME-26OCT18PITTB-TB", away: "Pittsburgh Steelers", home: "Tampa Bay Buccaneers", start: "2026-10-18T17:00:00Z" }];
const q = (venue, side, odds, upd, extra = {}) => ({ bet_type: "moneyline", away: "Pittsburgh Steelers", home: "Tampa Bay Buccaneers", side, odds, size: 5000, start: "2026-10-18T17:00:00Z", updated_at: iso(upd), ...(venue === "pm" ? { feed: "polymarket-us", confirmed_at: iso(upd) } : {}), ...extra });
const pm = [q("pm", "Tampa Bay Buccaneers", 0.7675, now - 1000), q("pm", "Pittsburgh Steelers", 0.235, now - 1000)];
const nv = [q("nv", "Tampa Bay Buccaneers", 0.44, now - 2000), q("nv", "Pittsburgh Steelers", 0.235, now - 2000)];
const ev = "KXNFLGAME-26OCT18PITTB";
// started: off-market TB Novig dropped, PIT kept
let r = relayIndex({ kalshiBoard: kb, polymarket: pm, novig: nv, novigLive: true, polledAt: now, started: new Set([ev]) });
assert.equal(r[ev].TB.novig, undefined); assert.ok(r[ev].PIT.novig); assert.equal(r.droppedNovig[0].reason, "off-market");
// not started: untouched
r = relayIndex({ kalshiBoard: kb, polymarket: pm, novig: nv, novigLive: true, polledAt: now });
assert.ok(r[ev].TB.novig);
// started, old Novig quote (own update time 5 min ago) dropped even without a reference
r = relayIndex({ kalshiBoard: kb, polymarket: [], novig: [q("nv", "Pittsburgh Steelers", 0.235, now - 5 * 60000)], novigLive: true, polledAt: now, started: new Set([ev]) });
assert.equal((r[ev] || {}).PIT && r[ev].PIT.novig, undefined);
// Kalshi as reference when Polymarket is missing
r = relayIndex({ kalshiBoard: kb, polymarket: [], novig: nv, novigLive: true, polledAt: now, started: new Set([ev]), kalshiBooks: { [`${ev}-TB`]: { yes: [[0.78, 100]], no: [] } }, kalshiAt: now });
assert.equal(r[ev].TB.novig, undefined);
console.log("rootForPrices novig in-play ok");
