const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const events=new Map(),attributes={};
const list={scrollHeight:840,clientHeight:340,scrollTop:0,addEventListener(){}};
const rail={clientHeight:340,classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){attributes[k]=v},addEventListener(k,v){events.set(k,v)},getBoundingClientRect:()=>({top:100}),setPointerCapture(){},releasePointerCapture(){}};
const thumb={style:{},get offsetHeight(){return parseFloat(this.style.height)},getBoundingClientRect(){const top=104+parseFloat(this.style.transform.slice(11));return{top,bottom:top+this.offsetHeight}}};
const active=new Map(),c={$:id=>({petPouchCards:list,petPouchScrollRail:rail,petPouchScrollThumb:thumb})[id],petHoldingsDragCancel:null,window:{addEventListener(k,f){active.set(k,f)},removeEventListener(k,f){if(active.get(k)===f)active.delete(k)}}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function updatePetPouchScrollRail('),source.indexOf('function openPetAssetSearch(')),c);
c.setupPetPouchScrollRail();c.updatePetPouchScrollRail();assert.equal(attributes['aria-valuemax'],'500');assert.ok(thumb.offsetHeight>=48);
function pointer(type,y,id=1){return{type,pointerId:id,isPrimary:true,button:0,clientY:y,cancelable:true,preventDefault(){},stopPropagation(){}}}
events.get('pointerdown')(pointer('pointerdown',124));assert.equal(list.scrollTop,0,'grabbing thumb does not jump');
active.get('pointermove')(pointer('pointermove',700));assert.equal(list.scrollTop,500);assert.equal(attributes['aria-valuenow'],'500');
active.get('pointermove')(pointer('pointermove',0));assert.equal(list.scrollTop,0);
active.get('pointerup')(pointer('pointerup',0,2));assert.ok(c.petHoldingsDragCancel);c.petHoldingsDragCancel();assert.equal(c.petHoldingsDragCancel,null);assert.equal(active.has('pointermove'),false);
events.get('keydown')({key:'End',preventDefault(){}});assert.equal(list.scrollTop,500);
events.get('keydown')({key:'ArrowUp',preventDefault(){}});assert.equal(list.scrollTop,418);
events.get('keydown')({key:'Home',preventDefault(){}});assert.equal(list.scrollTop,0);
list.scrollHeight=340;c.updatePetPouchScrollRail();assert.equal(attributes['aria-disabled'],'true');assert.equal(thumb.style.height,'332px');events.get('pointerdown')(pointer('pointerdown',124));assert.equal(c.petHoldingsDragCancel,null);
console.log('Pouch scrollbar: proportional thumb, direct drag, both bounds, pointer isolation, cleanup, keyboard and no-overflow PASS');
