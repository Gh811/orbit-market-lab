const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const start=source.indexOf('let infoPreviewRequest=0;'),end=source.indexOf('\nfunction renderInfo()',start);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
function fixture(){
 const profile=deferred(),classes=new Set();let opened=0,renders=0,forced=false;
 const button={classList:{add:s=>classes.add(s),remove:s=>classes.delete(s)},closest:()=>null};
 const c={accountSpace:'alice',petDeckGroup:'g',petDeckIndex:0,petManagerEpoch:1,petManagerGroup:null,profiles:{},profileErrorUntil:{},infoPreviewAsset:null,
 window:{MarketDevice:{isMobile:()=>true}},assetId:a=>a.symbol,
 loadProfile:async(a,force)=>{forced=force;await profile.promise;c.profiles[a.symbol]={symbol:a.symbol}},
 $:id=>id==='deckCard'?{querySelector:()=>button}:{},renderInfo(){renders++},openDetailDialog(){opened++}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function assetMarketType('),source.indexOf('const ASHARE_PERIODS='))+source.slice(start,end),c);
 return{c,profile,classes,opened:()=>opened,renders:()=>renders,forced:()=>forced};
}
class Node{constructor(){this.children=[]}replaceChildren(){this.children=[]}append(...children){this.children.push(...children)}get childElementCount(){return this.children.length}}
(async()=>{
 for(const symbol of ['TRUMP','XAU','BTC']){
  const f=fixture(),pending=f.c.openInfoForPreview({type:'swap',symbol,name:symbol});
  assert.equal(f.opened(),1,symbol+' opens before slow profile request completes');assert.equal(f.c.infoPreviewAsset.symbol,symbol);assert.ok(f.classes.has('deckInfoLoading'));
  f.profile.resolve();await pending;assert.equal(f.opened(),1);assert.equal(f.renders(),2);assert.equal(f.classes.size,0);
 }
 const changed=fixture(),old=changed.c.openInfoForPreview({type:'swap',symbol:'TRUMP'});changed.c.petDeckIndex=1;changed.profile.resolve();await old;assert.equal(changed.renders(),1,'changed source cannot refresh an obsolete preview');
 const closed=fixture(),closing=closed.c.openInfoForPreview({type:'swap',symbol:'XAU'});closed.c.infoPreviewAsset=null;closed.profile.resolve();await closing;assert.equal(closed.renders(),1,'late response cannot repaint a closed preview');
 const failed=fixture(),failure=failed.c.openInfoForPreview({type:'swap',symbol:'TRUMP'});failed.profile.reject(Error('offline'));await failure;assert.equal(failed.opened(),1);assert.ok(failed.c.profileErrorUntil.TRUMP>Date.now());assert.equal(failed.classes.size,0);
 const retry=fixture();retry.c.profileErrorUntil.XAU=Date.now()+30000;const retried=retry.c.openInfoForPreview({type:'swap',symbol:'XAU'});assert.equal(retry.opened(),1);assert.equal(retry.forced(),true,'explicit logo tap bypasses error cooldown');retry.profile.resolve();await retried;
 // Render the actual fallback page and exercise its retry action without a fetched profile.
 const box=new Node(),infoSource={},asset={type:'swap',symbol:'XAU',name:'黄金'};let reloads=0;
 const c={infoPreviewAsset:asset,current:()=>asset,profiles:{},instrumentCatalog:[{symbol:'XAU',name:'黄金',instId:'XAU-USDT-SWAP'}],profileErrorUntil:{'swap:XAU':Date.now()+30000},assetId:a=>a.type+':'+a.symbol,$:id=>id==='assetInfo'?box:infoSource,document:{createElement:()=>new Node()},logoFor:()=>new Node(),loadProfile(a,force){assert.equal(a.symbol,'XAU');assert.equal(force,true);reloads++}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const ASHARE_PERIODS='),source.indexOf('function priceText(')),c);vm.runInContext(source.slice(source.indexOf('function infoMetric('),source.indexOf('function openInfoFor('))+source.slice(source.indexOf('function renderInfo()'),source.indexOf('async function loadProfile(')),c);c.renderInfo();
 assert.equal(box.children[0].children[1].children[1].textContent,'XAU');assert.match(infoSource.textContent,/详细资料暂不可用/);const about=box.children[1];assert.match(about.children[1].textContent,/重试/);assert.equal(about.children[2].textContent,'重试加载资料');about.children[2].onclick();assert.equal(reloads,1);assert.match(infoSource.textContent,/正在补全/);
 console.log('Mobile Logo info: TRUMP/XAU/BTC open immediately, async completion, closed/source guards, failed request fallback, explicit retry bypasses cooldown PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
