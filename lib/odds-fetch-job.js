'use strict';

// Shared Odds API + odds_cache job used by /api/fetch-odds (cron).
// Lives outside /api so Vercel does not expose it as an HTTP endpoint.
// When Supabase/PostgREST is 5xx (Cloudflare 520/522), abort remaining
// cache writes instead of hanging the cron until the platform kills it.

const FEATURED_SPORTS = [
  'baseball_mlb',
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_nba',
  'basketball_ncaab',
  'icehockey_nhl',
];

const ALT_MARKETS = ['alternate_spreads', 'alternate_totals', 'team_totals', 'alternate_team_totals'];
const EVENT_MARKETS = Object.fromEntries(FEATURED_SPORTS.map((sport) => [sport, ALT_MARKETS]));
const EVENT_HORIZON_MS = 24 * 60 * 60 * 1000;

// Odds API / PostgREST calls must never hang a Vercel invocation. Featured
// NFL/NCAAF JSON is ~1MB; six parallel upserts plus unbounded event loops
// were leaving GET /api/fetch-odds open with 0 bytes until the client quit.
const ODDS_API_TIMEOUT_MS = 8000;
const FETCH_ODDS_RESPOND_BY_MS = 20000;
const UPSERT_TIMEOUT_MS = 4000;

function parseRequestedSports(raw, allowed = FEATURED_SPORTS) {
  if (raw == null || String(raw).trim() === '') return [...allowed];
  const wanted = new Set(
    String(Array.isArray(raw) ? raw.join(',') : raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const picked = allowed.filter((s) => wanted.has(s));
  return picked.length ? picked : [...allowed];
}

function isFeaturedOnlyQuery(query) {
  const v = query && (query.featuredOnly ?? query.featured_only);
  return v === '1' || v === 'true' || v === true || v === 1;
}

function remainingMs(startedAt, respondByMs = FETCH_ODDS_RESPOND_BY_MS, now = Date.now()) {
  return respondByMs - (now - startedAt);
}

function featuredOddsUrl(sport, apiKey) {
  // includeBetLimits: exchange books attach one `bet_limit` per outcome — top-of-book
  // size only. The Odds API has no depth / order-book parameter (no extra levels).
  // Do not add per-game depth fetches here; that would multiply cron quota.
  // Rest levels are on-demand via /api/book-depth when a Promo card is viewed.
  return `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=us,us2,us_ex,eu&markets=h2h,spreads,totals&oddsFormat=american&includeBetLimits=true`;
}

function eventOddsUrl(sport, eventId, marketsParam, apiKey) {
  return `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds/?apiKey=${apiKey}&regions=us,us2,us_ex,eu&markets=${marketsParam}&oddsFormat=american&includeBetLimits=true`;
}

function timeoutError(label, ms) {
  const err = new Error(`${label} timed out after ${ms}ms`);
  err.name = 'TimeoutError';
  return err;
}

function isSupabaseUnreachable(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const status = err.status ?? err.statusCode ?? err.code;
  if (status === 520 || status === 521 || status === 522 || status === 523 || status === 524
    || status === '520' || status === '521' || status === '522' || status === '523' || status === '524') {
    return true;
  }
  const msg = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`;
  return /520|521|522|523|524|cloudflare|origin (is )?down|connection (terminated|timeout|reset|refused)|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Failed to fetch|fetch failed/i.test(msg);
}

function applyAbortSignal(builder, signal) {
  if (builder && typeof builder.abortSignal === 'function' && signal) {
    return builder.abortSignal(signal);
  }
  return builder;
}

async function withTimeout(run, { timeoutMs, label } = {}) {
  const ctrl = new AbortController();
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        try { ctrl.abort(); } catch (_) { /* ignore */ }
        reject(timeoutError(label || 'odds job', timeoutMs));
      }, timeoutMs);
      Promise.resolve()
        .then(() => run(ctrl.signal))
        .then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { timeoutMs = ODDS_API_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  return withTimeout(
    async (signal) => {
      const r = await fetchImpl(url, { signal });
      if (!r.ok) {
        return { ok: false, status: r.status, data: null, error: new Error(`HTTP ${r.status}`) };
      }
      return { ok: true, status: r.status, data: await r.json(), error: null };
    },
    { timeoutMs, label: 'odds api' },
  ).catch((err) => ({ ok: false, status: 0, data: null, error: err }));
}

async function pullFeaturedSport(sport, {
  apiKey,
  fetchImpl,
  applyBookAdjustments,
  timeoutMs = ODDS_API_TIMEOUT_MS,
} = {}) {
  if (!apiKey) {
    return { sport, data: null, error: new Error('ODDS_API_KEY missing') };
  }
  const pulled = await fetchJson(featuredOddsUrl(sport, apiKey), { timeoutMs, fetchImpl });
  if (!pulled.ok || !Array.isArray(pulled.data)) {
    return { sport, data: null, error: pulled.error || new Error('featured fetch failed') };
  }
  const data = typeof applyBookAdjustments === 'function'
    ? applyBookAdjustments(pulled.data)
    : pulled.data;
  return { sport, data, error: null };
}

async function upsertFeatured(supabaseClient, sport, data, { timeoutMs = UPSERT_TIMEOUT_MS } = {}) {
  try {
    const result = await withTimeout(
      (signal) => applyAbortSignal(
        supabaseClient.from('odds_cache').upsert(
          { sport, data, fetched_at: new Date().toISOString() },
          { onConflict: 'sport' },
        ),
        signal,
      ),
      { timeoutMs, label: `odds_cache upsert ${sport}` },
    );
    return result && result.error ? result.error : null;
  } catch (err) {
    return err;
  }
}

function eventsInHorizon(data, nowMs, horizonMs = EVENT_HORIZON_MS) {
  const horizon = nowMs + horizonMs;
  return (Array.isArray(data) ? data : []).filter((g) => {
    const t = new Date(g.commence_time).getTime();
    return t > nowMs && t <= horizon;
  });
}

async function pullEventMarkets(sport, games, {
  apiKey,
  fetchImpl,
  applyBookAdjustments,
  supabaseClient,
  startedAt,
  respondByMs = FETCH_ODDS_RESPOND_BY_MS,
  nowMs = Date.now(),
} = {}) {
  const eventMarkets = EVENT_MARKETS[sport];
  if (!eventMarkets || !Array.isArray(games)) {
    return { sport, event_markets: 0 };
  }
  const eventsInWindow = eventsInHorizon(games, nowMs);
  const marketsParam = eventMarkets.join(',');
  let eventCount = 0;
  for (const game of eventsInWindow) {
    if (remainingMs(startedAt, respondByMs) < 2500) break;
    try {
      const evUrl = eventOddsUrl(sport, game.id, marketsParam, apiKey);
      const evResp = await fetchJson(evUrl, { fetchImpl });
      if (!evResp.ok || !evResp.data || !evResp.data.bookmakers || !evResp.data.bookmakers.length) {
        continue;
      }
      const evData = typeof applyBookAdjustments === 'function'
        ? applyBookAdjustments([evResp.data])[0]
        : evResp.data;
      const nowIso = new Date().toISOString();
      const { error: evError } = await withTimeout(
        (signal) => applyAbortSignal(
          supabaseClient.from('event_odds_cache').upsert({
            event_id: evData.id,
            sport,
            commence_time: evData.commence_time,
            home_team: evData.home_team,
            away_team: evData.away_team,
            data: evData,
            markets: eventMarkets,
            fetched_at: nowIso,
            updated_at: nowIso,
          }, { onConflict: 'event_id' }),
          signal,
        ),
        { timeoutMs: UPSERT_TIMEOUT_MS, label: `event_odds_cache upsert ${sport}` },
      ).catch((err) => ({ error: err }));
      if (!evError) eventCount++;
    } catch (evErr) {
      console.error(`event odds exception ${sport}/${game.id}:`, evErr && evErr.message);
    }
  }
  if (remainingMs(startedAt, respondByMs) >= 1500) {
    try {
      await withTimeout(
        (signal) => applyAbortSignal(
          supabaseClient
            .from('event_odds_cache')
            .delete()
            .eq('sport', sport)
            .lt('commence_time', new Date(nowMs - 6 * 60 * 60 * 1000).toISOString()),
          signal,
        ),
        { timeoutMs: 2000, label: `event_odds_cache cleanup ${sport}` },
      );
    } catch (_) { /* best-effort */ }
  }
  return { sport, event_markets: eventCount };
}

async function runFetchOddsJob({
  sports = FEATURED_SPORTS,
  featuredOnly = false,
  apiKey,
  fetchImpl,
  supabaseClient,
  applyBookAdjustments,
  nowMs = Date.now(),
  respondByMs = FETCH_ODDS_RESPOND_BY_MS,
  startedAt = nowMs,
  oddsApiTimeoutMs = ODDS_API_TIMEOUT_MS,
  upsertTimeoutMs = UPSERT_TIMEOUT_MS,
} = {}) {
  const results = [];
  const featured = [];
  let cacheUnreachable = false;

  const pulled = await Promise.all(
    (sports || []).map((sport) => pullFeaturedSport(sport, {
      apiKey,
      fetchImpl,
      applyBookAdjustments,
      timeoutMs: oddsApiTimeoutMs,
    })),
  );

  // Sequential cache writes. Parallel 1MB JSON upserts were losing the race
  // with PostgREST's statement timeout. If the origin is 5xx/hung, stop —
  // more upserts will not recover and would keep GET /api/fetch-odds open.
  for (let i = 0; i < pulled.length; i++) {
    const row = pulled[i];
    if (remainingMs(startedAt, respondByMs) < 1500) {
      results.push({ sport: row.sport, skipped: 'time_budget' });
      continue;
    }
    if (row.error || !Array.isArray(row.data)) {
      results.push({
        sport: row.sport,
        error: (row.error && row.error.message) || 'featured fetch failed',
      });
      continue;
    }
    const upsertErr = await upsertFeatured(supabaseClient, row.sport, row.data, { timeoutMs: upsertTimeoutMs });
    const entry = { sport: row.sport, games: row.data.length };
    if (upsertErr) entry.error = upsertErr.message || String(upsertErr);
    results.push(entry);
    featured.push({
      sport: row.sport,
      data: row.data,
      fetched_at: new Date().toISOString(),
    });
    if (upsertErr && isSupabaseUnreachable(upsertErr)) {
      cacheUnreachable = true;
      for (const rest of pulled.slice(i + 1)) {
        results.push({ sport: rest.sport, skipped: 'supabase_unreachable' });
      }
      break;
    }
  }

  if (!featuredOnly && !cacheUnreachable) {
    for (const row of pulled) {
      if (!Array.isArray(row.data)) continue;
      if (remainingMs(startedAt, respondByMs) < 2500) {
        results.push({ sport: row.sport, event_markets: 0, skipped: 'time_budget' });
        continue;
      }
      results.push(await pullEventMarkets(row.sport, row.data, {
        apiKey,
        fetchImpl,
        applyBookAdjustments,
        supabaseClient,
        startedAt,
        respondByMs,
        nowMs,
      }));
    }
  }

  return { success: !cacheUnreachable, results, featured, cacheUnreachable };
}

module.exports = {
  FEATURED_SPORTS,
  ALT_MARKETS,
  EVENT_MARKETS,
  EVENT_HORIZON_MS,
  ODDS_API_TIMEOUT_MS,
  FETCH_ODDS_RESPOND_BY_MS,
  UPSERT_TIMEOUT_MS,
  parseRequestedSports,
  isFeaturedOnlyQuery,
  remainingMs,
  featuredOddsUrl,
  eventOddsUrl,
  timeoutError,
  isSupabaseUnreachable,
  fetchJson,
  withTimeout,
  pullFeaturedSport,
  upsertFeatured,
  eventsInHorizon,
  runFetchOddsJob,
};
