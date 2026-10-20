// "Today" view for What to root for.
//
// Definition: Today = games (events) whose kickoff falls on today's date in ET.
//  - Root for / against: only results in today's games. Each result's impact is still E[P | result] − E[P]
//    from the full correlated engine across ALL the user's locks (later games stay at current fairs).
//  - Chart and numbers: the spread of "expected profit after today's games finish" — each simulated day
//    fixes today's results by their current chances, and every later game stays at its current fair.
//    Its average equals today's expected profit (nothing changes in expectation); the spread shows how much
//    today can move it.
//  - Touched locks: open locks with at least one leg in today's games.
import { expectedProfit } from "./rootForSweat.js";

const etDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// "Today" rolls over at 11:00 AM ET: until then it still shows the previous day's games (and needle).
export const ROLLOVER_HOUR_ET = 11;
const H = 3600 * 1000;
export function sheetDay(nowMs) { return etDate(nowMs - ROLLOVER_HOUR_ET * H); }
// The Today filter alone switches to the next day's games at 2 AM ET (Kevin, Oct 20 2026). Saved days, the
// "How your games ran" table and the needle cron keep the 11 AM ET sheet day above.
export const TODAY_ROLLOVER_HOUR_ET = 2;
export function todayDay(nowMs) { return etDate(nowMs - TODAY_ROLLOVER_HOUR_ET * H); }
// A game's day: its ET kickoff date, with after-midnight kickoffs (before 5 AM ET) counted to the night before.
export function gameDay(startMs) { return etDate(startMs - 5 * H); }
export function todayEvents(perEvent = [], nowMs, today = sheetDay(nowMs)) { const out = new Set();
  for (const e of perEvent) if (e && e.event && e.start && gameDay(Date.parse(e.start)) === today) out.add(e.event);
  return out;
}
// "Fri Oct 16" for the sheet day.
export function sheetDayLabel(nowMs, d = sheetDay(nowMs)) { const t = Date.parse(`${d}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(t));
}

export function touchedLocks(model, events) {
  return ((model && model.positions) || []).filter((p) => p.legs.some((l) => events.has(l.event)));
}

// small seeded RNG so the chart is stable between renders
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function todayDistribution(model, events, { samples = 20000, bins = 32, seed = 7, offset = 0 } = {}) {
  const evs = [...events].filter((e) => model && model.probs && model.probs[e]);
  if (!evs.length) return null;
  const pos = touchedLocks(model, new Set(evs));
  const untouched = (model.positions || []).filter((p) => !pos.includes(p));
  const base = expectedProfit(untouched, model.probs); // constant: these locks don't depend on today
  const r = rng(seed); const vals = new Float64Array(samples);
  const cum = evs.map((e) => { const d = model.probs[e]; let c = 0; return Object.entries(d).map(([o, p]) => [o, (c += p)]); });
  for (let i = 0; i < samples; i++) {
    const probs = { ...model.probs };
    evs.forEach((e, j) => { const u = r() * cum[j][cum[j].length - 1][1]; const hit = cum[j].find(([, c]) => u <= c) || cum[j][cum[j].length - 1]; probs[e] = { [hit[0]]: 1 }; });
    vals[i] = base + expectedProfit(pos, probs) - offset; // offset = EV now → change in EV from today's games
  }
  let lo = Infinity, hi = -Infinity, sum = 0, below = 0;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; sum += v; if (v < 0) below++; }
  const w = (hi - lo) / bins || 1; const b = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, p: 0 }));
  let atMin = 0;
  for (const v of vals) { b[Math.min(bins - 1, Math.floor((v - lo) / w))].p += 1 / samples; if (v - lo < 0.5) atMin++; }
  return { ev: sum / samples, hist: { bins: b, samples, tailP: 0 }, worst: { pnl: lo, p: atMin / samples }, best: { pnl: hi }, pProfit: 1 - below / samples, touched: pos.length, events: evs.length };
}
export const todayDayLabel = (nowMs) => sheetDayLabel(nowMs, todayDay(nowMs));
