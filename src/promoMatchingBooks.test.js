import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { transformOddsData } from "./oddsTransform.js";
import {
  MATCHING_BOOKS_STORAGE_KEY,
  excludedFromMatching,
  loadExcludedMatchingBooks,
  loadMatchingBookKeys,
  matchingBookList,
  matchingKeysFromExcluded,
  matchingSetIsFull,
  parseExcludedMatchingBooks,
  saveExcludedMatchingBooks,
  toggleMatchingBookKey,
} from "./promoMatchingBooks.js";

const require = createRequire(import.meta.url);
const { ALL_BOOKS, TRUSTED_BOOK_KEYS, buildAllLegsForBook } = require("../lib/promo-ev.js");

const dir = path.dirname(fileURLToPath(import.meta.url));

function memoryStorage(init = {}) {
  const map = { ...init };
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    data: map,
  };
}

function futureGame() {
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  return {
    commence_time: future,
    away_team: "Yankees",
    home_team: "Red Sox",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -120 }, { name: "Red Sox", price: 100 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: -110, point: -1.5 }, { name: "Red Sox", price: -110, point: 1.5 }] },
        ],
      },
      {
        key: "fanduel",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -110 }, { name: "Red Sox", price: 105 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: -105, point: -1.5 }, { name: "Red Sox", price: -115, point: 1.5 }] },
        ],
      },
      {
        key: "hardrockbet",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: -100 }, { name: "Red Sox", price: 200 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: 150, point: -1.5 }, { name: "Red Sox", price: 150, point: 1.5 }] },
        ],
      },
      {
        key: "espnbet",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: 140 }, { name: "Red Sox", price: -160 }] },
          { key: "spreads", outcomes: [{ name: "Yankees", price: 130, point: -1.5 }, { name: "Red Sox", price: 140, point: 1.5 }] },
        ],
      },
      {
        key: "betanysports",
        markets: [
          { key: "h2h", outcomes: [{ name: "Yankees", price: 400 }, { name: "Red Sox", price: -500 }] },
        ],
      },
    ],
  };
}

// ── Default matching set equals full TRUSTED_BOOK_KEYS
{
  const matching = matchingKeysFromExcluded(new Set(), TRUSTED_BOOK_KEYS);
  assert.equal(matchingSetIsFull(matching, TRUSTED_BOOK_KEYS), true);
  assert.deepEqual([...matching].sort(), [...TRUSTED_BOOK_KEYS].sort());
  const chips = matchingBookList(ALL_BOOKS, TRUSTED_BOOK_KEYS);
  assert.deepEqual(chips.map((b) => b.key), [
    "draftkings", "fanduel", "williamhill_us", "betmgm", "betrivers",
    "fanatics", "hardrockbet", "betparx", "ballybet", "espnbet", "bovada", "mybookieag", "betonlineag",
    "bookmaker", "pinnacle", "betus", "kalshi", "novig", "prophetx", "polymarket",
    "underdog_predict",
  ]);
  assert.equal(chips.find((b) => b.key === "pinnacle")?.label, "Pinnacle");
  assert.equal(chips.find((b) => b.key === "betus")?.label, "BetUS");
  assert.equal(chips.find((b) => b.key === "bookmaker")?.label, "Bookmaker");
  for (const key of ["betanysports", "betopenly", "lowvig", "betcris"]) {
    assert.equal(TRUSTED_BOOK_KEYS.has(key), false);
    assert.ok(!chips.some((b) => b.key === key));
  }
  assert.equal(chips.find((b) => b.key === "hardrockbet")?.label, "Hard Rock");
  assert.equal(chips.find((b) => b.key === "espnbet")?.label, "theScore Bet");
}

// ── Unchecking hardrockbet + espnbet drops them from getBestOdds / opp counts;
//    promo book (DK) offer odds still used
{
  const games = [futureGame()];
  const full = transformOddsData(games, "baseball_mlb", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const matching = matchingKeysFromExcluded(new Set(["hardrockbet", "espnbet"]), TRUSTED_BOOK_KEYS);
  assert.equal(matching.has("hardrockbet"), false);
  assert.equal(matching.has("espnbet"), false);
  assert.equal(matching.has("draftkings"), true);
  const filtered = transformOddsData(games, "baseball_mlb", matching, ALL_BOOKS);

  const fullMl = full.moneylines[0];
  const filtMl = filtered.moneylines[0];
  assert.ok(fullMl && filtMl);

  // Full trusted set: Hard Rock posts the juiciest home ML; theScore the juiciest away.
  assert.equal(fullMl.best_home, 200);
  assert.equal(fullMl.best_home_book, "hardrockbet");
  assert.equal(fullMl.best_away, 140);
  assert.equal(fullMl.best_away_book, "espnbet");
  assert.equal(fullMl.ml_opp_count_away, 4);
  assert.equal(fullMl.ml_opp_count_home, 4);

  // Unchecked books never set best / opp-count.
  assert.equal(filtMl.best_home, 105);
  assert.equal(filtMl.best_home_book, "fanduel");
  assert.equal(filtMl.best_away, -110);
  assert.equal(filtMl.best_away_book, "fanduel");
  assert.equal(filtMl.ml_opp_count_away, 2);
  assert.equal(filtMl.ml_opp_count_home, 2);
  assert.notEqual(filtMl.best_home_book, "hardrockbet");
  assert.notEqual(filtMl.best_away_book, "espnbet");

  // Offer side still prices DK (and even stores Hard Rock's own number).
  assert.equal(filtMl.bookOdds.draftkings.ml_away, -120);
  assert.equal(filtMl.bookOdds.draftkings.ml_home, 100);
  assert.equal(filtMl.bookOdds.hardrockbet.ml_home, 200);
  assert.equal(filtMl.bookOdds.espnbet.ml_away, 140);

  const dkFull = buildAllLegsForBook(full, "draftkings").find((l) => l.name === "Yankees ML");
  const dkFilt = buildAllLegsForBook(filtered, "draftkings").find((l) => l.name === "Yankees ML");
  assert.ok(dkFull && dkFilt);
  assert.equal(dkFull.dk, -120);
  assert.equal(dkFilt.dk, -120);
  assert.equal(dkFull.bestOpp, 200);
  assert.equal(dkFull.bestOppBook, "hardrockbet");
  assert.equal(dkFilt.bestOpp, 105);
  assert.equal(dkFilt.bestOppBook, "fanduel");

  const dkSprFull = full.run_lines.find((r) => r.book === "draftkings");
  const dkSprFilt = filtered.run_lines.find((r) => r.book === "draftkings");
  assert.ok(dkSprFull && dkSprFilt);
  assert.equal(dkSprFull.away_odds, -110);
  assert.equal(dkSprFilt.away_odds, -110);
  assert.equal(dkSprFull.bestOpp_away, 150);
  assert.equal(dkSprFull.bestOpp_away_book, "hardrockbet");
  assert.equal(dkSprFull.bestOppCount_away, 4);
  assert.equal(dkSprFilt.bestOpp_away, -110);
  assert.equal(dkSprFilt.bestOpp_away_book, "draftkings");
  assert.equal(dkSprFilt.bestOppCount_away, 2);
}

// ── Unchecked promo book still prices the offer; it just drops out of fair/best
{
  const games = [futureGame()];
  const matching = matchingKeysFromExcluded(new Set(["draftkings"]), TRUSTED_BOOK_KEYS);
  const data = transformOddsData(games, "baseball_mlb", matching, ALL_BOOKS);
  const yankees = buildAllLegsForBook(data, "draftkings").find((l) => l.name === "Yankees ML");
  assert.ok(yankees);
  assert.equal(yankees.dk, -120);
  assert.notEqual(yankees.bestOppBook, "draftkings");
  assert.equal(data.moneylines[0].best_home_book, "hardrockbet");
}

// ── localStorage: empty / invalid = all on; restore exclude set
{
  const empty = memoryStorage();
  assert.equal(loadExcludedMatchingBooks(TRUSTED_BOOK_KEYS, empty).size, 0);
  assert.equal(matchingSetIsFull(loadMatchingBookKeys(TRUSTED_BOOK_KEYS, empty), TRUSTED_BOOK_KEYS), true);

  const missing = memoryStorage();
  delete missing.data[MATCHING_BOOKS_STORAGE_KEY];
  assert.deepEqual([...loadMatchingBookKeys(TRUSTED_BOOK_KEYS, missing)].sort(), [...TRUSTED_BOOK_KEYS].sort());

  for (const raw of ["", "{", "null", "123", "{}", `["not-a-book"]`]) {
    assert.equal(parseExcludedMatchingBooks(raw, TRUSTED_BOOK_KEYS).size, 0);
  }

  const stored = memoryStorage({
    [MATCHING_BOOKS_STORAGE_KEY]: JSON.stringify(["hardrockbet", "espnbet"]),
  });
  const restored = loadMatchingBookKeys(TRUSTED_BOOK_KEYS, stored);
  assert.equal(restored.has("hardrockbet"), false);
  assert.equal(restored.has("espnbet"), false);
  assert.equal(restored.has("draftkings"), true);
  assert.equal(restored.size, TRUSTED_BOOK_KEYS.size - 2);

  const matching = matchingKeysFromExcluded(new Set(["hardrockbet"]), TRUSTED_BOOK_KEYS);
  const out = memoryStorage();
  saveExcludedMatchingBooks(matching, TRUSTED_BOOK_KEYS, out);
  assert.deepEqual(JSON.parse(out.getItem(MATCHING_BOOKS_STORAGE_KEY)), ["hardrockbet"]);
  assert.deepEqual(excludedFromMatching(matching, TRUSTED_BOOK_KEYS), ["hardrockbet"]);

  // Persisting every trusted key is treated as invalid on read (all on).
  const allOff = memoryStorage({
    [MATCHING_BOOKS_STORAGE_KEY]: JSON.stringify([...TRUSTED_BOOK_KEYS]),
  });
  assert.equal(matchingSetIsFull(loadMatchingBookKeys(TRUSTED_BOOK_KEYS, allOff), TRUSTED_BOOK_KEYS), true);
}

// ── Cannot empty the matching set
{
  let matching = new Set(TRUSTED_BOOK_KEYS);
  for (const key of [...TRUSTED_BOOK_KEYS].slice(1)) {
    matching = toggleMatchingBookKey(matching, key, TRUSTED_BOOK_KEYS);
  }
  assert.equal(matching.size, 1);
  const last = [...matching][0];
  const blocked = toggleMatchingBookKey(matching, last, TRUSTED_BOOK_KEYS);
  assert.equal(blocked, matching);
  assert.ok(blocked.has(last));
  assert.equal(blocked.size, 1);

  const again = toggleMatchingBookKey(blocked, last, TRUSTED_BOOK_KEYS);
  assert.equal(again.size, 1);
}

// ── App.jsx Extra Filters source: label + chip map + rebuild on matching set
{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /Matching books/);
  assert.match(app, /ALL_BOOKS\.filter\(b => trustedVisible\.has\(b\.key\)\)\.map/);
  assert.match(app, /function transformOddsData\(gamesArray, sportKey, trustedBookKeys = TRUSTED_BOOK_KEYS\)/);
  assert.match(app, /transformOddsData\(row\.data, row\.sport, scanMatchingBookKeys\)/);
  assert.match(app, /transformEventOddsData\(row\.data, row\.sport, scanMatchingBookKeys\)/);
  assert.match(app, /hideLowLiquidity, scanMatchingBookKeys, scanTeamInclude, scanTeamExclude\]/);
  assert.match(app, /setExcludedPromoLegs\(new Set\(\)\)/);
  assert.match(app, /buildAllLegsForBook\(promoOddsForPromo,/);
  assert.match(app, /buildAllLegsAllBooks\(allOddsData,/);
  assert.doesNotMatch(app, /localStorage/);
}

// ── promo-ev.js TRUSTED_BOOK_KEYS unchanged (EV alerts still include Hard Rock / theScore)
{
  const ev = fs.readFileSync(path.join(dir, "../lib/promo-ev.js"), "utf8");
  assert.match(ev, /function transformOddsData\(gamesArray, sportKey\)/);
  const evTrusted = ev.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(evTrusted, "promo-ev.js TRUSTED_BOOK_KEYS block");
  assert.ok(evTrusted[1].includes("hardrockbet"));
  assert.ok(evTrusted[1].includes("espnbet"));
  assert.ok(evTrusted[1].includes("draftkings"));
  assert.ok(evTrusted[1].includes("pinnacle"));
  assert.ok(evTrusted[1].includes("betus"));
  assert.ok(evTrusted[1].includes("bookmaker"));
  assert.ok(!evTrusted[1].includes("betcris"));
  assert.ok(!evTrusted[1].includes("betanysports"));
  assert.ok(!evTrusted[1].includes("betopenly"));
  assert.match(ev, /this EV-scanner copy always uses the full TRUSTED_BOOK_KEYS set/);
  assert.equal(TRUSTED_BOOK_KEYS.has("hardrockbet"), true);
  assert.equal(TRUSTED_BOOK_KEYS.has("espnbet"), true);
  assert.equal(TRUSTED_BOOK_KEYS.has("pinnacle"), true);
  assert.equal(TRUSTED_BOOK_KEYS.has("betus"), true);
}


// Player TDs survive a partial Matching books selection, and the fair price
// is re-picked among selected venues only (never Fliff / Courtside).
{
  const td = await import("../lib/player-td.mjs");
  const now = Date.parse("2026-09-26T04:00:00Z");
  const game = {
    sport: "americanfootball_nfl",
    away: "Los Angeles Chargers",
    home: "Buffalo Bills",
    commence_time: "2026-09-27T17:00:00Z",
    gameKey: "LAC|BUF|2026-09-27",
    players: [
      {
        name: "Dalton Kincaid",
        markets: {
          anytime: {
            offers: [{ book: "draftkings", price: 170 }, { book: "fliff", price: 400 }],
            opp: { price: -150, book: "polymarket", count: 2, source: "exchange", size: 900, levels: [{ american: -150, size: 900 }] },
            opps: [
              { price: -150, book: "polymarket", source: "exchange", size: 900, levels: [{ american: -150, size: 900 }] },
              { price: -165, book: "kalshi", source: "exchange", size: 120, levels: [{ american: -165, size: 120 }, { american: -180, size: 400 }] },
              { price: -120, book: "fliff", source: "exchange", size: 5000 },
              { price: -175, book: "pinnacle", source: "devig", count: 1 },
            ],
          },
        },
      },
      {
        // Row cached before per-venue storage: only opp.
        name: "Josh Allen",
        markets: { anytime: { offers: [{ book: "draftkings", price: 120 }], opp: { price: -140, book: "kalshi", count: 1, source: "exchange" } } },
      },
    ],
  };
  const base = { now, sportFilter: ["americanfootball_nfl"] };
  const full = td.playerTdLegsForBook([game], "draftkings", base);
  assert.equal(full.length, 2);
  const kincaid = full.find((l) => l.name.startsWith("Dalton"));
  assert.equal(kincaid.bestOpp, -150);
  assert.equal(kincaid.bestOppBook, "polymarket");
  assert.equal(kincaid.bestOppSize, 900, "stored No size reaches the leg as bestOppSize");
  // Combined Kalshi + Polymarket No book, best first, for the $500 blend.
  assert.deepEqual(kincaid.bestOppLevels, [
    { american: -150, size: 900, book: "polymarket" },
    { american: -165, size: 120, book: "kalshi" },
    { american: -180, size: 400, book: "kalshi" },
  ]);

  // Polymarket unchecked: Kalshi prices Kincaid; Allen (kalshi) stays.
  const noPm = new Set([...TRUSTED_BOOK_KEYS].filter((k) => k !== "polymarket"));
  const partial = td.playerTdLegsForBook([game], "draftkings", { ...base, matchingBooks: noPm });
  const k2 = partial.find((l) => l.name.startsWith("Dalton"));
  assert.equal(k2.bestOpp, -165);
  assert.equal(k2.bestOppBook, "kalshi");
  assert.equal(k2.bestOppSize, 120);
  assert.deepEqual(k2.bestOppLevels.map((l) => l.book), ["kalshi", "kalshi"], "an unchecked venue's ladder is not merged");
  assert.ok(partial.some((l) => l.name.startsWith("Josh")));

  // Only a de-vig book selected: the de-vig prices it. Fliff never does.
  const devigOnly = td.playerTdLegsForBook([game], "draftkings", { ...base, matchingBooks: ["pinnacle", "fliff"] });
  assert.equal(devigOnly.length, 1);
  assert.equal(devigOnly[0].bestOpp, -175);
  assert.equal(devigOnly[0].bestOppBook, "pinnacle");
  assert.equal(devigOnly[0].bestOppLevels, undefined, "a de-vig price has no ladder");
  assert.equal(td.playerTdLegsForBook([game], "draftkings", { ...base, matchingBooks: ["fliff"] }).length, 0);
  assert.equal(td.playerTdLegsForBook([game], "fliff", base).length, 0);

  // Allen's only venue (kalshi) unchecked → dropped; Kincaid re-priced.
  const noKalshiNoPm = new Set([...TRUSTED_BOOK_KEYS].filter((k) => k !== "kalshi" && k !== "polymarket"));
  const p3 = td.playerTdLegsForBook([game], "draftkings", { ...base, matchingBooks: noKalshiNoPm });
  assert.deepEqual(p3.map((l) => l.name), ["Dalton Kincaid 1+ TD"]);
  assert.equal(p3[0].bestOppBook, "pinnacle");

  // The .cjs copy used by API routes behaves the same.
  const tdCjs = require("../lib/player-td.cjs");
  assert.deepEqual(
    tdCjs.playerTdLegsForBook([game], "draftkings", { ...base, matchingBooks: noPm }),
    partial,
  );

  // App wiring: rebuilt (partial) board keeps playerTds and the leg builder
  // gets the selection only when it is partial.
  const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"), "utf8");
  assert.match(app, /return withPlayerTds\(mergeOddsData\(\[/);
  assert.match(app, /function withPlayerTds\(board, source\)/);
  assert.match(app, /matchingBooks: promoMatchingPartial \? scanMatchingBookKeys : null/);
  assert.match(app, /matchingBooks: opts && opts\.matchingBooks \? opts\.matchingBooks : null/);
}

console.log("promoMatchingBooks.test.js: ok");
