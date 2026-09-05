// Stake-linear helpers + a yielding unique-game parlay scan.
// App.jsx findTopParlays stays full enumerate-then-sort (heap declined there).
// The chunked React path streams a bounded top-k so Safari does not OOM from
// materializing all C(n,3) objects (~1.3M at PARLAY_LEG_CAP=200). The shown
// top-k set matches full sort (same EV ranking, no sampling).

export const SCAN_YIELD_MS = 8;
export const SCAN_MAX_PROMO_LEGS = 8;
export const SCAN_GROW_FROM_3_SEEDS = 50;

// Identity of the boost/nosweat scan inputs, including pool contents. Used so
// the UI can tell "never scanned this slate" from "scan finished with []".
export function promoScanInputKey({
  promoType,
  numLegs,
  scanBoostPct,
  parsedMinFinal,
  parsedMaxFinal,
  refundPct,
  creditConversionPct,
  pool,
}) {
  const list = pool || [];
  let fp = list.length;
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    const s = `${l.game ?? ""}\0${l.name ?? ""}`;
    for (let j = 0; j < s.length; j++) {
      fp = ((fp << 5) - fp + s.charCodeAt(j)) | 0;
    }
  }
  return [
    promoType,
    numLegs,
    scanBoostPct,
    parsedMinFinal ?? "",
    parsedMaxFinal ?? "",
    refundPct,
    creditConversionPct,
    list.length,
    fp,
  ].join("|");
}

// Same American-numeric convention as App.jsx / promo-ev min+max filters.
export function passesOddsBounds(odds, minOdds, maxOdds) {
  if (minOdds !== null && odds < minOdds) return false;
  if (maxOdds !== null && odds > maxOdds) return false;
  return true;
}

// Empty-state for Promo Builder parlay results. "No Results Found" is only
// valid after a scan has completed for the *current* inputs. First paint
// (busy=false, parlays=[], no completion yet) must show scanning, not empty.
export function promoScanEmptyState({
  promoLoaded,
  promoLoading,
  scanBusy,
  scanCompletedForCurrent,
  resultCount,
}) {
  if (resultCount > 0) return "results";
  if (!promoLoaded || promoLoading || scanBusy || !scanCompletedForCurrent) {
    return "scanning";
  }
  return "no-results";
}

// iOS / Safari: thousands of MessageChannel ports (one per yield) have
// crashed tabs with "A problem repeatedly occurred". Prefer a timer there.
export function preferTimerYield(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  const ua = nav.userAgent || "";
  const iOS = /iP(hone|ad|od)/.test(ua)
    || (typeof nav.platform === "string" && nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const safari = /safari/i.test(ua) && !/chrome|crios|chromium|android|edg/i.test(ua);
  return iOS || safari;
}

let yieldChannel = null;

export function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === "function") {
    return globalThis.scheduler.yield();
  }
  if (typeof window !== "undefined" && preferTimerYield()) {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  // MessageChannel is a faster yield in the browser, but Node keeps the
  // process alive if ports are left open — so only use it in a window.
  // Reuse one pair so a long C(n,3) scan does not open thousands of ports.
  if (typeof window !== "undefined" && typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      if (!yieldChannel) yieldChannel = new MessageChannel();
      yieldChannel.port1.onmessage = () => {
        yieldChannel.port1.onmessage = null;
        resolve();
      };
      yieldChannel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Bounded min-heap by ev. Size stays <= maxResults; finalize sorts desc.
// Same top-k as allocate-all-then-sort — no sampling, no quality loss for
// the cards we render (maxResults, typically 50).
export function considerTopByEv(heap, item, maxResults) {
  if (!item || maxResults <= 0) return heap;
  if (heap.length < maxResults) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].ev <= heap[i].ev) break;
      const tmp = heap[p];
      heap[p] = heap[i];
      heap[i] = tmp;
      i = p;
    }
    return heap;
  }
  if (item.ev > heap[0].ev) {
    heap[0] = item;
    let i = 0;
    const n = heap.length;
    while (true) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < n && heap[l].ev < heap[s].ev) s = l;
      if (r < n && heap[r].ev < heap[s].ev) s = r;
      if (s === i) break;
      const tmp = heap[i];
      heap[i] = heap[s];
      heap[s] = tmp;
      i = s;
    }
  }
  return heap;
}

export function finalizeTopByEv(heap) {
  return (heap || []).slice().sort((a, b) => b.ev - a.ev);
}

// Skip allocating a result object unless it can enter the top-k.
export function shouldTake(heap, ev, maxResults) {
  if (maxResults <= 0) return false;
  return heap.length < maxResults || ev > heap[0].ev;
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

function growFromSeeds(legs, numLegs, seeds, calc, maxResults, minFinalOdds, maxFinalOdds) {
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
    if (!passesOddsBounds(current.parlayOdds, minFinalOdds, maxFinalOdds)) continue;
    const key = parlayLegKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    grown.push(current);
  }
  grown.sort((a, b) => b.ev - a.ev);
  return grown.slice(0, maxResults);
}

// Enumerate the same unique-game loops as App.jsx findTopParlays, but keep
// only a bounded top-k (streaming min-heap). Yields so the page stays
// interactive during C(n,3) over ~200 legs without allocating C(n,3) objects.
export async function findTopParlaysChunked(
  legs,
  numLegs,
  calc,
  {
    maxResults = 10,
    minFinalOdds = null,
    maxFinalOdds = null,
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
      maxFinalOdds: null,
      signal,
      yieldMs,
      yieldFn,
      maxPromoLegs,
      growFrom3Seeds,
    });
    throwIfAborted(signal);
    return growFromSeeds(list, numLegs, seeds, calc, maxResults, minFinalOdds, maxFinalOdds);
  }

  const top = [];
  const getGame = (leg) => leg.game;
  const takeIfTop = (r, comboLegs) => {
    if (!passesOddsBounds(r.parlayOdds, minFinalOdds, maxFinalOdds)) return;
    if (!shouldTake(top, r.ev, maxResults)) return;
    considerTopByEv(top, { legs: comboLegs, ...r }, maxResults);
  };

  let combos = 0;
  if (numLegs === 1) {
    for (let i = 0; i < list.length; i++) {
      takeIfTop(calc([list[i]]), [list[i]]);
      if ((++combos & 255) === 0) await maybeYield(state, yieldMs, yieldFn, signal);
    }
  } else if (numLegs === 2) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (getGame(list[i]) === getGame(list[j])) continue;
        takeIfTop(calc([list[i], list[j]]), [list[i], list[j]]);
        if ((++combos & 255) === 0) await maybeYield(state, yieldMs, yieldFn, signal);
      }
    }
  } else if (numLegs === 3) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (getGame(list[i]) === getGame(list[j])) continue;
        for (let k = j + 1; k < list.length; k++) {
          if (getGame(list[k]) === getGame(list[i]) || getGame(list[k]) === getGame(list[j])) continue;
          takeIfTop(calc([list[i], list[j], list[k]]), [list[i], list[j], list[k]]);
          if ((++combos & 255) === 0) await maybeYield(state, yieldMs, yieldFn, signal);
        }
      }
    }
  }

  return finalizeTopByEv(top);
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
