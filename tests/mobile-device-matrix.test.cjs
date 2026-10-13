const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/theme.js'),'utf8').split('// Set the palette')[0];
for(const [width,height,ua] of [[320,568,'iPhone'],[360,640,'Android Mobile'],[375,667,'iPhone'],[390,844,'iPhone'],[393,873,'Android Mobile'],[412,915,'Android Mobile'],[430,932,'iPhone'],[480,960,'Android Mobile']]){
 const values={},events={},root={dataset:{},style:{setProperty:(name,value)=>values[name]=value},classList:{add(){},toggle(){}},hasAttribute:()=>false};
 const c={window:{innerWidth:width,innerHeight:height,orientation:0,matchMedia:()=>({matches:true}),addEventListener:(name,fn)=>{(events[name]??=[]).push(fn)}},screen:{width,height},navigator:{userAgent:ua,maxTouchPoints:5},document:{documentElement:root,styleSheets:[],addEventListener(){},querySelectorAll:()=>[]}};
 vm.createContext(c);vm.runInContext(source,c);assert.equal(c.window.MarketDevice.isMobile(),true);assert.equal(values['--phone-layout-width'],width+'px');assert.equal(values['--phone-layout-height'],height+'px');
 c.window.innerWidth=height;c.window.innerHeight=width;c.window.orientation=0;(events.resize||[]).forEach(fn=>fn());assert.equal(c.window.MarketDevice.viewport().width,width,'resize before orientation update cannot overwrite portrait width');
 c.window.orientation=90;(events.resize||[]).forEach(fn=>fn());assert.equal(c.window.MarketDevice.isMobile(),true);assert.equal(c.window.MarketDevice.viewport().width,width);assert.equal(values['--phone-layout-width'],width+'px');
}
console.log('Device geometry matrix: 320/360/375/390/393/412/430/480 CSS-pixel phones keep mobile mode and portrait dimensions after rotation PASS (no real-device rendering claim)');
