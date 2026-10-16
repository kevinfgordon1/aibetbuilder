import assert from "node:assert/strict";
import { portfolioRisk, legToRestriction, fitEventProbs } from "./parlayRisk.js";
const close = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} vs ${b}`);

// legs parse: game with two teams, :no = the other team
const r = legToRestriction("KXNFLGAME-26OCT18DENSEA-SEA:no");
assert.equal(r.event, "KXNFLGAME-26OCT18DENSEA"); assert.deepEqual(r.allowed, ["DEN"]);

// Broncos / Seahawks: two parlays on opposite sides of one game + a shared independent leg
const DEN = "KXNFLGAME-26OCT18DENSEA-DEN:yes", SEA = "KXNFLGAME-26OCT18DENSEA-SEA:yes";
const KC = "KXNFLGAME-26OCT18LACKC-KC:yes";
const pos = [
  { legs: [DEN, KC], contracts: 100, keep: 20, handle: 21, ev: 1 },
  { legs: [SEA, KC], contracts: 100, keep: 30, handle: 31, ev: 2 },
];
const probs = { "KXNFLGAME-26OCT18DENSEA": { DEN: 0.4, SEA: 0.6 }, "KXNFLGAME-26OCT18LACKC": { KC: 0.5, LAC: 0.5 } };
const x = portfolioRisk(pos, { eventProbs: probs });
close(x.sumMaxLoss, 150);           // naive: 80 + 70
close(x.worstCase, -50);            // at most one hits: SEA+KC → 20 − 70
close(x.bestCase, 50);              // KC loses: both miss
close(x.handle, 52); close(x.ev, 3);
close(x.pWorst, 0.5); // either hit gives −50 (sumKeep 50 − 100)
close(x.pLoss, 0.4 * 0.5 + 0.6 * 0.5); // either hits → loss (DEN hit: 30−80 = −50? no: 50−100 = −50)
// exact SD: H = 100·[DEN∧KC] + 100·[SEA∧KC]; mutually exclusive → H = 100·KC
close(x.sd, 50, 1e-6);

// independent, nothing shared → worst = sum of max losses
const y = portfolioRisk([{ legs: [DEN], contracts: 10, keep: 4 }, { legs: [KC], contracts: 10, keep: 4 }], { eventProbs: probs });
close(y.worstCase, -12); close(y.sumMaxLoss, 12);
close(y.sd, Math.sqrt(100 * 0.24 + 100 * 0.25), 1e-9);

// same-event Yes and No inside one parlay can never hit
const td = "KXNFLANYTD-26OCT18-PLAYER1";
const z = portfolioRisk([{ legs: [td + ":yes", td + ":no"], contracts: 10, keep: 1 }, { legs: [td + ":yes"], contracts: 10, keep: 2 }]);
close(z.worstCase, 3 - 10); close(z.bestCase, 3);
// TD Yes vs TD No in separate parlays: exclusive
const w = portfolioRisk([{ legs: [td + ":yes"], contracts: 10, keep: 2 }, { legs: [td + ":no"], contracts: 10, keep: 3 }]);
close(w.worstCase, 5 - 10);

// a larger case: 24 games, exactness vs brute force on worst case
const games = Array.from({ length: 12 }, (_, i) => `KXNFLGAME-26OCT18A${String.fromCharCode(65 + i)}B${String.fromCharCode(65 + i)}`);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const big = Array.from({ length: 60 }, () => {
  const legs = games.filter(() => rnd() < 0.4).map((g) => g + "-" + (rnd() < 0.5 ? "A" : "B") + g.slice(-1) + ":yes");
  return { legs: legs.length ? legs : [games[0] + "-A" + games[0].slice(-1) + ":yes"], contracts: 1 + Math.floor(rnd() * 50), keep: rnd() * 3 };
});
const bp = Object.fromEntries(games.map((g) => [g, { ["A" + g.slice(-1)]: 0.5, ["B" + g.slice(-1)]: 0.5 }]));
const B = portfolioRisk(big, { eventProbs: bp });
let worst = Infinity, best = -Infinity, mean = 0, m2 = 0, pl = 0; const sumKeep = big.reduce((a, p) => a + p.keep, 0);
for (let mask = 0; mask < 1 << 12; mask++) {
  let hit = 0;
  for (const p of big) if (p.legs.every((l) => { const gi = games.findIndex((g) => l.startsWith(g + "-")); return (l.split("-")[2][0] === "A") === !((mask >> gi) & 1); })) hit += p.contracts;
  const pnl = sumKeep - hit; worst = Math.min(worst, pnl); best = Math.max(best, pnl); mean += pnl / 4096; m2 += pnl * pnl / 4096; if (pnl < -1e-9) pl += 1 / 4096;
}
close(B.worstCase, worst, 1e-6); close(B.bestCase, best, 1e-6); close(B.modelEv, mean, 1e-6);
close(B.sd, Math.sqrt(m2 - mean * mean), 1e-6); close(B.pLoss, pl, 1e-9);

// probability fit recovers per-game probs from parlay fairs
const fit = fitEventProbs([
  { legs: [DEN], fairProb: 0.4 }, { legs: [KC], fairProb: 0.5 }, { legs: [DEN, KC], fairProb: 0.2 }, { legs: [SEA, KC], fairProb: 0.3 },
]);
close(fit["KXNFLGAME-26OCT18DENSEA"].DEN, 0.4, 1e-4);

// budget exceeded → explicit note, no fake number
const capped = portfolioRisk(big, { nodeBudget: 10 });
assert.equal(capped.exact, false); assert.equal(capped.worstCase, null); assert.ok(capped.note);
// TD prop ticker format from the TD branch: its own binary event
const tdr = legToRestriction("KXNFLTD-26OCT18PITTB-PITKWETJEN10-1:no");
assert.equal(tdr.event, "KXNFLTD-26OCT18PITTB-PITKWETJEN10-1"); assert.deepEqual(tdr.allowed, ["no"]);
console.log("parlayRisk tests ok");
