const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const start=source.indexOf('async function searchPetAssets()'),end=source.indexOf('\nfunction deckMembers()',start);
assert.ok(start>=0&&end>start);
class Node{constructor(){this.children=[];this.dataset={};this.hidden=false}replaceChildren(){this.children=[]}append(...items){this.children.push(...items)}}
const input={value:''},results=new Node();let requests=0,release,requestSignal,members=[],puffs=0,inserts=0,removals=0;
const c={assetId:a=>(a.type||'swap')+':'+a.symbol,petManagerGroup:'draft',petManagerOwner:'alice',accountSpace:'alice',petManagerSerial:0,petManagerEpoch:0,petSearchAbort:null,AbortController,recordSearch(){},recordDiscoveredAssets(){},petDraft:{assets:[]},MAX_GROUP_ASSETS:50,instrumentCatalog:null,assets:[],HOT_GROUP_ID:'hot',newsRecommendedAssets:()=>[],loadCatalog:async()=>{},
 $:id=>id==='petOwnSearch'?input:id==='petOwnResults'?results:{},document:{createElement:()=>new Node()},petManagedAssets:()=>members,logoFor:()=>new Node(),insertPetCard(){inserts++},showPetAlreadyAdded(){puffs++},removePetPouchAsset(){removals++},petSessionAdds:new Set(),
 api:async()=>{requests++;return{results:[{symbol:'BTC',name:'Bitcoin'}]}}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function mobileAssetMatches('),source.indexOf('async function loadCatalog(){'))+source.slice(source.indexOf('function petAssetRecommendations(){'),end),c);
(async()=>{
 await c.searchPetAssets();assert.equal(requests,0);assert.equal(results.children.length,1);assert.equal(results.hidden,false,'empty search shows recommendation heading');
 input.value='BTC';await c.searchPetAssets();assert.equal(requests,1);assert.equal(results.children[0].dataset.symbol,'BTC');assert.equal(results.hidden,false);
 members=[{symbol:'BTC'}];await c.searchPetAssets();const added=results.children[0];assert.equal(added.dataset.added,'true');assert.equal(added.disabled,false);assert.ok(added.children.some(n=>n.children.some(b=>b.textContent==='已在自选中')));added.onclick();assert.equal(puffs,1);assert.equal(inserts,0,'existing results show feedback without adding a duplicate');
 c.petSessionAdds.add('swap:BTC');await c.searchPetAssets();const fresh=results.children[0];assert.ok(fresh.children.some(n=>n.children.some(b=>b.textContent==='点一下取消')));fresh.onclick();assert.equal(removals,1,'this-session additions cancel the add on one tap');assert.equal(puffs,1,'pre-existing members still only show feedback');assert.equal(inserts,0);c.petSessionAdds.delete('swap:BTC');
 members=Array.from({length:50},(_,i)=>({symbol:i?'S'+i:'BTC'}));await c.searchPetAssets();assert.equal(results.children[0].disabled,false,'existing asset remains clickable at capacity');members=[];
 c.api=(_url,options)=>{requestSignal=options.signal;return new Promise(resolve=>release=resolve)};input.value='ETH';const pending=c.searchPetAssets();await new Promise(r=>setImmediate(r));input.value='';await c.searchPetAssets();assert.equal(requestSignal.aborted,true,'clearing input cancels the pending network request');release({results:[{symbol:'ETH',name:'Ethereum'}]});await pending;assert.equal(results.children.length,1,'cleared input keeps recommendation heading and rejects late results');
 input.value='SOL';const another=c.searchPetAssets();await new Promise(r=>setImmediate(r));c.accountSpace='bob';release({results:[{symbol:'SOL'}]});await another;assert.ok(results.hidden);assert.equal(results.children.length,0,'changed account rejects delayed search results');
 c.accountSpace='alice';c.instrumentCatalog=[{symbol:'ETH',name:'Ethereum'}];c.matchCatalog=()=>c.instrumentCatalog;
 const before=requests;input.value='E';const instant=c.searchPetAssets();
 assert.equal(results.children[0].dataset.symbol,'ETH','local candidates render during the input call before awaiting');
 await instant;assert.equal(requests,before,'local match requires no network request');
 c.petManagerGroup='existing-group';input.value='ETH';await c.searchPetAssets();assert.equal(results.children[0].dataset.symbol,'ETH','existing groups use the same immediate local matching');
 c.instrumentCatalog=null;c.api=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
 input.value='BTC';const cancelled=c.searchPetAssets();input.value='';await c.searchPetAssets();await cancelled;assert.equal(results.children[0].textContent,'热门推荐','real aborted request does not replace fresh recommendations with an error');
 c.instrumentCatalog=[{symbol:'ETH',name:'Ethereum'}];
 c.matchCatalog=()=>[];input.value='not-a-match';const unmatchedBefore=requests;await c.searchPetAssets();assert.equal(results.children[0].textContent,'没有匹配的标的');assert.equal(requests,unmatchedBefore,'a loaded catalog reports no match immediately, exactly like news');
 c.assets=[{symbol:'BTC',groupId:'hot'}];c.newsRecommendedAssets=()=>[{symbol:'BTC'},{symbol:'ETH'}];input.value='';await c.searchPetAssets();assert.equal(results.children.length,3,'hot and news recommendations merge without duplicate symbols');c.assets=[];c.newsRecommendedAssets=()=>[];
 c.matchCatalog=()=>[{type:'swap',symbol:'DSBJ',name:'东山精密'},{type:'ashare',symbol:'SZ002384',name:'东山精密'}];
 members=[{type:'swap',symbol:'DSBJ',name:'东山精密'}];input.value='东山精密';await c.searchPetAssets();
 assert.equal(results.children[0].dataset.added,'true');assert.equal(results.children[1].dataset.added,'false','same company A-share remains independently addable when its perpetual is held');
 assert.ok(results.children[1].children.some(n=>n.children.some(m=>m.textContent==='A股 · 人民币')));const additionsBefore=inserts;results.children[1].onclick();assert.equal(inserts,additionsBefore+1);members=[];
 const openStart=source.indexOf('function openPetAssetSearch(){'),openEnd=source.indexOf('\nfunction showPetNotice(',openStart);
 let catalogStarts=0;const dialog={open:false,showModal(){this.open=true}};input.focus=()=>{};
 c.$=id=>id==='petOwnSearch'?input:id==='petOwnResults'?results:id==='petAssetSearchDialog'?dialog:{};
 c.window={MarketMobilePages:{prepareDialog(){}}};c.petHoldingsDragCancel=null;c.petManagerSearchTimer=null;c.clearTimeout=()=>{};c.loadCatalog=()=>{catalogStarts++};
 vm.runInContext(source.slice(openStart,openEnd),c);input.value='OLD';c.openPetAssetSearch();
 assert.equal(input.value,'','opening starts a fresh search');assert.equal(results.children[0].textContent,'热门推荐');assert.equal(catalogStarts,1);
 console.log('Pet search: empty input shows recommendation heading without requests, typing matches, clear and account change reject late results: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
