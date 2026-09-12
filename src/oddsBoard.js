// Odds Board cell helpers. Liquidity is top-of-book only: `size` or `bet_limit`
// already on transformed bookOdds — never invent depth or $0.

import { isSoccerSport } from "./soccerPairing.js";

export function fmtBoardSize(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
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

export function pickBestSide(entries) {
  let best = null;
  const books = [];
  for (const entry of entries || []) {
    const price = entry?.price;
    if (price == null || !isFinite(price)) continue;
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

function sideFromMap(vals, game, priceKey, sizeKey) {
  return pickBestSide(vals.map((b) => ({
    key: b.key,
    price: game.bookOdds?.[b.key]?.[priceKey],
    size: game.bookOdds?.[b.key]?.[sizeKey],
  })));
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
    threeWay,
  };
}

export function getOddsBoardCell({ game, bookKey, market, selectedBookKeys, allBooks }) {
  const threeWay = !!(game?.is_three_way || isSoccerSport(game?.sport));
  const vals = selectedBooks(allBooks, selectedBookKeys);

  if (bookKey === "best") {
    if (market === "ml") {
      const top = sideFromMap(vals, game, "ml_away", "ml_away_size");
      const mid = sideFromMap(vals, game, "ml_draw", "ml_draw_size");
      const bot = sideFromMap(vals, game, "ml_home", "ml_home_size");
      const topNo = sideFromMap(vals, game, "ml_away_no", "ml_away_no_size");
      const midNo = sideFromMap(vals, game, "ml_draw_no", "ml_draw_no_size");
      const botNo = sideFromMap(vals, game, "ml_home_no", "ml_home_no_size");
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
      const top = sideFromMap(vals, game, "spr_away", "spr_away_size");
      const bot = sideFromMap(vals, game, "spr_home", "spr_home_size");
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
      const top = sideFromMap(vals, game, "tot_over", "tot_over_size");
      const bot = sideFromMap(vals, game, "tot_under", "tot_under_size");
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

export function getBestForGame(game, market, selectedBookKeys, allBooks) {
  const cell = getOddsBoardCell({
    game,
    bookKey: "best",
    market,
    selectedBookKeys,
    allBooks,
  });
  return {
    bestAway: cell.top,
    bestHome: cell.bot,
    bestDraw: cell.mid,
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
