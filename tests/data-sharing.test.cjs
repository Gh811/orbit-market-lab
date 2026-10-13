const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const start=source.indexOf('function fetchTimeframe(a,period)');
const end=source.indexOf('function prefetchTimeframes',start);
let calls=0,fail=false,stale=false;
const rows=[{t:1,c:2}];
const c={Date,encodeURIComponent,timeframeRequests:new Map(),timeframeCache:new Map(),
  assetId:a=>'swap:'+a.symbol,validBars:rows=>rows,
  api:async()=>{calls++;await new Promise(r=>setTimeout(r,5));if(fail)throw Error('offline');return {candles:rows,stale}},
  rememberTimeframe(a,tf,rows,fetchedAt=Date.now()){c.timeframeCache.set(c.assetId(a)+'|'+tf,{rows,fetchedAt})}};
vm.createContext(c);vm.runInContext(source.slice(start,end),c);
(async()=>{
  await Promise.all([c.loadDailyBars({type:'swap',symbol:'BTC'}),c.loadDailyBars({type:'swap',symbol:'BTC'})]);
  assert.equal(calls,1);assert.equal(c.timeframeRequests.size,0);
  await c.loadDailyBars({type:'swap',symbol:'BTC'});assert.equal(calls,1);
  await c.loadDailyBars({type:'swap',symbol:'ETH'});assert.equal(calls,2);
  c.timeframeCache.get('swap:BTC|1d').fetchedAt=0;fail=true;
  const fallback=await c.loadDailyBars({type:'swap',symbol:'BTC'});
  assert.equal(fallback.stale,true);assert.equal(fallback.candles,rows);assert.equal(c.timeframeRequests.size,0);
  await assert.rejects(c.loadDailyBars({type:'swap',symbol:'SOL'}),/offline/);
  fail=false;stale=true;
  await c.loadDailyBars({type:'swap',symbol:'SOL'});
  assert.equal(c.timeframeCache.get('swap:SOL|1d').fetchedAt,0,'stale data is never marked fresh');
  console.log('Shared daily bars: concurrent deduplication, fresh reuse, asset isolation, cached offline fallback, failed request released, stale timestamp preserved: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
