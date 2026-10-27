'use strict';
const assert = require('assert');
const { confirmUnderdogLinesWithKalshi, fetchKalshiGameAsks, kalshiMarketForSide } = require('./underdog-kalshi-confirm');
const { gamesFromContentLines, fetchUnderdogPhone } = require('./underdog-lobby');
const { UNDERDOG_STALE_MS } = require('./underdog-freshness');

const NOW = Date.parse('2026-10-17T23:58:00Z');
const OLD = '2026-10-15T19:41:26.295Z'; // HOU @ JAX, unchanged 52h

function kalshiFetch(markets, { fail = false } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (fail) throw new Error('kalshi down');
    const series = /series_ticker=([A-Z]+)/.exec(url)[1];
    return { ok: true, json: async () => ({ markets: markets.filter((m) => m.event_ticker.startsWith(series)), cursor: '' }) };
  };
  fn.calls = calls;
  return fn;
}

const HOUJAC = 'KXNFLGAME-26OCT18HOUJAC';
const kalshiMarkets = [
  { ticker: `${HOUJAC}-HOU`, event_ticker: HOUJAC, yes_sub_title: 'Houston', yes_ask_dollars: '0.4400' },
  { ticker: `${HOUJAC}-JAC`, event_ticker: HOUJAC, yes_sub_title: 'Jacksonville', yes_ask_dollars: '0.5700' },
];

function option(id, choice, short, header, american, prob, updatedAt) {
  return {
    id, choice, choice_display_short: short, selection_header: header, event_ticker: HOUJAC,
    american_price: american, status: 'active', type: 'OverUnderOption', updated_at: updatedAt,
    odds: { fantasy: null, prediction: { american, decimal: '2', probability: prob, type: 'precision' }, sportsbook: null },
  };
}

function body(jaxProb = '57', updatedAt = OLD) {
  return {
    games: { 178920: { id: 178920, sport_id: 'NFL', status: 'scheduled', scheduled_at: '2026-10-18T13:30:00Z', full_team_names_title: 'Houston Texans @ Jacksonville Jaguars' } },
    appearances: { a1: { id: 'a1', match_id: 178920 } },
    over_under_lines: {
      l1: {
        id: 'l1', status: 'active',
        over_under: { appearance_stat: { appearance_id: 'a1', display_stat: 'Moneyline', stat: 'moneyline' } },
        options: [
          option('o1', 'away', 'HOU', 'Houston Texans', '+117', '44', updatedAt),
          option('o2', 'home', 'JAX', 'Jacksonville Jaguars', '-145', jaxProb, updatedAt),
        ],
      },
    },
  };
}

(async () => {
  // Side matching: Underdog JAX vs Kalshi JAC falls back to the team name.
  const asks = await fetchKalshiGameAsks(kalshiFetch(kalshiMarkets), ['NFL'], NOW, new Map());
  const evMarkets = asks.byEvent.get(HOUJAC);
  assert.equal(kalshiMarketForSide(evMarkets, { sideCode: 'HOU', name: 'Houston Texans' }).ask, 0.44);
  assert.equal(kalshiMarketForSide(evMarkets, { sideCode: 'JAX', sideName: 'Jacksonville Jaguars' }).ask, 0.57);
  assert.equal(kalshiMarketForSide([
    { code: 'LAR', sub: 'los angeles r', ask: 0.88 }, { code: 'ARI', sub: 'arizona', ask: 0.13 },
  ], { sideCode: 'XX', sideName: 'Los Angeles Rams' }).code, 'LAR');

  // Without Kalshi: a 52h-old unchanged moneyline is omitted (old behavior).
  assert.deepEqual(gamesFromContentLines(body(), 'NFL', NOW), [], '52h-old ML omitted without confirmation');

  // With Kalshi at the same price: both sides kept and restamped fresh.
  const games = gamesFromContentLines(body(), 'NFL', NOW, asks);
  assert.equal(games.length, 1);
  const h2h = games[0].lines.filter((l) => l.market === 'h2h');
  assert.equal(h2h.length, 2);
  for (const l of h2h) {
    assert.equal(l.confirmedBy, 'kalshi');
    assert.equal(l.updatedAt, NOW);
    assert.equal(l.priceChangedAt, Date.parse(OLD));
    assert.ok(NOW - l.updatedAt < UNDERDOG_STALE_MS, 'Promo-rankable');
    assert.equal(l.eventTicker, undefined, 'internal side keys stripped');
    assert.equal(l.sideCode, undefined);
    assert.equal(l.sideName, undefined);
  }

  // A frozen Underdog quote that no longer matches Kalshi is not confirmed.
  const off = confirmUnderdogLinesWithKalshi([
    { market: 'h2h', name: 'Jacksonville Jaguars', probability: 0.61, updatedAt: Date.parse(OLD), eventTicker: HOUJAC, sideCode: 'JAX', sideName: 'Jacksonville Jaguars' },
  ], asks);
  assert.equal(off[0].updatedAt, Date.parse(OLD));
  assert.equal(off[0].confirmedBy, undefined);
  // JAX 4c off Kalshi -> stays aged -> omitted; HOU orphan ML omitted too.
  assert.deepEqual(gamesFromContentLines(body('61'), 'NFL', NOW, asks), [], 'mismatched ML not rescued');

  // Spreads/totals are never confirmed.
  const spr = confirmUnderdogLinesWithKalshi([{ market: 'spreads', name: 'Houston Texans', probability: 0.44, updatedAt: 1, eventTicker: HOUJAC, sideCode: 'HOU' }], asks);
  assert.equal(spr[0].updatedAt, 1);

  // Kalshi down: nothing confirmed, nothing thrown.
  const down = await fetchKalshiGameAsks(kalshiFetch(kalshiMarkets, { fail: true }), ['NFL'], NOW, new Map());
  assert.equal(down.byEvent.size, 0);
  assert.deepEqual(gamesFromContentLines(body(), 'NFL', NOW, down), []);

  // fetchUnderdogPhone end to end: Kalshi read once per series, ML kept.
  const kf = kalshiFetch(kalshiMarkets);
  const udFetch = async (url) => {
    const isMl = url.includes('/content/lines') && url.includes('0251dd94-773d-47ec-878d-8a7349b8b967');
    const payload = url.includes('/scaffolds/') ? { sections: [] } : (isMl ? body() : { games: {}, over_under_lines: {} });
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  const r = await fetchUnderdogPhone({ env: {}, cache: new Map(), fetchFn: udFetch, kalshiFetchFn: kf, kalshiCache: new Map(), sports: 'NFL', now: NOW });
  assert.equal(r.games.length, 1);
  assert.equal(r.games[0].lines.filter((l) => l.market === 'h2h' && l.confirmedBy === 'kalshi').length, 2);
  assert.equal(kf.calls.length, 1);
  assert.ok(kf.calls[0].includes('series_ticker=KXNFLGAME'));

  // Injected fetchFn without kalshiFetchFn: no Kalshi read (old behavior).
  const r2 = await fetchUnderdogPhone({ env: {}, cache: new Map(), fetchFn: udFetch, sports: 'NFL', now: NOW });
  assert.equal(r2.games.length, 0);

  // ── 2026-10-27: Troy @ JMU, phone experience (no event_ticker on options).
  {
    const {
      phonePriceFromKalshiAsk, kalshiDriftPts, priceAgreesWithKalshi, kalshiEventForGame, americanFromPrice,
    } = require('./underdog-kalshi-confirm');
    const { priceDriftFromProbabilityPts, PRICE_SUSPECT_PTS } = require('./underdog-lobby');
    // Kalshi 8c + UDX fee → +1072 (phone +1070); 93c → about -1250.
    assert.ok(Math.abs(americanFromPrice(phonePriceFromKalshiAsk(0.08)) - 1072) <= 3);
    assert.ok(priceAgreesWithKalshi(1070, 0.08), 'phone Troy +1070 agrees with Kalshi 8c + fee');
    assert.ok(!priceAgreesWithKalshi(835, 0.08), 'stale Troy +835 does not');
    assert.ok(kalshiDriftPts(835, 0.08) > 2);
    assert.ok(priceAgreesWithKalshi(490, 0.16), 'Nets +490 at 16c');
    assert.ok(!priceAgreesWithKalshi(456, 0.16) || kalshiDriftPts(456, 0.16) > 0.5);
    // Price vs its own probability: +835 at 8 is >1.5 pts off; +1070 is not.
    assert.ok(priceDriftFromProbabilityPts(835, 0.08) > PRICE_SUSPECT_PTS);
    assert.ok(Math.abs(priceDriftFromProbabilityPts(1070, 0.08)) < 1);

    const TJ = 'KXNCAAFGAME-26OCT28TROYJMU';
    const SH = 'KXNCAAFGAME-26OCT31SHSUKENN';
    const cfbMarkets = [
      { ticker: `${TJ}-TROY`, event_ticker: TJ, yes_sub_title: 'Troy', yes_ask_dollars: '0.0800', expected_expiration_time: '2026-10-29T03:00:00Z' },
      { ticker: `${TJ}-JMU`, event_ticker: TJ, yes_sub_title: 'James Madison', yes_ask_dollars: '0.9300', expected_expiration_time: '2026-10-29T03:00:00Z' },
      { ticker: `${SH}-SHSU`, event_ticker: SH, yes_sub_title: 'Sam Houston', yes_ask_dollars: '0.4000', expected_expiration_time: '2026-10-31T22:00:00Z' },
      { ticker: `${SH}-KENN`, event_ticker: SH, yes_sub_title: 'Kennesaw St.', yes_ask_dollars: '0.6200', expected_expiration_time: '2026-10-31T22:00:00Z' },
    ];
    const cf = kalshiFetch(cfbMarkets);
    const cAsks = await fetchKalshiGameAsks(cf, ['CFB'], NOW, new Map());
    const troyGame = { away: 'Troy Trojans', home: 'James Madison Dukes', scheduledAt: '2026-10-29T00:00:00Z' };
    assert.equal(kalshiEventForGame(cAsks.byEvent, troyGame), cAsks.byEvent.get(TJ));
    assert.equal(kalshiEventForGame(cAsks.byEvent, { ...troyGame, scheduledAt: '2026-11-05T00:00:00Z' }), null, 'a different week is not the same game');
    // "Kennesaw St." on Kalshi = "Kennesaw State Owls" on Underdog.
    assert.equal(kalshiEventForGame(cAsks.byEvent, { away: 'Sam Houston Bearkats', home: 'Kennesaw State Owls', scheduledAt: '2026-10-31T19:00:00Z' }), cAsks.byEvent.get(SH));

    const T0 = Date.parse(OLD);
    const side = (name, american, probability) => ({ market: 'h2h', name, american, probability, updatedAt: T0, sideName: name });
    const fresh = confirmUnderdogLinesWithKalshi([side('Troy Trojans', 1070, 0.08), side('James Madison Dukes', -1250, 0.92)], cAsks, troyGame);
    for (const l of fresh) {
      assert.equal(l.confirmedBy, 'kalshi', `${l.name} matched by name and price`);
      assert.equal(l.updatedAt, NOW);
      assert.ok(Math.abs(l.kalshiDriftPts) <= 1);
    }
    const stale = confirmUnderdogLinesWithKalshi([side('Troy Trojans', 835, 0.08)], cAsks, troyGame);
    assert.equal(stale[0].confirmedBy, undefined, 'same probability, stale price: not restamped');
    assert.equal(stale[0].updatedAt, T0);
    assert.ok(stale[0].kalshiDriftPts > 2);
    const suspect = confirmUnderdogLinesWithKalshi([{ ...side('Troy Trojans', 1070, 0.08), priceSuspect: true }], cAsks, troyGame);
    assert.equal(suspect[0].confirmedBy, undefined, 'a print flagged suspect is never restamped');
    const noGame = confirmUnderdogLinesWithKalshi([side('Troy Trojans', 1070, 0.08)], cAsks, null);
    assert.equal(noGame[0].confirmedBy, undefined, 'no ticker and no game: nothing to match');
  }

  // Lobby parse: sanity flag/reject against probability + fee.
  {
    const { linesFromContent } = require('./underdog-lobby');
    const mk = (american, prob) => ({
      over_under_lines: { l: {
        id: 'l', status: 'active',
        over_under: { appearance_stat: { appearance_id: 'a1', display_stat: 'Moneyline', stat: 'moneyline' } },
        options: [{ id: 'o', choice: 'away', selection_header: 'Troy Trojans', american_price: String(american), status: 'active', updated_at: OLD,
          odds: { prediction: { american: String(american), decimal: '2', probability: String(prob) } } }],
      } },
    });
    const ok = linesFromContent(mk('+1070', '8'));
    assert.equal(ok.length, 1); assert.equal(ok[0].priceSuspect, undefined);
    const sus = linesFromContent(mk('+835', '8'));
    assert.equal(sus.length, 1); assert.equal(sus[0].priceSuspect, true); assert.ok(sus[0].priceDriftPts > 1.5);
    const phantom = linesFromContent(mk('+2000', '15'));
    assert.equal(phantom.length, 0, 'a print paying >3 pts more than its probability is dropped');
  }

  console.log('underdog-kalshi-confirm tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
