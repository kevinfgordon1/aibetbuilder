// EV drift tracker: how far each fill's expected value moved from bet placement to the close (each leg's
// fair snapshotted at/just before its kickoff by the sniper — table sniper_leg_close). Same inverse-bet fair
// (best opposing price across venues, fees in) as the quote. A fill has a close only when EVERY leg has one;
// otherwise it is "no close" (never invented).
const legType = (t) => { const s = String(t || "").toUpperCase(); return /TD/.test(s.split("-")[0]) ? "Player TD" : /SPREAD|TOTAL/.test(s) ? "Spread/total" : "ML"; };
export { legType };
const LG = [[/^KXNCAAF/, "NCAAF"], [/^KXNFL/, "NFL"], [/^KXNCAAB/, "NCAAB"], [/^KXNBA/, "NBA"], [/^KXNHL/, "NHL"], [/^KXMLB/, "MLB"], [/^KXUFC/, "UFC"]];
const leagueOf = (t) => { const s = String(t || "").toUpperCase(); for (const [re, n] of LG) if (re.test(s)) return n; return "Other"; };

// row: { risk, contracts, fairYes, ev (unhedged ok), legs: [{ ticker, fillFair, close: { fair } | null }] }
export function fillDrift(r) {
  const n = Number(r.contracts), risk = Number(r.risk), f0 = Number(r.fairYes);
  if (!(n > 0) || !(risk > 0) || !(f0 > 0 && f0 < 1)) return null;
  const legs = r.legs || [];
  if (!legs.length || legs.some((l) => !l.close || !(l.close.fair > 0 && l.close.fair < 1))) return { status: "no close", closed: legs.filter((l) => l.close && l.close.fair > 0).length, legs: legs.length };
  // Close combo fair: scale the fill fair by each leg's close/fill ratio when the fill leg fair is known.
  const allFill = legs.every((l) => l.fillFair > 0 && l.fillFair < 1);
  const fc = allFill ? legs.reduce((a, l) => a * (l.close.fair / l.fillFair), f0) : legs.reduce((a, l) => a * l.close.fair, 1);
  const evFill = n * (1 - f0) - risk, evClose = n * (1 - Math.min(Math.max(fc, 0), 1)) - risk;
  return { status: "closed", evFill, evClose, drift: evClose - evFill, driftPts: ((evClose - evFill) / risk) * 100, closeFair: fc };
}

const groupKeys = (r) => ({
  Sport: [...new Set((r.legs || []).map((l) => leagueOf(l.ticker)))].map((x, _, a) => (a.length > 1 ? "Mixed" : x)).slice(0, 1),
  "Leg type": [...new Set((r.legs || []).map((l) => legType(l.ticker)))],
  Legs: [String(Math.min((r.legs || []).length, 5)) + ((r.legs || []).length >= 5 ? "+" : "") + " legs"],
  "Fill venue": [...new Set((r.legs || []).map((l) => l.fillVenue || "unknown"))],
});

export function driftSummary(rows, { warnPts = -2, minN = 30, recentN = 30 } = {}) {
  const items = (rows || []).filter((r) => r.filled !== false).map((r) => ({ r, d: r.drift || fillDrift(r) }));
  const closed = items.filter((x) => x.d && x.d.status === "closed");
  const agg = (xs) => { const risk = xs.reduce((a, x) => a + Number(x.r.risk), 0); const usd = xs.reduce((a, x) => a + x.d.drift, 0); return { n: xs.length, usd, pts: xs.length ? xs.reduce((a, x) => a + x.d.driftPts, 0) / xs.length : null, wPts: risk > 0 ? (usd / risk) * 100 : null }; };
  const by = {};
  for (const x of closed) for (const [g, ks] of Object.entries(groupKeys(x.r))) for (const k of ks) ((by[g] = by[g] || {})[k] = by[g][k] || []).push(x);
  const breakdown = Object.fromEntries(Object.entries(by).map(([g, m]) => [g, Object.entries(m).map(([k, xs]) => ({ key: k, ...agg(xs) })).sort((a, b) => a.usd - b.usd)]));
  const recent = [...closed].sort((a, b) => (Date.parse(b.r.filledAt) || 0) - (Date.parse(a.r.filledAt) || 0)).slice(0, recentN);
  const rolling = agg(recent);
  const warn = recent.length >= minN && rolling.pts != null && rolling.pts < warnPts;
  return { total: agg(closed), noClose: items.filter((x) => x.d && x.d.status === "no close").length, fills: items.length, breakdown, rolling, warn, warnPts, minN };
}
