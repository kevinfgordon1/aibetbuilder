// Pure player-TD board load transitions. The component keeps the last
// games on a failed refresh so a timeout does not blank prices it already showed.

export const PLAYER_TD_FETCH_TIMEOUT_MS = 10_000;

const SOURCE_LABEL = {
  kalshi: "Kalshi",
  polymarket: "Polymarket",
  underdog: "Underdog",
};

export function missingPlayerTdBooks(sources) {
  if (!sources) return [];
  return ["kalshi", "polymarket", "underdog"].filter((key) => {
    const value = sources[key];
    const status = value && typeof value === "object" ? value.status : value;
    return status === "timeout" || status === "error";
  }).map((key) => SOURCE_LABEL[key]);
}

export function playerTdNotice({ stale, partial, sources } = {}) {
  if (stale) {
    return "Showing the last player TD board. The latest refresh did not finish in time.";
  }
  if (partial) {
    const missing = missingPlayerTdBooks(sources);
    if (missing.length) {
      return `Some books did not respond in time (${missing.join(", ")}). Prices shown are the ones that arrived.`;
    }
    return "Some books did not respond in time. Prices shown are the ones that arrived.";
  }
  return "";
}

export function reducePlayerTdLoad(prev, payload) {
  const previous = prev || {};
  const priorGames = Array.isArray(previous.games) ? previous.games : [];
  const body = payload && payload.body;
  const failed = !payload || payload.aborted || payload.httpOk === false || !body || body.ok === false;
  if (failed) {
    if (priorGames.length) {
      return {
        games: priorGames,
        error: "",
        stale: true,
        partial: previous.partial === true,
        fetchedAt: previous.fetchedAt || null,
        notice: playerTdNotice({ stale: true }),
      };
    }
    return {
      games: [],
      error: "Player TD prices are unavailable.",
      stale: false,
      partial: false,
      fetchedAt: previous.fetchedAt || null,
      notice: "",
    };
  }
  const stale = body.stale === true;
  const partial = body.partial === true;
  return {
    games: Array.isArray(body.games) ? body.games : [],
    error: "",
    stale,
    partial,
    fetchedAt: body.fetchedAt || null,
    notice: playerTdNotice({ stale, partial, sources: body.sources }),
  };
}
