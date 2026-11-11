import defaults from '../lib/kalshi-fee-defaults.json' with {type:'json'};
export const kalshiSeries = t => String(t || '').trim().toUpperCase().split('-')[0].split(':')[0];
export function kalshiTakerRate(ticker, terms = {}) {
 const m = terms.fee_multiplier == null || terms.fee_multiplier === '' ? NaN : Number(terms.fee_multiplier);
 return 0.07 * (Number.isFinite(m) && m >= 0 ? m : (defaults[kalshiSeries(ticker)] ?? 1));
}
export const fallbackMakerRate = ticker => kalshiSeries(ticker) === 'KXMVECROSSCATEGORY0' ? 0 : 0.035;
