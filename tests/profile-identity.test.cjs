const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
function fn(name){let start=source.indexOf('function '+name+'('),depth=0;assert.ok(start>=0);if(source.slice(start-6,start)==='async ')start-=6;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
const canonical={type:'swap',symbol:'SOXS',pair:'SOXS-USDT-SWAP',name:'Direxion Semiconductor Bear 3X ETF',summary:'半导体三倍看跌 ETF。'};
function fixture(reply){
 let timerId=0,calls=0;const timers=new Map(),stored=[];
 const a={type:'swap',symbol:'SOXS',name:'SOXS'};
 const c={profiles:{},profileCachedAt:{},profileErrorUntil:{},profileLoading:new Set(),profileRetryTimers:new Map(),queuedProfile:new Set(),profileJobs:[],PROFILE_FRESH_MS:30*86400000,assetProfileCache:{get(){return null},put:(id,p)=>{if(!p.incomplete)stored.push(p)}},PROFILE_CACHE:'test-profiles',accountSpace:'alice',assets:[a],infoPreviewAsset:null,selected:'',Date,AbortController,
 assetId:x=>x.type+':'+x.symbol,document:{hidden:false},navigator:{onLine:true},
 transientCacheStorage:{setItem:(k,v)=>stored.push(v)},api:async()=>{calls++;return reply},
 setTimeout(f,ms){timers.set(++timerId,{f,ms});return timerId},clearTimeout:id=>timers.delete(id),
 scheduleWatch(){},renderInfo(){},renderHeroLogo(){},pumpBackgroundRequests(){}};
 vm.createContext(c);vm.runInContext(fn('loadProfile')+'\n'+fn('queueProfile'),c);
 return{c,a,timers,stored,calls:()=>calls};
}
(async()=>{
 const wrong=fixture({...canonical,symbol:'SOXL'});await wrong.c.loadProfile(wrong.a);assert.equal(Object.keys(wrong.c.profiles).length,0);assert.equal(wrong.stored.length,0);
 const pair=fixture({...canonical,pair:'SOXL-USDT-SWAP'});await pair.c.loadProfile(pair.a);assert.equal(pair.stored.length,0);
 const valid=fixture(canonical);await valid.c.loadProfile(valid.a);assert.equal(valid.c.profiles['swap:SOXS'].name,canonical.name);assert.equal(valid.stored.length,1);assert.equal(valid.timers.size,0);valid.c.queueProfile(valid.a);assert.equal(valid.c.profileJobs.length,0);
 const joined=fixture(canonical);let release,requests=0;joined.c.api=()=>{requests++;return new Promise(r=>release=r)};
 const first=joined.c.loadProfile(joined.a),second=joined.c.loadProfile(joined.a);assert.equal(requests,1);
 release(canonical);const results=await Promise.all([first,second]);assert.equal(results[0].symbol,'SOXS');assert.equal(results[1].symbol,'SOXS');assert.equal(joined.c.profileLoading.size,0);
 const partial=fixture({...canonical,incomplete:true,summary:'中文简介正在补全。'});await partial.c.loadProfile(partial.a);const retry=[...partial.timers.values()].find(t=>t.ms===30000);assert.ok(retry);assert.ok(Date.now()-partial.c.profileCachedAt['swap:SOXS']>3589000);
 partial.c.accountSpace='bob';retry.f();assert.equal(partial.calls(),1);
 partial.c.profileCachedAt['swap:SOXS']=Date.now()-30*86400000-1;partial.c.queueProfile(partial.a);assert.equal(partial.c.profileJobs.length,1);
 console.log('Profiles: wrong symbol/pair rejected before caching, canonical names retained, incomplete retry after 30 seconds, switched-account retry skipped, expired profiles requeued: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
