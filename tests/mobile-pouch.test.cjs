const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'('),from=source.lastIndexOf('async ',start)===start-6?start-6:start;let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(from,i+1)}}
const noop=()=>{},rect=()=>({left:0,top:0,width:100,height:60});let delay=false,finish,saved=0,sounds=0;
const slots=Array.from({length:5},()=>({getBoundingClientRect:rect}));
const c={petManagerGroup:'main',petManagerOwner:'alice',accountSpace:'alice',accountUser:'alice',petManagerEpoch:1,petDraft:null,petInsertBusy:false,MAX_GROUP_ASSETS:50,assets:[],groups:[{id:'main'}],petPouches:new Map(),petSessionAdds:new Set(),document:{body:{append:noop}},window:{matchMedia:()=>({matches:!delay}),MarketPhysics:{sound(){sounds++}}},$:id=>id==='petPouchCards'?{children:slots,getBoundingClientRect:rect,querySelector:()=>null}:{},randomCardColor:()=>42,deckColor:noop,save(){saved++},renderWatch:noop,connectOkx:noop,queueMini:noop,queueProfile:noop,renderPetHoldings:noop,renderPetPouch:noop,searchPetAssets:noop,setPetManagerNotice:noop};
vm.createContext(c);vm.runInContext(['currentPetPouch','petManagedAssets','insertPetCard'].map(fn).join('\n'),c);
function row(){return {disabled:false,isConnected:true,getBoundingClientRect:rect,remove(){this.isConnected=false},cloneNode(){return {style:{},setAttribute:noop,remove:noop,animate:()=>({finished:new Promise(resolve=>finish=resolve)})}}}}
(async()=>{
 for(let i=0;i<50;i++){const r=row();await c.insertPetCard({symbol:'S'+i},r);assert.equal(r.isConnected,false)}
 assert.equal(c.assets.length,50);assert.equal(saved,50);assert.equal(c.currentPetPouch().length,50);assert.equal(sounds,50);assert.equal(c.petSessionAdds.size,50,'insert marks symbols as this-session additions');
 await c.insertPetCard({symbol:'OVER'},row());assert.equal(c.assets.length,50);assert.equal(saved,50);
 c.assets.splice(10,1);assert.equal(c.currentPetPouch().length,49);await c.insertPetCard({symbol:'NEW'},row());assert.equal(c.assets.length,50);assert.equal(saved,51);
 c.petDraft={id:'draft',assets:[],owner:'alice'};c.petManagerGroup='draft';
 for(let i=0;i<50;i++)await c.insertPetCard({symbol:'D'+i},row());
 assert.equal(c.petDraft.assets.length,50);assert.equal(c.assets.length,50);assert.equal(saved,51);assert.equal(c.petDraft.assets[0].cardColor,42);
 await c.insertPetCard({symbol:'OVERD'},row());assert.equal(c.petDraft.assets.length,50);
 c.petDraft={id:'draft',assets:[],owner:'alice'};delay=true;
 const pending=c.insertPetCard({symbol:'OLD'},row());assert.equal(c.petInsertBusy,true);c.petManagerEpoch++;finish();await pending;assert.equal(c.petDraft.assets.length,0);assert.equal(c.petInsertBusy,false);
 const another=c.insertPetCard({symbol:'WRONG'},row());c.accountSpace='bob';finish();await another;assert.equal(c.petDraft.assets.length,0);
 console.log('Mobile pouch: 50-card group capacity including sixth card, deletion frees capacity, animated removal, draft isolation, stable card color, navigation/account changes reject pending insertion: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
