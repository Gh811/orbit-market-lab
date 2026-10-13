const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
function fn(name){let start=source.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
let saved=0;const noop=()=>{},cells=Array.from({length:5},(_,i)=>({classList:{contains:()=>false},getBoundingClientRect:()=>({left:i*100,top:0}),querySelector:()=>({style:{},animate:noop})}));
const nodes={petStage:{children:cells},petOwnName:{value:'银河小队'},petManagerMessage:{}};
const c={groups:[{id:'main',name:'自选'},{id:'ga',name:'美股',petSlot:3,petKind:7},{id:'ghot',name:'热门'},{id:'empty',name:'旧空组'}],assets:[{groupId:'main',symbol:'BTC'},{groupId:'ga',symbol:'ETH'}],SPACE_PETS:Array(8).fill({}),petDraft:null,accountUser:'alice',MAX_USER_GROUPS:5,HOT_GROUP_ID:'ghot',activeGroupId:'ga',selected:'ETH',save(){saved++},renderPets:noop,renderPetChoices:noop,renderGroupOptions:noop,renderWatch:noop,connectOkx:noop,queueMini:noop,queueProfile:noop,loadAsset:noop,assetId:a=>a.symbol,window:{matchMedia:()=>({matches:true}),MarketTouch:{pulse:noop}},$:id=>nodes[id],setPetManagerNotice(text){nodes.petManagerMessage.textContent=text},openPetManager(id,draft){c.petDraft=draft},closePetManager(){c.petDraft=null}};
vm.createContext(c);vm.runInContext(['groupDisplayName','groupNameTaken','petSlotGroups','petKindInUse','swapPetSlots','createPetAt','commitPetDraft','removePetGroup'].map(fn).join('\n'),c);
let slots=c.petSlotGroups();assert.equal(slots[0].id,'main');assert.equal(slots[3].id,'ga');assert.equal(slots.filter(Boolean).length,2);
c.swapPetSlots(0,3);assert.equal(c.groups[0].petSlot,3);assert.equal(c.groups[1].petSlot,0);assert.equal(c.groups[1].petKind,7);
c.swapPetSlots(3,4);assert.equal(c.groups[0].petSlot,4);assert.equal(c.petSlotGroups()[3],null);
const before=saved,count=c.groups.length;c.createPetAt(2);assert.equal(c.petDraft.petKind,null,'draft must not preselect any pet');assert.equal(saved,before);assert.equal(c.groups.length,count);assert.equal(c.assets.length,2);
assert.equal(c.commitPetDraft(),false);assert.equal(saved,before);c.closePetManager();assert.equal(c.assets.length,2);
c.createPetAt(2);c.petDraft.assets.push({type:'swap',symbol:'SOL'});
// 默认不预选宠物：标的和宠物没选齐时创建一律被拒（与创建按钮禁用规则一致）。
assert.equal(c.commitPetDraft(),false);assert.equal(saved,before);assert.equal(c.groups.length,count);
c.petDraft.petKind=7;assert.equal(c.commitPetDraft(),false);assert.equal(saved,before);assert.equal(c.groups.length,count);assert.equal(c.assets.length,2);c.petDraft.petKind=6;c.accountUser='bob';assert.equal(c.commitPetDraft(),false);c.accountUser='alice';assert.equal(c.commitPetDraft(),true);
const created=c.petSlotGroups()[2];assert.equal(created.petKind,6);assert.equal(c.assets.find(a=>a.symbol==='SOL').groupId,created.id);assert.equal(c.groups.length,count);assert.equal(c.petDraft,null);assert.equal(c.commitPetDraft(),false);
// 5 个分组的名字必须互不相同：显示名取 petName||name，比较忽略大小写与首尾空格；正在改名的分组自身除外。
assert.equal(c.groupNameTaken('美股',null),true);
assert.equal(c.groupNameTaken('美股',c.groups.find(g=>g.id==='ga')),false);
assert.equal(c.groupNameTaken('银河小队',null),true);
assert.equal(c.groupNameTaken(' 银河小队 ',null),true);
assert.equal(c.groupNameTaken('热门',null),true);
assert.equal(c.groupNameTaken('新星',null),false);
// 手机端创建分组撞到已有名字：提交被拒且分组/标的状态不变，提示用户换名。
nodes.petOwnName.value='银河小队';c.createPetAt(1);c.petDraft.assets.push({type:'swap',symbol:'DOGE'});c.petDraft.petKind=5;const dupGroups=c.groups.length,dupAssets=c.assets.length;assert.equal(c.commitPetDraft(),false);assert.equal(c.groups.length,dupGroups);assert.equal(c.assets.length,dupAssets);assert.equal(nodes.petManagerMessage.textContent,'名字重复');c.closePetManager();
c.removePetGroup(created.id);assert.ok(!c.assets.some(a=>a.groupId===created.id));assert.equal(c.petSlotGroups()[2],null);assert.ok(c.assets.some(a=>a.groupId==='ga'));
c.removePetGroup('main');assert.ok(c.groups.some(g=>g.id==='main'));assert.ok(!c.petSlotGroups().some(g=>g?.id==='main'));const hot=c.groups.find(g=>g.id==='ghot');c.removePetGroup('ghot');assert.ok(c.groups.includes(hot));
// Physical dragging uses an overlay, so it cannot be clipped by the original slot.
const events={},timers=new Map(),actions=[];let seq=0,ghostRemoved=0;
function actor(){return{style:{},getBoundingClientRect:()=>({left:0,top:0,width:80,height:80}),cloneNode:()=>({style:{},dataset:{},classList:{add:noop},innerHTML:'url(#space0-body)',remove(){ghostRemoved++}})}}
const slots2=Array.from({length:5},(_,i)=>({dataset:{index:String(i),groupId:i<2?'g'+i:''},classList:{add:noop,remove:noop,toggle:noop},getBoundingClientRect:()=>({left:i*100,right:i*100+90,top:0,bottom:100}),closest(selector){return selector==='.petSlot'?this:null},querySelector:()=>actor()}));
const stage={children:slots2,addEventListener:(n,f)=>events[n]=f,setPointerCapture:noop,releasePointerCapture:noop};
const g={document:{addEventListener:noop,body:{append:noop}},$:()=>stage,window:{innerWidth:428,matchMedia:()=>({matches:true}),addEventListener:noop,MarketTouch:{pulse:noop}},setTimeout(f){timers.set(++seq,f);return seq},clearTimeout(id){timers.delete(id)},restorePetDragArtwork:noop,swapPetSlots:(a,b)=>actions.push(['swap',a,b]),openPetManager:id=>actions.push(['manage',id]),openPetDeck:id=>actions.push(['deck',id]),createPetAt:i=>actions.push(['create',i])};
vm.createContext(g);vm.runInContext(fn('wirePetStage')+';wirePetStage()',g);
function event(slot,x=30){return{isPrimary:true,button:0,pointerId:1,clientX:x,clientY:30,target:slot,cancelable:true,preventDefault:noop}}
function hold(){assert.equal(timers.size,0,'a pet press must never schedule a long-press menu')}
function finishTap(){for(const [id,callback] of [...timers]){timers.delete(id);callback()}}
events.pointerdown(event(slots2[0]));hold();events.pointermove(event(slots2[0],150));events.pointerup(event(slots2[0],150));assert.deepEqual(actions.pop(),['swap',0,1]);assert.equal(ghostRemoved,1);
events.pointerdown(event(slots2[0]));hold();events.pointerup(event(slots2[0]));finishTap();assert.deepEqual(actions.pop(),['deck','g0']);
events.pointerdown(event(slots2[0]));events.pointerup(event(slots2[0]));finishTap();assert.deepEqual(actions.pop(),['deck','g0']);
events.pointerdown(event(slots2[4],430));events.pointerup(event(slots2[4],430));assert.deepEqual(actions.pop(),['create',4]);
events.pointerdown(event(slots2[0]));events.pointermove(event(slots2[0],150));events.pointercancel();events.pointerup(event(slots2[0]));assert.equal(actions.length,0);assert.equal(ghostRemoved,2);
events.pointerdown(event(slots2[0]));events.pointermove(event(slots2[0],150));events.pointermove(event(slots2[0],650));events.pointerup(event(slots2[0],650));assert.equal(actions.length,0);
// The second tap must enter editing without ever opening the viewing page.
events.pointerdown(event(slots2[0]));events.pointerup(event(slots2[0]));assert.equal(actions.length,0);
events.pointerdown(event(slots2[0]));events.pointerup(event(slots2[0]));assert.deepEqual(actions.pop(),['manage','g0']);finishTap();assert.equal(actions.length,0);
// Dragging or a cancellation after the first tap clears the deferred view action.
events.pointerdown(event(slots2[0]));events.pointerup(event(slots2[0]));events.pointercancel();finishTap();assert.equal(actions.length,0);
events.pointerdown(event(slots2[0]));events.pointerup(event(slots2[0]));events.pointerdown(event(slots2[0]));events.pointermove(event(slots2[0],150));events.pointerup(event(slots2[0],150));assert.deepEqual(actions.pop(),['swap',0,1]);finishTap();assert.equal(actions.length,0);
events.keydown({key:'F2',target:slots2[0],preventDefault:noop});assert.deepEqual(actions.pop(),['manage','g0']);
console.log('Pet controls: no empty creation, draft cancellation, account isolation, atomic creation, unique group names, character persistence, occupied/empty swaps, single tap views, double tap edits without opening cards, keyboard edit, immediate overlay drag and canceled taps: PASS');
