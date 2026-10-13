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
      if(!data?.stale&&!data?.incomplete&&!data?.refreshing){cache.values.delete(url);cache.values.set(url,{data:copy(data),t:Date.now()});if(cache.values.size>64)cache.values.delete(cache.values.keys().next().value)}
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
  return {readJSON,clearTransientCache};
});
