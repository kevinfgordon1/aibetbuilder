// Structured copy for the Promo "Guaranteed Profit" expand.
// Only uses numbers the lock helpers already computed plus known book/price
// fields. Never invents a fill, hedge book, hedge price, or available size.

import { formatAmericanOdds, formatAvailableDollars } from "./trueOddsLine.js";

function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return null;
  return `$${v.toFixed(2)}`;
}

function signedMoney(n) {
  const v = Number(n);
  if (!isFinite(v)) return null;
  const abs = Math.abs(v).toFixed(2);
  return (v < 0 ? "-$" : "+$") + abs;
}

function american(odds) {
  if (odds == null || odds === "") return null;
  const text = formatAmericanOdds(odds);
  return text === "—" ? null : text;
}

// $1-payout contract costs 1 / decimal. contracts = hedge$ × decimal.
// Only meaningful when the hedge venue is an exchange and both inputs are known.
export function hedgeContractsFromStake(hedgeStake, hedgeDecimal) {
  const h = Number(hedgeStake);
  const d = Number(hedgeDecimal);
  if (!(h > 0) || !(d > 1) || !isFinite(h) || !isFinite(d)) return null;
  return h * d;
}

export function formatHedgeContracts(n) {
  if (!(n > 0) || !isFinite(n)) return null;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 0.05) return String(rounded);
  return n.toFixed(1);
}

function lockedCash(lock) {
  if (!lock) return null;
  const n = lock.lockedProfit ?? lock.guaranteedCash;
  return isFinite(Number(n)) ? Number(n) : null;
}

function promoKind(variant) {
  if (variant === "nosweat") return "nosweat";
  if (variant === "freebet") return "freebet";
  return "boost";
}

export function describePromoLock({
  variant = "boost",
  stake,
  winProfit,
  lock,
  promoBookLabel,
  promoOdds,
  promoSelection,
  hedgeBookLabel,
  hedgeOdds,
  hedgeSelection,
  hedgeIsExchange = false,
  hedgeAvailableSize = null,
  hedgeNote = null,
  creditValue = 0,
  refund = null,
  conversionPct = null,
} = {}) {
  if (!lock || lock.valid === false) return null;
  const locked = lockedCash(lock);
  const hedgeStake = Number(lock.hedgeStake);
  if (locked == null || !(hedgeStake > 0)) return null;

  const kind = promoKind(variant);
  const stakeN = Number(stake);
  const winN = Number(winProfit);
  const d_h = Number(lock.d_h);
  const hedgeProfit = isFinite(d_h) && d_h > 1 ? hedgeStake * (d_h - 1) : null;

  const hitsNet = isFinite(winN) ? winN - hedgeStake : locked;
  const losesNet = kind === "freebet"
    ? hedgeProfit
    : kind === "nosweat"
      ? (hedgeProfit != null && isFinite(stakeN) ? hedgeProfit - stakeN + Number(creditValue || 0) : locked)
      : (hedgeProfit != null && isFinite(stakeN) ? hedgeProfit - stakeN : locked);

  const contracts = hedgeIsExchange ? hedgeContractsFromStake(hedgeStake, d_h) : null;
  const contractsText = formatHedgeContracts(contracts);
  const available = formatAvailableDollars(hedgeAvailableSize);

  const hitsDetail = isFinite(winN)
    ? `${money(winN)} win − ${money(hedgeStake)} hedge`
    : null;
  let losesDetail = null;
  if (kind === "freebet" && hedgeProfit != null) {
    losesDetail = `${money(hedgeProfit)} hedge profit (free bet costs $0)`;
  } else if (kind === "nosweat" && hedgeProfit != null && isFinite(stakeN)) {
    losesDetail = `${money(hedgeProfit)} hedge − ${money(stakeN)} stake + ${money(creditValue)} credit`;
  } else if (hedgeProfit != null && isFinite(stakeN)) {
    losesDetail = `${money(hedgeProfit)} hedge − ${money(stakeN)} stake`;
  }

  const promoExtras = [];
  if (kind === "nosweat" && isFinite(Number(creditValue))) {
    const refundN = refund != null ? Number(refund) : null;
    const conv = conversionPct != null ? Number(conversionPct) : null;
    if (isFinite(refundN) && conv != null) {
      promoExtras.push(`Loss refund ${money(refundN)} credit ≈ ${money(creditValue)} cash (${conv}¢ on the dollar)`);
    } else {
      promoExtras.push(`Loss credit counted as ${money(creditValue)} cash`);
    }
  }
  if (kind === "freebet") {
    promoExtras.push("Free bet stake is not returned — win is profit only");
  }

  return {
    kind,
    locked,
    lockedText: money(locked),
    promo: {
      label: kind === "freebet" ? "Free bet" : kind === "nosweat" ? "No-sweat stake" : "Promo stake",
      stakeText: isFinite(stakeN) ? money(stakeN) : null,
      winLabel: kind === "freebet" ? "Free-bet win" : "Promo win",
      winText: isFinite(winN) ? money(winN) : null,
      book: promoBookLabel || null,
      odds: american(promoOdds),
      oddsNote: kind === "nosweat" ? "no-sweat" : kind === "freebet" ? "free bet" : "with boost",
      selection: promoSelection || null,
      extras: promoExtras,
    },
    hedge: {
      stakeText: money(hedgeStake),
      book: hedgeBookLabel || null,
      odds: american(hedgeOdds),
      selection: hedgeSelection || null,
      contracts,
      contractsText: contractsText ? `${contractsText} contracts` : null,
      availableText: available ? `${available} currently available` : null,
      note: hedgeNote || null,
    },
    eitherWay: {
      ifHits: {
        label: kind === "freebet" ? "If free bet hits" : kind === "nosweat" ? "If no-sweat hits" : "If promo hits",
        net: hitsNet,
        netText: signedMoney(hitsNet),
        detail: hitsDetail,
      },
      ifLoses: {
        label: kind === "freebet" ? "If free bet loses" : kind === "nosweat" ? "If no-sweat loses" : "If promo loses",
        net: losesNet,
        netText: signedMoney(losesNet),
        detail: losesDetail,
      },
    },
  };
}
