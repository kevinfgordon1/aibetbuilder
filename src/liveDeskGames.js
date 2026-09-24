// NFL game picker for the Live Trading Desk.
//
// The slate comes from the public Polymarket US gateway
// GET /v2/leagues/nfl/events (not Kalshi). That payload is the board Kevin
// actually trades. A full-game moneyline slug is `aec-` plus the event slug
// (`nfl-atl-gb-2026-09-24` → `aec-nfl-atl-gb-2026-09-24`). Spreads are `asc-`,
// totals are `tsc-`, and half/quarter markets add a suffix. Those are not
// the moneyline filter.
//
// The league response embeds every alternate, so the desk scans the text for
// moneyline slugs and parses only those market objects.

export const DESK_MARKET_TYPES = Object.freeze([
  Object.freeze({ id: "moneyline", label: "Moneyline" }),
]);

export const NOT_MONEYLINE_MESSAGE = "That position is not an NFL full-game moneyline. Pick the game and Moneyline so the hedge cannot land on a spread, total, or another board.";
export const NOT_NFL_MESSAGE = "That market is not an NFL game. Pick a game from the NFL slate — the desk will not load a different board from this slug.";

const NFL_ML_RE = /^aec-nfl-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$/;
const NFL_GAME_RE = /^nfl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/;
const NFL_OTHER_RE = /^(?:aec|asc|tsc|atc)-nfl-|^nfl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}/;
const SLUG_IN_TEXT_RE = /"slug":"(aec-nfl-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2})"/g;

const SLATE_PAST_MS = 18 * 3600 * 1000;
const SLATE_FUTURE_MS = 21 * 24 * 3600 * 1000;

export function moneylineSlugForGame(gameId) {
  const id = String(gameId || "").trim().toLowerCase();
  if (!NFL_GAME_RE.test(id)) return "";
  return "aec-" + id;
}

export function classifyDeskMarket(slug) {
  const s = String(slug || "").trim().toLowerCase();
  const ml = NFL_ML_RE.exec(s);
  if (ml) {
    return {
      ok: true,
      marketType: "moneyline",
      league: "nfl",
      gameId: "nfl-" + ml[1] + "-" + ml[2] + "-" + ml[3],
      slug: s,
      message: "",
    };
  }
  if (s && NFL_OTHER_RE.test(s)) {
    return { ok: false, marketType: "", league: "nfl", gameId: "", slug: s, message: NOT_MONEYLINE_MESSAGE };
  }
  return {
    ok: false,
    marketType: "",
    league: "",
    gameId: "",
    slug: s,
    message: s ? NOT_NFL_MESSAGE : "",
  };
}

export function fallbackGameLabel(gameId) {
  const id = String(gameId || "").trim().toLowerCase();
  const m = /^nfl-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!m) return id;
  return "NFL · " + m[1].toUpperCase() + " @ " + m[2].toUpperCase() + " · " + m[3];
}

export function isSpreadOrTotalSlug(slug) {
  return /^(?:asc|tsc)-/i.test(String(slug || "").trim());
}

function conflictsWithMoneyline(market) {
  if (!market || typeof market !== "object") return false;
  const sports = String(market.sportsMarketType || "");
  const v2 = String(market.sportsMarketTypeV2 || "");
  const type = String(market.marketType || "");
  if (sports && sports !== "football_team_full_game_winner") return true;
  if (v2 && v2 !== "SPORTS_MARKET_TYPE_MONEYLINE") return true;
  if (type && type !== "moneyline") return true;
  if (market.line != null && market.line !== "") return true;
  return false;
}

export function isFullGameMoneyline(market, slug) {
  const s = String((slug || (market && market.slug) || "")).trim().toLowerCase();
  if (!NFL_ML_RE.test(s)) return false;
  if (conflictsWithMoneyline(market)) return false;
  const sports = String((market && market.sportsMarketType) || "");
  const v2 = String((market && market.sportsMarketTypeV2) || "");
  const type = String((market && market.marketType) || "");
  return !!(sports || v2 || type === "moneyline");
}

export function placeScopeError(body, slug, raw) {
  const got = String(slug || "").trim().toLowerCase();
  const gameId = String((body && body.gameId) || "").trim().toLowerCase();
  if (gameId) {
    const want = moneylineSlugForGame(gameId);
    if (!want || want !== got) return "That slug is not the moneyline for the selected NFL game.";
  }
  if (isSpreadOrTotalSlug(got) || (got && NFL_OTHER_RE.test(got) && !NFL_ML_RE.test(got))) {
    return "That market is not the full-game moneyline.";
  }
  if (raw && conflictsWithMoneyline(raw)) return "That market is not the full-game moneyline.";
  return "";
}

function sideName(side) {
  const team = (side && side.team) || {};
  return team.safeName || team.name || team.displayAbbreviation || (side && side.description) || "";
}

function participantsFromMarket(market, slug) {
  const sides = market && Array.isArray(market.marketSides) ? market.marketSides : [];
  let away = "";
  let home = "";
  for (const side of sides) {
    const ord = String(side && side.team && side.team.ordering || "").toLowerCase();
    if (ord === "away" && !away) away = sideName(side);
    if (ord === "home" && !home) home = sideName(side);
  }
  const m = NFL_ML_RE.exec(String(slug || ""));
  if (!away && m) away = m[1].toUpperCase();
  if (!home && m) home = m[2].toUpperCase();
  return { away, home };
}

export function formatKickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDeskGameOption(game) {
  const away = game && game.away ? game.away : "Away";
  const home = game && game.home ? game.home : "Home";
  const when = game && game.dateLabel ? " · " + game.dateLabel : "";
  return "NFL · " + away + " @ " + home + when;
}

function inSlateWindow(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  const now = Number(nowMs) || Date.now();
  return t > now - SLATE_PAST_MS && t < now + SLATE_FUTURE_MS;
}

export function gameFromMoneylineMarket(market, slug, nowMs) {
  const s = String(slug || (market && market.slug) || "").trim().toLowerCase();
  if (!isFullGameMoneyline(market, s)) return null;
  if (market && (market.closed === true || market.archived === true)) return null;
  const start = (market && (market.gameStartTime || market.startTime || market.startDate)) || "";
  if (start && !inSlateWindow(start, nowMs)) return null;
  const teams = participantsFromMarket(market, s);
  const classified = classifyDeskMarket(s);
  const dateLabel = formatKickoff(start);
  const game = {
    id: classified.gameId,
    sport: "nfl",
    sportLabel: "NFL",
    away: teams.away,
    home: teams.home,
    startTime: start || "",
    dateLabel,
    markets: [{ id: "moneyline", label: "Moneyline", slug: s }],
  };
  game.label = formatDeskGameOption(game);
  return game;
}

function sliceJsonObject(raw, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  const limit = Math.min(raw.length, start + 30000);
  for (let i = start; i < limit; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return "";
}

export function gamesFromLeagueEventsText(text, nowMs) {
  const raw = String(text || "");
  const byId = new Map();
  SLUG_IN_TEXT_RE.lastIndex = 0;
  let match = SLUG_IN_TEXT_RE.exec(raw);
  while (match) {
    const slug = match[1];
    const at = match.index;
    if (!byId.has(slug)) {
      const start = raw.lastIndexOf('{"id":', at);
      if (start >= 0 && at - start < 8000) {
        const slice = sliceJsonObject(raw, start);
        if (slice) {
          try {
            const market = JSON.parse(slice);
            const game = gameFromMoneylineMarket(market, slug, nowMs);
            if (game) byId.set(game.id, game);
          } catch (_) { /* skip a malformed market object */ }
        }
      }
    }
    match = SLUG_IN_TEXT_RE.exec(raw);
  }
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.startTime);
    const tb = Date.parse(b.startTime);
    const da = Number.isFinite(ta) ? ta : Infinity;
    const db = Number.isFinite(tb) ? tb : Infinity;
    if (da !== db) return da - db;
    return String(a.label).localeCompare(String(b.label));
  });
}
