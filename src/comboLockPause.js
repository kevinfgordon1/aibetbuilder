// Per-lock pause + Kalshi balance readout helpers for the Combo Locks tab.
// combo_parlays.paused (default false) is read by combo-worker, which stops
// quoting that lock on Kalshi and Polymarket and cancels its open quotes.

export const PAUSE_SQL_HINT =
  "Run sql/combo_parlay_paused.sql in the Supabase SQL editor first (adds combo_parlays.paused).";

export function isLockPaused(p) {
  return !!p && p.paused === true;
}

export function pauseUpdate(paused, now = new Date()) {
  return { paused: !!paused, paused_at: paused ? now.toISOString() : null };
}

export function isMissingPausedColumn(error) {
  const m = String((error && (error.message || error.details)) || "");
  return /paused/i.test(m) && /(column|schema cache|does not exist|could not find)/i.test(m);
}

export function pauseToggleTitle(paused) {
  return paused
    ? "Paused: worker is not quoting this lock on Kalshi or Polymarket. Click to resume."
    : "Quoting on Kalshi + Polymarket. Click to pause this lock only (the kill switch is separate).";
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

// Normalizes the /api/combo-bucket payload into display rows. Labels say Main /
// Combo because Kalshi's app only shows the combined total.
export function bucketReadoutRows(bucket) {
  if (!bucket) return [];
  return [
    { key: "main", label: "Main", sub: "shard 0 cash", value: money(bucket.main_cash), tip: "Kalshi main (shard 0) cash. The Kalshi app folds this into one combined total." },
    { key: "combo", label: "Combo", sub: "shard 1 available", value: money(bucket.combo_cash), tip: "Kalshi combo (shard 1) available cash." },
    { key: "pos", label: "Combo positions", sub: "open value", value: money(bucket.combo_positions), tip: "Open combo-position value on shard 1. Not counted against the ceiling." },
    { key: "target", label: "Target", sub: bucket.gameday ? "gameday" : "default", value: money(bucket.target), tip: "Bucket manager tops combo cash up toward this." },
    { key: "ceiling", label: "Ceiling", sub: "cash only", value: money(bucket.ceiling), tip: "Max combo available cash. Open positions do not count." },
  ];
}

export function bucketAgeLabel(bucket, now = Date.now()) {
  if (!bucket || !bucket.at) return "";
  const t = Date.parse(bucket.at);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
