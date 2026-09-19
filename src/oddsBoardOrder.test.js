import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ODDS_BOARD_ORDER_STORAGE_PREFIX,
  oddsBoardOrderStorageKey,
  oddsBoardSlateKey,
  emptyOddsBoardOrder,
  sanitizeKeyList,
  normalizeOddsBoardOrder,
  loadOddsBoardOrder,
  saveOddsBoardOrder,
  applyKeyOrder,
  applyGameRowOrder,
  applyBookColumnOrder,
  reorderKeys,
  moveKeyAmongVisible,
  moveKeyByOffset,
  groupGamesPreservingOrder,
} from "./oddsBoardOrder.js";

const kevin = { id: "uid-kevin", email: "kev120909@gmail.com" };
const kenneth = { id: "uid-kenneth", email: "kmguido97@gmail.com" };

assert.equal(ODDS_BOARD_ORDER_STORAGE_PREFIX, "aibetbuilder.newOddsBoard.order");
assert.equal(oddsBoardOrderStorageKey(kevin), "aibetbuilder.newOddsBoard.order.uid-kevin");
assert.equal(oddsBoardOrderStorageKey(kenneth), "aibetbuilder.newOddsBoard.order.uid-kenneth");
assert.notEqual(oddsBoardOrderStorageKey(kevin), oddsBoardOrderStorageKey(kenneth));
assert.equal(oddsBoardOrderStorageKey(null), "aibetbuilder.newOddsBoard.order.anon");
assert.equal(oddsBoardSlateKey("americanfootball_ncaaf", true), "americanfootball_ncaaf:live");
assert.equal(oddsBoardSlateKey("americanfootball_ncaaf", false), "americanfootball_ncaaf:pregame");

assert.deepEqual(sanitizeKeyList(["fanduel", "best", "draftkings", "fanduel", "", null]), ["fanduel", "draftkings"]);
assert.deepEqual(sanitizeKeyList("nope"), []);

assert.deepEqual(applyKeyOrder(["a", "b", "c"], []), ["a", "b", "c"]);
assert.deepEqual(applyKeyOrder(["a", "b", "c"], ["c", "a"]), ["c", "a", "b"], "new keys append after saved order");
assert.deepEqual(applyKeyOrder(["a", "b"], ["z", "b", "a"]), ["b", "a"], "unknown saved keys are ignored");

{
  const games = [{ id: "ccu-del" }, { id: "mer-gt" }, { id: "unt-txst" }];
  assert.deepEqual(applyGameRowOrder(games, ["unt-txst", "ccu-del"]).map((g) => g.id), ["unt-txst", "ccu-del", "mer-gt"]);
  assert.deepEqual(applyGameRowOrder(games, []).map((g) => g.id), ["ccu-del", "mer-gt", "unt-txst"]);
  assert.deepEqual(applyGameRowOrder(games, ["unt-txst", "ccu-del"]).map((g) => g.id), ["unt-txst", "ccu-del", "mer-gt"]);
  const refreshed = [{ id: "ccu-del", price: 2 }, { id: "mer-gt", price: 3 }, { id: "unt-txst", price: 4 }];
  assert.deepEqual(
    applyGameRowOrder(refreshed, ["unt-txst", "ccu-del"]).map((g) => [g.id, g.price]),
    [["unt-txst", 4], ["ccu-del", 2], ["mer-gt", 3]],
    "live ticks keep custom order",
  );
}

{
  const books = [{ key: "fanduel" }, { key: "draftkings" }, { key: "pinnacle" }];
  assert.deepEqual(applyBookColumnOrder(books, ["pinnacle", "fanduel"]).map((b) => b.key), ["pinnacle", "fanduel", "draftkings"]);
  assert.deepEqual(applyBookColumnOrder(books, ["best", "pinnacle"]).map((b) => b.key), ["pinnacle", "fanduel", "draftkings"]);
}

assert.deepEqual(reorderKeys(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
assert.deepEqual(reorderKeys(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
assert.deepEqual(reorderKeys(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
assert.deepEqual(reorderKeys(["a", "b", "c"], -1, 1), ["a", "b", "c"]);

{
  const visible = ["ccu-del", "mer-gt", "unt-txst"];
  assert.deepEqual(moveKeyAmongVisible(visible, "unt-txst", "ccu-del", []), ["unt-txst", "ccu-del", "mer-gt"]);
  assert.deepEqual(
    moveKeyAmongVisible(["mer-gt"], "mer-gt", "ghost", ["unt-txst", "ccu-del", "mer-gt"]),
    ["mer-gt", "unt-txst", "ccu-del"],
    "drop on an unknown row leaves visible order and keeps saved ids",
  );
  assert.deepEqual(
    moveKeyAmongVisible(["ccu-del", "mer-gt"], "mer-gt", "ccu-del", ["unt-txst", "ccu-del", "mer-gt"]),
    ["mer-gt", "ccu-del", "unt-txst"],
    "hidden/saved ids that are not on screen stay after the visible slate",
  );
}

{
  const games = [
    { id: "sat-1", day: "Sat" },
    { id: "sun-1", day: "Sun" },
    { id: "sat-2", day: "Sat" },
  ];
  const blocks = groupGamesPreservingOrder(games, (g) => g.day);
  assert.deepEqual(blocks.map((b) => [b.dateKey, b.games.map((g) => g.id)]), [
    ["Sat", ["sat-1"]],
    ["Sun", ["sun-1"]],
    ["Sat", ["sat-2"]],
  ]);
}

assert.deepEqual(moveKeyByOffset(["a", "b", "c"], "a", 1, []), ["b", "a", "c"]);
assert.deepEqual(moveKeyByOffset(["a", "b", "c"], "c", -1, []), ["a", "c", "b"]);
assert.deepEqual(moveKeyByOffset(["a", "b", "c"], "a", -1, []), ["a", "b", "c"]);
assert.deepEqual(moveKeyByOffset(["a", "b", "c"], "c", 1, []), ["a", "b", "c"]);

{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  };
  assert.deepEqual(loadOddsBoardOrder(kevin, storage), emptyOddsBoardOrder());
  const saved = saveOddsBoardOrder(kevin, {
    bookKeys: ["pinnacle", "best", "fanduel", "fanduel"],
    gamesBySlate: {
      "americanfootball_ncaaf:live": ["unt-txst", "ccu-del"],
      "americanfootball_nfl:pregame": [],
    },
  }, storage);
  assert.deepEqual(saved.bookKeys, ["pinnacle", "fanduel"]);
  assert.deepEqual(saved.gamesBySlate["americanfootball_ncaaf:live"], ["unt-txst", "ccu-del"]);
  assert.equal(saved.gamesBySlate["americanfootball_nfl:pregame"], undefined);
  assert.deepEqual(loadOddsBoardOrder(kevin, storage), saved);
  assert.deepEqual(loadOddsBoardOrder(kenneth, storage), emptyOddsBoardOrder(), "order is per user");
  storage.setItem(oddsBoardOrderStorageKey(kevin), "{not json");
  assert.deepEqual(loadOddsBoardOrder(kevin, storage), emptyOddsBoardOrder());
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const stamp = fs.readFileSync(path.join(dir, "BetstampOddsBoard.jsx"), "utf8");
  const board = fs.readFileSync(path.join(dir, "OddsBoard.jsx"), "utf8");
  const pkg = fs.readFileSync(path.join(dir, "..", "package.json"), "utf8");
  assert.match(stamp, /import \{[\s\S]*loadOddsBoardOrder[\s\S]*\} from "\.\/oddsBoardOrder\.js"/);
  assert.match(stamp, /data-drag-game/);
  assert.match(stamp, /data-drag-book/);
  assert.match(stamp, /data-drop-game/);
  assert.match(stamp, /data-drop-book/);
  assert.match(stamp, /data-reset-game-order/);
  assert.match(stamp, /data-reset-book-order/);
  assert.match(stamp, /obb-grip/);
  assert.match(stamp, /ArrowUp/);
  assert.match(stamp, /ArrowLeft/);
  assert.match(stamp, /tableLayout: "fixed"/);
  assert.match(stamp, /data-col-layout="fixed"/);
  assert.doesNotMatch(stamp, /draggable=\{true\}[\s\S]{0,80}data-fixture/, "whole game rows are not the drag handle");
  assert.doesNotMatch(board, /oddsBoardOrder|data-drag-game|data-drag-book/);
  assert.match(pkg, /oddsBoardOrder\.test\.js/);
}

console.log("oddsBoardOrder.test.js ok");
