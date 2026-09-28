'use strict';

// Novig quotes for the New Odds Board when no odds relay is configured
// (VITE_ODDS_RELAY_URL unset). Production reads Novig from the relay; this
// same-origin path is the fallback and uses the same feed code.
//
// Source: Novig public v3 REST, no key (lib/novig-feed.js). With
// NOVIG_KEY_ID + NOVIG_PRIVATE_KEY set, the feed also takes the signed v3
// websocket. Never prefix those with VITE_.

const feedLib = require('./novig-feed');

const NOVIG_BOOK_ID = feedLib.NOVIG_BOOK_ID;

// Public v3 prices need no credentials.
function novigConfigured() {
  return true;
}

function novigKeyConfigured(env = process.env) {
  const key = feedLib.novigKey(env);
  return !!(key && key.key);
}

function startNovig(league, deps, emit) {
  const opts = deps || {};
  const create = opts.createNovigFeed || feedLib.createNovigFeed;
  const feed = create({
    env: opts.env || process.env,
    fetchFn: opts.fetchFn,
    WebSocket: opts.WebSocket,
    leagues: [league],
    log: opts.log || (() => {}),
    onQuotes: (lg, quotes, mode) => {
      if (lg !== league) return;
      // Small per-league set; a full snapshot each time keeps the hub simple.
      emit({ quotes, complete: true, mode: mode || 'rest' });
    },
  });
  return {
    ready: feed.ready,
    stop() { feed.stop(); },
  };
}

module.exports = {
  NOVIG_BOOK_ID,
  novigConfigured,
  novigKeyConfigured,
  startNovig,
  novigWsUrl: feedLib.novigWsUrl,
  quotesForMarket: feedLib.quotesForMarket,
  buildCatalog: feedLib.buildCatalog,
};
