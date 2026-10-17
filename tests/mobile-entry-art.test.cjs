const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const a=source.indexOf('async function prepareMobileEntryVisuals('),b=source.indexOf('async function bootAccount(',a);
let fontReady;const images=[],nodes=[{getAttribute:n=>n==='href'?'/pet.png':null}],decodes=[];
const mascot={},root={querySelectorAll:s=>s.startsWith('.petArtwork image,.petHelmetAvatar')?nodes:s.startsWith('.authMascot,.petModel')?[mascot]:[]};
const c={window:{MarketWallet:{install(){}},MarketNewsPaper:{create(){}},MarketPhysics:{prepareAudio:()=>({supported:true,prepared:true})}},installHomeUtilities(){},accountUser:null,petHomeOn:true,$:()=>root,document:{fonts:{ready:new Promise(r=>fontReady=r)}},getComputedStyle:(n,p)=>({display:'block',backgroundImage:n!==root&&p==='::after'?'url("data:image/png;base64,abc")':'none'}),readyLogoImages:new Map(),setTimeout,clearTimeout,Image:class{constructor(){images.push(this)}decode(){return new Promise(r=>decodes.push(r))}}};
vm.createContext(c);vm.runInContext(source.slice(a,b),c);
(async()=>{
 let done=false;const wait=c.prepareMobileEntryVisuals().then(()=>done=true);assert.equal(images.length,0,'font preparation first');fontReady();await new Promise(setImmediate);assert.equal(images.length,2,'SVG image and CSS mascot both included');
 assert.equal(images[0].src,'/pet.png');assert.equal(images[1].src,'data:image/png;base64,abc');
 images.forEach(img=>img.onload());await Promise.resolve();assert.equal(done,false,'network load without decode cannot release cover');decodes.forEach(r=>r());await wait;assert.equal(done,true);
 const fail=assert.rejects(c.prepareMobileEntryVisuals(),/首屏图片加载失败/);await new Promise(setImmediate);images.at(-1).onerror();images.at(-2).onload();decodes.at(-1)();await fail;assert.equal(true,true,'image error rejects preparation and keeps cover closed');
 c.accountUser='alice';c.pollWatchQuotes=async()=>{};c.document.querySelector=()=>root;c.HOT_GROUP_ID='hot';c.assets=[{groupId:'hot'}];let hotReady;c.loadDailyHot=()=>new Promise(r=>hotReady=r);c.loadCatalog=async()=>{};c.instrumentCatalog=[{type:'ashare'}];
 const before=images.length;const logged=c.prepareMobileEntryVisuals();await new Promise(setImmediate);assert.equal(images.length,before,'logged entry waits for hot group before visual preparation');
 hotReady();await new Promise(setImmediate);images.slice(before).forEach(img=>img.onload());await Promise.resolve();decodes.slice(-2).forEach(r=>r());await logged;
 c.assets=[];c.loadDailyHot=async()=>{};await assert.rejects(c.prepareMobileEntryVisuals(),/热门卡组尚未加载/);
 c.assets=[{groupId:'hot'}];c.instrumentCatalog=[];await assert.rejects(c.prepareMobileEntryVisuals(),/标的目录尚未加载/);c.window.MarketPhysics=null;await assert.rejects(c.prepareMobileEntryVisuals(),/音效组件尚未加载/);
 console.log('Entry art: fonts, SVG artwork, CSS background, all image decodes awaited, failure rejects entry PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
