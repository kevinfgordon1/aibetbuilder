// Ticker → readable names for the root-for needle (pure, no React; moved from RootForSweat.jsx).
const NFL = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAC","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];
const splitGame = (g) => { for (const a of NFL) if (g.startsWith(a) && NFL.includes(g.slice(a.length))) return `${a}@${g.slice(a.length)}`; return g; };
const titleCase = (x) => x.charAt(0) + x.slice(1).toLowerCase();
export function tickerLabel(ev) {
  const m = String(ev).match(/^KX[A-Z]*?(TD|TOTAL|SPREAD|GAME)-\d{2}[A-Z]{3}\d{2}([A-Z]+)(?:-(.+))?$/); if (!m) return null;
  const [, kind, game, tail = ""] = m; const g = splitGame(game);
  if (kind === "TOTAL" && /^\d+$/.test(tail)) return `Over ${Number(tail) - 0.5} ${g}`;
  if (kind === "SPREAD") { const s = tail.match(/^([A-Z]+?)(\d+)$/); if (s) return `${s[1]} −${Number(s[2]) - 0.5} (${g})`; }
  if (kind === "TD") { const s = tail.match(/^([A-Z]+?)([A-Z])([A-Z]+)\d+-(\d+)$/); if (s) { const team = NFL.find((a) => game.includes(a) && tail.startsWith(a) && /^[A-Z]{2,}/.test(tail.slice(a.length))) || s[1];
    const rest = tail.slice(team.length).replace(/\d+-\d+$/, ""); return `${rest.charAt(0)}. ${titleCase(rest.slice(1))} (${team}) ${s[4]}+ TD`; } }
  return null;
}

// Plain market meaning of a binary side for the what-if line: totals → "Over 50.5" / "Under 50.5", spreads →
// "SF −3.5" / "Not SF −3.5", TD props → "K. Miller 1+ TD" / "No K. Miller TD". null when the ticker isn't recognized.
export function binarySideName(ev, side) {
  const m = String(ev).match(/^KX[A-Z]*?(TD|TOTAL|SPREAD)-\d{2}[A-Z]{3}\d{2}([A-Z]+)-(.+)$/); if (!m) return null;
  const [, kind, , tail] = m; const yes = side === "yes";
  if (kind === "TOTAL" && /^\d+$/.test(tail)) return `${yes ? "Over" : "Under"} ${Number(tail) - 0.5}`;
  if (kind === "SPREAD") { const x = tail.match(/^([A-Z]+?)(\d+)$/); if (x) return `${yes ? "" : "Not "}${x[1]} −${Number(x[2]) - 0.5}`; }
  if (kind === "TD") { const l = tickerLabel(ev); if (l) { const nm = l.replace(/\s*\([A-Z]+\)\s*/, " ").replace(/\s+\d+\+ TD$/, "").trim(); return yes ? l.replace(/\s*\([A-Z]+\)/, "") : `No ${nm} TD`; } }
  return null;
}

