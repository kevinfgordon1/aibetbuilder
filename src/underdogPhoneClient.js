// Browser fetch for /api/underdog-predict. The state_config_id stays on
// the server. An empty games list means omit Underdog — do not fall back
// to Betstamp.
//
// Each request (fetch + body) gives up after UNDERDOG_PHONE_TIMEOUT_MS and
// throws, so a stalled request cannot hold a board's in-flight guard and
// freeze the Underdog column while the next poll keeps its schedule.

export const UNDERDOG_PHONE_TIMEOUT_MS = 15_000;

export function underdogPhoneUrl({ live } = {}) {
  return live ? "/api/underdog-predict?live=1" : "/api/underdog-predict";
}

export async function fetchUnderdogPhone(fetchFn = fetch, { live, timeoutMs = UNDERDOG_PHONE_TIMEOUT_MS } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Underdog request timed out")), timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchFn(underdogPhoneUrl({ live }), { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!body || !Array.isArray(body.games)) return { ok: false, games: [], missingConfig: false };
        return body;
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
