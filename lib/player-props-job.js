'use strict';

// Separate Odds API pull for NFL anytime touchdowns. The featured cron's
// 20s budget cannot walk per-event prop calls. Request player_anytime_td
// only, for games kicking off within 72 hours, about every 5 minutes.
// Sportsbook regions us and us2 only. eu has no NFL props. us_ex is the
// Kalshi/Polymarket region and also Novig/ProphetX; those exchange prices
// stay on the direct feeds (Kalshi, Polymarket, Underdog). Novig and ProphetX
// are not requested here because a live player_anytime_td check was not
// available. Stores sportsbook Yes prices plus a fair opposite (best direct
// exchange No, else a two-sided de-vig) on player_prop_cache. Logs
// x-requests-* and never the key.

const { TRUSTED_BOOK_KEYS } = require('./promo-ev');
const { UNDERDOG_BOARD_OMIT_MS } = require('./underdog-freshness');
const { loadExchangeTdQuotes, attachNoLadders } = require('./player-td-feeds');
const {
  gameKeyFromTeams,
  samePlayer,
  samePlayerInGame,
  canonAbbr,
  devigTwoWay,
  bestAmericanQuote,
  quoteIsOlderThan,
  impliedFromAmerican,
  ENABLED_TD_MARKETS,
  kickoffInPlayerTdWindow,
  playerTdBookExcluded,
} = require('./player-td.cjs');

const PROP_SPORT = 'americanfootball_nfl';
// Odds API: anytime TD only. Do not request player_rush_reception_tds, and do
// not turn that market into an anytime price or a de-vig. Underdog's own
// Rush + Rec TDs 0.5 line stays on the direct feed and is the anytime price.
const PROP_MARKETS = Object.freeze([
  'player_anytime_td',
]);
// One request lists both regions. The Odds API bills 1 credit per region,
// so each event costs 2 credits. Do not split this into two calls.
const PROP_REGIONS = 'us,us2';
const PROP_CREDITS_PER_EVENT = 2;
// State clones post the same prices as the parent book. Keep one row.
const BOOK_ALIASES = Object.freeze({
  hardrockbet_fl: 'hardrockbet',
  hardrockbet_az: 'hardrockbet',
  hardrockbet_oh: 'hardrockbet',
});
const MAX_PROP_EVENTS = 24;
const PROP_FETCH_CONCURRENCY = 4;
const ODDS_API_TIMEOUT_MS = 8000;

// Never take these from The Odds API. Kalshi, Polymarket, and Underdog come
// from their own feeds. us_ex exchanges are not requested with the sportsbooks.
const ODDS_API_EXCLUDED_BOOKS = new Set([
  'kalshi',
  'polymarket',
  'underdog',
  'underdog_predict',
  'novig',
  'prophetx',
  'betopenly',
]);

function canonicalBookKey(key) {
  const id = String(key || '').toLowerCase();
  return BOOK_ALIASES[id] || id;
}

function oddsApiBookExcluded(key) {
  const book = canonicalBookKey(key);
  if (!book) return true;
  if (ODDS_API_EXCLUDED_BOOKS.has(book) || playerTdBookExcluded(book)) return true;
  if (book.startsWith('underdog')) return true;
  return false;
}

function redactSecrets(value) {
  return String(value || '').replace(/apiKey=[^&\s]+/gi, 'apiKey=redacted');
}

function eventInPropWindow(game, now) {
  return kickoffInPlayerTdWindow(game && game.commence_time, now);
}

function selectPropEvents(games, now, cap = MAX_PROP_EVENTS) {
  return (games || [])
    .filter((game) => game && game.id && eventInPropWindow(game, now))
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
    .slice(0, cap);
}

function propEventUrl(eventId, apiKey) {
  const id = encodeURIComponent(eventId);
  return `https://api.the-odds-api.com/v4/sports/${PROP_SPORT}/events/${id}/odds/?apiKey=${apiKey}&regions=${PROP_REGIONS}&markets=${PROP_MARKETS.join(',')}&oddsFormat=american&includeBetLimits=true`;
}

function eventsListUrl(apiKey) {
  return `https://api.the-odds-api.com/v4/sports/${PROP_SPORT}/events?apiKey=${apiKey}`;
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = String(name).toLowerCase();
  return headers[name] || headers[lower] || null;
}

function usageFromHeaders(headers) {
  return {
    requestsRemaining: headerGet(headers, 'x-requests-remaining'),
    requestsUsed: headerGet(headers, 'x-requests-used'),
    requestsLast: headerGet(headers, 'x-requests-last'),
  };
}

function logOddsApiUsage(usage, label) {
  console.log(JSON.stringify({
    source: 'odds-api',
    label,
    requestsRemaining: usage && usage.requestsRemaining,
    requestsUsed: usage && usage.requestsUsed,
    requestsLast: usage && usage.requestsLast,
  }));
}

function sideOfOutcome(outcome) {
  const name = String(outcome && outcome.name || '').trim().toLowerCase();
  if (name === 'over' || name === 'yes' || name === 'higher') return 'yes';
  if (name === 'under' || name === 'no' || name === 'lower') return 'no';
  return 'yes';
}

function playerOfOutcome(outcome) {
  if (!outcome) return '';
  if (outcome.description) return String(outcome.description).trim();
  const name = String(outcome.name || '').trim();
  if (/^(over|under|yes|no|higher|lower)$/i.test(name)) return '';
  return name;
}

function marketBucket(marketKey, point) {
  if (marketKey === 'player_rush_reception_tds') return null;
  if (marketKey === 'player_anytime_td') return 'anytime';
  if (marketKey === 'player_1st_td') return 'first';
  const n = Number(point);
  if (marketKey === 'player_tds_over') {
    if (n === 0.5) return 'anytime';
    if (n === 1.5) return 'two';
  }
  return null;
}

function blankPlayer(name, team) {
  return {
    name,
    team: team || '',
    markets: {
      anytime: { offers: [], pairs: [] },
      two: { offers: [], pairs: [] },
      first: { offers: [], pairs: [] },
    },
  };
}

function findPlayer(players, _gameKey, name, team) {
  // Callers already hold one event. Still refuse a different club on that
  // event so a shared last name cannot jump teams.
  return players.find((player) => {
    if (!samePlayer(player.name, name)) return false;
    if (player.team && team && canonAbbr(player.team) !== canonAbbr(team)) return false;
    return true;
  });
}

function ensurePlayer(players, gameKey, name, team) {
  const hit = findPlayer(players, gameKey, name, team);
  if (hit) {
    if (!hit.team && team) hit.team = team;
    if (String(name).length > String(hit.name).length) hit.name = name;
    return hit;
  }
  const created = blankPlayer(name, team);
  players.push(created);
  return created;
}

function addOffer(slot, book, price, updatedAt, dedicated) {
  if (price == null || !book) return;
  const prev = slot.offers.find((row) => row.book === book);
  if (!prev) {
    slot.offers.push({ book, price, updatedAt: updatedAt || null, dedicated: !!dedicated });
    return;
  }
  if (prev.dedicated && !dedicated) return;
  if ((dedicated && !prev.dedicated) || price > prev.price) {
    prev.price = price;
    prev.updatedAt = updatedAt || prev.updatedAt;
    prev.dedicated = prev.dedicated || !!dedicated;
  }
}

function vigDistance(over, under) {
  const a = impliedFromAmerican(over);
  const b = impliedFromAmerican(under);
  if (a == null || b == null) return Infinity;
  return Math.abs(a + b - 1);
}

function pickDevig(pairs) {
  const usable = (pairs || []).filter((pair) => pair && pair.over != null && pair.under != null);
  if (!usable.length) return null;
  const pinnacle = usable.find((pair) => pair.book === 'pinnacle');
  const pool = pinnacle ? [pinnacle] : usable.slice().sort((a, b) => vigDistance(a.over, a.under) - vigDistance(b.over, b.under));
  const chosen = pool[0];
  const devig = devigTwoWay(chosen.over, chosen.under);
  if (!devig || devig.oppAmerican == null) return null;
  return { price: devig.oppAmerican, book: chosen.book, count: 1, source: 'devig' };
}

function noCandidate(quote) {
  const row = { price: quote.noAmerican, book: quote.book, source: 'exchange' };
  const size = Number(quote.noSize);
  if (Number.isFinite(size) && size > 0) row.size = size;
  if (Array.isArray(quote.noLevels) && quote.noLevels.length) {
    row.levels = quote.noLevels
      .filter((lvl) => lvl && lvl.american != null && Number(lvl.size) > 0)
      .map((lvl) => ({ american: lvl.american, size: Number(lvl.size) }));
    if (!row.levels.length) delete row.levels;
  }
  return row;
}

// One row per venue: its best No price (ties keep the larger size).
function bestNoPerVenue(nos) {
  const byBook = new Map();
  for (const row of nos || []) {
    if (!row || row.price == null || !row.book) continue;
    const prev = byBook.get(row.book);
    if (!prev || row.price > prev.price || (row.price === prev.price && (row.size || 0) > (prev.size || 0))) {
      byBook.set(row.book, row);
    }
  }
  return [...byBook.values()];
}

// Kalshi / Polymarket quotes for players kept on an assembled game (they have
// a sportsbook offer and a fair price). Only these get a depth ladder fetch.
const EXCHANGE_TD_BOOKS = new Set(['kalshi', 'polymarket', 'underdog_predict']);

function neededLadderQuotes(games, quotes) {
  const out = [];
  const seen = new Set();
  const byGame = new Map();
  for (const quote of quotes || []) {
    if (!quote || !quote.gameKey) continue;
    if (!byGame.has(quote.gameKey)) byGame.set(quote.gameKey, []);
    byGame.get(quote.gameKey).push(quote);
  }
  for (const game of games || []) {
    if (!game || !game.gameKey) continue;
    const gameQuotes = byGame.get(game.gameKey) || [];
    for (const player of game.players || []) {
      // Budget: only players a sportsbook (Odds API) prices. Exchange-only
      // players keep their top-of-book size.
      const hasSportsbook = (market) => ((player.markets && player.markets[market] && player.markets[market].offers) || [])
        .some((offer) => offer && !EXCHANGE_TD_BOOKS.has(offer.book));
      for (const quote of gameQuotes) {
        if (!quote || seen.has(quote)) continue;
        if (quote.book !== 'kalshi' && quote.book !== 'polymarket') continue;
        if (quote.noAmerican == null || !ENABLED_TD_MARKETS.includes(quote.market)) continue;
        if (!player.markets || !player.markets[quote.market] || !hasSportsbook(quote.market)) continue;
        if (!samePlayerInGame(player.name, game.gameKey, quote.player, quote.gameKey, player.team, quote.team)) continue;
        seen.add(quote);
        out.push(quote);
      }
    }
  }
  return out;
}

function assemblePropGame(event, exchangeQuotes, now) {
  const away = event.away_team;
  const home = event.home_team;
  const gameKey = gameKeyFromTeams(away, home, event.commence_time);
  const players = [];
  const quotes = (exchangeQuotes || []).filter((quote) => quote && quote.gameKey && gameKey && quote.gameKey === gameKey);

  for (const book of event.bookmakers || []) {
    const bookKey = canonicalBookKey(book && book.key);
    if (!book || oddsApiBookExcluded(bookKey)) continue;
    if (!TRUSTED_BOOK_KEYS.has(bookKey)) continue;
    for (const market of book.markets || []) {
      const updatedAt = market.last_update || book.last_update || null;
      const byPlayer = new Map();
      for (const outcome of market.outcomes || []) {
        const name = playerOfOutcome(outcome);
        const bucket = marketBucket(market.key, outcome.point);
        if (!name || !bucket || outcome.price == null) continue;
        const key = `${bucket}|${name}`;
        if (!byPlayer.has(key)) byPlayer.set(key, { name, bucket, yes: null, no: null });
        const row = byPlayer.get(key);
        if (sideOfOutcome(outcome) === 'no') row.no = outcome.price;
        else row.yes = outcome.price;
      }
      for (const row of byPlayer.values()) {
        const player = ensurePlayer(players, gameKey, row.name, '');
        const slot = player.markets[row.bucket];
        const dedicated = market.key === 'player_anytime_td' || market.key === 'player_1st_td';
        const twoSided = market.key === 'player_tds_over';
        if (row.yes != null) addOffer(slot, bookKey, row.yes, updatedAt, dedicated);
        if (row.yes != null && row.no != null && twoSided) {
          slot.pairs.push({ book: bookKey, over: row.yes, under: row.no });
        }
      }
    }
  }

  for (const quote of quotes) {
    if (!ENABLED_TD_MARKETS.includes(quote.market) || quote.yesAmerican == null) continue;
    const player = ensurePlayer(players, gameKey, quote.player, quote.team);
    const slot = player.markets[quote.market];
    // Same window as the Player Props board. The 1h Promo clock is for
    // game moneylines. A touchdown price the board still shows is not stale.
    const staleUnderdog = quote.book === 'underdog_predict' && quoteIsOlderThan(quote.updatedAt, now, UNDERDOG_BOARD_OMIT_MS);
    if (!staleUnderdog) addOffer(slot, quote.book, quote.yesAmerican, quote.updatedAt);
    if (!staleUnderdog && quote.noAmerican != null && quote.yesAmerican != null && quote.book === 'underdog_predict') {
      slot.pairs.push({ book: quote.book, over: quote.yesAmerican, under: quote.noAmerican });
    }
  }

  const kept = [];
  for (const player of players) {
    const markets = {};
    for (const market of ENABLED_TD_MARKETS) {
      const slot = player.markets[market];
      const nos = [];
      for (const quote of quotes) {
        if (quote.market !== market || quote.noAmerican == null) continue;
        if (!samePlayerInGame(player.name, gameKey, quote.player, quote.gameKey, player.team, quote.team)) continue;
        if (quote.book === 'underdog_predict' && quoteIsOlderThan(quote.updatedAt, now, UNDERDOG_BOARD_OMIT_MS)) continue;
        if (playerTdBookExcluded(quote.book)) continue;
        nos.push(noCandidate(quote));
      }
      const venueNos = bestNoPerVenue(nos);
      const bestNo = bestAmericanQuote(venueNos);
      const devig = pickDevig((slot.pairs || []).filter((pair) => pair && !playerTdBookExcluded(pair.book)));
      let opp = null;
      if (bestNo) {
        const hit = venueNos.find((row) => row.book === bestNo.book && row.price === bestNo.price) || {};
        opp = { price: bestNo.price, book: bestNo.book, count: venueNos.length, source: 'exchange' };
        // Top-of-book size only. The per-venue ladders live on opps[]; Promo
        // merges the Kalshi + Polymarket ladders for the $500 depth blend.
        if (hit.size != null) opp.size = hit.size;
      } else {
        opp = devig;
      }
      if (opp && playerTdBookExcluded(opp.book)) continue;
      if (!opp || !slot.offers.length) continue;
      // Every venue's best No (plus the de-vig) so Promo can re-pick the
      // fair price among the Matching books a user selected.
      const opps = venueNos.slice();
      if (devig && !playerTdBookExcluded(devig.book)) opps.push(devig);
      markets[market] = {
        offers: slot.offers.map(({ book: offerBook, price, updatedAt }) => ({ book: offerBook, price, updatedAt })),
        opp,
        opps,
      };
    }
    if (!Object.keys(markets).length) continue;
    kept.push({ name: player.name, team: player.team || '', markets });
  }
  kept.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    eventId: event.id,
    sport: PROP_SPORT,
    away,
    home,
    commence_time: event.commence_time,
    gameKey,
    players: kept,
  };
}

async function mapPool(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(list[index], index);
    }
  }
  const n = Math.max(1, Math.min(limit, list.length || 1));
  if (!list.length) return [];
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function fetchOddsApi(url, { fetchImpl = fetch, timeoutMs = ODDS_API_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    const usage = usageFromHeaders(res && res.headers);
    logOddsApiUsage(usage, 'player-props');
    if (!res || !res.ok) {
      return { ok: false, status: res && res.status, data: null, usage, error: new Error(`HTTP ${res && res.status}`) };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data, usage, error: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, usage: null, error: err };
  } finally {
    clearTimeout(timer);
  }
}

async function featuredNflGames(supabaseClient) {
  if (!supabaseClient) return [];
  try {
    const result = await supabaseClient.from('odds_cache').select('data').eq('sport', PROP_SPORT).maybeSingle();
    if (result && result.error) return [];
    const data = result && result.data && result.data.data;
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function runPlayerPropsJob({
  apiKey,
  fetchImpl,
  supabaseClient,
  applyBookAdjustments,
  now = Date.now(),
  exchangeQuotes,
  loadExchanges,
  attachLadders,
  ladderDeps,
  maxEvents = MAX_PROP_EVENTS,
} = {}) {
  if (!apiKey) {
    return { ok: false, error: 'ODDS_API_KEY missing', events: 0, upserts: 0 };
  }
  let games = await featuredNflGames(supabaseClient);
  let lastUsage = null;
  if (!games.length) {
    const listed = await fetchOddsApi(eventsListUrl(apiKey), { fetchImpl });
    lastUsage = listed.usage || lastUsage;
    if (listed.ok && Array.isArray(listed.data)) games = listed.data;
  }
  const picked = selectPropEvents(games, now, maxEvents);
  const quotes = exchangeQuotes || await (loadExchanges || loadExchangeTdQuotes)({
    fetchFn: fetchImpl,
    now,
    omitAfterMs: null,
  }).catch(() => []);

  const pulled = await mapPool(picked, PROP_FETCH_CONCURRENCY, async (game) => {
    const res = await fetchOddsApi(propEventUrl(game.id, apiKey), { fetchImpl });
    lastUsage = res.usage || lastUsage;
    if (!res.ok || !res.data) {
      return { id: game.id, error: redactSecrets(res.error && res.error.message) };
    }
    let event = res.data;
    if (!event.bookmakers && game.bookmakers) event = game;
    if (typeof applyBookAdjustments === 'function') {
      const adjusted = applyBookAdjustments([event]);
      event = adjusted && adjusted[0] ? adjusted[0] : event;
    }
    if (!event.away_team) event.away_team = game.away_team;
    if (!event.home_team) event.home_team = game.home_team;
    if (!event.commence_time) event.commence_time = game.commence_time;
    if (!event.id) event.id = game.id;
    return { id: game.id, event };
  });

  // Depth pass: fetch the No ask ladders (Kalshi batch orderbooks, Polymarket
  // US books) only for exchange quotes on players Promo can use, i.e. players
  // with a sportsbook offer in a game inside the 72h window. Then assemble.
  let ladders = null;
  const attach = attachLadders === undefined ? (exchangeQuotes ? null : attachNoLadders) : attachLadders;
  if (typeof attach === 'function') {
    const needed = neededLadderQuotes(pulled.filter((row) => row && row.event).map((row) => assemblePropGame(row.event, quotes, now)), quotes);
    try {
      ladders = await attach(needed, { ...(ladderDeps || {}), fetchFn: fetchImpl, now });
    } catch (err) {
      ladders = { error: redactSecrets(err && err.message) };
    }
  }
  for (const row of pulled) {
    if (row && row.event) row.game = assemblePropGame(row.event, quotes, now);
  }

  let upserts = 0;
  const errors = [];
  for (const row of pulled) {
    if (!row || row.error) {
      if (row && row.error) errors.push({ id: row.id, error: row.error });
      continue;
    }
    const game = row.game;
    if (!supabaseClient || !game) continue;
    const nowIso = new Date(now).toISOString();
    try {
      const result = await supabaseClient.from('player_prop_cache').upsert({
        event_id: game.eventId,
        sport: PROP_SPORT,
        commence_time: game.commence_time,
        home_team: game.home,
        away_team: game.away,
        data: game,
        markets: PROP_MARKETS,
        fetched_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: 'event_id' });
      if (result && result.error) errors.push({ id: game.eventId, error: redactSecrets(result.error.message || result.error) });
      else upserts += 1;
    } catch (err) {
      errors.push({ id: game.eventId, error: redactSecrets(err && err.message) });
    }
  }

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('player_prop_cache')
        .delete()
        .eq('sport', PROP_SPORT)
        .lt('commence_time', new Date(now).toISOString());
    } catch (_) { /* best-effort */ }
  }

  return {
    ok: true,
    sport: PROP_SPORT,
    events: picked.length,
    upserts,
    errors,
    usage: lastUsage,
    ladders,
    games: pulled.map((row) => row && row.game).filter(Boolean),
  };
}

module.exports = {
  PROP_SPORT,
  PROP_MARKETS,
  PROP_REGIONS,
  PROP_CREDITS_PER_EVENT,
  BOOK_ALIASES,
  ODDS_API_EXCLUDED_BOOKS,
  oddsApiBookExcluded,
  canonicalBookKey,
  MAX_PROP_EVENTS,
  eventInPropWindow,
  selectPropEvents,
  propEventUrl,
  usageFromHeaders,
  logOddsApiUsage,
  redactSecrets,
  assemblePropGame,
  neededLadderQuotes,
  bestNoPerVenue,
  noCandidate,
  addOffer,
  playerOfOutcome,
  sideOfOutcome,
  fetchOddsApi,
  headerGet,
  mapPool,
  runPlayerPropsJob,
};
