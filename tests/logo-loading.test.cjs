const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
let createdImages=0,decodeResolve,lookups=0;const images=[];
class Node{constructor(tag){this.tag=tag;this.dataset={};this.children=[];const flags=new Set();this.classList={add:k=>flags.add(k),remove:k=>flags.delete(k),contains:k=>flags.has(k)}}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}cloneNode(){const n=new Node(this.tag);n.src=this.src;return n}}
const c={window:{innerWidth:390},document:{createElement(tag){const n=new Node(tag);if(tag==='img'){createdImages++;images.push(n);n.decode=()=>new Promise(r=>decodeResolve=r)}return n}},OKX_ICONS:new Set(['BTC','ETH']),BRAND_ICONS:new Set(),COIN_ICONS:new Set(),resolvedLogos:{},BRAND_ICON_PATHS:{},validLogoURL:url=>typeof url==='string'&&url.startsWith('/api/logo-image?'),symbolMark:s=>({symbol:s}),lookupLogo(){lookups++},Date,Map};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const readyLogoImages='),source.indexOf('function renderHeroLogo()')),c);
(async()=>{
const first=c.logoFor({symbol:'BTC'},true),second=c.logoFor({symbol:'BTC'});assert.equal(createdImages,1);assert.equal(first.children.length,0,'known Logo does not first show a different symbol');assert.ok(first.classList.contains('logoPending'));
const load=images[0].onload();assert.equal(first.children.length,0,'wait for decoding');decodeResolve();await load;await Promise.resolve();assert.equal(first.children[0].tag,'img');assert.equal(second.children[0].tag,'img');
const warm=c.logoFor({symbol:'BTC'},true);assert.equal(warm.children[0].tag,'img');assert.equal(createdImages,1);assert.ok(!warm.classList.contains('logoPending'));assert.ok(!warm.classList.contains('logoArrived'),'cached rebuild never restarts fade');
const failed=c.logoFor({symbol:'ETH'});images[1].onerror();await Promise.resolve();assert.equal(failed.children[0].symbol,'ETH');assert.ok(!failed.classList.contains('logoPending'));c.logoFor({symbol:'ETH'});assert.equal(createdImages,2,'failed URL has bounded retry');
c.logoFor({symbol:'SZ000001',type:'ashare',logo:'/api/logo-image?symbol=SZ000001'},false,true);assert.equal(images.at(-1).src,'/api/logo-image?symbol=SZ000001','catalogued database logo starts loading without a lookup');
c.logoFor({symbol:'UNKNOWN'},false,true);assert.equal(lookups,1,'visible crypto/stock search candidates also discover their logos');c.logoFor({symbol:'SH600000',type:'ashare'},false,true);assert.equal(lookups,2,'visible A-share search candidates start bounded background resolution');c.logoFor({symbol:'OTHER'});assert.equal(lookups,3,'normal cards retain remote logo resolution');
for(let i=0;i<26;i++){const symbol='S'+i;c.OKX_ICONS.add(symbol);c.logoFor({symbol});const image=images.at(-1),ready=image.onload();decodeResolve();await ready}
assert.equal(vm.runInContext('readyLogoImages.size',c),24,'decoded mobile image cache stays bounded');
console.log('Logo loading: shared request, decode before display, stable warm render, no placeholder flash, failed-image fallback and retry backoff PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
