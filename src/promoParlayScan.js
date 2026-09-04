// Stake-linear helpers + a yielding enumerate-then-sort scan.
// Ranking matches App.jsx findTopParlays (full C(n,k) then sort). No heap,
// no sampling, no PARLAY_LEG_CAP change. The sync function stays in App.jsx
// for tests; React must call findTopParlaysChunked from an effect, never render.

export const SCAN_YIELD_MS = 8;
export const SCAN_MAX_PROMO_LEGS = 8;
export const SCAN_GROW_FROM_3_SEEDS = 50;

export function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === "function") {
    return globalThis.scheduler.yield();
  }
  // MessageChannel is a faster yield in the browser, but Node keeps the
  // process alive if ports are left open — so only use it in a window.
  if (typeof window !== "undefined" && typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}

async function maybeYield(state, yieldMs, yieldFn, signal) {
  const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  if (now - state.lastYield < yieldMs) return;
  throwIfAborted(signal);
  await yieldFn();
  state.lastYield = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function parlayLegKey(p) {
  return p.legs.map((l) => `${l.game}\0${l.name}`).sort().join("\n");
}

function growFromSeeds(legs, numLegs, seeds, calc, maxResults, minFinalOdds) {
  const seen = new Set();
  const grown = [];
  for (const seed of seeds) {
    let current = seed;
    let failed = false;
    for (let n = current.legs.length; n < numLegs; n++) {
      const usedGames = new Set(current.legs.map((l) => l.game));
      let best = null;
      for (const cand of legs) {
        if (usedGames.has(cand.game)) continue;
        const nextLegs = current.legs.concat(cand);
        const r = calc(nextLegs);
        if (!best || r.ev > best.ev) best = { legs: nextLegs, ...r };
      }
      if (!best) { failed = true; break; }
      current = best;
    }
    if (failed || current.legs.length !== numLegs) continue;
    if (minFinalOdds !== null && current.parlayOdds < minFinalOdds) continue;
    const key = parlayLegKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    grown.push(current);
  }
  grown.sort((a, b) => b.ev - a.ev);
  return grown.slice(0, maxResults);
}

// Full enumerate-then-sort, same loops as App.jsx findTopParlays. Yields so
// the page stays interactive during C(n,3) over ~200 legs.
export async function findTopParlaysChunked(
  legs,
  numLegs,
  calc,
  {
    maxResults = 10,
    minFinalOdds = null,
    signal = null,
    yieldMs = SCAN_YIELD_MS,
    yieldFn = yieldToMain,
    maxPromoLegs = SCAN_MAX_PROMO_LEGS,
    growFrom3Seeds = SCAN_GROW_FROM_3_SEEDS,
  } = {},
) {
  throwIfAborted(signal);
  const list = legs || [];
  const state = {
    lastYield: typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(),
  };

  if (numLegs > 3 && numLegs <= maxPromoLegs) {
    const seedCount = Math.max(maxResults, growFrom3Seeds);
    const seeds = await findTopParlaysChunked(list, 3, calc, {
      maxResults: seedCount,
      minFinalOdds: null,
      signal,
      yieldMs,
      yieldFn,
      maxPromoLegs,
      growFrom3Seeds,
    });
    throwIfAborted(signal);
    return growFromSeeds(list, numLegs, seeds, calc, maxResults, minFinalOdds);
  }

  const results = [];
  const getGame = (leg) => leg.game;

  let combos = 0;
  if (numLegs === 1) {
    for (let i = 0; i < list.length; i++) {
      const r = calc([list[i]]);
      if (minFinalOdds === null || r.parlayOdds >= minFinalOdds) {
        results.push({ legs: [list[i]], ...r });
      }
      if ((++combos & 255) === 0) await maybeYield(state, yieldMs, yieldFn, signal);
    }
  } else if (numLegs === 2) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (getGame(list[i]) === getGame(list[j])) continue;
        const r = calc([list[i], list[j]]);
        if (minFinalOdds === null || r.parlayOdds >= minFinalOdds) {
          results.push({ legs: [list[i], list[j]], ...r });
        }
        if ((++combos & 255) === 0) await maybeYield(state, yieldMs, yieldFn, signal);
      }
    }
  } else if (numLegs === 3) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (getGame(list[i]) === getGame(list[j])) continue;
        for (let k = j + 1; k < list.length; k++) {
          if (getGame(list[k]) === getGame(list[i]) || getGame(list[k]) === getGame(list[j])) continue;
          const r = calc([list[i], list[j], list[k]]);
          if (minFinalOdds === null || r.parlayOdds >= minFinalOdds) {
            results.push({ legs: [list[i], list[j], list[k]], ...r });
          }
          if ((++combos & 255) === 0) await maybeYield(state, yieldMs, yieldFn, signal);
        }
      }
    }
  }

  results.sort((a, b) => b.ev - a.ev);
  return results.slice(0, maxResults);
}

const STAKE_LINEAR_FIELDS = [
  "ev",
  "boostedProfit",
  "winProfit",
  "loseNet",
  "refund",
  "creditValue",
];

export function rescaleParlaysForStake(parlays, fromStake, toStake) {
  if (!parlays?.length) return parlays || [];
  const from = Number(fromStake);
  const to = Number(toStake);
  if (!isFinite(from) || from === 0 || from === to) return parlays;
  if (!isFinite(to)) {
    return parlays.map((p) => {
      const next = { ...p };
      for (const field of STAKE_LINEAR_FIELDS) {
        if (typeof p[field] === "number") next[field] = 0;
      }
      return next;
    });
  }
  const scale = to / from;
  return parlays.map((p) => {
    const next = { ...p };
    for (const field of STAKE_LINEAR_FIELDS) {
      if (typeof p[field] === "number") next[field] = p[field] * scale;
    }
    return next;
  });
}

export function rescaleFreeBetConversions(list, fromAmount, toAmount) {
  if (!list?.length) return list || [];
  const from = Number(fromAmount);
  const to = Number(toAmount);
  if (!isFinite(from) || from === 0 || from === to) return list;
  if (!isFinite(to)) {
    return list.map((x) => ({ ...x, hedgeStake: 0, guaranteedCash: 0 }));
  }
  const scale = to / from;
  return list.map((x) => ({
    ...x,
    hedgeStake: x.hedgeStake * scale,
    guaranteedCash: x.guaranteedCash * scale,
  }));
}
