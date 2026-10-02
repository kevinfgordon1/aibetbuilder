// Client side of the Railway odds-relay Betstamp live feed (GET /betstamp).
//
// The Pro odds board used to poll /api/betstamp-markets?refresh=1 itself every
// 5s. With VITE_ODDS_RELAY_URL set, LIVE now reads one shared Betstamp poll
// from the relay over SSE (about 2s cadence) and keeps the 5s poll as the
// automatic fallback: it runs whenever the relay stream is down, refused, or
// silent for RELAY_SILENT_MS.
//
// Relay events (event: bs), all JSON with { v:1, kind, seq, t, league }:
//   snapshot  full book: markets [[key, market]], fixtures, teams
//   delta     changed rows up [[key, market]], removed keys rm, and fixtures /
//             teams only when they changed
//   tick      nothing moved (heartbeat; the relay polled and the book is current)
//   error     the relay could not poll Betstamp (never counts as fresh)
// seq grows by one per successful poll. A skipped seq means a lost event; the
// board reconnects to get a fresh snapshot.

export const RELAY_SILENT_MS = 10_000;
// Unchanged ticks only confirm that quotes are still offered. Apply them at
// the old poll cadence so the reconcile grace window keeps working.
export const RELAY_TICK_APPLY_MS = 5_000;

export function betstampRelayFromEnv(raw) {
  if (raw == null || raw === "") return true;
  const s = String(raw).trim().toLowerCase();
  return s !== "0" && s !== "false" && s !== "off";
}

export function relayFeedFresh(lastEventAt, nowMs, silentMs = RELAY_SILENT_MS) {
  return lastEventAt > 0 && nowMs - lastEventAt < silentMs;
}

/**
 * Per-connection book. Feed it each parsed event's data; it returns what the
 * board should do. The payload has the same shape /api/betstamp-markets returns.
 */
export function createRelayBook() {
  let markets = new Map();
  let fixtures = [];
  let teams = [];
  let seq = null;

  const payload = () => ({
    markets: [...markets.values()],
    fixtures,
    teams,
  });

  return {
    get seq() { return seq; },
    payload,
    apply(data) {
      if (!data || typeof data !== "object" || data.v !== 1) return { kind: "ignore" };
      const kind = data.kind;
      if (kind === "error") return { kind: "error", error: data.error || "relay poll failed" };
      if (kind === "snapshot") {
        markets = new Map();
        for (const row of data.markets || []) {
          if (Array.isArray(row) && row.length === 2 && row[1]) markets.set(row[0], row[1]);
        }
        fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
        teams = Array.isArray(data.teams) ? data.teams : [];
        seq = Number.isFinite(data.seq) ? data.seq : 0;
        return { kind: "snapshot", changed: true };
      }
      if (kind !== "delta" && kind !== "tick") return { kind: "ignore" };
      if (seq == null) return { kind: "gap" }; // no base to apply onto
      if (data.seq !== seq + 1) return { kind: "gap" };
      seq = data.seq;
      if (kind === "tick") return { kind: "tick", changed: false };
      for (const row of data.up || []) {
        if (Array.isArray(row) && row.length === 2 && row[1]) markets.set(row[0], row[1]);
      }
      for (const key of data.rm || []) markets.delete(key);
      if (Array.isArray(data.fixtures)) fixtures = data.fixtures;
      if (Array.isArray(data.teams)) teams = data.teams;
      return { kind: "delta", changed: true };
    },
  };
}
