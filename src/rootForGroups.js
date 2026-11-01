// "What you're rooting for" layout (Kevin, Nov 1 2026). One row per leg (moneyline, spread, total, prop each on
// its own row; the per-game grouping from #546 was "too confusing").
//  - Live now (right column): biggest swing still at stake first, then impact so far.
//  - Upcoming (right column): by kickoff, then biggest stake.
//  - Finished (left column, under the needle, "kinda separate"): by kickoff, then name; the residual bar
//    (contract changes / legs with no price) last, so the bars still add up to the Finished total.
const ms = (starts, ev) => { const t = Date.parse((starts || {})[ev] || ""); return Number.isFinite(t) ? t : Infinity; };
const stake = (r) => Math.abs(Number(r.stakes) || 0);

export function rootForRows({ legs = [], upcoming = [], done = [] } = {}, starts = {}) {
  const live = [...legs].sort((a, b) => stake(b) - stake(a) || Math.abs(b.move) - Math.abs(a.move) || a.event.localeCompare(b.event));
  const up = [...upcoming].sort((a, b) => ms(starts, a.event) - ms(starts, b.event) || stake(b) - stake(a) || a.event.localeCompare(b.event));
  const finished = [...done].sort((a, b) => (a.residual ? 1 : 0) - (b.residual ? 1 : 0) || ms(starts, a.event) - ms(starts, b.event) || a.event.localeCompare(b.event));
  return { live, upcoming: up, finished };
}
