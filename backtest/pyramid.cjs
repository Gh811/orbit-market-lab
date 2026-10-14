'use strict';
const original=require('./engine.cjs'),strategies=require('./strategies.cjs');
function run(input,options={},signal){
 const baseline=original.run(input,options,()=>null),cfg=baseline.config;
 signal=signal||strategies[cfg.strategy];
 const rows=[...new Map(input.filter(b=>b.confirmed===true&&['t','o','h','l','c'].every(k=>Number.isFinite(b[k]))&&b.l>0&&b.h>=Math.max(b.o,b.c,b.l)&&b.l<=Math.min(b.o,b.c)).map(b=>[b.t,b])).values()].sort((a,b)=>a.t-b.t);
 let cash=cfg.capital,positions=[],pending=null,segment=0,lastEntry=-1000,peak=cash,drawdown=0,signals=0,skipped=0,ambiguous=0,additions=0,maxExposure=0,maxEntryRisk=0;
 const trades=[],equity=[],rejections={};
 const stopNet=p=>p.sign*p.qty*(p.stop*(1-p.sign*cfg.slippage)-p.entry)-p.entryFee-p.qty*p.stop*(1-p.sign*cfg.slippage)*cfg.fee;
 const marked=price=>cash+positions.reduce((sum,p)=>sum+p.sign*p.qty*(price-p.entry)-p.qty*price*cfg.fee,0);
 function close(p,price,b,reason){const exit=price*(1-p.sign*cfg.slippage),exitFee=p.qty*exit*cfg.fee,gross=p.sign*p.qty*(exit-p.entry),net=gross-p.entryFee-exitFee;cash+=gross-exitFee;trades.push({...p,exit,exitTime:b.t,reason,gross,fees:p.entryFee+exitFee,net});positions=positions.filter(x=>x!==p)}
 for(let i=0;i<rows.length;i++){
  const b=rows[i];
  if(i&&b.t-rows[i-1].t!==cfg.interval){for(const p of [...positions])close(p,rows[i-1].c,rows[i-1],'数据缺口前平仓');pending=null;segment=i}
  // Gap stops execute before considering any new unit at this open.
  let gapStopped=false;for(const p of [...positions])if(p.sign===1?b.o<=p.stop:b.o>=p.stop){close(p,b.o,b,'跳空止损');gapStopped=true}
  if(gapStopped)pending=null;
  if(pending&&cash>0){
   const sign=pending.direction==='up'?1:-1,entry=b.o*(1+sign*cfg.slippage),risk=sign*(entry-pending.stop),value=marked(b.o),nominal=positions.reduce((sum,p)=>sum+p.qty*b.o,0),room=Math.max(0,value-nominal);
   const allowed=positions.length<3&&positions.every(p=>p.sign===sign&&stopNet(p)>=0)&&(positions.length===0||i-lastEntry>=6);
   if(allowed&&risk>0&&room>0){
    const qty=Math.min(value*cfg.risk/(sign*(entry-pending.stop*(1-sign*cfg.slippage))+cfg.fee*(entry+pending.stop*(1-sign*cfg.slippage))),room/(entry*(1+cfg.fee)));
    if(qty>0){const entryFee=qty*entry*cfg.fee,p={direction:pending.direction,sign,entry,entryTime:b.t,signalTime:pending.signalTime,stop:pending.stop,target:pending.target,qty,entryFee,index:i,initialRisk:risk,trailDistance:pending.trailDistance,breakevenR:pending.breakevenR,bestClose:entry};if(positions.length)additions++;positions.push(p);cash-=entryFee;lastEntry=i;maxExposure=Math.max(maxExposure,(nominal+qty*entry)/(value-entryFee));maxEntryRisk=Math.max(maxEntryRisk,positions.reduce((sum,p)=>sum+Math.max(0,-stopNet(p)),0)/value)}
   }else skipped++;
   pending=null;
  }
  for(const p of [...positions]){
   const stop=p.sign===1?b.l<=p.stop:b.h>=p.stop,target=p.target!=null&&(p.sign===1?b.h>=p.target:b.l<=p.target);
   if(stop&&target)ambiguous++;
   if(stop)close(p,p.stop,b,'止损');else if(target)close(p,p.target,b,'止盈');else if(i-p.index+1>=cfg.maxHold)close(p,b.c,b,'持仓到期');
  }
  for(const p of positions)if(p.trailDistance){p.bestClose=p.sign===1?Math.max(p.bestClose,b.c):Math.min(p.bestClose,b.c);let proposed=p.bestClose-p.sign*p.trailDistance;if(p.breakevenR!=null&&p.sign*(p.bestClose-p.entry)>=p.initialRisk*p.breakevenR)proposed=p.sign===1?Math.max(proposed,p.entry):Math.min(proposed,p.entry);p.stop=p.sign===1?Math.max(p.stop,proposed):Math.min(p.stop,proposed)}
  if(i===rows.length-1)for(const p of [...positions])close(p,b.c,b,'回测结束');
  const value=marked(b.c);peak=Math.max(peak,value);drawdown=Math.max(drawdown,(peak-value)/peak);
  if(b.t>=baseline.testFrom)equity.push({t:b.t,value});
  if(b.t>=baseline.testFrom&&i-segment>=cfg.warmup&&i<rows.length-1&&cash>0&&positions.length<3&&positions.every(p=>stopNet(p)>=0)){
   const s=signal(rows.slice(Math.max(segment,i-cfg.lookback+1),i+1));if((s?.direction==='up'||s?.direction==='down')&&positions.every(p=>p.sign===(s.direction==='up'?1:-1))){pending={...s,signalTime:b.t};signals++}else if(s?.reason)rejections[s.reason]=(rejections[s.reason]||0)+1;
  }
 }
 const yearly=baseline.yearly.map(y=>({...y,startCapital:cfg.capital,endCapital:cfg.capital,trades:0}));let previous=cfg.capital;
 for(const y of yearly){const points=equity.filter(p=>new Date(p.t).getUTCFullYear()===y.year);y.startCapital=previous;y.endCapital=points.at(-1).value;y.return=y.endCapital/y.startCapital-1;y.trades=trades.filter(t=>new Date(t.exitTime).getUTCFullYear()===y.year).length;previous=y.endCapital}
 const full=yearly.filter(y=>!y.partial),average=full.length?full.reduce((sum,y)=>sum+y.return,0)/full.length:null,years=baseline.summary.years,annualizedReturn=cash>0?Math.expm1(Math.log(cash/cfg.capital)/years):cash===0?-1:null,wins=trades.filter(t=>t.net>0),profit=wins.reduce((a,b)=>a+b.net,0),loss=-trades.filter(t=>t.net<0).reduce((a,b)=>a+b.net,0);
 const eligibility=baseline.gaps?'incomplete':!full.length?'insufficient':annualizedReturn>=.1?'pass':'fail';
 return {...baseline,yearly,equity,trades,signals,skipped,ambiguous,rejections,pyramiding:{additions,maxExposure,maxEntryRisk,maxUnits:3},summary:{...baseline.summary,annualizedReturn,averageYearlyReturn:average,eligibility,finalCapital:cash,return:cash/cfg.capital-1,maxDrawdown:drawdown,trades:trades.length,winRate:trades.length?wins.length/trades.length:null,profitFactor:loss?profit/loss:null,fees:trades.reduce((sum,t)=>sum+t.fees,0)}};
}
module.exports={run};
if(require.main===module){let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{try{const data=JSON.parse(input);process.stdout.write(JSON.stringify(run(data.rows,data.options)))}catch(e){process.stderr.write(e.message);process.exitCode=1}})}
