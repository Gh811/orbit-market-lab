// Bounded read requests; writes and authentication are never automatically replayed.
((root,factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
else root.MarketData=api})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  let readers=new WeakMap();
  const ttl=url=>/^\/api\/catalog(?:\?|$)/.test(url)?180000:/^\/api\/(?:info|logo)(?:\?|$)/.test(url)?30000:/^\/api\/candles(?:\?|$)/.test(url)?2000:/^\/api\/search(?:\?|$)/.test(url)?10000:0;
  const copy=data=>JSON.parse(JSON.stringify(data));
  function clearTransientCache(){readers=new WeakMap()}
  if(typeof window!=='undefined')window.addEventListener('pagehide',e=>{if(!e.persisted)clearTransientCache()});
  async function readJSON(url,options={},fetcher=fetch){
    const life=ttl(String(url));
    if(!life||(options.method||'GET').toUpperCase()!=='GET'||options.headers||options.body||options.signal?.aborted)return fetchJSON(url,options,fetcher);
    let cache=readers.get(fetcher);if(!cache){cache={values:new Map(),requests:new Map()};readers.set(fetcher,cache)}
    const saved=cache.values.get(url);
    if(saved&&Date.now()-saved.t<life)return copy(saved.data);
    // A caller's abort signal belongs to that caller; do not bind other readers to it.
    if(options.signal)return fetchJSON(url,options,fetcher);
    if(cache.requests.has(url))return copy(await cache.requests.get(url));
    const request=fetchJSON(url,options,fetcher).then(data=>{
      if(!data?.stale&&!data?.incomplete&&!data?.refreshing&&!data?.pending){cache.values.delete(url);cache.values.set(url,{data:copy(data),t:Date.now()});if(cache.values.size>64)cache.values.delete(cache.values.keys().next().value)}
      return data;
    }).finally(()=>cache.requests.delete(url));
    cache.requests.set(url,request);return copy(await request);
  }
  async function fetchJSON(url,options={},fetcher=fetch){
    const {timeoutMs=15000,retries=1,retryDelayMs=600,...init}=options;
    for(let attempt=0;;attempt++){
      const controller=new AbortController();
      const abort=()=>controller.abort(init.signal?.reason);
      if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetcher(url,{cache:'no-store',...init,signal:controller.signal});
        let data;
        try{data=await response.json()}catch{throw Object.assign(Error('数据响应不完整'),{status:response.ok?502:response.status||502})}
        if(!response.ok)throw Object.assign(Error(data?.error||'HTTP '+response.status),{status:response.status});
        return data;
      }catch(cause){
        if(init.signal?.aborted)throw cause;
        const transient=!cause.status||[408,429,500,502,503,504].includes(cause.status);
        if(!transient||attempt>=retries){
          if(controller.signal.aborted)throw Object.assign(Error('网络响应超时'),{status:408});
          throw cause;
        }
      }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort)}
      await new Promise(resolve=>setTimeout(resolve,retryDelayMs*(attempt+1)));
    }
  }
  function createPublicCache(storage,fallback,{maxBytes=4*1024*1024,maxItemBytes=3*1024*1024}={}){
    const prefix='orbit_public_v1:';
    const allowed=new Set(['market_profiles_v29','market_mini_cache_v1','okx_swap_catalog_v2','market_logo_cache_v7','market_candle_session_v1']);
    const owned=()=>{
      const rows=[];
      for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(prefix))continue;
        const text=storage.getItem(key)||'';let stamp=0;try{stamp=JSON.parse(text).t||0}catch{}
        rows.push({key,bytes:2*(key.length+text.length),stamp});
      }return rows.sort((a,b)=>a.stamp-b.stamp);
    };
    function setItem(key,value){
      if(!allowed.has(key)||typeof value!=='string')return false;
      const full=prefix+key;let payload={t:Date.now(),value};
      try{payload={t:Date.now(),json:true,data:JSON.parse(value)}}catch{}
      const record=JSON.stringify(payload);
      if(2*(full.length+record.length)>Math.min(maxBytes,maxItemBytes))return false;
      try{
        const rows=owned().filter(row=>row.key!==full);
        let bytes=rows.reduce((sum,row)=>sum+row.bytes,0)+2*(full.length+record.length);
        while(bytes>maxBytes&&rows.length){const old=rows.shift();storage.removeItem(old.key);bytes-=old.bytes}
        try{storage.setItem(full,record)}catch(error){
          while(rows.length){storage.removeItem(rows.shift().key);try{storage.setItem(full,record);return true}catch{}}
          throw error;
        }
        return true;
      }catch{try{fallback?.setItem(key,value);return true}catch{return false}}
    }
    function getItem(key){
      if(!allowed.has(key))return null;
      try{const raw=storage.getItem(prefix+key);if(raw){const record=JSON.parse(raw);if(record.json===true)return JSON.stringify(record.data);if(typeof record.value==='string')return record.value}}catch{}
      try{const old=fallback?.getItem(key);if(old){setItem(key,old);return old}}catch{}
      return null;
    }
    return {getItem,setItem};
  }
  function profileReady(profile){return !!profile&&!profile.incomplete&&!profile.pending&&!!String(profile.summary||'').trim()&&!/正在补全|暂未收录|暂无简介|正在读取/.test(String(profile.summary||''))}
  // Public per-asset records: inactivity eviction never removes current watchlist entries.
  function createAssetCache(storage,{maxEntries=600,maxBytes=6*1024*1024,idleDays=30,now=Date.now}={}){
    const prefix='orbit_asset_v1:',valid=id=>/^(?:swap|ashare):[A-Z0-9]{1,15}$/.test(id);
    let pins=new Set();
    function rows(){const out=[];try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(prefix))continue;try{const text=storage.getItem(key),record=JSON.parse(text);out.push({key,id:key.slice(prefix.length),record,bytes:2*(key.length+text.length)})}catch{}}}catch{}return out}
    function prune(){const all=rows(),unused=all.filter(x=>!pins.has(x.id)&&!x.record.pinned).sort((a,b)=>a.record.used-b.record.used);let count=all.length,bytes=all.reduce((n,x)=>n+x.bytes,0);
      for(const item of unused)if(now()-item.record.used>idleDays*86400000||count>maxEntries||bytes>maxBytes){try{storage.removeItem(item.key);count--;bytes-=item.bytes}catch{}}
    }
    function put(id,profile,t=now()){
      if(!valid(id)||profile?.type+':'+profile?.symbol!==id||!profileReady(profile)||profile.stale)return false;
      const record={profile,t,used:now(),pinned:pins.has(id)},text=JSON.stringify(record);
      try{storage.setItem(prefix+id,text);prune();return true}catch{return false}
    }
    function get(id){if(!valid(id))return null;try{const record=JSON.parse(storage.getItem(prefix+id)||'null');if(!record||record.profile?.type+':'+record.profile?.symbol!==id)return null;
      if(!profileReady(record.profile)){storage.removeItem(prefix+id);return null}
      if(!pins.has(id)&&!record.pinned&&now()-record.used>idleDays*86400000){storage.removeItem(prefix+id);return null}
      record.used=now();record.pinned=pins.has(id)||record.pinned;try{storage.setItem(prefix+id,JSON.stringify(record))}catch{}return record;
    }catch{return null}}
    function setPinned(ids){pins=new Set(ids.filter(valid));for(const item of rows()){item.record.pinned=pins.has(item.id);try{storage.setItem(item.key,JSON.stringify(item.record))}catch{}}prune()}
    return {get,put,setPinned,prune};
  }
  function createAssetImageCache(cacheStorage,{fetcher=fetch,origin=location.origin,now=Date.now,maxEntries=256}={}){
    let pins=new Set(),pending=new Map();
    const symbol=url=>new URL(url,origin).searchParams.get('symbol')||new URL(url,origin).pathname.split('/').at(-1).split('.')[0].toUpperCase();
    const allowed=url=>{try{const u=new URL(url,origin);return u.origin===origin&&(/^\/api\/logo-image$/.test(u.pathname)||/^\/assets\/icons\/(?:brand|okx|crypto)\/[a-z0-9-]+\.(?:png|svg)$/.test(u.pathname))}catch{return false}};
    async function prune(){try{const cache=await cacheStorage.open('orbit_asset_images_v1'),keys=await cache.keys(),rows=await Promise.all(keys.map(async key=>({key,used:Number((await cache.match(key)).headers.get('X-Orbit-Used')||0)})));let count=rows.length;
      for(const row of rows.sort((a,b)=>a.used-b.used))if(!pins.has(symbol(row.key.url))&&(now()-row.used>30*86400000||count>maxEntries)){await cache.delete(row.key);count--}
    }catch{}}
    async function get(url){if(!allowed(url))return null;if(pending.has(url))return pending.get(url);
      const work=(async()=>{try{const cache=await cacheStorage.open('orbit_asset_images_v1'),key=new URL(url,origin).href;let response=await cache.match(key);
        if(response&&!pins.has(symbol(url))&&now()-Number(response.headers.get('X-Orbit-Used'))>30*86400000){await cache.delete(key);response=null}
        if(!response){response=await fetcher(key,{credentials:'same-origin'});if(!response.ok||!/^image\//.test(response.headers.get('Content-Type')||''))return null}
        const blob=await response.blob();if(blob.size>524288)return null;
        try{await cache.put(key,new Response(blob,{headers:{'Content-Type':blob.type,'X-Orbit-Used':String(now())}}));void prune()}catch{}
        return blob;
      }catch{return null}})().finally(()=>pending.delete(url));pending.set(url,work);return work;
    }
    return {get,setPinned(symbols){pins=new Set(symbols);void prune()},prune};
  }
  function quoteSignal({online=true,liveRecent=false,reachable=false,degraded=false,cached=false,failures=0}={}){
    if(!online)return {state:'bad',text:'网络已断开'};
    if(liveRecent)return {state:'ok',text:'实时行情已连接'};
    if(reachable&&!degraded&&!cached)return {state:'ok',text:'行情服务已连接'};
    if(!reachable&&failures>=3)return {state:'bad',text:cached?'行情连接失败 · 显示缓存':'行情连接失败'};
    if(cached)return {state:'warn',text:'缓存行情 · 等待更新'};
    if(reachable||failures<3)return {state:'warn',text:'行情连接重试中'};
    return {state:'bad',text:'行情连接失败'};
  }
  return {readJSON,clearTransientCache,createPublicCache,createAssetCache,createAssetImageCache,quoteSignal,profileReady};
});
