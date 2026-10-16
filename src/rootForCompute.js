// Glue: locks + live venue data → "What to root for" summary (pure; the API does the fetching).
import { legEvent, eventProbs, rootFor } from "./rootForEngine.js";
import { legFair, american } from "./rootForPrices.js";
import { lockPositions } from "./rootForLocks.js";

/** Kalshi tickers whose orderbooks we need (each leg + the opponent's ticker for moneylines). */
export function tickersNeeded(parlays) {
  const s = new Set();
  for (const p of parlays || []) for (const l of p.legs || []) {
    const r = legEvent(l);
    if (r.kind === "game") for (const t of r.outcomes) s.add(`${r.event}-${t}`);
    else if (l.ticker) s.add(String(l.ticker).toUpperCase());
  }
  return [...s];
}

export function computeRootFor({ parlays = [], fills = [], singles = [], kalshiBooks = {}, relay = {}, now = Date.now(), kalshiAt = now, opts = {} }) {
  const positions = []; const skipped = []; let resting = 0;
  for (const p of parlays) {
    const r = lockPositions(p, fills, singles);
    if (r.skip) { skipped.push({ id: p.id, label: p.label, reason: r.skip }); continue; }
    resting += r.positions[0].resting || 0;
    positions.push(...r.positions);
  }
  // leg fairs (one per distinct leg)
  const legP = {}; const legInfo = {}; const names = {}; const games = {};
  for (const pos of positions) for (const l of pos.legs) {
    const r = legEvent(l);
    if (r.kind === "game") {
      const team = r.allowed.length === 1 ? r.allowed[0] : null;
      if (l.label && team && !pos.single) names[`${r.event}:${team}`] = l.label;
      if (l.game) games[r.event] = l.game;
      if (!team) continue;
      const key = `${r.event}-${team}:yes`;
      if (!(key in legInfo)) { const f = legFair({ ticker: `${r.event}-${team}`, side: "yes" }, { kalshiBooks, relay, now, kalshiAt }); legInfo[key] = f; if (f.p != null) legP[key] = f.p; }
    } else {
      const key = `${r.event}:${r.allowed[0]}`;
      if (l.label && !pos.single) names[`${r.event}:${r.allowed[0]}`] = l.label + (l.side === "no" ? " (No)" : "");
      if (l.game) games[r.event] = l.game;
      if (!(key in legInfo)) { const f = legFair(l, { kalshiBooks, relay, now, kalshiAt }); legInfo[key] = f; if (f.p != null) legP[key] = f.p; }
    }
  }
  // a lock needs every leg priced
  const priced = []; const unpriced = [];
  for (const pos of positions) {
    const miss = pos.legs.find((l) => { const r = legEvent(l); const key = r.kind === "game" ? `${r.event}-${r.allowed.length === 1 ? r.allowed[0] : ""}:yes` : `${r.event}:${r.allowed[0]}`; return r.kind === "game" && r.allowed.length !== 1 ? false : legP[key] == null; });
    if (miss) unpriced.push({ id: pos.id, label: pos.label, leg: miss.label || miss.ticker, hit: pos.hit, miss: pos.miss }); else priced.push(pos);
  }
  const evList = [];
  const seen = new Set();
  for (const pos of priced) for (const l of pos.legs) { const r = legEvent(l); if (!seen.has(r.event)) { seen.add(r.event); evList.push({ event: r.event, kind: r.kind, outcomes: r.outcomes }); } }
  const { probs, bothSides } = eventProbs(evList, legP);
  const res = rootFor(priced, probs, opts);
  const nameOf = (event, outcome, kind) => {
    if (kind === "game") {
      // game string is "AWAY vs HOME" in ticker order, so outcome index picks the full team name
      const g = games[event]; const ev = evList.find((x) => x.event === event);
      const half = g && ev ? String(g).split(/\s+vs\.?\s+/i)[ev.outcomes.indexOf(outcome)] : null;
      return half || names[`${event}:${outcome}`] || outcome;
    }
    const n = names[`${event}:${outcome}`];
    if (n) return n;
    const other = names[`${event}:${outcome === "yes" ? "no" : "yes"}`];
    return other ? `Not: ${other}` : `${event} ${outcome}`;
  };
  const decorate = (r) => ({ ...r, name: nameOf(r.event, r.outcome, r.kind), game: games[r.event] || r.event, american: american(r.p) });
  return {
    ...res,
    top: res.top.map(decorate),
    perEvent: res.perEvent.map((e) => ({ ...e, game: games[e.event] || e.event, rootForName: e.rootFor != null ? nameOf(e.event, e.rootFor, e.kind) : null, american: american(e.p), outcomes: e.outcomes.map(decorate) })),
    legs: Object.entries(legInfo).map(([k, f]) => ({ key: k, p: f.p, american: f.american, best: f.best, oppAmerican: f.oppAmerican, sources: f.sources })),
    locksPriced: priced.filter((x) => !x.single).length, locksTotal: parlays.length, unpriced, skipped, bothSides, resting,
    sumIfAllMiss: priced.reduce((a, x) => a + x.miss, 0),
    positions: priced.map(({ id, label, hit, miss, filled, received, kind, stake, american: am }) => ({ id, label, hit, miss, filled, received, kind, stake, american: am })),
  };
}
