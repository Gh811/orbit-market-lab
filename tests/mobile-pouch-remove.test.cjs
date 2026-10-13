const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8'),a=s.indexOf('async function removePetPouchAsset('),b=s.indexOf('\nfunction startPetPouchDrag(',a);
let resolve,deleted=[],removed=[];const asset={symbol:'BTC',groupId:'g'},other={symbol:'ETH',groupId:'g'};
const c={assets:[asset,other],petDraft:null,petManagerGroup:'g',petManagerEpoch:1,accountSpace:'alice',petManagedAssets(){return c.petDraft?c.petDraft.assets:c.assets},petManagedGroup:()=>({name:'自选'}),watchId:x=>x.symbol,confirmGroupAction:()=>new Promise(r=>resolve=r),removeWatchAsset(id){deleted.push(id);c.assets=c.assets.filter(x=>x.symbol!==id)},removePetGroup(id){removed.push(id)},renderPetHoldings(){},renderPetPouch(){},renderPets(){},searchPetAssets(){}};
vm.createContext(c);vm.runInContext(s.slice(a,b),c);
(async()=>{
await c.removePetPouchAsset(asset,'g',1,'alice');assert.deepEqual(deleted,['BTC']);assert.equal(c.assets.length,1);
await c.removePetPouchAsset(other,'g',0,'alice');assert.equal(c.assets.length,1,'stale manager cannot remove');
c.accountSpace='bob';await c.removePetPouchAsset(other,'g',1,'alice');assert.equal(c.assets.length,1,'changed account cannot remove');
c.accountSpace='alice';await c.removePetPouchAsset(other,'g',1,'alice');assert.equal(c.assets.length,0);assert.equal(removed.length,0,'empty pouch retains group and name');
c.petDraft={assets:[asset,other]};await c.removePetPouchAsset(asset,'g',1,'alice');assert.equal(c.petDraft.assets.length,1);assert.equal(deleted.length,2,'draft removal does not touch saved assets');
console.log('Pouch remove: immediate removal, account/session isolation, empty group retained, draft isolation PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
