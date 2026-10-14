const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
class Node{
  constructor(){this.children=[];this.dataset={};this.style={};this.scrollLeft=0;this.scrollTop=0;this.classList={add(){},remove(){},toggle(){}}}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n)}}
  remove(){if(this.parentNode){const p=this.parentNode;p.children.splice(p.children.indexOf(this),1);this.parentNode=null}}
  before(n){const p=this.parentNode;n.remove();n.parentNode=p;p.children.splice(p.children.indexOf(this),0,n)}
  after(n){const p=this.parentNode;n.remove();n.parentNode=p;p.children.splice(p.children.indexOf(this)+1,0,n)}
  replaceChildren(){for(const n of [...this.children])n.remove()}
  querySelectorAll(s){return this.children.filter(n=>s==='.petNoticePuff'?n.className?.includes('petNoticePuff'):n.dataset.watchId)}
  querySelector(s){return this.children.find(n=>'.'+n.className===s)||null}
  setAttribute(){}removeAttribute(){}setPointerCapture(){}releasePointerCapture(){}
  cloneNode(){return new Node()}
  getBoundingClientRect(){if(!this.parentNode)return{left:0,right:350,top:100,bottom:440,width:350,height:340};const i=this.parentNode.children.indexOf(this),left=(i%5)*70,top=100+Math.floor(i/5)*82;return{left,right:left+62,top,bottom:top+74,width:62,height:74}}
}
const members=Array.from({length:50},(_,i)=>({symbol:'S'+i})),nodes=Object.fromEntries(['petPouchCards','petPouchCount','petCardPouch'].map(id=>[id,new Node()])),listeners=new Map();let saves=0;
const c={clearTimeout(){},petManagerSearchTimer:null,petManagerSerial:0,loadCatalog(){},petManagerGroup:'g',petManagerEpoch:1,accountSpace:'alice',petInsertBusy:false,petHoldingsDragCancel:null,MAX_GROUP_ASSETS:50,
  $:id=>nodes[id],currentPetPouch:()=>members,petManagedAssets:()=>members,watchId:a=>a.symbol,logoFor:()=>new Node(),document:{createElement:()=>new Node(),body:new Node()},
  window:{addEventListener(n,f){listeners.set(n,f)},removeEventListener(n,f){if(listeners.get(n)===f)listeners.delete(n)}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  persistPetHoldingsOrder(g,ids){saves++;members.sort((a,b)=>ids.indexOf(a.symbol)-ids.indexOf(b.symbol))},renderPetHoldings(){}};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('function renderPetPouch(){'),source.indexOf('async function removePetPouchAsset(')),c);
vm.runInContext(source.slice(source.indexOf('function startPetPouchDrag('),source.indexOf('async function insertPetCard(')),c);
vm.runInContext(source.slice(source.indexOf('function beginPetPouchGesture('),source.indexOf('function startPetPouchDrag(')),c);
c.renderPetPouch();const list=nodes.petPouchCards;
assert.equal(list.querySelectorAll().length,50);assert.equal(list.children.length,51,'search plus remains available even when full');assert.deepEqual(list.querySelectorAll().map(n=>n.querySelector('.petPouchNumber').textContent),Array.from({length:50},(_,i)=>String(i+1)));
function drag(commit){const card=list.children[0];card.onpointerdown({isPrimary:true,button:0,pointerId:1,clientX:30,clientY:130,preventDefault(){},stopPropagation(){}});
  assert.ok(listeners.has('pointermove'),'pointerdown immediately starts dragging without a long-press timer');
  listeners.get('pointercancel')({type:'pointercancel',pointerId:2});assert.ok(listeners.has('pointermove'),'a second finger cannot cancel the active drag');
  listeners.get('pointermove')({pointerId:1,clientX:260,clientY:215,cancelable:true,preventDefault(){}});
  assert.ok(list.children.indexOf(card)>=5,'card crosses into the second row');
  listeners.get(commit?'pointerup':'pointercancel')({pointerId:1});
}
drag(false);assert.equal(members[0].symbol,'S0');assert.equal(saves,0);assert.equal(list.children[0].dataset.watchId,'S0');
drag(true);assert.equal(saves,1);assert.ok(members.findIndex(a=>a.symbol==='S0')>=5);assert.deepEqual(list.querySelectorAll().map(n=>n.querySelector('.petPouchNumber').textContent),Array.from({length:50},(_,i)=>String(i+1)));
assert.equal(listeners.size,0);
const dialog=new Node();dialog.open=false;dialog.showModal=()=>{dialog.open=true};nodes.petAssetSearchDialog=dialog;
let focused=0,searched=0;nodes.petOwnSearch={focus(){focused++}};nodes.petOwnResults=new Node();c.searchPetAssets=()=>{searched++};
list.querySelector('.petPouchAdd').onclick();assert.equal(dialog.open,true);assert.equal(focused,1);assert.equal(searched,1);assert.equal(saves,1,'opening search does not change holdings');
c.window.innerWidth=428;const expirations=[];c.setTimeout=fn=>{expirations.push(fn)};
const card=list.children[0],badge=new Node();badge.className='petSearchAdded';card.append(badge);c.showPetAlreadyAdded(card);assert.equal(badge.textContent,'已在自选中');c.showPetAlreadyAdded(card);assert.equal(card.children.filter(n=>n.className==='petSearchAdded').length,1,'repeat taps update the reserved status instead of adding floating notices');assert.equal(dialog.children.length,0,'selection status stays in its row');
console.log('Five-column pouch: 50 numbered cards, cross-row drag persists, cancellation restores order, numbering refreshes PASS');
