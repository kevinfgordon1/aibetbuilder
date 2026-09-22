// Browser fetch for /api/underdog-predict. The state_config_id stays on
// the server. An empty games list means omit Underdog — do not fall back
// to Betstamp.

export function underdogPhoneUrl({ live } = {}) {
  return live ? "/api/underdog-predict?live=1" : "/api/underdog-predict";
}

export async function fetchUnderdogPhone(fetchFn = fetch, { live } = {}) {
  const res = await fetchFn(underdogPhoneUrl({ live }), { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!body || !Array.isArray(body.games)) return { ok: false, games: [], missingConfig: false };
  return body;
}
