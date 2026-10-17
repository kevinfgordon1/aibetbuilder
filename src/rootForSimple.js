// Plain-English helpers for the Simple view of "What to root for".
import { NEITHER } from "./rootForEngine.js";

// American odds from a probability (no rounding to the nearest 5).
export function americanFromP(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
}
export function fmtAmerican(a) {
  if (a == null || !Number.isFinite(a)) return "—";
  const r = Math.round(a);
  return (r > 0 ? "+" : "") + r;
}

// Human label for one atomic outcome of an event, e.g. "KC Chiefs win", "PIT Steelers win by 3+".
export function outcomeLabel(model, ev, outcome) {
  const names = (model && model.teamNames) || {};
  const m = /^(.+?)(>=|<)(\d+(?:\.\d+)?)$/.exec(outcome);
  if (m) {
    const nm = names[`${ev}:${m[1]}`] || m[1];
    return m[2] === ">=" ? `${nm} win by ${m[3]}+` : `${nm} win by less than ${m[3]}`;
  }
  if (outcome === "yes" || outcome === "no") {
    const nm = names[`${ev}:yes`] || ev;
    return `${nm}: ${outcome.toUpperCase()}`;
  }
  return `${names[`${ev}:${outcome}`] || outcome} win`;
}

// The few results that wipe out the most locks. Greedy: at each step pick the game result
// (weighted toward likely ones) that kills the most still-alive locks that would lose money.
export function nightmareKeys(model, { max = 5, minP = 0.15 } = {}) {
  if (!model || !model.positions || !model.probs) return [];
  let alive = model.positions.slice();
  const used = new Set(); const out = [];
  while (alive.length && out.length < max) {
    let best = null;
    for (const [ev, dist] of Object.entries(model.probs)) {
      if (used.has(ev)) continue;
      for (const [o, p] of Object.entries(dist)) {
        if (o === NEITHER || !(p >= minP)) continue;
        let kills = 0, money = 0;
        for (const pos of alive) if (pos.legs.some((l) => l.event === ev && !l.allowed.includes(o))) { kills++; money += pos.hit - pos.miss; }
        if (!kills) continue;
        const score = money * p;
        if (!best || score > best.score) best = { ev, o, p, kills, money, score };
      }
    }
    if (!best) break;
    used.add(best.ev);
    const killedTotal = model.positions.filter((pos) => pos.legs.some((l) => l.event === best.ev && !l.allowed.includes(best.o))).length;
    out.push({ event: best.ev, outcome: best.o, p: best.p, american: americanFromP(best.p), label: outcomeLabel(model, best.ev, best.o), kills: killedTotal });
    alive = alive.filter((pos) => !pos.legs.some((l) => l.event === best.ev && !l.allowed.includes(best.o)));
  }
  return out;
}

const money0 = (n) => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
export const sMoney = (n) => (n == null || !Number.isFinite(n) ? "—" : (n > 0 ? "+" : n < 0 ? "" : "") + money0(n));

// "about 1 in 2" style phrase for a chance.
export function chanceWords(p) {
  if (!(p >= 0)) return "";
  if (p >= 0.97) return "almost certain";
  if (p >= 0.6) return `better than even (about ${Math.round(p * 10)} in 10)`;
  if (p >= 0.4) return "about a coin flip";
  if (p >= 0.1) return `about 1 in ${Math.round(1 / p)}`;
  if (p > 0 && p < 1e-6) return "less than 1 in a million";
  if (p > 0) return `about 1 in ${Math.round(1 / p).toLocaleString("en-US")}`;
  return "no chance";
}

// One-sentence headline.
export function summarySentence(d) {
  if (!d) return "";
  const top = topByGain(d, 1)[0] || (d.top && d.top[0]);
  const ev = Number(d.ev);
  const head = ev >= 0 ? `You're expected to make about ${sMoney(ev)}.` : `You're expected to lose about ${money0(ev)}.`;
  return top ? `${head} Biggest game: ${top.game} (root for ${top.name}).` : head;
}

// Typical range from the histogram: middle 80% of simulated weekends.
export function typicalRange(hist) {
  if (!hist || !hist.bins || !hist.bins.length) return null;
  const q = (t) => { let c = 0; for (const b of hist.bins) { if (c + b.p >= t) return b.from + (b.to - b.from) * ((t - c) / (b.p || 1)); c += b.p; } return hist.bins[hist.bins.length - 1].to; };
  return { lo: q(0.1), hi: q(0.9) };
}

// Rank outcomes by how much a win ADDS to expected profit: E[P | wins] − E[P].
// ifHit comes from the joint (correlated) engine, so this equals swing × (1 − p) without assuming independence.
export function topByGain(d, n = 5) {
  if (!d) return [];
  const ev = Number(d.ev) || 0;
  const all = (d.perEvent || []).flatMap((e) => e.outcomes || []);
  const src = all.length ? all : d.top || [];
  return src.filter((o) => o && Number.isFinite(o.ifHit) && o.name)
    .map((o) => ({ ...o, gain: o.ifHit - ev }))
    .filter((o) => o.gain > 0.5)
    .sort((a, b) => b.gain - a.gain).slice(0, n);
}

// Most damaging results: E[P | result] − E[P] (most negative first), at most one per game, from the joint engine.
export function topByDrop(d, n = 5) {
  if (!d) return [];
  const ev = Number(d.ev) || 0; const seen = new Set();
  return (d.perEvent || []).flatMap((e) => e.outcomes || [])
    .filter((o) => o && Number.isFinite(o.ifHit) && o.name)
    .map((o) => ({ ...o, drop: o.ifHit - ev, label: /\bby\b/.test(o.name) ? `${o.name.replace(/^(\S+\s+\S+)\s+by/, "$1 win by")}` : `${o.name} win` }))
    .map((o) => ({ ...o, label: o.label.replace(/win by under (\d+)\b/, (m, n) => (+n >= 3 ? `win by 1–${+n - 1}` : m)) }))
    .filter((o) => o.drop < -0.5)
    .sort((a, b) => a.drop - b.drop)
    .filter((o) => (seen.has(o.event) ? false : (seen.add(o.event), true)))
    .slice(0, n);
}

// ---- P&L curve helpers ----
export function cdfAt(hist, x) {
  if (!hist || !hist.bins) return 0; let c = 0;
  for (const b of hist.bins) { if (x >= b.to) c += b.p; else if (x > b.from) c += b.p * ((x - b.from) / (b.to - b.from || 1)); }
  return Math.min(1, c);
}
export function quantileOf(hist, t) {
  if (!hist || !hist.bins || !hist.bins.length) return 0; let c = 0;
  for (const b of hist.bins) { if (c + b.p >= t) return b.from + (b.to - b.from) * ((t - c) / (b.p || 1)); c += b.p; }
  return hist.bins[hist.bins.length - 1].to;
}
export function niceTicks(lo, hi, target = 5) {
  const span = hi - lo; if (!(span > 0)) return [lo];
  const raw = span / target; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v) || 0);
  return out;
}
export const shortMoney = (n) => { const a = Math.abs(n); const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 || a % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(a)}`; return (n < 0 ? "−" : n > 0 ? "+" : "") + s; };

// Smooth density from histogram masses (Gaussian kernel on bin centers). The all-lose worst case is a
// discrete lump, so it is pulled out as a spike instead of being smeared into the curve.
export function curveModel(hist, { worst = null, cap = 0.99, points = 160 } = {}) {
  if (!hist || !hist.bins || !hist.bins.length) return null;
  const bins = hist.bins.map((b) => ({ ...b }));
  let spike = null;
  if (worst && worst.p > 0.005 && worst.pnl >= bins[0].from - 1 && worst.pnl <= bins[0].to) {
    const p = Math.min(worst.p, bins[0].p); spike = { x: worst.pnl, p }; bins[0].p -= p;
  }
  const xMin = hist.bins[0].from; const xMax = Math.max(quantileOf(hist, cap), xMin + 1);
  const w = (bins[0].to - bins[0].from) || 1; const sig = w * 0.9;
  const xs = Array.from({ length: points }, (_, i) => xMin + (i / (points - 1)) * (xMax - xMin));
  const ys = xs.map((x) => bins.reduce((a, b) => { const c = (b.from + b.to) / 2; const z = (x - c) / sig; return a + b.p * Math.exp(-0.5 * z * z); }, 0) / (sig * Math.sqrt(2 * Math.PI)));
  return { xs, ys, xMin, xMax, spike, beyond: Math.max(0, 1 - cdfAt(hist, xMax)) };
}

// One plain sentence describing the shape of the weekend.
export function curveCaption(pLoss, ev) {
  if (!Number.isFinite(pLoss) || !Number.isFinite(ev)) return "";
  if (ev < 0) return pLoss > 0.5 ? "Expect to lose on average: losing weekends are more common, and the wins don't make up for them." : "You'll win more often than not, but the losses are bigger, so you expect to lose on average.";
  if (pLoss > 0.5) return "You'll lose a little more often than not, but the big wins more than make up for it.";
  return "You'll win more often than not, and you expect to come out ahead.";
}

// Average loss when you lose and average win when you win (from the sim). The win average is backed out of
// the exact expected profit so that pLoss·avgLoss + pWin·avgWin = EV exactly (the histogram folds its far tail).
export function lossWinSplit(hist, ev, pLoss, worst = null) {
  if (!hist || !hist.bins || !hist.bins.length || !Number.isFinite(ev)) return null;
  let mass = 0, sum = 0;
  const bins = hist.bins.map((b) => ({ ...b }));
  if (worst && worst.p > 0 && worst.pnl < 0 && worst.pnl >= bins[0].from - 1 && worst.pnl <= bins[0].to) {
    const p = Math.min(worst.p, bins[0].p); mass += p; sum += p * worst.pnl; bins[0].p -= p;
  }
  for (const b of bins) {
    if (b.from >= 0 || !(b.p > 0)) continue;
    const hi = Math.min(0, b.to); const f = (hi - b.from) / (b.to - b.from || 1);
    mass += b.p * f; sum += b.p * f * (b.from + hi) / 2;
  }
  const pL = Number.isFinite(pLoss) ? pLoss : mass; const pW = 1 - pL;
  const avgLoss = mass > 0 ? sum / mass : 0;
  const avgWin = pW > 0 ? (ev - pL * avgLoss) / pW : 0;
  return { pLoss: pL, pWin: pW, avgLoss, avgWin, lossArea: pL * avgLoss, winArea: pW * avgWin };
}
