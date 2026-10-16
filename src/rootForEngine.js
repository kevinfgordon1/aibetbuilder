// "What to root for": joint P&L across ALL of Kevin's open Combo Locks.
//
// Each lock = sportsbook parlay + hedge contracts sold on the combo (Kalshi / Polymarket).
//   hit  (every leg wins): book.hit  + hedge.received − hedge.filled   ($1 per sold contract)
//   miss (any leg loses):  book.miss + hedge.received
// Events: a game moneyline is ONE event whose outcomes are the two teams (so the same team in
// many locks is perfectly correlated and A vs B can't both win). Spread / total legs are their
// own yes/no event (shared across locks by ticker). Different events are independent.
// Probabilities: the live inverse bet method per leg (caller supplies them).
//
// Exact: depth-first over events (most-shared first); once every lock is decided the subtree
// collapses. Past the node budget it falls back to Monte Carlo and says so.

export const DEFAULT_NODE_BUDGET = 4_000_000;
export const MC_SAMPLES = 200_000;

/** Kalshi game leg → { event, outcomes, allowed }. Non-game tickers → binary yes/no event. */
export function legEvent(leg) {
  const ticker = String((leg && leg.ticker) || "").toUpperCase();
  const side = String((leg && leg.side) || "yes").toLowerCase() === "no" ? "no" : "yes";
  const parts = ticker.split("-");
  if (/GAME$/.test(parts[0] || "") && parts.length >= 3) {
    const m = /^\d{2}[A-Z]{3}\d{2}([A-Z]+)$/.exec(parts[1] || "");
    const team = parts[2];
    let teams = null;
    if (m && m[1].startsWith(team)) teams = [team, m[1].slice(team.length)];
    else if (m && m[1].endsWith(team)) teams = [m[1].slice(0, m[1].length - team.length), team];
    if (teams && teams[0] && teams[1]) {
      const event = parts[0] + "-" + parts[1];
      return { event, kind: "game", outcomes: teams, allowed: side === "no" ? teams.filter((t) => t !== team) : [team], team };
    }
  }
  return { event: ticker, kind: "binary", outcomes: ["yes", "no"], allowed: [side] };
}

/** Per-outcome probabilities for each event from leg-level inverse fairs.
 *  legP: { [ticker:side]: p }. A game with only one side held: P(team)=p, P(other)=1−p.
 *  Both sides held (each from its own inverse price): normalized to sum to 1 (noted). */
export function eventProbs(events, legP) {
  const out = {}; const notes = [];
  for (const e of events) {
    if (e.kind === "game") {
      const [a, b] = e.outcomes;
      const pa = legP[`${e.event}-${a}:yes`]; const pb = legP[`${e.event}-${b}:yes`];
      if (pa != null && pb != null) { const s = pa + pb; out[e.event] = { [a]: pa / s, [b]: pb / s }; notes.push(e.event); }
      else if (pa != null) out[e.event] = { [a]: pa, [b]: 1 - pa };
      else if (pb != null) out[e.event] = { [a]: 1 - pb, [b]: pb };
    } else {
      const py = legP[`${e.event}:yes`]; const pn = legP[`${e.event}:no`];
      if (py != null && pn != null) { const s = py + pn; out[e.event] = { yes: py / s, no: pn / s }; notes.push(e.event); }
      else if (py != null) out[e.event] = { yes: py, no: 1 - py };
      else if (pn != null) out[e.event] = { yes: 1 - pn, no: pn };
    }
  }
  return { probs: out, bothSides: notes };
}

/** locks: [{ id, label, legs:[{ticker, side}], hit, miss }]  (hit/miss = that lock's total P&L).
 *  probs: { [event]: { [outcome]: p } }. Returns the full root-for summary.
 *  EV, SD and every swing are exact in closed form (joint hit probabilities under the event model).
 *  Best / worst case and P(profit), P(worst) are exact by pruned depth-first search over events;
 *  past the node budget those fall back to Monte Carlo (method says which). */
export function rootFor(locks, probs, { nodeBudget = DEFAULT_NODE_BUDGET, mcSamples = MC_SAMPLES, rng = Math.random } = {}) {
  const evMap = new Map();
  const L = [];
  for (const lk of locks || []) {
    const req = new Map(); let impossible = false;
    for (const leg of lk.legs || []) {
      const r = legEvent(leg);
      if (!evMap.has(r.event)) evMap.set(r.event, { id: r.event, kind: r.kind, outcomes: [...r.outcomes], touch: 0 });
      const prev = req.get(r.event);
      const next = prev ? new Set(r.allowed.filter((o) => prev.has(o))) : new Set(r.allowed);
      if (!next.size) impossible = true;
      req.set(r.event, next);
    }
    for (const k of req.keys()) evMap.get(k).touch += 1;
    L.push({ id: lk.id, label: lk.label, hit: Number(lk.hit) || 0, miss: Number(lk.miss) || 0, req, impossible });
  }
  const evs = [...evMap.values()].sort((a, b) => b.touch - a.touch);
  const nE = evs.length;
  const idx = new Map(evs.map((e, i) => [e.id, i]));
  const P = evs.map((e) => {
    const row = e.outcomes.map((o) => Math.max(0, Number(probs && probs[e.id] && probs[e.id][o]) || 0));
    const s = row.reduce((a, b) => a + b, 0);
    return s > 0 ? row.map((x) => x / s) : row.map(() => 1 / row.length);
  });
  const lockReq = L.map((l) => [...l.req.entries()].map(([k, set]) => [idx.get(k), set]).sort((a, b) => a[0] - b[0]));
  const missSum = L.reduce((a, l) => a + l.miss, 0);
  const gain = L.map((l) => (l.impossible ? 0 : l.hit - l.miss));
  const pSet = (e, set) => evs[e].outcomes.reduce((a, o, oi) => a + (set.has(o) ? P[e][oi] : 0), 0);

  // ---------- exact closed form: EV, SD, swings ----------
  const pHit = lockReq.map((r, i) => (L[i].impossible ? 0 : r.reduce((a, [e, set]) => a * pSet(e, set), 1)));
  const ev = missSum + gain.reduce((a, g, i) => a + g * pHit[i], 0);
  let varr = 0;
  for (let i = 0; i < L.length; i++) {
    if (!gain[i]) continue;
    varr += gain[i] * gain[i] * (pHit[i] - pHit[i] * pHit[i]);
    for (let j = i + 1; j < L.length; j++) {
      if (!gain[j]) continue;
      const m = new Map(lockReq[i].map(([e, s]) => [e, s]));
      let ok = true;
      for (const [e, s] of lockReq[j]) { const a = m.get(e); if (a) { const n = new Set([...s].filter((o) => a.has(o))); if (!n.size) { ok = false; break; } m.set(e, n); } else m.set(e, s); }
      let pij = 0;
      if (ok) { pij = 1; for (const [e, s] of m) pij *= pSet(e, s); }
      varr += 2 * gain[i] * gain[j] * (pij - pHit[i] * pHit[j]);
    }
  }
  const sd = Math.sqrt(Math.max(0, varr));
  const byEvent = evs.map(() => []);
  lockReq.forEach((r, i) => r.forEach(([e, set]) => byEvent[e].push([i, set])));
  const condEv = (k, oi) => { // E[X | event k = outcome oi]
    const o = evs[k].outcomes[oi];
    let x = ev;
    for (const [i, set] of byEvent[k]) {
      const pk = pSet(k, set);
      const cond = set.has(o) && pk > 0 ? pHit[i] / pk : 0;
      x += gain[i] * (cond - pHit[i]);
    }
    return x;
  };

  // ---------- exact pruned search: best / worst / P(profit) / P(worst) ----------
  const lastIdx = lockReq.map((r) => (r.length ? r[r.length - 1][0] : -1));
  let base = missSum;
  const live0 = [];
  for (let i = 0; i < L.length; i++) { if (L[i].impossible || !gain[i]) continue; if (lastIdx[i] < 0) base += gain[i]; else live0.push(i); }
  let posPend0 = 0, negPend0 = 0;
  for (const i of live0) { if (gain[i] > 0) posPend0 += gain[i]; else negPend0 += gain[i]; }
  const alive = new Uint8Array(L.length);
  for (const i of live0) alive[i] = 1;
  let nodes = 0, aborted = false;
  // generic DFS: visit(e, x, pos, neg, mass) with a pruning callback returning a value or null
  const search = (leaf, prune, combine, init) => {
    nodes = 0; aborted = false;
    const rec = (e, x, pos, neg, mass) => {
      if (aborted) return init();
      if (++nodes > nodeBudget) { aborted = true; return init(); }
      const pr = prune(x, pos, neg, mass);
      if (pr !== null) return pr;
      if (e === nE || (pos === 0 && neg === 0)) return leaf(x, mass);
      const touching = byEvent[e];
      if (!touching.some(([i]) => alive[i])) return rec(e + 1, x, pos, neg, mass);
      let acc = init();
      for (let oi = 0; oi < evs[e].outcomes.length; oi++) {
        const po = P[e][oi];
        if (!(po > 0)) continue;
        const o = evs[e].outcomes[oi];
        const killed = []; let dx = 0, dpos = 0, dneg = 0;
        for (const [i, set] of touching) {
          if (!alive[i]) continue;
          const g = gain[i];
          if (!set.has(o)) { alive[i] = 0; killed.push(i); if (g > 0) dpos += g; else dneg += g; }
          else if (lastIdx[i] === e) { alive[i] = 0; killed.push(i); dx += g; if (g > 0) dpos += g; else dneg += g; }
        }
        acc = combine(acc, rec(e + 1, x + dx, pos - dpos, neg - dneg, mass * po));
        for (const i of killed) alive[i] = 1;
        if (aborted) break;
      }
      return acc;
    };
    const v = rec(0, base, posPend0, negPend0, 1);
    return aborted ? null : v;
  };
  const eps = 0.005;
  let bestV = -Infinity, worstV = Infinity;
  const bestR = search((x) => { if (x > bestV) bestV = x; return x; }, (x, pos) => (x + pos <= bestV ? -Infinity : null), Math.max, () => -Infinity);
  const worstR = search((x) => { if (x < worstV) worstV = x; return x; }, (x, pos, neg) => (x + neg >= worstV ? Infinity : null), Math.min, () => Infinity);
  const probAbove = (T) => search(() => 0, (x, pos, neg, mass) => (x + neg > T ? mass : x + pos <= T ? 0 : null), (a, b) => a + b, () => 0);
  const probAtMost = (T) => search(() => 0, (x, pos, neg, mass) => (x + pos <= T ? mass : x + neg > T ? 0 : null), (a, b) => a + b, () => 0);
  let method = "exact";
  let best = bestR != null ? { pnl: bestR } : null, worst = worstR != null ? { pnl: worstR } : null;
  let pProfit = probAbove(eps);
  if (best) best.p = probAbove(best.pnl - eps);
  if (worst) worst.p = probAtMost(worst.pnl + eps);
  const exactFlags = { best: !!(best && best.p != null), worst: !!(worst && worst.p != null), pProfit: pProfit != null };
  let mcNote = null;
  if (best == null || worst == null || pProfit == null || best.p == null || worst.p == null) {
    // Monte Carlo for the distribution figures only (EV / SD / swings above stay exact)
    method = "monte_carlo";
    const draw = new Int32Array(nE); let hi = -Infinity, lo = Infinity, nHi = 0, nLo = 0, nProfit = 0;
    for (let s = 0; s < mcSamples; s++) {
      for (let e = 0; e < nE; e++) { let u = rng(), o = 0; while (o < P[e].length - 1 && u >= P[e][o]) { u -= P[e][o]; o++; } draw[e] = o; }
      let x = missSum;
      for (let i = 0; i < L.length; i++) { if (!gain[i]) continue; let hit = true; for (const [e, set] of lockReq[i]) if (!set.has(evs[e].outcomes[draw[e]])) { hit = false; break; } if (hit) x += gain[i]; }
      if (x > eps) nProfit++;
      if (x > hi + eps) { hi = x; nHi = 1; } else if (Math.abs(x - hi) <= eps) nHi++;
      if (x < lo - eps) { lo = x; nLo = 1; } else if (Math.abs(x - lo) <= eps) nLo++;
    }
    if (pProfit == null) pProfit = nProfit / mcSamples;
    if (!best || best.p == null) best = best && best.pnl != null ? { pnl: best.pnl, p: null } : { pnl: hi, p: nHi / mcSamples, sampled: true };
    if (!worst || worst.p == null) worst = worst && worst.pnl != null ? { pnl: worst.pnl, p: null } : { pnl: lo, p: nLo / mcSamples, sampled: true };
    const which = [!exactFlags.best && "best case", !exactFlags.worst && "worst case", !exactFlags.pProfit && "chance of profit"].filter(Boolean).join(", ");
    mcNote = `Too many game combinations to search exactly (${nE} games): ${which} sampled from ${mcSamples.toLocaleString()} simulated slates (Monte Carlo). Everything else is exact.`;
  }

  const swings = []; const perEvent = [];
  evs.forEach((e, k) => {
    const rows = e.outcomes.map((o, oi) => {
      const p = P[k][oi];
      const ifHit = p > 0 ? condEv(k, oi) : null;
      const ifMiss = p < 1 ? (ev - p * (ifHit || 0)) / (1 - p) : null;
      return { event: e.id, kind: e.kind, outcome: o, p, ifHit, ifMiss, swing: ifHit != null && ifMiss != null ? ifHit - ifMiss : null, locks: byEvent[k].filter(([, s]) => s.has(o)).length };
    });
    for (const r of rows) if (r.swing != null && (e.kind === "game" || r.locks > 0)) swings.push(r);
    const pick = rows.filter((r) => r.ifHit != null).sort((a, b) => b.ifHit - a.ifHit)[0];
    perEvent.push({ event: e.id, kind: e.kind, rootFor: pick ? pick.outcome : null, p: pick ? pick.p : null, swing: pick && pick.swing != null ? pick.swing : null, locks: e.touch, outcomes: rows });
  });
  const seen = new Set();
  const top = swings.filter((r) => r.swing > 0).sort((a, b) => b.swing - a.swing).filter((r) => (seen.has(r.event) ? false : (seen.add(r.event), true))).slice(0, 5);
  perEvent.sort((a, b) => (b.swing || 0) - (a.swing || 0));
  return { method, exact: exactFlags, note: mcNote, nodeBudget, samples: method === "monte_carlo" ? mcSamples : null, events: nE, locks: L.length, ev, sd, lo2: ev - 2 * sd, hi2: ev + 2 * sd, pProfit, best, worst, top, perEvent };
}
