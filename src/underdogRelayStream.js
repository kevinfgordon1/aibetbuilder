// Client side of the Railway odds-relay Underdog live feed (GET /underdog).
//
// The Pro odds board polled /api/underdog-predict?live=1 every 10s per tab, so
// a repriced Underdog line reached the screen 3-15s late. With
// VITE_ODDS_RELAY_URL set, LIVE now gets pushed games from ONE shared relay
// poll (about every 2s) and keeps the 10s poll as the automatic fallback: it
// runs whenever the relay stream is down, refused, or silent for
// UNDERDOG_RELAY_SILENT_MS.
//
// Relay events (event: ud), all JSON with { v:1, kind, seq, t, league }:
//   snapshot  full slate: games [game]
//   delta     changed or new games up [game], removed matchIds rm
//   tick      nothing moved (heartbeat)
//   error     the relay could not poll Underdog (never counts as fresh)
// seq grows by one per applied poll. A skipped seq means a lost event; the
// board reconnects to get a fresh snapshot.

export const UNDERDOG_RELAY_SILENT_MS = 10_000;
// A tick (poll found nothing new) repaints Underdog ages at most this often.
export const UNDERDOG_TICK_REPAINT_MS = 3_000;

export function underdogRelayFromEnv(raw) {
  if (raw == null || raw === "") return true;
  const s = String(raw).trim().toLowerCase();
  return s !== "0" && s !== "false" && s !== "off";
}

export function underdogRelayFresh(lastEventAt, nowMs, silentMs = UNDERDOG_RELAY_SILENT_MS) {
  return lastEventAt > 0 && nowMs - lastEventAt < silentMs;
}

/**
 * Per-connection slate. Feed it each parsed event's data; it returns what the
 * board should do. payload() has the same shape /api/underdog-predict returns.
 */
export function createUnderdogBook() {
  let games = new Map();
  let seq = null;
  // When the relay last asked Underdog (ms). Every applied poll sets it, tick
  // or not: a tick means "asked again, nothing moved", which still confirms
  // every quote on the slate as current.
  let fetchedAt = null;
  const stampFetched = (data) => {
    const t = Date.parse(data && data.fetchedAt);
    if (Number.isFinite(t)) fetchedAt = t;
  };
  const payload = () => ({ ok: true, missingConfig: false, configRejected: false, games: [...games.values()], fetchedAt, error: null });
  return {
    get seq() { return seq; },
    payload,
    apply(data) {
      if (!data || typeof data !== "object" || data.v !== 1) return { kind: "ignore" };
      const kind = data.kind;
      if (kind === "error") return { kind: "error", error: data.error || "relay poll failed" };
      if (kind === "snapshot") {
        games = new Map();
        for (const g of data.games || []) if (g && g.matchId != null) games.set(String(g.matchId), g);
        seq = Number.isFinite(data.seq) ? data.seq : 0;
        stampFetched(data);
        return { kind: "snapshot", changed: true };
      }
      if (kind !== "delta" && kind !== "tick") return { kind: "ignore" };
      if (seq == null) return { kind: "gap" };
      if (data.seq !== seq + 1) return { kind: "gap" };
      seq = data.seq;
      stampFetched(data);
      if (kind === "tick") return { kind: "tick", changed: false };
      for (const g of data.up || []) if (g && g.matchId != null) games.set(String(g.matchId), g);
      for (const id of data.rm || []) games.delete(String(id));
      return { kind: "delta", changed: true };
    },
  };
}
