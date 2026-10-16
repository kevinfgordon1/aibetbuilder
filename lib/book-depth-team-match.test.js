// Shared-word team matching: "New Orleans Saints" must not match "New York Giants".
const assert = require('assert');
const bd = require('./book-depth.js');

const t = (s) => bd.nameTokens ? bd.nameTokens(s) : null;
// Event title matching
assert.equal(bd.eventMatchesTeams('New York Giants @ Houston Texans', 'New Orleans Saints', 'New York Giants'), false);
assert.equal(bd.eventMatchesTeams('New Orleans Saints @ New York Giants', 'New Orleans Saints', 'New York Giants'), true);
assert.equal(bd.eventMatchesTeams('Los Angeles Rams @ Seattle Seahawks', 'Los Angeles Chargers', 'Seattle Seahawks'), false);
assert.equal(bd.eventMatchesTeams('Los Angeles Chargers @ Seattle Seahawks', 'Los Angeles Chargers', 'Seattle Seahawks'), true);
assert.equal(bd.eventMatchesTeams('San Francisco 49ers @ Arizona Cardinals', 'San Diego Padres', 'Arizona Cardinals'), false);
assert.equal(bd.eventMatchesTeams('NOLA Saints vs NY Giants', 'New Orleans Saints', 'New York Giants'), true);
assert.equal(bd.eventMatchesTeams('HOU Texans vs JAC Jaguars', 'Houston Texans', 'Jacksonville Jaguars'), true);

// Team picker: no closest guess
assert.equal(bd.pickBestTeamMatch('New Orleans Saints', ['New York Giants', 'Houston Texans']), null);
assert.equal(bd.pickBestTeamMatch('Los Angeles Rams', ['Los Angeles Chargers', 'Kansas City Chiefs']), null);
assert.equal(bd.pickBestTeamMatch('San Francisco 49ers', ['San Diego Padres', 'Arizona Cardinals']), null);
assert.equal(bd.pickBestTeamMatch('New Orleans Saints', ['New York Giants', 'New Orleans Saints']), 'New Orleans Saints');
assert.equal(bd.pickBestTeamMatch('Los Angeles FC', ['LA Galaxy', 'Los Angeles FC']), 'Los Angeles FC');

// Event by start time
const evs = [
  { description: 'New York Giants @ Houston Texans', startsTs: Date.parse('2026-10-25T17:00:00Z') },
  { description: 'New Orleans Saints @ New York Giants', startsTs: Date.parse('2026-10-18T17:00:00Z') },
];
const pick = (ct) => bd.pickEventByStart(evs, ct, (e) => e.startsTs);
assert.equal(pick('2026-10-18T17:00:00Z').description, 'New Orleans Saints @ New York Giants');
assert.equal(pick('2026-10-25T17:05:00Z').description, 'New York Giants @ Houston Texans');
assert.equal(pick('2026-11-08T17:00:00Z'), null);
assert.equal(bd.pickEventByStart(evs, null, (e) => e.startsTs), null);

// End to end: Novig with Giants @ Texans listed first
async function run() {
  const MONEY = (id, a, b) => ({ marketId: id, marketType: 'MONEY', status: 'OPEN', outcomes: [{ outcomeId: id + 'h', name: a }, { outcomeId: id + 'a', name: b }] });
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    let json;
    if (u.includes('/catalog/events')) json = { items: [
      { eventId: 'E1', description: 'New York Giants @ Houston Texans', status: 'OPEN_PREGAME', startsTs: Date.parse('2026-10-25T17:00:00Z') },
      { eventId: 'E2', description: 'New Orleans Saints @ New York Giants', status: 'OPEN_PREGAME', startsTs: Date.parse('2026-10-18T17:00:00Z') },
    ] };
    else if (u.includes('markets?event=E1')) json = { items: [MONEY('M1', 'HOU', 'NYG')] };
    else if (u.includes('markets?event=E2')) json = { items: [MONEY('M2', 'NYG', 'NO')] };
    else if (u.includes('/markets/M1/book')) json = { orders: { M1h: [{ price: '0.71', qty: 525000 }] } };
    else if (u.includes('/markets/M2/book')) json = { orders: { M2h: [{ price: '0.49', qty: 10000000 }] } };
    else json = {};
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
  };
  try {
    const [r] = await bd.resolveLegsDepth([{ bestOppBook: 'novig', sport: 'americanfootball_nfl', market: 'ML', game: 'New Orleans Saints @ New York Giants', bestOppName: 'New Orleans Saints', name: 'New York Giants', commence_time: '2026-10-18T17:00:00Z' }]);
    assert.equal(r.reason, 'ok', JSON.stringify(r));
    assert.equal(r.levels[0].american, -104);
  } finally { global.fetch = realFetch; }
  console.log('book-depth team match tests passed');
}
run().catch((e) => { console.error(e); process.exit(1); });
