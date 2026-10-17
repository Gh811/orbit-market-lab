const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/app.js','utf8');
const events={},card={dataset:{},style:{},classList:{add(){},remove(){}}},stage={clientWidth:350,addEventListener:(type,fn)=>events[type]=fn,setPointerCapture(){}};
let now=0,flips=[],positions=[];
const ctx={requestAnimationFrame:()=>1,cancelAnimationFrame(){},$:id=>id==='deckStage'?stage:card,deckChartMoved:[],performance:{now:()=>now},deckTransition:0,setTimeout(){},deckSlideTransform:x=>(positions.push(x),String(x)),deckNeighborReveal(){},flipDeck:dir=>flips.push(dir)};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function wireDeckStage()'),source.indexOf('function buildDeckShell()')),ctx);ctx.wireDeckStage();
function swipe(dx,duration){card.dataset.busy='';events.pointerdown({target:{closest:()=>null},isPrimary:true,pointerId:1,clientX:200,clientY:200});now+=duration;events.pointermove({pointerId:1,clientX:200+dx,clientY:200});events.pointerup({pointerId:1});}
swipe(-30,10);assert.equal(flips.length,0,'quick short swipe stays on current card');swipe(-100,200);assert.equal(flips.length,0,'below 32 percent remains');swipe(-120,500);assert.deepEqual(flips,[1]);assert.ok(positions.includes(-98.39999999999999)||positions.includes(-98.4),'finger movement is resisted');swipe(120,500);assert.deepEqual(flips,[1,-1]);
function trace(points,pause=0,dy=0,cancel=false){card.dataset.busy='';events.pointerdown({target:{closest:()=>null},isPrimary:true,pointerId:1,clientX:200,clientY:200});for(const [dt,dx] of points){now+=dt;events.pointermove({pointerId:1,clientX:200+dx,clientY:200+dy})}now+=pause;(cancel?events.pointercancel:events.pointerup)({pointerId:1});}
let before=flips.length;trace([[70,-60]]);assert.equal(flips.length,before+1,'fast deliberate short flick switches');assert.equal(flips.at(-1),1);
before=flips.length;trace([[70,60]]);assert.equal(flips.length,before+1);assert.equal(flips.at(-1),-1,'right flick switches too');
before=flips.length;trace([[500,-60]]);assert.equal(flips.length,before,'same short distance slowly returns');
trace([[70,-60]],120);assert.equal(flips.length,before,'pause before release cancels flick shortcut');
trace([[40,-90],[30,-60]]);assert.equal(flips.length,before,'pulling back does not count as an outgoing flick');
trace([[3000,-3],[60,-65]]);assert.equal(flips.length,before+1,'holding then flicking uses recent speed, not total press time');
before=flips.length;trace([[70,-60]],0,100);assert.equal(flips.length,before,'vertical intent does not switch cards');
trace([[70,-60]],0,0,true);assert.equal(flips.length,before,'cancelled touch never switches');
console.log('Deck resistance PASS: slow distance, fast bounded flick, both directions, pause, reversal, held press, vertical gesture and cancellation');
