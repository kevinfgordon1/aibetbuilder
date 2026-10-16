// Combo Sniper portfolio risk engine — exact joint-outcome math across many parlays we'd sell.
//
// Generic over EVENTS: an event is one random variable with mutually exclusive outcomes
// (an NFL game → one outcome per team; a TD prop → "yes"/"no"). A parlay LEG restricts one
// event to a set of allowed outcomes. A parlay HITS when every leg's event lands in its set.
// Two legs on the same event are combined by intersection, so opposite teams in one game
// (or the same player's TD Yes and No) can never both hit.
//
// For each position we SELL (we're short the parlay):  P&L = keep  if it misses,
//                                                       keep − C  if it hits
// (keep = what we receive, C = contracts = $ payout). So day P&L = Σkeep − Σ C·hit.
// EV is linear, so correlation never changes it; it changes worst case, best case and spread.
//
// Everything here is EXACT (no sampling): worst/best case by depth-first branch-and-bound over
// events; probabilities and the P&L distribution by the same DFS, collapsing any subtree once no
// undecided parlay is still alive. If the tree exceeds the node budget we stop and say so.

export const DEFAULT_NODE_BUDGET = 3_000_000;

/** NFL/NCAAF/... game legs: "KXNFLGAME-26OCT18ARILAR-LAR:yes" → event "KXNFLGAME-26OCT18ARILAR",
 *  outcome "LAR". ":no" = any other outcome of that game (ties ignored: a game is team A or team B).
 *  Other tickers (e.g. TD props) → binary event on the ticker itself, outcomes yes/no. */
export function legToRestriction(raw) {
  const s = String(raw || "");
  const [ticker, sideRaw] = s.split(":");
  const side = (sideRaw || "yes").toLowerCase();
  const parts = (ticker || "").split("-");
  if (/GAME$/.test(parts[0] || "") && parts.length >= 3) {
    const event = parts[0] + "-" + parts[1];
    const team = parts[2];
    const m = /^\d{2}[A-Z]{3}\d{2}([A-Z]+)$/.exec(parts[1] || "");
    let teams = null;
    if (m && m[1].startsWith(team)) teams = [team, m[1].slice(team.length)];
    else if (m && m[1].endsWith(team)) teams = [m[1].slice(0, m[1].length - team.length), team];
    if (teams && teams[0] && teams[1]) {
      return { event, outcomes: teams, allowed: side === "no" ? teams.filter((t) => t !== team) : [team], team };
    }
  }
  return { event: ticker, outcomes: ["yes", "no"], allowed: [side === "no" ? "no" : "yes"] };
}

/** Build the model. positions: [{ legs:[raw], contracts, keep, prob? }]. eventProbs: { [event]: { [outcome]: p } }. */
export function buildModel(positions, { legParser = legToRestriction } = {}) {
  const events = new Map(); // id → { id, outcomes:[...] }
  const pos = [];
  for (const p of positions || []) {
    const req = new Map(); // event → Set(allowed)
    let impossible = false;
    for (const raw of p.legs || []) {
      const r = legParser(raw);
      if (!events.has(r.event)) events.set(r.event, { id: r.event, outcomes: [...r.outcomes] });
      else { const e = events.get(r.event); for (const o of r.outcomes) if (!e.outcomes.includes(o)) e.outcomes.push(o); }
      const prev = req.get(r.event);
      const next = prev ? new Set(r.allowed.filter((o) => prev.has(o))) : new Set(r.allowed);
      if (!next.size) impossible = true;
      req.set(r.event, next);
    }
    pos.push({ C: Number(p.contracts) || 0, keep: Number(p.keep) || 0, req, impossible });
  }
  return { events: [...events.values()], positions: pos };
}

function prepare(model, eventProbs) {
  // order events by how many positions touch them (most first → parlays die fast)
  const touch = new Map(model.events.map((e) => [e.id, 0]));
  for (const p of model.positions) for (const k of p.req.keys()) touch.set(k, touch.get(k) + 1);
  const evs = [...model.events].sort((a, b) => touch.get(b.id) - touch.get(a.id));
  const idx = new Map(evs.map((e, i) => [e.id, i]));
  const live = model.positions.filter((p) => !p.impossible && p.C > 0);
  const P = live.map((p) => {
    const req = [...p.req.entries()].map(([k, set]) => [idx.get(k), set]).sort((a, b) => a[0] - b[0]);
    return { C: p.C, req, last: req.length ? req[req.length - 1][0] : -1 };
  });
  const probs = evs.map((e) => {
    const src = (eventProbs && eventProbs[e.id]) || null;
    const raw = e.outcomes.map((o) => (src && Number.isFinite(src[o]) ? Math.max(0, src[o]) : null));
    const known = raw.filter((x) => x != null).reduce((a, b) => a + b, 0);
    const nUnknown = raw.filter((x) => x == null).length;
    const fill = nUnknown ? Math.max(0, 1 - known) / nUnknown : 0;
    const v = raw.map((x) => (x == null ? fill : x));
    const s = v.reduce((a, b) => a + b, 0) || 1;
    return v.map((x) => x / s);
  });
  // positions touching each event index
  const byEvent = evs.map(() => []);
  P.forEach((p, i) => p.req.forEach(([e, set]) => byEvent[e].push([i, set])));
  return { evs, P, probs, byEvent, sumKeep: model.positions.reduce((a, p) => a + p.keep, 0), sumC: P.reduce((a, p) => a + p.C, 0) };
}

/** Max (or min) of Σ C·hit over joint outcomes, exact branch-and-bound. */
function extremeHits(prep, maximize, budget) {
  const { evs, P, byEvent } = prep;
  const alive = new Uint8Array(P.length).fill(1);
  let best = maximize ? -Infinity : Infinity, bestAssign = null, nodes = 0, aborted = false;
  const assign = new Array(evs.length).fill(null);
  // aliveSum = Σ C of parlays not yet killed; hitSum = Σ C of parlays fully satisfied
  const rec = (e, aliveSum, hitSum) => {
    if (aborted) return;
    if (++nodes > budget) { aborted = true; return; }
    if (maximize ? aliveSum <= best : hitSum >= best) return; // bound: maximize → can't exceed alive; minimize → hits only grow
    if (e === evs.length) {
      const v = hitSum;
      if (maximize ? v > best : v < best) { best = v; bestAssign = assign.slice(); }
      return;
    }
    const touching = byEvent[e];
    if (!touching.some(([i]) => alive[i])) { assign[e] = null; rec(e + 1, aliveSum, hitSum); return; }
    for (const o of evs[e].outcomes) {
      const killed = [];
      let dA = 0, dH = 0;
      for (const [i, set] of touching) {
        if (!alive[i]) continue;
        if (!set.has(o)) { alive[i] = 0; killed.push(i); dA += P[i].C; }
        else if (P[i].last === e) dH += P[i].C;
      }
      assign[e] = o;
      rec(e + 1, aliveSum - dA, hitSum + dH);
      for (const i of killed) alive[i] = 1;
    }
    assign[e] = null;
  };
  // parlays with no legs always hit
  const always = P.filter((p) => p.last < 0).reduce((a, p) => a + p.C, 0);
  rec(0, prep.sumC, always);
  return { value: best, assignment: bestAssign, nodes, aborted };
}

/** Exact P(Σ C·hit ≥ T) (or > T when strict), DFS with certain-yes / certain-no collapsing. */
function probHitsAtLeast(prep, T, strict, budget) {
  const { evs, P, probs, byEvent } = prep;
  const alive = new Uint8Array(P.length).fill(1);
  let nodes = 0, aborted = false;
  const eps = 1e-9;
  const over = (h) => (strict ? h > T + eps : h >= T - eps);
  // pendingSum = Σ C of alive parlays not yet fully decided
  const rec = (e, pending, hitSum) => {
    if (aborted) return 0;
    if (++nodes > budget) { aborted = true; return 0; }
    if (over(hitSum)) return 1;
    if (!over(hitSum + pending)) return 0;
    if (e === evs.length) return 0;
    const touching = byEvent[e];
    if (!touching.some(([i]) => alive[i])) return rec(e + 1, pending, hitSum);
    let tot = 0;
    evs[e].outcomes.forEach((o, oi) => {
      const po = probs[e][oi];
      if (!(po > 0) || aborted) return;
      const killed = [];
      let dP = 0, dH = 0;
      for (const [i, set] of touching) {
        if (!alive[i]) continue;
        if (!set.has(o)) { alive[i] = 0; killed.push(i); dP += P[i].C; }
        else if (P[i].last === e) { dP += P[i].C; dH += P[i].C; }
      }
      tot += po * rec(e + 1, pending - dP, hitSum + dH);
      for (const i of killed) alive[i] = 1;
    });
    return tot;
  };
  const always = P.filter((p) => p.last < 0).reduce((a, p) => a + p.C, 0);
  const pend = P.filter((p) => p.last >= 0).reduce((a, p) => a + p.C, 0);
  const v = rec(0, pend, always);
  return { p: aborted ? null : v, nodes, aborted };
}

/** Exact mean/variance of Σ C·hit via pairwise joint hit probs (works at any size). */
function hitMoments(prep) {
  const { P, probs } = prep;
  // group identical restriction sets
  const keyOf = (p) => p.req.map(([e, s]) => e + ":" + [...s].sort().join("|")).join(",");
  const groups = new Map();
  for (const p of P) { const k = keyOf(p); const g = groups.get(k); if (g) g.C += p.C; else groups.set(k, { C: p.C, req: new Map(p.req.map(([e, s]) => [e, s])) }); }
  const G = [...groups.values()];
  const pOf = (req) => { let x = 1; for (const [e, s] of req) { let q = 0; prep.evs[e].outcomes.forEach((o, oi) => { if (s.has(o)) q += probs[e][oi]; }); x *= q; } return x; };
  const pi = G.map((g) => pOf(g.req));
  let mean = 0, varr = 0;
  for (let i = 0; i < G.length; i++) {
    mean += G[i].C * pi[i];
    varr += G[i].C * G[i].C * (pi[i] - pi[i] * pi[i]);
    for (let j = i + 1; j < G.length; j++) {
      const m = new Map(G[i].req);
      let ok = true;
      for (const [e, s] of G[j].req) { const a = m.get(e); if (a) { const n = new Set([...s].filter((o) => a.has(o))); if (!n.size) { ok = false; break; } m.set(e, n); } else m.set(e, s); }
      const pij = ok ? pOf(m) : 0;
      varr += 2 * G[i].C * G[j].C * (pij - pi[i] * pi[j]);
    }
  }
  return { mean, variance: Math.max(0, varr) };
}

/** Full risk summary for a set of sold positions.
 *  Returns $ figures as our P&L (negative = we lose). */
export function portfolioRisk(positions, { eventProbs = null, nodeBudget = DEFAULT_NODE_BUDGET, legParser } = {}) {
  const model = buildModel(positions, { legParser });
  const prep = prepare(model, eventProbs);
  const sumKeep = prep.sumKeep;
  const sumMaxLoss = (positions || []).reduce((a, p) => a + (Number(p.contracts) - Number(p.keep) || 0), 0);
  const handle = (positions || []).reduce((a, p) => a + (Number(p.handle) || 0), 0);
  const ev = (positions || []).reduce((a, p) => a + (Number(p.ev) || 0), 0);
  const out = { count: (positions || []).length, events: prep.evs.length, handle, sumMaxLoss, ev, sumKeep, exact: true, note: null };
  const hi = extremeHits(prep, true, nodeBudget);
  const lo = extremeHits(prep, false, nodeBudget);
  if (hi.aborted || lo.aborted) {
    out.exact = false;
    out.note = `Too many combinations to solve exactly (${prep.evs.length} events, > ${nodeBudget.toLocaleString()} search steps).`;
    out.worstCase = null; out.bestCase = null;
  } else {
    out.worstCase = sumKeep - hi.value; // our P&L in the worst joint outcome (negative = loss)
    out.bestCase = sumKeep - lo.value;
    out.worstOutcome = hi.assignment ? Object.fromEntries(prep.evs.map((e, i) => [e.id, hi.assignment[i]]).filter(([, o]) => o != null)) : null;
  }
  const mom = hitMoments(prep);
  out.sd = Math.sqrt(mom.variance);
  out.modelEv = sumKeep - mom.mean; // EV under the event probs used here (for consistency checks)
  if (eventProbs) {
    const L = probHitsAtLeast(prep, sumKeep, true, nodeBudget);
    const W = out.worstCase != null ? probHitsAtLeast(prep, sumKeep - out.worstCase, false, nodeBudget) : { p: null };
    out.pLoss = L.p; out.pWorst = W.p;
    if (L.p == null || (out.worstCase != null && W.p == null)) out.note = (out.note ? out.note + " " : "") + "Some chance figures skipped: too many combinations to compute exactly.";
  }
  return out;
}

/** Fit per-game win probabilities from parlay fairs: each row says Σ log p(leg) = log P(fair).
 *  Least squares on that (Gauss–Newton style gradient steps on a logit per event-outcome).
 *  rows: [{ legs:[raw], fairProb }]. Binary events only; returns { [event]: { [outcome]: p } }. */
export function fitEventProbs(rows, { legParser = legToRestriction, iters = 60 } = {}) {
  const evIdx = new Map(), evOut = [];
  const groups = new Map(); // dedupe identical leg sets → mean log fair, weight = count
  for (const r of rows || []) {
    const fp = Number(r.fairProb);
    if (!(fp > 0 && fp < 1)) continue;
    const terms = [];
    let ok = true;
    for (const raw of r.legs || []) {
      const x = legParser(raw);
      if (x.outcomes.length !== 2 || x.allowed.length !== 1) { ok = false; break; }
      if (!evIdx.has(x.event)) { evIdx.set(x.event, evOut.length); evOut.push(x.outcomes); }
      terms.push([evIdx.get(x.event), x.allowed[0] === evOut[evIdx.get(x.event)][0] ? 1 : -1]);
    }
    if (!ok || !terms.length) continue;
    const key = terms.map((t) => t.join(":")).sort().join(",");
    const g = groups.get(key);
    if (g) { g.sum += Math.log(fp); g.w += 1; } else groups.set(key, { terms, sum: Math.log(fp), w: 1 });
  }
  const obs = [...groups.values()].map((g) => ({ terms: g.terms, y: g.sum / g.w, w: g.w }));
  const n = evOut.length;
  const z = new Float64Array(n);
  const sig = (v) => 1 / (1 + Math.exp(-v));
  let lambda = 1e-3;
  const loss = (zz) => obs.reduce((a, o) => { let pr = 0; for (const [e, s] of o.terms) pr += Math.log(sig(s * zz[e])); return a + o.w * (pr - o.y) ** 2; }, 0);
  let cur = loss(z);
  for (let it = 0; it < iters && n; it++) {
    const A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
    for (const o of obs) {
      let pr = 0; const d = [];
      for (const [e, s] of o.terms) { pr += Math.log(sig(s * z[e])); d.push([e, s * (1 - sig(s * z[e]))]); }
      const r = pr - o.y;
      for (const [i, di] of d) { b[i] -= o.w * r * di; for (const [j, dj] of d) A[i][j] += o.w * di * dj; }
    }
    for (let i = 0; i < n; i++) A[i][i] += lambda * (1 + A[i][i]);
    // solve A δ = b (Gaussian elimination, partial pivot)
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const dlt = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) { let v = M[r][n]; for (let k = r + 1; k < n; k++) v -= M[r][k] * dlt[k]; dlt[r] = v / M[r][r]; }
    const z2 = z.map((v, i) => Math.max(-8, Math.min(8, v + dlt[i])));
    const l2 = loss(z2);
    if (l2 < cur) { z.set(z2); const done = cur - l2 < 1e-12 * (1 + cur); cur = l2; lambda = Math.max(1e-9, lambda / 10); if (done) break; }
    else lambda *= 10;
  }
  const out = {};
  for (const [k, i] of evIdx) { const p = sig(z[i]); out[k] = { [evOut[i][0]]: p, [evOut[i][1]]: 1 - p }; }
  return out;
}
