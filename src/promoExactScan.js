// Exact top-K parlay search (branch & bound) for promo EVs of the form
//   EV = alpha * P * D - beta * P + gamma      (alpha >= 0, beta >= 0)
// where P = product of fair leg probs and D = product of book decimals.
// Free bet:  alpha = beta = stake, gamma = 0.
// Boost b:   alpha = stake*(1+b), beta = stake*b, gamma = -stake.
//
// Why exact: the old scan kept the top 3-leg seeds and grew them greedily,
// and the leg pool was a global top-N by edge. Both depend on what ELSE is
// on the slate, so turning a sport ON could push out the legs (or seeds) of
// the parlay that won with it OFF. An exact top-K over the full pool is
// monotonic: a superset of legs can never yield a worse best pick.
//
// Bound: sort legs by a = p*d desc. With r legs still to pick from index i
// on, the best possible remaining P*D factor is prod(a[i..i+r-1]); the
// remaining P is at least the product of the r smallest p from i on. Since
// a is sorted, once the bound fails at i it fails for every later i (break).
import * as playerTd from "../lib/player-td.mjs";
import { considerTopByEv, finalizeTopByEv, passesOddsBounds } from "./promoParlayScan.js";

const { conflictsWithAny } = playerTd;

function trueProb(o) {
  if (!o) return 0.5;
  if (o < 0) return Math.abs(o) / (Math.abs(o) + 100);
  return 100 / (o + 100);
}
function dkDecimal(o) {
  if (!o) return 1;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}

export function linearEvForm(promoType, stake, boostPct = 0) {
  const s = Number(stake);
  if (!Number.isFinite(s) || s <= 0) return null;
  if (promoType === "freebet") return { alpha: s, beta: s, gamma: 0 };
  if (promoType === "boost" || promoType === "nopromo") {
    const b = (Number(boostPct) || 0) / 100;
    if (b < 0) return null;
    return { alpha: s * (1 + b), beta: s * b, gamma: -s };
  }
  return null; // no-sweat EV is not of this form; caller keeps the old path
}

const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

export async function findTopParlaysExact(legs, numLegs, calc, form, {
  maxResults = 10,
  minFinalOdds = null,
  maxFinalOdds = null,
  acceptCombo = null,
  signal = null,
  yieldMs = 8,
  yieldFn = () => new Promise((r) => setTimeout(r, 0)),
} = {}) {
  const k = Number(numLegs) || 0;
  const src = (legs || []).filter(Boolean);
  if (k < 1 || maxResults <= 0 || src.length < k) return [];
  const { alpha, beta, gamma } = form;
  const items = src.map((leg, idx) => {
    const p = 1 - trueProb(leg.bestOpp);
    const d = dkDecimal(leg.dk);
    return { leg, idx, p, a: p * d };
  });
  items.sort((x, y) => (y.a - x.a) || (x.idx - y.idx));
  const n = items.length;
  const A = items.map((x) => x.a);
  // sufMin[i][r]: product of the r smallest p among items[i..] (lower bound
  // on the remaining P when the rest are picked from index i on).
  const sufMin = new Array(n + 1);
  let small = [];
  sufMin[n] = [1];
  for (let i = n - 1; i >= 0; i--) {
    small = small.concat(items[i].p).sort((x, y) => x - y).slice(0, k);
    const row = [1];
    for (let r = 1; r <= k; r++) row[r] = r <= small.length ? row[r - 1] * small[r - 1] : 0;
    sufMin[i] = row;
  }
  const heap = [];
  const chosen = [];
  const st = { last: nowMs() };
  const abort = () => {
    if (signal?.aborted) { const e = new Error("Aborted"); e.name = "AbortError"; throw e; }
  };
  let thrV = -Infinity;
  const thr = () => thrV;

  // Sync DFS below depth 2 (an await per node costs more than the search);
  // the outer two levels are async and yield to keep the page responsive.
  function leaf(aProd, pProd) {
    // Same value calc() returns for this form; skip the object unless it can
    // enter the top-K (small slack for float rounding).
    if (alpha * aProd - beta * pProd + gamma <= thr() - 1e-9) return;
    const comboLegs = chosen.slice();
    const res = calc(comboLegs);
    if (!(res.ev > thr())) return;
    if (!passesOddsBounds(res.parlayOdds, minFinalOdds, maxFinalOdds)) return;
    if (typeof acceptCombo === "function" && !acceptCombo(comboLegs)) return;
    considerTopByEv(heap, { legs: comboLegs, ...res }, maxResults);
    if (heap.length >= maxResults) thrV = heap[0].ev;
  }
  function bound(i, r, aProd, pProd) {
    let top = 1;
    for (let j = i; j < i + r; j++) top *= A[j];
    return alpha * aProd * top - beta * pProd * sufMin[i][r] + gamma;
  }
  function dfsSync(start, aProd, pProd) {
    const r = k - chosen.length;
    if (r === 0) { leaf(aProd, pProd); return; }
    for (let i = start; i <= n - r; i++) {
      if (bound(i, r, aProd, pProd) <= thr()) break;
      const it = items[i];
      if (chosen.length && conflictsWithAny(it.leg, chosen)) continue;
      chosen.push(it.leg);
      dfsSync(i + 1, aProd * it.a, pProd * it.p);
      chosen.pop();
    }
  }
  async function dfs(start, aProd, pProd) {
    const r = k - chosen.length;
    if (r === 0) { leaf(aProd, pProd); return; }
    if (chosen.length >= 2) { dfsSync(start, aProd, pProd); return; }
    for (let i = start; i <= n - r; i++) {
      if (nowMs() - st.last >= yieldMs) {
        abort();
        await yieldFn();
        st.last = nowMs();
      }
      if (bound(i, r, aProd, pProd) <= thr()) break;
      const it = items[i];
      if (chosen.length && conflictsWithAny(it.leg, chosen)) continue;
      chosen.push(it.leg);
      await dfs(i + 1, aProd * it.a, pProd * it.p);
      chosen.pop();
    }
  }
  abort();
  await dfs(0, 1, 1);
  abort();
  return finalizeTopByEv(heap);
}
