const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Classes{constructor(){this.items=new Set()}contains(x){return this.items.has(x)}add(x){this.items.add(x)}remove(x){this.items.delete(x)}}
class Dialog{constructor(id){this.id=id;this.open=false;this.classList=new Classes();this.classList.add('mobileSheet')}close(){this.open=false}showModal(){this.open=true}querySelector(){return null}}
const deck={hidden:true,dataset:{groupId:'main',index:'0'},classList:new Classes()},manager={hidden:true,dataset:{groupId:'main'}},guide=new Dialog('petHelpDialog'),news=new Dialog('petNewsDialog'),picker={hidden:true};
const nodes={petDeck:deck,petManager:manager,petHelpDialog:guide,petNewsDialog:news,petNewsPicker:picker,petNewsList:{hidden:false},petNewsSearchButton:{hidden:false}};
for(const [id,node]of Object.entries(nodes))node.id=id;
let observer,timers=[],position=0,entries=[{}],draft={name:'before'};const events={};
const clone=x=>JSON.parse(JSON.stringify(x));
const history={get state(){return entries[position]},replaceState(s){entries[position]=clone(s)},pushState(s){entries.splice(position+1);entries.push(clone(s));position++},go(offset){position=Math.max(0,position+offset);events.popstate({state:entries[position]})},back(){if(position){position--;events.popstate({state:entries[position]})}}};
const ctx={innerWidth:390,history,performance:{now:()=>1000},setTimeout:fn=>{timers.push(fn)},HTMLDialogElement:Dialog,MutationObserver:class{constructor(fn){observer=fn}observe(){}},document:{getElementById:id=>nodes[id],body:{classList:new Classes()},querySelectorAll:()=>[],addEventListener(){}},window:{MarketDevice:{isMobile:()=>true},addEventListener:(type,fn)=>events[type]=fn}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/mobile-pages.js','utf8'),ctx);const api=ctx.window.MarketMobilePages;
api.setActions({managerDraft:()=>draft,closeManager:()=>manager.hidden=true,closeDeck:()=>deck.hidden=true,closeChart:()=>deck.classList.remove('deckChartMode'),openChart:()=>deck.classList.add('deckChartMode'),openDeck:(group,index)=>{deck.hidden=false;deck.dataset={groupId:group,index:String(index)}},openManager:(group,value)=>{manager.hidden=false;manager.dataset.groupId=group;draft=value||draft}});
const change=(node,attributeName='hidden')=>observer([{target:node,attributeName}]);
const flush=()=>{while(timers.length)timers.shift()()};
deck.hidden=false;change(deck);assert.equal(position,1);
deck.dataset.index='3';change(deck,'class');assert.equal(position,1,'swiping only updates the current page');
deck.classList.add('deckChartMode');change(deck,'class');assert.equal(position,2,'chart is a new page');
deck.dataset.index='4';change(deck,'class');assert.equal(position,2,'chart state does not add a return entry');
api.deckBack();flush();assert.equal(position,1);assert.equal(deck.classList.contains('deckChartMode'),false,'chart returns to card function');assert.equal(deck.dataset.index,'4','current selection retained within card function');
manager.hidden=false;change(manager);draft.name='edited';change(manager,'class');api.managerBack();flush();assert.equal(position,0);assert.equal(manager.hidden,true);assert.equal(deck.hidden,true,'group management is a main function and returns home');
deck.hidden=false;change(deck);
guide.showModal();change(guide,'open');assert.equal(position,2);deck.dataset.index='5';change(deck,'class');assert.equal(position,2,'dialog source changes do not create an operation history');api.back();flush();change(guide,'open');assert.equal(guide.open,false);assert.equal(position,0);assert.equal(deck.hidden,true,'guide returns home rather than its last operation');
news.showModal();change(news,'open');const start=position;picker.hidden=false;change(picker);assert.equal(position,start,'news search is an operation within the news function');api.back();flush();change(news,'open');assert.equal(news.open,false);assert.equal(position,0,'news returns straight home from its picker');
console.log('Function return PASS: card/form operations stay within their function; news search and guide return directly home');

const personal=new Dialog('authDialog'),password=new Dialog('mobilePasswordPage'),lore=new Dialog('petLoreDialog'),world=new Dialog('petWorldDialog'),period=new Dialog('deckPeriodDialog');Object.assign(nodes,{authDialog:personal,mobilePasswordPage:password,petLoreDialog:lore,petWorldDialog:world,deckPeriodDialog:period});
personal.showModal();change(personal,'open');password.showModal();change(password,'open');api.back();flush();change(password,'open');assert.equal(password.open,false);assert.equal(personal.open,true,'password returns to personal feature');api.back();flush();change(personal,'open');assert.equal(position,0);
lore.showModal();change(lore,'open');world.showModal();change(world,'open');api.back();flush();change(world,'open');assert.equal(world.open,false);assert.equal(lore.open,true,'companion archive returns to library');period.showModal();change(period,'open');const before=position;api.back();flush();change(period,'open');assert.equal(position,before,'operation overlay creates no page history');assert.equal(lore.open,true);api.back();flush();change(lore,'open');assert.equal(position,0,'library returns home');
assert.equal(api.pageDirectory.petNewsDialog.parent,'home');assert.equal(api.pageDirectory.petWorldDialog.parent,'petLoreDialog');assert.equal(api.pageDirectory['more:settings'].parent,'mobileMoreDialog');
console.log('Directory PASS: top-level functions return home; password/archive return to declared parent; operations do not create pages');
