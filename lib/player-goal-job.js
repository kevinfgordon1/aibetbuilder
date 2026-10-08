'use strict';

const { dropExcludedBooks } = require('./odds-excluded-books');

// NHL anytime goal scorer (1+ goal) for Promo. Runs inside the 5-minute
// /api/fetch-player-props cron next to the NFL anytime-TD and MLB HR jobs.
//
// Sportsbook side: Odds API player_goal_scorer_anytime (Yes) plus
// player_goals (Over 0.5 = 1+ goal), for NHL games that start later today
// (ET). A book's dedicated anytime price wins over its Over 0.5 price for
// the same player; Over 0.5 only fills in players the book has no anytime
// price for. Regions us,us2 in one request (up to 2 markets x 2 regions =
// 4 credits per event; the Odds API bills only markets that come back).
// Only events where an exchange (Kalshi / Polymarket US / Underdog) lists
// at least one 1+ goal market are requested: a player without an exchange
// No has no fair price and is dropped anyway.
//
// Fair side: the exchange "No" (No ask = 1 − Yes bid, fee-inclusive), with
// the Kalshi / Polymarket No-ask ladders stored for the Promo $500 depth
// blend. No sportsbook de-vig (same as MLB HR). Fliff and Courtside are
// never offers or fair sources.
//
// Rows go to player_prop_cache with sport 'icehockey_nhl'.

const { TRUSTED_BOOK_KEYS } = require('./promo-ev');
const { UNDERDOG_BOARD_OMIT_MS } = require('./underdog-freshness');
const { attachNoLadders } = require('./player-td-feeds');
const { loadExchangeGoalQuotes } = require('./player-goal-feeds');
const {
  NHL_PROP_SPORT,
  nhlGameKeyFromTeams,
  samePlayer,
  samePlayerInGame,
  canonNhlAbbr,
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

const GOAL_SPORT = NHL_PROP_SPORT;
const GOAL_MARKET_KEY = 'player_goal_scorer_anytime';
const GOAL_OU_MARKET_KEY = 'player_goals';
const GOAL_MARKETS = Object.freeze([GOAL_MARKET_KEY, GOAL_OU_MARKET_KEY]);
const GOAL_REGIONS = 'us,us2';
const GOAL_CREDITS_PER_EVENT = 4;
const MAX_GOAL_EVENTS = 16;
const GOAL_FETCH_CONCURRENCY = 4;
const EXCHANGE_BOOKS = new Set(['kalshi', 'polymarket', 'underdog_predict']);

function goalEventUrl(eventId, apiKey) {
  const id = encodeURIComponent(eventId);
  return `https://api.the-odds-api.com/v4/sports/${GOAL_SPORT}/events/${id}/odds/?apiKey=${apiKey}&regions=${GOAL_REGIONS}&markets=${GOAL_MARKETS.join(',')}&oddsFormat=american&includeBetLimits=true`;
}

// /events is free (0 credits, x-requests-last 0).
function goalEventsListUrl(apiKey) {
  return `https://api.the-odds-api.com/v4/sports/${GOAL_SPORT}/events?apiKey=${apiKey}`;
}

function todaysGoalGames(games, now, cap = MAX_GOAL_EVENTS) {
  return (games || [])
    .filter((game) => game && game.id && startsLaterTodayEt(game.commence_time, now))
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
    .slice(0, cap);
}

function quoteJoinsEvent(quote, event, gameKey) {
  if (!quote || !gameKey || quote.gameKey !== gameKey || quote.market !== 'goal') return false;
  return commenceCompatible(quote.commence, event && event.commence_time);
}

// Only events with at least one exchange 1+ goal market are worth a credit.
function eventsWithExchangeGoal(games, quotes) {
  return (games || []).filter((game) => {
    const key = nhlGameKeyFromTeams(game.away_team, game.home_team, game.commence_time);
    return (quotes || []).some((quote) => quoteJoinsEvent(quote, game, key) && quote.noAmerican != null);
  });
}

// Odds API player_goal_scorer_anytime: Yes / No with the player in
// description (no point); only Yes is an offer. player_goals: Over / Under
// with point 0.5 for 1+ (1.5 = 2+ is ignored). Per book, a player's
// anytime price is kept; the Over 0.5 price fills in only when the book has
// no anytime price for that player.
function sportsbookGoalOffers(event) {
  const out = [];
  for (const book of (event && event.bookmakers) || []) {
    const bookKey = canonicalBookKey(book && book.key);
    if (!book || oddsApiBookExcluded(bookKey) || playerTdBookExcluded(bookKey)) continue;
    if (!TRUSTED_BOOK_KEYS.has(bookKey)) continue;
    const main = [];
    const ou = [];
    for (const market of book.markets || []) {
      if (!market || (market.key !== GOAL_MARKET_KEY && market.key !== GOAL_OU_MARKET_KEY)) continue;
      const isMain = market.key === GOAL_MARKET_KEY;
      const bucket = isMain ? main : ou;
      const updatedAt = market.last_update || book.last_update || null;
      for (const outcome of market.outcomes || []) {
        if (!outcome || outcome.price == null) continue;
        if (sideOfOutcome(outcome) !== 'yes') continue;
        if (!isMain && Number(outcome.point) !== 0.5) continue;
        if (isMain && outcome.point != null && outcome.point !== '' && Number(outcome.point) !== 0.5) continue;
        const name = playerOfOutcome(outcome);
        if (!name) continue;
        bucket.push({ book: bookKey, player: name, price: Number(outcome.price), updatedAt });
      }
    }
    out.push(...main);
    for (const offer of ou) {
      if (main.some((row) => samePlayer(row.player, offer.player))) continue;
      if (out.some((row) => row.book === bookKey && samePlayer(row.player, offer.player))) continue;
      out.push(offer);
    }
  }
  return out;
}

function ensureGoalPlayer(players, name, team) {
  const hit = players.find((player) => {
    if (!samePlayer(player.name, name)) return false;
    if (player.team && team && canonNhlAbbr(player.team) !== canonNhlAbbr(team)) return false;
    return true;
  });
  if (hit) {
    if (!hit.team && team) hit.team = canonNhlAbbr(team) || '';
    if (String(name).length > String(hit.name).length) hit.name = name;
    return hit;
  }
  const created = { name, team: canonNhlAbbr(team) || '', offers: [], sportsbook: false };
  players.push(created);
  return created;
}

function assembleGoalGame(event, exchangeQuotes, now) {
  const away = event.away_team;
  const home = event.home_team;
  const gameKey = nhlGameKeyFromTeams(away, home, event.commence_time);
  const quotes = (exchangeQuotes || []).filter((quote) => quoteJoinsEvent(quote, event, gameKey));
  const players = [];

  for (const offer of sportsbookGoalOffers(event)) {
    const player = ensureGoalPlayer(players, offer.player, '');
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
    const player = ensureGoalPlayer(players, quote.player, quote.team);
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
        goal: {
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
    sport: GOAL_SPORT,
    away,
    home,
    commence_time: event.commence_time,
    gameKey,
    players: kept,
  };
}

// Kalshi / Polymarket quotes that price a player some sportsbook offers.
function neededGoalLadderQuotes(events, quotes, now) {
  const out = new Set();
  for (const event of events || []) {
    const gameKey = nhlGameKeyFromTeams(event.away_team, event.home_team, event.commence_time);
    const offered = sportsbookGoalOffers(event);
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

async function nhlGamesFromCache(supabaseClient) {
  if (!supabaseClient) return [];
  try {
    const result = await supabaseClient.from('odds_cache').select('data').eq('sport', GOAL_SPORT).maybeSingle();
    if (result && result.error) return [];
    const data = result && result.data && result.data.data;
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function runPlayerGoalJob({
  apiKey,
  fetchImpl,
  supabaseClient,
  applyBookAdjustments,
  now = Date.now(),
  exchangeQuotes,
  loadExchanges,
  attachLadders,
  ladderDeps,
  maxEvents = MAX_GOAL_EVENTS,
} = {}) {
  if (!apiKey) return { ok: false, error: 'ODDS_API_KEY missing', events: 0, upserts: 0 };
  const usages = [];
  let lastUsage = null;
  // The free /events list is the slate (featured odds_cache can miss games);
  // odds_cache is the fallback when that call fails.
  let games = [];
  const listed = await fetchOddsApi(goalEventsListUrl(apiKey), { fetchImpl });
  if (listed.usage) { usages.push(listed.usage); lastUsage = listed.usage; }
  if (listed.ok && Array.isArray(listed.data)) games = listed.data;
  if (!todaysGoalGames(games, now, maxEvents).length) games = await nhlGamesFromCache(supabaseClient);
  const today = todaysGoalGames(games, now, maxEvents);

  let quotes = exchangeQuotes;
  let venueCounts = null;
  if (!quotes) {
    const loaded = await (loadExchanges || loadExchangeGoalQuotes)(today, { fetchFn: fetchImpl, now }).catch(() => ({ quotes: [], counts: null }));
    quotes = (loaded && loaded.quotes) || [];
    venueCounts = (loaded && loaded.counts) || null;
  }
  const picked = eventsWithExchangeGoal(today, quotes);

  const pulled = await mapPool(picked, GOAL_FETCH_CONCURRENCY, async (game) => {
    const res = await fetchOddsApi(goalEventUrl(game.id, apiKey), { fetchImpl });
    if (res.usage) { usages.push(res.usage); lastUsage = res.usage; }
    if (!res.ok || !res.data) return { id: game.id, error: redactSecrets(res.error && res.error.message) };
    let event = dropExcludedBooks(res.data);
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
    const needed = neededGoalLadderQuotes(pulled.filter((row) => row && row.event).map((row) => row.event), quotes, now);
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
    const game = assembleGoalGame(row.event, quotes, now);
    gamesOut.push(game);
    players += game.players.length;
    if (!supabaseClient) continue;
    try {
      const result = await supabaseClient.from('player_prop_cache').upsert({
        event_id: game.eventId,
        sport: GOAL_SPORT,
        commence_time: game.commence_time,
        home_team: game.home,
        away_team: game.away,
        data: game,
        markets: GOAL_MARKETS,
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
      await supabaseClient.from('player_prop_cache').delete().eq('sport', GOAL_SPORT).lt('commence_time', nowIso);
    } catch (_) { /* best-effort */ }
  }

  return {
    ok: true,
    sport: GOAL_SPORT,
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
  GOAL_SPORT,
  GOAL_MARKET_KEY,
  GOAL_OU_MARKET_KEY,
  GOAL_MARKETS,
  GOAL_REGIONS,
  GOAL_CREDITS_PER_EVENT,
  MAX_GOAL_EVENTS,
  goalEventUrl,
  todaysGoalGames,
  quoteJoinsEvent,
  eventsWithExchangeGoal,
  sportsbookGoalOffers,
  assembleGoalGame,
  neededGoalLadderQuotes,
  creditsFromUsage,
  runPlayerGoalJob,
};
