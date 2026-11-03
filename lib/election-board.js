'use strict';

// 2026 midterm prices for the New Odds Board Politics tab.
//
// Polymarket US (gateway.polymarket.us, not the international CLOB) and
// Kalshi's public elections API. No Betstamp, no Underdog.
//
// ProphetX lists politics in the app, but the public sports catalog does not,
// and the affiliate book needs a market-data key. When that key is already
// configured (PROPHETX_API_KEY or access/secret) we read it. Otherwise the
// column stays empty and the response says so.
//
// Robinhood event contracts have no public order book. The fee formula is
// implemented and tested so a feed can be dropped in; the loader does not
// invent prices.
//
// A two-outcome race can be backed two ways: buy YES on that side, or buy NO
// on the other side (the NO ask is 1 − the other side's YES bid). Both are
// fee-adjusted. Kalshi's taker fee is rounded up to the next cent on a
// 1-contract take. Best is the lowest fee-adjusted cost. An arb is a set of
// those best prices that pays $1 and costs less than $1.

const POLY_GATEWAY = 'https://gateway.polymarket.us';
const KALSHI_REST = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const PROPHETX_PUBLIC = 'https://cash.api.prophetx.co/trade/public/api/v1';
const PROPHETX_PARTNER = process.env.PROPHETX_API_BASE || 'https://cash.api.prophetx.co/partner';

const POLY_FEE = 0.0695;
const KALSHI_FEE = 0.07;
const PROPHETX_WIN_FEE = 0.02;
const ROBINHOOD_FEE = 0.10;
const ROBINHOOD_FEE_CAP = 0.01;

const CATALOG_MS = 60_000;
const BODY_MS = 1_500;
const ENTRY_KEEP_MS = 5 * 60 * 1000;
const POOL = 12;

const STATE_NAME = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});

const STATE_CODES = Object.freeze(Object.keys(STATE_NAME));

const cache = {
  catalog: null,
  catalogAt: 0,
  body: null,
  bodyAt: 0,
  inflight: null,
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function priceOrNull(value) {
  const n = num(value);
  if (!(n > 0 && n < 1)) return null;
  return n;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function roundUpCents(dollars) {
  if (!(dollars > 0)) return 0;
  return Math.ceil(dollars * 100 - 1e-9) / 100;
}

// Same rounding as src/blendAskLadder.js impliedProbToAmerican.
function impliedProbToAmerican(p) {
  if (p == null || !Number.isFinite(p) || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -Math.round((100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function effectiveTake(venue, price, opts) {
  const p = Number(price);
  if (!(p > 0 && p < 1)) return null;
  const key = String(venue || '');
  let fee = 0;
  let effective = p;
  if (key === 'kalshi') {
    // The exchange rounds the whole order up to the next cent. Use the
    // contracts at this price (default 1) so a 1¢ round does not turn a
    // 99¢ favorite into an unbuyable $1.
    const contracts = Math.max(1, Number(opts && opts.contracts) || 1);
    fee = roundUpCents(contracts * KALSHI_FEE * p * (1 - p)) / contracts;
    effective = p + fee;
  } else if (key === 'polymarket') {
    const rate = opts && Number(opts.feeCoefficient) > 0 ? Number(opts.feeCoefficient) : POLY_FEE;
    fee = rate * p * (1 - p);
    effective = p + fee;
  } else if (key === 'prophetx') {
    // 2% of net winnings. Cost per $1 of what you actually collect.
    effective = p / (1 - PROPHETX_WIN_FEE + PROPHETX_WIN_FEE * p);
    fee = effective - p;
  } else if (key === 'robinhood') {
    fee = Math.min(ROBINHOOD_FEE * p * (1 - p), ROBINHOOD_FEE_CAP);
    effective = p + fee;
  } else {
    return null;
  }
  if (!(effective > 0 && effective < 1)) return null;
  return {
    price: p,
    fee,
    effectivePrice: effective,
    american: impliedProbToAmerican(effective),
    rawAmerican: impliedProbToAmerican(p),
  };
}

function polySlugSpec(slug) {
  const s = String(slug || '');
  if (s === 'usse-midterms-2026-11-03') {
    return { id: 'control:senate', office: 'control', state: null, chamber: 'senate' };
  }
  if (s === 'usho-midterms-2026-11-03') {
    return { id: 'control:house', office: 'control', state: null, chamber: 'house' };
  }
  let m = /^usse-([a-z]{2})-2026-11-03$/.exec(s);
  if (m && STATE_NAME[m[1].toUpperCase()]) {
    const state = m[1].toUpperCase();
    return { id: `senate:${state}`, office: 'senate', state, chamber: null };
  }
  m = /^usgub-([a-z]{2})-2026-11-03$/.exec(s);
  if (m && STATE_NAME[m[1].toUpperCase()]) {
    const state = m[1].toUpperCase();
    return { id: `governor:${state}`, office: 'governor', state, chamber: null };
  }
  return null;
}

function polyProbeSlugs(stateCodes) {
  const codes = stateCodes && stateCodes.length ? stateCodes : STATE_CODES;
  const slugs = ['usse-midterms-2026-11-03', 'usho-midterms-2026-11-03'];
  for (const code of codes) {
    const st = String(code || '').toLowerCase();
    if (!STATE_NAME[st.toUpperCase()]) continue;
    slugs.push(`usse-${st}-2026-11-03`, `usgub-${st}-2026-11-03`);
  }
  return slugs;
}

function specFromSeries(ticker) {
  const t = String(ticker || '');
  if (t === 'CONTROLS') return { id: 'control:senate', office: 'control', state: null, chamber: 'senate' };
  if (t === 'CONTROLH') return { id: 'control:house', office: 'control', state: null, chamber: 'house' };
  let m = /^SENATE([A-Z]{2})$/.exec(t);
  if (m && STATE_NAME[m[1]]) return { id: `senate:${m[1]}`, office: 'senate', state: m[1], chamber: null };
  m = /^GOVPARTY([A-Z]{2})$/.exec(t);
  if (m && STATE_NAME[m[1]]) return { id: `governor:${m[1]}`, office: 'governor', state: m[1], chamber: null };
  m = /^SENATEPARTY-?([A-Z]{2})$/.exec(t);
  if (m && STATE_NAME[m[1]]) return { id: `senate:${m[1]}`, office: 'senate', state: m[1], chamber: null, fallback: true };
  return null;
}

function raceTitle(spec) {
  if (!spec) return '';
  if (spec.id === 'control:senate') return 'Senate control';
  if (spec.id === 'control:house') return 'House control';
  const name = STATE_NAME[spec.state] || spec.state || '';
  if (spec.office === 'senate') return `${name} Senate`;
  if (spec.office === 'governor') return `${name} Governor`;
  return name || spec.id;
}

function kalshiBasis(market) {
  const rules = `${market && market.rules_primary || ''} ${market && market.title || ''} ${market && market.subtitle || ''}`;
  if (/representative of the (democratic|republican) party/i.test(rules)) return 'party';
  if (/democratic party|republican party/i.test(rules)) return 'party';
  if (/will democratics|will republicans|will democrats|democrats win|republicans win/i.test(rules)) return 'party';
  if (/^(democratic|republican|independent) party$/i.test(String(market && market.yes_sub_title || '').trim())) return 'party';
  return 'candidate';
}

function partyFromKalshiTicker(ticker) {
  const suf = String(ticker || '').split('-').pop();
  if (suf === 'D') return 'D';
  if (suf === 'R') return 'R';
  if (suf === 'I' || suf === 'IND') return 'I';
  return null;
}

function partyFromText(text) {
  const s = String(text || '');
  if (/\(D\)/i.test(s) || /\bdemocrats?\b/i.test(s) || /\bdemocratic\b/i.test(s)) return 'D';
  if (/\(R\)/i.test(s) || /\brepublicans?\b/i.test(s) || /\brepublican\b/i.test(s)) return 'R';
  if (/\(I\)/i.test(s) || /\bindependents?\b/i.test(s)) return 'I';
  return null;
}

function partyFromPoly(market) {
  const title = market && market.title || '';
  const slug = String(market && market.slug || '');
  if (/\(D\)/i.test(title) || /-dem$/.test(slug) || /democratic/i.test(title)) return 'D';
  if (/\(R\)/i.test(title) || /-rep$/.test(slug) || /republican/i.test(title)) return 'R';
  if (/\(I\)/i.test(title) || /-ind$/.test(slug) || /independent/i.test(title)) return 'I';
  return partyFromText(title);
}

function isPartyLabel(name) {
  return /^(democratic|republican|democrat|independent)( party)?$/i.test(String(name || '').trim());
}

function stripPartySuffix(name) {
  return String(name || '').replace(/\s*\([DRIL]\)\s*$/i, '').trim();
}

function normName(name) {
  return stripPartySuffix(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function partyDisplay(party, fallback) {
  if (party === 'D') return 'Democratic Party';
  if (party === 'R') return 'Republican Party';
  if (party === 'I') return 'Independent';
  return fallback || 'Side';
}

function levelPxQty(level) {
  if (!level || typeof level !== 'object') return { price: null, size: null };
  const px = level.px && level.px.value != null ? level.px.value : level.price;
  const qty = level.qty != null ? level.qty : level.size;
  return { price: priceOrNull(px), size: num(qty) };
}

function topOfPolyBook(book) {
  const md = book && (book.marketData || book) || {};
  const offers = md.offers || md.asks || [];
  const bids = md.bids || [];
  let yesAsk = null;
  let yesAskSize = null;
  let yesBid = null;
  let yesBidSize = null;
  for (const level of offers) {
    const { price, size } = levelPxQty(level);
    if (price == null || !(size > 0)) continue;
    if (yesAsk == null || price < yesAsk) {
      yesAsk = price;
      yesAskSize = size;
    }
  }
  for (const level of bids) {
    const { price, size } = levelPxQty(level);
    if (price == null || !(size > 0)) continue;
    if (yesBid == null || price > yesBid) {
      yesBid = price;
      yesBidSize = size;
    }
  }
  return { yesAsk, yesAskSize, yesBid, yesBidSize };
}

function entryFromPolyEvent(event) {
  const ev = event && (event.event || event);
  if (!ev || ev.closed === true) return null;
  const spec = polySlugSpec(ev.slug);
  if (!spec) return null;
  const contracts = [];
  for (const market of ev.markets || []) {
    if (!market || market.closed === true || market.active === false || market.hidden === true) continue;
    const name = stripPartySuffix(market.title || market.question || '');
    if (!name) continue;
    contracts.push({
      id: market.slug || name,
      name: market.title || name,
      party: partyFromPoly(market),
      feeCoefficient: (() => {
        const coeff = num(market.feeCoefficient);
        return coeff > 0 && coeff < 0.5 ? coeff : POLY_FEE;
      })(),
      yesAsk: priceOrNull(market.bestAskQuote && market.bestAskQuote.value),
      yesBid: priceOrNull(market.bestBidQuote && market.bestBidQuote.value),
      yesAskSize: null,
      yesBidSize: null,
    });
  }
  if (!contracts.length) return null;
  return { venue: 'polymarket', ...spec, title: raceTitle(spec), basis: null, contracts };
}

function entryFromKalshiEvent(event, spec) {
  if (!event || !spec) return null;
  const contracts = [];
  let partyN = 0;
  let candidateN = 0;
  for (const market of event.markets || []) {
    if (!market) continue;
    const status = String(market.status || 'active');
    if (status && status !== 'active') continue;
    const basis = kalshiBasis(market);
    if (basis === 'party') partyN += 1;
    else candidateN += 1;
    const name = market.yes_sub_title || market.no_sub_title || market.title;
    if (!name) continue;
    contracts.push({
      id: market.ticker,
      name,
      party: partyFromKalshiTicker(market.ticker) || partyFromText(name) || partyFromText(market.title),
      basis,
      yesAsk: priceOrNull(market.yes_ask_dollars),
      yesBid: priceOrNull(market.yes_bid_dollars),
      yesAskSize: num(market.yes_ask_size_fp),
      yesBidSize: num(market.yes_bid_size_fp),
      noAsk: priceOrNull(market.no_ask_dollars),
    });
  }
  if (!contracts.length) return null;
  let basis = null;
  if (partyN && !candidateN) basis = 'party';
  else if (candidateN && !partyN) basis = 'candidate';
  else if (partyN && candidateN) basis = 'mixed';
  return { venue: 'kalshi', ...spec, title: raceTitle(spec), basis, contracts };
}

function nameTokens(name) {
  return normName(name).split(' ').filter((token) => token && token !== 'party');
}

function samePerson(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const core = (tokens) => tokens.slice(0, -1).filter((token) => token.length > 1);
  const ca = core(ta);
  const cb = core(tb);
  if (!ca.length || !cb.length) return false;
  return ca.some((left) => cb.some((right) => left === right || left.startsWith(right) || right.startsWith(left)));
}

function quoteFromTake(venue, way, via, price, size, feeCoefficient) {
  const depthContracts = size > 0 ? size : null;
  const take = effectiveTake(venue, price, { feeCoefficient, contracts: venue === 'kalshi' ? (depthContracts || 1) : 1 });
  if (!take || take.american == null) return null;
  const depthDollars = depthContracts != null ? take.price * depthContracts : null;
  return {
    venue,
    way,
    via: stripPartySuffix(via || ''),
    american: take.american,
    rawAmerican: take.rawAmerican,
    price: take.price,
    fee: take.fee,
    effectivePrice: take.effectivePrice,
    depthContracts,
    depthDollars,
    isBest: false,
  };
}

function noPriceOf(contract) {
  if (!contract) return { price: null, size: null };
  if (contract.noAsk > 0 && contract.noAsk < 1) {
    return { price: contract.noAsk, size: contract.yesBidSize };
  }
  if (contract.yesBid > 0 && contract.yesBid < 1) {
    return { price: round4(1 - contract.yesBid), size: contract.yesBidSize };
  }
  return { price: null, size: null };
}

function sideKeyFor(contract) {
  const person = !isPartyLabel(contract.name);
  const name = person ? stripPartySuffix(contract.name) : partyDisplay(contract.party, contract.name);
  if (person && contract.party) return `p:${contract.party}:${normName(name)}`;
  if (contract.party) return `party:${contract.party}`;
  return `n:${normName(name)}`;
}

function blankSide(contract) {
  const person = !isPartyLabel(contract.name);
  return {
    key: sideKeyFor(contract),
    name: person ? stripPartySuffix(contract.name) : partyDisplay(contract.party, contract.name),
    party: contract.party || null,
    person,
    quotes: [],
  };
}

function findSide(sides, contract) {
  const person = !isPartyLabel(contract.name);
  if (person && contract.party) {
    const key = sideKeyFor(contract);
    if (sides.has(key)) return sides.get(key);
    const partyOnly = sides.get(`party:${contract.party}`);
    const people = [...sides.values()].filter((s) => s.person && s.party === contract.party);
    if (partyOnly && people.length === 0) return partyOnly;
    return null;
  }
  if (contract.party && !person) {
    const people = [...sides.values()].filter((s) => s.person && s.party === contract.party);
    if (people.length === 1) return people[0];
    return sides.get(`party:${contract.party}`) || null;
  }
  const want = normName(contract.name);
  return [...sides.values()].find((s) => normName(s.name) === want) || null;
}

function adoptPerson(side, contract) {
  if (!side || isPartyLabel(contract.name)) return side;
  const name = stripPartySuffix(contract.name);
  if (!side.person) {
    side.person = true;
    side.name = name;
    side.party = side.party || contract.party || null;
    side.key = sideKeyFor({ name, party: side.party });
  }
  return side;
}

function detachSide(sides, side) {
  for (const [key, value] of [...sides.entries()]) {
    if (value === side) sides.delete(key);
  }
}

function absorbSide(keep, other) {
  keep.quotes.push(...other.quotes);
  if (!keep.party && other.party) keep.party = other.party;
  if (other.person && other.name && other.name.length > keep.name.length) keep.name = other.name;
  keep.person = keep.person || other.person;
}

// One nominee is often "John F. Reed" on one venue and "Jack Reed" on the
// other, or "Troy Dale Jackson" and "Troy Jackson". Merge when the names
// are the same person, and when a party has a single contract per venue.
function coalesceSides(sides) {
  const list = [...sides.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!a || !b || a === b) continue;
      if (!sidesHas(sides, a) || !sidesHas(sides, b)) continue;
      if (a.party && b.party && a.party !== b.party) continue;
      if (!samePerson(a.name, b.name)) continue;
      absorbSide(a, b);
      detachSide(sides, b);
      list[j] = null;
    }
  }
  const byParty = new Map();
  for (const side of sides.values()) {
    if (!side.party || !side.person) continue;
    if (!byParty.has(side.party)) byParty.set(side.party, []);
    byParty.get(side.party).push(side);
  }
  for (const group of byParty.values()) {
    if (group.length < 2) continue;
    const perVenue = {};
    for (const side of group) {
      const venues = new Set(side.quotes.map((quote) => quote.venue));
      for (const venue of venues) perVenue[venue] = (perVenue[venue] || 0) + 1;
    }
    if (Object.values(perVenue).some((count) => count > 1)) continue;
    group.sort((a, b) => b.name.length - a.name.length);
    const keep = group[0];
    for (const other of group.slice(1)) {
      absorbSide(keep, other);
      detachSide(sides, other);
    }
  }
}

function sidesHas(sides, side) {
  for (const value of sides.values()) {
    if (value === side) return true;
  }
  return false;
}

function putQuote(bucket, quote) {
  if (!quote) return;
  const cur = bucket[quote.way];
  if (!cur || quote.effectivePrice < cur.effectivePrice) bucket[quote.way] = quote;
}

function buildElectionBoard(entries) {
  const byRace = new Map();
  for (const entry of entries || []) {
    if (!entry || !entry.id || !entry.contracts || !entry.contracts.length) continue;
    if (!byRace.has(entry.id)) {
      byRace.set(entry.id, {
        id: entry.id,
        office: entry.office,
        state: entry.state || null,
        chamber: entry.chamber || null,
        title: entry.title || raceTitle(entry),
        kalshiBasis: null,
        contracts: [],
      });
    }
    const race = byRace.get(entry.id);
    if (entry.venue === 'kalshi' && entry.basis) {
      if (!race.kalshiBasis) race.kalshiBasis = entry.basis;
      else if (race.kalshiBasis !== entry.basis) race.kalshiBasis = 'mixed';
    }
    for (const contract of entry.contracts) {
      race.contracts.push({ entry, contract });
    }
  }

  const races = [];
  for (const race of byRace.values()) {
    const sides = new Map();
    for (const row of race.contracts) {
      let side = findSide(sides, row.contract);
      if (!side) {
        side = blankSide(row.contract);
        sides.set(side.key, side);
      } else {
        adoptPerson(side, row.contract);
        if (sides.get(side.key) !== side) {
          const oldKeys = [];
          for (const [k, v] of sides) {
            if (v === side) oldKeys.push(k);
          }
          for (const k of oldKeys) sides.delete(k);
          sides.set(side.key, side);
        }
      }
      const yes = quoteFromTake(
        row.entry.venue,
        'yes',
        row.contract.name,
        row.contract.yesAsk,
        row.contract.yesAskSize,
        row.contract.feeCoefficient,
      );
      if (yes) side.quotes.push(yes);
    }

    coalesceSides(sides);
    const twoWay = sides.size === 2;
    if (twoWay) {
      for (const row of race.contracts) {
        const siblings = race.contracts.filter((other) => other.entry.venue === row.entry.venue && other.entry === row.entry);
        if (siblings.length !== 2) continue;
        const other = siblings.find((s) => s.contract !== row.contract);
        if (!other) continue;
        const side = findSide(sides, row.contract);
        if (!side) continue;
        const no = noPriceOf(other.contract);
        const quote = quoteFromTake(
          row.entry.venue,
          'no',
          other.contract.name,
          no.price,
          no.size,
          other.contract.feeCoefficient || row.contract.feeCoefficient,
        );
        if (quote) side.quotes.push(quote);
      }
    }

    const sideList = [...sides.values()].filter((s) => s.quotes.length);
    const builtSides = [];
    for (const side of sideList) {
      const venues = {};
      let best = null;
      for (const quote of side.quotes) {
        if (!venues[quote.venue]) venues[quote.venue] = { yes: null, no: null };
        putQuote(venues[quote.venue], quote);
      }
      for (const slot of Object.values(venues)) {
        for (const quote of [slot.yes, slot.no]) {
          if (!quote) continue;
          if (!best || quote.effectivePrice < best.effectivePrice) best = quote;
        }
      }
      if (best) {
        for (const slot of Object.values(venues)) {
          for (const quote of [slot.yes, slot.no]) {
            if (quote && Math.abs(quote.effectivePrice - best.effectivePrice) < 1e-9) quote.isBest = true;
          }
        }
      }
      builtSides.push({
        key: side.key,
        name: side.name,
        party: side.party,
        venues,
        best: best ? {
          venue: best.venue,
          way: best.way,
          american: best.american,
          effectivePrice: best.effectivePrice,
          via: best.via,
        } : null,
      });
    }
    builtSides.sort((a, b) => (b.best ? b.best.effectivePrice : 0) - (a.best ? a.best.effectivePrice : 0));
    if (!builtSides.length) continue;

    let arb = null;
    if (builtSides.length >= 2 && builtSides.every((s) => s.best)) {
      const cost = builtSides.reduce((sum, s) => sum + s.best.effectivePrice, 0);
      const rounded = Math.round(cost * 10000) / 10000;
      const favorite = Math.max(...builtSides.map((side) => side.best.effectivePrice));
      // A pair of 2¢ names is a missing favorite, not a lock. A real toss-up
      // still has a side well above that.
      if (rounded < 1 && favorite >= 0.15) {
        arb = { cost: rounded, edge: Math.round((1 - rounded) * 10000) / 10000, payout: 1 };
      }
    }

    const notes = [];
    if (race.kalshiBasis === 'party') {
      notes.push('Kalshi settles on the party. The name is who that contract lists; the payout follows the party, not the person.');
    } else if (race.kalshiBasis === 'candidate') {
      notes.push('Kalshi contract is the named candidate.');
    } else if (race.kalshiBasis === 'mixed') {
      notes.push('Kalshi lists both a party contract and a candidate contract on this race.');
    }

    let favoriteGap = 1;
    for (const side of builtSides) {
      if (side.best) favoriteGap = Math.min(favoriteGap, Math.abs(side.best.effectivePrice - 0.5));
    }

    races.push({
      id: race.id,
      office: race.office,
      state: race.state,
      chamber: race.chamber,
      title: race.title,
      kalshiBasis: race.kalshiBasis,
      notes,
      arb,
      favoriteGap,
      sides: builtSides,
    });
  }

  races.sort((a, b) => {
    const group = { control: 0, senate: 1, governor: 2 };
    const ga = group[a.office] ?? 9;
    const gb = group[b.office] ?? 9;
    if (ga !== gb) return ga - gb;
    if (a.office === 'control' && a.chamber !== b.chamber) {
      return a.chamber === 'senate' ? -1 : 1;
    }
    if (a.favoriteGap !== b.favoriteGap) return a.favoriteGap - b.favoriteGap;
    return String(a.title).localeCompare(String(b.title));
  });
  return races;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (_) {
        out[idx] = null;
      }
    }
  }
  if (!items.length) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function getJson(url, fetchFn, ms) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 8000) : null;
  try {
    const res = await fetchFn(url, {
      headers: { accept: 'application/json', 'user-agent': 'aibetbuilder-election-board' },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res || res.ok === false) return null;
    if (typeof res.json === 'function') return await res.json();
    return null;
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverPoly(fetchFn, stateCodes) {
  const slugs = polyProbeSlugs(stateCodes);
  const events = await mapPool(slugs, POOL, (slug) => getJson(
    `${POLY_GATEWAY}/v1/events/slug/${encodeURIComponent(slug)}`,
    fetchFn,
    8000,
  ));
  const entries = [];
  for (const body of events) {
    const entry = entryFromPolyEvent(body);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function listSeries(fetchFn, category) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 8; page += 1) {
    const url = `${KALSHI_REST}/series?limit=200&category=${encodeURIComponent(category)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await getJson(url, fetchFn, 8000);
    if (!body || !Array.isArray(body.series)) return out.length ? out : null;
    const series = body.series;
    out.push(...series);
    const next = body && body.cursor ? String(body.cursor) : '';
    if (!next || next === cursor || !series.length) break;
    cursor = next;
  }
  return out;
}

async function discoverKalshi(fetchFn) {
  const elections = await listSeries(fetchFn, 'Elections');
  const politics = await listSeries(fetchFn, 'Politics');
  if (!elections && !politics) return { entries: [], status: 'down' };
  const series = [...(elections || []), ...(politics || [])];
  const specs = [];
  const seenRace = new Set();
  const ranked = [];
  for (const row of series) {
    const spec = specFromSeries(row && row.ticker);
    if (!spec) continue;
    ranked.push({ ticker: row.ticker, spec });
  }
  ranked.sort((a, b) => Number(a.spec.fallback === true) - Number(b.spec.fallback === true));
  for (const row of ranked) {
    if (seenRace.has(row.spec.id)) continue;
    seenRace.add(row.spec.id);
    specs.push(row);
  }
  if (!specs.length) return { entries: [], status: 'down' };
  async function eventEntry(row) {
    const body = await getJson(
      `${KALSHI_REST}/events?series_ticker=${encodeURIComponent(row.ticker)}&status=open&with_nested_markets=true&limit=5`,
      fetchFn,
      8000,
    );
    const list = body && Array.isArray(body.events) ? body.events : [];
    const event = list.find((ev) => (ev.markets || []).some((m) => !m.status || m.status === 'active')) || list[0];
    return event ? entryFromKalshiEvent(event, row.spec) : null;
  }
  let events = await mapPool(specs, POOL, eventEntry);
  const missed = specs.filter((_, index) => !events[index]);
  if (missed.length) {
    const again = await mapPool(missed, 4, eventEntry);
    let cursor = 0;
    events = events.map((entry) => entry || again[cursor++] || null);
  }
  return { entries: events.filter(Boolean), status: 'ok' };
}

function prophetContractFromLevels(name, levels) {
  let best = null;
  for (const level of levels || []) {
    const raw = num(level && (level.price != null ? level.price : level.odds));
    const qty = num(level && (level.quantity != null ? level.quantity : level.stake));
    if (!(raw > 0) || !(qty > 0)) continue;
    let yesAsk = null;
    let dollars = null;
    if (raw > 1) {
      yesAsk = 1 / raw;
      dollars = qty;
    } else if (raw < 1) {
      yesAsk = raw;
      dollars = qty * raw;
    }
    if (!(yesAsk > 0 && yesAsk < 1)) continue;
    if (!best || yesAsk < best.yesAsk) {
      best = { yesAsk, yesAskSize: dollars / yesAsk, depthDollars: dollars };
    }
  }
  if (!best) return null;
  return {
    id: normName(name),
    name,
    party: partyFromText(name),
    yesAsk: best.yesAsk,
    yesBid: null,
    yesAskSize: best.yesAskSize,
    yesBidSize: null,
  };
}

function entriesFromProphetXEvent(eventName, markets) {
  const name = String(eventName || '');
  let spec = null;
  if (/senate control|control the senate|control of the senate/i.test(name)) {
    spec = { id: 'control:senate', office: 'control', state: null, chamber: 'senate' };
  } else if (/house control|control the house|control of the house/i.test(name)) {
    spec = { id: 'control:house', office: 'control', state: null, chamber: 'house' };
  } else {
    const byName = new Map(Object.entries(STATE_NAME).map(([code, label]) => [label.toLowerCase(), code]));
    const hit = /([A-Za-z .]+?)\s+(Senate|Governor)\b/.exec(name);
    if (hit) {
      const code = byName.get(hit[1].trim().toLowerCase());
      if (code) {
        const office = /governor/i.test(hit[2]) ? 'governor' : 'senate';
        spec = { id: `${office}:${code}`, office, state: code, chamber: null };
      }
    }
  }
  if (!spec) return null;
  const grouped = new Map();
  const flat = [];
  for (const market of markets || []) {
    const selections = market && market.selections;
    if (!Array.isArray(selections)) continue;
    for (const group of selections) {
      const rows = Array.isArray(group) ? group : [group];
      for (const row of rows) {
        if (row && row.name) flat.push(row);
      }
    }
  }
  for (const row of flat) {
    const key = String(row.name);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const contracts = [];
  for (const [label, levels] of grouped) {
    if (/^over$|^under$/i.test(label)) continue;
    const contract = prophetContractFromLevels(label, levels);
    if (contract) contracts.push(contract);
  }
  if (contracts.length < 2) return null;
  return { venue: 'prophetx', ...spec, title: raceTitle(spec), basis: null, contracts };
}

async function prophetXToken(fetchFn, env) {
  if (env.PROPHETX_API_KEY) return String(env.PROPHETX_API_KEY);
  if (!env.PROPHETX_ACCESS_KEY || !env.PROPHETX_SECRET_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchFn(`${PROPHETX_PARTNER}/auth/login`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ access_key: env.PROPHETX_ACCESS_KEY, secret_key: env.PROPHETX_SECRET_KEY }),
      signal: ctrl.signal,
    });
    if (!res || !res.ok) return null;
    const body = await res.json();
    return body && body.data && body.data.access_token || null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadProphetX(fetchFn, env) {
  const creds = env || process.env;
  const token = await prophetXToken(fetchFn, creds);
  if (token) {
    const listed = await getJson(`${PROPHETX_PARTNER}/affiliate/get_sport_events`, async (url, init) => fetchFn(url, {
      ...init,
      headers: { ...(init && init.headers), authorization: token },
    }), 8000);
    const data = listed && (listed.data || listed);
    const events = (data && (data.sport_events || data.events)) || [];
    const wanted = events.filter((ev) => /senate|governor|house control|senate control|midterm/i.test(`${ev && (ev.name || ev.display_name || ev.displayName) || ''}`)).slice(0, 30);
    const entries = [];
    await mapPool(wanted, 6, async (ev) => {
      const id = ev.event_id != null ? ev.event_id : ev.id;
      if (id == null) return;
      const body = await getJson(
        `${PROPHETX_PARTNER}/v4/affiliate/get_markets?event_id=${encodeURIComponent(id)}`,
        async (url, init) => fetchFn(url, { ...init, headers: { ...(init && init.headers), authorization: token } }),
        8000,
      );
      const markets = body && (Array.isArray(body.data) ? body.data : (body.data && body.data.markets)) || [];
      const entry = entriesFromProphetXEvent(ev.name || ev.display_name || ev.displayName, markets);
      if (entry) entries.push(entry);
    });
    return {
      status: entries.length ? 'ok' : 'no_markets',
      entries,
      detail: entries.length ? 'ProphetX affiliate book' : 'ProphetX key is set but no election markets came back.',
    };
  }
  const sports = await getJson(`${PROPHETX_PUBLIC}/sports`, fetchFn, 5000);
  const list = sports && Array.isArray(sports.data) ? sports.data : [];
  const politics = list.find((s) => /politic|election/i.test(s && s.name || ''));
  if (!politics) {
    return {
      status: 'no_public_feed',
      entries: [],
      detail: 'ProphetX public sports list has no politics. The affiliate book needs a market-data key that is not configured here.',
    };
  }
  return {
    status: 'no_public_feed',
    entries: [],
    detail: 'ProphetX has a politics sport on the public list, but no priced book without a market-data key.',
  };
}

function bookTargets(entries) {
  const targets = [];
  entries.forEach((entry, entryIndex) => {
    if (!entry || entry.venue !== 'polymarket') return;
    entry.contracts.forEach((contract, contractIndex) => {
      if (contract && contract.id) targets.push({ slug: contract.id, entryIndex, contractIndex });
    });
  });
  return targets;
}

function kalshiTickers(entries) {
  const out = [];
  for (const entry of entries) {
    if (!entry || entry.venue !== 'kalshi') continue;
    for (const contract of entry.contracts) {
      if (contract && contract.id) out.push(contract.id);
    }
  }
  return out;
}

async function fetchKalshiMarketMap(tickers, fetchFn) {
  const map = new Map();
  const chunks = [];
  for (let i = 0; i < tickers.length; i += 40) chunks.push(tickers.slice(i, i + 40));
  await mapPool(chunks, 4, async (chunk) => {
    const body = await getJson(
      `${KALSHI_REST}/markets?tickers=${chunk.join(',')}`,
      fetchFn,
      8000,
    );
    for (const market of (body && body.markets) || []) {
      if (market && market.ticker) map.set(market.ticker, market);
    }
  });
  return map;
}

function applyKalshiMarket(contract, market) {
  if (!market) return contract;
  const yesAsk = priceOrNull(market.yes_ask_dollars);
  const yesBid = priceOrNull(market.yes_bid_dollars);
  const noAsk = priceOrNull(market.no_ask_dollars);
  const yesAskSize = num(market.yes_ask_size_fp);
  const yesBidSize = num(market.yes_bid_size_fp);
  return {
    ...contract,
    yesAsk: yesAsk == null ? contract.yesAsk : yesAsk,
    yesBid: yesBid == null ? contract.yesBid : yesBid,
    yesAskSize: yesAskSize == null ? contract.yesAskSize : yesAskSize,
    yesBidSize: yesBidSize == null ? contract.yesBidSize : yesBidSize,
    noAsk: noAsk == null ? contract.noAsk : noAsk,
    basis: kalshiBasis(market) || contract.basis,
  };
}

function applyPolyBook(contract, book) {
  const top = topOfPolyBook(book);
  if (top.yesAsk == null && top.yesBid == null) return contract;
  return {
    ...contract,
    yesAsk: top.yesAsk != null ? top.yesAsk : contract.yesAsk,
    yesBid: top.yesBid != null ? top.yesBid : contract.yesBid,
    yesAskSize: top.yesAskSize != null ? top.yesAskSize : contract.yesAskSize,
    yesBidSize: top.yesBidSize != null ? top.yesBidSize : contract.yesBidSize,
  };
}

async function overlayPrices(entries, fetchFn) {
  const next = entries.map((entry) => ({ ...entry, contracts: entry.contracts.map((c) => ({ ...c })) }));
  const targets = bookTargets(next);
  const tickers = kalshiTickers(next);
  const [books, markets] = await Promise.all([
    mapPool(targets, POOL, (target) => getJson(
      `${POLY_GATEWAY}/v1/markets/${encodeURIComponent(target.slug)}/book`,
      fetchFn,
      8000,
    )),
    fetchKalshiMarketMap(tickers, fetchFn),
  ]);
  targets.forEach((target, i) => {
    const contract = next[target.entryIndex].contracts[target.contractIndex];
    next[target.entryIndex].contracts[target.contractIndex] = applyPolyBook(contract, books[i]);
  });
  for (const entry of next) {
    if (entry.venue !== 'kalshi') continue;
    entry.contracts = entry.contracts.map((contract) => applyKalshiMarket(contract, markets.get(contract.id)));
  }
  return next;
}

function venueSummary(entries, prophet, kalshiStatus) {
  const count = (venue) => entries.filter((e) => e && e.venue === venue).length;
  return {
    polymarket: { status: count('polymarket') ? 'ok' : 'no_markets', races: count('polymarket') },
    kalshi: {
      status: count('kalshi') ? 'ok' : (kalshiStatus || 'no_markets'),
      races: count('kalshi'),
    },
    prophetx: {
      status: prophet.status,
      races: count('prophetx'),
      detail: prophet.detail,
    },
    robinhood: {
      status: 'skipped',
      races: 0,
      detail: 'No public order book. Event contracts are in the Robinhood app; web is view-only and undocumented.',
    },
  };
}

function mergeCatalogEntries(fresh, previous, now) {
  const map = new Map();
  const cutoff = now - ENTRY_KEEP_MS;
  for (const entry of previous || []) {
    if (!entry || !entry.id || !entry.venue) continue;
    if ((entry.seenAt || 0) < cutoff) continue;
    map.set(`${entry.venue}:${entry.id}`, entry);
  }
  for (const entry of fresh || []) {
    if (!entry || !entry.id || !entry.venue) continue;
    map.set(`${entry.venue}:${entry.id}`, { ...entry, seenAt: now });
  }
  return [...map.values()];
}

async function refresh(deps) {
  const fetchFn = deps && deps.fetchFn || fetch;
  const env = deps && deps.env || process.env;
  const stateCodes = deps && deps.stateCodes;
  const now = Date.now();
  const [poly, kalshi, prophet] = await Promise.all([
    discoverPoly(fetchFn, stateCodes).catch(() => []),
    discoverKalshi(fetchFn).catch(() => ({ entries: [], status: 'down' })),
    loadProphetX(fetchFn, env).catch(() => ({ status: 'error', entries: [], detail: 'ProphetX did not answer.' })),
  ]);
  const fresh = [...poly, ...(kalshi.entries || []), ...(prophet.entries || [])];
  const previous = cache.catalog && cache.catalog.entries;
  const entries = mergeCatalogEntries(fresh, previous, now);
  let priced = entries;
  try {
    priced = await overlayPrices(entries, fetchFn);
  } catch (_) {
    priced = entries;
  }
  const races = buildElectionBoard(priced);
  return {
    ok: races.length > 0,
    updatedAt: new Date().toISOString(),
    venues: venueSummary(priced, prophet, kalshi.status),
    races,
    _entries: priced,
  };
}

async function loadElectionBoard(deps) {
  const now = deps && Number.isFinite(deps.now) ? deps.now : Date.now();
  const fresh = deps && deps.fresh === true;
  const ttl = deps && Number.isFinite(deps.ttl) ? deps.ttl : BODY_MS;
  if (!fresh && cache.body && now - cache.bodyAt < ttl) {
    return publicBody(cache.body);
  }
  if (!fresh && cache.inflight) return cache.inflight.then(publicBody);
  const run = (async () => {
    let catalog = cache.catalog;
    if (fresh || !catalog || now - cache.catalogAt >= CATALOG_MS) {
      const full = await refresh(deps);
      catalog = { entries: full._entries, venues: full.venues, at: Date.now() };
      if (!fresh) {
        cache.catalog = catalog;
        cache.catalogAt = Date.now();
      }
      const body = { ...full };
      delete body._entries;
      if (!fresh) {
        cache.body = body;
        cache.bodyAt = Date.now();
      }
      return body;
    }
    let priced = catalog.entries;
    try {
      priced = await overlayPrices(catalog.entries, deps && deps.fetchFn || fetch);
    } catch (_) {
      priced = catalog.entries;
    }
    const body = {
      ok: true,
      updatedAt: new Date().toISOString(),
      venues: venueSummary(priced, {
        status: catalog.venues.prophetx.status,
        detail: catalog.venues.prophetx.detail,
      }, catalog.venues.kalshi && catalog.venues.kalshi.status),
      races: buildElectionBoard(priced),
    };
    catalog.entries = priced;
    if (!fresh) {
      cache.body = body;
      cache.bodyAt = Date.now();
    }
    return body;
  })();
  if (!fresh) {
    cache.inflight = run.finally(() => {
      cache.inflight = null;
    });
    return cache.inflight;
  }
  return run;
}

function publicBody(body) {
  if (!body) return { ok: false, updatedAt: null, venues: {}, races: [] };
  return body;
}

function resetElectionBoardCache() {
  cache.catalog = null;
  cache.catalogAt = 0;
  cache.body = null;
  cache.bodyAt = 0;
  cache.inflight = null;
}

module.exports = {
  POLY_FEE,
  KALSHI_FEE,
  PROPHETX_WIN_FEE,
  ROBINHOOD_FEE,
  ROBINHOOD_FEE_CAP,
  STATE_NAME,
  effectiveTake,
  impliedProbToAmerican,
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
};
