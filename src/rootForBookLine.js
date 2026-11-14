// Sportsbook line vs the Kalshi contract a Combo Lock actually stores.
// Promo Builder snaps a bet onto the nearest Kalshi strike (Wright St −1.5 → "wins by over 2.5").
// The parlay title keeps the sportsbook wording; the leg ticker is the proxy. The needle prices the
// sportsbook ticket on the line that was bet, and any Kalshi hedge on the proxy contract.

const MINUS = /[\u2212\u2013\u2014-]/;

export function parseSignedLine(text) {
  const m = new RegExp(`^(.*?)\\s*(\\+|${MINUS.source})\\s*([\\d.]+)\\s*$`).exec(String(text || "").trim());
  if (!m) return null;
  const line = Number(m[3]);
  if (!Number.isFinite(line)) return null;
  return { team: m[1].trim(), sign: m[2] === "+" ? "+" : "-", line };
}

export function parseTotalLine(text) {
  const m = /(?:^|\s)(over|under|[ou])\s*([\d.]+)\s*$/i.exec(String(text || "").trim());
  if (!m) return null;
  const line = Number(m[2]);
  if (!Number.isFinite(line)) return null;
  const raw = m[1].toLowerCase();
  return { ou: raw === "u" || raw === "under" ? "under" : "over", line };
}

function normName(s) {
  return String(s || "").toLowerCase().replace(/\bst\.?\b/g, "st").replace(/[^a-z0-9]+/g, " ").trim();
}

function teamOverlap(a, b) {
  const x = normName(a).split(" ").filter((w) => w.length > 2);
  const y = new Set(normName(b).split(" ").filter((w) => w.length > 2));
  if (!x.length || !y.size) return false;
  return x.some((w) => y.has(w));
}

/** Kalshi spread/total ticker → the strike it is a proxy for. */
export function parseLadderTicker(ticker) {
  const t = String(ticker || "").toUpperCase();
  const sp = /^(KX[A-Z]+SPREAD)-(\d{2}[A-Z]{3}\d{2}[A-Z]+)-([A-Z]+?)(\d+)$/.exec(t);
  if (sp) {
    const k = Number(sp[4]);
    return { kind: "spread", ticker: t, event: `${sp[1]}-${sp[2]}`, team: sp[3], k, line: k - 0.5 };
  }
  const tot = /^(KX[A-Z]+TOTAL)-(\d{2}[A-Z]{3}\d{2}[A-Z]+)-(\d+)$/.exec(t);
  if (tot) {
    const strike = Number(tot[3]);
    return { kind: "total", ticker: t, event: `${tot[1]}-${tot[2]}`, strike, k: strike, line: strike - 0.5 };
  }
  return null;
}

function proxyOf(leg) {
  const fromTicker = parseLadderTicker(leg && leg.ticker);
  if (fromTicker && fromTicker.kind === "total") {
    const lab = parseTotalLine(leg.label);
    const ou = lab ? lab.ou : "over";
    return { kind: "total", ou, line: lab ? lab.line : fromTicker.line };
  }
  if (fromTicker && fromTicker.kind === "spread") {
    const lab = parseSignedLine(leg.label);
    if (lab) return { kind: "spread", sign: lab.sign, line: lab.line, team: lab.team };
    return { kind: "spread", sign: String(leg.side || "yes").toLowerCase() === "no" ? "+" : "-", line: fromTicker.line, team: fromTicker.team };
  }
  return null;
}

function bookText(parlay, leg, index) {
  if (leg && leg.bookLabel) return String(leg.bookLabel);
  const parts = String((parlay && parlay.label) || "").split(/\s+\+\s+/).map((s) => s.trim()).filter(Boolean);
  const legs = (parlay && parlay.legs) || [];
  if (parts.length === legs.length && index >= 0 && index < parts.length) return parts[index];
  return "";
}

/** The sportsbook line when it is a different number from the Kalshi leg. Null when they match (or it isn't a spread/total). */
export function bookLineForLeg(parlay, leg, index) {
  const proxy = proxyOf(leg);
  if (!proxy) return null;
  const text = bookText(parlay, leg, index);
  if (!text) return null;
  if (proxy.kind === "total") {
    const b = parseTotalLine(text);
    if (!b || b.ou !== proxy.ou) return null;
    if (Math.abs(b.line - proxy.line) < 1e-6) return null;
    return { kind: "total", ou: b.ou, line: b.line, proxyLine: proxy.line };
  }
  const b = parseSignedLine(text);
  if (!b || b.sign !== proxy.sign) return null;
  if (!teamOverlap(b.team, proxy.team)) return null;
  if (Math.abs(b.line - proxy.line) < 1e-6) return null;
  return { kind: "spread", sign: b.sign, line: b.line, proxyLine: proxy.line, team: proxy.team };
}

/** Events whose Kalshi ladder we need because a stored leg is only a proxy for the sportsbook line. */
export function lineGapEvents(parlays) {
  const s = new Set();
  for (const p of parlays || []) {
    (p.legs || []).forEach((leg, i) => {
      if (!bookLineForLeg(p, leg, i)) return;
      const t = String(leg.ticker || "").toUpperCase();
      const ev = t.split("-").slice(0, 2).join("-");
      if (ev) s.add(ev);
    });
  }
  return [...s];
}

/** Stamp the sportsbook wording onto a new lock's legs so a later title edit doesn't drop the real line. */
export function withBookLabels(legs, label) {
  const parts = String(label || "").split(/\s+\+\s+/).map((s) => s.trim());
  if (!Array.isArray(legs) || parts.length !== legs.length) return legs;
  return legs.map((leg, i) => {
    const book = parts[i];
    if (!book || book === leg.label) return leg;
    return { ...leg, bookLabel: book };
  });
}

/** Favorite −L covers when the margin is greater than L (a whole-number line pushes, a .5 line doesn't). */
export function spreadCoverK(line) {
  return Math.floor(Number(line)) + 1;
}

/** Over L covers when the total is greater than L. */
export function totalCoverK(line) {
  return Math.floor(Number(line)) + 1;
}

/** Linear interpolation of a cover probability between adjacent strikes. Exact strike wins. Null when the line isn't between two priced strikes. */
export function interpLine(points, line) {
  const seen = new Map();
  for (const x of points || []) {
    const lineN = Number(x && x.line);
    const p = Number(x && x.p);
    if (!Number.isFinite(lineN) || !(p > 0 && p < 1)) continue;
    seen.set(lineN, p);
  }
  const arr = [...seen.entries()].map(([ln, p]) => ({ line: ln, p })).sort((a, b) => a.line - b.line);
  const want = Number(line);
  if (!Number.isFinite(want) || !arr.length) return null;
  for (const x of arr) if (Math.abs(x.line - want) < 1e-6) return x.p;
  let lo = null;
  let hi = null;
  for (const x of arr) {
    if (x.line < want - 1e-9) lo = x;
    else if (x.line > want + 1e-9 && !hi) hi = x;
  }
  if (!lo || !hi) return null;
  const t = (want - lo.line) / (hi.line - lo.line);
  const p = lo.p + (hi.p - lo.p) * t;
  return p > 0 && p < 1 ? p : null;
}

/** Mutually exclusive margin bands. `pAt(k)` is P(margin >= k), non-increasing after a clamp. Includes k = 1 (the win). */
export function marginBands(team, opp, pAt, cuts) {
  const ks = [...new Set([1, ...(cuts || []).map(Number)])].filter((k) => k >= 1 && Number.isFinite(k)).sort((a, b) => a - b);
  const p = {};
  for (const k of ks) {
    const v = pAt(k);
    if (v == null || !Number.isFinite(v)) return null;
    p[k] = Math.min(1, Math.max(0, v));
  }
  for (let i = 1; i < ks.length; i++) p[ks[i]] = Math.min(p[ks[i]], p[ks[i - 1]]);
  const desc = [...ks].sort((a, b) => b - a);
  const probs = {};
  const bands = [];
  for (let i = 0; i < desc.length; i++) {
    const lo = desc[i];
    const hi = i === 0 ? null : desc[i - 1];
    const key = hi == null ? `${team}>=${lo}` : `${team}<${hi}>=${lo}`;
    probs[key] = hi == null ? p[lo] : p[lo] - p[hi];
    bands.push({ key, lo, hi, team });
  }
  probs[opp] = 1 - p[1];
  return { probs, bands, opp, team };
}

export function spreadAllowed(sign, line, bands, opp) {
  const k = spreadCoverK(line);
  if (sign === "-") return bands.filter((b) => b.lo >= k).map((b) => b.key);
  return [...bands.filter((b) => b.lo < k).map((b) => b.key), opp];
}

/** Totals: bands of P(total >= n) plus everything under the lowest cut. */
export function totalBands(pGe, cuts) {
  const ns = [...new Set((cuts || []).map(Number))].filter((n) => n >= 1 && Number.isFinite(n)).sort((a, b) => a - b);
  if (!ns.length) return null;
  const p = {};
  for (const n of ns) {
    const v = pGe(n);
    if (v == null || !Number.isFinite(v)) return null;
    p[n] = Math.min(1, Math.max(0, v));
  }
  for (let i = 1; i < ns.length; i++) p[ns[i]] = Math.min(p[ns[i]], p[ns[i - 1]]);
  const desc = [...ns].sort((a, b) => b - a);
  const probs = {};
  const bands = [];
  for (let i = 0; i < desc.length; i++) {
    const lo = desc[i];
    const hi = i === 0 ? null : desc[i - 1];
    const key = hi == null ? `T>=${lo}` : `T<${hi}>=${lo}`;
    probs[key] = hi == null ? p[lo] : p[lo] - p[hi];
    bands.push({ key, lo, hi });
  }
  const floor = ns[0];
  const under = `T<${floor}`;
  probs[under] = 1 - p[floor];
  bands.push({ key: under, lo: null, hi: floor });
  return { probs, bands };
}

export function totalAllowed(ou, line, bands) {
  const k = totalCoverK(line);
  if (ou === "over") return bands.filter((b) => b.lo != null && b.lo >= k).map((b) => b.key);
  return bands.filter((b) => !(b.lo != null && b.lo >= k)).map((b) => b.key);
}

function fairP(fairs, key) {
  const p = fairs && fairs[key] && Number(fairs[key].p);
  return p > 0 && p < 1 ? p : null;
}

function parseBandKey(key) {
  const mid = /^([A-Z]+)<(\d+)>=(\d+)$/.exec(key);
  if (mid) return { team: mid[1], hi: Number(mid[2]), lo: Number(mid[3]) };
  const top = /^([A-Z]+)>=(\d+)$/.exec(key);
  if (top) return { team: top[1], lo: Number(top[2]), hi: null };
  return null;
}

/** Rebuild a fine spread distribution from saved kickoff fairs (moneyline + any saved strikes). Null if a cut can't be priced. */
export function fineSpreadFromFairs(ev, dist, fairs) {
  const keys = Object.keys(dist || {}).filter((k) => k !== "__neither");
  if (!keys.some((k) => /<\d+>=\d+/.test(k))) return null;
  const bands = keys.map(parseBandKey).filter(Boolean);
  if (!bands.length) return null;
  const team = bands[0].team;
  const opp = keys.find((k) => k !== team && !k.startsWith(team));
  if (!opp) return null;
  const cuts = [...new Set(bands.map((b) => b.lo))];
  const points = [];
  const pMl = fairP(fairs, `${ev}-${team}:yes`);
  if (pMl != null) points.push({ line: 0.5, p: pMl });
  for (const k of cuts) {
    if (k === 1) continue;
    const p = fairP(fairs, `${String(ev).replace(/GAME-/, "SPREAD-")}-${team}${k}:yes`);
    if (p != null) points.push({ line: k - 0.5, p });
  }
  const built = marginBands(team, opp, (k) => interpLine(points, k - 0.5), cuts);
  return built && built.probs;
}
