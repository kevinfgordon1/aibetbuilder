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
  horizon: 100,
  drift: -0.02,
  sd: 1,
  maxBet: 500,
  confirm: 0.015,
  n: "",
  flagged: false,
});

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
  q.set("horizon", String(s.horizon));
  q.set("drift", String(s.drift));
  q.set("sd", String(s.sd));
  q.set("maxBet", String(Math.min(500, Number(s.maxBet) || 500)));
  q.set("confirm", String(s.confirm));
  if (s.n !== "" && s.n != null && Number.isFinite(Number(s.n))) q.set("n", String(Number(s.n)));
  if (s.flagged) q.set("flagged", "1");
  return q.toString();
}

/** Progress bar copy toward the $10k loss trigger. */
export function triggerProgress(ledger, trigger = 10000) {
  if (!ledger) return { pct: 0, text: "—" };
  const loss = Number(ledger.lossTowardTrigger) || 0;
  const up = Number(ledger.rolledForwardProfit) || 0;
  if (up > 0) return { pct: 0, text: `Up ${fmtMoney(up)} (rolled forward): ${fmtMoney(up + trigger)} of losses to the next rebate` };
  return { pct: Math.min(1, loss / trigger), text: `${fmtMoney(loss)} of ${fmtMoney(trigger)} toward the next ${fmtMoney(trigger / 2)} rebate` };
}
