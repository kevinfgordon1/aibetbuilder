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
    "fanatics", "hardrockbet", "espnbet", "bovada", "mybookieag", "betonlineag",
    "kalshi", "novig", "prophetx", "polymarket",
  ]);
  for (const key of ["betanysports", "betopenly", "lowvig", "betus"]) {
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
  assert.match(app, /ALL_BOOKS\.filter\(b => TRUSTED_BOOK_KEYS\.has\(b\.key\)\)\.map/);
  assert.match(app, /function transformOddsData\(gamesArray, sportKey, trustedBookKeys = TRUSTED_BOOK_KEYS\)/);
  assert.match(app, /transformOddsData\(row\.data, row\.sport, matchingBookKeys\)/);
  assert.match(app, /transformEventOddsData\(row\.data, row\.sport, matchingBookKeys\)/);
  assert.match(app, /excludedPromoLegs, matchingBookKeys\]/);
  assert.match(app, /buildAllLegsForBook\(promoOddsData,/);
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
  assert.ok(!evTrusted[1].includes("betanysports"));
  assert.ok(!evTrusted[1].includes("betopenly"));
  assert.match(ev, /this EV-scanner copy always uses the full TRUSTED_BOOK_KEYS set/);
  assert.equal(TRUSTED_BOOK_KEYS.has("hardrockbet"), true);
  assert.equal(TRUSTED_BOOK_KEYS.has("espnbet"), true);
}

console.log("promoMatchingBooks.test.js: ok");
