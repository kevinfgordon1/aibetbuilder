import {usOnlyBooks} from './polymarketUsOnly.js';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {walk, american} from './rootForPrices.js';
import {takerFeeRate, polyComboTakerFeePerContract} from './venueTakerFee.js';
import {isPolyComboSlug} from './polyComboMakerFee.js';
import {blendAskLadderToPayout} from './blendAskLadder.js';
import {makerRateForTicker,loadSeriesFees} from './buyerOdds.js';
const require=createRequire(import.meta.url), bd=require('../lib/book-depth');
assert.equal(takerFeeRate('polymarket'),.095);
assert.equal(takerFeeRate('kalshi',{ticker:'KXMLBHR-26-TEST'}),.035);
assert.equal(takerFeeRate('kalshi',{ticker:'KXNFLGAME-X',fee_multiplier:.25}),.0175);
assert.equal(american(.5+.095*.25),-110);
assert.ok(Math.abs(polyComboTakerFeePerContract(.25)-.02255859375)<1e-12);
const live=walk([[.5,100]],'novig',100,{is_live:true});assert.equal(live.fail,'depth');assert.equal(live.depthUsd,48.5);
assert.equal(walk([[.5,100]],'novig',100,{is_live:false}).depthUsd,50);
const levels=bd.sortAsksBestFirst(bd.novigAsksFromBook({orders:{b:[{price:.5,qty:10000}]}},{outcomes:[{outcomeId:'a'},{outcomeId:'b'}]},'a',.06),'novig');
assert.equal(levels[0].contracts,100);assert.equal(levels[0].principal,50);assert.ok(Math.abs(levels[0].fee-1.5)<1e-10);assert.equal(levels[0].profit,48.5);assert.equal(levels[0].american,-106);
const b=blendAskLadderToPayout(levels,{targetPayout:100});assert.ok(Math.abs(b.payoutFilled-48.5)<1e-10);assert.equal(b.stakeFilled,51.5);
for(const t of ['caoc-X','crossd-X',' CROSSD-X '])assert.equal(isPolyComboSlug(t),true);
assert.equal(isPolyComboSlug('aec-nfl-X'),false);
assert.equal(makerRateForTicker('KXMVECROSSCATEGORY0-X'),0);assert.equal(makerRateForTicker('KXMVECROSSCATEGORY-X'),.035);
const realNow=Date.now;let now=realNow();Date.now=()=>now;let requests=0;
const f=async()=>({ok:true,json:async()=>{requests++;return {series:{KXMVECROSSCATEGORY:{fee_type:'quadratic',fee_multiplier:1}}};}});
try{await loadSeriesFees(['KXMVECROSSCATEGORY-X'],f);assert.equal(makerRateForTicker('KXMVECROSSCATEGORY-X'),0);now+=15*60*1000+1;assert.equal(makerRateForTicker('KXMVECROSSCATEGORY-X'),.035);await loadSeriesFees(['KXMVECROSSCATEGORY-X'],f);assert.equal(requests,2);}finally{Date.now=realNow;}
console.log('currentFees: Tier1 +100→-110; Novig live +100→-106; $48.50 net profit; cache expiry/classifiers OK');

assert.deepEqual(usOnlyBooks([{key:'polymarket'},{key:'polymarket',source:'polymarket-us'}]),[{key:'polymarket',source:'polymarket-us'}]);

const px=bd.sortAsksBestFirst([{rawPrice:.5,contracts:100,american:100,size:50}],'prophetx')[0];
assert.equal(px.profit,49);assert.equal(px.principal,50);assert.equal(px.fee,1);assert.equal(px.size,50);
assert.equal(usOnlyBooks([{key:'polymarket',feed:'polymarket-us-lines'}]).length,1);

assert.equal(require('../lib/player-td.cjs').TAKER_FEE_RATE.polymarket,.095);

// Player HR top quotes AND ladders must use their own series, not the TD base rate.
const props=require('../lib/player-td-feeds');
const propBooks=await props.loadKalshiNoLadders(['KXMLBHR-TEST-1'],{fetchFn:async url=>({ok:true,status:200,json:async()=>url.includes('/series/')?{series:{fee_type:'quadratic',fee_multiplier:.25}}:{orderbooks:[{ticker:'KXMLBHR-TEST-1',orderbook_fp:{yes_dollars:[['.5','100']]}}]}}),sleepFn:async()=>{}});
assert.equal(propBooks.get('KXMLBHR-TEST-1')[0].profit,49.5625);
assert.equal(propBooks.get('KXMLBHR-TEST-1')[0].contracts,100);
assert.equal(props.noLevelsFromKalshiOrderbook({orderbook_fp:{yes_dollars:[['.5','100']]}},{ticker:'KXMLBHR-X'})[0].profit,49.125);
