const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
class Element{
  constructor(){this.children=[];this.dataset={};this.style={};this.classList={add(){},remove(){}}}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n)}}
  prepend(n){n.remove();n.parentNode=this;this.children.unshift(n)}
  remove(){if(this.parentNode){const p=this.parentNode;p.children.splice(p.children.indexOf(this),1);this.parentNode=null}}
  insertBefore(n,target){n.remove();n.parentNode=this;this.children.splice(this.children.indexOf(target),0,n)}
  before(n){this.parentNode.insertBefore(n,this)}
  after(n){const p=this.parentNode,next=this.nextSibling;if(next)p.insertBefore(n,next);else p.append(n)}
  replaceWith(n){this.before(n);this.remove()}
  replaceChildren(){for(const n of [...this.children])n.remove()}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null}
  querySelectorAll(){return this.children.filter(n=>n.dataset.watchId)}
  querySelector(selector){return this.children.find(n=>'.'+n.className===selector)||null}
  setAttribute(){} removeAttribute(){this.style={}} focus(){} setPointerCapture(){} releasePointerCapture(){}
  closest(){return scroller}
  getBoundingClientRect(){const index=this.parentNode?.children.indexOf(this)||0;return{left:18,top:100+index*60,bottom:160+index*60,width:392,height:60}}
}
const box=new Element(),scroller=new Element(),body=new Element(),nodes={petOwnHoldings:box,petOwnCount:new Element(),petManagerMessage:new Element()};
scroller.scrollTop=0;scroller.getBoundingClientRect=()=>({top:60,bottom:800});
const a={groupId:'g',type:'swap',symbol:'BTC',pinned:false},b={groupId:'g',type:'swap',symbol:'ETH',pinned:true},d={groupId:'g',type:'swap',symbol:'SOL',pinned:false},other={groupId:'other',type:'swap',symbol:'BTC'};
let saved=0,approval,confirmation,deleted=[],removedGroups=[];const events={};
const c={groups:[{id:'g',name:'自选',petName:'我的伙伴'}],assets:[a,other,b,d],petDraft:null,petManagerGroup:'g',petManagerSerial:0,petManagerEpoch:1,accountSpace:'alice',petDeckGroup:'g',petHoldingsDragCancel:null,HOT_GROUP_ID:'hot',MAX_GROUP_ASSETS:50,
  $:id=>nodes[id],watchId:a=>a.groupId+'|'+a.type+':'+a.symbol,logoFor:()=>new Element(),
  document:{body,createElement:()=>new Element(),addEventListener(){},removeEventListener(){}},
  window:{innerWidth:428,MarketTouch:{pulse(){}},addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]},
  save(){saved++},renderPets(){},renderWatch(){},renderPetPouch(){},searchPetAssets(){},
  confirmGroupAction(...args){confirmation=args;return new Promise(resolve=>approval=resolve)},
  removePetGroup(id){removedGroups.push(id);c.assets=c.assets.filter(a=>a.groupId!==id)},
  removeWatchAsset(id){deleted.push(id);c.assets=c.assets.filter(a=>c.watchId(a)!==id)},
  requestAnimationFrame(){return 1},cancelAnimationFrame(){},setTimeout(){}};
vm.createContext(c);vm.runInContext(['petManagedAssets','petManagedGroup','renderPetHoldings','removePetPouchAsset','persistPetHoldingsOrder','startPetHoldingsDrag','deckMembers'].map(fn).join('\n'),c);
const order=()=>Array.from(c.deckMembers(),a=>a.symbol);
const rowFor=s=>box.children.find(n=>n.dataset.watchId?.endsWith(':'+s));
const handleFor=s=>rowFor(s).children[2].children[0];
const removeFor=s=>rowFor(s).children[2].children[1];
const pointer=(y=120)=>({isPrimary:true,button:0,pointerId:7,clientY:y,cancelable:true,preventDefault(){}});
(async()=>{
  c.renderPetHoldings();assert.equal(handleFor('BTC').className,'petOwnDrag');assert.equal(removeFor('BTC').className,'petOwnDelete');
  c.startPetHoldingsDrag(pointer(),rowFor('BTC'),handleFor('BTC'));
  events.pointermove(pointer(600));events.pointerup(pointer(600));
  assert.deepEqual(order(),['ETH','SOL','BTC']);assert.equal(saved,1);assert.equal(c.assets[1],other);assert.equal(b.pinned,true);
  c.startPetHoldingsDrag(pointer(),rowFor('ETH'),handleFor('ETH'));
  events.pointermove(pointer(600));events.pointercancel(pointer(600));
  assert.deepEqual(order(),['ETH','SOL','BTC']);assert.equal(saved,1);assert.equal(c.petHoldingsDragCancel,null);
  assert.deepEqual(box.querySelectorAll().map(n=>n.dataset.watchId.split(':')[1]),order());
  // Invalid, duplicate or cross-group rows cannot overwrite a group's saved order.
  const bogus=new Element();bogus.dataset.watchId=c.watchId(other);box.append(bogus);c.persistPetHoldingsOrder('g');assert.equal(saved,1);bogus.remove();
  const btcRow=rowFor('BTC'),original=btcRow.dataset.watchId;btcRow.dataset.watchId=c.watchId(b);c.persistPetHoldingsOrder('g');assert.equal(saved,1);btcRow.dataset.watchId=original;
  const staleDelete=removeFor('ETH').onclick;
  await removeFor('BTC').onclick();assert.deepEqual(deleted,['g|swap:BTC']);assert.ok(c.assets.includes(other));
  c.petManagerGroup='other';await staleDelete();assert.deepEqual(deleted,['g|swap:BTC'],'old manager button cannot remove after switching groups');
  c.petManagerGroup='g';c.renderPetHoldings();await removeFor('ETH').onclick();await removeFor('SOL').onclick();
  assert.equal(c.petManagedAssets().length,0);assert.deepEqual(removedGroups,[],'empty pouch preserves group identity');assert.ok(c.groups.some(g=>g.id==='g'));assert.ok(c.assets.includes(other));
  console.log('Pet holdings: drag order matches mobile cards, cancel restores order without saving, other groups and pin flags preserved, invalid order rejected, deletion requires confirmation, cancel and changed group never delete: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
