const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../assets/app.js'),'utf8');
const body=source.slice(source.indexOf('function renderDeckPrice('),source.indexOf('function updateDeckLive(){'));
const quotes={},timeframeCache=new Map(),a={type:'swap',symbol:'BTC'},key='swap:BTC';
const node={dataset:{},children:[],set textContent(v){this.text=v;this.children=[]},append(n){this.children.push(n)}};
const context={quotes,timeframeCache,assetId:a=>a.type+':'+a.symbol,fmt:v=>Number.isFinite(v)?'$'+v:'—',document:{createElement:()=>({})}};
vm.createContext(context);vm.runInContext(body,context);
const render=(period,rows)=>context.renderDeckPrice(a,period,node,rows);
timeframeCache.set(key+'|15m',{rows:[{c:60000}]});
render('15m');assert.equal(node.text,'$60000');assert.equal(node.children[0].textContent,'K 线价格');
render('1h');assert.equal(node.text,'—','never reuse another period for fallback');
render('1h',[{c:61000}]);assert.equal(node.text,'$61000','asynchronously loaded chart immediately supplies price');
quotes[key]={p:62000};render('1h',[{c:61000}]);assert.equal(node.text,'$62000');assert.equal(node.children.length,0,'quote replaces candle price and removes fallback label');
quotes[key]={p:NaN};render('1h',[{c:61000}]);assert.equal(node.text,'$61000','invalid quote does not hide a valid close');
render('1h',[{c:0}]);assert.equal(node.text,'—','invalid candles stay unavailable');
console.log('Card price fallback: matching period, async bars, quote takeover, invalid values PASS');

timeframeCache.set(key+'|1h',{rows:[{t:2000,c:64000,confirmed:false}],fetchedAt:3000});quotes[key]={p:63000,t:1000};render('1h');assert.equal(node.text,'$64000','older quote cannot overwrite a newer candle');quotes[key]={p:65000,t:4000};render('1h');assert.equal(node.text,'$65000','new quote takes over');
