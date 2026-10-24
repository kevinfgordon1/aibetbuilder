// Pure helpers for the owner-only Sniper dashboard (api/sniper-dashboard.js + SniperDashboard.jsx).
// Mirrors the live sniper (fly/sniper.toml). Keep in sync when caps change.
export const CAPS = { totalOpen: 10000, longDatedOpen: 5000, perGame: 1500, perLeg: 750, dailyLoss: 10000, dailyNewRisk: 10000, perQuoteRisk: 200, minEdge: 0.04, depthGame: 2000, depthTd: 1000 };

export function americanFromProb(p) {
  const x = Number(p);
  if (!(x > 0 && x < 1)) return null;
  return x >= 0.5 ? -Math.round((x / (1 - x)) * 100) : Math.round(((1 - x) / x) * 100);
}
export function fmtAmerican(a) { return a == null || !Number.isFinite(Number(a)) ? "—" : (a > 0 ? `+${a}` : `${a}`); }
export function fmtUsd(x) { const n = Number(x) || 0; return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`; }

export function etDayKey(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null;
}
export function etHourKey(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const h = d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });
  return `${day} ${String(h).padStart(2, "0")}:00`;
}
const gameOf = (leg) => { const p = String(leg || "").split(":")[0].split("-"); return p.length >= 3 ? p[1] : p[0]; };

// Ledger status → display state
export function rowState(r) {
  if (r.phase === "settled") return Number(r.realized_pnl) > 0 ? "won" : Number(r.realized_pnl) < 0 ? "lost" : "void";
  if (r.status === "open") return r.phase === "filled" ? "filled" : r.phase === "dry_run" ? "would quote" : r.phase || "open";
  return r.phase || r.status || "?";
}

// rows: sniper_ledger rows for one book (dry or live); todayKey = ET day.
export function summarizeLedger(rows, todayKey) {
  let open = 0; const perGame = new Map(); const filledGame = new Map(); let dayRisk = 0; let dayPnl = 0; let running = 0;
  const daily = new Map();
  for (const r of rows || []) {
    const risk = Number(r.risk) || 0;
    if (r.status === "open") {
      open += risk;
      for (const g of (r.games && r.games.length ? r.games : (r.legs || []).map(gameOf))) perGame.set(g, (perGame.get(g) || 0) + risk);
    }
    // Filled-only exposure: real live fills (dry_run=false, filled_cost>0) not yet settled.
    const fc = Number(r.filled_cost) || 0;
    if (r.dry_run === false && fc > 0 && r.phase !== "settled" && r.realized_pnl == null) {
      const fr = fc + (Number(r.filled_fee) || 0);
      for (const g of (r.games && r.games.length ? r.games : (r.legs || []).map(gameOf))) filledGame.set(g, (filledGame.get(g) || 0) + fr);
    }
    if (etDayKey(r.created_at) === todayKey && r.phase !== "cancelled" && r.phase !== "failed") dayRisk += risk;
    if (r.phase === "settled" && r.realized_pnl != null) {
      const p = Number(r.realized_pnl) || 0; running += p;
      const k = etDayKey(r.settled_at); if (k === todayKey) dayPnl += p;
      const d = daily.get(k) || { day: k, pnl: 0, wins: 0, losses: 0, settled: 0 };
      d.pnl += p; d.settled += 1; if (p > 0) d.wins += 1; else if (p < 0) d.losses += 1; daily.set(k, d);
    }
  }
  const games = [...perGame.entries()].map(([game, risk]) => ({ game, risk })).sort((a, b) => b.risk - a.risk);
  const filledGames = [...filledGame.entries()].map(([game, risk]) => ({ game, risk })).sort((a, b) => b.risk - a.risk);
  const days = [...daily.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  let cum = 0; for (const d of days) { cum += d.pnl; d.running = cum; }
  return { open, games, filledGames, maxGame: games[0] || null, dayRisk, dayLoss: Math.max(0, -dayPnl), dayPnl, runningPnl: running, days };
}

export function quoteRow(r) {
  const fair = Number(r.fair_yes); const q = Number(r.quote_yes);
  return {
    rfqId: r.rfq_id, createdAt: r.created_at, state: rowState(r), legs: r.legs || [], games: r.games || [],
    fairAmerican: r.fair_american != null ? Number(r.fair_american) : americanFromProb(fair),
    quoteYes: q > 0 && q < 1 ? q : null,
    quoteAmerican: r.quote_american != null ? Number(r.quote_american) : americanFromProb(q),
    edge: r.roi != null ? Number(r.roi) : null, risk: Number(r.risk) || 0, contracts: Number(r.contracts) || 0,
    ev: r.ev != null ? Number(r.ev) : null,
    filledContracts: Number(r.filled_contracts) || 0, filledCost: Number(r.filled_cost) || 0, filledFee: Number(r.filled_fee) || 0,
    result: r.market_result || null, pnl: r.realized_pnl != null ? Number(r.realized_pnl) : null,
    pulledReason: r.close_reason || null, dryRun: !!r.dry_run,
  };
}

// summaries: sniper_decisions rows with action='summary' (details.counts.skips per minute)
export function skipsByHour(summaries, top = 8) {
  const hours = new Map(); const totals = new Map();
  for (const s of summaries || []) {
    const k = etHourKey(s.created_at); const sk = s.details && s.details.counts && s.details.counts.skips;
    if (!k || !sk) continue;
    const h = hours.get(k) || {}; for (const [r, n] of Object.entries(sk)) { h[r] = (h[r] || 0) + Number(n || 0); totals.set(r, (totals.get(r) || 0) + Number(n || 0)); }
    hours.set(k, h);
  }
  const reasons = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([r]) => r);
  return { reasons, hours: [...hours.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([hour, h]) => ({ hour, ...Object.fromEntries(reasons.map((r) => [r, h[r] || 0])) })) };
}

export function statusFrom(summary, nowMs) {
  if (!summary) return { mode: "unknown", halted: false, lastSummaryAt: null, stale: true, kickoffs: null };
  const d = summary.details || {};
  const at = Date.parse(summary.created_at);
  return {
    mode: d.mode || "unknown", halted: !!d.halted, lastSummaryAt: summary.created_at,
    stale: !(nowMs - at < 3 * 60 * 1000), kickoffs: d.kickoffs || null,
    rfqs: d.counts ? d.counts.rfqs : null, wouldQuote: d.counts ? d.counts.quotes : null,
  };
}

// Kalshi taker fee on combo series (KXMVECROSSCATEGORY / …0, fee_type quadratic*, multiplier 1):
// ceil_to_cent(0.07 × C × P × (1−P)), charged to the buyer on top of C × P.
export const KALSHI_TAKER_RATE = 0.07;
export function takerFee(yesProb, contracts) {
  const p = Number(yesProb), c = Number(contracts);
  if (!(p > 0 && p < 1) || !(c > 0)) return 0;
  return Math.ceil(Math.round(KALSHI_TAKER_RATE * c * p * (1 - p) * 1e6) / 1e4) / 100;
}
// Buyer's effective American odds after the taker fee.
export function takerSeesAmerican(yesProb, contracts) {
  const p = Number(yesProb), c = Number(contracts);
  if (!(p > 0 && p < 1) || !(c > 0)) return americanFromProb(p);
  return americanFromProb((c * p + takerFee(p, c)) / c);
}
