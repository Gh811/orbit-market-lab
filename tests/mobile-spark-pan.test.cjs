const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const a=source.indexOf('function wireDeckSparkGesture('),b=source.indexOf('function buildDeckCard(){',a);
let opened=0,draws=[],now=1000;
const handlers={},wrap={addEventListener(n,f){handlers[n]=f},setPointerCapture(){},releasePointerCapture(){}};
const canvas={clientWidth:220,dataset:{sparkOffset:'0'},_sparkRows:Array.from({length:30},(_,i)=>({o:i,c:i+1,h:i+2,l:i-1}))};
const ctx={Date:{now:()=>now},openDeckChart(){opened++},miniChart(...args){draws.push(args)}};
vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);ctx.wireDeckSparkGesture(wrap,canvas);
function event(x,y=0,id=1){return {isPrimary:true,button:0,pointerId:id,clientX:x,clientY:y,cancelable:true,preventDefault(){},stopPropagation(){}}}
handlers.pointerdown(event(0));handlers.pointermove(event(35));assert.equal(Number(canvas.dataset.sparkOffset),3.5,'fractional displacement follows the finger');
handlers.pointerup(event(35));wrap.onclick(event(35));assert.equal(opened,0,'drag release and its synthesized click cannot open full chart');
handlers.pointerdown(event(35));handlers.pointermove(event(500));assert.equal(Number(canvas.dataset.sparkOffset),8,'bounded recent history');handlers.pointercancel(event(500));
handlers.pointerdown(event(500));handlers.pointermove(event(0));assert.equal(Number(canvas.dataset.sparkOffset),0,'left drag returns to latest without empty future');handlers.pointerup(event(0));
const before=draws.length;handlers.pointerdown(event(0));handlers.pointermove(event(1,25));handlers.pointerup(event(1,25));assert.equal(draws.length,before);assert.equal(opened,0,'vertical motion neither pans nor opens chart');
handlers.pointerdown(event(10));handlers.pointerup(event(10,0,2));assert.equal(opened,0);handlers.pointerup(event(10));assert.equal(opened,1);wrap.onclick(event(10));assert.equal(opened,1,'unmoved tap opens once');
now+=500;wrap.onkeydown({key:'Enter',preventDefault(){}});assert.equal(opened,2);
// Render the same bounded data at fractional offsets; desktop default still draws 22 bars.
const m=source.indexOf('function miniChart('),end=source.indexOf('function symbolMark(',m);
const stems=[],g={scale(){},beginPath(){},moveTo(x,y){stems.push([x,y])},lineTo(){},stroke(){},fillRect(){}};
const drawing={clientWidth:220,clientHeight:60,getContext:()=>g};
const chartCtx={window:{devicePixelRatio:1},colors:()=>({up:'green',down:'red'})};vm.createContext(chartCtx);vm.runInContext(source.slice(m,end),chartCtx);
chartCtx.miniChart(drawing,canvas._sparkRows,0);const original=stems.slice();stems.length=0;
chartCtx.miniChart(drawing,canvas._sparkRows,.5);assert.equal(stems[1][0]-original[0][0],5,'half bar pans five pixels continuously');assert.equal(stems[1][1],original[0][1],'panning retains vertical scale');
stems.length=0;chartCtx.miniChart(drawing,canvas._sparkRows);assert.equal(stems.length,22);
const css=fs.readFileSync(require('node:path').join(__dirname,'../assets/styles.css'),'utf8');assert.doesNotMatch(css,/content:"K · 30D"/);
console.log('Mini K-line: removed fixed label, smooth bounded history pan, stable scale, pointer isolation, tap/drag separation and desktop default PASS');
