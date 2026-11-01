// "What you're rooting for" list layout (Kevin, Nov 1 2026: "clean this up, it's not organized").
// Rows from liveLegMoves are grouped by status (Live now / Upcoming / Finished) and, inside a status, by game:
// one main row per game (the moneyline when it's held, else the biggest swing) with the game's spreads, totals and
// props collapsed under it. Live games sort by biggest swing still at stake, upcoming by kickoff, finished by size.
import { RESIDUAL_EVENT } from "./rootForSweat.js";

// Kalshi event tickers share the game code across markets: KXNFLGAME-26NOV01PHIWAS, KXNFLSPREAD-26NOV01PHIWAS,
// KXNFLTD-26NOV01PHIWAS-... → "26NOV01PHIWAS". Anything else is its own game.
export function gameKey(ev) {
  const s = String(ev || ""); if (s === RESIDUAL_EVENT) return s;
  const parts = s.split("-"); return parts.length >= 2 && parts[1] ? parts[1] : s;
}
const isMoneyline = (ev) => /^[A-Z0-9]*GAME$/i.test(String(ev).split("-")[0]);
const ms = (starts, ev) => { const t = Date.parse((starts || {})[ev] || ""); return Number.isFinite(t) ? t : Infinity; };

function group(rows, starts, score) {
  const by = new Map();
  for (const r of rows) { const k = gameKey(r.event); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  return [...by.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => score(b) - score(a) || a.event.localeCompare(b.event));
    const main = sorted.find((r) => isMoneyline(r.event)) || sorted[0];
    const more = sorted.filter((r) => r !== main);
    const kickoff = Math.min(...list.map((r) => ms(starts, r.event)));
    return { key, main, more, kickoff: Number.isFinite(kickoff) ? new Date(kickoff).toISOString() : null,
      move: list.reduce((a, r) => a + (Number(r.move) || 0), 0), stakes: list.reduce((a, r) => a + Math.abs(Number(r.stakes) || 0), 0) };
  });
}

// legs / upcoming / done = liveLegMoves output (already filtered for display). starts: { event: ISO }.
export function rootForGroups({ legs = [], upcoming = [], done = [] } = {}, starts = {}) {
  const stake = (r) => Math.abs(Number(r.stakes) || 0) || Math.abs(Number(r.move) || 0);
  const live = group(legs, starts, stake).sort((a, b) => b.stakes - a.stakes || Math.abs(b.move) - Math.abs(a.move) || a.key.localeCompare(b.key));
  const up = group(upcoming, starts, stake).sort((a, b) => (Date.parse(a.kickoff || "") || Infinity) - (Date.parse(b.kickoff || "") || Infinity) || b.stakes - a.stakes || a.key.localeCompare(b.key));
  const fin = group(done.filter((r) => !r.residual), starts, (r) => Math.abs(Number(r.move) || 0)).sort((a, b) => Math.abs(b.move) - Math.abs(a.move) || a.key.localeCompare(b.key));
  const residual = done.find((r) => r.residual) || null;
  return { live, upcoming: up, finished: fin, residual };
}
