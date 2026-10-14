'use strict';
const original=require('../assets/strategy.js');
// Fixed research baseline, chosen before running its performance. No fitted parameters.
function trendPullback(rows){
 if(rows.length<200)return {direction:null,reason:'等待 200 根趋势预热'};
 const closes=rows.map(b=>b.c),ema=period=>{let x=closes[0];for(const c of closes)x+=2/(period+1)*(c-x);return x};
 const e20=ema(20),e50=ema(50),e200=ema(200),last=rows.at(-1),prior=rows.at(-2);
 let direction=last.c>e200&&e20>e50&&e50>e200?'up':last.c<e200&&e20<e50&&e50<e200?'down':null;
 if(!direction)return {direction:null,reason:'EMA20/50/200 趋势未同向'};
 let atr=0;for(let i=rows.length-14;i<rows.length;i++)atr+=Math.max(rows[i].h-rows[i].l,Math.abs(rows[i].h-rows[i-1].c),Math.abs(rows[i].l-rows[i-1].c))/14;
 const sign=direction==='up'?1:-1;
 // A prior bar touches its own contemporaneous EMA, not a future EMA value.
 let average=closes[0],touch=false;for(let i=0;i<rows.length;i++){average+=2/21*(closes[i]-average);if(i>=rows.length-4&&i<rows.length-1&&rows[i].l<=average+atr*.25&&rows[i].h>=average-atr*.25)touch=true;}
 if(!touch||sign*(last.c-e20)<0||Math.abs(last.c-e20)>atr*1.5)return {direction:null,reason:'等待 EMA20 回踩并收回，避免追价'};
 const trigger=original.confirmationSignals(rows);
 if(!(direction==='up'?trigger.long:trigger.short)||sign*(last.c-prior.c)<=0)return {direction:null,reason:'等待 RSI/MACD 或 K 线同向确认'};
 const swing=direction==='up'?Math.min(...rows.slice(-10).map(b=>b.l)):Math.max(...rows.slice(-10).map(b=>b.h));
 const stop=swing-sign*atr*.2,risk=sign*(last.c-stop);
 if(!Number.isFinite(risk)||risk<atr*.5||risk>atr*4)return {direction:null,reason:'近期拐点止损距离不合适'};
 return {direction,stop,target:last.c+sign*2*risk};
}
function cardStrict(rows){const r=original.analyzeStrategy(rows),c=original.tradeCall(r);return c.direction?{direction:c.direction,...r.levels.plans[c.direction==='up'?'long':'short']}:{direction:null,reason:c.reason}}
// v2 rules are fixed before performance is run. Only closed history is supplied.
function trendBreakout(rows){
 if(rows.length<200)return {direction:null,reason:'等待 200 根趋势预热'};
 const ema=period=>{let value=rows[0].c;for(const b of rows)value+=2/(period+1)*(b.c-value);return value};
 const e50=ema(50),e200=ema(200),last=rows.at(-1),previous=rows.slice(-21,-1);
 let atr=0,plus=0,minus=0,adx=null,dxCount=0;
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],tr=Math.max(b.h-b.l,Math.abs(b.h-a.c),Math.abs(b.l-a.c)),up=b.h-a.h,down=a.l-b.l;
  const pd=up>down&&up>0?up:0,md=down>up&&down>0?down:0;
  if(i<=14){atr+=tr/14;plus+=pd/14;minus+=md/14}else{atr+=(tr-atr)/14;plus+=(pd-plus)/14;minus+=(md-minus)/14}
  if(i>=14){const dx=plus+minus?100*Math.abs(plus-minus)/(plus+minus):0;if(dxCount<14){adx=(adx||0)+dx/14;dxCount++}else adx+=(dx-adx)/14}
 }
 if(!(atr>0)||adx<20)return {direction:null,reason:'ADX 未达到 20，避开弱趋势'};
 const high=Math.max(...previous.map(b=>b.h)),low=Math.min(...previous.map(b=>b.l));
 const direction=last.c>high&&last.c>e50&&e50>e200?'up':last.c<low&&last.c<e50&&e50<e200?'down':null;
 if(!direction)return {direction:null,reason:'等待 20 根通道突破和 EMA50/200 同向'};
 if(last.h-last.l>atr*3)return {direction:null,reason:'突破 K 线过大，避免追逐异常波动'};
 const sign=direction==='up'?1:-1,risk=2*atr;
 return {direction,stop:last.c-sign*risk,target:last.c+sign*3*risk,trailDistance:3*atr,breakevenR:1.5};
}
function researchIndicators(rows){
 if(rows.length<200)return null;
 const ema=period=>{let x=rows[0].c;for(const b of rows)x+=2/(period+1)*(b.c-x);return x};
 let atr=0,upAvg=0,downAvg=0,pdm=0,mdm=0,adx=0,count=0;
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i],delta=b.c-a.c,tr=Math.max(b.h-b.l,Math.abs(b.h-a.c),Math.abs(b.l-a.c)),up=b.h-a.h,down=a.l-b.l;
  const plus=up>down&&up>0?up:0,minus=down>up&&down>0?down:0;
  if(i<=14){atr+=tr/14;upAvg+=Math.max(delta,0)/14;downAvg+=Math.max(-delta,0)/14;pdm+=plus/14;mdm+=minus/14}
  else{atr+=(tr-atr)/14;upAvg+=(Math.max(delta,0)-upAvg)/14;downAvg+=(Math.max(-delta,0)-downAvg)/14;pdm+=(plus-pdm)/14;mdm+=(minus-mdm)/14}
  if(i>=14){const dx=pdm+mdm?100*Math.abs(pdm-mdm)/(pdm+mdm):0;if(count<14){adx+=dx/14;count++}else adx+=(dx-adx)/14}
 }
 const rsi=downAvg?100-100/(1+upAvg/downAvg):upAvg?100:50;
 return {e20:ema(20),e50:ema(50),e200:ema(200),atr,rsi,adx};
}
function channelRide(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待趋势预热'};
 const last=rows.at(-1),prior=rows.slice(-56,-1),high=Math.max(...prior.map(b=>b.h)),low=Math.min(...prior.map(b=>b.l));
 const direction=last.c>high&&last.c>q.e200?'up':last.c<low&&last.c<q.e200?'down':null;
 if(!direction)return {direction:null,reason:'等待 55 根通道突破与 EMA200 同向'};
 if(last.h-last.l>4*q.atr)return {direction:null,reason:'异常突破波动，跳过追价'};
 const sign=direction==='up'?1:-1,risk=3*q.atr;
 return {direction,stop:last.c-sign*risk,target:last.c+sign*8*risk,trailDistance:4*q.atr};
}
function momentumContinuation(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待动量预热'};
 const previous=researchIndicators(rows.slice(0,-1)),last=rows.at(-1),prior=rows.at(-2);if(!previous)return {direction:null,reason:'等待前一根 EMA 预热'};const direction=q.e20>q.e50&&q.e50>q.e200&&last.c>prior.h&&prior.l<=previous.e20&&q.rsi>=55&&q.rsi<=75?'up':q.e20<q.e50&&q.e50<q.e200&&last.c<prior.l&&prior.h>=previous.e20&&q.rsi<=45&&q.rsi>=25?'down':null;
 if(!direction)return {direction:null,reason:'等待同向回踩、突破及 RSI 确认'};
 if(last.h-last.l>3*q.atr)return {direction:null,reason:'动量 K 线波动过大'};
 const sign=direction==='up'?1:-1,risk=1.5*q.atr;
 return {direction,stop:last.c-sign*risk,target:last.c+sign*5*risk,trailDistance:2.5*q.atr,breakevenR:2};
}
function rangeRecovery(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待区间预热'};
 if(q.adx>=20)return {direction:null,reason:'趋势较强，不做逆势区间回归'};
 const band=history=>{const closes=history.slice(-20).map(b=>b.c),mid=closes.reduce((a,b)=>a+b,0)/20,sd=Math.sqrt(closes.reduce((a,b)=>a+(b-mid)**2,0)/20);return {mid,upper:mid+2*sd,lower:mid-2*sd}};
 const current=band(rows),previous=band(rows.slice(0,-1)),last=rows.at(-1),prior=rows.at(-2);
 const direction=prior.c<previous.lower&&last.c>current.lower&&last.c>prior.c&&q.rsi<45?'up':prior.c>previous.upper&&last.c<current.upper&&last.c<prior.c&&q.rsi>55?'down':null;
 if(!direction)return {direction:null,reason:'等待越轨后收回及 RSI 修复'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?Math.min(...rows.slice(-5).map(b=>b.l))-.3*q.atr:Math.max(...rows.slice(-5).map(b=>b.h))+.3*q.atr;
 if(sign*(current.mid-last.c)<1.5*sign*(last.c-stop))return {direction:null,reason:'中轨目标不足 1.5R，跳过'};
 return {direction,stop,target:current.mid};
}
function macroRide(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待大周期趋势预热'};
 const last=rows.at(-1),direction=q.e20>q.e50&&q.e50>q.e200&&last.c>q.e20?'up':q.e20<q.e50&&q.e50<q.e200&&last.c<q.e20?'down':null;
 if(!direction||q.adx<20)return {direction:null,reason:'等待完整均线趋势与 ADX 确认'};
 if(last.h-last.l>3*q.atr)return {direction:null,reason:'异常趋势波动，暂不入场'};
 const sign=direction==='up'?1:-1;
 return {direction,stop:last.c-sign*1.5*q.atr,target:null,trailDistance:6*q.atr};
}
function compressionRide(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待收缩结构预热'};
 const prior=rows.slice(-11,-1),last=rows.at(-1),previous=rows.at(-2),high=Math.max(...prior.map(b=>b.h)),low=Math.min(...prior.map(b=>b.l));
 if(high-low>3*q.atr||last.h-last.l>2*q.atr)return {direction:null,reason:'等待压缩区间，不追逐大 K 线'};
 const direction=q.e50>q.e200&&last.c>high?'up':q.e50<q.e200&&last.c<low?'down':null;
 if(!direction)return {direction:null,reason:'等待收缩区间突破与大趋势同向'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?previous.l-.15*q.atr:previous.h+.15*q.atr,risk=sign*(last.c-stop);
 if(risk<.5*q.atr||risk>1.5*q.atr)return {direction:null,reason:'结构止损距离不合适'};
 return {direction,stop,target:null,trailDistance:6*q.atr};
}
function structureRide(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待结构趋势预热'};
 const last=rows.at(-1),previous=rows.at(-2),before=rows.at(-3);
 if(q.adx<25||previous.h>before.h||previous.l<before.l)return {direction:null,reason:'等待强趋势中的内包结构'};
 const direction=q.e50>q.e200&&last.c>q.e20&&last.c>previous.h?'up':q.e50<q.e200&&last.c<q.e20&&last.c<previous.l?'down':null;
 if(!direction)return {direction:null,reason:'等待内包突破确认'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?previous.l-.1*q.atr:previous.h+.1*q.atr,risk=sign*(last.c-stop);
 if(risk<.3*q.atr||risk>1.2*q.atr)return {direction:null,reason:'内包止损距离不合适'};
 return {direction,stop,target:null,trailDistance:5*q.atr};
}
// OHLC wicks are derived from a closed candle, never interpreted as an intrabar order path.
function wickSweep(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待影线预热'};
 const b=rows.at(-1),history=rows.slice(-21,-1),lo=Math.min(...history.map(b=>b.l)),hi=Math.max(...history.map(b=>b.h)),range=b.h-b.l,lower=Math.min(b.o,b.c)-b.l,upper=b.h-Math.max(b.o,b.c);
 if(!(range>0))return {direction:null,reason:'无有效 K 线范围'};
 const direction=q.e50>q.e200&&b.l<lo&&b.c>lo&&b.c>b.o&&lower/range>=.45&&(b.c-b.l)/range>=.65?'up':q.e50<q.e200&&b.h>hi&&b.c<hi&&b.c<b.o&&upper/range>=.45&&(b.c-b.l)/range<=.35?'down':null;
 if(!direction)return {direction:null,reason:'等待插针后收回与趋势同向'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?b.l-.1*q.atr:b.h+.1*q.atr,risk=sign*(b.c-stop);
 if(risk<.5*q.atr||risk>3*q.atr)return {direction:null,reason:'影线止损距离不合适'};
 return {direction,stop,target:b.c+sign*3*risk};
}
function pinConfirm(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待长影线预热'};
 const pin=rows.at(-2),last=rows.at(-1),range=pin.h-pin.l,body=Math.max(Math.abs(pin.c-pin.o),range*.05),lower=Math.min(pin.o,pin.c)-pin.l,upper=pin.h-Math.max(pin.o,pin.c);
 const direction=range>0&&lower>=body*2&&lower>=range*.55&&last.c>pin.h&&last.c>q.e200?'up':range>0&&upper>=body*2&&upper>=range*.55&&last.c<pin.l&&last.c<q.e200?'down':null;
 if(!direction)return {direction:null,reason:'等待锤子线或流星线收盘确认'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?pin.l-.1*q.atr:pin.h+.1*q.atr,risk=sign*(last.c-stop);
 if(risk<.5*q.atr||risk>3*q.atr)return {direction:null,reason:'长影线止损距离不合适'};
 return {direction,stop,target:last.c+sign*4*risk};
}
function engulfRide(rows){
 const q=researchIndicators(rows),priorIndicators=researchIndicators(rows.slice(0,-1));if(!q||!priorIndicators||!(q.atr>0))return {direction:null,reason:'等待吞没预热'};
 const a=rows.at(-2),b=rows.at(-1),direction=q.e50>q.e200&&a.c<a.o&&b.c>b.o&&b.o<=a.c&&b.c>=a.o&&b.c>a.h&&a.l<=priorIndicators.e20&&b.c>q.e20?'up':q.e50<q.e200&&a.c>a.o&&b.c<b.o&&b.o>=a.c&&b.c<=a.o&&b.c<a.l&&a.h>=priorIndicators.e20&&b.c<q.e20?'down':null;
 if(!direction)return {direction:null,reason:'等待趋势回踩后的实体吞没'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?Math.min(a.l,b.l)-.1*q.atr:Math.max(a.h,b.h)+.1*q.atr,risk=sign*(b.c-stop);
 if(risk<.5*q.atr||risk>3*q.atr)return {direction:null,reason:'吞没止损距离不合适'};
 return {direction,stop,target:null,trailDistance:3*q.atr};
}
function wickBreak(rows){
 const q=researchIndicators(rows);if(!q||!(q.atr>0))return {direction:null,reason:'等待影线突破预热'};
 const pin=rows.at(-2),b=rows.at(-1),range=pin.h-pin.l,body=Math.max(Math.abs(pin.c-pin.o),range*.05),lower=Math.min(pin.o,pin.c)-pin.l,upper=pin.h-Math.max(pin.o,pin.c);
 const direction=range>0&&lower>=2*body&&lower>=.55*range&&b.c>pin.h&&b.c>q.e200?'up':range>0&&upper>=2*body&&upper>=.55*range&&b.c<pin.l&&b.c<q.e200?'down':null;
 if(!direction)return {direction:null,reason:'等待长影线后的突破确认'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?b.l-.1*q.atr:b.h+.1*q.atr,risk=sign*(b.c-stop);
 if(risk<.5*q.atr||risk>2.5*q.atr)return {direction:null,reason:'突破止损距离不合适'};
 return {direction,stop,target:null,trailDistance:6*q.atr};
}
function engulfBreak(rows){
 const q=researchIndicators(rows),p=researchIndicators(rows.slice(0,-1));if(!q||!p||!(q.atr>0))return {direction:null,reason:'等待吞没突破预热'};
 const a=rows.at(-2),b=rows.at(-1),direction=q.e50>q.e200&&a.c<a.o&&b.c>b.o&&b.o<=a.c&&b.c>a.h&&a.l<=p.e20&&b.c>q.e20?'up':q.e50<q.e200&&a.c>a.o&&b.c<b.o&&b.o>=a.c&&b.c<a.l&&a.h>=p.e20&&b.c<q.e20?'down':null;
 if(!direction)return {direction:null,reason:'等待回踩吞没突破'};
 const sign=direction==='up'?1:-1,stop=direction==='up'?b.l-.1*q.atr:b.h+.1*q.atr,risk=sign*(b.c-stop);
 if(risk<.5*q.atr||risk>2.5*q.atr)return {direction:null,reason:'吞没突破风险距离不合适'};
 return {direction,stop,target:null,trailDistance:6*q.atr};
}
module.exports={pyramidChannel:channelRide,pyramidCompression:compressionRide,pyramidStructure:structureRide,pyramidWick:wickBreak,pyramidEngulf:engulfBreak,pyramidTrend:macroRide,trendPullback,trendBreakout,cardStrict,channelRide,momentumContinuation,rangeRecovery,macroRide,compressionRide,structureRide,wickSweep,pinConfirm,engulfRide,wickBreak,engulfBreak};
