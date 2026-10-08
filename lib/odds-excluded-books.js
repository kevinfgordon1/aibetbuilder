'use strict';

// Books Kevin does not want on aibetbuilder at all. The Odds API requests use
// regions= (not bookmakers=), so these arrive with every pull; they are dropped
// right after fetch, before anything is cached or stored.
const EXCLUDED_BOOKS = Object.freeze(['courtside', 'fliff']);
const EXCLUDED_SET = new Set(EXCLUDED_BOOKS);

function isExcludedBook(key) {
  return EXCLUDED_SET.has(String(key || '').trim().toLowerCase());
}

function dropExcludedBooksFromGame(game) {
  if (!game || !Array.isArray(game.bookmakers)) return game;
  if (!game.bookmakers.some((b) => isExcludedBook(b && b.key))) return game;
  return { ...game, bookmakers: game.bookmakers.filter((b) => !isExcludedBook(b && b.key)) };
}

function dropExcludedBooks(data) {
  if (Array.isArray(data)) return data.map(dropExcludedBooksFromGame);
  return dropExcludedBooksFromGame(data);
}

module.exports = { EXCLUDED_BOOKS, isExcludedBook, dropExcludedBooks, dropExcludedBooksFromGame };
