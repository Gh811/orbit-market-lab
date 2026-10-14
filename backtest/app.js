 'use strict';
const $=id=>document.getElementById(id),pct=n=>n==null?'—':(n*100).toFixed(2)+'%',money=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2}),time=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
let current=null,shown=0,strategies=[],researchSettings=null;
function renderFixedSetup(){if(!researchSettings)return;const {fixed,plan}=researchSettings;const option=strategies.find(s=>s.value===$('strategy').value),parts=(option?.value||'').split(':');const rows=[['初始资金',money(plan.capital)+' USDT'],['标的 / 周期',(parts[1]||plan.symbols.join('、'))+' · '+(parts[2]||plan.tf)],['单笔风险',pct(fixed.risk)],['单边手续费',pct(fixed.fee)],['单边滑点',pct(fixed.slip??fixed.slippage)],['执行方式','收盘确认 · 下一根开盘'],['预热 K线',fixed.warmup+' 根'],['回测范围','已有完整历史']];$('fixedSetup').replaceChildren();for(const [label,value] of rows){const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;cell.append(dt,dd);$('fixedSetup').append(cell)}}
$('strategy').addEventListener('change',renderFixedSetup);
const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&window.parent!==window;
if(embedded)document.documentElement.classList.add('researchEmbedded');
const integrated=location.pathname.startsWith('/backtest/'),api=integrated?'/api/backtest':'/api';
function signalResearchReady(){document.documentElement.dataset.researchReady='true';if(embedded)window.parent.postMessage({type:'orbit-research-ready'},location.origin)}
async function json(url,options){const response=await fetch(url,options);const body=await response.json();if(!response.ok)throw Error(body.error||'加载失败');return body}
json(api+'/catalog').then(data=>{
 researchSettings=data;strategies=data.strategies;$('strategy').replaceChildren();
 for(const s of strategies){const option=document.createElement('option');option.value=s.value;option.textContent=s.label;$('strategy').append(option)}
 const empty=strategies.length===0;if(empty){const option=document.createElement('option');option.textContent='暂无年化 ≥10% 的策略';option.value='';$('strategy').append(option)}
 renderFixedSetup();$('strategy').disabled=empty;$('run').disabled=empty;$('status').textContent=empty?'当前没有达标策略。':'选择策略后点击运行。';
 $('dataCounts').replaceChildren();for(const c of data.counts){const span=document.createElement('span');span.textContent=c.symbol+' · '+money(c.confirmed)+' 根已收盘 K线';$('dataCounts').append(span)}
 signalResearchReady();
}).catch(error=>{$('strategy').options[0].textContent=error.message.includes('登录')?'请先登录':'加载失败';$('status').textContent=error.message.includes('登录')?'返回星轨登录后使用。':error.message;signalResearchReady()});
function addTrades(){const size=matchMedia('(max-width:700px)').matches?20:100,slice=current.trades.slice(shown,shown+size);for(const t of slice){const tr=document.createElement('tr');for(const value of [t.symbol,t.direction==='up'?'做多':'做空',time(t.entryTime),time(t.exitTime),money(t.entry),money(t.exit),money(t.net),money(t.fees),t.reason]){const td=document.createElement('td');td.textContent=value;tr.append(td)}tr.children[6].className=t.net>=0?'positive':'negative';$('trades').append(tr)}shown+=slice.length;$('more').hidden=shown>=current.trades.length}
$('more').onclick=addTrades;
$('form').onsubmit=async event=>{
 event.preventDefault();if(!strategies.some(s=>s.value===$('strategy').value))return;
 const strategy=$('strategy').value;$('run').disabled=true;$('strategy').disabled=true;$('export').disabled=true;$('result').hidden=true;current=null;$('status').classList.add('busy');$('status').textContent='正在运行策略…';
 try{
  const suite=await runResearch(strategy),lead=suite.results[0];current={...lead,benchmark:lead.benchmark,trades:suite.results.flatMap(r=>r.trades.map(t=>({...t,symbol:r.symbol}))).sort((a,b)=>a.exitTime-b.exitTime)};
  $('resultTitle').textContent=strategies.find(s=>s.value===strategy).label;$('qualification').textContent=suite.qualified?'年化达标':'未达标';$('qualification').className='qualification'+(suite.qualified?' pass':'');
  $('metrics').replaceChildren();for(const r of suite.results)for(const [label,value] of [[r.symbol+' · 总收益',money(r.summary.finalCapital-r.config.capital)+' USDT'],[r.symbol+' · 总收益率',pct(r.summary.return)],[r.symbol+' · 年化收益率',pct(r.summary.annualizedReturn)]]){const div=document.createElement('div');div.className='metric';const span=document.createElement('span'),strong=document.createElement('strong');span.textContent=label;strong.textContent=value;div.append(span,strong);$('metrics').append(div)}
  $('coverage').textContent=lead.symbol+' · '+lead.tf+' · '+new Date(lead.testFrom).toLocaleDateString('zh-CN')+'—'+new Date(lead.to).toLocaleDateString('zh-CN');
  $('yearly').replaceChildren();for(const r of suite.results)for(const y of r.yearly){const card=document.createElement('div');card.className='yearCard';const label=document.createElement('span'),value=document.createElement('strong');label.className='yearLabel';label.textContent=r.symbol+' · '+y.year+(y.partial?'（非全年）':'');value.textContent=pct(y.return);value.className=y.return>=0?'positive':'negative';card.append(label,value);$('yearly').append(card)}
  renderChart(current);$('trades').replaceChildren();shown=0;addTrades();$('result').hidden=false;$('result').scrollIntoView({behavior:'smooth',block:'start'});$('status').textContent='计算完成。';
 }catch(error){$('status').textContent='策略运行失败：'+error.message}
 finally{$('status').classList.remove('busy');$('run').disabled=false;$('strategy').disabled=false;$('export').disabled=!current}
};
async function runResearch(strategy){
 if(!integrated)return json(api+'/run?'+new URLSearchParams({strategy}));
 const job=await json(api+'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy})});const start=Date.now();
 for(let i=0;i<150;i++){await new Promise(resolve=>setTimeout(resolve,1000));const state=await json(api+'/jobs/'+job.id);if(state.status==='complete')return state.result;if(state.status==='failed')throw Error(state.error||'本机计算失败');$('status').textContent='本机计算中 · 已等待 '+Math.floor((Date.now()-start)/1000)+' 秒'}
 throw Error('计算时间较长，请稍后重试');
}
$('export').onclick=()=>{if(!current)return;const rows=[['symbol','direction','signal_time','entry_time','exit_time','entry','exit','stop','target','quantity','fees','net','reason'],...current.trades.map(t=>[t.symbol,t.direction,new Date(t.signalTime).toISOString(),new Date(t.entryTime).toISOString(),new Date(t.exitTime).toISOString(),t.entry,t.exit,t.stop,t.target,t.qty,t.fees,t.net,t.reason])];const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='BTC-ETH-'+$('strategy').value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
function renderChart(data){
 const chartWidth=matchMedia('(max-width:700px)').matches?400:900,left=50,right=chartWidth-20,plotWidth=right-left;$('chart').setAttribute('viewBox','0 0 '+chartWidth+' 250');
 const e=data.equity,reference=data.benchmark||[],all=[...e,...reference].map(p=>p.value),lo=Math.min(...all),hi=Math.max(...all),range=Math.max(hi-lo,1),start=e[0].t,end=e.at(-1).t;
 const x=t=>left+(t-start)/Math.max(1,end-start)*plotWidth,y=v=>205-(v-lo)/range*175;
 const sampled=rows=>rows.filter((_,i)=>i%Math.max(1,Math.ceil(rows.length/1200))===0||i===rows.length-1);
 const line=rows=>sampled(rows).map(p=>x(p.t).toFixed(2)+','+y(p.value).toFixed(2)).join(' ');
 const strategy=line(e),benchmark=line(reference),grid=[0,1,2,3].map(i=>{const yy=30+i*175/3,value=hi-i*range/3;return '<line x1="'+left+'" x2="'+right+'" y1="'+yy+'" y2="'+yy+'" stroke="#a7ccd416"/><text x="6" y="'+(yy+4)+'" fill="#8ba8b8" font-size="11">'+Math.round(value).toLocaleString()+'</text>'}).join('');
 $('chart').innerHTML='<defs><linearGradient id="curveFill" x2="0" y2="1"><stop stop-color="#79e9d1" stop-opacity=".3"/><stop offset="1" stop-color="#79e9d1" stop-opacity="0"/></linearGradient></defs>'+grid+'<polygon points="'+left+',205 '+strategy+' '+right+',205" fill="url(#curveFill)"/><polyline points="'+benchmark+'" fill="none" stroke="#bdacdf" stroke-opacity=".7" stroke-width="1.8" stroke-dasharray="5 5"/><polyline points="'+strategy+'" fill="none" stroke="#8be7d4" stroke-width="2.5"/><text x="'+left+'" y="237" fill="#8ba8b8" font-size="11">'+new Date(start).toLocaleDateString('zh-CN')+'</text><text x="'+right+'" y="237" text-anchor="end" fill="#8ba8b8" font-size="11">'+new Date(end).toLocaleDateString('zh-CN')+'</text><line id="chartCursor" y1="25" y2="210" stroke="#e4e7be" visibility="hidden"/>';
 $('chart').onpointermove=event=>{const bounds=$('chart').getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((event.clientX-bounds.left)/bounds.width*chartWidth-left)/plotWidth)),t=start+(end-start)*fraction;let a=0,b=e.length-1;while(a<b){const m=Math.floor((a+b)/2);if(e[m].t<t)a=m+1;else b=m}const point=e[a],cursor=document.getElementById('chartCursor');cursor.setAttribute('x1',x(point.t));cursor.setAttribute('x2',x(point.t));cursor.setAttribute('visibility','visible');$('chartReadout').textContent=time(point.t)+' · '+money(point.value)+' USDT'};
}

let chartResize;window.addEventListener('resize',()=>{clearTimeout(chartResize);if(current)chartResize=setTimeout(()=>{if(current)renderChart(current)},150)});

// A single return keeps repeated taps from walking out of the application.
let returningHome=false,returnFallback=null;
window.addEventListener('pagehide',()=>clearTimeout(returnFallback));
window.addEventListener('pageshow',()=>{returningHome=false;clearTimeout(returnFallback);$('researchBack').removeAttribute('aria-disabled');$('researchBack').blur()});
$('researchBack').addEventListener('click',event=>{
 if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 event.preventDefault();if(embedded){const dialog=parent.document.getElementById('researchDialog');parent.MarketMobilePages?.closeLocalDialog(dialog);return;}if(returningHome)return;returningHome=true;
 $('researchBack').setAttribute('aria-disabled','true');$('researchBack').blur();
 let previous;try{previous=new URL(document.referrer)}catch{}
 if(history.length>1&&previous?.origin===location.origin&&['/','/index.html'].includes(previous.pathname)){
  returnFallback=setTimeout(()=>location.replace('/'),1200);
  history.back();
 }else location.replace('/');
});
