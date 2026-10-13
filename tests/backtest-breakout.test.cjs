const assert=require('node:assert/strict'),{trendBreakout}=require('../backtest/strategies.cjs'),{run}=require('../backtest/engine.cjs');
const bars=Array.from({length:240},(_,i)=>{const c=100+i*.1;return {t:i*60000,o:c-.05,h:c+.25,l:c-.25,c,confirmed:true}});bars[239]={...bars[239],o:124.75,h:125.15,l:124.7,c:125};
const s=trendBreakout(bars);assert.equal(s.direction,'up');assert(s.stop<125&&s.target>125&&s.trailDistance>0);const mirrored=bars.map(b=>({...b,o:300-b.o,h:300-b.l,l:300-b.h,c:300-b.c}));assert.equal(trendBreakout(mirrored).direction,'down');assert.equal(trendBreakout(bars.slice(0,199)).direction,null);
const flat=bars.map(b=>({...b,o:100,c:100,h:100.25,l:99.75}));assert.equal(trendBreakout(flat).direction,null);const huge=bars.map(b=>({...b}));huge[239].h=140;assert.equal(trendBreakout(huge).direction,null);
const input=JSON.stringify(bars);trendBreakout(bars);assert.equal(JSON.stringify(bars),input);
// The low of the entry bar crosses the new trailing stop, but not the initial stop.
const execution=Array.from({length:40},(_,i)=>({t:i*60000,o:100,h:101,l:99,c:100,confirmed:true}));execution[36]={...execution[36],o:100,h:112,l:99,c:110};execution[37]={...execution[37],o:110,h:111,l:104,c:105};
const options={strategy:'trendBreakout',warmup:35,interval:60000,fee:0,slippage:0};const result=run(execution,options,()=>({direction:'up',stop:95,target:150,trailDistance:5,breakevenR:1.5}));assert.equal(result.trades[0].entryTime,36*60000);assert.equal(result.trades[0].exitTime,37*60000);assert.equal(result.trades[0].exit,105,'new stop only applies on following bar');
const history=[];run(bars,options,rows=>{history.push(rows.at(-1).t);return null});assert(history.every((t,i)=>t===(i+35)*60000));
console.log('Breakout v2 PASS: long/short symmetry, warmup, weak/abnormal trend rejection, immutable history and next-bar trailing stop');
