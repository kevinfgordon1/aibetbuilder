// Display helpers for the love23 loss-rebate tab. American odds throughout.

export const LOVE23_REFRESH_MS = 45 * 1000;

export const FLAG_TEXT = Object.freeze({
  stale_odds: "Odds cache is old (Pinnacle may lag love23)",
  line_moved: "love23 line differs from Pinnacle main (likely moved first)",
  unconfirmed: "Pinnacle and prediction markets disagree; used the safer fair",
  pm_fair_only: "No Pinnacle at this line; prediction-market fair",
  no_pm_confirm: "No prediction-market price to confirm",
  thin_hedge: "Top-of-book hedge depth below what the lock needs",
  depth_unknown: "Hedge depth unknown; check depth",
  no_hedge: "No prediction-market hedge at this line",
});

export const DEFAULT_SETTINGS = Object.freeze({
  weeks: 8,        // weeks left in the promo, incl. this one
  bpw: 30,         // planned hedged love23 bets per week
  drift: -0.02,    // love23 EV per planned bet (fraction of stake)
  sd: 1,           // per-bet SD x max bet
  cap: 10000,      // weekly loss discounted at 50% (unconfirmed)
  credit: 5000,    // weekly loss stop (love23 credit); 0 = none
  maxBet: 500,
  confirm: 0.015,
  carry: "",       // override carry-forward balance (blank = ledger)
  weekNet: "",     // override love23 net so far this week (blank = ledger)
  flagged: false,
});

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtAmerican(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return "—";
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

export function fmtMoney(n, { sign = false } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const s = v < 0 ? "−" : (sign && v > 0 ? "+" : "");
  return `${s}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;
}

const MARKET_LABEL = { h2h: "ML", spreads: "Spread", totals: "Total", team_totals: "Team total" };

function title(s) {
  return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "Minnesota Vikings +3 (alt)", "Over 46", "Detroit Lions ML" */
export function selectionLabel(p) {
  if (!p) return "";
  const alt = p.kind === "alt" ? " (alt)" : "";
  if (p.market === "h2h") return `${title(p.team)} ML`;
  if (p.market === "spreads") return `${title(p.team)} ${p.point > 0 ? "+" : ""}${p.point}${alt}`;
  if (p.market === "totals") return `${p.side === "over" ? "Over" : "Under"} ${p.point}${alt}`;
  if (p.market === "team_totals") return `${title(p.team)} TT ${p.side === "over" ? "o" : "u"}${p.point}`;
  return `${MARKET_LABEL[p.market] || p.market} ${p.side} ${p.point ?? ""}`.trim();
}

export function hedgeLabel(h) {
  if (!h) return "—";
  const pt = h.point != null && h.point !== "" ? ` ${Number(h.point) > 0 ? "+" : ""}${h.point}` : "";
  return `${h.venueLabel}: ${h.outcome || ""}${pt} ${fmtAmerican(h.american)}`.replace(/\s+/g, " ").trim();
}

export function gameLabel(game) {
  return String(game || "").split(" @ ").map(title).join(" @ ");
}

/** Query string for GET /api/love23-rebate?view=picks from UI settings. */
export function picksQuery(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const q = new URLSearchParams({ view: "picks" });
  for (const k of ["weeks", "bpw", "drift", "sd", "cap", "confirm"]) q.set(k, String(s[k]));
  q.set("maxBet", String(Math.min(500, Number(s.maxBet) || 500)));
  for (const k of ["credit", "carry", "weekNet"]) {
    if (s[k] !== "" && s[k] != null && Number.isFinite(Number(s[k]))) q.set(k, String(Number(s[k])));
  }
  if (s.flagged) q.set("flagged", "1");
  return q.toString();
}

/** "Tue Oct 27 – Tue Nov 3" for a week starting YYYY-MM-DD. */
export function weekLabel(start, end) {
  const f = (iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()]} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
  };
  return end ? `${f(start)} – ${f(end)}` : f(start);
}

/** One-line description of a week's settlement. */
export function settlementText(st) {
  if (!st) return "—";
  if (st.net >= 0) return st.net === 0 ? "Even week" : `Win ${fmtMoney(st.net)} kept; carry → ${fmtMoney(st.carryAfter)}`;
  const parts = [];
  if (st.absorbed > 0) parts.push(`${fmtMoney(st.absorbed)} from carry at full`);
  if (st.rebatable > 0) parts.push(`${fmtMoney(st.rebatable)} at 50%`);
  const past = -st.net - st.absorbed - st.rebatable;
  if (past > 0.005) parts.push(`${fmtMoney(past)} past the cap at full`);
  return `Owe ${fmtMoney(st.owed)} (${parts.join(", ")}); saved ${fmtMoney(st.rebate)}`;
}
