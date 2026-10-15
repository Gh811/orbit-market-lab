const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/theme.js'),'utf8').split('// Set the palette')[0];
function run({phone=true,entry=true,width=390,orientation=0,criticalPending=false}={}){
 const classes=new Set(),handlers={},windowHandlers={},timeouts=[],intervals=[];let now=1000;
 const nodes=Object.fromEntries(['bootProgressFill','bootProgress','bootStatus','bootRetry','bootCover','bootEnter','bootDetails'].map(id=>[id,{style:{},hidden:true,attributes:{},setAttribute(k,v){this.attributes[k]=v}}]));
 const critical={sheet:criticalPending?null:{},media:'all',matches:()=>false};
 const link={sheet:null,media:'all',tagName:'LINK',href:'https://orbit.test/assets/styles.css?v=123',matches:q=>q.includes('link[data-entry-style]')};
 const root={style:{setProperty(){}},dataset:{},style:{setProperty(){}},classList:{toggle(k,v){v?classes.add(k):classes.delete(k)},add(...ks){ks.forEach(k=>classes.add(k))},remove(...ks){ks.forEach(k=>classes.delete(k))}},hasAttribute:()=>entry};
 const ctx={window:{innerWidth:width,innerHeight:Math.abs(orientation)===90?390:844,orientation,matchMedia:()=>({matches:phone}),addEventListener(n,f){(windowHandlers[n]??=[]).push(f)}},screen:{width:phone?390:1440,height:phone?844:900},navigator:{userAgent:phone?'iPhone':'Desktop',maxTouchPoints:phone?5:0},document:{styleSheets:[],documentElement:root,styleSheets:[],getElementById:id=>nodes[id],querySelector:()=>null,querySelectorAll:q=>q.includes('data-entry-critical')?[link,critical]:[link],addEventListener(n,f){(handlers[n]??=[]).push(f)}},setTimeout(f,ms){timeouts.push({f,ms});return timeouts.length},clearTimeout(){},setInterval(f){intervals.push(f);return intervals.length},clearInterval(){},URL,location:{href:'https://orbit.test/',reload(){ctx.reloaded=true}},Date:{now:()=>now}};
 Object.defineProperty(ctx,'innerHeight',{get:()=>ctx.window.innerHeight});
 vm.createContext(ctx);vm.runInContext(src,ctx);
 const emit=(n,e={})=>(handlers[n]||[]).forEach(f=>f(e));
 const resize=(w,o)=>{ctx.window.innerWidth=w;ctx.window.innerHeight=Math.abs(o)===90?390:844;ctx.window.orientation=o;(windowHandlers.resize||[]).forEach(f=>f())};
 const advance=(ms=100)=>{now+=ms;intervals.forEach(fn=>fn())};const settle=()=>{for(let i=0;i<60;i++)advance()};
 return {ctx,classes,nodes,link,critical,emit,resize,timeouts,intervals,advance,settle};
}
const m=run();assert.ok(m.classes.has('bootLoading'));assert.ok(m.ctx.window.MarketDevice.isMobile());
m.resize(844,90);assert.equal(m.ctx.window.MarketDevice.viewport().width,390);assert.equal(m.ctx.window.MarketDevice.viewport().height,844);assert.ok(m.ctx.window.MarketDevice.isMobile(),'phone stays mobile above desktop width');
assert.equal(m.ctx.window.MarketDevice.viewport().width,390);assert.equal(m.ctx.window.MarketDevice.viewport().height,844);
m.resize(390,0);assert.ok(!m.classes.has('mobileLandscape'));assert.ok(m.ctx.window.MarketDevice.isMobile(),'portrait keyboard changes never count as landscape');
m.ctx.window.MarketBoot.ready();assert.ok(m.classes.has('bootLoading'),'account alone cannot finish before DOM/styles');
m.emit('DOMContentLoaded');assert.ok(m.classes.has('bootLoading'),'DOM alone cannot finish before styles');
m.link.sheet={};m.emit('load',{target:m.link});m.settle();assert.equal(m.link.media,'all');assert.equal(m.nodes.bootProgress.attributes['aria-valuenow'],'100');
m.timeouts.find(t=>t.ms===700).f();assert.ok(!m.classes.has('bootLoading'));assert.ok(m.classes.has('bootComplete'));
const slow=run();slow.emit('DOMContentLoaded');slow.link.sheet={};for(let i=0;i<100;i++)slow.intervals[0]();assert.ok(Number(slow.nodes.bootProgress.attributes['aria-valuenow'])<=90,'loading never promises completion before account ready');
slow.ctx.window.MarketBoot.fail('连接失败');assert.equal(slow.nodes.bootStatus.textContent,'连接失败');assert.equal(slow.nodes.bootRetry.hidden,false);slow.nodes.bootRetry.onclick();assert.equal(slow.ctx.reloaded,true);
slow.ctx.window.MarketBoot.ready();slow.settle();assert.equal(slow.nodes.bootProgress.attributes['aria-valuenow'],'100','successful retry can complete');
const desktop=run({phone:false,width:1440});assert.ok(desktop.ctx.window.MarketBoot);assert.ok(desktop.classes.has('bootLoading'));assert.equal(desktop.ctx.window.MarketDevice.isMobile(),true,'main entry has no desktop branch');assert.equal(desktop.ctx.window.MarketDevice.viewport().width,1440,'wide window uses its available width');desktop.link.sheet={};desktop.emit('load',{target:desktop.link});assert.equal(desktop.link.media,'all');
const outsideEntry=run({phone:false,entry:false,width:1440});assert.equal(outsideEntry.ctx.window.MarketBoot,undefined,'unrelated pages retain their mode');
const landscapeStart=run({width:844,orientation:90});assert.equal(landscapeStart.ctx.window.MarketDevice.viewport().width,390);assert.ok(landscapeStart.classes.has('bootLoading'));
assert.equal(landscapeStart.ctx.window.MarketDevice.viewport().width,390);
assert.equal(landscapeStart.ctx.window.MarketDevice.viewport().height,844);
const normalRetry=run();normalRetry.emit('DOMContentLoaded');assert.equal(normalRetry.nodes.bootRetry.hidden,true,'normal loading never shows retry');
const timeoutRetry=run();timeoutRetry.emit('DOMContentLoaded');timeoutRetry.timeouts.find(t=>t.ms===30000).f();assert.equal(timeoutRetry.nodes.bootRetry.hidden,true,'one timeout does not show manual reload');timeoutRetry.timeouts.filter(t=>t.ms===1500).at(-1).f();assert.match(timeoutRetry.link.href,/boot_attempt=1/,'first timeout reissues the stylesheet');timeoutRetry.timeouts.filter(t=>t.ms===15000).at(-1).f();timeoutRetry.timeouts.filter(t=>t.ms===3000).at(-1).f();assert.match(timeoutRetry.link.href,/boot_attempt=2/);assert.equal(timeoutRetry.nodes.bootRetry.hidden,true,'second attempt still hides manual reload');timeoutRetry.timeouts.filter(t=>t.ms===15000).at(-1).f();assert.equal(timeoutRetry.nodes.bootRetry.hidden,false,'three unresolved resource attempts expose manual reload');timeoutRetry.link.sheet={};timeoutRetry.emit('load',{target:timeoutRetry.link});timeoutRetry.ctx.window.MarketBoot.ready();timeoutRetry.settle();assert.equal(timeoutRetry.nodes.bootRetry.hidden,true,'successful recovery hides retry');
const transientAccount=run();transientAccount.emit('DOMContentLoaded');transientAccount.ctx.window.MarketBoot.fail('重新连接…',{exhausted:false});assert.equal(transientAccount.nodes.bootRetry.hidden,true,'intermediate account failures stay automatic');transientAccount.ctx.window.MarketBoot.fail('多次失败',{exhausted:true});assert.equal(transientAccount.nodes.bootRetry.hidden,false);
const earlyFailure=run();earlyFailure.ctx.window.MarketBoot.fail('样式失败');earlyFailure.emit('DOMContentLoaded');assert.equal(earlyFailure.nodes.bootRetry.hidden,false,'DOMContentLoaded preserves an earlier failure');
const readyRetry=run();readyRetry.emit('DOMContentLoaded');readyRetry.link.sheet={};readyRetry.ctx.window.MarketBoot.ready();readyRetry.timeouts.find(t=>t.ms===30000).f();assert.equal(readyRetry.nodes.bootRetry.hidden,true,'ready resources do not show timeout merely while progress settles');
assert.match(fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),/<button id="bootRetry"[^>]* hidden>/,'retry hidden from first HTML paint');
console.log('Mobile entry: main entry always mobile, wide canvas follows available width, portrait/keyboard distinction, readiness gates and failure/retry PASS');
(async()=>{
 const gate=run();gate.emit('DOMContentLoaded');gate.link.sheet={};let release;
 gate.ctx.window.MarketBoot.ready(()=>new Promise(resolve=>release=resolve));await Promise.resolve();
 assert.ok(gate.classes.has('bootLoading'));assert.ok(!gate.timeouts.some(t=>t.ms===700),'slow artwork never schedules entry');
 for(let i=0;i<50;i++)gate.intervals[0]();assert.ok(gate.classes.has('bootLoading'),'timer cannot bypass artwork');
 release();await new Promise(setImmediate);
 gate.timeouts.filter(t=>t.ms===0).at(-1).f();gate.timeouts.filter(t=>t.ms===0).at(-1).f();gate.settle();
 assert.ok(gate.timeouts.some(t=>t.ms===700),'only decoded artwork and two render frames permit entry');
 const broken=run();broken.emit('DOMContentLoaded');broken.link.sheet={};
 broken.ctx.window.MarketBoot.ready(()=>Promise.reject(new Error('missing image')));await new Promise(setImmediate);
 assert.ok(broken.classes.has('bootLoading'));assert.equal(broken.nodes.bootRetry.hidden,true,'first artwork failure automatically retries');broken.timeouts.filter(t=>t.ms===2000).at(-1).f();await new Promise(setImmediate);assert.equal(broken.nodes.bootRetry.hidden,true,'second artwork failure still hides reload');broken.timeouts.filter(t=>t.ms===4000).at(-1).f();await new Promise(setImmediate);assert.equal(broken.nodes.bootRetry.hidden,false,'third artwork failure shows reload');assert.ok(!broken.timeouts.some(t=>t.ms===700),'failed artwork keeps cover closed');
 console.log('Entry visual gate: slow/failed artwork never opens page, timer cannot bypass, render frames before reveal PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

const iphone=run({width:428});iphone.ctx.screen.width=428;iphone.ctx.screen.height=926;
const declaration={value:'min(70vw,58dvh)',getPropertyValue(){return this.value},getPropertyPriority(){return ''},setProperty(n,v){this.value=v},[Symbol.iterator]:function*(){yield 'width'}};
const media={mediaText:'(max-width:720px) and (max-height:680px)'};
iphone.ctx.document.styleSheets=[{cssRules:[{media,cssRules:[{style:declaration}]}]}];iphone.emit('DOMContentLoaded');
const frozenMedia=media.mediaText,frozenValue=declaration.value;
assert.equal(frozenMedia,'(min-width:0px) and (max-width:0px)');assert.match(frozenValue,/var\(--phone-layout-width\) \* 0\.7/);assert.match(frozenValue,/var\(--phone-layout-height\) \* 0\.58/);
iphone.resize(926,90);assert.equal(media.mediaText,frozenMedia);assert.equal(declaration.value,frozenValue);assert.equal(iphone.ctx.window.MarketDevice.viewport().width,428);
iphone.resize(428,0);iphone.ctx.window.visualViewport={width:428,height:300,offsetTop:10};assert.equal(iphone.ctx.window.MarketDevice.viewport().height,300,'portrait keyboard remains supported');
const indexHtml=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
assert.doesNotMatch(indexHtml,/portraitNotice|竖着看，更舒服/);assert.match(indexHtml,/interactive-widget=overlays-content/,'keyboard overlays page without resizing');
console.log('Phone layout stays fixed across rotation, no orientation notice, portrait keyboard remains supported PASS');

const cold=run({criticalPending:true});cold.emit('DOMContentLoaded');cold.ctx.window.MarketBoot.ready();
cold.link.sheet={};cold.emit('load',{target:cold.link});
assert.ok(!cold.classes.has('entryStylesReady'),'main CSS alone cannot expose an unstyled boot cover');
assert.ok(!cold.timeouts.some(t=>t.ms===700),'missing critical CSS keeps entry closed');
cold.critical.sheet={};cold.emit('load',{target:cold.critical});cold.settle();
assert.ok(cold.classes.has('entryStylesReady'),'DOM and both loaded styles permit first paint');
assert.ok(cold.timeouts.some(t=>t.ms===700),'boot completes only after both styles are ready');
assert.match(indexHtml,/data-entry-guard/);assert.doesNotMatch(indexHtml,/data-entry-style media="print"/);
console.log('First paint: inline visibility guard, blocking main CSS, both styles required PASS');

{
 const automatic=run();automatic.ctx.window.MarketPhysics={audioStatus:()=>({supported:true,prepared:true,enabled:false})};
 automatic.emit('DOMContentLoaded');automatic.link.sheet={};automatic.ctx.window.MarketBoot.ready();
 assert.ok(!automatic.timeouts.some(t=>t.ms===700),'fast resources still allow the short smooth loading period');
 automatic.settle();assert.equal(automatic.nodes.bootProgress.attributes['aria-valuenow'],'100');
 automatic.timeouts.find(t=>t.ms===700).f();assert.ok(automatic.classes.has('bootComplete'),'browser audio suspension never asks for an extra confirmation');
 const unsupported=run();unsupported.ctx.window.MarketPhysics={audioStatus:()=>({supported:false,prepared:false,enabled:false})};unsupported.emit('DOMContentLoaded');unsupported.link.sheet={};unsupported.ctx.window.MarketBoot.ready();unsupported.settle();assert.ok(unsupported.timeouts.some(t=>t.ms===700));
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');assert.ok(!html.includes('bootEnter'),'entry remains automatic');
 console.log('Automatic entry: prepared resources and minimum duration, suspended or unsupported audio never blocks entry PASS');
}

{
 const app=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');let opened=0,entered,queued=0;
 const dialog={open:false,close(){this.open=false}},bodyFlags=new Set();
 const c={accountUser:null,document:{body:{classList:{toggle(k,v){v?bodyFlags.add(k):bodyFlags.delete(k)},add:k=>bodyFlags.add(k),remove:k=>bodyFlags.delete(k)}},documentElement:{classList:{contains:()=>true}}},window:{MarketBoot:{whenEntered(callback){queued++;entered=callback}}},$:id=>id==='authDialog'?dialog:{},openDetailDialog(){opened++;dialog.open=true}};
 vm.createContext(c);vm.runInContext(app.slice(app.indexOf('function setAccess('),app.indexOf('function defaultAccountState(')),c);
 c.setAccess(false);c.setAccess(false);assert.equal(opened,0,'login modal never makes loading button inert');assert.equal(queued,1);entered();assert.equal(opened,1,'login opens once after real entry');c.setAccess(true);assert.equal(dialog.open,false);
 console.log('Entry interaction: login modal deferred until the loader finishes, callback deduplicated, authentication gate retained PASS');
}
