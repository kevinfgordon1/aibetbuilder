// Browser client for /api/soccer-pm-no. Overlays Kalshi/Poly/Novig/ProphetX
// No tops onto Promo soccer moneylines before Free Bet / boost ranking.

import { overlaySoccerPmNos } from "./soccerPairing.js";

export { overlaySoccerPmNos };

export async function fetchSoccerPmNos(games, { venues, fetchImpl } = {}) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length) return {};
  const doFetch = fetchImpl || fetch;
  const r = await doFetch("/api/soccer-pm-no", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      games: list.map((g) => ({
        sport: g.sport,
        away: g.away,
        home: g.home,
        commence_time: g.commence_time,
      })),
      venues,
    }),
  });
  if (!r || !r.ok) return {};
  const json = await r.json();
  return json && json.quotes && typeof json.quotes === "object" ? json.quotes : {};
}
