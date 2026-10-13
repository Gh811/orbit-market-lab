'use strict';
const assert=require('node:assert/strict'),{run}=require('../backtest/engine.cjs');
const day=86400000,start=Date.UTC(2024,10,1),bars=Array.from({length:450},(_,i)=>({t:start+i*day,o:100,h:101,l:99,c:100,v:100,confirmed:true}));
bars[36]={...bars[36],h:111};
const r=run(bars,{warmup:35,interval:day,fee:0,slippage:0,maxHold:48},history=>history.at(-1).t===bars[35].t?{direction:'up',stop:95,target:110}:null);
assert.equal(r.trades.length,1);assert.equal(r.summary.finalCapital,10200);
const years=(bars.at(-1).t-bars[35].t)/(365.25*day);
assert(Math.abs(r.summary.annualizedReturn-(1.02**(1/years)-1))<1e-12);
assert(Math.abs(r.yearly.reduce((a,y)=>a*(1+y.return),1)-1.02)<1e-12);
assert.equal(r.yearly.reduce((a,y)=>a+y.trades,0),1);
const idle=run(bars,{warmup:35,interval:day},()=>null);assert.equal(idle.summary.annualizedReturn,0);assert.equal(idle.summary.winRate,null);
assert.throws(()=>run(bars,{strategy:'invalid'}),/未知策略/);
// A longer empty tail must lower annualized profit while retaining the same realized profit.
const short=run(bars.slice(0,100),{warmup:35,interval:day,fee:0,slippage:0},history=>history.at(-1).t===bars[35].t?{direction:'up',stop:95,target:110}:null);
assert.equal(short.summary.finalCapital,r.summary.finalCapital);assert(short.summary.annualizedReturn>r.summary.annualizedReturn);
console.log('Annualized backtest PASS: compounded calendar duration includes idle time, yearly returns reconcile, no-trade semantics, strategy selection');
