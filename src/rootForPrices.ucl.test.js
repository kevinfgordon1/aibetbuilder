import assert from "node:assert/strict";
import { legEvent } from "./rootForEngine.js";
import { legFair, FEES } from "./rootForPrices.js";

const ev = "KXUCLGAME-26NOV03VILPSG";
const yes = legEvent({ ticker: `${ev}-PSG`, side: "yes" });
assert.equal(yes.threeWay, true);
assert.deepEqual(yes.outcomes, ["VIL", "PSG", "TIE"]);
assert.deepEqual(yes.allowed, ["PSG"]);
assert.deepEqual(legEvent({ ticker: `${ev}-PSG`, side: "no" }).allowed, ["VIL", "TIE"]);
assert.deepEqual(legEvent({ ticker: `${ev}-TIE`, side: "yes" }).allowed, ["TIE"]);

// Own No bid 0.55 → No ask 0.45. Opponent Yes at 0.20 must not be used
// (that would price PSG as if the draw belonged to PSG).
const books = {
  [`${ev}-PSG`]: { yes: [[0.62, 20000]], no: [[0.45, 20000]] },
  [`${ev}-VIL`]: { yes: [[0.20, 20000]], no: [[0.78, 20000]] },
};
const now = 1_700_000_000_000;
const fair = legFair({ ticker: `${ev}-PSG`, side: "yes" }, { kalshiBooks: books, relay: {}, now, kalshiAt: now });
const ask = 0.45;
const cost = ask + FEES.kalshi(ask);
assert.ok(Math.abs(fair.p - (1 - cost)) < 1e-9, fair.p);
assert.equal(fair.best, "kalshi");
assert.ok(fair.p < 0.6, "must not price PSG off Villarreal's Yes");

// A cheaper Polymarket US No (same binary) wins. $500 / 15s rules unchanged.
const pmAsk = 0.40;
const pmCost = pmAsk + FEES.polymarket(pmAsk);
const withPm = legFair({ ticker: `${ev}-PSG`, side: "yes" }, {
  kalshiBooks: books,
  relay: { [ev]: { PSG: { polymarket: { levels: [[pmAsk, 20000]], at: now } } } },
  now,
  kalshiAt: now,
});
assert.equal(withPm.best, "polymarket");
assert.ok(Math.abs(withPm.p - (1 - pmCost)) < 1e-9);

// Novig pregame fee is $0. ProphetX takes 2% of net winnings.
assert.equal(FEES.novig(0.4), 0);
const px = 0.5;
assert.ok(Math.abs(FEES.prophetx(px) - (px / (0.98 + 0.02 * px) - px)) < 1e-12);

console.log("ucl inverse ok", fair.p, withPm.p);
