'use strict';

const assert = require('node:assert/strict');
const {
  effectiveTake,
  polySlugSpec,
  specFromSeries,
  kalshiBasis,
  entryFromPolyEvent,
  entryFromKalshiEvent,
  topOfPolyBook,
  entriesFromProphetXEvent,
  buildElectionBoard,
  loadElectionBoard,
  resetElectionBoardCache,
  mergeCatalogEntries,
} = require('./election-board');

{
  const now = 1_000_000;
  const prev = [{ venue: 'kalshi', id: 'senate:MI', seenAt: now - 1000, contracts: [{ id: 'a' }] }];
  const merged = mergeCatalogEntries([], prev, now);
  assert.equal(merged.length, 1);
  const replaced = mergeCatalogEntries([{ venue: 'kalshi', id: 'senate:MI', contracts: [{ id: 'b' }] }], prev, now);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].contracts[0].id, 'b');
  const stale = mergeCatalogEntries([], [{ venue: 'kalshi', id: 'senate:MI', seenAt: now - 6 * 60 * 1000 }], now);
  assert.equal(stale.length, 0);
}

{
  const k = effectiveTake('kalshi', 0.5);
  assert.equal(k.fee, 0.02);
  assert.equal(k.effectivePrice, 0.52);
  assert.equal(k.american, -108);
  assert.equal(k.rawAmerican, -100);
}

{
  const p = effectiveTake('polymarket', 0.5);
  assert.equal(p.fee, 0.0695 * 0.5 * 0.5);
  assert.equal(p.effectivePrice, 0.5 + 0.0695 * 0.25);
  assert.equal(p.american, -107);
}

{
  const x = effectiveTake('prophetx', 0.5);
  assert.ok(Math.abs(x.effectivePrice - (0.5 / 0.99)) < 1e-12);
  assert.equal(x.american, -102);
}

{
  const mid = effectiveTake('robinhood', 0.5);
  assert.equal(mid.fee, 0.01);
  assert.equal(mid.effectivePrice, 0.51);
  const wing = effectiveTake('robinhood', 0.05);
  assert.equal(wing.fee, 0.10 * 0.05 * 0.95);
  assert.ok(wing.fee < 0.01);
}

assert.equal(effectiveTake('kalshi', 0.99), null);
{
  const sized = effectiveTake('kalshi', 0.99, { contracts: 1000 });
  assert.ok(sized);
  assert.ok(sized.effectivePrice > 0.99 && sized.effectivePrice < 1);
}
assert.equal(polySlugSpec('usse-tx-2026-11-03').id, 'senate:TX');
assert.equal(polySlugSpec('usgub-fl-2026-11-03').id, 'governor:FL');
assert.equal(polySlugSpec('usse-midterms-2026-11-03').id, 'control:senate');
assert.equal(polySlugSpec('usho-midterms-2026-11-03').id, 'control:house');
assert.equal(polySlugSpec('usse-mi-oak-2026-11-03'), null);
assert.equal(specFromSeries('SENATETX').id, 'senate:TX');
assert.equal(specFromSeries('GOVPARTYOH').id, 'governor:OH');
assert.equal(specFromSeries('CONTROLS').id, 'control:senate');
assert.equal(specFromSeries('KXNFLGAME'), null);

assert.equal(kalshiBasis({
  title: 'Will Democratics win the Senate race in Texas?',
  subtitle: 'Democratic party:: Democratic party',
  yes_sub_title: 'James Talarico',
  rules_primary: 'If a representative of the Democratic party is sworn in as a Senator of Texas, then the market resolves to Yes.',
}), 'party');
assert.equal(kalshiBasis({
  title: 'Will Susan Collins win the Maine Senate race?',
  subtitle: '',
  yes_sub_title: 'Susan Collins',
  rules_primary: 'If Susan Collins is sworn in, the market resolves to Yes.',
}), 'candidate');

{
  const top = topOfPolyBook({
    marketData: {
      offers: [{ px: { value: '0.9000' }, qty: '5' }, { px: { value: '0.4200' }, qty: '80' }],
      bids: [{ px: { value: '0.1000' }, qty: '9' }, { px: { value: '0.4000' }, qty: '15' }],
    },
  });
  assert.equal(top.yesAsk, 0.42);
  assert.equal(top.yesAskSize, 80);
  assert.equal(top.yesBid, 0.4);
  assert.equal(top.yesBidSize, 15);
}

{
  const poly = entryFromPolyEvent({
    event: {
      slug: 'usse-tx-2026-11-03',
      title: 'Texas Senate Election Winner',
      markets: [
        {
          slug: 'ewc-usse-tx-2026-11-03-dem',
          title: 'James Talarico (D)',
          feeCoefficient: 0.0695,
          bestAskQuote: { value: '0.6200' },
          bestBidQuote: { value: '0.5800' },
          active: true,
          closed: false,
        },
        {
          slug: 'ewc-usse-tx-2026-11-03-rep',
          title: 'Ken Paxton (R)',
          feeCoefficient: 0.0695,
          bestAskQuote: { value: '0.4000' },
          bestBidQuote: { value: '0.3600' },
          active: true,
          closed: false,
        },
      ],
    },
  });
  const kalshi = entryFromKalshiEvent({
    title: 'Texas Senate winner?',
    markets: [
      {
        ticker: 'SENATETX-26-D',
        title: 'Will Democratics win the Senate race in Texas?',
        subtitle: 'Democratic party:: Democratic party',
        yes_sub_title: 'James Talarico',
        rules_primary: 'If a representative of the Democratic party is sworn in, Yes.',
        status: 'active',
        yes_ask_dollars: '0.7000',
        yes_bid_dollars: '0.6600',
        yes_ask_size_fp: '100',
        yes_bid_size_fp: '40',
        no_ask_dollars: '0.3400',
      },
      {
        ticker: 'SENATETX-26-R',
        title: 'Will Republicans win the Senate race in Texas?',
        subtitle: 'Republican party:: Republican party',
        yes_sub_title: 'Ken Paxton',
        rules_primary: 'If a representative of the Republican party is sworn in, Yes.',
        status: 'active',
        yes_ask_dollars: '0.4800',
        yes_bid_dollars: '0.4500',
        yes_ask_size_fp: '80',
        yes_bid_size_fp: '25',
        no_ask_dollars: '0.5500',
      },
    ],
  }, specFromSeries('SENATETX'));

  const races = buildElectionBoard([poly, kalshi]);
  assert.equal(races.length, 1);
  const race = races[0];
  assert.equal(race.id, 'senate:TX');
  assert.equal(race.title, 'Texas Senate');
  assert.equal(race.kalshiBasis, 'party');
  assert.match(race.notes[0], /party/);
  assert.equal(race.sides.length, 2);
  const talarico = race.sides.find((s) => /Talarico/.test(s.name));
  assert.ok(talarico);
  assert.equal(talarico.venues.polymarket.yes.venue, 'polymarket');
  assert.equal(talarico.venues.kalshi.no.way, 'no');
  assert.equal(talarico.best.venue, 'kalshi');
  assert.equal(talarico.best.way, 'no');
  assert.equal(talarico.venues.kalshi.no.isBest, true);
  assert.equal(talarico.venues.polymarket.yes.isBest, false);
  assert.ok(talarico.venues.kalshi.no.effectivePrice < talarico.venues.polymarket.yes.effectivePrice);
}

{
  const cheap = (name, party, ask) => ({
    id: name,
    name,
    party,
    feeCoefficient: 0.0695,
    yesAsk: ask,
    yesBid: ask - 0.02,
    yesAskSize: 10,
    yesBidSize: 10,
  });
  const under = buildElectionBoard([{
    venue: 'polymarket',
    id: 'senate:MI',
    office: 'senate',
    state: 'MI',
    title: 'Michigan Senate',
    contracts: [cheap('Abdul El-Sayed (D)', 'D', 0.4), cheap('Mike Rogers (R)', 'R', 0.4)],
  }]);
  assert.ok(under[0].arb);
  assert.ok(under[0].arb.cost < 1);
  const over = buildElectionBoard([{
    venue: 'polymarket',
    id: 'senate:MI',
    office: 'senate',
    state: 'MI',
    title: 'Michigan Senate',
    contracts: [cheap('A', 'D', 0.49), cheap('B', 'R', 0.49)],
  }]);
  assert.equal(over[0].arb, null);
}

{
  const three = buildElectionBoard([{
    venue: 'polymarket',
    id: 'senate:MT',
    office: 'senate',
    state: 'MT',
    title: 'Montana Senate',
    contracts: [
      { id: 'a', name: 'Kurt Alme (R)', party: 'R', feeCoefficient: 0.0695, yesAsk: 0.2, yesBid: 0.18, yesAskSize: 5, yesBidSize: 5 },
      { id: 'b', name: 'Alani Bankhead (D)', party: 'D', feeCoefficient: 0.0695, yesAsk: 0.2, yesBid: 0.18, yesAskSize: 5, yesBidSize: 5 },
      { id: 'c', name: 'Seth Bodnar', party: null, feeCoefficient: 0.0695, yesAsk: 0.2, yesBid: 0.18, yesAskSize: 5, yesBidSize: 5 },
    ],
  }]);
  assert.equal(three[0].sides.length, 3);
  for (const side of three[0].sides) assert.equal(side.venues.polymarket.no, null);
  assert.ok(three[0].arb, 'buying every YES still locks the field');
}

{
  const poly = entryFromPolyEvent({
    slug: 'usse-ak-2026-11-03',
    markets: [
      { slug: 'ak-dem', title: 'Mary Peltola (D)', feeCoefficient: 0.0695, bestAskQuote: { value: '0.6000' }, bestBidQuote: { value: '0.5500' }, active: true },
      { slug: 'ak-rep', title: 'Dan Sullivan (R)', feeCoefficient: 0.0695, bestAskQuote: { value: '0.4200' }, bestBidQuote: { value: '0.4000' }, active: true },
    ],
  });
  const kalshi = entryFromKalshiEvent({
    markets: [
      {
        ticker: 'SENATEAK-26-D',
        title: 'Will Democratics win the Senate race in Alaska?',
        subtitle: 'Democratic party',
        yes_sub_title: 'Democratic party',
        rules_primary: 'If a representative of the Democratic party is sworn in, Yes.',
        status: 'active',
        yes_ask_dollars: '0.6100',
        yes_bid_dollars: '0.5800',
        yes_ask_size_fp: '12',
        yes_bid_size_fp: '9',
      },
      {
        ticker: 'SENATEAK-26-R',
        title: 'Will Republicans win the Senate race in Alaska?',
        subtitle: 'Republican party',
        yes_sub_title: 'Republican party',
        rules_primary: 'If a representative of the Republican party is sworn in, Yes.',
        status: 'active',
        yes_ask_dollars: '0.4300',
        yes_bid_dollars: '0.4000',
        yes_ask_size_fp: '14',
        yes_bid_size_fp: '8',
      },
    ],
  }, specFromSeries('SENATEAK'));
  const race = buildElectionBoard([kalshi, poly])[0];
  assert.equal(race.sides.length, 2);
  assert.ok(race.sides.some((s) => s.name === 'Mary Peltola'));
  assert.ok(race.sides.some((s) => s.name === 'Dan Sullivan'));
  const mary = race.sides.find((s) => s.name === 'Mary Peltola');
  assert.ok(mary.venues.polymarket.yes);
  assert.ok(mary.venues.kalshi.yes);
}

{
  // Rhode Island: Polymarket "John F. Reed" has no ask; Kalshi "Jack Reed" is 99¢.
  // The longshot is spelled two ways. That must be one race, two sides, no arb.
  const poly = entryFromPolyEvent({
    slug: 'usse-ri-2026-11-03',
    markets: [
      { slug: 'ri-rep', title: 'Raymond Tyler Mckay', feeCoefficient: 0.0695, bestAskQuote: { value: '0.0200' }, bestBidQuote: { value: '0.0100' }, active: true },
      { slug: 'ri-dem', title: 'John F. Reed', feeCoefficient: 0.0695, bestAskQuote: null, bestBidQuote: { value: '0.9800' }, active: true },
    ],
  });
  poly.contracts.find((c) => /Reed/.test(c.name)).party = 'D';
  poly.contracts.find((c) => /Mckay/.test(c.name)).party = 'R';
  const kalshi = entryFromKalshiEvent({
    markets: [
      {
        ticker: 'SENATERI-26-D',
        title: 'Will Democratics win the Senate race in Rhode Island?',
        subtitle: 'Democratic party',
        yes_sub_title: 'Jack Reed',
        rules_primary: 'If a representative of the Democratic party is sworn in, Yes.',
        status: 'active',
        yes_ask_dollars: '0.9900',
        yes_bid_dollars: '0.9800',
        yes_ask_size_fp: '5000',
        yes_bid_size_fp: '4000',
      },
      {
        ticker: 'SENATERI-26-R',
        title: 'Will Republicans win the Senate race in Rhode Island?',
        subtitle: 'Republican party',
        yes_sub_title: 'Raymond McKay',
        rules_primary: 'If a representative of the Republican party is sworn in, Yes.',
        status: 'active',
        yes_ask_dollars: '0.0110',
        yes_bid_dollars: '0.0100',
        yes_ask_size_fp: '8000',
        yes_bid_size_fp: '1000',
      },
    ],
  }, specFromSeries('SENATERI'));
  const race = buildElectionBoard([poly, kalshi])[0];
  assert.equal(race.sides.length, 2);
  assert.ok(race.sides.some((s) => /Reed/.test(s.name)));
  assert.ok(race.sides.some((s) => /McKay|Mckay/.test(s.name)));
  const reed = race.sides.find((s) => /Reed/.test(s.name));
  assert.ok(reed.venues.kalshi.yes);
  assert.equal(race.arb, null);
}

{
  const poly = entryFromPolyEvent({
    slug: 'usse-me-2026-11-03',
    markets: [
      { slug: 'me-dem', title: 'Troy Dale Jackson (D)', feeCoefficient: 0.0695, bestAskQuote: { value: '0.7000' }, bestBidQuote: { value: '0.6800' }, active: true },
      { slug: 'me-rep', title: 'Susan M Collins (R)', feeCoefficient: 0.0695, bestAskQuote: { value: '0.3100' }, bestBidQuote: { value: '0.2900' }, active: true },
    ],
  });
  const kalshi = entryFromKalshiEvent({
    markets: [
      {
        ticker: 'SENATEME-26-D', title: 'Will Troy Jackson win?', subtitle: '', yes_sub_title: 'Troy Jackson',
        rules_primary: 'If Troy Jackson is sworn in, Yes.', status: 'active',
        yes_ask_dollars: '0.6900', yes_bid_dollars: '0.6700', yes_ask_size_fp: '20', yes_bid_size_fp: '10',
      },
      {
        ticker: 'SENATEME-26-R', title: 'Will Susan Collins win?', subtitle: '', yes_sub_title: 'Susan Collins',
        rules_primary: 'If Susan Collins is sworn in, Yes.', status: 'active',
        yes_ask_dollars: '0.3200', yes_bid_dollars: '0.3000', yes_ask_size_fp: '20', yes_bid_size_fp: '10',
      },
    ],
  }, specFromSeries('SENATEME'));
  const race = buildElectionBoard([poly, kalshi])[0];
  assert.equal(race.sides.length, 2);
  const troy = race.sides.find((s) => /Jackson/.test(s.name));
  assert.ok(troy.venues.polymarket.yes && troy.venues.kalshi.yes);
}

{
  const entry = entriesFromProphetXEvent('Texas Senate', [
    {
      selections: [
        [
          { name: 'James Talarico', price: 1.5, quantity: 100 },
          { name: 'James Talarico', price: 1.4, quantity: 50 },
        ],
        [{ name: 'Ken Paxton', price: 3.2, quantity: 80 }],
      ],
    },
  ]);
  assert.equal(entry.id, 'senate:TX');
  assert.equal(entry.contracts.length, 2);
  const talarico = entry.contracts.find((c) => /Talarico/.test(c.name));
  assert.ok(Math.abs(talarico.yesAsk - (1 / 1.5)) < 1e-12);
}

function jsonRes(body, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body };
}

(async () => {
  resetElectionBoardCache();
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes('/v1/sports')) return jsonRes({ data: [{ id: 5, name: 'Tennis' }] });
    if (u.includes('/events/slug/usse-tx-2026-11-03')) {
      return jsonRes({
        event: {
          slug: 'usse-tx-2026-11-03',
          markets: [
            { slug: 'tx-dem', title: 'James Talarico (D)', feeCoefficient: 0.0695, bestAskQuote: { value: '0.5000' }, bestBidQuote: { value: '0.4800' }, active: true },
            { slug: 'tx-rep', title: 'Ken Paxton (R)', feeCoefficient: 0.0695, bestAskQuote: { value: '0.5200' }, bestBidQuote: { value: '0.5000' }, active: true },
          ],
        },
      });
    }
    if (u.includes('/events/slug/usse-midterms-2026-11-03')) {
      return jsonRes({
        event: {
          slug: 'usse-midterms-2026-11-03',
          markets: [
            { slug: 'sen-dem', title: 'Democratic Party', feeCoefficient: 0.0695, bestAskQuote: { value: '0.7300' }, bestBidQuote: { value: '0.7200' }, active: true },
            { slug: 'sen-rep', title: 'Republican Party', feeCoefficient: 0.0695, bestAskQuote: { value: '0.2800' }, bestBidQuote: { value: '0.2700' }, active: true },
          ],
        },
      });
    }
    if (u.includes('/events/slug/')) return jsonRes({ error: 'no' }, false);
    if (u.includes('/markets/tx-dem/book')) {
      return jsonRes({ marketData: { offers: [{ px: { value: '0.4200' }, qty: '1000' }], bids: [{ px: { value: '0.4000' }, qty: '800' }] } });
    }
    if (u.includes('/markets/') && u.endsWith('/book')) {
      return jsonRes({ marketData: { offers: [], bids: [] } });
    }
    if (u.includes('/series?')) {
      if (u.includes('category=Elections')) {
        return jsonRes({
          series: [
            { ticker: 'SENATETX', title: 'Texas Senate race' },
            { ticker: 'CONTROLS', title: 'Senate winner' },
            { ticker: 'KXNFLGAME', title: 'Pro football' },
          ],
          cursor: '',
        });
      }
      return jsonRes({ series: [], cursor: '' });
    }
    if (u.includes('series_ticker=SENATETX')) {
      return jsonRes({
        events: [{
          event_ticker: 'SENATETX-26',
          title: 'Texas Senate winner?',
          markets: [
            {
              ticker: 'SENATETX-26-D',
              status: 'active',
              title: 'Will Democratics win the Senate race in Texas?',
              subtitle: 'Democratic party',
              yes_sub_title: 'James Talarico',
              rules_primary: 'If a representative of the Democratic party is sworn in, Yes.',
              yes_ask_dollars: '0.6000',
              yes_bid_dollars: '0.5800',
              yes_ask_size_fp: '10',
              yes_bid_size_fp: '8',
              no_ask_dollars: '0.4200',
            },
            {
              ticker: 'SENATETX-26-R',
              status: 'active',
              title: 'Will Republicans win the Senate race in Texas?',
              subtitle: 'Republican party',
              yes_sub_title: 'Ken Paxton',
              rules_primary: 'If a representative of the Republican party is sworn in, Yes.',
              yes_ask_dollars: '0.4300',
              yes_bid_dollars: '0.4000',
              yes_ask_size_fp: '12',
              yes_bid_size_fp: '9',
              no_ask_dollars: '0.6000',
            },
          ],
        }],
      });
    }
    if (u.includes('series_ticker=CONTROLS')) {
      return jsonRes({
        events: [{
          event_ticker: 'CONTROLS-2026',
          markets: [
            {
              ticker: 'CONTROLS-2026-D',
              status: 'active',
              title: 'Will Democrats win the U.S. Senate in 2026?',
              yes_sub_title: 'Democratic Party',
              rules_primary: 'If the Democratic Party has won control of the U.S. Senate, Yes.',
              yes_ask_dollars: '0.7400',
              yes_bid_dollars: '0.7300',
              yes_ask_size_fp: '50',
              yes_bid_size_fp: '40',
              no_ask_dollars: '0.2700',
            },
            {
              ticker: 'CONTROLS-2026-R',
              status: 'active',
              title: 'Will Republicans win the U.S. Senate in 2026?',
              yes_sub_title: 'Republican Party',
              rules_primary: 'If the Republican Party has won control of the U.S. Senate, Yes.',
              yes_ask_dollars: '0.2700',
              yes_bid_dollars: '0.2600',
              yes_ask_size_fp: '60',
              yes_bid_size_fp: '30',
              no_ask_dollars: '0.7400',
            },
          ],
        }],
      });
    }
    if (u.includes('/markets?tickers=')) {
      return jsonRes({
        markets: [
          {
            ticker: 'SENATETX-26-D',
            yes_ask_dollars: '0.6100',
            yes_bid_dollars: '0.5900',
            yes_ask_size_fp: '22',
            yes_bid_size_fp: '11',
            no_ask_dollars: '0.4100',
            title: 'Will Democratics win the Senate race in Texas?',
            subtitle: 'Democratic party',
            yes_sub_title: 'James Talarico',
          },
        ],
      });
    }
    return jsonRes({}, false);
  };

  delete process.env.PROPHETX_API_KEY;
  delete process.env.PROPHETX_ACCESS_KEY;
  delete process.env.PROPHETX_SECRET_KEY;
  const board = await loadElectionBoard({ fetchFn, fresh: true, stateCodes: ['TX'], env: {} });
  assert.equal(board.ok, true);
  assert.equal(board.venues.robinhood.status, 'skipped');
  assert.equal(board.venues.prophetx.status, 'no_public_feed');
  const ids = board.races.map((r) => r.id);
  assert.ok(ids.includes('control:senate'));
  assert.ok(ids.includes('senate:TX'));
  assert.equal(ids[0], 'control:senate');
  const tx = board.races.find((r) => r.id === 'senate:TX');
  const tal = tx.sides.find((s) => /Talarico/.test(s.name));
  assert.equal(tal.venues.polymarket.yes.price, 0.42);
  assert.equal(tal.venues.polymarket.yes.depthContracts, 1000);
  assert.equal(tal.venues.kalshi.yes.price, 0.61);
  assert.equal(tal.venues.kalshi.yes.depthContracts, 22);
  assert.ok(calls.some((u) => u.includes('gateway.polymarket.us')));
  assert.ok(!calls.some((u) => u.includes('gamma-api.polymarket.com') || u.includes('clob.polymarket.com')));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
