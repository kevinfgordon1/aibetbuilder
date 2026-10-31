// Sniper per-leg league tags + League filter, and the needle's fill-time (pregame) view. Pure, node-testable.
export const LEAGUES = [[/^KXNCAAF/, "NCAAF"], [/^KXNFL/, "NFL"], [/^KXNCAA(MB|B)/, "NCAAB"], [/^KXNBA/, "NBA"], [/^KXNHL/, "NHL"], [/^KXMLB/, "MLB"], [/^KXUFC/, "UFC"]];
export const leagueOfLeg = (t) => { const s = String(t || "").toUpperCase(); for (const [re, n] of LEAGUES) if (re.test(s)) return n; return (s.replace(/^KX/, "").match(/^[A-Z]+?(?=GAME|TD|SPREAD|TOTAL|-|$)/) || ["Other"])[0] || "Other"; };
export const leaguesOfFill = (r) => [...new Set((r.legs || []).map((l) => leagueOfLeg(l.ticker)))];
export const leagueOfFill = (r) => { const s = leaguesOfFill(r); return s.length > 1 ? "Mixed" : s[0] || "Other"; };
// League filter: a parlay matches a league if ANY leg is in it; "Mixed" = parlays whose legs span leagues.
export const fillMatchesLeague = (r, lg) => !lg || (lg === "Mixed" ? leaguesOfFill(r).length > 1 : leaguesOfFill(r).includes(lg));
// Needle charts center on the fill-time (pregame) expected profit, like the needle's pregame number. The sim is the
// live engine's outcome spread shifted by (pregame − now) (no re-sim, so no extra load): the shape is
// today's but the center is what we expected when each bet went in. Live EV stays as a secondary "Now" marker.
export function pregameView(root, baseline) {
  if (!root || !root.hist || !Number.isFinite(Number(baseline)) || !Number.isFinite(Number(root.ev))) return null;
  const add = Number(baseline) - Number(root.ev);
  const hist = { ...root.hist, bins: root.hist.bins.map((b) => ({ ...b, from: b.from + add, to: b.to + add })), tailFrom: root.hist.tailFrom != null ? root.hist.tailFrom + add : root.hist.tailFrom };
  const mv = (w) => (w && Number.isFinite(Number(w.pnl)) ? { ...w, pnl: Number(w.pnl) + add } : w);
  let pLoss = 0; for (const b of hist.bins) { if (b.to <= 0) pLoss += b.p; else if (b.from < 0) pLoss += b.p * (-b.from / (b.to - b.from || 1)); }
  return { ev: Number(baseline), now: Number(root.ev), hist, worst: mv(root.worst), best: mv(root.best), pProfit: 1 - pLoss };
}

