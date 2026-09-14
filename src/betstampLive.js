// Client SSE consumer for the same-origin Betstamp proxy. The API key never
// leaves the server — this talks only to /api/betstamp-*.

// Pregame has no SSE. Re-pull one REST snapshot on this interval so cell ages
// track Betstamp updated_at instead of climbing from a frozen mount snapshot.
// One poll << Betstamp's ~4 RPS (3 GETs per league).
export const BETSTAMP_PREGAME_POLL_MS = 20_000;

export function parseSseChunk(buffer) {
  const parts = String(buffer || "").split("\n\n");
  const rest = parts.pop() ?? "";
  const events = [];
  for (const block of parts) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join("\n");
    try {
      events.push({ event, data: JSON.parse(raw) });
    } catch {
      events.push({ event, data: { raw } });
    }
  }
  return { events, rest };
}

export function betstampSnapshotUrl({ league, live, includeAlts, fixtureId } = {}) {
  const p = new URLSearchParams();
  if (league) p.set("league", league);
  if (live === true) p.set("is_live", "true");
  if (live === false) p.set("is_live", "false");
  if (includeAlts === true) p.set("include_alts", "true");
  if (fixtureId != null && fixtureId !== "") p.set("fixture_id", String(fixtureId));
  return `/api/betstamp-markets?${p}`;
}

export function betstampStreamUrl({ league, live } = {}) {
  const p = new URLSearchParams();
  if (league) p.set("league", league);
  if (live === true) p.set("is_live", "true");
  if (live === false) p.set("is_live", "false");
  return `/api/betstamp-stream?${p}`;
}

export function nextBackoffMs(attempt, { base = 250, max = 8000 } = {}) {
  const n = Math.max(0, attempt | 0);
  return Math.min(max, base * (2 ** n));
}

export async function consumeBetstampStream({ url, signal, onEvent, onStatus } = {}) {
  if (!url) throw new Error("stream url required");
  onStatus?.("connecting");
  const res = await fetch(url, {
    signal,
    headers: { Accept: "text/event-stream" },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `stream ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (!res.body) throw new Error("stream had no body");
  onStatus?.("live");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buf);
      buf = parsed.rest;
      for (const ev of parsed.events) onEvent?.(ev);
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  onStatus?.("disconnected");
}
