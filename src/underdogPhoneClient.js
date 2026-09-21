// Browser fetch for /api/underdog-predict. The state_config_id stays on
// the server. An empty games list means omit Underdog — do not fall back
// to Betstamp.

export function underdogPhoneUrl() {
  return "/api/underdog-predict";
}

export async function fetchUnderdogPhone(fetchFn = fetch) {
  const res = await fetchFn(underdogPhoneUrl(), { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!body || !Array.isArray(body.games)) return { ok: false, games: [], missingConfig: false };
  return body;
}
