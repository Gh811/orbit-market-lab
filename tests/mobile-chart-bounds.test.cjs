const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
class Node{
  constructor(){this.children=[];this.dataset={};this.attributes={};this.style={setProperty(){}};this.classList={contains:()=>true,toggle(){}}}
  append(...children){this.children.push(...children)}
  replaceChildren(...children){this.children=children}
  setAttribute(key,value){this.attributes[key]=value}
}
let clips=0,saves=0,repaints=0;
const paint=new Proxy({save(){saves++},restore(){saves--;assert.ok(saves>=0)},clip(){clips++},measureText:()=>({width:30})},{get:(target,key)=>target[key]||(()=>{})});
const canvas={width:0,height:0,parentElement:{clientWidth:340,clientHeight:300},getContext:()=>paint};
const nodes={chart:canvas,petDeck:new Node(),chartMetrics:new Node(),deckChartView:new Node()};
const candles=Array.from({length:100},(_,i)=>({t:Date.now()-(100-i)*900000,o:i<98?1000:100,c:i<98?1000:100,h:i<98?1001:101,l:i<98?999:99,v:10}));
const ctx=vm.createContext({$:id=>nodes[id],window:{innerWidth:428,devicePixelRatio:3},document:{createElement:()=>new Node()},
  CHART:{background:'#000',axis:'#aaa',grid:'#333',ma5:'#ff0',ma10:'#f00',ma20:'#0ff'},
  chartRows:()=>candles,viewCount:1,viewOffset:0,chartPlot:null,toggles:{ma:false,volume:true,levels:false,fib:false},
  colors:()=>({up:'#f00',down:'#0f0'}),priceLabel:String,quotes:{},current:()=>({symbol:'BTC'}),assetId:()=> 'swap:BTC',
  tf:'15m',hoveredTime:null,renderInsight(){},timeframeCache:new Map([['swap:BTC|15m',{exhausted:true}]]),historyRequests:new Set(),loadSerial:0,
  scheduleDraw(){repaints++}});
vm.runInContext(source.slice(source.indexOf('function movingAverage('),source.indexOf('function pivots(')),ctx);
vm.runInContext(source.slice(source.indexOf('const deckMaEnabled='),source.indexOf('function resetChartView()')),ctx);
for(const height of [120,180,300,600])for(const volume of [false,true]){
  canvas.parentElement.clientHeight=height;ctx.toggles.volume=volume;ctx.draw();
  const plot=ctx.chartPlot;assert.equal(plot.rows.length,8,'mobile limits extreme candle magnification');
  assert.ok(plot.top>=0&&plot.priceBottom>plot.top&&plot.priceBottom<height);
  for(const row of plot.rows)for(const price of [row.h,row.l])assert.ok(plot.y(price)>=plot.top&&plot.y(price)<=plot.priceBottom);
  for(const period of [5,10,20])for(const price of ctx.movingAverage(candles,period).slice(plot.start))assert.ok(plot.y(price)>=plot.top&&plot.y(price)<=plot.priceBottom,'enabled averages fit price area');
  assert.equal(saves,0,'canvas clipping scope restored');
}
assert.ok(clips>0);
ctx.renderDeckMa();nodes.deckMaControls=nodes.deckChartView.children[0];ctx.renderDeckMa();
assert.deepEqual(nodes.deckMaControls.children.map(button=>button.textContent),['MA5','MA10','MA20']);
assert.equal(nodes.deckMaControls.children[0].attributes['aria-pressed'],'true');
nodes.deckMaControls.children[0].onclick();assert.equal(nodes.deckMaControls.children[0].attributes['aria-pressed'],'false');assert.equal(repaints,1);
assert.equal(ctx.toggles.ma,false,'mobile buttons do not change desktop toggle');
ctx.window.innerWidth=1000;ctx.draw();assert.equal(ctx.chartPlot.rows.length,1,'desktop zoom unchanged');
assert.equal(ctx.chartPlot.top,72,'desktop compact plot spacing unchanged');assert.equal(saves,0);
console.log('Mobile chart: candles and enabled averages stay in bounds, compact heights, zoom limit, independent MA switches, desktop unchanged: PASS');
