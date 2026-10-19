// Turning a sport ON must never lower the best Promo pick (Kevin 2026-10-19:
// NCAAF on +$86.21 vs off +$92.27). Exact search: matches brute force and is
// monotonic over sport subsets; App runs it on the uncapped leg pool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findTopParlaysExact, linearEvForm } from "./promoExactScan.js";
import { findBestAcrossLegCounts } from "./promoParlayScan.js";
import { calcFreeBetParlayEV } from "./promoFreeBet.js";

const SPORTS = ["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf", "basketball_nba", "icehockey_nhl"];
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function slate(seed, games = 40) {
  const r = rng(seed); const legs = [];
  for (let g = 0; g < games; g++) {
    const sport = SPORTS[g % SPORTS.length]; const game = `${sport}-G${g}`;
    for (const side of ["A", "B"]) {
      const fair = Math.round(-250 + r() * 600); const fairN = fair > -100 && fair < 100 ? 120 : fair;
      const dk = fairN > 0 ? Math.round(fairN * (0.85 + r() * 0.25)) : Math.round(fairN * (0.9 + r() * 0.25));
      const dkN = dk > -100 && dk < 100 ? 105 : dk;
      const opp = fairN > 0 ? -fairN - 8 : -fairN + 4;
      legs.push({ name: `${game} ${side} ML`, game, sport, market: "h2h", dk: dkN, bestOpp: opp, commence_time: "2026-10-20T23:00:00Z" });
    }
  }
  return legs;
}
const calc = (ls) => calcFreeBetParlayEV(ls, 100);
const FORM = linearEvForm("freebet", 100);
const sync = () => Promise.resolve();

function brute(legs, k) {
  let best = -Infinity; const pick = [];
  const rec = (s) => {
    if (pick.length === k) { const ev = calc(pick).ev; if (ev > best) best = ev; return; }
    for (let i = s; i < legs.length; i++) {
      if (pick.some((l) => l.game === legs[i].game)) continue;
      pick.push(legs[i]); rec(i + 1); pick.pop();
    }
  };
  rec(0); return best;
}

test("exact search equals brute force", async () => {
  for (const seed of [1, 2, 3]) {
    const legs = slate(seed, 14);
    for (const k of [1, 2, 3, 4]) {
      const top = await findTopParlaysExact(legs, k, calc, FORM, { maxResults: 5, yieldFn: sync });
      assert.ok(Math.abs(top[0].ev - brute(legs, k)) < 1e-9, `seed ${seed} k ${k}`);
    }
  }
});

test("adding a sport never lowers the best 5-leg pick (top-1000 too)", async () => {
  const all = slate(7, 60);
  const subsets = [];
  for (let m = 1; m < 1 << SPORTS.length; m++) subsets.push(SPORTS.filter((_, i) => m & (1 << i)));
  const best = new Map(); const kth = new Map();
  for (const set of subsets) {
    const legs = all.filter((l) => set.includes(l.sport));
    const top = await findTopParlaysExact(legs, 5, calc, FORM, { maxResults: 1000, yieldFn: sync });
    best.set(set.join("+"), top[0]?.ev ?? -Infinity);
    kth.set(set.join("+"), top);
  }
  for (const a of subsets) for (const b of subsets) {
    if (!a.every((s) => b.includes(s)) || a.length === b.length) continue;
    assert.ok(best.get(b.join("+")) >= best.get(a.join("+")) - 1e-9, `${b.join("+")} < ${a.join("+")}`);
    const ta = kth.get(a.join("+")), tb = kth.get(b.join("+"));
    for (let i = 0; i < ta.length; i++) assert.ok(tb[i].ev >= ta[i].ev - 1e-9, `rank ${i} ${b.join("+")} vs ${a.join("+")}`);
  }
});

test("Optimize (across leg counts) is exact + monotonic with evForm", async () => {
  const all = slate(11, 30);
  const off = all.filter((l) => l.sport !== "americanfootball_ncaaf");
  const o = await findBestAcrossLegCounts(off, calc, { maxLegs: 6, evForm: FORM, yieldFn: sync });
  const n = await findBestAcrossLegCounts(all, calc, { maxLegs: 6, evForm: FORM, yieldFn: sync });
  assert.ok(n.pick.ev >= o.pick.ev - 1e-9);
});

test("odds bounds and include filters still apply", async () => {
  const legs = slate(5, 20);
  const top = await findTopParlaysExact(legs, 3, calc, FORM, { maxResults: 50, minFinalOdds: 1000, maxFinalOdds: 3000, yieldFn: sync });
  assert.ok(top.length > 0);
  for (const p of top) assert.ok(p.parlayOdds >= 1000 && p.parlayOdds <= 3000);
});

test("boost form matches calcParlayEV shape", () => {
  const f = linearEvForm("boost", 100, 50);
  const P = 0.2, D = 6; const ev = P * (D - 1) * 100 * 1.5 - (1 - P) * 100;
  assert.ok(Math.abs(f.alpha * P * D - f.beta * P + f.gamma - ev) < 1e-9);
  assert.equal(linearEvForm("nosweat", 100), null);
});

test("App: exact search on the uncapped pool for free bet / boost / no promo", () => {
  const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(app, /if \(linearEvForm\(promoType, 1, 0\)\) return promoLegs;/);
  assert.match(app, /\(evForm \? findTopParlaysExact : findTopParlaysChunked\)/);
  assert.match(app, /evForm: linearEvForm\(promoType, atStake/);
});
