import assert from "node:assert/strict";
import { promoLegStageCounts, promoEmptyReasons } from "./promoEmptyWhy.js";
const L = (game, name) => ({ game, name, commence_time: "t" });
const A = L("HOU @ TEN", "HOU ML"), B = L("HOU @ TEN", "TEN ML"), C = L("CHI @ GB", "CHI ML"), D = L("CHI @ GB", "GB ML"), E = L("NYG @ WAS", "WAS ML");
// Kevin's case: 3 games, Packers hidden, Bears low liquidity -> 2 games.
let s = promoLegStageCounts({ scoped: [A, B, C, D, E], afterHidden: [A, B, C, E], afterLiquidity: [A, B, E] });
let r = promoEmptyReasons(s, { numLegs: 3, bookLabel: "Underdog Predict", hiddenCount: 2, hideLowLiquidity: true });
assert.equal(r.length, 1);
assert.match(r[0], /Hide low liquidity removed 1 leg.*leaving 2 games/);
s = promoLegStageCounts({ scoped: [A, B, C, D, E], afterHidden: [A, B, E], afterLiquidity: [A, B, E] });
r = promoEmptyReasons(s, { numLegs: 3, hiddenCount: 2, hideLowLiquidity: true });
assert.match(r[0], /2 hidden legs leave only 2 games/);
r = promoEmptyReasons(promoLegStageCounts({ scoped: [], afterHidden: [], afterLiquidity: [] }), { bookLabel: "Underdog Predict" });
assert.match(r[0], /Underdog Predict has no open lines/);
r = promoEmptyReasons(promoLegStageCounts({ scoped: [A, B], afterHidden: [A, B], afterLiquidity: [A, B] }), { numLegs: 3 });
assert.match(r[0], /only has lines on 1 game/);
r = promoEmptyReasons(promoLegStageCounts({ scoped: [A, C, E], afterHidden: [A, C, E], afterLiquidity: [A, C, E] }), { numLegs: 3 });
assert.match(r[0], /no combination beats/);
console.log("promoEmptyWhy.test.js ok");
