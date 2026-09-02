import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import ComboLocks, { OWNER_EMAIL } from "./ComboLocks";
import ComboTape from "./ComboTape";
import UnhedgedTape from "./UnhedgedTape";
import { recommendedFillFromFair } from "./comboPrefill";
import { promoLegIdentity, filterExcludedLegs } from "./promoLegExclude";
import { transformOddsData as transformOddsDataForBooks, transformEventOddsData as transformEventOddsDataForBooks } from "./oddsTransform.js";
import {
  loadMatchingBookKeys,
  matchingSetIsFull,
  saveExcludedMatchingBooks,
  toggleMatchingBookKey,
} from "./promoMatchingBooks.js";
import {
  loadModeForTab,
  buildOddsQueryPlan,
  queryOddsCaches,
  shouldFetchFullBoard,
  shouldFetchPromoOdds,
  shouldRunEvScan,
  promoNeedsReload,
  evHeaderValues,
} from "./oddsLoad.js";
import { calcNoSweatEV, calcNoSweatLock, DEFAULT_CREDIT_CONVERSION, DEFAULT_REFUND_PCT } from "./promoNoSweat.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Activity logging helper ──────────────────────────────────────────────
// NOTE: supabase-js v2 query builders are lazy thenables — the HTTP request
// only fires when the builder is awaited/.then()'d. Do not remove the await.
const logEvent = async (user, event, metadata = {}) => {
  if (!user) return;
  const { error } = await supabase.from('activity_log').insert({
    user_id: user.id,
    email: user.email,
    event,
    metadata,
  });
  if (error) console.error('[logEvent] insert failed:', event, error.message);
};

const ALL_BOOKS = [
  { key: "draftkings", label: "DraftKings", color: "#53d769", bg: "rgba(83,215,105,0.15)", logo: "https://www.draftkings.com/favicon.ico" },
  { key: "fanduel", label: "FanDuel", color: "#1493ff", bg: "rgba(20,147,255,0.15)", logo: "https://www.fanduel.com/favicon.ico" },
  { key: "williamhill_us", label: "Caesars", color: "#d4a843", bg: "rgba(212,168,67,0.15)", logo: "https://www.caesars.com/favicon.ico" },
  { key: "betmgm", label: "BetMGM", color: "#c4a962", bg: "rgba(196,169,98,0.15)", logo: "https://sports.betmgm.com/favicon.ico" },
  { key: "betrivers", label: "BetRivers", color: "#4a9eff", bg: "rgba(74,158,255,0.15)", logo: "https://www.betrivers.com/favicon.ico" },
  { key: "fanatics", label: "Fanatics", color: "#ef4444", bg: "rgba(239,68,68,0.15)", logo: "https://sportsbook.fanatics.com/favicon.ico" },
  { key: "hardrockbet", label: "Hard Rock", color: "#d4af37", bg: "rgba(212,175,55,0.15)", logo: "https://app.hardrock.bet/favicon.ico" },
  { key: "espnbet", label: "theScore Bet", color: "#ff6600", bg: "rgba(255,102,0,0.15)", logo: "https://sportsbook.thescore.bet/favicon.ico" },
  { key: "bovada", label: "Bovada", color: "#f97316", bg: "rgba(249,115,22,0.15)", logo: null },
  { key: "mybookieag", label: "MyBookie", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", logo: null },
  { key: "betonlineag", label: "BetOnline", color: "#10b981", bg: "rgba(16,185,129,0.15)", logo: null },
  { key: "lowvig", label: "LowVig", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", logo: null },
  { key: "betus", label: "BetUS", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", logo: null },
  { key: "betanysports", label: "BetAnything", color: "#14b8a6", bg: "rgba(20,184,166,0.15)", logo: null },
  { key: "kalshi", label: "Kalshi", color: "#06b6d4", bg: "rgba(6,182,212,0.15)", logo: "https://kalshi.com/favicon.ico", exchange: true },
  { key: "novig", label: "Novig", color: "#a855f7", bg: "rgba(168,85,247,0.15)", logo: null, exchange: true },
  { key: "prophetx", label: "ProphetX", color: "#f43f5e", bg: "rgba(244,63,94,0.15)", logo: null, exchange: true },
  { key: "polymarket", label: "Polymarket", color: "#5b6ef5", bg: "rgba(91,110,245,0.15)", logo: "https://polymarket.com/favicon.ico", exchange: true },
  { key: "betopenly", label: "BetOpenly", color: "#e879f9", bg: "rgba(232,121,249,0.15)", logo: null, exchange: true },
];

const TRUSTED_BOOK_KEYS = new Set([
  "draftkings", "fanduel", "williamhill_us", "betmgm", "betrivers",
  "fanatics", "hardrockbet", "espnbet", "bovada", "mybookieag", "betonlineag",
  "kalshi", "novig", "prophetx", "polymarket",
]);

const ADJUSTED_BOOK_NOTES = {
  kalshi: "after Kalshi fee",
  prophetx: "after 2% commission",
  polymarket: "after Polymarket taker fee",
};

const SPORTS = [
  { key: "baseball_mlb", label: "MLB" },
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "americanfootball_ncaaf", label: "NCAAF" },
  { key: "basketball_nba", label: "NBA" },
  { key: "basketball_ncaab", label: "NCAAB" },
  { key: "icehockey_nhl", label: "NHL" },
];
const SPORT_KEYS = SPORTS.map(s => s.key);

// Futures / outrights (championship winners). `sport` links each to its parent league
// for badge coloring. These are pulled/stored separately from the game boards.
const FUTURES = [
  { key: "baseball_mlb_world_series_winner", label: "World Series", sport: "baseball_mlb" },
  { key: "americanfootball_nfl_super_bowl_winner", label: "Super Bowl", sport: "americanfootball_nfl" },
  { key: "americanfootball_ncaaf_championship_winner", label: "CFP Champion", sport: "americanfootball_ncaaf" },
  { key: "basketball_nba_championship_winner", label: "NBA Finals", sport: "basketball_nba" },
  { key: "basketball_ncaab_championship_winner", label: "NCAAB Champion", sport: "basketball_ncaab" },
  { key: "icehockey_nhl_championship_winner", label: "Stanley Cup", sport: "icehockey_nhl" },
];
const FUTURES_KEYS = FUTURES.map(f => f.key);

const DATE_RANGES = [
  { val: "today", label: "Today" },
  { val: "24h", label: "Next 24h" },
  { val: "7d", label: "7 Days" },
  { val: "any", label: "Any" },
];

// Promo Builder first-load fallback. Sports/date are not persisted;
// +EV and Odds Board keep their own state.
const DEFAULT_PROMO_SPORT_KEYS = ["baseball_mlb", "americanfootball_ncaaf"];
const DEFAULT_PROMO_DATE_RANGE = "7d";

const MARKET_SCOPES = [
  { val: "all", label: "All" },
  { val: "main", label: "Main" },
  { val: "alt", label: "Alt" },
];

function formatPromoFilterSummary({ promoSports, promoDateRange, marketScope, promoType, minFinalOdds, minLegOdds, numLegs }) {
  const selected = SPORTS.filter(s => promoSports.has(s.key)).map(s => s.label);
  const sportsPart = selected.length === SPORTS.length ? "All sports" : selected.join(", ");
  const datePart = DATE_RANGES.find(d => d.val === promoDateRange)?.label || promoDateRange;
  const marketPart = marketScope === "main" ? "mains" : marketScope === "alt" ? "alts" : "all";
  const parts = [sportsPart, datePart, marketPart];
  if ((promoType === "boost" || promoType === "nosweat") && minFinalOdds !== "") parts.push(`min ${minFinalOdds}`);
  if ((promoType === "boost" || promoType === "nosweat") && numLegs >= 2 && minLegOdds !== "") parts.push(`legs ${minLegOdds}`);
  return parts.join(" · ");
}

const PROMO_TYPES = [
  { val: "boost", label: "Profit Boost" },
  { val: "freebet", label: "Free Bet" },
  { val: "nosweat", label: "No Sweat" },
];

// Profit-boost picker cap. 4+ legs grow greedily from top 3-leg parlays
// (no C(n,k) explosion). 8 covers typical boost promos without a new toolbar.
const MAX_PROMO_LEGS = 8;
// How many top 3-leg seeds to grow from. Extra work is ~seeds × leftover
// candidates per added leg — similar budget to today's 3-leg scan.
const GROW_FROM_3_SEEDS = 50;

function isWithinDateRange(commence_time, range) {
  const now = new Date();
  const ct = new Date(commence_time);
  if (range === "any") return true;
  if (range === "today") {
    const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const estCt = new Date(ct.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return estCt.toDateString() === estNow.toDateString();
  }
  if (range === "24h") return ct <= new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (range === "7d") return ct <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return true;
}








function BookBadge({ bookKey }) {
  const book = ALL_BOOKS.find(b => b.key === bookKey);
  if (!book) return null;
  const [logoError, setLogoError] = useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, color: book.color, background: book.bg, whiteSpace: "nowrap" }}>
      {book.logo && !logoError && (
        <img src={book.logo} alt="" width={12} height={12} style={{ borderRadius: 2 }} onError={() => setLogoError(true)} />
      )}
      {book.label}
    </span>
  );
}

function GuaranteedBadge({ leg, stake, boostedProfit, lock, bookLabel, variant = "boost", creditValue = 0, conversionPct = DEFAULT_CREDIT_CONVERSION }) {
  const [open, setOpen] = useState(false);
  if (!lock || !lock.valid) return null;

  const hedgeBookLabel = ALL_BOOKS.find(x => x.key === leg.bestOppBook)?.label || leg.bestOppBook;
  const adjustmentNote = ADJUSTED_BOOK_NOTES[leg.bestOppBook] || null;
  const isNoSweat = variant === "nosweat";

  // boosted price expressed as American odds
  const boostedAm = isNoSweat ? leg.dk : decimalToAmerican(1 + boostedProfit / stake);

  const hedgeProfit = lock.hedgeStake * (lock.d_h - 1);
  const winSide = boostedProfit - lock.hedgeStake;   // promo bet wins, hedge loses
  const loseSide = isNoSweat ? hedgeProfit - stake + creditValue : hedgeProfit - stake;

  const cols = "2.2fr 0.9fr 0.85fr 0.9fr 1.35fr";
  const cell = { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right" };

  const row = (betName, bookName, odds, risk, profit, otherStake, net, isBoost) => (
    <div style={{ display: "grid", gridTemplateColumns: cols, padding: "12px 14px", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{betName}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
          {bookName}
          {!isBoost && adjustmentNote && <span style={{ color: "#06b6d4" }}> ({adjustmentNote})</span>}
        </div>
      </div>
      <div style={{ ...cell, fontWeight: 700, color: isBoost ? "#8b5cf6" : "#e8eaed" }}>
        {formatOdds(odds)}
        {isBoost && (
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, color: "#8b5cf6", opacity: 0.8, marginTop: 2 }}>{isNoSweat ? "(no-sweat)" : "(with boost)"}</div>
        )}
      </div>
      <div style={{ ...cell, color: "#9ca3af" }}>${risk.toFixed(2)}</div>
      <div style={{ ...cell, color: "#9ca3af" }}>${profit.toFixed(2)}</div>
      <div style={{ ...cell }}>
        <div style={{ fontWeight: 700, color: "#10b981", fontSize: 14 }}>+${net.toFixed(2)}</div>
        <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{isNoSweat && !isBoost ? `$${profit.toFixed(2)} − $${otherStake.toFixed(2)} + $${creditValue.toFixed(2)} credit` : `$${profit.toFixed(2)} − $${otherStake.toFixed(2)}`}</div>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <button
          onClick={e => { e.stopPropagation(); setOpen(!open); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", background: open ? "rgba(139,92,246,0.22)" : "rgba(139,92,246,0.14)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.45)", cursor: "pointer", transition: "all 0.15s", boxShadow: open ? "none" : "0 0 0 0 rgba(139,92,246,0.4)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,0.3)"; e.currentTarget.style.color = "#c4b5fd"; }}
          onMouseLeave={e => { e.currentTarget.style.background = open ? "rgba(139,92,246,0.22)" : "rgba(139,92,246,0.14)"; e.currentTarget.style.color = "#a78bfa"; }}
        >
          <span>🔒</span>
          <span>
            {open
              ? `Guaranteed Profit — locking $${lock.lockedProfit.toFixed(2)}`
              : `Guaranteed Profit — click to see how to lock in $${lock.lockedProfit.toFixed(2)}`}
          </span>
          <span style={{ fontSize: 10, opacity: 0.9 }}>{open ? "▲" : "▼"}</span>
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12, background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "16px" }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>
            Place both bets now. Either side wins → you keep <strong style={{ color: "#10b981" }}>${lock.lockedProfit.toFixed(2)}</strong>.
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, padding: "8px 14px", fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <div>Bet</div>
              <div style={{ textAlign: "right" }}>Odds</div>
              <div style={{ textAlign: "right" }}>Risk</div>
              <div style={{ textAlign: "right" }}>To Profit</div>
              <div style={{ textAlign: "right" }}>If it wins</div>
            </div>
            {row(leg.name, bookLabel, boostedAm, stake, boostedProfit, lock.hedgeStake, winSide, true)}
            {row(leg.bestOppName, hedgeBookLabel, leg.bestOpp, lock.hedgeStake, hedgeProfit, stake, loseSide, false)}
          </div>

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#4b5563", marginTop: 8 }}>
            {isNoSweat
              ? `Hedge stake = ($${boostedProfit.toFixed(2)} + $${stake.toFixed(2)} − $${creditValue.toFixed(2)}) ÷ ${lock.d_h.toFixed(3)} = $${lock.hedgeStake.toFixed(2)} · lose side includes site credit at ${conversionPct}¢ on the dollar`
              : `Hedge stake = ($${boostedProfit.toFixed(2)} + $${stake.toFixed(2)}) ÷ ${lock.d_h.toFixed(3)} = $${lock.hedgeStake.toFixed(2)} · locks ${((lock.lockedProfit / stake) * 100).toFixed(1)}% of stake`}
          </div>

          {isNoSweat ? (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(16,185,129,0.04)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.15)", fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
              Site credit is counted as {conversionPct}% cash — we use ${creditValue.toFixed(0)} of cash value, not the raw lost stake.
            </div>
          ) : (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(245,158,11,0.06)", borderRadius: 8, border: "1px solid rgba(245,158,11,0.2)", fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
              <strong style={{ color: "#f59e0b" }}>⚠</strong> Long-run, taking the boost unhedged is correct — hedge only if you want certainty.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function transformOddsData(gamesArray, sportKey, trustedBookKeys = TRUSTED_BOOK_KEYS) {
  return transformOddsDataForBooks(gamesArray, sportKey, trustedBookKeys, ALL_BOOKS);
}

function transformEventOddsData(game, sportKey, trustedBookKeys = TRUSTED_BOOK_KEYS) {
  return transformEventOddsDataForBooks(game, sportKey, trustedBookKeys, ALL_BOOKS);
}

function mergeOddsData(allData) {
  return {
    moneylines: allData.flatMap(d => d.moneylines || []),
    run_lines: allData.flatMap(d => d.run_lines || []),
    totals: allData.flatMap(d => d.totals || []),
    team_totals: allData.flatMap(d => d.team_totals || []),
  };
}

function formatET(commence_time) {
  if (!commence_time) return "";
  return new Date(commence_time).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' ET';
}

function formatDateGroup(commence_time) {
  return new Date(commence_time).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function trueProb(bestOpponentOdds) {
  if (!bestOpponentOdds) return 0.5;
  if (bestOpponentOdds < 0) return Math.abs(bestOpponentOdds) / (Math.abs(bestOpponentOdds) + 100);
  return 100 / (bestOpponentOdds + 100);
}

function ourTrueProb(bestOpponentOdds) { return 1 - trueProb(bestOpponentOdds); }

function impliedProb(odds) {
  if (!odds) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function dkDecimal(odds) {
  if (!odds) return 1;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

function formatOdds(odds) {
  if (!odds) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Compact dollar formatter for exchange top-of-book size ($595, $2.0k, $1.2M).
function fmtSize(v) {
  if (v == null || !isFinite(v)) return null;
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

// Whole days between now and a game's start (floored). Used to flag far-off promo bets.
function daysAway(commence_time) {
  const diff = new Date(commence_time).getTime() - Date.now();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

// Red inline flag appended after a promo bet's date when its game is >= 3 days out.
function DaysAwayWarning({ commence_time }) {
  const d = daysAway(commence_time);
  if (d < 3) return null;
  return <span style={{ color: "#ef4444", fontWeight: 700 }}> — {d} {d === 1 ? "day" : "days"} away</span>;
}

// ET start line on promo chips and expanded LEG cells — same format for every N.
function PromoLegStartTime({ commence_time }) {
  return (
    <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>
      {formatET(commence_time)}
      <DaysAwayWarning commence_time={commence_time} />
    </div>
  );
}

// Decimal -> American. Must branch at 2.0: below it the price is a favorite (negative).
// (dec-1)*100 alone silently prints favorites as plus-money, e.g. 1.87 -> "+87" not "-115".
function decimalToAmerican(dec) {
  if (!isFinite(dec) || dec <= 1) return 0;
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

function probToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function calcEV(bookOdds, bestOpponentOdds) {
  const prob = ourTrueProb(bestOpponentOdds);
  const dec = dkDecimal(bookOdds);
  const profit = (dec - 1) * 100;
  const ev = (prob * profit) - ((1 - prob) * 100);
  return { prob, ev, profit };
}

function calcParlayEV(legs, boostPct, stake) {
  let parlayDec = 1;
  let combinedProb = 1;
  legs.forEach(l => {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  });
  const boostedProfit = (parlayDec - 1) * stake * (1 + boostPct / 100);
  const ev = (combinedProb * boostedProfit) - ((1 - combinedProb) * stake);
  return { parlayDec, combinedProb, boostedProfit, ev, parlayOdds: decimalToAmerican(parlayDec) };
}

function calcNoSweatFromLegs(legs, stake, refundPct, conversionPct) {
  let parlayDec = 1;
  let combinedProb = 1;
  legs.forEach(l => {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  });
  const ns = calcNoSweatEV({ stake, decimal: parlayDec, p: combinedProb, refundPct, conversionPct });
  return { parlayDec, combinedProb, parlayOdds: decimalToAmerican(parlayDec), ...ns };
}

// Single-leg boost lock: hedge the opposite side so BOTH outcomes return the same cash.
// Equalizing stake H solves  boostedProfit - H  =  -stake + H*(d_h - 1)  =>  H = (boostedProfit + stake)/d_h
// NOTE: only valid for 1-leg boosts. With n legs there are n hedge stakes but 2^n outcomes,
// which cannot all be equalized simultaneously — no true simultaneous lock exists.
function calcBoostLock(bestOppAmerican, stake, boostedProfit) {
  if (!bestOppAmerican || !stake || !boostedProfit) return { valid: false, hedgeStake: 0, lockedProfit: 0 };
  const d_h = dkDecimal(bestOppAmerican);
  if (d_h <= 1) return { valid: false, hedgeStake: 0, lockedProfit: 0 };
  const hedgeStake = (boostedProfit + stake) / d_h;
  const lockedProfit = boostedProfit - hedgeStake;
  return { valid: lockedProfit > 0, hedgeStake, lockedProfit, d_h };
}

function calcFreeBetConversion(fbOddsAmerican, hedgeOddsAmerican, freeBetAmount) {
  if (!fbOddsAmerican || !hedgeOddsAmerican || !freeBetAmount) return { hedgeStake: 0, guaranteedCash: 0, conversionRate: 0, valid: false };
  const d_fb = dkDecimal(fbOddsAmerican);
  const d_h = dkDecimal(hedgeOddsAmerican);
  if (d_fb <= 1 || d_h <= 1) return { hedgeStake: 0, guaranteedCash: 0, conversionRate: 0, valid: false };
  const hedgeStake = (d_fb - 1) * freeBetAmount / d_h;
  const guaranteedCash = hedgeStake * (d_h - 1);
  const conversionRate = guaranteedCash / freeBetAmount;
  return { hedgeStake, guaranteedCash, conversionRate, valid: true, d_fb, d_h };
}

// Resolve the opposing odds used to derive a leg's true win probability.
// If a TRUSTED book posts the opposite side, use the best such price (unchanged).
// Otherwise fall back to the SAME book's opposite-side price rather than the old
// silent 0.5 default (which produced phantom "-100 fair odds" +EV on games only an
// untrusted book like MyBookie offers). Legs are only built when both sides exist on
// the book, so a same-book opposite is always available. A single book's other side
// carries its vig, so the derived edge is conservative (understated), never fabricated.
function resolveOpp({ trustedOpp, trustedBook, trustedCount, sameBookOpp, sameBookKey }) {
  if (trustedOpp != null) return { bestOpp: trustedOpp, bestOppBook: trustedBook, bestOppCount: trustedCount, sameBookFallback: false };
  if (sameBookOpp != null) return { bestOpp: sameBookOpp, bestOppBook: sameBookKey, bestOppCount: 1, sameBookFallback: true };
  return { bestOpp: null, bestOppBook: trustedBook || null, bestOppCount: trustedCount || 0, sameBookFallback: false };
}

function buildAllLegsForBook(data, book, sportFilter = null, minLegOdds = null, dateRange = "any") {
  const legs = [];
  const now = new Date();

  if (data.moneylines) {
    data.moneylines.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.is_three_way) return;
      const awayOdds = g.bookOdds?.[book]?.ml_away;
      const homeOdds = g.bookOdds?.[book]?.ml_home;
      if (awayOdds == null || homeOdds == null) return;
      if (minLegOdds === null || awayOdds >= minLegOdds)
        legs.push({ name: `${g.away} ML`, dk: awayOdds, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: `${g.home} ML`, ...resolveOpp({ trustedOpp: g.best_home, trustedBook: g.best_home_book, trustedCount: g.ml_opp_count_away, sameBookOpp: homeOdds, sameBookKey: book }) });
      if (minLegOdds === null || homeOdds >= minLegOdds)
        legs.push({ name: `${g.home} ML`, dk: homeOdds, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: `${g.away} ML`, ...resolveOpp({ trustedOpp: g.best_away, trustedBook: g.best_away_book, trustedCount: g.ml_opp_count_home, sameBookOpp: awayOdds, sameBookKey: book }) });
    });
  }

  if (data.run_lines) {
    const seen = new Set();
    data.run_lines.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.book !== book) return;
      const awayOdds = g.away_odds;
      const homeOdds = g.home_odds;
      if (awayOdds == null || homeOdds == null) return;
      const ak = `${g.away}@${g.home}_away_${g.away_line}`;
      const hk = `${g.away}@${g.home}_home_${g.home_line}`;
      if (!seen.has(ak) && (minLegOdds === null || awayOdds >= minLegOdds)) { seen.add(ak); legs.push({ name: `${g.away} ${g.away_line}`, dk: awayOdds, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_away, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_away, trustedBook: g.bestOpp_away_book, trustedCount: g.bestOppCount_away, sameBookOpp: homeOdds, sameBookKey: book }) }); }
      if (!seen.has(hk) && (minLegOdds === null || homeOdds >= minLegOdds)) { seen.add(hk); legs.push({ name: `${g.home} ${g.home_line}`, dk: homeOdds, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_home, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_home, trustedBook: g.bestOpp_home_book, trustedCount: g.bestOppCount_home, sameBookOpp: awayOdds, sameBookKey: book }) }); }
    });
  }

  if (data.totals) {
    const seen = new Set();
    data.totals.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.book !== book) return;
      const overOdds = g.over_odds;
      const underOdds = g.under_odds;
      if (overOdds == null || underOdds == null) return;
      const ok = `${g.away}@${g.home}_over_${g.line}`;
      const uk = `${g.away}@${g.home}_under_${g.line}`;
      if (!seen.has(ok) && (minLegOdds === null || overOdds >= minLegOdds)) { seen.add(ok); legs.push({ name: `${g.away}/${g.home} o${g.line}`, dk: overOdds, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, sameBookOpp: underOdds, sameBookKey: book }) }); }
      if (!seen.has(uk) && (minLegOdds === null || underOdds >= minLegOdds)) { seen.add(uk); legs.push({ name: `${g.away}/${g.home} u${g.line}`, dk: underOdds, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, sameBookOpp: overOdds, sameBookKey: book }) }); }
    });
  }

  if (data.team_totals) {
    const seen = new Set();
    data.team_totals.forEach(g => {
      if (new Date(g.commence_time) <= now) return;
      if (!isWithinDateRange(g.commence_time, dateRange)) return;
      if (sportFilter && !sportFilter.includes(g.sport)) return;
      if (g.book !== book) return;
      const overOdds = g.over_odds;
      const underOdds = g.under_odds;
      if (overOdds == null || underOdds == null) return;
      const ok = `${g.away}@${g.home}_TT_${g.team}_o_${g.line}`;
      const uk = `${g.away}@${g.home}_TT_${g.team}_u_${g.line}`;
      if (!seen.has(ok) && (minLegOdds === null || overOdds >= minLegOdds)) { seen.add(ok); legs.push({ name: `${g.team} TT o${g.line}`, dk: overOdds, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, sameBookOpp: underOdds, sameBookKey: book }) }); }
      if (!seen.has(uk) && (minLegOdds === null || underOdds >= minLegOdds)) { seen.add(uk); legs.push({ name: `${g.team} TT u${g.line}`, dk: underOdds, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, sameBookOpp: overOdds, sameBookKey: book }) }); }
    });
  }

  return legs;
}

function buildAllLegsAllBooks(data, sportFilter = null, dateRange = "any") {
  const now = new Date();
  const seen = new Set();
  const legs = [];

  ALL_BOOKS.forEach(book => {
    if (data.moneylines) {
      data.moneylines.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (!isWithinDateRange(g.commence_time, dateRange)) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        if (g.is_three_way) return;
        const awayOdds = g.bookOdds?.[book.key]?.ml_away;
        const homeOdds = g.bookOdds?.[book.key]?.ml_home;
        if (awayOdds == null || homeOdds == null) return;
        const ak = `${g.away}@${g.home}_ML_away_${book.key}`;
        const hk = `${g.away}@${g.home}_ML_home_${book.key}`;
        if (!seen.has(ak)) { seen.add(ak); legs.push({ name: `${g.away} ML`, dk: awayOdds, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: `${g.home} ML`, ...resolveOpp({ trustedOpp: g.best_home, trustedBook: g.best_home_book, trustedCount: g.ml_opp_count_away, sameBookOpp: homeOdds, sameBookKey: book.key }) }); }
        if (!seen.has(hk)) { seen.add(hk); legs.push({ name: `${g.home} ML`, dk: homeOdds, market: "ML", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: `${g.away} ML`, ...resolveOpp({ trustedOpp: g.best_away, trustedBook: g.best_away_book, trustedCount: g.ml_opp_count_home, sameBookOpp: awayOdds, sameBookKey: book.key }) }); }
      });
    }
    if (data.run_lines) {
      data.run_lines.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (!isWithinDateRange(g.commence_time, dateRange)) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        if (g.book !== book.key) return;
        const awayOdds = g.away_odds;
        const homeOdds = g.home_odds;
        if (awayOdds == null || homeOdds == null) return;
        const ak = `${g.away}@${g.home}_SPR_away_${g.away_line}_${book.key}`;
        const hk = `${g.away}@${g.home}_SPR_home_${g.home_line}_${book.key}`;
        if (!seen.has(ak)) { seen.add(ak); legs.push({ name: `${g.away} ${g.away_line}`, dk: awayOdds, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: g.bestOppName_away, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_away, trustedBook: g.bestOpp_away_book, trustedCount: g.bestOppCount_away, sameBookOpp: homeOdds, sameBookKey: book.key }) }); }
        if (!seen.has(hk)) { seen.add(hk); legs.push({ name: `${g.home} ${g.home_line}`, dk: homeOdds, market: "SPR", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: g.bestOppName_home, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_home, trustedBook: g.bestOpp_home_book, trustedCount: g.bestOppCount_home, sameBookOpp: awayOdds, sameBookKey: book.key }) }); }
      });
    }
    if (data.totals) {
      data.totals.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (!isWithinDateRange(g.commence_time, dateRange)) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        if (g.book !== book.key) return;
        const overOdds = g.over_odds;
        const underOdds = g.under_odds;
        if (overOdds == null || underOdds == null) return;
        const ok = `${g.away}@${g.home}_TOT_over_${g.line}_${book.key}`;
        const uk = `${g.away}@${g.home}_TOT_under_${g.line}_${book.key}`;
        if (!seen.has(ok)) { seen.add(ok); legs.push({ name: `${g.away}/${g.home} o${g.line}`, dk: overOdds, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, sameBookOpp: underOdds, sameBookKey: book.key }) }); }
        if (!seen.has(uk)) { seen.add(uk); legs.push({ name: `${g.away}/${g.home} u${g.line}`, dk: underOdds, market: "TOT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, sameBookOpp: overOdds, sameBookKey: book.key }) }); }
      });
    }
    if (data.team_totals) {
      data.team_totals.forEach(g => {
        if (new Date(g.commence_time) <= now) return;
        if (!isWithinDateRange(g.commence_time, dateRange)) return;
        if (sportFilter && !sportFilter.includes(g.sport)) return;
        if (g.book !== book.key) return;
        const overOdds = g.over_odds;
        const underOdds = g.under_odds;
        if (overOdds == null || underOdds == null) return;
        const ok = `${g.away}@${g.home}_TT_${g.team}_o_${g.line}_${book.key}`;
        const uk = `${g.away}@${g.home}_TT_${g.team}_u_${g.line}_${book.key}`;
        if (!seen.has(ok)) { seen.add(ok); legs.push({ name: `${g.team} TT o${g.line}`, dk: overOdds, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: g.bestOppName_over, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_over, trustedBook: g.bestOpp_over_book, trustedCount: g.bestOppCount_over, sameBookOpp: underOdds, sameBookKey: book.key }) }); }
        if (!seen.has(uk)) { seen.add(uk); legs.push({ name: `${g.team} TT u${g.line}`, dk: underOdds, market: "TT", game: `${g.away} @ ${g.home}`, commence_time: g.commence_time, sport: g.sport, bookKey: book.key, bestOppName: g.bestOppName_under, isAlt: !!g.is_alt, ...resolveOpp({ trustedOpp: g.bestOpp_under, trustedBook: g.bestOpp_under_book, trustedCount: g.bestOppCount_under, sameBookOpp: overOdds, sameBookKey: book.key }) }); }
      });
    }
  });

  return legs;
}

function parlayLegKey(p) {
  return p.legs.map(l => `${l.game}\0${l.name}`).sort().join("\n");
}

// 4+ legs: take top 3-leg parlays, then greedily add one unused-game leg at a
// time ranked by calcParlayEV. Same book/filters as the caller already applied
// to `legs`. minFinalOdds is applied to the finished N-leg, not the 3-leg seed
// (a short 3-leg can still grow into a long enough parlay).
function growParlaysFromTop3(legs, numLegs, boostPct, stake, maxResults, minFinalOdds, evCalc) {
  const calc = evCalc || ((ls) => calcParlayEV(ls, boostPct, stake));
  const seedCount = Math.max(maxResults, GROW_FROM_3_SEEDS);
  const seeds = findTopParlays(legs, 3, boostPct, stake, seedCount, null, evCalc);
  const seen = new Set();
  const grown = [];
  for (const seed of seeds) {
    let current = seed;
    let failed = false;
    for (let n = current.legs.length; n < numLegs; n++) {
      const usedGames = new Set(current.legs.map(l => l.game));
      let best = null;
      for (const cand of legs) {
        if (usedGames.has(cand.game)) continue;
        // Concat the original candidate — do not slim it (commence_time must survive).
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

function findTopParlays(legs, numLegs, boostPct, stake, maxResults = 10, minFinalOdds = null, evCalc = null) {
  const calc = evCalc || ((ls) => calcParlayEV(ls, boostPct, stake));
  if (numLegs > 3 && numLegs <= MAX_PROMO_LEGS) {
    return growParlaysFromTop3(legs, numLegs, boostPct, stake, maxResults, minFinalOdds, evCalc);
  }

  const results = [];
  const getGame = (leg) => leg.game;

  if (numLegs === 1) {
    legs.forEach(l => {
      const r = calc([l]);
      if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) return;
      results.push({ legs: [l], ...r });
    });
  } else if (numLegs === 2) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (getGame(legs[i]) === getGame(legs[j])) continue;
        const r = calc([legs[i], legs[j]]);
        if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) continue;
        results.push({ legs: [legs[i], legs[j]], ...r });
      }
    }
  } else if (numLegs === 3) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (getGame(legs[i]) === getGame(legs[j])) continue;
        for (let k = j + 1; k < legs.length; k++) {
          if (getGame(legs[k]) === getGame(legs[i]) || getGame(legs[k]) === getGame(legs[j])) continue;
          const r = calc([legs[i], legs[j], legs[k]]);
          if (minFinalOdds !== null && r.parlayOdds < minFinalOdds) continue;
          results.push({ legs: [legs[i], legs[j], legs[k]], ...r });
        }
      }
    }
  }

  results.sort((a, b) => b.ev - a.ev);
  return results.slice(0, maxResults);
}

function findTopFreeBetConversions(legs, freeBetAmount, maxResults = 10) {
  const results = [];
  legs.forEach(l => {
    if (l.bestOpp == null) return;
    const conv = calcFreeBetConversion(l.dk, l.bestOpp, freeBetAmount);
    if (!conv.valid || conv.conversionRate <= 0) return;
    results.push({
      leg: l,
      hedgeStake: conv.hedgeStake,
      guaranteedCash: conv.guaranteedCash,
      conversionRate: conv.conversionRate,
      hedgeOddsAmerican: l.bestOpp,
      hedgeBookKey: l.bestOppBook,
      hedgeName: l.bestOppName,
    });
  });
  results.sort((a, b) => b.conversionRate - a.conversionRate);
  return results.slice(0, maxResults);
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "#8a8f98", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function EVBadge({ ev }) {
  const color = ev > 10 ? "#10b981" : ev > 5 ? "#f59e0b" : ev > 0 ? "#6b7280" : "#ef4444";
  const bg = ev > 10 ? "rgba(16,185,129,0.12)" : ev > 5 ? "rgba(245,158,11,0.12)" : ev > 0 ? "rgba(107,114,128,0.12)" : "rgba(239,68,68,0.12)";
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color, background: bg }}>
      {ev > 0 ? "+" : ""}{ev.toFixed(1)}%
    </span>
  );
}

function SportBadge({ sport }) {
  const s = SPORTS.find(x => x.key === sport);
  const colors = { baseball_mlb: "#3b82f6", americanfootball_nfl: "#8b5cf6", americanfootball_ncaaf: "#a78bfa", basketball_nba: "#f97316", basketball_ncaab: "#fb923c", icehockey_nhl: "#06b6d4" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: colors[sport] || "#6b7280", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 4 }}>
      {s?.label || sport}
    </span>
  );
}

function transformFuturesData(dataArray, futuresKey) {
  // The Odds API outrights payload: array of events (usually one) → bookmakers →
  // markets → outcomes[{name: team, price}]. `outrights` is the back/Yes side (win the
  // title); `outrights_lay` is the exchange against/No side (will NOT win). Collapse to
  // one row per team: `books` = Yes price by book, `noBooks` = No price by book.
  // Best-across-books is computed in the component (depends on selected books).
  const teams = {};
  const ensure = (name) => (teams[name] || (teams[name] = { name, books: {}, noBooks: {}, bookSizes: {}, noBookSizes: {} }));
  (Array.isArray(dataArray) ? dataArray : []).forEach(event => {
    (event.bookmakers || []).forEach(bm => {
      (bm.markets || []).forEach(mkt => {
        const bucket = mkt.key === "outrights" ? "books" : mkt.key === "outrights_lay" ? "noBooks" : null;
        if (!bucket) return;
        const sizeBucket = bucket === "books" ? "bookSizes" : "noBookSizes";
        (mkt.outcomes || []).forEach(o => {
          if (o.price == null || !o.name) return;
          const t = ensure(o.name);
          const cur = t[bucket][bm.key];
          if (cur == null || o.price > cur) {
            t[bucket][bm.key] = o.price;
            if (o.size != null) t[sizeBucket][bm.key] = o.size;
          }
        });
      });
    });
  });
  return { key: futuresKey, teams: Object.values(teams) };
}

function OddsBoard({ oddsData, futuresData }) {
  const [market, setMarket] = useState("ml");
  const [search, setSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(new Set(ALL_BOOKS.map(b => b.key)));
  const [boardSport, setBoardSport] = useState("baseball_mlb");
  const now = new Date();

  const games = (oddsData.moneylines || []).filter(g =>
    g.sport === boardSport && new Date(g.commence_time) > now
  );

  const filteredGames = games.filter(g => {
    const q = search.toLowerCase();
    return g.away.toLowerCase().includes(q) || g.home.toLowerCase().includes(q);
  });

  const grouped = {};
  filteredGames.forEach(g => {
    const dateKey = formatDateGroup(g.commence_time);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(g);
  });

  const toggleBook = (bookKey) => {
    setSelectedBooks(prev => {
      const next = new Set(prev);
      if (next.has(bookKey)) { if (next.size === 1) return prev; next.delete(bookKey); }
      else next.add(bookKey);
      return next;
    });
  };

  const getCell = (game, bookKey) => {
    if (bookKey === "best") {
      const vals = ALL_BOOKS.filter(b => selectedBooks.has(b.key));
      if (market === "ml") {
        const bestAway = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.ml_away).filter(v => v != null));
        const bestHome = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.ml_home).filter(v => v != null));
        return { top: isFinite(bestAway) ? bestAway : null, bot: isFinite(bestHome) ? bestHome : null, topLine: null, botLine: null };
      }
      if (market === "spr") {
        const bestAway = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.spr_away).filter(v => v != null));
        const bestHome = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.spr_home).filter(v => v != null));
        const dkb = game.bookOdds?.draftkings;
        return { top: isFinite(bestAway) ? bestAway : null, bot: isFinite(bestHome) ? bestHome : null, topLine: dkb?.spr_away_line != null ? (dkb.spr_away_line > 0 ? `+${dkb.spr_away_line}` : `${dkb.spr_away_line}`) : null, botLine: dkb?.spr_home_line != null ? (dkb.spr_home_line > 0 ? `+${dkb.spr_home_line}` : `${dkb.spr_home_line}`) : null };
      }
      if (market === "tot") {
        const bestOver = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.tot_over).filter(v => v != null));
        const bestUnder = Math.max(...vals.map(b => game.bookOdds?.[b.key]?.tot_under).filter(v => v != null));
        const dkb = game.bookOdds?.draftkings;
        return { top: isFinite(bestOver) ? bestOver : null, bot: isFinite(bestUnder) ? bestUnder : null, topLine: dkb?.tot_line ? `o${dkb.tot_line}` : null, botLine: dkb?.tot_line ? `u${dkb.tot_line}` : null };
      }
    }
    const b = game.bookOdds?.[bookKey];
    if (!b) return { top: null, bot: null, topLine: null, botLine: null };
    if (market === "ml") return { top: b.ml_away, bot: b.ml_home, topLine: null, botLine: null };
    if (market === "spr") return { top: b.spr_away, bot: b.spr_home, topLine: b.spr_away_line != null ? (b.spr_away_line > 0 ? `+${b.spr_away_line}` : `${b.spr_away_line}`) : null, botLine: b.spr_home_line != null ? (b.spr_home_line > 0 ? `+${b.spr_home_line}` : `${b.spr_home_line}`) : null };
    if (market === "tot") return { top: b.tot_over, bot: b.tot_under, topLine: b.tot_line ? `o${b.tot_line}` : null, botLine: b.tot_line ? `u${b.tot_line}` : null };
    return { top: null, bot: null, topLine: null, botLine: null };
  };

  const getBestForGame = (game) => {
    let bestAway = null, bestHome = null;
    ALL_BOOKS.forEach(b => {
      if (!selectedBooks.has(b.key)) return;
      const cell = getCell(game, b.key);
      if (cell.top !== null && (bestAway === null || cell.top > bestAway)) bestAway = cell.top;
      if (cell.bot !== null && (bestHome === null || cell.bot > bestHome)) bestHome = cell.bot;
    });
    return { bestAway, bestHome };
  };

  const visibleBooks = [{ key: "best", label: "Best Odds" }, ...ALL_BOOKS.filter(b => selectedBooks.has(b.key))];
  const teamColWidth = 170;
  const oddsColWidth = 88;

  // Championship (futures) view — one price per team, best across selected books.
  const champMeta = FUTURES.find(f => f.sport === boardSport);
  const champEntry = (futuresData || []).find(f => f.key === champMeta?.key);
  const champBooks = [{ key: "best", label: "Best Odds" }, ...ALL_BOOKS.filter(b => selectedBooks.has(b.key))];
  const champBestOf = (priceMap) => {
    let best = null, bestBook = null;
    ALL_BOOKS.forEach(b => {
      if (!selectedBooks.has(b.key)) return;
      const p = priceMap?.[b.key];
      if (p != null && (best === null || p > best)) { best = p; bestBook = b.key; }
    });
    return { best, bestBook };
  };
  const champTeams = (champEntry?.teams || [])
    .filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    .map(t => {
      const yes = champBestOf(t.books);
      const no = champBestOf(t.noBooks);
      return { ...t, best: yes.best, bestBook: yes.bestBook, noBest: no.best, noBestBook: no.bestBook, hasNo: no.best !== null };
    })
    .filter(t => t.best !== null || t.hasNo)
    .sort((a, b) => impliedProb(b.best) - impliedProb(a.best));

  // Render one odds row (Yes or No lay side) for a championship team.
  const champRow = (key, name, isNo, priceMap, rowBest, hideNameBorder, sizeMap) => (
    <tr key={key} style={{ background: isNo ? "rgba(239,68,68,0.05)" : "transparent" }}>
      <td style={{ padding: "10px 16px", width: teamColWidth, position: "sticky", left: 0, background: isNo ? "#0f0a0b" : "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)", borderBottom: hideNameBorder ? "none" : "1px solid rgba(255,255,255,0.03)", fontSize: 13, fontWeight: 600, color: isNo ? "#9ca3af" : "#e8eaed" }}>
        {name}{isNo && <span style={{ color: "#ef4444", fontWeight: 700, marginLeft: 8, fontSize: 11 }}>NO</span>}
      </td>
      {champBooks.map(b => {
        const price = b.key === "best" ? rowBest : priceMap?.[b.key];
        const size = b.key === "best" ? null : sizeMap?.[b.key];
        const isBestCol = b.key === "best";
        const isBestCell = b.key !== "best" && price != null && price === rowBest;
        return (
          <td key={b.key} style={{ padding: "10px 6px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.03)", color: price == null ? "#2d3748" : (isBestCol || isBestCell) ? "#10b981" : "#e8eaed", background: isBestCell ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
            {price == null ? "—" : formatOdds(price)}
            {size != null && <div style={{ fontSize: 9, color: "#6b7280", fontWeight: 500, marginTop: 1 }}>{fmtSize(size)}</div>}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {SPORTS.map(s => (
          <button key={s.key} onClick={() => setBoardSport(s.key)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: boardSport === s.key ? "#3b82f6" : "rgba(255,255,255,0.05)", color: boardSport === s.key ? "#fff" : "#6b7280" }}>
            {s.label}
          </button>
        ))}
      </div>
      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search team or matchup..." style={{ width: "100%", maxWidth: 400, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8eaed", padding: "10px 16px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", marginBottom: 16, boxSizing: "border-box", outline: "none" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["ml", "spr", "tot", "champ"].map(m => (
          <button key={m} onClick={() => setMarket(m)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: market === m ? "#3b82f6" : "rgba(255,255,255,0.05)", color: market === m ? "#fff" : "#6b7280" }}>
            {m === "ml" ? "Moneyline" : m === "spr" ? "Spread" : m === "tot" ? "Totals" : "Championship"}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        {ALL_BOOKS.map(b => (
          <button key={b.key} onClick={() => toggleBook(b.key)} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: selectedBooks.has(b.key) ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: selectedBooks.has(b.key) ? "#3b82f6" : "#4b5563", border: selectedBooks.has(b.key) ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)" }}>
            {b.label}
          </button>
        ))}
      </div>
      {market === "champ" && (
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + champBooks.length * oddsColWidth }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>{champMeta?.label || "Champion"}</th>
              {champBooks.map(b => (
                <th key={b.key} style={{ padding: "12px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {champTeams.length === 0 && (
              <tr><td colSpan={champBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>No championship odds posted yet{search ? ` for "${search}"` : ""}.</td></tr>
            )}
            {champTeams.flatMap((t, ti) => {
              const rows = [];
              if (t.best !== null) rows.push(champRow(`${ti}-yes`, t.name, false, t.books, t.best, t.hasNo, t.bookSizes));
              if (t.hasNo) rows.push(champRow(`${ti}-no`, t.name, true, t.noBooks, t.noBest, false, t.noBookSizes));
              return rows;
            })}
          </tbody>
        </table>
      </div>
      )}
      {market !== "champ" && (
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + visibleBooks.length * oddsColWidth }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>Game</th>
              {visibleBooks.map(b => (
                <th key={b.key} style={{ padding: "12px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(grouped).length === 0 && (
              <tr><td colSpan={visibleBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>No games found{search ? ` for "${search}"` : ""}</td></tr>
            )}
            {Object.entries(grouped).map(([dateKey, dateGames]) => (
              <>
                <tr key={dateKey + "_h"} style={{ background: "rgba(59,130,246,0.06)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td colSpan={visibleBooks.length + 1} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>{dateKey}</td>
                </tr>
                {dateGames.map((game, gi) => {
                  const { bestAway, bestHome } = getBestForGame(game);
                  return (
                    <tr key={gi} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: 0, width: teamColWidth, position: "sticky", left: 0, background: "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ padding: "8px 16px 4px" }}>
                          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>{new Date(game.commence_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })} ET</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed", marginBottom: 6 }}>{game.away}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{game.home}</div>
                        </div>
                      </td>
                      {visibleBooks.map(b => {
                        const cell = getCell(game, b.key);
                        const isBestAway = b.key !== "best" && cell.top !== null && cell.top === bestAway;
                        const isBestHome = b.key !== "best" && cell.bot !== null && cell.bot === bestHome;
                        const isBestCol = b.key === "best";
                        return (
                          <td key={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <div style={{ padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.03)", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: cell.top === null ? "#2d3748" : (isBestCol || isBestAway) ? "#10b981" : "#e8eaed", background: isBestAway ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent" }}>
                                {cell.topLine && <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 1 }}>{cell.topLine}</div>}
                                {formatOdds(cell.top)}
                              </div>
                              <div style={{ padding: "8px 6px", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: cell.bot === null ? "#2d3748" : (isBestCol || isBestHome) ? "#10b981" : "#e8eaed", background: isBestHome ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent" }}>
                                {cell.botLine && <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 1 }}>{cell.botLine}</div>}
                                {formatOdds(cell.bot)}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 12 }}>✅ Green = best available odds across selected books{market === "champ" ? " · top row = price to win the title (Yes); red NO row = exchange lay/\"won't win\" side; small $ under Kalshi/Polymarket = amount available at that price" : " for that side"}</div>
    </div>
  );
}

// Full signed-out landing page. Shown when a logged-out visitor tries to interact
// with the app (soft gate). onSignIn → Google auth; onBack → return to the preview.
function LandingFull({ onSignIn, onBack }) {
  const [barOpen, setBarOpen] = useState(true);
  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
  );
  return (
    <div className="lf-root">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
      <style>{`
        .lf-root { font-family: 'DM Sans', sans-serif; background: #0a0b0f; color: #e8eaed; overflow-x: hidden; min-height: 100vh; }
        .lf-bar { position: relative; display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; padding: 11px 46px; font-size: 13px; color: #dbeafe; text-align: center; background: linear-gradient(90deg, rgba(59,130,246,0.22), rgba(139,92,246,0.22)); border-bottom: 1px solid rgba(99,102,241,0.35); }
        .lf-bar strong { color: #fff; font-weight: 700; }
        .lf-bar-cta { background: #fff; color: #1f2937; border: none; border-radius: 7px; padding: 5px 13px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .lf-bar-x { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #a5b4fc; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
        .lf-root .wrap { max-width: 1120px; margin: 0 auto; padding: 0 40px; }
        .lf-root section { position: relative; z-index: 1; }
        .lf-nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; padding: 16px 40px; background: rgba(10,11,15,0.7); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.06); }
        .lf-brand { display: flex; align-items: center; gap: 12px; cursor: pointer; }
        .lf-logo { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg,#3b82f6,#8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 800; }
        .lf-bn { font-size: 17px; font-weight: 700; letter-spacing: -0.4px; }
        .lf-bs { font-size: 11px; color: #6b7280; }
        .lf-navcta { background: #fff; color: #111; border: none; border-radius: 9px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .lf-hero { text-align: center; padding: 84px 24px 60px; }
        .lf-hero::before { content: ""; position: absolute; top: -10%; left: 50%; transform: translateX(-50%); width: 900px; height: 600px; background: radial-gradient(closest-side, rgba(59,130,246,0.18), rgba(139,92,246,0.10) 45%, transparent 70%); filter: blur(20px); z-index: -1; }
        .lf-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: #a5b4fc; background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.25); border-radius: 999px; padding: 6px 14px; margin-bottom: 24px; }
        .lf-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981; }
        .lf-root h1 { font-size: 60px; line-height: 1.03; font-weight: 800; letter-spacing: -1.9px; }
        .lf-grad { background: linear-gradient(135deg,#60a5fa,#a78bfa); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
        .lf-sub { font-size: 19px; line-height: 1.55; color: #9ca3af; max-width: 660px; margin: 22px auto 34px; }
        .lf-ctarow { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: center; }
        .lf-google { background: #fff; color: #1f2937; border: none; border-radius: 12px; padding: 15px 28px; font-size: 15px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 11px; font-family: inherit; box-shadow: 0 10px 40px rgba(59,130,246,0.15); }
        .lf-trust { font-size: 13px; color: #6b7280; }
        .lf-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 1px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; margin: 44px auto 0; max-width: 900px; }
        .lf-stat { background: #0c0d12; padding: 22px 16px; text-align: center; }
        .lf-stat .n { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
        .lf-stat .n.g { color: #10b981; } .lf-stat .n.b { color: #60a5fa; } .lf-stat .n.p { color: #a78bfa; }
        .lf-stat .l { font-size: 12px; color: #6b7280; margin-top: 4px; }
        .lf-sec { padding: 76px 0; }
        .lf-sechead { text-align: center; margin-bottom: 48px; }
        .lf-sechead .k { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #6b7280; margin-bottom: 12px; }
        .lf-root h2 { font-size: 38px; font-weight: 800; letter-spacing: -1px; }
        .lf-sechead p { font-size: 16px; color: #9ca3af; margin-top: 12px; max-width: 560px; margin-left: auto; margin-right: auto; }
        .lf-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 18px; }
        .lf-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 28px; }
        .lf-card .ic { width: 42px; height: 42px; border-radius: 11px; display: flex; align-items: center; justify-content: center; font-size: 21px; margin-bottom: 16px; background: rgba(59,130,246,0.12); }
        .lf-card h3 { font-size: 19px; font-weight: 700; margin-bottom: 9px; }
        .lf-card p { font-size: 14px; color: #8a8f98; line-height: 1.6; }
        .lf-green { background: rgba(16,185,129,0.12) !important; }
        .lf-purple { background: rgba(139,92,246,0.14) !important; }
        .lf-amber { background: rgba(245,158,11,0.14) !important; }
        .lf-steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
        .lf-step { text-align: center; padding: 8px; }
        .lf-step .num { width: 46px; height: 46px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; background: linear-gradient(135deg,#3b82f6,#8b5cf6); }
        .lf-step h3 { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
        .lf-step p { font-size: 14px; color: #8a8f98; line-height: 1.55; }
        .lf-faq { max-width: 760px; margin: 0 auto; }
        .lf-qa { border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px 22px; margin-bottom: 12px; background: rgba(255,255,255,0.02); }
        .lf-qa h4 { font-size: 15px; font-weight: 700; margin-bottom: 7px; }
        .lf-qa p { font-size: 14px; color: #8a8f98; line-height: 1.55; }
        .lf-closing { text-align: center; padding: 80px 24px; }
        .lf-closingbox { max-width: 720px; margin: 0 auto; background: linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.10)); border: 1px solid rgba(99,102,241,0.25); border-radius: 24px; padding: 56px 40px; }
        .lf-closing h2 { font-size: 36px; font-weight: 800; letter-spacing: -0.8px; margin-bottom: 14px; }
        .lf-closing p { font-size: 16px; color: #9ca3af; margin-bottom: 30px; }
        .lf-footer { border-top: 1px solid rgba(255,255,255,0.06); padding: 28px 40px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
        .lf-footer .muted { font-size: 12px; color: #4b5563; }
        @media (max-width: 900px) {
          .lf-root h1 { font-size: 40px; } .lf-root h2 { font-size: 30px; }
          .lf-stats, .lf-grid { grid-template-columns: 1fr 1fr; }
          .lf-steps { grid-template-columns: 1fr; }
        }
      `}</style>

      {barOpen && (
        <div className="lf-bar">
          <span>🔒 You were viewing a live preview — <strong>sign in for free</strong> to use aibetbuilder.io.</span>
          <button className="lf-bar-cta" onClick={onSignIn}>Sign in →</button>
          <button className="lf-bar-x" onClick={() => setBarOpen(false)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="lf-nav">
        <div className="lf-brand" onClick={onBack} title="Back to preview">
          <div className="lf-logo">B</div>
          <div><div className="lf-bn">AI Bet Builder</div><div className="lf-bs">Powered by Claude</div></div>
        </div>
        <button className="lf-navcta" onClick={onSignIn}>Sign in</button>
      </div>

      <section className="lf-hero"><div className="wrap">
        <div className="lf-eyebrow"><span className="lf-dot"></span> Live odds from 15+ books &amp; exchanges</div>
        <h1>Make your sportsbook<br /><span className="lf-grad">promos actually pay.</span></h1>
        <p className="lf-sub">AI Bet Builder finds the highest-EV boosts, builds the optimal parlay to hit them, and turns free bets into locked, guaranteed cash — all from real-time odds across every major book.</p>
        <div className="lf-ctarow">
          <button className="lf-google" onClick={onSignIn}><GoogleIcon /> Sign in with Google — It's Free</button>
          <span className="lf-trust">No credit card · No bank account linking</span>
        </div>
        <div className="lf-stats">
          <div className="lf-stat"><div className="n b">15+</div><div className="l">Books &amp; exchanges</div></div>
          <div className="lf-stat"><div className="n g">14,000+</div><div className="l">Bets analyzed daily</div></div>
          <div className="lf-stat"><div className="n p">6</div><div className="l">Leagues &amp; futures</div></div>
          <div className="lf-stat"><div className="n">10 min</div><div className="l">Odds update every 10 min</div></div>
        </div>
      </div></section>

      <section className="lf-sec"><div className="wrap">
        <div className="lf-sechead"><div className="k">What's inside</div><h2>Everything you need to beat the promo</h2>
          <p>Built for people who actually work their sportsbook offers — not casual bettors.</p></div>
        <div className="lf-grid">
          <div className="lf-card"><div className="ic lf-green">🎯</div><h3>Promo Builder</h3>
            <p>Set your boost and constraints — it searches thousands of leg combinations and returns the parlay with the highest expected value, with the boosted and true odds side by side.</p></div>
          <div className="lf-card"><div className="ic lf-amber">🔒</div><h3>Free-Bet Converter</h3>
            <p>Enter a free bet and it computes the exact hedge and stake to lock in guaranteed cash, plus the conversion rate so you know your real return before you place a thing.</p></div>
          <div className="lf-card"><div className="ic">📈</div><h3>+EV Bets</h3>
            <p>Every available bet ranked by expected value, with true win probability derived from the sharpest opposing prices across trusted books. See your edge, in dollars, instantly.</p></div>
          <div className="lf-card"><div className="ic lf-purple">📊</div><h3>Odds &amp; Futures Board</h3>
            <p>Compare moneyline, spreads, and totals across 15+ books — plus championship futures with real two-sided Yes/No pricing from Kalshi and Polymarket.</p></div>
        </div>
      </div></section>

      <section className="lf-sec" style={{ background: "rgba(255,255,255,0.015)", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}><div className="wrap">
        <div className="lf-sechead"><div className="k">How it works</div><h2>Three steps to your edge</h2></div>
        <div className="lf-steps">
          <div className="lf-step"><div className="num">1</div><h3>Sign in free</h3><p>One click with Google. No card, no bank account linking, no setup.</p></div>
          <div className="lf-step"><div className="num">2</div><h3>Pick your book &amp; promo</h3><p>Choose your sportsbook and the boost or free bet you're working with.</p></div>
          <div className="lf-step"><div className="num">3</div><h3>Get the optimal play</h3><p>Get the highest-EV parlay or hedge, ranked and ready, from live odds.</p></div>
        </div>
      </div></section>

      <section className="lf-sec"><div className="wrap">
        <div className="lf-sechead"><div className="k">FAQ</div><h2>Good questions</h2></div>
        <div className="lf-faq">
          <div className="lf-qa"><h4>Is it really free?</h4><p>Yes. Sign in with Google and everything's available — no credit card, no trial timer.</p></div>
          <div className="lf-qa"><h4>Which sports are covered?</h4><p>MLB, NFL, NBA, NHL, and college football &amp; basketball — plus championship futures for each.</p></div>
          <div className="lf-qa"><h4>Do I have to link my sportsbook accounts?</h4><p>No. It reads public odds; you place bets yourself at whichever book has the edge.</p></div>
          <div className="lf-qa"><h4>Where do the odds come from?</h4><p>Real-time feeds from 15+ US sportsbooks plus the Kalshi and Polymarket exchanges, refreshed continuously.</p></div>
        </div>
      </div></section>

      <section className="lf-closing"><div className="lf-closingbox">
        <h2>Stop leaving value on the table.</h2>
        <p>Your next boost is worth more than you think. Let's find out how much.</p>
        <button className="lf-google" onClick={onSignIn}><GoogleIcon /> Sign in with Google — It's Free</button>
      </div></section>

      <div className="lf-footer">
        <div className="lf-brand" onClick={onBack}><div className="lf-logo" style={{ width: 30, height: 30, fontSize: 16, borderRadius: 8 }}>B</div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>AI Bet Builder</span></div>
        <span className="muted">Powered by Claude · An analytics tool, not betting advice · 21+</span>
      </div>
    </div>
  );
}

function SendToComboLocksButton({ onSend }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSend(); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "'DM Sans', sans-serif",
        background: "rgba(6,182,212,0.14)",
        color: "#67e8f9",
        border: "1px solid rgba(6,182,212,0.45)",
        cursor: "pointer",
      }}
    >
      Send to Combo Locks
    </button>
  );
}

function ExcludeLegButton({ leg, onExclude }) {
  return (
    <button
      type="button"
      aria-label={`Exclude ${leg.name}`}
      title="Remove this leg from all parlays"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onExclude(leg); }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        minWidth: 22,
        minHeight: 22,
        padding: 0,
        border: "none",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        color: "#9ca3af",
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 1,
        cursor: "pointer",
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      ×
    </button>
  );
}

function PromoParlayLegChips({ legs, isExpanded, onExclude }) {
  if (legs.length > 3) {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {(isExpanded ? legs : legs.slice(0, 3)).map((l, li) => (
          <div key={li} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 6px 5px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{l.name}</span>
              <span style={{ fontSize: 10, color: "#6b7280" }}>{l.market}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: l.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(l.dk)}</span>
              <ExcludeLegButton leg={l} onExclude={onExclude} />
            </div>
            <PromoLegStartTime commence_time={l.commence_time} />
          </div>
        ))}
        {!isExpanded && legs.length > 3 && (
          <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, color: "#93c5fd" }}>
            +{legs.length - 3} more
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      {legs.map((l, li) => (
        <div key={li} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px 8px 14px", flex: 1, minWidth: 150 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</div>
            <ExcludeLegButton leg={l} onExclude={onExclude} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>{l.market}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: l.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(l.dk)}</span>
          </div>
          <PromoLegStartTime commence_time={l.commence_time} />
        </div>
      ))}
    </div>
  );
}

function PromoExpandedLegsTable({ legs, bookLabel, footer, edgeCaption }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1.2fr 0.8fr", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
        <div>Leg</div>
        <div style={{ textAlign: "center" }}>True Win Prob (best opp)</div>
        <div style={{ textAlign: "center" }}>{bookLabel} Odds</div>
        <div style={{ textAlign: "center" }}>Edge</div>
      </div>
      {legs.map((l, li) => {
        const tp = ourTrueProb(l.bestOpp);
        const bookImpl = impliedProb(l.dk);
        const edge = tp - bookImpl;
        const tpAm = probToAmerican(tp);
        const adjustmentNote = ADJUSTED_BOOK_NOTES[l.bestOppBook] || null;
        return (
          <div key={li} style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1.2fr 0.8fr", padding: "12px 16px", borderBottom: li < legs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", alignItems: "center", background: li % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{l.name}</div>
              <PromoLegStartTime commence_time={l.commence_time} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: "#f59e0b" }}>
                {tpAm > 0 ? "+" : ""}{tpAm} ({(tp * 100).toFixed(1)}%)
              </div>
              {l.bestOppBook && (
                <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                  {formatOdds(l.bestOpp)} on {ALL_BOOKS.find(x => x.key === l.bestOppBook)?.label || l.bestOppBook}
                  {adjustmentNote && <span style={{ color: "#06b6d4", marginLeft: 4 }}>({adjustmentNote})</span>}
                </div>
              )}
            </div>
            <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{formatOdds(l.dk)}</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: edge >= 0 ? "#10b981" : "#ef4444" }}>{edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1)}%</div>
              {edgeCaption && <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{edgeCaption}</div>}
            </div>
          </div>
        );
      })}
      {footer}
    </div>
  );
}

export default function App() {
  const [allOddsData, setAllOddsData] = useState({ moneylines: [], run_lines: [], totals: [], team_totals: [] });
  const [futuresData, setFuturesData] = useState([]);
  const [activeTab, setActiveTab] = useState("promo");
  const [showLanding, setShowLanding] = useState(false);
  const [promoType, setPromoType] = useState("boost");
  const [boostPct, setBoostPct] = useState(30);
  const [creditConversionPct, setCreditConversionPct] = useState(DEFAULT_CREDIT_CONVERSION);
  const [refundPct, setRefundPct] = useState(DEFAULT_REFUND_PCT);
  const [stake, setStake] = useState(100);
  const [numLegs, setNumLegs] = useState(3);
  const [minFinalOdds, setMinFinalOdds] = useState("");
  const [minLegOdds, setMinLegOdds] = useState("");
  const [promoDateRange, setPromoDateRange] = useState(DEFAULT_PROMO_DATE_RANGE);
  const [promoPage, setPromoPage] = useState(5);
  const [expandedPromo, setExpandedPromo] = useState(null);
  const [expandedFreeBet, setExpandedFreeBet] = useState(null);
  const [expandedEV, setExpandedEV] = useState(null);
  const [evBookFilter, setEvBookFilter] = useState("all"); // "all" or a specific bookKey — filters the +EV Bets tab
  const [evDateRange, setEvDateRange] = useState("any");
  const [promoBook, setPromoBook] = useState("draftkings");
  const [promoSports, setPromoSports] = useState(new Set(DEFAULT_PROMO_SPORT_KEYS));
  const [marketScope, setMarketScope] = useState("all");
  const [promoFiltersOpen, setPromoFiltersOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [promoLoading, setPromoLoading] = useState(true);
  const [promoLoaded, setPromoLoaded] = useState(false);
  const [promoLoadedSports, setPromoLoadedSports] = useState(null);
  const [promoBoardData, setPromoBoardData] = useState({ moneylines: [], run_lines: [], totals: [], team_totals: [] });
  const [fullBoardLoading, setFullBoardLoading] = useState(false);
  const [fullBoardLoaded, setFullBoardLoaded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [comboPrefill, setComboPrefill] = useState(null);
  const [excludedPromoLegs, setExcludedPromoLegs] = useState(() => new Set());
  const [oddsSource, setOddsSource] = useState({ featured: [], events: [] });
  const [matchingBookKeys, setMatchingBookKeys] = useState(() => loadMatchingBookKeys(TRUSTED_BOOK_KEYS));
  const [evScan, setEvScan] = useState(null);
  const promoFetchGen = useRef(0);
  const fullFetchGen = useRef(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      setAuthLoading(false);

      if (u) {
        // Supabase activity log — session start
        logEvent(u, 'session_start', {
          provider: u.app_metadata?.provider,
          user_agent: navigator.userAgent,
        });

        // GA User-ID tracking
        window.gtag?.('config', 'G-H61PXF1WNS', { user_id: u.id });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const applyTransformed = (featuredRows, eventRows) => {
    const featured = featuredRows.map(row => transformOddsData(row.data, row.sport));
    const eventTransformed = eventRows.map(row => transformEventOddsData(row.data, row.sport));
    return mergeOddsData([...featured, ...eventTransformed]);
  };

  const loadPromoBoard = async () => {
    const gen = ++promoFetchGen.current;
    setExcludedPromoLegs(new Set());
    setPromoLoading(true);
    const plan = buildOddsQueryPlan({
      mode: "promo",
      promoSports,
      featuredSportKeys: SPORT_KEYS,
      futuresKeys: FUTURES_KEYS,
    });
    const { featured, events } = await queryOddsCaches(supabase, plan);
    if (gen !== promoFetchGen.current) return;
    const featuredRows = featured.data;
    if (featured.error || !featuredRows) { setPromoLoading(false); return; }
    const eventRows = events.data || [];
    setOddsSource({ featured: featuredRows, events: eventRows });
    setPromoBoardData(applyTransformed(featuredRows, eventRows));
    setPromoLoadedSports(new Set(plan.featuredSports));
    setFetchedAt(featuredRows[0]?.fetched_at);
    setPromoLoaded(true);
    setPromoLoading(false);
    window.gtag?.('event', 'odds_refreshed', { trigger: 'manual' });
  };

  const loadFullBoard = async () => {
    const gen = ++fullFetchGen.current;
    setFullBoardLoading(true);
    const plan = buildOddsQueryPlan({
      mode: "full",
      featuredSportKeys: SPORT_KEYS,
      futuresKeys: FUTURES_KEYS,
    });
    const { featured, events, futures } = await queryOddsCaches(supabase, plan);
    if (gen !== fullFetchGen.current) return;
    const featuredRows = featured.data;
    if (featured.error || !featuredRows) { setFullBoardLoading(false); return; }
    const eventRows = events.data || [];
    setAllOddsData(applyTransformed(featuredRows, eventRows));
    setFuturesData((futures.data || []).map(row => transformFuturesData(row.data, row.sport)));
    setFetchedAt(featuredRows[0]?.fetched_at);
    setFullBoardLoaded(true);
    setFullBoardLoading(false);
    window.gtag?.('event', 'odds_refreshed', { trigger: 'manual' });
  };

  const fetchOdds = async ({ forceRefresh = true } = {}) => {
    const tab = activeTab;
    if (shouldFetchFullBoard({ tab, fullBoardLoaded, forceRefresh })) {
      await loadFullBoard();
      return;
    }
    if (shouldFetchPromoOdds({ tab, forceRefresh, promoLoaded })) {
      await loadPromoBoard();
    }
  };

  useEffect(() => { fetchOdds({ forceRefresh: false }); }, []);

  useEffect(() => {
    if (shouldFetchFullBoard({ tab: activeTab, fullBoardLoaded, forceRefresh: false })) {
      loadFullBoard();
    }
  }, [activeTab, fullBoardLoaded]);

  useEffect(() => {
    if (!promoLoaded) return;
    if (promoNeedsReload(promoSports, promoLoadedSports)) {
      loadPromoBoard();
    }
  }, [promoSports]);

  useEffect(() => {
    setPromoPage(5);
    setExpandedPromo(null);
    setExpandedFreeBet(null);
  }, [promoBook, promoSports, promoDateRange, promoType, boostPct, stake, creditConversionPct, refundPct, numLegs, minFinalOdds, minLegOdds, marketScope, excludedPromoLegs, matchingBookKeys]);

  const signInWithGoogle = async () => {
    window.gtag?.('event', 'sign_in_started', { method: 'google' });
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  };

  const signOut = async () => {
    window.gtag?.('event', 'sign_out');
    logEvent(user, 'sign_out');
    await supabase.auth.signOut();
    setUser(null);
  };

  const promoOddsData = useMemo(() => {
    if (matchingSetIsFull(matchingBookKeys, TRUSTED_BOOK_KEYS)) return promoBoardData;
    const { featured, events } = oddsSource;
    return mergeOddsData([
      ...featured.map(row => transformOddsData(row.data, row.sport, matchingBookKeys)),
      ...events.map(row => transformEventOddsData(row.data, row.sport, matchingBookKeys)),
    ]);
  }, [promoBoardData, oddsSource, matchingBookKeys]);

  const liveEvScan = useMemo(() => {
    if (!fullBoardLoaded) return null;
    if (!shouldRunEvScan(loadModeForTab(activeTab))) return null;
    const allEvLegs = buildAllLegsAllBooks(allOddsData, null, evDateRange);
    const evBets = allEvLegs.map(l => {
      const { prob, ev, profit } = calcEV(l.dk, l.bestOpp);
      return { ...l, prob, ev, profit };
    }).sort((a, b) => b.ev - a.ev);
    const positiveEV = evBets.filter(b => b.ev > 0);
    return { allEvLegs, evBets, positiveEV };
  }, [fullBoardLoaded, allOddsData, evDateRange, activeTab]);

  useEffect(() => {
    if (liveEvScan) setEvScan(liveEvScan);
  }, [liveEvScan]);

  const evScanView = liveEvScan || evScan;
  const allEvLegs = evScanView?.allEvLegs ?? [];
  const evBets = evScanView?.evBets ?? [];
  const positiveEV = evScanView?.positiveEV ?? [];
  const refreshBusy = activeTab === "ev" || activeTab === "odds"
    ? fullBoardLoading
    : activeTab === "promo" ? promoLoading : false;
  const showFullPageSpinner =
    ((activeTab === "ev" || activeTab === "odds") && fullBoardLoading) ||
    (activeTab === "promo" && promoLoading && !promoLoaded);
  const evHeader = evHeaderValues({
    evScan: evScanView,
    showLoading: fullBoardLoading && (activeTab === "ev" || activeTab === "odds"),
  });

  // +EV Bets tab — single-book filter
  const evBooksAvailable = new Set(evBets.map(b => b.bookKey));
  const evFilterBooks = ALL_BOOKS.filter(b => evBooksAvailable.has(b.key) || b.key === evBookFilter);
  const filteredEvBets = evBookFilter === "all" ? evBets : evBets.filter(b => b.bookKey === evBookFilter);

  const promoSportFilter = promoSports.size === SPORTS.length ? null : [...promoSports];
  const isParlayPromo = promoType === "boost" || promoType === "nosweat";
  const parsedMinLeg = (isParlayPromo && minLegOdds !== "") ? Number(minLegOdds) : null;
  const promoLegsAll = buildAllLegsForBook(promoOddsData, promoBook, promoSportFilter, parsedMinLeg, promoDateRange);
  const promoLegsScoped = marketScope === "main" ? promoLegsAll.filter(l => !l.isAlt)
    : marketScope === "alt" ? promoLegsAll.filter(l => l.isAlt)
    : promoLegsAll;
  const promoLegs = filterExcludedLegs(promoLegsScoped, excludedPromoLegs);
  const parsedMinFinal = (isParlayPromo && minFinalOdds !== "") ? Number(minFinalOdds) : null;
  const PARLAY_LEG_CAP = 200;
  const parlayLegPool = isParlayPromo
    ? [...promoLegs]
        .sort((a, b) => (ourTrueProb(b.bestOpp) - impliedProb(b.dk)) - (ourTrueProb(a.bestOpp) - impliedProb(a.dk)))
        .slice(0, PARLAY_LEG_CAP)
    : promoLegs;
  const topParlays = promoType === "boost" ? findTopParlays(parlayLegPool, numLegs, boostPct, stake, 50, parsedMinFinal) : [];
  const topNoSweats = promoType === "nosweat"
    ? findTopParlays(parlayLegPool, numLegs, 0, stake, 50, parsedMinFinal, (ls) => calcNoSweatFromLegs(ls, stake, refundPct, creditConversionPct))
    : [];

  const topNoSweatsWithLock = useMemo(() => {
    return topNoSweats.map(p => {
      if (p.legs.length !== 1) return { ...p, lock: null, isGuaranteed: false };
      const lock = calcNoSweatLock({
        winProfit: p.winProfit,
        stake,
        creditValue: p.creditValue,
        hedgeDecimal: dkDecimal(p.legs[0].bestOpp),
      });
      return { ...p, lock, isGuaranteed: lock.valid };
    });
  }, [topNoSweats, stake]);

  const topParlaysWithHedge = useMemo(() => {
    return topParlays.map(p => {
      // A true simultaneous lock only exists for single-leg boosts. With n legs there are
      // n hedge stakes but 2^n outcomes, which cannot all be equalized at once — so the
      // Guaranteed Profit badge is restricted to 1-leg boosts.
      if (p.legs.length !== 1) return { ...p, lock: null, isGuaranteed: false };
      const lock = calcBoostLock(p.legs[0].bestOpp, stake, p.boostedProfit);
      return { ...p, lock, isGuaranteed: lock.valid };
    });
  }, [topParlays, stake, boostPct]);

  const topFreeBetConversions = promoType === "freebet" ? findTopFreeBetConversions(promoLegs, stake, 50) : [];

  useEffect(() => {
    if (activeTab !== "combo") setComboPrefill(null);
  }, [activeTab]);

  const excludePromoLeg = (leg) => {
    const key = promoLegIdentity(leg);
    setExcludedPromoLegs(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const sendToComboLocks = (p) => {
    if (user?.email !== OWNER_EMAIL) return;
    const boostedOdds = decimalToAmerican(1 + p.boostedProfit / stake);
    let fair = "";
    if (p.combinedProb > 0 && p.combinedProb < 1) {
      const am = probToAmerican(p.combinedProb);
      if (Number.isFinite(am)) fair = am;
    }
    const startMs = (p.legs || []).map((l) => l.commence_time).filter(Boolean)
      .map((t) => new Date(t).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
    setComboPrefill({
      nonce: Date.now(),
      stake,
      boost: boostedOdds,
      fair,
      fill: recommendedFillFromFair(fair),
      mode: "1x",
      starts: startMs.length ? new Date(startMs[0]).toISOString() : "",
      label: (p.legs || []).map((l) => l.name).join(" + "),
      labelEdited: true,
      // Every leg — including 4+ grown legs — must reach Combo Locks.
      legs: (p.legs || []).map((l) => ({
        name: l.name, market: l.market, game: l.game, commence_time: l.commence_time, sport: l.sport,
      })),
    });
    setActiveTab("combo");
  };

  const togglePromoSport = (sportKey) => {
    setPromoSports(prev => {
      const next = new Set(prev);
      if (next.has(sportKey)) { if (next.size === 1) return prev; next.delete(sportKey); }
      else next.add(sportKey);
      return next;
    });
  };

  const toggleMatchingBook = (bookKey) => {
    setMatchingBookKeys(prev => {
      const next = toggleMatchingBookKey(prev, bookKey, TRUSTED_BOOK_KEYS);
      if (next === prev) return prev;
      saveExcludedMatchingBooks(next, TRUSTED_BOOK_KEYS);
      return next;
    });
  };

  const tabStyle = (tab) => ({
    padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600,
    color: activeTab === tab ? "#f0f0f0" : "#6b7280",
    background: "none", border: "none",
    borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
    transition: "all 0.2s",
  });

  const controlBox = (children) => (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {children}
    </div>
  );

  const labelStyle = { fontSize: 13, fontWeight: 600, color: "#8a8f98" };
  const activePromoBookData = ALL_BOOKS.find(b => b.key === promoBook) || ALL_BOOKS[0];
  const getBookLabel = (key) => ALL_BOOKS.find(x => x.key === key)?.label || key;
  const getAdjustmentNote = (key) => ADJUSTED_BOOK_NOTES[key] || null;

  // Soft gate: logged-out visitors can browse the live app, but the first time they
  // interact with any control (outside the header) they're bounced to the full landing.
  const guardClick = (e) => {
    if (authLoading || user) return;
    if (e.target.closest && e.target.closest('[data-guard-allow]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (!showLanding) { setShowLanding(true); window.gtag?.('event', 'signup_gate_shown'); }
  };

  if (!authLoading && !user && showLanding) {
    return <LandingFull onSignIn={signInWithGoogle} onBack={() => setShowLanding(false)} />;
  }

  return (
    <div onClickCapture={guardClick} onMouseDownCapture={guardClick} style={{ minHeight: "100vh", background: "#0a0b0f", color: "#e8eaed", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div data-guard-allow="true" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>B</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>AI Bet Builder</div>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>Powered by Claude</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {fetchedAt && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 11, color: "#4b5563" }}>
                Updated {new Date(fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })} ET
              </div>
              <button
                onClick={() => { fetchOdds({ forceRefresh: true }); logEvent(user, 'odds_refreshed', { trigger: 'manual' }); }}
                disabled={refreshBusy}
                title="Refresh odds data"
                style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 6, color: "#3b82f6", padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: refreshBusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4, opacity: refreshBusy ? 0.6 : 1, transition: "all 0.2s" }}
                onMouseEnter={e => { if (!refreshBusy) e.currentTarget.style.background = "rgba(59,130,246,0.2)"; }}
                onMouseLeave={e => { if (!refreshBusy) e.currentTarget.style.background = "rgba(59,130,246,0.1)"; }}
              >
                <span style={{ display: "inline-block", animation: refreshBusy ? "spin 1s linear infinite" : "none" }}>↻</span>
                {refreshBusy ? "Refreshing" : "Refresh"}
              </button>
            </div>
          )}
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src={user.user_metadata?.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)" }} />
              <button onClick={signOut} style={{ background: "rgba(255,255,255,0.06)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
            </div>
          ) : (
            <button onClick={signInWithGoogle} style={{ background: "#fff", color: "#333", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sign in with Google</button>
          )}
        </div>
      </div>

      <div style={{ padding: "24px 32px 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatCard label="Total Bets Analyzed" value={evHeader.total} sub="all sports & books" />
        <StatCard label="+EV Bets Found" value={evHeader.plusEv} color="#10b981" />
        <StatCard label="Best Single EV" value={evHeader.bestValue} color="#3b82f6" sub={evHeader.bestSub} />
      </div>

      <div style={{ padding: "20px 32px 0", display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button style={tabStyle("promo")} onClick={() => {
          setActiveTab("promo");
          window.gtag?.('event', 'tab_switched', { tab: 'promo_builder' });
          logEvent(user, 'tab_switched', { tab: 'promo_builder' });
        }}>Promo Builder</button>
        <button style={tabStyle("ev")} onClick={() => {
          setActiveTab("ev");
          window.gtag?.('event', 'tab_switched', { tab: 'ev_bets' });
          logEvent(user, 'tab_switched', { tab: 'ev_bets' });
        }}>+EV Bets</button>
        <button style={tabStyle("odds")} onClick={() => {
          setActiveTab("odds");
          window.gtag?.('event', 'tab_switched', { tab: 'odds_board' });
          logEvent(user, 'tab_switched', { tab: 'odds_board' });
        }}>Odds Board</button>
        {user?.email === OWNER_EMAIL && (
          <>
            <button style={tabStyle("combo")} onClick={() => setActiveTab("combo")}>Combo Locks</button>
            <button style={tabStyle("missTape")} onClick={() => setActiveTab("missTape")}>Miss tape</button>
            <button style={tabStyle("unhedged")} onClick={() => setActiveTab("unhedged")}>Unhedged RFQs</button>
          </>
        )}
      </div>

      {showFullPageSpinner && (
        <div style={{ padding: "60px 32px", textAlign: "center", color: "#4b5563" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14 }}>Loading live odds...</div>
        </div>
      )}

      {!showFullPageSpinner && (
        <div style={{ padding: "20px 32px" }}>

          {activeTab === "odds" && <OddsBoard oddsData={allOddsData} futuresData={futuresData} />}

          {activeTab === "combo" && user?.email === OWNER_EMAIL && <ComboLocks user={user} prefill={comboPrefill} />}

          {activeTab === "missTape" && user?.email === OWNER_EMAIL && <ComboTape user={user} />}

          {activeTab === "unhedged" && user?.email === OWNER_EMAIL && <UnhedgedTape user={user} />}

          {activeTab === "ev" && (
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                All bets ranked by EV across all sportsbooks and sports. True probability from best opposing odds at matching lines among trusted books (DK, FD, Caesars, BetMGM, BetRivers, Fanatics, Hard Rock, theScore, Kalshi, Novig, ProphetX, Polymarket). Kalshi, ProphetX, and Polymarket prices are fee-adjusted. Use the filter below to narrow to a single sportsbook.
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
                {controlBox(<>
                  <label style={labelStyle}>Sportsbook</label>
                  <select value={evBookFilter} onChange={e => {
                    setEvBookFilter(e.target.value);
                    setExpandedEV(null);
                    window.gtag?.('event', 'ev_book_filter', { book: e.target.value });
                    logEvent(user, 'ev_book_filter', { book: e.target.value });
                  }} style={{ background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: (ALL_BOOKS.find(b => b.key === evBookFilter)?.color) || "#e8eaed", padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, cursor: "pointer" }}>
                    <option value="all">All Books</option>
                    {evFilterBooks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                </>)}
                {controlBox(<>
                  <label style={labelStyle}>Date</label>
                  {DATE_RANGES.map(opt => (
                    <button key={opt.val} onClick={() => { setEvDateRange(opt.val); setExpandedEV(null); }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: evDateRange === opt.val ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: evDateRange === opt.val ? "#3b82f6" : "#6b7280" }}>
                      {opt.label}
                    </button>
                  ))}
                </>)}
                <span style={{ fontSize: 12, color: "#4b5563" }}>
                  {filteredEvBets.length} {filteredEvBets.length === 1 ? "bet" : "bets"} · {filteredEvBets.filter(b => b.ev > 0).length} +EV
                </span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1.2fr 1fr 1fr 1fr 1fr 1fr", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
                  <div>Bet</div>
                  <div style={{ textAlign: "center" }}>Sportsbook</div>
                  <div style={{ textAlign: "center" }}>Odds</div>
                  <div style={{ textAlign: "center" }}>True Prob</div>
                  <div style={{ textAlign: "center" }}>Implied</div>
                  <div style={{ textAlign: "center" }}>Edge</div>
                  <div style={{ textAlign: "center" }}>EV ($100)</div>
                </div>
                {filteredEvBets.length === 0 && (
                  <div style={{ padding: "40px 20px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>
                    {evBookFilter === "all" ? "No bets available right now." : `No bets found for ${getBookLabel(evBookFilter)} right now.`}
                  </div>
                )}
                {filteredEvBets.slice(0, 30).map((b, i) => {
                  const bookImplied = impliedProb(b.dk);
                  const edge = b.prob - bookImplied;
                  const isExpanded = expandedEV === i;
                  const profit = (dkDecimal(b.dk) - 1) * 100;
                  const trueProbAm = probToAmerican(b.prob);
                  const adjustmentNote = getAdjustmentNote(b.bestOppBook);
                  return (
                    <div key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", cursor: "pointer" }}
                      onClick={() => {
                        setExpandedEV(isExpanded ? null : i);
                        if (!isExpanded) {
                          window.gtag?.('event', 'ev_bet_expanded', { rank: i + 1 });
                          logEvent(user, 'ev_bet_expanded', { rank: i + 1, bet: b.name, book: b.bookKey });
                        }
                      }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1.2fr 1fr 1fr 1fr 1fr 1fr", padding: "14px 20px", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                            <SportBadge sport={b.sport} />
                            <span style={{ fontSize: 11, color: "#6b7280" }}>{b.market} — {b.game}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{formatET(b.commence_time)}</div>
                          <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 2 }}>{isExpanded ? "▲ collapse" : "▼ breakdown"}</div>
                        </div>
                        <div style={{ textAlign: "center" }}><BookBadge bookKey={b.bookKey} /></div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: b.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(b.dk)}</div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{(b.prob * 100).toFixed(1)}%</div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#6b7280" }}>{(bookImplied * 100).toFixed(1)}%</div>
                        <div style={{ textAlign: "center" }}><EVBadge ev={edge * 100} /></div>
                        <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "+" : ""}${b.ev.toFixed(2)}</div>
                      </div>
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 20px", background: "rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>True Win Prob</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>{(b.prob * 100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>({trueProbAm > 0 ? "+" : ""}{trueProbAm} fair odds)</div>
                              {b.bestOppCount != null && b.bestOppName && (
                                <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>{b.bestOppCount} {b.bestOppCount === 1 ? "line" : "lines"} @ {b.bestOppName}</div>
                              )}
                              {b.bestOppBook && (
                                <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>
                                  {b.sameBookFallback ? "Opp side on" : "Best opp on"}: {getBookLabel(b.bestOppBook)} @ {formatOdds(b.bestOpp)}
                                  {adjustmentNote && <span style={{ color: "#06b6d4", marginLeft: 4 }}>({adjustmentNote})</span>}
                                </div>
                              )}
                              {b.sameBookFallback && (
                                <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>⚠ No independent line — true prob devigged vs this book's own opposite side.</div>
                              )}
                            </div>
                            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Book Implied</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: "#e8eaed" }}>{(bookImplied * 100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>({formatOdds(b.dk)} odds)</div>
                            </div>
                            <div style={{ background: edge > 0 ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${edge > 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Your Edge</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: edge > 0 ? "#10b981" : "#ef4444" }}>{edge > 0 ? "+" : ""}{(edge * 100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{edge > 0 ? "Book is underpricing this" : "Book has the edge here"}</div>
                            </div>
                          </div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10 }}>
                            <div>Win <strong style={{ color: "#10b981" }}>${profit.toFixed(2)}</strong> × <strong style={{ color: "#f59e0b" }}>{(b.prob * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>+${(profit * b.prob).toFixed(2)}</strong></div>
                            <div>Lose <strong style={{ color: "#ef4444" }}>$100</strong> × <strong style={{ color: "#f59e0b" }}>{((1 - b.prob) * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>-${(100 * (1 - b.prob)).toFixed(2)}</strong></div>
                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>EV = ${(profit * b.prob).toFixed(2)} - ${(100 * (1 - b.prob)).toFixed(2)} = <strong style={{ color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "+" : ""}${b.ev.toFixed(2)}</strong></div>
                          </div>
                          <div style={{ fontSize: 13, color: "#9ca3af", padding: "10px 16px", background: b.ev > 0 ? "rgba(16,185,129,0.04)" : "rgba(239,68,68,0.04)", borderRadius: 8, border: `1px solid ${b.ev > 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)"}` }}>
                            <strong style={{ color: b.ev > 0 ? "#10b981" : "#ef4444" }}>{b.ev > 0 ? "✓ Positive EV:" : "✗ Negative EV:"}</strong>{" "}
                            {b.ev > 0 ? `This bet wins ${(b.prob * 100).toFixed(1)}% of the time but the book is only pricing it at ${(bookImplied * 100).toFixed(1)}%. Expected profit of +$${b.ev.toFixed(2)} per $100 bet.` : `This bet wins ${(b.prob * 100).toFixed(1)}% of the time but the book has the edge at ${(bookImplied * 100).toFixed(1)}% implied. Avoid this bet.`}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "promo" && (
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                {promoType === "boost"
                  ? (numLegs === 1
                      ? "Configure your boost and find the single bets with the most expected value."
                      : "Configure your boost and find the optimal parlay legs ranked by expected value.")
                  : promoType === "nosweat"
                    ? "Place a cash bet. If it loses, the stake comes back as site credit, counted at 70¢ on the dollar. Ranked by expected value. 1-leg no-sweats can lock guaranteed cash by hedging the other side."
                    : "Convert your free bet into guaranteed cash. Pick the leg you'll place the free bet on, hedge at the best opposing odds across trusted books, lock in real money."}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {controlBox(<>
                    <label style={labelStyle}>Promo Type</label>
                    {PROMO_TYPES.map(opt => (
                      <button key={opt.val} onClick={() => {
                        setPromoType(opt.val);
                        if (opt.val === "nosweat") setNumLegs(1);
                        window.gtag?.('event', 'promo_type_changed', { promo_type: opt.val });
                        logEvent(user, 'promo_type_changed', { promo_type: opt.val });
                      }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: promoType === opt.val ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.05)", color: promoType === opt.val ? "#8b5cf6" : "#6b7280" }}>
                        {opt.label}
                      </button>
                    ))}
                  </>)}
                  {controlBox(<>
                    <label style={labelStyle}>Sportsbook</label>
                    <select value={promoBook} onChange={e => {
                      setPromoBook(e.target.value);
                      window.gtag?.('event', 'sportsbook_selected', { book: e.target.value });
                      logEvent(user, 'sportsbook_selected', { book: e.target.value });
                    }} style={{ background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: activePromoBookData.color, padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, cursor: "pointer" }}>
                      {ALL_BOOKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                    </select>
                  </>)}
                  {promoType === "boost" && controlBox(<>
                    <label style={labelStyle}>Boost %</label>
                    <input type="number" value={boostPct} onChange={(e) => setBoostPct(Number(e.target.value))} style={{ width: 60, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                  </>)}
                  {controlBox(<>
                    <label style={labelStyle}>{promoType === "freebet" ? "Free Bet $" : "Stake $"}</label>
                    <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))} style={{ width: 70, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                  </>)}
                  {promoType === "nosweat" && controlBox(<>
                    <label style={labelStyle} title="Site credit counted as cash">Credit %</label>
                    <input type="number" value={creditConversionPct} onChange={(e) => setCreditConversionPct(Number(e.target.value))} style={{ width: 60, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                    <span style={{ fontSize: 11, color: "#6b7280" }}>site credit = {creditConversionPct}% cash</span>
                  </>)}
                  {promoType === "nosweat" && controlBox(<>
                    <label style={labelStyle}>Refund %</label>
                    <input type="number" value={refundPct} onChange={(e) => setRefundPct(Number(e.target.value))} style={{ width: 60, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                  </>)}
                  {(promoType === "boost" || promoType === "nosweat") && controlBox(<>
                    <label style={labelStyle}>Legs</label>
                    {[1, 2, 3].map(n => (
                      <button key={n} onClick={() => setNumLegs(n)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: numLegs === n ? "#3b82f6" : "rgba(255,255,255,0.05)", color: numLegs === n ? "#fff" : "#6b7280" }}>{n}</button>
                    ))}
                    {numLegs > 3 && (
                      <>
                        <button
                          type="button"
                          aria-label="Fewer legs"
                          onClick={() => setNumLegs(n => Math.max(3, n - 1))}
                          style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#9ca3af", lineHeight: 1 }}
                        >−</button>
                        <span style={{ padding: "4px 8px", borderRadius: 6, background: "#3b82f6", color: "#fff", fontSize: 13, fontWeight: 700, minWidth: 22, textAlign: "center" }}>{numLegs}</span>
                      </>
                    )}
                    {numLegs < MAX_PROMO_LEGS && (
                      <button
                        type="button"
                        aria-label="More legs"
                        title={`Add a leg (max ${MAX_PROMO_LEGS})`}
                        onClick={() => setNumLegs(n => n <= 3 ? 4 : Math.min(MAX_PROMO_LEGS, n + 1))}
                        style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "#9ca3af", lineHeight: 1 }}
                      >+</button>
                    )}
                  </>)}
                </div>
                <div style={{ display: "flex", flexDirection: promoFiltersOpen ? "row" : "column", alignItems: promoFiltersOpen ? "center" : undefined, gap: promoFiltersOpen ? 8 : 12, flexWrap: "wrap" }}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={promoFiltersOpen}
                    aria-label={promoFiltersOpen ? "Hide filters" : "Show filters"}
                    onClick={() => setPromoFiltersOpen(v => !v)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPromoFiltersOpen(v => !v); } }}
                    style={promoFiltersOpen ? {
                      cursor: "pointer",
                      flex: "0 0 auto",
                      alignSelf: "center",
                      padding: "2px 4px",
                      display: "flex",
                      alignItems: "center",
                      lineHeight: 1,
                    } : {
                      cursor: "pointer",
                      alignSelf: "flex-start",
                      background: "rgba(56,72,96,0.18)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      padding: "7px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      lineHeight: 1.2,
                    }}
                  >
                    {!promoFiltersOpen && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>Filters</span>
                    )}
                    <span style={{ fontSize: 10, color: promoFiltersOpen ? "#3b82f6" : "#6b7280", lineHeight: 1 }}>{promoFiltersOpen ? "▲" : "▼"}</span>
                    {!promoFiltersOpen && (
                      <span style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", lineHeight: 1.2 }}>
                        {formatPromoFilterSummary({ promoSports, promoDateRange, marketScope, promoType, minFinalOdds, minLegOdds, numLegs })}
                      </span>
                    )}
                  </div>
                  {promoFiltersOpen && (
                    <>
                      {controlBox(<>
                        <label style={labelStyle}>Sports</label>
                        {SPORTS.map(s => (
                          <button key={s.key} onClick={() => togglePromoSport(s.key)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: promoSports.has(s.key) ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: promoSports.has(s.key) ? "#3b82f6" : "#6b7280" }}>
                            {s.label}
                          </button>
                        ))}
                      </>)}
                      {controlBox(<>
                        <label style={labelStyle}>Date</label>
                        {DATE_RANGES.map(opt => (
                          <button key={opt.val} onClick={() => setPromoDateRange(opt.val)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: promoDateRange === opt.val ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: promoDateRange === opt.val ? "#3b82f6" : "#6b7280" }}>
                            {opt.label}
                          </button>
                        ))}
                      </>)}
                      {controlBox(<>
                        <label style={labelStyle}>Markets</label>
                        {MARKET_SCOPES.map(opt => (
                          <button key={opt.val} onClick={() => setMarketScope(opt.val)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: marketScope === opt.val ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: marketScope === opt.val ? "#3b82f6" : "#6b7280" }}>
                            {opt.label}
                          </button>
                        ))}
                      </>)}
                      {controlBox(<>
                        <label style={labelStyle}>Matching books</label>
                        {ALL_BOOKS.filter(b => TRUSTED_BOOK_KEYS.has(b.key)).map(b => (
                          <button key={b.key} onClick={() => toggleMatchingBook(b.key)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: matchingBookKeys.has(b.key) ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)", color: matchingBookKeys.has(b.key) ? "#3b82f6" : "#6b7280" }}>
                            {b.label}
                          </button>
                        ))}
                      </>)}
                      {(promoType === "boost" || promoType === "nosweat") && controlBox(<>
                        <label style={labelStyle}>Min Final Odds</label>
                        <input type="number" value={minFinalOdds} onChange={(e) => setMinFinalOdds(e.target.value)} placeholder="e.g. 400" style={{ width: 80, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                      </>)}
                      {(promoType === "boost" || promoType === "nosweat") && numLegs >= 2 && controlBox(<>
                        <label style={labelStyle}>Min Leg Odds</label>
                        <input type="number" value={minLegOdds} onChange={(e) => setMinLegOdds(e.target.value)} placeholder="e.g. -200" style={{ width: 80, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e8eaed", padding: "6px 10px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "center" }} />
                      </>)}
                    </>
                  )}
                </div>
              </div>

              {/* ─── PROFIT BOOST RESULTS ─── */}
              {promoType === "boost" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {topParlaysWithHedge.length === 0 && (
                    <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>No Results Found</div>
                      <div style={{ fontSize: 13, color: "#9ca3af" }}>Try adjusting your filters.</div>
                    </div>
                  )}
                  {topParlaysWithHedge.slice(0, promoPage).map((p, i) => {
                    const isExpanded = expandedPromo === i;
                    const trueParlayOdds = probToAmerican(p.combinedProb);
                    const isSingle = p.legs.length === 1;
                    const boostedOdds = decimalToAmerican(1 + p.boostedProfit / stake);

                    return (
                      <div key={i} style={{ background: i === 0 ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${i === 0 ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
                        onClick={() => {
                          setExpandedPromo(isExpanded ? null : i);
                          if (!isExpanded) {
                            window.gtag?.('event', 'promo_card_expanded', { rank: i + 1, promo_type: 'boost' });
                            logEvent(user, 'promo_card_expanded', { rank: i + 1, promo_type: 'boost', book: promoBook, legs: p.legs.map(l => l.name) });
                          }
                        }}>
                        <div style={{ padding: "20px 24px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 8, background: i === 0 ? "#3b82f6" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: i === 0 ? "#fff" : "#6b7280" }}>{i + 1}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8f98", textTransform: "uppercase", letterSpacing: 1 }}>{i === 0 ? "★ Best Pick" : `Option ${i + 1}`}</div>
                            </div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: p.ev > 0 ? "#10b981" : "#ef4444" }}>+${p.ev.toFixed(2)} EV</div>
                          </div>
                          <PromoParlayLegChips legs={p.legs} isExpanded={isExpanded} onExclude={excludePromoLeg} />
                          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8a8f98", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
                            <span>{activePromoBookData.label} {isSingle ? "Odds" : "Parlay"}: <strong style={{ color: "#e8eaed" }}>{formatOdds(p.parlayOdds)}</strong></span>
                            <span>With Boost: <strong style={{ color: "#10b981" }}>{formatOdds(boostedOdds)}</strong></span>
                            <span>True Odds: <strong style={{ color: "#f59e0b" }}>{trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds}</strong></span>
                            <span>EV: <strong style={{ color: "#10b981" }}>+{(p.ev / stake * 100).toFixed(1)}%</strong></span>
                          </div>

                          {user?.email === OWNER_EMAIL && (
                            <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
                              <SendToComboLocksButton onSend={() => sendToComboLocks(p)} />
                            </div>
                          )}

                          {p.isGuaranteed && (
                            <div onClick={e => e.stopPropagation()}>
                              <GuaranteedBadge
                                leg={p.legs[0]}
                                stake={stake}
                                boostedProfit={p.boostedProfit}
                                lock={p.lock}
                                bookLabel={activePromoBookData.label}
                              />
                            </div>
                          )}
                        </div>

                        {isExpanded && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 24px", background: "rgba(0,0,0,0.2)" }}
                            onClick={e => e.stopPropagation()}>
                            <PromoExpandedLegsTable
                              legs={p.legs}
                              bookLabel={activePromoBookData.label}
                              edgeCaption="(without boost)"
                              footer={
                                <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1.2fr 0.8fr", padding: "12px 16px", borderTop: "2px solid rgba(255,255,255,0.1)", alignItems: "center", background: "rgba(255,255,255,0.03)" }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaed" }}>
                                    {isSingle ? "Total" : "Parlay Total"} <span style={{ color: "#10b981", marginLeft: 6 }}>({formatOdds(boostedOdds)} w/ boost)</span>
                                  </div>
                                  <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>
                                    {trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds} ({(p.combinedProb * 100).toFixed(1)}%)
                                  </div>
                                  <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#e8eaed" }}>+{p.parlayOdds}</div>
                                  <div style={{ textAlign: "center" }}>
                                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: p.ev >= 0 ? "#10b981" : "#ef4444" }}>{p.ev >= 0 ? "+" : ""}{(p.ev / stake * 100).toFixed(1)}%</div>
                                    <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>(with boost)</div>
                                  </div>
                                </div>
                              }
                            />
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12 }}>
                              <div>Win <strong style={{ color: "#10b981" }}>${p.boostedProfit.toFixed(0)}</strong> × <strong style={{ color: "#f59e0b" }}>{(p.combinedProb * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>+${(p.boostedProfit * p.combinedProb).toFixed(2)}</strong></div>
                              <div>Lose <strong style={{ color: "#ef4444" }}>${stake}</strong> × <strong style={{ color: "#f59e0b" }}>{((1 - p.combinedProb) * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>-${(stake * (1 - p.combinedProb)).toFixed(2)}</strong></div>
                              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>EV = <strong style={{ color: "#10b981" }}>+${p.ev.toFixed(2)}</strong></div>
                            </div>
                            <div style={{ fontSize: 13, color: "#9ca3af", padding: "12px 16px", background: "rgba(16,185,129,0.04)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.1)" }}>
                              <strong style={{ color: "#10b981" }}>Bottom line:</strong> This {isSingle ? "bet" : "parlay"} has a {(p.combinedProb * 100).toFixed(1)}% chance of hitting and pays <strong style={{ color: "#e8eaed" }}>${(p.boostedProfit + stake).toFixed(0)}</strong> with your boost. Expected profit: <strong style={{ color: "#10b981" }}>+${p.ev.toFixed(2)}</strong> on a ${stake} bet.
                            </div>
                            {user?.email === OWNER_EMAIL && (
                              <div style={{ marginTop: 12 }}>
                                <SendToComboLocksButton onSend={() => sendToComboLocks(p)} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {topParlaysWithHedge.length > promoPage && (
                    <button
                      onClick={() => setPromoPage(prev => prev + 5)}
                      style={{ width: "100%", padding: "14px", marginTop: 4, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={e => { e.target.style.background = "rgba(255,255,255,0.06)"; e.target.style.color = "#9ca3af"; }}
                      onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.03)"; e.target.style.color = "#6b7280"; }}
                    >
                      Show more ({topParlaysWithHedge.length - promoPage} remaining)
                    </button>
                  )}
                </div>
              )}

              {/* ─── NO SWEAT RESULTS ─── */}
              {promoType === "nosweat" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {topNoSweatsWithLock.length === 0 && (
                    <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>No Results Found</div>
                      <div style={{ fontSize: 13, color: "#9ca3af" }}>Try adjusting your filters.</div>
                    </div>
                  )}
                  {topNoSweatsWithLock.slice(0, promoPage).map((p, i) => {
                    const isExpanded = expandedPromo === i;
                    const trueParlayOdds = probToAmerican(p.combinedProb);
                    const isSingle = p.legs.length === 1;
                    const evColor = p.ev > 0 ? "#10b981" : "#ef4444";

                    return (
                      <div key={i} style={{ background: i === 0 ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${i === 0 ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
                        onClick={() => {
                          setExpandedPromo(isExpanded ? null : i);
                          if (!isExpanded) {
                            window.gtag?.('event', 'promo_card_expanded', { rank: i + 1, promo_type: 'nosweat' });
                            logEvent(user, 'promo_card_expanded', { rank: i + 1, promo_type: 'nosweat', book: promoBook, legs: p.legs.map(l => l.name) });
                          }
                        }}>
                        <div style={{ padding: "20px 24px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 8, background: i === 0 ? "#3b82f6" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: i === 0 ? "#fff" : "#6b7280" }}>{i + 1}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8f98", textTransform: "uppercase", letterSpacing: 1 }}>{i === 0 ? "★ Best Pick" : `Option ${i + 1}`}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: evColor }}>{p.ev > 0 ? "+" : ""}${p.ev.toFixed(2)} EV</div>
                              {p.isGuaranteed && (
                                <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>${p.lock.lockedProfit.toFixed(2)} guaranteed</div>
                              )}
                            </div>
                          </div>
                          <PromoParlayLegChips legs={p.legs} isExpanded={isExpanded} onExclude={excludePromoLeg} />
                          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8a8f98", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
                            <span>{activePromoBookData.label} {isSingle ? "Odds" : "Parlay"}: <strong style={{ color: "#e8eaed" }}>{formatOdds(p.parlayOdds)}</strong></span>
                            <span>Win: <strong style={{ color: "#10b981" }}>+${p.winProfit.toFixed(0)}</strong></span>
                            <span>On a loss: <strong style={{ color: "#e8eaed" }}>${p.refund.toFixed(0)}</strong> site credit ≈ <strong style={{ color: "#10b981" }}>${p.creditValue.toFixed(0)}</strong> cash</span>
                            <span>True Odds: <strong style={{ color: "#f59e0b" }}>{trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds}</strong></span>
                            <span>EV: <strong style={{ color: evColor }}>{p.ev > 0 ? "+" : ""}{(p.ev / stake * 100).toFixed(1)}%</strong></span>
                          </div>
                          {p.isGuaranteed && (
                            <div onClick={e => e.stopPropagation()}>
                              <GuaranteedBadge
                                variant="nosweat"
                                leg={p.legs[0]}
                                stake={stake}
                                boostedProfit={p.winProfit}
                                lock={p.lock}
                                bookLabel={activePromoBookData.label}
                                creditValue={p.creditValue}
                                conversionPct={creditConversionPct}
                              />
                            </div>
                          )}
                        </div>

                        {isExpanded && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 24px", background: "rgba(0,0,0,0.2)" }}
                            onClick={e => e.stopPropagation()}>
                            {p.isGuaranteed ? (
                              <>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 8 }}>How to lock in ${p.lock.lockedProfit.toFixed(2)}</div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>Place both bets at the same time. Whatever happens, you keep ${p.lock.lockedProfit.toFixed(2)}.</div>
                                <div style={{ marginBottom: 14 }}>
                                  <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Step 1 — Place your no-sweat cash bet on {activePromoBookData.label}</div>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(139,92,246,0.06)", borderRadius: 8, border: "1px solid rgba(139,92,246,0.2)" }}>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{p.legs[0].name}</div>
                                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{p.legs[0].market} · {formatOdds(p.legs[0].dk)} · {formatET(p.legs[0].commence_time)}<DaysAwayWarning commence_time={p.legs[0].commence_time} /></div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#8b5cf6", fontSize: 16 }}>${Number(stake).toFixed(2)}</div>
                                      <div style={{ fontSize: 11, color: "#6b7280" }}>cash stake</div>
                                    </div>
                                  </div>
                                </div>
                                <div style={{ marginBottom: 14 }}>
                                  <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Step 2 — Hedge with cash on {getBookLabel(p.legs[0].bestOppBook)}</div>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(16,185,129,0.06)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.2)" }}>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{p.legs[0].bestOppName}</div>
                                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{formatOdds(p.legs[0].bestOpp)} on {getBookLabel(p.legs[0].bestOppBook)}{getAdjustmentNote(p.legs[0].bestOppBook) && <span style={{ color: "#06b6d4" }}> ({getAdjustmentNote(p.legs[0].bestOppBook)})</span>}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 16 }}>${p.lock.hedgeStake.toFixed(2)}</div>
                                      <div style={{ fontSize: 11, color: "#6b7280" }}>cash hedge</div>
                                    </div>
                                  </div>
                                </div>
                                <div style={{ marginBottom: 14 }}>
                                  <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Outcome matrix — both paths return ${p.lock.lockedProfit.toFixed(2)}</div>
                                  <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
                                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                      <div>Outcome</div>
                                      <div style={{ textAlign: "right" }}>No Sweat</div>
                                      <div style={{ textAlign: "right" }}>Net Cash</div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, alignItems: "center" }}>
                                      <div style={{ color: "#e8eaed" }}>No-sweat WINS, hedge LOSES</div>
                                      <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#10b981" }}>+${p.winProfit.toFixed(2)}</div>
                                      <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981" }}>+${p.lock.lockedProfit.toFixed(2)}</div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "10px 12px", fontSize: 12, alignItems: "center" }}>
                                      <div style={{ color: "#e8eaed" }}>No-sweat LOSES, hedge WINS</div>
                                      <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#6b7280" }}>${p.refund.toFixed(0)} credit ≈ ${p.creditValue.toFixed(0)}</div>
                                      <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981" }}>+${p.lock.lockedProfit.toFixed(2)}</div>
                                    </div>
                                  </div>
                                </div>
                                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12 }}>
                                  <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Math</div>
                                  <div>Win: +${p.winProfit.toFixed(2)} − ${p.lock.hedgeStake.toFixed(2)} = <strong style={{ color: "#10b981" }}>+${p.lock.lockedProfit.toFixed(2)}</strong></div>
                                  <div>Lose: −${Number(stake).toFixed(2)} + ${p.creditValue.toFixed(2)} credit + ${p.lock.hedgeStake.toFixed(2)} = <strong style={{ color: "#10b981" }}>+${p.lock.lockedProfit.toFixed(2)}</strong></div>
                                  <div>Hedge stake = (win profit + stake − credit cash) ÷ hedge decimal</div>
                                  <div>= (${p.winProfit.toFixed(2)} + ${Number(stake).toFixed(2)} − ${p.creditValue.toFixed(2)}) ÷ {p.lock.d_h.toFixed(3)} = <strong style={{ color: "#10b981" }}>${p.lock.hedgeStake.toFixed(2)}</strong></div>
                                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>We treat site credit as {creditConversionPct}% cash: ${p.refund.toFixed(0)} refund = ${p.creditValue.toFixed(0)}.</div>
                                </div>
                                <div style={{ fontSize: 13, color: "#9ca3af", padding: "12px 16px", background: "rgba(139,92,246,0.04)", borderRadius: 8, border: "1px solid rgba(139,92,246,0.1)" }}>
                                  <strong style={{ color: "#8b5cf6" }}>Bottom line:</strong> Place a ${Number(stake).toFixed(0)} no-sweat on <strong style={{ color: "#e8eaed" }}>{p.legs[0].name}</strong> and ${p.lock.hedgeStake.toFixed(2)} cash on <strong style={{ color: "#e8eaed" }}>{p.legs[0].bestOppName}</strong>. You walk away with <strong style={{ color: "#10b981" }}>${p.lock.lockedProfit.toFixed(2)}</strong> guaranteed. We count the refund as ${p.creditValue.toFixed(0)}, not ${p.refund.toFixed(0)}.
                                </div>
                              </>
                            ) : (
                              <>
                                <PromoExpandedLegsTable
                                  legs={p.legs}
                                  bookLabel={activePromoBookData.label}
                                  footer={
                                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1.2fr 0.8fr", padding: "12px 16px", borderTop: "2px solid rgba(255,255,255,0.1)", alignItems: "center", background: "rgba(255,255,255,0.03)" }}>
                                      <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaed" }}>{isSingle ? "Total" : "Parlay Total"}</div>
                                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>
                                        {trueParlayOdds > 0 ? "+" : ""}{trueParlayOdds} ({(p.combinedProb * 100).toFixed(1)}%)
                                      </div>
                                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: "#e8eaed" }}>{formatOdds(p.parlayOdds)}</div>
                                      <div style={{ textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: evColor }}>{p.ev >= 0 ? "+" : ""}{(p.ev / stake * 100).toFixed(1)}%</div>
                                    </div>
                                  }
                                />
                                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12 }}>
                                  <div>Win <strong style={{ color: "#10b981" }}>${p.winProfit.toFixed(0)}</strong> × <strong style={{ color: "#f59e0b" }}>{(p.combinedProb * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>+${(p.winProfit * p.combinedProb).toFixed(2)}</strong></div>
                                  <div>Lose → <strong style={{ color: "#e8eaed" }}>${p.refund.toFixed(0)}</strong> site credit ≈ <strong style={{ color: "#10b981" }}>${p.creditValue.toFixed(0)}</strong> cash <span style={{ color: "#6b7280" }}>(net {p.loseNet >= 0 ? "+" : "−"}${Math.abs(p.loseNet).toFixed(0)})</span> × <strong style={{ color: "#f59e0b" }}>{((1 - p.combinedProb) * 100).toFixed(1)}%</strong> = <strong style={{ color: "#e8eaed" }}>{p.loseNet * (1 - p.combinedProb) >= 0 ? "+" : "−"}${Math.abs(p.loseNet * (1 - p.combinedProb)).toFixed(2)}</strong></div>
                                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>EV = <strong style={{ color: evColor }}>{p.ev > 0 ? "+" : ""}${p.ev.toFixed(2)}</strong></div>
                                  <div style={{ marginTop: 6 }}>We treat site credit as {creditConversionPct}% cash: ${p.refund.toFixed(0)} refund = ${p.creditValue.toFixed(0)}.</div>
                                </div>
                                <div style={{ fontSize: 13, color: "#9ca3af", padding: "12px 16px", background: "rgba(16,185,129,0.04)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.1)" }}>
                                  <strong style={{ color: "#10b981" }}>Bottom line:</strong> This {isSingle ? "bet" : "parlay"} has a {(p.combinedProb * 100).toFixed(1)}% chance of hitting and pays <strong style={{ color: "#e8eaed" }}>${(p.winProfit + stake).toFixed(0)}</strong>. If it loses, you get <strong style={{ color: "#e8eaed" }}>${p.refund.toFixed(0)}</strong> site credit (≈ <strong style={{ color: "#10b981" }}>${p.creditValue.toFixed(0)}</strong> cash). Expected profit: <strong style={{ color: evColor }}>{p.ev > 0 ? "+" : ""}${p.ev.toFixed(2)}</strong> on a ${stake} cash stake.
                                  {" "}{isSingle ? "No opposite price is available to lock both sides." : "A guaranteed lock needs a 2-way opposite. Multi-leg no-sweats cannot be locked on both sides at once."}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {topNoSweatsWithLock.length > promoPage && (
                    <button
                      onClick={() => setPromoPage(prev => prev + 5)}
                      style={{ width: "100%", padding: "14px", marginTop: 4, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={e => { e.target.style.background = "rgba(255,255,255,0.06)"; e.target.style.color = "#9ca3af"; }}
                      onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.03)"; e.target.style.color = "#6b7280"; }}
                    >
                      Show more ({topNoSweatsWithLock.length - promoPage} remaining)
                    </button>
                  )}
                </div>
              )}

              {/* ─── FREE BET CONVERSION RESULTS ─── */}
              {promoType === "freebet" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {topFreeBetConversions.length === 0 && (
                    <div style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>No Conversion Opportunities</div>
                      <div style={{ fontSize: 13, color: "#9ca3af" }}>Try adjusting your filters or selecting a different sportsbook.</div>
                    </div>
                  )}
                  {topFreeBetConversions.slice(0, promoPage).map((c, i) => {
                    const isExpanded = expandedFreeBet === i;
                    const adjustmentNote = getAdjustmentNote(c.hedgeBookKey);
                    const fbAmount = stake;

                    return (
                      <div key={i} style={{ background: i === 0 ? "rgba(139,92,246,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${i === 0 ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
                        onClick={() => {
                          setExpandedFreeBet(isExpanded ? null : i);
                          if (!isExpanded) {
                            window.gtag?.('event', 'promo_card_expanded', { rank: i + 1, promo_type: 'freebet' });
                            logEvent(user, 'promo_card_expanded', { rank: i + 1, promo_type: 'freebet', book: promoBook, bet: c.leg.name });
                          }
                        }}>
                        <div style={{ padding: "20px 24px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 8, background: i === 0 ? "#8b5cf6" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: i === 0 ? "#fff" : "#6b7280" }}>{i + 1}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8f98", textTransform: "uppercase", letterSpacing: 1 }}>{i === 0 ? "★ Best Conversion" : `Option ${i + 1}`}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: "#10b981" }}>${c.guaranteedCash.toFixed(2)}</div>
                              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>guaranteed cash · {(c.conversionRate * 100).toFixed(1)}%</div>
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                            <div style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, padding: "10px 14px" }}>
                              <div style={{ fontSize: 11, color: "#8b5cf6", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Free Bet On</div>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{c.leg.name}</div>
                                <ExcludeLegButton leg={c.leg} onExclude={excludePromoLeg} />
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                                <span style={{ fontSize: 11, color: "#6b7280" }}>{c.leg.market} — {activePromoBookData.label}</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: c.leg.dk > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(c.leg.dk)}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>${fbAmount} free bet</div>
                            </div>
                            <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, padding: "10px 14px" }}>
                              <div style={{ fontSize: 11, color: "#10b981", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Hedge With Cash</div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{c.hedgeName}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                                <span style={{ fontSize: 11, color: "#6b7280" }}>{getBookLabel(c.hedgeBookKey)}</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: c.hedgeOddsAmerican > 0 ? "#10b981" : "#e8eaed" }}>{formatOdds(c.hedgeOddsAmerican)}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>${c.hedgeStake.toFixed(2)} hedge stake</div>
                              {adjustmentNote && <div style={{ fontSize: 10, color: "#06b6d4", marginTop: 2 }}>({adjustmentNote})</div>}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8a8f98", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
                            <span>Game: <strong style={{ color: "#e8eaed" }}>{c.leg.game}</strong></span>
                            <span>Conversion: <strong style={{ color: "#10b981" }}>{(c.conversionRate * 100).toFixed(1)}%</strong></span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px 24px", background: "rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 8 }}>How to lock in the conversion</div>
                            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>Place both bets at the same time. Whatever happens in the game, you keep ${c.guaranteedCash.toFixed(2)}.</div>
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Step 1 — Use your free bet on {activePromoBookData.label}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(139,92,246,0.06)", borderRadius: 8, border: "1px solid rgba(139,92,246,0.2)" }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{c.leg.name}</div>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{c.leg.market} · {formatOdds(c.leg.dk)} · {formatET(c.leg.commence_time)}<DaysAwayWarning commence_time={c.leg.commence_time} /></div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#8b5cf6", fontSize: 16 }}>${fbAmount.toFixed(2)}</div>
                                  <div style={{ fontSize: 11, color: "#6b7280" }}>free bet</div>
                                </div>
                              </div>
                            </div>
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Step 2 — Hedge with real cash on {getBookLabel(c.hedgeBookKey)}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(16,185,129,0.06)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.2)" }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{c.hedgeName}</div>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{formatOdds(c.hedgeOddsAmerican)} on {getBookLabel(c.hedgeBookKey)}{adjustmentNote && <span style={{ color: "#06b6d4" }}> ({adjustmentNote})</span>}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 16 }}>${c.hedgeStake.toFixed(2)}</div>
                                  <div style={{ fontSize: 11, color: "#6b7280" }}>cash stake</div>
                                </div>
                              </div>
                            </div>
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Outcome matrix — both paths return ${c.guaranteedCash.toFixed(2)}</div>
                              <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                  <div>Outcome</div>
                                  <div style={{ textAlign: "right" }}>Free Bet</div>
                                  <div style={{ textAlign: "right" }}>Net Cash</div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, alignItems: "center" }}>
                                  <div style={{ color: "#e8eaed" }}>Free bet WINS, hedge LOSES</div>
                                  <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#10b981" }}>+${((c.leg.dk > 0 ? c.leg.dk / 100 : 100 / Math.abs(c.leg.dk)) * fbAmount).toFixed(2)}</div>
                                  <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981" }}>+${c.guaranteedCash.toFixed(2)}</div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "10px 12px", fontSize: 12, alignItems: "center" }}>
                                  <div style={{ color: "#e8eaed" }}>Free bet LOSES, hedge WINS</div>
                                  <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#6b7280" }}>$0 (no stake)</div>
                                  <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981" }}>+${c.guaranteedCash.toFixed(2)}</div>
                                </div>
                              </div>
                            </div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, color: "#9ca3af", padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Math</div>
                              <div>Hedge stake = (free bet decimal − 1) × free bet $ ÷ hedge decimal</div>
                              <div>= ({dkDecimal(c.leg.dk).toFixed(3)} − 1) × ${fbAmount} ÷ {dkDecimal(c.hedgeOddsAmerican).toFixed(3)}</div>
                              <div>= <strong style={{ color: "#10b981" }}>${c.hedgeStake.toFixed(2)}</strong></div>
                              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, marginTop: 6 }}>Guaranteed cash = ${c.hedgeStake.toFixed(2)} × ({dkDecimal(c.hedgeOddsAmerican).toFixed(3)} − 1) = <strong style={{ color: "#10b981" }}>${c.guaranteedCash.toFixed(2)}</strong></div>
                              <div>Conversion rate = ${c.guaranteedCash.toFixed(2)} ÷ ${fbAmount} = <strong style={{ color: "#10b981" }}>{(c.conversionRate * 100).toFixed(1)}%</strong></div>
                            </div>
                            <div style={{ fontSize: 13, color: "#9ca3af", padding: "12px 16px", background: "rgba(139,92,246,0.04)", borderRadius: 8, border: "1px solid rgba(139,92,246,0.1)" }}>
                              <strong style={{ color: "#8b5cf6" }}>Bottom line:</strong> Place a ${fbAmount} free bet on <strong style={{ color: "#e8eaed" }}>{c.leg.name}</strong> and ${c.hedgeStake.toFixed(2)} cash on <strong style={{ color: "#e8eaed" }}>{c.hedgeName}</strong>. You walk away with <strong style={{ color: "#10b981" }}>${c.guaranteedCash.toFixed(2)}</strong> guaranteed — that's a {(c.conversionRate * 100).toFixed(1)}% conversion of the free bet's face value into real cash.
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {topFreeBetConversions.length > promoPage && (
                    <button
                      onClick={() => setPromoPage(prev => prev + 5)}
                      style={{ width: "100%", padding: "14px", marginTop: 4, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={e => { e.target.style.background = "rgba(255,255,255,0.06)"; e.target.style.color = "#9ca3af"; }}
                      onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.03)"; e.target.style.color = "#6b7280"; }}
                    >
                      Show more ({topFreeBetConversions.length - promoPage} remaining)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "20px 32px", borderTop: "1px solid rgba(255,255,255,0.06)", textAlign: "center", fontSize: 11, color: "#4b5563" }}>
        AI Bet Builder — aibetbuilder.io — For informational purposes only. Not financial advice. Please gamble responsibly.
      </div>
    </div>
  );
}
