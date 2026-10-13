const assert=require('node:assert/strict'),s=require('../backtest/strategies.cjs');
const trend=Array.from({length:240},(_,i)=>{const c=100+i*.1;return{t:i*21600000,o:c-.1,c,h:c+.5,l:c-.5,confirmed:true}});
const sweep=trend.map(b=>({...b}));sweep[239]={...sweep[239],o:123.2,c:123.4,h:123.6,l:121.2};
const pin=trend.map(b=>({...b}));pin[238]={...pin[238],o:123.4,c:123.5,h:123.6,l:121.3};pin[239]={...pin[239],o:123.7,c:123.9,h:124.1,l:123.4};
const engulf=trend.map(b=>({...b}));engulf[238]={...engulf[238],o:123.1,c:122.7,h:123.2,l:122.5};engulf[239]={...engulf[239],o:122.6,c:123.8,h:124,l:122.5};
for(const [name,rows]of [['wickSweep',sweep],['pinConfirm',pin],['wickBreak',pin],['engulfRide',engulf],['engulfBreak',engulf]]){const original=JSON.stringify(rows),long=s[name](rows);assert.equal(long.direction,'up',name);assert(long.stop<rows.at(-1).c);const mirror=rows.map(b=>({...b,o:300-b.o,c:300-b.c,h:300-b.l,l:300-b.h}));const short=s[name](mirror);assert.equal(short.direction,'down',name);assert(short.stop>mirror.at(-1).c);assert.equal(JSON.stringify(rows),original);assert.equal(s[name](rows.slice(0,199)).direction,null)}
const noConfirmation=pin.map(b=>({...b}));noConfirmation[239]={...noConfirmation[239],c:123.5};assert.equal(s.pinConfirm(noConfirmation).direction,null);assert.equal(s.wickBreak(noConfirmation).direction,null);
console.log('Wick rules PASS: derived shadows, confirmation, trend context, long/short symmetry, warmup and immutable closed history');
