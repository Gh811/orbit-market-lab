/* Same signal implementation as the live cards. Execution assumptions are explicit. */
const strategies = require('./strategies.cjs');
function run(input, options = {}, signal) {
  const cfg = {strategy:'cardStrict',capital:10000,risk:.01,fee:.0005,slippage:.0002,lookback:1200,warmup:200,maxHold:48,interval:14400000,...options};
  if(!Object.hasOwn(strategies,cfg.strategy))throw Error('未知策略');
  signal=signal||strategies[cfg.strategy];
  for (const key of ['capital','risk','fee','slippage','lookback','warmup','maxHold','interval']) if(!Number.isFinite(cfg[key])) throw Error('参数必须是有效数字');
  if(cfg.capital<=0||cfg.risk<=0||cfg.risk>.05||cfg.fee<0||cfg.fee>.01||cfg.slippage<0||cfg.slippage>.01||cfg.lookback<200||cfg.lookback>5000||cfg.warmup<35||cfg.maxHold<1||cfg.maxHold>10000||!['lookback','warmup','maxHold','interval'].every(k=>Number.isInteger(cfg[k]))||cfg.interval<=0)throw Error('参数超出允许范围');
  let rows = [...new Map(input.filter(b=>b.confirmed===true && ['t','o','h','l','c'].every(k=>Number.isFinite(b[k])) && b.l>0 && b.h>=Math.max(b.o,b.c,b.l) && b.l<=Math.min(b.o,b.c)).map(b=>[b.t,b])).values()].sort((a,b)=>a.t-b.t);
  if(rows.length<=cfg.warmup)throw Error('已完成 K 线不足，至少需要 '+(cfg.warmup+1)+' 根');
  if(cfg.testStart!=null&&!Number.isFinite(cfg.testStart))throw Error('测试开始时间无效');
  const startIndex=cfg.testStart==null?cfg.warmup:rows.findIndex((b,i)=>i>=cfg.warmup&&b.t>=cfg.testStart);
  if(startIndex<0)throw Error('所选区间没有足够历史');
  let cash=cfg.capital, position=null, pending=null, peak=cash, drawdown=0, gaps=0, segment=0, ambiguous=0, skipped=0, signals=0;
  const trades=[],equity=[],rejections={};
  function close(raw,b,reason) {
    const p=position, exit=raw*(1-p.sign*cfg.slippage), exitFee=p.qty*exit*cfg.fee;
    const gross=p.sign*p.qty*(exit-p.entry), net=gross-p.entryFee-exitFee;
    cash+=gross-exitFee;
    trades.push({...p,exit,exitTime:b.t,reason,gross,fees:p.entryFee+exitFee,net});position=null;
  }
  for(let i=0;i<rows.length;i++) {
    const b=rows[i];
    if(i && b.t-rows[i-1].t!==cfg.interval) {
      gaps++;pending=null;segment=i;
      if(position)close(rows[i-1].c,rows[i-1],'数据缺口前平仓');
    }
    if(pending && !position && cash>0) {
      const sign=pending.direction==='up'?1:-1, entry=b.o*(1+sign*cfg.slippage);
      const risk=sign*(entry-pending.stop), reward=pending.target==null?null:sign*(pending.target-entry);
      if(risk>0 && (reward==null||reward/risk>=1.5)) {
        const qty=Math.min(cash*cfg.risk/(risk+cfg.fee*(entry+pending.stop)+pending.stop*cfg.slippage),cash/(entry*(1+cfg.fee)));
        const entryFee=qty*entry*cfg.fee;
        position={direction:pending.direction,sign,entry,entryTime:b.t,signalTime:pending.signalTime,stop:pending.stop,target:pending.target,qty,entryFee,index:i,initialRisk:risk,trailDistance:Number.isFinite(pending.trailDistance)&&pending.trailDistance>0?pending.trailDistance:null,breakevenR:Number.isFinite(pending.breakevenR)?pending.breakevenR:null,bestClose:entry};cash-=entryFee;
      }else skipped++;
      pending=null;
    }
    if(position) {
      const p=position, stop=p.sign===1?b.l<=p.stop:b.h>=p.stop, target=p.target!=null&&(p.sign===1?b.h>=p.target:b.l<=p.target);
      const gapStop=p.sign===1?b.o<=p.stop:b.o>=p.stop;
      if(stop&&target)ambiguous++;
      if(stop)close(gapStop?b.o:p.stop,b,'止损');
      else if(target)close(p.target,b,'止盈');
      else if(i-p.index+1>=cfg.maxHold)close(b.c,b,'持仓到期');
    }
    // Updated after this bar's exit checks: a close-derived stop applies next bar.
    if(position&&position.trailDistance){
      const p=position;p.bestClose=p.sign===1?Math.max(p.bestClose,b.c):Math.min(p.bestClose,b.c);
      let proposed=p.bestClose-p.sign*p.trailDistance;
      if(p.breakevenR!=null&&p.sign*(p.bestClose-p.entry)>=p.initialRisk*p.breakevenR)proposed=p.sign===1?Math.max(proposed,p.entry):Math.min(proposed,p.entry);
      p.stop=p.sign===1?Math.max(p.stop,proposed):Math.min(p.stop,proposed);
    }
    if(i===rows.length-1 && position)close(b.c,b,'回测结束');
    const value=cash+(position?position.sign*position.qty*(b.c-position.entry)-position.qty*b.c*cfg.fee:0);
    peak=Math.max(peak,value);drawdown=Math.max(drawdown,peak>0?(peak-value)/peak:0);
    if(i>=startIndex)equity.push({t:b.t,value});
    if(!position && cash>0 && i>=startIndex && i-segment>=cfg.warmup && i<rows.length-1) {
      const history=rows.slice(Math.max(segment,i-cfg.lookback+1),i+1), s=signal(history);
      if(s?.direction==='up'||s?.direction==='down'){signals++;pending={...s,signalTime:b.t};}else if(s?.reason){rejections[s.reason]=(rejections[s.reason]||0)+1;}
    }
  }
  const wins=trades.filter(t=>t.net>0), losses=trades.filter(t=>t.net<0);
  const profit=wins.reduce((s,t)=>s+t.net,0), loss=-losses.reduce((s,t)=>s+t.net,0);
  const start=rows[startIndex];
  const years=(rows.at(-1).t-start.t)/(365.25*86400000);
  const annualizedReturn=years>0?(cash>0?Math.expm1(Math.log(cash/cfg.capital)/years):cash===0?-1:null):null;
  const yearly=[];let yearStart=cfg.capital;
  for(const point of equity){const year=new Date(point.t).getUTCFullYear();let bucket=yearly.at(-1);if(!bucket||bucket.year!==year){if(bucket)yearStart=bucket.endCapital;yearly.push(bucket={year,startCapital:yearStart,endCapital:yearStart,from:point.t,to:point.t,trades:0});}bucket.endCapital=point.value;bucket.to=point.t;}
  for(const bucket of yearly){bucket.return=bucket.endCapital/bucket.startCapital-1;bucket.trades=trades.filter(t=>new Date(t.exitTime).getUTCFullYear()===bucket.year).length;bucket.partial=start.t>Date.UTC(bucket.year,0,1)||bucket.from>=Date.UTC(bucket.year,0,1)+cfg.interval||bucket.to+cfg.interval<Date.UTC(bucket.year+1,0,1);}
  const completeYears=yearly.filter(y=>!y.partial);
  const averageYearlyReturn=completeYears.length?completeYears.reduce((sum,y)=>sum+y.return,0)/completeYears.length:null;
  const eligibility=gaps>0?'incomplete':completeYears.length===0?'insufficient':annualizedReturn>=.10?'pass':'fail';
  return {yearly,config:cfg,bars:rows.length,from:rows[0].t,to:rows.at(-1).t,testFrom:start.t,gaps,ambiguous,signals,skipped,rejections,trades,equity,benchmark:rows.slice(startIndex).map(b=>({t:b.t,value:cfg.capital*b.c/start.c})),summary:{annualizedReturn,averageYearlyReturn,completeYears:completeYears.length,eligibility,threshold:.10,years,finalCapital:cash,return:cash/cfg.capital-1,maxDrawdown:drawdown,trades:trades.length,winRate:trades.length?wins.length/trades.length:null,profitFactor:loss?profit/loss:null,fees:trades.reduce((s,t)=>s+t.fees,0),buyHold:rows.at(-1).c/start.c-1}};
}
module.exports={run};
if(require.main===module){let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{try{const data=JSON.parse(input);process.stdout.write(JSON.stringify(run(data.rows,data.options)))}catch(e){process.stderr.write(e.message);process.exitCode=1}})}
