// Odds Board cell helpers. Liquidity is top-of-book only: `size` or `bet_limit`
// already on transformed bookOdds — never invent depth or $0.

import { isSoccerSport } from "./soccerPairing.js";

// Live New Odds Board Best: while the game is moving, drop quotes older than 60s.
// Halftime / intermission keeps the longer 4-minute allowance — books go quiet
// at the break and a 60s cut would empty Best. Pregame is ungated.
export const LIVE_BEST_ODDS_MAX_AGE_MS = 60_000;
export const LIVE_BEST_ODDS_BREAK_MAX_AGE_MS = 240_000;

function normLiveBreakToken(v) {
  if (v == null || typeof v === "object") return "";
  return String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const LIVE_BREAK_TOKENS = new Set([
  "ht",
  "half",
  "halftime",
  "half_time",
  "half_time_break",
  "end_of_1st_half",
  "end_1st_half",
  "end_first_half",
  "between_halves",
  "intermission",
  "intermission_1",
  "intermission_2",
  "period_break",
  "break",
]);

export function isLiveGameBreak(game) {
  if (!game) return false;
  if (game.is_halftime === true || game.in_break === true) return true;
  for (const raw of [game.status, game.state, game.fixture_status, game.period, game.clock]) {
    const t = normLiveBreakToken(raw);
    if (!t) continue;
    if (LIVE_BREAK_TOKENS.has(t)) return true;
    if (t.includes("halftime") || t.includes("half_time") || t.includes("intermission")) return true;
  }
  return false;
}

export function liveBestOddsMaxAgeMs(game) {
  if (!game?.is_live) return null;
  return isLiveGameBreak(game) ? LIVE_BEST_ODDS_BREAK_MAX_AGE_MS : LIVE_BEST_ODDS_MAX_AGE_MS;
}

export function isFreshForLiveBestOdds(updatedAt, nowMs, maxAgeMs = LIVE_BEST_ODDS_MAX_AGE_MS) {
  if (updatedAt == null || !isFinite(Number(updatedAt))) return false;
  if (nowMs == null || !isFinite(Number(nowMs))) return false;
  if (maxAgeMs == null || !isFinite(Number(maxAgeMs))) return false;
  return (Number(nowMs) - Number(updatedAt)) < Number(maxAgeMs);
}

function liveBestFreshness({ game, nowMs, maxBestAgeMs }) {
  if (!game?.is_live) return null;
  if (nowMs == null || !isFinite(nowMs)) return null;
  const maxAgeMs = maxBestAgeMs != null && isFinite(maxBestAgeMs)
    ? Number(maxBestAgeMs)
    : liveBestOddsMaxAgeMs(game);
  if (maxAgeMs == null || !isFinite(maxAgeMs)) return null;
  return { nowMs, maxAgeMs };
}

export function fmtBoardSize(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

// Higher American number is better for the bettor (−150 → −110 → +120).
// Used to flash the odds digits green (improve) or red (worse).
export const ODDS_FLASH_MS = 900;

export function oddsMoveDirection(prev, next) {
  if (prev == null || next == null || prev === "" || next === "") return null;
  const a = typeof prev === "number" ? prev : Number(String(prev).trim().replace(/^\+/, ""));
  const b = typeof next === "number" ? next : Number(String(next).trim().replace(/^\+/, ""));
  if (!isFinite(a) || !isFinite(b) || a === b) return null;
  return b > a ? "up" : "down";
}

// Compact badge when a book has no favicon. "BetOpenly" → "BO", "Novig" → "NO".
export function bookInitials(label) {
  const raw = String(label || "").trim();
  if (!raw) return "?";
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  const word = words[0];
  const camel = word.match(/[A-Z]+[a-z]*|[a-z]+/g);
  if (camel && camel.length >= 2) {
    return (camel[0][0] + camel[1][0]).toUpperCase();
  }
  return word.slice(0, 2).toUpperCase();
}

// Session hide on New Odds Board. Cell keys are game + market + side + book
// (not the Best column). Whole-game hide uses `game:${fixtureId}` in the same
// hiddenKeys Set — Betstamp fixture id is stable across snapshot / stream.
export const ODDS_BOARD_HIDE_GAME_PREFIX = "game:";

export function oddsBoardHideKey({ gameId, market, side, bookKey } = {}) {
  if (gameId == null || gameId === "") return null;
  if (!market || !side || !bookKey || bookKey === "best") return null;
  return `${gameId}:${market}:${side}:${bookKey}`;
}

export function oddsBoardHideGameKey(gameId) {
  if (gameId == null || gameId === "") return null;
  return `${ODDS_BOARD_HIDE_GAME_PREFIX}${gameId}`;
}

export function isOddsBoardGameHideKey(key) {
  return typeof key === "string" && key.startsWith(ODDS_BOARD_HIDE_GAME_PREFIX);
}

export function isHiddenOddsGame(hiddenKeys, gameId) {
  if (!hiddenKeys || typeof hiddenKeys.has !== "function") return false;
  const key = oddsBoardHideGameKey(gameId);
  return !!(key && hiddenKeys.has(key));
}

export function hiddenOddsGameIds(hiddenKeys) {
  if (!hiddenKeys || typeof hiddenKeys[Symbol.iterator] !== "function") return [];
  const ids = [];
  for (const key of hiddenKeys) {
    if (isOddsBoardGameHideKey(key)) ids.push(key.slice(ODDS_BOARD_HIDE_GAME_PREFIX.length));
  }
  return ids;
}

export function toggleOddsBoardHideKey(hiddenKeys, key) {
  const next = new Set(hiddenKeys);
  if (!key) return next;
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function clearHiddenOddsGames(hiddenKeys) {
  const next = new Set(hiddenKeys);
  for (const key of next) {
    if (isOddsBoardGameHideKey(key)) next.delete(key);
  }
  return next;
}

export function filterHiddenOddsGames(games, hiddenKeys) {
  if (!Array.isArray(games)) return [];
  return games.filter((g) => !isHiddenOddsGame(hiddenKeys, g?.id));
}

export function hideSideFromPriceKey(priceKey) {
  if (priceKey === "ml_away" || priceKey === "ml_away_no") return { market: "ml", side: priceKey === "ml_away" ? "away" : "away_no" };
  if (priceKey === "ml_home" || priceKey === "ml_home_no") return { market: "ml", side: priceKey === "ml_home" ? "home" : "home_no" };
  if (priceKey === "ml_draw" || priceKey === "ml_draw_no") return { market: "ml", side: priceKey === "ml_draw" ? "draw" : "draw_no" };
  if (priceKey === "spr_away") return { market: "spr", side: "away" };
  if (priceKey === "spr_home") return { market: "spr", side: "home" };
  if (priceKey === "tot_over") return { market: "tot", side: "over" };
  if (priceKey === "tot_under") return { market: "tot", side: "under" };
  return null;
}

export function isHiddenOddsCell(hiddenKeys, spec) {
  if (!hiddenKeys || typeof hiddenKeys.has !== "function") return false;
  const key = oddsBoardHideKey(spec);
  return !!(key && hiddenKeys.has(key));
}

function freshnessGate(freshness) {
  return !!(
    freshness
    && freshness.nowMs != null
    && isFinite(freshness.nowMs)
    && freshness.maxAgeMs != null
    && isFinite(freshness.maxAgeMs)
  );
}

export function isEligibleBestEntry(entry, freshness) {
  if (entry?.hidden) return false;
  const price = entry?.price;
  if (price == null || !isFinite(price)) return false;
  if (freshnessGate(freshness) && !isFreshForLiveBestOdds(entry.updatedAt, freshness.nowMs, freshness.maxAgeMs)) {
    return false;
  }
  return true;
}

export function pickBestSide(entries, freshness) {
  let best = null;
  const books = [];
  for (const entry of entries || []) {
    if (!isEligibleBestEntry(entry, freshness)) continue;
    const price = entry.price;
    if (best === null || price > best) {
      best = price;
      books.length = 0;
      books.push({ key: entry.key, size: entry.size ?? null });
    } else if (price === best) {
      books.push({ key: entry.key, size: entry.size ?? null });
    }
  }
  return {
    price: best,
    books,
    extra: Math.max(0, books.length - 1),
    size: books[0]?.size ?? null,
    primaryKey: books[0]?.key ?? null,
  };
}

// New Odds Board "Top 2 lines" Best: cap stacked spread/total chips.
export const STACKED_BEST_MAX_LINES = 2;

// Fixed New Odds Board tracks. Live ticks must clip inside these boxes — never
// grow a column or row. Horizontal scroll is preferred over fluid widths.
export const OBB_TEAM_COL_WIDTH = 186;
export const OBB_ODDS_COL_WIDTH = 108;
export const OBB_BEST_COL_WIDTH = 128;
export const OBB_SIDE_CELL_HEIGHT = 56;

export function obbColWidth(bookKey) {
  return bookKey === "best" ? OBB_BEST_COL_WIDTH : OBB_ODDS_COL_WIDTH;
}

export function obbTableWidth(visibleBooks) {
  return (visibleBooks || []).reduce((sum, b) => sum + obbColWidth(b?.key), OBB_TEAM_COL_WIDTH);
}

export function padBestPointStacks(blocks, max = STACKED_BEST_MAX_LINES) {
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : STACKED_BEST_MAX_LINES;
  const rows = Array.isArray(blocks) ? blocks.slice(0, cap) : [];
  while (rows.length < cap) {
    rows.push({
      point: `pad-${rows.length}`,
      count: 0,
      top: null,
      bot: null,
      padded: true,
    });
  }
  return rows;
}

export function normalizeBoardLine(point) {
  const n = Number(point);
  if (point == null || point === "" || !isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function formatStackedBestLine(market, point, side) {
  const n = normalizeBoardLine(point);
  if (n == null) return null;
  if (market === "tot") {
    const over = side === "over" || side === "top";
    return `${over ? "o" : "u"}${n}`;
  }
  return n > 0 ? `+${n}` : `${n}`;
}

// Spreads pair +6.5 with −6.5; totals already share 47.5 across over/under.
export function marketLinePoint(market, line) {
  const n = normalizeBoardLine(line);
  if (n == null) return null;
  return market === "spr" ? Math.abs(n) : n;
}

function medianLines(values) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Group eligible quotes by exact line. Popularity = eligible book count.
// Ties: closer to median/consensus, then better American (same as pickBestSide).
export function pickBestSidesByPopularLines(entries, freshness, maxLines = STACKED_BEST_MAX_LINES) {
  const eligible = [];
  for (const entry of entries || []) {
    if (!isEligibleBestEntry(entry, freshness)) continue;
    const line = normalizeBoardLine(entry.line);
    if (line == null) continue;
    eligible.push({ ...entry, line });
  }
  const groups = new Map();
  for (const entry of eligible) {
    if (!groups.has(entry.line)) groups.set(entry.line, []);
    groups.get(entry.line).push(entry);
  }
  if (!groups.size) return [];
  const median = medianLines(eligible.map((e) => e.line));
  const bookOrder = bookOrderOf(entries);
  const ranked = [...groups.entries()].map(([line, group]) => {
    const pick = pickBestSide(group, null);
    const winnerIdx = bookOrder.findIndex((k) => pick.books.some((b) => b.key === k));
    return {
      line,
      count: group.length,
      dist: median == null ? 0 : Math.abs(line - median),
      bestPrice: pick.price,
      winnerIdx: winnerIdx < 0 ? 999 : winnerIdx,
      pick,
    };
  });
  ranked.sort(comparePopularPoints);
  const cap = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : STACKED_BEST_MAX_LINES;
  return ranked.slice(0, cap).map(({ line, count, pick }) => ({
    line,
    price: pick.price,
    books: pick.books,
    extra: pick.extra,
    size: pick.size,
    primaryKey: pick.primaryKey,
    count,
  }));
}

function bookOrderOf(entries) {
  const bookOrder = [];
  const seen = new Set();
  for (const entry of entries || []) {
    if (!entry?.key || seen.has(entry.key)) continue;
    seen.add(entry.key);
    bookOrder.push(entry.key);
  }
  return bookOrder;
}

function emptySidePick() {
  return { price: null, books: [], extra: 0, size: null, primaryKey: null, line: null };
}

function pickSideAtPoint(entries) {
  if (!entries?.length) return emptySidePick();
  const pick = pickBestSide(entries, null);
  if (pick.price == null) return { ...emptySidePick() };
  const winner = entries.find((e) => e.price === pick.price && pick.books.some((b) => b.key === e.key));
  return { ...pick, line: winner?.line ?? null };
}

function fallbackSideLine(market, side, point, otherLine) {
  if (market === "spr") {
    const other = normalizeBoardLine(otherLine);
    if (other != null) return -other;
    return side === "home" || side === "under" || side === "bot" ? -point : point;
  }
  return point;
}

function stackFromPointPick(pick, { market, side, point, count, fallbackLine }) {
  const line = normalizeBoardLine(pick.line ?? fallbackLine);
  return {
    line,
    point,
    price: pick.price,
    books: pick.books,
    extra: pick.extra,
    size: pick.size,
    primaryKey: pick.primaryKey,
    count,
    lineLabel: formatStackedBestLine(market, line, side),
  };
}

function comparePopularPoints(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  if (a.dist !== b.dist) return a.dist - b.dist;
  if (a.bestPrice !== b.bestPrice) {
    if (a.bestPrice == null) return 1;
    if (b.bestPrice == null) return -1;
    return b.bestPrice - a.bestPrice;
  }
  return a.winnerIdx - b.winnerIdx;
}

// Top 2 lines at the game/market: rank |point| by unique eligible books
// (a book counts if either side quotes that point), then best juice per side.
export function pickBestByPopularPoints(topEntries, botEntries, freshness, {
  market,
  maxPoints = STACKED_BEST_MAX_LINES,
} = {}) {
  const tagged = [
    ...(topEntries || []).map((e) => ({ ...e, _side: "top" })),
    ...(botEntries || []).map((e) => ({ ...e, _side: "bot" })),
  ];
  const eligible = [];
  for (const entry of tagged) {
    if (!isEligibleBestEntry(entry, freshness)) continue;
    const raw = normalizeBoardLine(entry.line);
    if (raw == null) continue;
    const point = marketLinePoint(market, raw);
    if (point == null) continue;
    eligible.push({ ...entry, line: raw, point });
  }
  const groups = new Map();
  for (const entry of eligible) {
    if (!groups.has(entry.point)) {
      groups.set(entry.point, { top: [], bot: [], books: new Set() });
    }
    const group = groups.get(entry.point);
    group[entry._side].push(entry);
    if (entry.key) group.books.add(entry.key);
  }
  if (!groups.size) return [];
  const median = medianLines(eligible.map((e) => e.point));
  const bookOrder = bookOrderOf(tagged);
  const ranked = [...groups.entries()].map(([point, group]) => {
    const top = pickSideAtPoint(group.top);
    const bot = pickSideAtPoint(group.bot);
    const bestPrice = top.price == null ? bot.price
      : bot.price == null ? top.price
      : Math.max(top.price, bot.price);
    const winnerIdx = bookOrder.findIndex((k) => group.books.has(k));
    return {
      point,
      count: group.books.size,
      dist: median == null ? 0 : Math.abs(point - median),
      bestPrice,
      winnerIdx: winnerIdx < 0 ? 999 : winnerIdx,
      top,
      bot,
    };
  });
  ranked.sort(comparePopularPoints);
  const cap = Number.isFinite(maxPoints) && maxPoints > 0 ? Math.floor(maxPoints) : STACKED_BEST_MAX_LINES;
  return ranked.slice(0, cap).map(({ point, count, top, bot }) => {
    const topLine = fallbackSideLine(market, "top", point, bot.line);
    const botLine = fallbackSideLine(market, "bot", point, top.line ?? topLine);
    return {
      point,
      count,
      top: stackFromPointPick(top, { market, side: "top", point, count, fallbackLine: topLine }),
      bot: stackFromPointPick(bot, { market, side: "bot", point, count, fallbackLine: botLine }),
    };
  });
}

export function isStackedBestMatch(stacks, price, point) {
  if (price == null || !isFinite(price) || !stacks?.length) return false;
  const line = normalizeBoardLine(point);
  if (line == null) return false;
  return stacks.some((s) => s.line === line && s.price === price);
}

export function oddsBoardSidePoint(game, bookKey, market, which) {
  const b = game?.bookOdds?.[bookKey];
  if (!b) return null;
  if (market === "spr") return which === "top" ? b.spr_away_line : b.spr_home_line;
  if (market === "tot") return b.tot_line;
  return null;
}

export function bestBooksTitle(books, labelOf) {
  if (!books || !books.length) return "";
  return books.map((b) => (labelOf ? labelOf(b.key) : null) || b.key).join(" · ");
}

export function formatDateGroup(commence_time) {
  return new Date(commence_time).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function selectedBooks(allBooks, selectedBookKeys) {
  return (allBooks || []).filter((b) => selectedBookKeys.has(b.key));
}

function lineFieldForPriceKey(priceKey) {
  if (priceKey === "spr_away") return "spr_away_line";
  if (priceKey === "spr_home") return "spr_home_line";
  if (priceKey === "tot_over" || priceKey === "tot_under") return "tot_line";
  return null;
}

function sideEntries(vals, game, priceKey, sizeKey, hiddenKeys) {
  const hide = hideSideFromPriceKey(priceKey);
  const lineField = lineFieldForPriceKey(priceKey);
  return vals.map((b) => ({
    key: b.key,
    price: game.bookOdds?.[b.key]?.[priceKey],
    size: game.bookOdds?.[b.key]?.[sizeKey],
    updatedAt: game.bookLineUpdatedAt?.[b.key]?.[priceKey],
    line: lineField ? game.bookOdds?.[b.key]?.[lineField] : null,
    hidden: !!(hide && isHiddenOddsCell(hiddenKeys, {
      gameId: game?.id,
      market: hide.market,
      side: hide.side,
      bookKey: b.key,
    })),
  }));
}

function sideFromMap(vals, game, priceKey, sizeKey, freshness, hiddenKeys) {
  return pickBestSide(sideEntries(vals, game, priceKey, sizeKey, hiddenKeys), freshness);
}

function stackedPointBlocks(vals, game, market, freshness, hiddenKeys) {
  const topPrice = market === "spr" ? "spr_away" : "tot_over";
  const topSize = market === "spr" ? "spr_away_size" : "tot_over_size";
  const botPrice = market === "spr" ? "spr_home" : "tot_under";
  const botSize = market === "spr" ? "spr_home_size" : "tot_under_size";
  return pickBestByPopularPoints(
    sideEntries(vals, game, topPrice, topSize, hiddenKeys),
    sideEntries(vals, game, botPrice, botSize, hiddenKeys),
    freshness,
    { market, maxPoints: STACKED_BEST_MAX_LINES },
  );
}

function applyStackedPointBlocks(cell, blocks) {
  cell.pointStacks = blocks;
  cell.topStacks = blocks.map((b) => b.top);
  cell.botStacks = blocks.map((b) => b.bot);
  const firstTop = cell.topStacks[0];
  const firstBot = cell.botStacks[0];
  cell.top = firstTop?.price ?? null;
  cell.topSize = firstTop?.size ?? null;
  cell.topBooks = firstTop?.books ?? [];
  cell.topLine = firstTop?.lineLabel ?? null;
  cell.bot = firstBot?.price ?? null;
  cell.botSize = firstBot?.size ?? null;
  cell.botBooks = firstBot?.books ?? [];
  cell.botLine = firstBot?.lineLabel ?? null;
  return cell;
}

function fmtSpreadLine(point) {
  if (point == null) return null;
  return point > 0 ? `+${point}` : `${point}`;
}

function emptyCell(threeWay) {
  return {
    top: null,
    mid: null,
    bot: null,
    topSize: null,
    midSize: null,
    botSize: null,
    topNo: null,
    midNo: null,
    botNo: null,
    topNoSize: null,
    midNoSize: null,
    botNoSize: null,
    topBooks: [],
    midBooks: [],
    botBooks: [],
    topNoBooks: [],
    midNoBooks: [],
    botNoBooks: [],
    topLine: null,
    botLine: null,
    topStacks: null,
    botStacks: null,
    pointStacks: null,
    threeWay,
  };
}

export function getOddsBoardCell({ game, bookKey, market, selectedBookKeys, allBooks, nowMs, maxBestAgeMs, hiddenKeys, stackedBest }) {
  const threeWay = !!(game?.is_three_way || isSoccerSport(game?.sport));
  const vals = selectedBooks(allBooks, selectedBookKeys);
  const freshness = liveBestFreshness({ game, nowMs, maxBestAgeMs });

  if (bookKey === "best") {
    if (market === "ml") {
      const top = sideFromMap(vals, game, "ml_away", "ml_away_size", freshness, hiddenKeys);
      const mid = sideFromMap(vals, game, "ml_draw", "ml_draw_size", freshness, hiddenKeys);
      const bot = sideFromMap(vals, game, "ml_home", "ml_home_size", freshness, hiddenKeys);
      const topNo = sideFromMap(vals, game, "ml_away_no", "ml_away_no_size", freshness, hiddenKeys);
      const midNo = sideFromMap(vals, game, "ml_draw_no", "ml_draw_no_size", freshness, hiddenKeys);
      const botNo = sideFromMap(vals, game, "ml_home_no", "ml_home_no_size", freshness, hiddenKeys);
      return {
        ...emptyCell(threeWay),
        top: top.price,
        mid: threeWay ? mid.price : null,
        bot: bot.price,
        topSize: top.size,
        midSize: threeWay ? mid.size : null,
        botSize: bot.size,
        topNo: threeWay ? topNo.price : null,
        midNo: threeWay ? midNo.price : null,
        botNo: threeWay ? botNo.price : null,
        topNoSize: threeWay ? topNo.size : null,
        midNoSize: threeWay ? midNo.size : null,
        botNoSize: threeWay ? botNo.size : null,
        topBooks: top.books,
        midBooks: threeWay ? mid.books : [],
        botBooks: bot.books,
        topNoBooks: threeWay ? topNo.books : [],
        midNoBooks: threeWay ? midNo.books : [],
        botNoBooks: threeWay ? botNo.books : [],
      };
    }
    if (market === "spr") {
      if (stackedBest) {
        return applyStackedPointBlocks(emptyCell(false), stackedPointBlocks(vals, game, "spr", freshness, hiddenKeys));
      }
      const top = sideFromMap(vals, game, "spr_away", "spr_away_size", freshness, hiddenKeys);
      const bot = sideFromMap(vals, game, "spr_home", "spr_home_size", freshness, hiddenKeys);
      const dkb = game.bookOdds?.draftkings;
      return {
        ...emptyCell(false),
        top: top.price,
        bot: bot.price,
        topSize: top.size,
        botSize: bot.size,
        topBooks: top.books,
        botBooks: bot.books,
        topLine: fmtSpreadLine(dkb?.spr_away_line),
        botLine: fmtSpreadLine(dkb?.spr_home_line),
      };
    }
    if (market === "tot") {
      if (stackedBest) {
        return applyStackedPointBlocks(emptyCell(false), stackedPointBlocks(vals, game, "tot", freshness, hiddenKeys));
      }
      const top = sideFromMap(vals, game, "tot_over", "tot_over_size", freshness, hiddenKeys);
      const bot = sideFromMap(vals, game, "tot_under", "tot_under_size", freshness, hiddenKeys);
      const dkb = game.bookOdds?.draftkings;
      return {
        ...emptyCell(false),
        top: top.price,
        bot: bot.price,
        topSize: top.size,
        botSize: bot.size,
        topBooks: top.books,
        botBooks: bot.books,
        topLine: dkb?.tot_line ? `o${dkb.tot_line}` : null,
        botLine: dkb?.tot_line ? `u${dkb.tot_line}` : null,
      };
    }
    return emptyCell(threeWay);
  }

  const b = game.bookOdds?.[bookKey];
  if (!b) return emptyCell(threeWay);
  const one = (key, size) => (b[key] == null ? [] : [{ key: bookKey, size: b[size] ?? null }]);
  if (market === "ml") {
    return {
      ...emptyCell(threeWay),
      top: b.ml_away,
      mid: threeWay ? b.ml_draw : null,
      bot: b.ml_home,
      topSize: b.ml_away_size ?? null,
      midSize: threeWay ? (b.ml_draw_size ?? null) : null,
      botSize: b.ml_home_size ?? null,
      topNo: threeWay ? b.ml_away_no : null,
      midNo: threeWay ? b.ml_draw_no : null,
      botNo: threeWay ? b.ml_home_no : null,
      topNoSize: threeWay ? (b.ml_away_no_size ?? null) : null,
      midNoSize: threeWay ? (b.ml_draw_no_size ?? null) : null,
      botNoSize: threeWay ? (b.ml_home_no_size ?? null) : null,
      topBooks: one("ml_away", "ml_away_size"),
      midBooks: threeWay ? one("ml_draw", "ml_draw_size") : [],
      botBooks: one("ml_home", "ml_home_size"),
      topNoBooks: threeWay ? one("ml_away_no", "ml_away_no_size") : [],
      midNoBooks: threeWay ? one("ml_draw_no", "ml_draw_no_size") : [],
      botNoBooks: threeWay ? one("ml_home_no", "ml_home_no_size") : [],
    };
  }
  if (market === "spr") {
    return {
      ...emptyCell(false),
      top: b.spr_away,
      bot: b.spr_home,
      topSize: b.spr_away_size ?? null,
      botSize: b.spr_home_size ?? null,
      topBooks: one("spr_away", "spr_away_size"),
      botBooks: one("spr_home", "spr_home_size"),
      topLine: fmtSpreadLine(b.spr_away_line),
      botLine: fmtSpreadLine(b.spr_home_line),
    };
  }
  if (market === "tot") {
    return {
      ...emptyCell(false),
      top: b.tot_over,
      bot: b.tot_under,
      topSize: b.tot_over_size ?? null,
      botSize: b.tot_under_size ?? null,
      topBooks: one("tot_over", "tot_over_size"),
      botBooks: one("tot_under", "tot_under_size"),
      topLine: b.tot_line ? `o${b.tot_line}` : null,
      botLine: b.tot_line ? `u${b.tot_line}` : null,
    };
  }
  return emptyCell(threeWay);
}

export function getBestForGame(game, market, selectedBookKeys, allBooks, freshnessOpts) {
  const cell = getOddsBoardCell({
    game,
    bookKey: "best",
    market,
    selectedBookKeys,
    allBooks,
    ...(freshnessOpts || {}),
  });
  return {
    bestAway: cell.top,
    bestHome: cell.bot,
    bestDraw: cell.mid,
    awayStacks: cell.topStacks,
    homeStacks: cell.botStacks,
    pointStacks: cell.pointStacks,
  };
}

export function pickBestFromPriceMap(priceMap, sizeMap, selectedBookKeys, allBooks) {
  return pickBestSide(
    selectedBooks(allBooks, selectedBookKeys).map((b) => ({
      key: b.key,
      price: priceMap?.[b.key],
      size: sizeMap?.[b.key],
    })),
  );
}
