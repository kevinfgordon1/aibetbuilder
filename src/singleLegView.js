// Per-venue status rows for a single-leg lock card (combo_single_orders).
const LABEL = { kalshi: "Kalshi", polymarket: "Polymarket" };
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmt = (v) => String(Math.round(v * 100) / 100);

export function venueRows(orders) {
  const out = [];
  for (const venue of ["kalshi", "polymarket"]) {
    const rows = (orders || []).filter((o) => o && o.venue === venue);
    if (!rows.length) continue;
    const filled = rows.reduce((s, o) => s + n(o.filled), 0);
    const live = rows.filter((o) => o.status === "resting");
    const resting = live.reduce((s, o) => s + n(o.open), 0);
    const price = live.length ? n(live[0].price) : null;
    const bits = [];
    if (resting > 0) bits.push(`Resting ${fmt(resting)}${price ? ` @ ${Math.round(price * 100)}¢` : ""}`);
    if (filled > 0) bits.push(`Filled ${fmt(filled)}`);
    if (!bits.length) bits.push("Not resting");
    out.push({ venue: LABEL[venue], state: bits.join(" · "), filled, resting });
  }
  return out;
}
