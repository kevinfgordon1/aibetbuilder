'use strict';

// MLB batter home runs (1+ HR) for Promo. Runs inside the 5-minute
// /api/fetch-player-props cron next to the NFL anytime-TD job.
//
// Sportsbook side: Odds API batter_home_runs plus batter_home_runs_alternate,
// Over 0.5 only (= 1+ HR), for MLB games that start later today (ET).
// DraftKings, FanDuel, BetMGM and Fanatics post "To Hit a Home Run" as a
// milestone (1+) line, which The Odds API files under the _alternate key;
// batter_home_runs alone only carries the O/U books (Caesars, ESPN, ...).
// A book's main-market price wins over its alternate price for the same
// player. Regions us,us2 in one request (up to 2 markets x 2 regions =
// 4 credits per event; the Odds API bills only markets that come back). Only events where an
// exchange (Kalshi / Polymarket US / Underdog) lists at least one 1+ HR
// market are requested: a player without an exchange No has no fair price
// and is dropped anyway. Credits are summed from x-requests-last.
//
// Fair side: the exchange "No" (No ask = 1 − Yes bid, fee-inclusive), with
// the Kalshi / Polymarket No-ask ladders (up to 10 levels) stored for the
// Promo $500 depth blend. No sportsbook de-vig: HR fair prices are
// exchange-only. Fliff and Courtside are never offers or fair sources.
//
// Rows go to player_prop_cache with sport 'baseball_mlb'; the production
// reader before this change only selects sport 'americanfootball_nfl'.

const { TRUSTED_BOOK_KEYS } = require('./promo-ev');
const { UNDERDOG_BOARD_OMIT_MS } = require('./underdog-freshness');
const { attachNoLadders } = require('./player-td-feeds');
const { loadExchangeHrQuotes } = require('./player-hr-feeds');
const {
  MLB_PROP_SPORT,
  mlbGameKeyFromTeams,
  samePlayer,
  samePlayerInGame,
  canonMlbAbbr,
  bestAmericanQuote,
  quoteIsOlderThan,
  playerTdBookExcluded,
  commenceCompatible,
  startsLaterTodayEt,
} = require('./player-td.cjs');
const {
  canonicalBookKey,
  oddsApiBookExcluded,
  redactSecrets,
  bestNoPerVenue,
  noCandidate,
  addOffer,
  playerOfOutcome,
  sideOfOutcome,
  fetchOddsApi,
  mapPool,
} = require('./player-props-job');

const HR_SPORT = MLB_PROP_SPORT;
const HR_MARKET_KEY = 'batter_home_runs';
const HR_ALT_MARKET_KEY = 'batter_home_runs_alternate';
const HR_MARKETS = Object.freeze([HR_MARKET_KEY, HR_ALT_MARKET_KEY]);
const HR_REGIONS = 'us,us2';
const HR_CREDITS_PER_EVENT = 4;
const MAX_HR_EVENTS = 16;
const HR_FETCH_CONCURRENCY = 4;
const EXCHANGE_BOOKS = new Set(['kalshi', 'polymarket', 'underdog_predict']);

function hrEventUrl(eventId, apiKey) {
  const id = encodeURIComponent(eventId);
  return `https://api.the-odds-api.com/v4/sports/${HR_SPORT}/events/${id}/odds/?apiKey=${apiKey}&regions=${HR_REGIONS}&markets=${HR_MARKETS.join(',')}&oddsFormat=american&includeBetLimits=true`;
}

// /events is free (0 credits, x-requests-last 0).
function hrEventsListUrl(apiKey) {
  return `https://api.the-odds-api.com/v4/sports/${HR_SPORT}/events?apiKey=${apiKey}`;
}

function todaysHrGames(games, now, cap = MAX_HR_EVENTS) {
  return (games || [])
    .filter((game) => game && game.id && startsLaterTodayEt(game.commence_time, now))
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
    .slice(0, cap);
}

function quoteJoinsEvent(quote, event, gameKey) {
  if (!quote || !gameKey || quote.gameKey !== gameKey || quote.market !== 'hr') return false;
  return commenceCompatible(quote.commence, event && event.commence_time);
}

// Only events with at least one exchange 1+ HR market are worth a credit.
function eventsWithExchangeHr(games, quotes) {
  return (games || []).filter((game) => {
    const key = mlbGameKeyFromTeams(game.away_team, game.home_team, game.commence_time);
    return (quotes || []).some((quote) => quoteJoinsEvent(quote, game, key) && quote.noAmerican != null);
  });
}

// Odds API batter_home_runs / batter_home_runs_alternate: outcomes are
// Over / Under with the player in description and point 0.5 for 1+. Other
// points (1.5 = 2+) are ignored. Per book, a player's batter_home_runs price
// is kept; the alternate (milestone) price fills in only when the main
// market has none for that player.
function sportsbookHrOffers(event) {
  const out = [];
  for (const book of (event && event.bookmakers) || []) {
    const bookKey = canonicalBookKey(book && book.key);
    if (!book || oddsApiBookExcluded(bookKey) || playerTdBookExcluded(bookKey)) continue;
    if (!TRUSTED_BOOK_KEYS.has(bookKey)) continue;
    const main = [];
    const alt = [];
    for (const market of book.markets || []) {
      if (!market || (market.key !== HR_MARKET_KEY && market.key !== HR_ALT_MARKET_KEY)) continue;
      const bucket = market.key === HR_MARKET_KEY ? main : alt;
      const updatedAt = market.last_update || book.last_update || null;
      for (const outcome of market.outcomes || []) {
        if (!outcome || outcome.price == null) continue;
        if (sideOfOutcome(outcome) !== 'yes') continue;
        if (Number(outcome.point) !== 0.5) continue;
        const name = playerOfOutcome(outcome);
        if (!name) continue;
        bucket.push({ book: bookKey, player: name, price: Number(outcome.price), updatedAt });
      }
    }
    out.push(...main);
    for (const offer of alt) {
      if (main.some((row) => samePlayer(row.player, offer.player))) continue;
      if (out.some((row) => row.book === bookKey && samePlayer(row.player, offer.player))) continue;
      out.push(offer);
    }
  }
  return out;
}

function ensureHrPlayer(players, name, team) {
  const hit = players.find((player) => {
    if (!samePlayer(player.name, name)) return false;
    if (player.team && team && canonMlbAbbr(player.team) !== canonMlbAbbr(team)) return false;
    return true;
  });
  if (hit) {
    if (!hit.team && team) hit.team = canonMlbAbbr(team) || '';
    if (String(name).length > String(hit.name).length) hit.name = name;
    return hit;
  }
  const created = { name, team: canonMlbAbbr(team) || '', offers: [], sportsbook: false };
  players.push(created);
  return created;
}

function assembleHrGame(event, exchangeQuotes, now) {
  const away = event.away_team;
  const home = event.home_team;
  const gameKey = mlbGameKeyFromTeams(away, home, event.commence_time);
  const quotes = (exchangeQuotes || []).filter((quote) => quoteJoinsEvent(quote, event, gameKey));
  const players = [];

  for (const offer of sportsbookHrOffers(event)) {
    const player = ensureHrPlayer(players, offer.player, '');
    addOffer(player, offer.book, offer.price, offer.updatedAt, true);
    player.sportsbook = true;
  }
  // Kalshi carries the club in the ticker; attach it so a shared surname on
  // the other team cannot borrow this player's fair price.
  for (const quote of quotes) {
    if (quote.book !== 'kalshi' || !quote.team) continue;
    const hit = players.find((player) => !player.team && samePlayer(player.name, quote.player));
    if (hit) hit.team = quote.team;
  }
  for (const quote of quotes) {
    if (quote.book !== 'underdog_predict' || quote.yesAmerican == null) continue;
    if (quoteIsOlderThan(quote.updatedAt, now, UNDERDOG_BOARD_OMIT_MS)) continue;
    const player = ensureHrPlayer(players, quote.player, quote.team);
    addOffer(player, quote.book, quote.yesAmerican, quote.updatedAt);
  }

  const kept = [];
  for (const player of players) {
    const nos = [];
    for (const quote of quotes) {
      if (quote.noAmerican == null || !EXCHANGE_BOOKS.has(quote.book)) continue;
      if (!samePlayerInGame(player.name, gameKey, quote.player, quote.gameKey, player.team, quote.team)) continue;
      if (quote.book === 'underdog_predict' && quoteIsOlderThan(quote.updatedAt, now, UNDERDOG_BOARD_OMIT_MS)) continue;
      nos.push(noCandidate(quote));
    }
    const venueNos = bestNoPerVenue(nos);
    const bestNo = bestAmericanQuote(venueNos);
    // No exchange No = no fair price. Drop the player.
    if (!bestNo || !player.offers.length) continue;
    const hit = venueNos.find((row) => row.book === bestNo.book && row.price === bestNo.price) || {};
    const opp = { price: bestNo.price, book: bestNo.book, count: venueNos.length, source: 'exchange' };
    if (hit.size != null) opp.size = hit.size;
    kept.push({
      name: player.name,
      team: player.team || '',
      markets: {
        hr: {
          offers: player.offers
            .filter((row) => !playerTdBookExcluded(row.book))
            .map(({ book, price, updatedAt }) => ({ book, price, updatedAt })),
          opp,
          opps: venueNos.slice(),
        },
      },
    });
  }
  kept.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    eventId: event.id,
    sport: HR_SPORT,
    away,
    home,
    commence_time: event.commence_time,
    gameKey,
    players: kept,
  };
}

// Kalshi / Polymarket quotes that price a player some sportsbook offers.
function neededHrLadderQuotes(events, quotes, now) {
  const out = new Set();
  for (const event of events || []) {
    const gameKey = mlbGameKeyFromTeams(event.away_team, event.home_team, event.commence_time);
    const offered = sportsbookHrOffers(event);
    if (!offered.length) continue;
    for (const quote of quotes || []) {
      if (out.has(quote) || (quote.book !== 'kalshi' && quote.book !== 'polymarket')) continue;
      if (quote.noAmerican == null || !quoteJoinsEvent(quote, event, gameKey)) continue;
      if (offered.some((offer) => samePlayer(offer.player, quote.player))) out.add(quote);
    }
  }
  return [...out];
}

function creditsFromUsage(usages) {
  let total = 0;
  let seen = false;
  for (const usage of usages || []) {
    const n = Number(usage && usage.requestsLast);
    if (Number.isFinite(n)) { total += n; seen = true; }
  }
  return seen ? total : null;
}

async function mlbGamesFromCache(supabaseClient) {
  if (!supabaseClient) return [];
  try {
    const result = await supabaseClient.from('odds_cache').select('data').eq('sport', HR_SPORT).maybeSingle();
    if (result && result.error) return [];
    const data = result && result.data && result.data.data;
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function runPlayerHrJob({
  apiKey,
  fetchImpl,
  supabaseClient,
  applyBookAdjustments,
  now = Date.now(),
  exchangeQuotes,
  loadExchanges,
  attachLadders,
  ladderDeps,
  maxEvents = MAX_HR_EVENTS,
} = {}) {
  if (!apiKey) return { ok: false, error: 'ODDS_API_KEY missing', events: 0, upserts: 0 };
  const usages = [];
  let lastUsage = null;
  // The free /events list is the slate (featured odds_cache can miss games);
  // odds_cache is the fallback when that call fails.
  let games = [];
  const listed = await fetchOddsApi(hrEventsListUrl(apiKey), { fetchImpl });
  if (listed.usage) { usages.push(listed.usage); lastUsage = listed.usage; }
  if (listed.ok && Array.isArray(listed.data)) games = listed.data;
  if (!todaysHrGames(games, now, maxEvents).length) games = await mlbGamesFromCache(supabaseClient);
  const today = todaysHrGames(games, now, maxEvents);

  let quotes = exchangeQuotes;
  let venueCounts = null;
  if (!quotes) {
    const loaded = await (loadExchanges || loadExchangeHrQuotes)(today, { fetchFn: fetchImpl, now }).catch(() => ({ quotes: [], counts: null }));
    quotes = (loaded && loaded.quotes) || [];
    venueCounts = (loaded && loaded.counts) || null;
  }
  const picked = eventsWithExchangeHr(today, quotes);

  const pulled = await mapPool(picked, HR_FETCH_CONCURRENCY, async (game) => {
    const res = await fetchOddsApi(hrEventUrl(game.id, apiKey), { fetchImpl });
    if (res.usage) { usages.push(res.usage); lastUsage = res.usage; }
    if (!res.ok || !res.data) return { id: game.id, error: redactSecrets(res.error && res.error.message) };
    let event = res.data;
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

  let ladders = null;
  const attach = attachLadders === undefined ? (exchangeQuotes ? null : attachNoLadders) : attachLadders;
  if (typeof attach === 'function') {
    const needed = neededHrLadderQuotes(pulled.filter((row) => row && row.event).map((row) => row.event), quotes, now);
    try {
      ladders = await attach(needed, { ...(ladderDeps || {}), fetchFn: fetchImpl, now, dropEmptyKalshi: true });
    } catch (err) {
      ladders = { error: redactSecrets(err && err.message) };
    }
  }

  let upserts = 0;
  let players = 0;
  const errors = [];
  const gamesOut = [];
  const nowIso = new Date(now).toISOString();
  for (const row of pulled) {
    if (!row) continue;
    if (row.error) { errors.push({ id: row.id, error: row.error }); continue; }
    const game = assembleHrGame(row.event, quotes, now);
    gamesOut.push(game);
    players += game.players.length;
    if (!supabaseClient) continue;
    try {
      const result = await supabaseClient.from('player_prop_cache').upsert({
        event_id: game.eventId,
        sport: HR_SPORT,
        commence_time: game.commence_time,
        home_team: game.home,
        away_team: game.away,
        data: game,
        markets: HR_MARKETS,
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
      await supabaseClient.from('player_prop_cache').delete().eq('sport', HR_SPORT).lt('commence_time', nowIso);
    } catch (_) { /* best-effort */ }
  }

  return {
    ok: true,
    sport: HR_SPORT,
    gamesToday: today.length,
    events: picked.length,
    upserts,
    players,
    venues: venueCounts,
    errors,
    creditsUsed: creditsFromUsage(usages),
    oddsApiCalls: usages.length,
    oddsCallsBilled: picked.length,
    usage: lastUsage,
    ladders,
    games: gamesOut,
  };
}

module.exports = {
  HR_SPORT,
  HR_MARKET_KEY,
  HR_ALT_MARKET_KEY,
  HR_MARKETS,
  HR_REGIONS,
  HR_CREDITS_PER_EVENT,
  MAX_HR_EVENTS,
  hrEventUrl,
  todaysHrGames,
  quoteJoinsEvent,
  eventsWithExchangeHr,
  sportsbookHrOffers,
  assembleHrGame,
  neededHrLadderQuotes,
  creditsFromUsage,
  runPlayerHrJob,
};
