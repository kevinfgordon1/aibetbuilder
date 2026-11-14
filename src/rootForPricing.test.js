import assert from "node:assert/strict";
import { computeRootFor } from "./rootForCompute.js";
import { bookLineForLeg, fineSpreadFromFairs, withBookLabels } from "./rootForBookLine.js";
import { storedEventProbs } from "./rootForStored.js";

const imp = (a) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const evOf = (p, hit, miss) => p * hit + (1 - p) * miss;

// Two-way game held on both sides: the prices scale to 100%. No "neither wins" slate.
{
  const g = "KXNBAGAME-26NOV13PORSAC";
  const por = imp(-373);
  const sac = imp(430);
  const fairs = { [`${g}-POR:yes`]: por, [`${g}-SAC:yes`]: sac };
  const legFairFn = ({ ticker, side }) => ({ p: fairs[`${ticker}:${side}`] ?? null, sources: [] });
  const parlays = [
    { id: "por", label: "Portland", parlay_stake: 10, parlay_american: 436, legs: [{ ticker: `${g}-POR`, side: "yes", label: "Portland", type: "side" }] },
    { id: "sac", label: "Sacramento", parlay_stake: 10, parlay_american: 791, legs: [{ ticker: `${g}-SAC`, side: "yes", label: "Sacramento", type: "side" }] },
  ];
  const out = computeRootFor({ parlays, legFairFn });
  const row = out.model.probs[g];
  assert.equal(row.__neither, undefined);
  assert.ok(Math.abs(row.POR + row.SAC - 1) < 1e-9, JSON.stringify(row));
  assert.ok(Math.abs(row.POR - por / (por + sac)) < 1e-9);
  assert.ok(Math.abs(row.SAC - sac / (por + sac)) < 1e-9);
  assert.equal(out.locksPriced, 2);
}

// b5ead377: the sportsbook bet is Wright St −1.5 and Over 148.5. The stored Kalshi legs are by 3+ and Over 149.5.
{
  const label = "Wright St Raiders -1.5 + Auburn Tigers ML + UL Monroe Warhawks/Arizona St Sun Devils o148.5";
  const legs = [
    { ticker: "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3", side: "yes", type: "spread", label: "Wright St. \u22122.5", game: "Wright St. vs Samford" },
    { ticker: "KXNCAAMBGAME-26NOV13ARIZAUB-AUB", side: "yes", type: "side", label: "Auburn", game: "Arizona vs Auburn" },
    { ticker: "KXNCAAMBTOTAL-26NOV13ULMASU-150", side: "yes", type: "total", label: "Over 149.5", game: "Louisiana-Monroe vs Arizona St." },
  ];
  assert.equal(bookLineForLeg({ label, legs }, legs[0], 0).line, 1.5);
  assert.equal(bookLineForLeg({ label, legs }, legs[2], 2).line, 148.5);
  assert.equal(bookLineForLeg({ label, legs }, legs[1], 1), null);
  const stamped = withBookLabels(legs, label);
  assert.equal(stamped[0].bookLabel, "Wright St Raiders -1.5");
  assert.equal(bookLineForLeg({ label, legs: stamped }, stamped[1], 1), null);

  const POR = "KXNBAGAME-26NOV13PORSAC";
  const SAS = "KXNBAGAME-26NOV13GSWSAS";
  const CHI = "KXNBAGAME-26NOV13ATLCHI";
  const OKC = "KXNBAGAME-26NOV13OKCLAC";
  const WR = "KXNCAAMBGAME-26NOV13WRSTSAM";
  const quote = {
    [`${POR}-POR:yes`]: imp(-373), [`${POR}-SAC:yes`]: imp(430),
    [`${SAS}-SAS:yes`]: imp(-490), [`${CHI}-CHI:yes`]: imp(239), [`${OKC}-OKC:yes`]: imp(-198),
    [`${WR}-WRST:yes`]: 0.5126, "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3:yes": imp(131),
    "KXNCAAMBGAME-26NOV13ARIZAUB-AUB:yes": imp(131),
    "KXNCAAMBTOTAL-26NOV13ULMASU-150:yes": imp(121),
    "KXNCAAMBTOTAL-26NOV13ULMASU-147:yes": 0.542752,
  };
  const legFairFn = ({ ticker, side }) => ({ p: quote[`${ticker}:${side}`] ?? null, sources: [] });
  const ladders = { "KXNCAAMBTOTAL-26NOV13ULMASU": [
    { kind: "total", ticker: "KXNCAAMBTOTAL-26NOV13ULMASU-147", line: 146.5 },
    { kind: "total", ticker: "KXNCAAMBTOTAL-26NOV13ULMASU-150", line: 149.5 },
  ] };
  const money = (id, stake, american, leg) => ({ id, label: leg.label, parlay_stake: stake, parlay_american: american, legs: [leg] });
  const three = [
    { id: "eb36d2ad", label: "Portland Trail Blazers ML + San Antonio Spurs ML + Chicago Bulls ML", parlay_stake: 10, parlay_american: 436, legs: [
      { ticker: `${POR}-POR`, side: "yes", label: "Portland", type: "side" },
      { ticker: `${SAS}-SAS`, side: "yes", label: "San Antonio", type: "side" },
      { ticker: `${CHI}-CHI`, side: "yes", label: "Chicago", type: "side" },
    ] },
    { id: "b5ead377", label, parlay_stake: 15, parlay_american: 919, legs },
    { id: "c2e4eca9", label: "Oklahoma City Thunder ML + Sacramento Kings ML", parlay_stake: 10, parlay_american: 791, legs: [
      { ticker: `${OKC}-OKC`, side: "yes", label: "Oklahoma City", type: "side" },
      { ticker: `${POR}-SAC`, side: "yes", label: "Sacramento", type: "side" },
    ] },
  ];
  const after = computeRootFor({ parlays: three, legFairFn, ladders });
  assert.equal(after.locksPriced, 3, "hedged and unhedged locks all count");
  assert.equal(after.model.probs[POR].__neither, undefined);
  assert.ok(Math.abs(after.model.probs[POR].POR + after.model.probs[POR].SAC - 1) < 1e-9);
  const bands = after.model.probs[WR];
  const bandSum = Object.values(bands).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(bandSum - 1) < 1e-9, JSON.stringify(bands));
  const book = after.model.positions.find((p) => p.id === "b5ead377");
  const spreadLeg = book.legs.find((l) => l.event === WR);
  assert.ok(spreadLeg.allowed.includes("WRST>=3") && spreadLeg.allowed.includes("WRST<3>=2"), JSON.stringify(spreadLeg.allowed));
  assert.ok(!spreadLeg.allowed.includes("WRST<2>=1"));
  const tot = "KXNCAAMBTOTAL-26NOV13ULMASU-150";
  const p148 = after.model.probs[tot].yes;
  const pProxy = imp(121);
  assert.ok(p148 > pProxy && p148 < 0.542752, p148);
  const p15 = (0.5126 + imp(131)) / 2;
  assert.ok(Math.abs(Object.entries(bands).filter(([k]) => k === "WRST>=3" || k === "WRST<3>=2").reduce((a, [, v]) => a + v, 0) - p15) < 1e-9);

  const z = imp(-373) + imp(430);
  const p1 = (imp(-373) / z) * imp(-490) * imp(239);
  const p3 = imp(-198) * (imp(430) / z);
  const p2 = p15 * imp(131) * p148;
  const want = evOf(p1, 43.6, -10) + evOf(p2, 15 * 9.19, -15) + evOf(p3, 79.1, -10);
  assert.ok(Math.abs(after.ev - want) < 1e-6, `${after.ev} vs ${want}`);
  assert.ok(after.ev > 1, `expected clearly positive, got ${after.ev}`);
  const before = evOf(imp(-373) * imp(-490) * imp(239), 43.6, -10) + evOf(imp(131) * imp(131) * imp(121), 15 * 9.19, -15) + evOf(imp(-198) * imp(430), 79.1, -10);
  assert.ok(before < -0.4 && before > -0.6, before);
  console.log("three locks before", before.toFixed(2), "after", after.ev.toFixed(2));
}

// No bracketing strike: keep the proxy and say so. The lock is not dropped.
{
  const label = "Wright St Raiders -10.5";
  const legs = [{ ticker: "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3", side: "yes", type: "spread", label: "Wright St. -2.5", game: "Wright St. vs Samford" }];
  const quote = { "KXNCAAMBGAME-26NOV13WRSTSAM-WRST:yes": 0.6, "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3:yes": 0.4 };
  const legFairFn = ({ ticker, side }) => ({ p: quote[`${ticker}:${side}`] ?? null, sources: [] });
  const out = computeRootFor({ parlays: [{ id: "far", label, parlay_stake: 10, parlay_american: 200, legs }], legFairFn });
  assert.equal(out.locksPriced, 1);
  assert.ok(out.notes.some((n) => /priced on the Kalshi line/.test(n)), JSON.stringify(out.notes));
  const leg = out.model.positions[0].legs[0];
  assert.deepEqual(leg.allowed, ["WRST>=3"]);
}

// A filled hedge stays on the proxy strike. The book ticket uses the easier line. Both count once.
{
  const g = "KXNCAAMBGAME-26NOV13WRSTSAM";
  const quote = { [`${g}-WRST:yes`]: 0.5126, "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3:yes": imp(131) };
  const legFairFn = ({ ticker, side }) => ({ p: quote[`${ticker}:${side}`] ?? null, sources: [] });
  const out = computeRootFor({
    parlays: [],
    legFairFn,
    extraPositions: [{
      id: "hx", label: "Wright St -1.5", filled: 10,
      bookHit: 100, bookMiss: -15, hedgeHit: -4, hedgeMiss: 6, hit: 96, miss: -9,
      legs: [{ ticker: "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3", side: "yes", label: "Wright St. -2.5", game: "Wright St. vs Samford", bookLine: { kind: "spread", sign: "-", line: 1.5, proxyLine: 2.5, team: "Wright St." } }],
    }],
  });
  assert.equal(out.locksPriced, 1);
  const book = out.model.positions.find((p) => p.id === "hx");
  const hedge = out.model.positions.find((p) => p.id === "hx:line");
  assert.ok(book && hedge && hedge.lineHedge);
  assert.ok(book.legs[0].allowed.includes("WRST<3>=2"));
  assert.deepEqual(hedge.legs[0].allowed, ["WRST>=3"]);
  const pBook = book.legs[0].allowed.reduce((a, k) => a + out.model.probs[g][k], 0);
  const pHedge = out.model.probs[g]["WRST>=3"];
  assert.ok(pBook > pHedge);
  const want = evOf(pBook, 100, -15) + evOf(pHedge, -4, 6);
  assert.ok(Math.abs(out.ev - want) < 1e-6, `${out.ev} vs ${want}`);
}

// Saved kickoff fairs rebuild the same margin bands (moneyline and the by-3+ strike bracket −1.5).
{
  const ev = "KXNCAAMBGAME-26NOV13WRSTSAM";
  const dist = { "WRST>=3": 0.4, "WRST<3>=2": 0.05, "WRST<2>=1": 0.06, SAM: 0.49 };
  const fairs = { [`${ev}-WRST:yes`]: { p: 0.5126 }, "KXNCAAMBSPREAD-26NOV13WRSTSAM-WRST3:yes": { p: imp(131) } };
  const got = storedEventProbs(ev, dist, fairs);
  assert.ok(got, "stored fairs price the bet line");
  const p15 = (0.5126 + imp(131)) / 2;
  assert.ok(Math.abs(got["WRST>=3"] + got["WRST<3>=2"] - p15) < 1e-9, JSON.stringify(got));
  assert.ok(Math.abs(Object.values(got).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(fineSpreadFromFairs(ev, { WRST: 0.5, SAM: 0.5 }, fairs), null);
}

console.log("rootFor pricing tests passed");
