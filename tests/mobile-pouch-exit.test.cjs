const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const flags=()=>{const set=new Set();return{add:k=>set.add(k),remove:k=>set.delete(k),toggle:(k,on)=>on?set.add(k):set.delete(k),contains:k=>set.has(k)}};
function fixture(){
 const events=new Map(),asset={symbol:'BTC'},pouch={classList:flags(),getBoundingClientRect:()=>({left:100,right:300,top:100,bottom:350})};let removed=0,saved=0;
 const ghost={classList:flags(),style:{},setAttribute(){},remove(){}},card={dataset:{watchId:'BTC'},classList:flags(),getBoundingClientRect:()=>({left:150,top:140,width:60,height:74}),cloneNode:()=>ghost,setPointerCapture(){},releasePointerCapture(){}};
 const list={getBoundingClientRect:()=>({left:110,right:290,top:140,bottom:330}),querySelector:()=>null,querySelectorAll:()=>[]};
 const c={petHoldingsDragCancel:null,petInsertBusy:false,petManagerGroup:'g',petManagerEpoch:1,accountSpace:'alice',petManagedAssets:()=>[asset],watchId:a=>a.symbol,$:id=>id==='petPouchCards'?list:pouch,document:{body:{append(){}},addEventListener(){},removeEventListener(){}} ,window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},setTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},removePetPouchAsset(a,g,epoch,owner){assert.equal(a,asset);assert.equal(g,'g');assert.equal(epoch,1);assert.equal(owner,'alice');removed++},persistPetHoldingsOrder(){saved++},cardsOrder:()=>['BTC'],renderPetHoldings(){},renderPetPouch(){}};
 vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function startPetPouchDrag('),s.indexOf('async function insertPetCard(')),c);
 const event=(x,y)=>({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});c.startPetPouchDrag(event(180,180),card,card);
 return{c,events,event,pouch,ghost,removed:()=>removed,saved:()=>saved};
}
for(const [direction,x,y] of [['left',99,200],['right',301,200],['top',180,99],['bottom',180,351],['corner',301,351]]){
 const f=fixture();f.events.get('pointermove')(f.event(x,y));assert.ok(f.pouch.classList.contains('removing'),direction+' indicates removal');assert.ok(f.ghost.classList.contains('removing'));assert.equal(f.removed(),0,'moving outside alone does not commit');f.events.get('pointerup')(f.event(x,y));assert.equal(f.removed(),1,direction+' release removes');assert.equal(f.events.size,0);
 const returned=fixture();returned.events.get('pointermove')(returned.event(x,y));returned.events.get('pointermove')(returned.event(200,200));assert.equal(returned.pouch.classList.contains('removing'),false);returned.events.get('pointerup')(returned.event(200,200));assert.equal(returned.removed(),0,'returning inside retains card');assert.equal(returned.saved(),1);
}
const cancelled=fixture();cancelled.events.get('pointermove')(cancelled.event(99,180));cancelled.events.get('pointercancel')(cancelled.event(99,180));assert.equal(cancelled.removed(),0);
const final=fixture();final.events.get('pointerup')(final.event(301,200));assert.equal(final.removed(),1,'final release coordinates count even without final move event');
const stale=fixture();stale.events.get('pointermove')(stale.event(99,180));stale.c.accountSpace='bob';stale.events.get('pointerup')(stale.event(99,180));assert.equal(stale.removed(),0);
const border=fixture();border.events.get('pointerup')(border.event(100,200));assert.equal(border.removed(),0,'exact outer boundary remains inside');
console.log('Pouch exit: all four sides and corners, release-only commit, drag back retains, cancellation/account guards, final pointer coordinates and exact boundary PASS');
