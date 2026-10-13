const assert=require('node:assert/strict');
const {readJSON,clearTransientCache}=require('../assets/data.js');
const reply=(status,data)=>({status,ok:status===200,json:async()=>data});
(async()=>{
  let calls=0;
  const value=await readJSON('/api/candles',{retryDelayMs:1},async()=>{
    if(++calls===1)return reply(502,{error:'上游不可用'});
    return reply(200,{candles:[{t:1}]});
  });
  assert.equal(calls,2);assert.equal(value.candles.length,1);
  calls=0;
  await assert.rejects(readJSON('/api/auth/session',{retryDelayMs:1},async()=>{calls++;return reply(401,{error:'未登录'})}),e=>e.status===401);
  assert.equal(calls,1);
  calls=0;
  const hanging=(_url,{signal})=>new Promise((_resolve,reject)=>{
    calls++;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  await assert.rejects(readJSON('/api/candles',{timeoutMs:10,retryDelayMs:1},hanging),/网络响应超时/);
  assert.equal(calls,2);
  let release;calls=0;
  const shared=async()=>{calls++;await new Promise(r=>release=r);return reply(200,{candles:[{t:7}]})};
  const first=readJSON('/api/candles?symbol=BTC',{},shared),second=readJSON('/api/candles?symbol=BTC',{},shared);
  release();const [one,two]=await Promise.all([first,second]);assert.equal(calls,1);
  one.candles[0].t=99;assert.equal(two.candles[0].t,7);
  assert.equal((await readJSON('/api/candles?symbol=BTC',{},shared)).candles[0].t,7);assert.equal(calls,1);
  clearTransientCache();
  const renewed=readJSON('/api/candles?symbol=BTC',{},shared);release();await renewed;assert.equal(calls,2);
  calls=0;const stale=async()=>{calls++;return reply(200,{stale:true,candles:[]})};
  await readJSON('/api/candles',{},stale);await readJSON('/api/candles',{},stale);assert.equal(calls,2);
  calls=0;const uncached=async()=>{calls++;return reply(200,{ok:true})};
  await Promise.all([readJSON('/api/auth/session',{},uncached),readJSON('/api/auth/session',{},uncached)]);assert.equal(calls,2);
  await Promise.all([readJSON('/api/info',{method:'POST'},uncached),readJSON('/api/info',{method:'POST'},uncached)]);assert.equal(calls,4);
  const controller=new AbortController();calls=0;
  const canceled=readJSON('/api/info',{signal:controller.signal,timeoutMs:100,retryDelayMs:1},hanging);
  controller.abort();await assert.rejects(canceled);assert.equal(calls,1);
  calls=0;
  await readJSON('/api/candles',{retryDelayMs:1},async()=>{
    if(++calls===1)return {status:200,ok:true,json:async()=>{throw new SyntaxError()}};
    return reply(200,{candles:[]});
  });
  assert.equal(calls,2);
  console.log('Read requests: shared concurrent reads, isolated cached values, close cleanup, stale refresh, auth/write isolation, timeout/retry/abort recovery: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
