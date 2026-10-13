// Exercise the page-history bridge without a browser or live account.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const listeners=new Map(),documentListeners=new Map(),entries=[];
let cursor=-1,observer,chart=false;
const deck={hidden:true,dataset:{groupId:'main'},classList:{contains:()=>chart}};
class Dialog{constructor(){this.id='infoDialog';this.open=false;this.classList={contains:()=>false}}querySelector(){return {}}close(){this.open=false}}
const info=new Dialog();
const manager={hidden:true,dataset:{groupId:'main'}};let draft=null;
const document={body:{},getElementById:id=>id==='petDeck'?deck:id==='infoDialog'?info:id==='petManager'?manager:null,querySelectorAll:()=>[],addEventListener(name,callback){documentListeners.set(name,callback)}};
const context={innerWidth:428,document,HTMLDialogElement:Dialog,Element:class{},setTimeout,clearTimeout,performance,Math,JSON};
context.window=context;
context.addEventListener=(name,callback)=>listeners.set(name,callback);
context.MutationObserver=class{constructor(callback){observer=callback}observe(){}};
context.history={
  get state(){return entries[cursor]||null},
  replaceState(state){if(cursor<0)cursor=0;entries[cursor]=state},
  pushState(state){entries.splice(cursor+1);entries.push(state);cursor++},
  back(){if(cursor>0){cursor--;listeners.get('popstate')({state:entries[cursor]})}},
  forward(){if(cursor+1<entries.length){cursor++;listeners.get('popstate')({state:entries[cursor]})}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/mobile-pages.js'),'utf8'),context);
const api=context.MarketMobilePages;
api.setActions({openDeck(){deck.hidden=false;chart=false},closeDeck(){deck.hidden=true;chart=false},openChart(){chart=true},closeChart(){chart=false},managerDraft:()=>draft,openManager(group,value){manager.hidden=false;manager.dataset.groupId=group;draft=value},closeManager(){manager.hidden=true;draft=null}});
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
(async()=>{
  deck.hidden=false;api.prepareDialog();
  info.open=true;observer([{target:info,attributeName:'open'}]);
  assert.equal(context.history.state.orbitMobilePage.route.id,'infoDialog');
  api.back();await settle();assert.equal(info.open,false);assert.equal(deck.hidden,false);assert.equal(chart,false);
  observer([]);
  chart=true;observer([]);
  assert.equal(entries.length,3);
  assert.equal(context.history.state.orbitMobilePage.route.kind,'chart');
  api.back();await settle();assert.equal(deck.hidden,false);assert.equal(chart,false);
  api.back();await settle();assert.equal(deck.hidden,true);
  context.history.forward();await settle();assert.equal(deck.hidden,false);assert.equal(chart,false);
  context.history.forward();await settle();assert.equal(chart,true);
  manager.hidden=false;manager.dataset.groupId='ga';observer([]);
  assert.equal(context.history.state.orbitMobilePage.route.kind,'manager');
  api.back();await settle();assert.equal(manager.hidden,true);assert.equal(chart,true);
  context.history.forward();await settle();assert.equal(manager.hidden,false);assert.equal(manager.dataset.groupId,'ga');assert.equal(chart,true);
  info.open=true;observer([{target:info,attributeName:'open'}]);api.back();await settle();
  assert.equal(info.open,false);assert.equal(manager.hidden,false);assert.equal(manager.dataset.groupId,'ga');assert.equal(chart,true);
  api.back();await settle();api.back();await settle();api.back();await settle();assert.equal(deck.hidden,true);
  manager.hidden=false;manager.dataset.groupId='draft';draft={id:'draft',owner:'alice',assets:[{symbol:'BTC'}]};observer([]);
  const draftEntries=entries.length;draft={...draft,assets:[{symbol:'BTC'},{symbol:'ETH'}]};observer([]);assert.equal(entries.length,draftEntries,'editing a draft replaces current history instead of adding a return destination');listeners.get('resize')();assert.equal(manager.hidden,false,'keyboard-sized mobile resize keeps manager open');

  info.open=true;observer([{target:info,attributeName:'open'}]);api.back();await settle();
  assert.equal(manager.hidden,false);assert.equal(draft.assets[0].symbol,'BTC');assert.equal(deck.hidden,true);
  api.back();await settle();assert.equal(manager.hidden,true);assert.equal(deck.hidden,true);
  deck.hidden=false;chart=false;deck.dataset.index='0';observer([]);
  const beforeSwipes=entries.length;
  for(const index of ['1','2','3']){deck.dataset.index=index;observer([])}
  assert.equal(entries.length,beforeSwipes,'swiping cards must replace the current route');
  let prevented=false,stopped=false;
  documentListeners.get('click')({target:{closest:selector=>selector==='#deckClose'?{}:null},preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});
  assert.ok(prevented&&stopped,'deck button bypasses generic browser back');
  assert.equal(deck.hidden,true,'card back exits directly without revisiting a card');
  assert.equal(context.history.state.orbitMobilePage.route.kind,'home');
  deck.hidden=false;chart=true;observer([]);api.deckBack();assert.equal(chart,false);assert.equal(deck.hidden,false,'chart back keeps the current card');
  manager.hidden=false;manager.dataset.groupId='draft';draft={id:'draft',owner:'alice',assets:[{symbol:'BTC'}]};observer([]);
  draft={...draft,assets:[{symbol:'BTC'},{symbol:'ETH'}]};observer([]);
  let managerPrevented=false,managerStopped=false;
  documentListeners.get('click')({target:{closest:selector=>selector==='.petManagerBack'?{}:null},preventDefault(){managerPrevented=true},stopImmediatePropagation(){managerStopped=true}});
  assert.ok(managerPrevented&&managerStopped,'manager return bypasses browser history');
  assert.equal(manager.hidden,true);assert.equal(deck.hidden,true);assert.equal(draft,null,'return discards the unsaved draft');
  assert.equal(context.history.state.orbitMobilePage.route.kind,'home','manager return exits to home even with a chart behind it');
  const length=entries.length;context.innerWidth=1440;chart=false;observer([]);assert.equal(entries.length,length);
  console.log('Mobile page history: chart/card/home and manager source returns, dialog source restoration, draft preservation, forward restoration, desktop no new entries: PASS');
})().catch(error=>{console.error(error);process.exit(1)});
