const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const timers=[],posts=[];let release;
const c={accountUser:'alice',accountSpace:'alice',assetId:a=>a.type+':'+a.symbol,setTimeout(fn){timers.push(fn);return 1},postApi:async(url,body)=>{posts.push({url,body});if(release)await new Promise(r=>release=r)},instrumentCatalog:[],rememberAssetLogos(){},matchCatalog:()=>[]};
vm.createContext(c);vm.runInContext(s.slice(s.indexOf('let assetDiscoveryTimer='),s.indexOf('\nfunction bindMobileAssetSearch',s.indexOf('let assetDiscoveryTimer='))),c);
(async()=>{
 const items=Array.from({length:45},(_,i)=>({type:'ashare',symbol:'SH'+i}));c.recordDiscoveredAssets(items);c.recordDiscoveredAssets(items);assert.equal(timers.length,1);
 await timers.shift()();assert.equal(posts[0].body.items.length,30);assert.equal(timers.length,1);await timers.shift()();assert.equal(posts[1].body.items.length,15);assert.equal(timers.length,0);
 c.recordDiscoveredAssets([{type:'swap',symbol:'BTC'}]);c.accountSpace='bob';await timers.shift()();assert.equal(posts.length,2,'old-account results are not posted');
 c.matchCatalog=()=>[{type:'swap',symbol:'ETH'}];const results=c.mobileAssetMatches('ETH');assert.equal(results[0].symbol,'ETH','matching stays synchronous');assert.equal(posts.length,2);await timers.shift()();assert.equal(posts[2].body.items[0].symbol,'ETH');
 console.log('Progressive discovery: synchronous matching, debounced deduplication, complete batch draining and account isolation PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
