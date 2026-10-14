const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
const username={value:' Alice '},mascot={isConnected:true,dataset:{},style:{setProperty:(k,v)=>mascot.image=v}},panel={querySelector:()=>mascot};
const storage=new Map(),images=new Map();let active=false,scrolls=0;
const input={matches:()=>true,scrollIntoView:()=>scrolls++},dialog={contains:n=>n===input,classList:{contains:key=>key==='authInputActive'&&active,toggle:(key,value)=>active=value,remove:key=>{if(key==='authInputActive')active=false}}};
const c={accountUser:'Alice',groups:[{id:'main',petKind:5}],authMode:'login',registrationPetKind:2,accountAvatarKind:5,
 window:{MarketDevice:{isMobile:()=>true},visualViewport:{height:800}},document:{querySelector:()=>panel,activeElement:input},$:id=>id==='authUsername'?username:dialog,
 localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},companionArtworkUrl:k=>'/pet'+k+'.png',
 prepareLogoImage:url=>{let resolve;const promise=new Promise(r=>resolve=r);images.set(url,{resolve,promise});return{promise}},
 recordSearch(){},catalogSearchIndex:null,instrumentCatalog:[{symbol:'BTC',name:'Bitcoin'},{symbol:'ETH',name:'Ethereum'},{symbol:'XAU',name:'Gold'},{symbol:'SOXS',name:'Semiconductor Bear ETF',aliases:['半导体三倍看跌']},...Array.from({length:10},(_,i)=>({symbol:'S'+i,name:'Semiconductor Stock '+i}))]};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const normalizeSearch='),source.indexOf('async function loadCatalog()'))+'\n'+['syncAuthMascot','syncAuthInputLayout'].map(fn).join('\n'),c);
(async()=>{
 c.syncAuthMascot();assert.equal(JSON.parse(storage.get('market_login_pets_v1')).alice,5);assert.equal(mascot.image,undefined);
 c.accountUser=null;c.syncAuthMascot();assert.equal(mascot.dataset.requestedImage,'/pet5.png');
 username.value='unknown';c.syncAuthMascot();images.get('/pet5.png').resolve({});await Promise.resolve();assert.equal(mascot.image,undefined,'previous username image cannot replace new username');
 images.get('/pet0.png').resolve({});await Promise.resolve();assert.match(mascot.image,/pet0/);
 active=true;c.syncAuthInputLayout();assert.equal(active,false,'focused input keeps panel still');assert.equal(scrolls,0,'no programmatic scroll on focus');
 c.window.visualViewport.height=450;c.syncAuthInputLayout();assert.equal(active,false,'keyboard open moves nothing');c.window.visualViewport.height=800;c.syncAuthInputLayout();assert.equal(active,false);
 assert.equal(c.matchCatalog('比特币')[0].symbol,'BTC');assert.equal(c.matchCatalog('ＢＴＣ／ＵＳＤＴ')[0].symbol,'BTC');assert.equal(c.matchCatalog('BTC-USDT-SWAP')[0].symbol,'BTC');
 assert.equal(c.matchCatalog('半导体 看跌')[0].symbol,'SOXS');assert.equal(c.matchCatalog('Semiconductor Bear')[0].symbol,'SOXS');assert.equal(c.matchCatalog('semiconductor').length,11);
 assert(c.matchCatalog('完全不存在的标的').every(row=>row.matchType==='related'&&c.instrumentCatalog.some(item=>item.symbol===row.symbol)),'broad fallback stays labelled and uses only real catalogue entries');assert.equal(c.matchCatalog('BTCC')[0].symbol,'BTC');
 console.log('Login/search usability: username avatar retained, decoded swaps reject stale result, keyboard leaves layout still, Chinese/pair/multiword matches, expanded results, no unrelated local fallback PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
