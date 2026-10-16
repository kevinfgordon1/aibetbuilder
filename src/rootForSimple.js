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
