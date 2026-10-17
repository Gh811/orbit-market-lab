// Exercise the page-history bridge without a browser or live account.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const listeners=new Map(),documentListeners=new Map(),entries=[];
let cursor=-1,observer,chart=false;
const deck={hidden:true,dataset:{groupId:'main'},classList:{contains:()=>chart}};
class Dialog{constructor(){this.id='infoDialog';this.open=false;this.classList={contains:()=>false,add(){},remove(){}}}querySelector(){return {}}close(){this.open=false}}
const info=new Dialog();
const manager={hidden:true,dataset:{groupId:'main'}};let draft=null;
const bodyClasses=new Set();
const document={body:{classList:{add:name=>bodyClasses.add(name),remove:name=>bodyClasses.delete(name)}},getElementById:id=>id==='petDeck'?deck:id==='infoDialog'?info:id==='petManager'?manager:null,querySelectorAll:()=>[],addEventListener(name,callback){documentListeners.set(name,callback)}};
const context={innerWidth:428,document,HTMLDialogElement:Dialog,Element:class{},setTimeout,clearTimeout,performance,Math,JSON};
context.window=context;
context.addEventListener=(name,callback)=>listeners.set(name,callback);
context.MutationObserver=class{constructor(callback){observer=callback}observe(){}};
context.history={
  get state(){return entries[cursor]||null},
  replaceState(state){if(cursor<0)cursor=0;entries[cursor]=state},
  pushState(state){entries.splice(cursor+1);entries.push(state);cursor++},
  go(amount){const next=Math.max(0,Math.min(entries.length-1,cursor+amount));if(next!==cursor){cursor=next;listeners.get('popstate')({state:entries[cursor]})}},
  back(){this.go(-1)},
  forward(){if(cursor+1<entries.length){cursor++;listeners.get('popstate')({state:entries[cursor]})}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/mobile-pages.js'),'utf8'),context);
const api=context.MarketMobilePages;
api.setActions({openDeck(){deck.hidden=false;chart=false},closeDeck(){deck.hidden=true;chart=false},openChart(){chart=true},closeChart(){chart=false},managerDraft:()=>draft,openManager(group,value){manager.hidden=false;manager.dataset.groupId=group;draft=value},closeManager(){manager.hidden=true;draft=null}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
(async()=>{
  deck.hidden=false;api.prepareDialog();info.open=true;observer([{target:info,attributeName:'open'}]);
  assert.equal(context.history.state.orbitMobilePage.route.id,'infoDialog');api.back();await settle();assert.equal(info.open,false);assert.equal(deck.hidden,false);
  observer([]);chart=true;observer([]);api.deckBack();await settle();assert.equal(chart,false);assert.equal(deck.hidden,false,'chart returns to its card');
  let prevented=false,stopped=false;documentListeners.get('click')({target:{closest:s=>s==='#deckClose'?{}:null},preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});await settle();
  assert(prevented&&stopped);assert.equal(deck.hidden,true);assert.equal(context.history.state.orbitMobilePage.route.kind,'home');
  manager.hidden=false;manager.dataset.groupId='draft';draft={id:'draft',owner:'alice',assets:[{symbol:'BTC'}]};observer([]);
  const count=entries.length;draft={...draft,assets:[{symbol:'BTC'},{symbol:'ETH'}]};observer([]);assert.equal(entries.length,count,'draft edits do not create return destinations');
  info.open=true;observer([{target:info,attributeName:'open'}]);api.back();await settle();assert.equal(manager.hidden,false);assert.equal(info.open,false);assert.equal(draft.assets.length,2,'child info returns to the same manager draft');
  api.back();await settle();assert.equal(manager.hidden,true);assert.equal(deck.hidden,true);assert.equal(draft,null);assert.equal(context.history.state.orbitMobilePage.route.kind,'home','manager is a top-level function and returns directly home');
  deck.hidden=false;chart=false;observer([]);const beforeSwipes=entries.length;
  for(const index of ['1','2','3']){deck.dataset.index=index;observer([])}assert.equal(entries.length,beforeSwipes,'card swipes replace their route');
  console.log('Page bridge PASS: info returns to source, chart returns to card, top-level functions return home, drafts and swipes do not add history entries');
})().catch(error=>{console.error(error);process.exit(1)});
