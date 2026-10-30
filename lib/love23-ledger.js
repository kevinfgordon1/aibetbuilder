'use strict';

// love23 promo ledger, weekly (Tuesday to Tuesday by default). Pure functions.
//
// Inputs
//   daily:   [{ date: 'YYYY-MM-DD', winLoss }]  love23 settled net per day
//            (persisted from /v1/players/settled into love23_daily; the API
//            only returns the current week)
//   entries: love23_ledger rows:
//              hedge       manual PM hedge (stake, american, result, pnl)
//              adjust      love23 net correction, counted in the week of created_at
//              carry       opening carry-forward balance (profit cushion) at promo start
//              settlement  cash actually settled for a week (+ client received, - client paid)
//   promoStart: 'YYYY-MM-DD' (days before are ignored)
//   nowMs:   clock; the week containing today is the open (current) week
//   atRisk:  love23 balance.atRisk, for the "all open bets lose" projection
//
// Rules: lib/love23-weekly.js settleWeek (50% of a losing week past carry,
// discount capped per week; winning weeks carry forward).

const R = require('./love23-rebate');
const Wk = require('./love23-weekly');

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function settledDailyFromApi(payload) {
  // /v1/players/settled?mode=0 -> [{ date: 'MM/DD/YYYY', winLossAmount, orders: [...] }]
  const out = [];
  for (const d of Array.isArray(payload) ? payload : []) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d && d.date || ''));
    if (!m) continue;
    const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    out.push({ date: iso, winLoss: num(d.winLossAmount), orders: Array.isArray(d.orders) ? d.orders.length : 0 });
  }
  return out;
}

function entryDate(e) {
  const t = Date.parse(e.settled_at || e.created_at || '');
  return Number.isFinite(t) ? Wk.etDate(t) : null;
}

function computeLedger({ daily = [], entries = [], promoStart = null, cfg, nowMs = Date.now(), atRisk = 0 } = {}) {
  const c = R.withDefaults(cfg);
  const dow = c.weekStartDow;
  const today = Wk.etDate(nowMs);
  const currentStart = Wk.weekStartOf(today, dow);
  const inPromo = (iso) => iso && (!promoStart || iso >= promoStart);

  const byWeek = new Map();
  const wk = (start) => {
    if (!byWeek.has(start)) byWeek.set(start, { start, net: 0, adjust: 0, hedgePnl: 0, settlementsRecorded: 0, days: 0 });
    return byWeek.get(start);
  };
  for (const d of daily) {
    if (!d || !inPromo(d.date)) continue;
    const w = wk(Wk.weekStartOf(d.date, dow));
    w.net += num(d.winLoss);
    if (num(d.winLoss) !== 0) w.days += 1;
  }
  let openingCarry = 0;
  let hedgeOpenStake = 0;
  for (const e of entries) {
    const iso = entryDate(e);
    if (e.kind === 'carry') { openingCarry += num(e.pnl); continue; }
    if (e.kind === 'hedge' && (!e.result || e.result === 'open')) { hedgeOpenStake += num(e.stake); continue; }
    if (!iso || !inPromo(iso)) continue;
    const w = wk(Wk.weekStartOf(iso, dow));
    if (e.kind === 'adjust') { w.net += num(e.pnl); w.adjust += num(e.pnl); }
    else if (e.kind === 'hedge') w.hedgePnl += num(e.pnl);
    else if (e.kind === 'settlement' || e.kind === 'rebate_paid') w.settlementsRecorded += num(e.pnl);
  }
  wk(currentStart);
  // Fill gaps so every week from the first to the current one shows.
  const firstKey = [...byWeek.keys()].sort()[0];
  const first = promoStart ? Wk.weekStartOf(promoStart, dow) : firstKey;
  for (let s = first < firstKey ? first : firstKey; s < currentStart; s = Wk.isoAddDays(s, 7)) wk(s);

  let carry = Math.max(0, openingCarry);
  const weeks = [];
  let rebatesEarned = 0; let owed = 0; let credited = 0; let recorded = 0; let hedgePnl = 0; let love23Net = 0;
  let current = null;
  for (const start of [...byWeek.keys()].sort()) {
    const w = byWeek.get(start);
    const st = Wk.settleWeek(w.net, carry, c);
    const row = { ...w, end: Wk.isoAddDays(start, 7), closed: start < currentStart, ...st };
    hedgePnl += w.hedgePnl;
    recorded += w.settlementsRecorded;
    love23Net += w.net;
    if (start < currentStart) {
      rebatesEarned += st.rebate; owed += st.owed; credited += st.credited;
      carry = st.carryAfter;
      weeks.push(row);
    } else if (start === currentStart) {
      current = {
        ...row,
        ifEndedNow: st,
        ifOpenBetsLose: Wk.settleWeek(w.net - Math.max(0, num(atRisk)), carry, c),
      };
      weeks.push(row);
    } else {
      weeks.push(row); // future-dated adjustments (rare)
    }
  }
  const curRebate = current ? current.ifEndedNow.rebate : 0;
  return {
    weekStartDow: dow,
    weeks,
    current,
    carry,                              // carry entering the current week
    weekNet: current ? current.net : 0, // love23 net so far this week
    openingCarry,
    love23Net,
    rebatesEarned,                       // closed weeks
    owedClosedWeeks: owed,
    creditedClosedWeeks: credited,
    settlementsRecorded: recorded,
    // Client result for closed weeks: what love23 owes (+) or is owed (-), less cash recorded.
    balanceDue: credited - owed - recorded,
    hedgePnl,
    hedgeOpenStake,
    combinedNet: love23Net + rebatesEarned + curRebate + hedgePnl,
    state: { carry, weekNet: current ? current.net : 0 },
  };
}

module.exports = { computeLedger, settledDailyFromApi };
