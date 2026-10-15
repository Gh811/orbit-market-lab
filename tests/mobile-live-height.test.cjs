const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/theme.js'),'utf8').split('// Inline HTML guard')[0]+'})();';
const values={},events={},root={dataset:{},style:{setProperty:(k,v)=>values[k]=v},hasAttribute:()=>true};
const c={window:{innerWidth:390,innerHeight:844,orientation:90,visualViewport:{width:390,height:844,scale:1,addEventListener(){}},matchMedia:()=>({matches:false}),addEventListener:(n,f)=>(events[n]??=[]).push(f)},screen:{width:1280,height:720,orientation:{type:'landscape-primary',addEventListener(){}}},navigator:{userAgent:'Desktop webview',maxTouchPoints:0},document:{documentElement:root,styleSheets:[],activeElement:null,addEventListener(){}}};vm.createContext(c);vm.runInContext(source,c);
function resize(w,h){c.window.innerWidth=w;c.window.innerHeight=h;c.window.visualViewport.width=w;c.window.visualViewport.height=h;(events.resize||[]).forEach(f=>f())}
assert.equal(values['--phone-layout-height'],'844px');assert.equal(values['--wallpaper-viewport-height'],'844px');
resize(390,915);assert.equal(values['--phone-layout-height'],'915px','growing visible area must not leave the previous 71px gap');
resize(390,640);assert.equal(values['--phone-layout-height'],'640px','shrinking portrait height is not a rotation');
resize(390,844);resize(844,390);assert.equal(values['--phone-layout-width'],'844px');assert.equal(values['--phone-layout-height'],'390px');assert(c.window.MarketDevice.isMobile());
resize(390,844);c.document.activeElement={matches:()=>true};resize(390,320);assert.equal(values['--phone-layout-height'],'844px','keyboard overlay keeps artwork still');
c.document.activeElement=null;c.window.innerHeight=915;c.window.visualViewport.height=850;(events.resize||[]).forEach(f=>f());assert.equal(values['--wallpaper-viewport-height'],'915px','wallpaper covers the larger layout viewport while visual viewport is smaller');resize(390,915);assert.equal(values['--phone-layout-height'],'915px','dismissed keyboard restores live height');
console.log('Live mobile height PASS: unknown webview UA, stale landscape metadata, height growth/shrink, available window width and keyboard recovery');

// A real phone's screen remains larger than its toolbar-reduced visual viewport.
const phoneValues={},phoneEvents={};
const phone={...c,window:{...c.window,innerWidth:390,innerHeight:700,visualViewport:{width:390,height:700,scale:1,addEventListener(){}},addEventListener:(n,f)=>(phoneEvents[n]??=[]).push(f)},screen:{width:390,height:844,orientation:{type:'portrait-primary',addEventListener(){}}},document:{...c.document,activeElement:null,documentElement:{dataset:{},style:{setProperty:(k,v)=>phoneValues[k]=v},hasAttribute:()=>true}}};
vm.createContext(phone);vm.runInContext(source,phone);assert.equal(phoneValues['--wallpaper-viewport-height'],'844px','first paint covers the screen before controls retract');
for(const height of [760,844,700,780,320,844]){phone.window.innerHeight=height;phone.window.visualViewport.height=height;phone.document.activeElement=height===320?{matches:()=>true}:null;(phoneEvents.resize||[]).forEach(f=>f());assert.equal(phoneValues['--wallpaper-viewport-height'],'844px','toolbar and keyboard cannot shrink or rescale the wallpaper')}
console.log('Stable wallpaper PASS: screen-sized first paint, toolbar expansion/contraction and keyboard recovery');

// iPad must get the same screen-sized reserve even with a wide screen and desktop UA.
const tabletValues={},tabletEvents={};
const tablet={...c,navigator:{userAgent:'Macintosh',maxTouchPoints:5},screen:{width:834,height:1194,orientation:{addEventListener(){}}},window:{...c.window,innerWidth:834,innerHeight:1080,visualViewport:{width:834,height:1080,scale:1,addEventListener(){}},addEventListener:(n,f)=>(tabletEvents[n]??=[]).push(f)},document:{...c.document,activeElement:null,documentElement:{dataset:{},style:{setProperty:(k,v)=>tabletValues[k]=v},hasAttribute:()=>true}}};
vm.createContext(tablet);vm.runInContext(source,tablet);assert.equal(tabletValues['--wallpaper-viewport-height'],'1194px','tablet reserves the full screen before toolbar retraction');
for(const [width,height,typing]of[[834,1120,false],[834,1194,false],[834,1080,false],[834,450,true],[834,1194,false],[1194,834,false]]){tablet.window.innerWidth=width;tablet.window.innerHeight=height;Object.assign(tablet.window.visualViewport,{width,height});tablet.document.activeElement=typing?{matches:()=>true}:null;(tabletEvents.resize||[]).forEach(f=>f());assert.equal(tabletValues['--wallpaper-viewport-height'],'1194px');assert.equal(tabletValues['--phone-layout-width'],width+'px');}
console.log('iPad wallpaper PASS: physical screen reserve, toolbar and keyboard recovery, landscape width remains responsive');
