const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
let next=0,played=0,cancelled=0,now=10000;const timers=new Map(),events={},motionEvents={};
const reduced={matches:false,addEventListener:(name,fn)=>motionEvents[name]=fn};
let complete,reject;const model={dataset:{},animate(frames,options){played++;assert.equal(frames[0].transform,'none');assert.equal(frames.at(-1).transform,'none');assert.equal(options.iterations,1);assert.ok(frames.some(frame=>/20.8px|10.4deg|7.8deg/.test(frame.transform)),'random action has visible amplitude');return{finished:new Promise((r,j)=>{complete=r;reject=j}),cancel(){cancelled++;reject(new Error('cancelled'))}}}};
const rig={animate:model.animate};model.animate=()=>assert.fail('body and pouch must animate together on the rig');
const slot={dataset:{groupId:'main',petKind:'0'},classList:{contains:()=>false},querySelector:selector=>selector==='.petRig'?rig:model};
const nodes={petHome:{hidden:false},petDeck:{hidden:true},petStage:{children:[slot]}};
const c={petHomeOn:true,$:id=>nodes[id],window:{matchMedia:()=>reduced,MarketDevice:{isMobile:()=>true},addEventListener(){}},document:{hidden:false,documentElement:{classList:{contains:()=>false}},querySelector:()=>null,addEventListener:(name,fn)=>events[name]=fn},Date:{now:()=>now},setTimeout(fn){timers.set(++next,fn);return next},clearTimeout(id){timers.delete(id)}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const PET_FACE_PROFILES='),source.indexOf('function renderPetArtwork('))+'\nthis.faces=PET_FACE_PROFILES;',c);vm.runInContext(source.slice(source.indexOf('const PET_RANDOM_ACTIONS='),source.indexOf('function buildPetHome()'))+'\nthis.actions=PET_RANDOM_ACTIONS;',c);
assert.equal(c.faces.length,8);for(let kind=0;kind<8;kind++){assert.equal(c.faces[kind].moods.length,2);const markup=c.petExpressionMarkup(kind,'slot'+kind);assert.match(markup,/petMoodHappy/);assert.match(markup,/clipPath/);assert.match(markup,new RegExp('slot'+kind+'lid'))}
assert.equal(c.actions.length,8);assert.equal(new Set(c.actions.flat().map(a=>a.name)).size,16);
for(let kind=0;kind<8;kind++){const first=c.choosePetRandomAction(kind,null,()=>0);assert.notEqual(c.choosePetRandomAction(kind,first.name,()=>0).name,first.name)}
function tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn()}
(async()=>{
 c.setupPetRandomActions();assert.equal(timers.size,1);c.setupPetRandomActions();assert.equal(timers.size,1,'scheduler starts once');
 tick();assert.equal(played,1,'first visit works before manager is ever created');assert.equal(timers.size,0,'no second pet starts while one is acting');assert.ok(['happy','curious'].includes(model.dataset.petMood),'action selects matching expression');assert.equal(slot.dataset.actionScene,'moon','rabbit action changes ground to moon');
 complete();await new Promise(setImmediate);assert.equal(timers.size,1,'next random action waits for current completion');assert.equal(model.dataset.petMood,undefined,'completion restores original expression');assert.equal(slot.dataset.actionScene,undefined,'completion restores ground');
 tick();events.pointerdown();await new Promise(setImmediate);assert.equal(cancelled,1,'touch cancels the current action');assert.equal(model.dataset.petMood,undefined,'touch restores expression');assert.equal(slot.dataset.actionScene,undefined,'touch restores ground');assert.equal(timers.size,1);
 tick();assert.equal(played,2,'cooldown blocks immediate animation');now+=4000;
 nodes.petDeck.hidden=false;tick();assert.equal(played,2,'card view blocks background pet actions');nodes.petDeck.hidden=true;
 nodes.petManager={hidden:false};tick();assert.equal(played,2,'open manager blocks actions');nodes.petManager.hidden=true;
 c.document.hidden=true;events.visibilitychange();assert.equal(timers.size,0,'background tab stops scheduler');
 c.document.hidden=false;events.visibilitychange();assert.equal(timers.size,1);
 reduced.matches=true;motionEvents.change();assert.equal(timers.size,0,'reduced motion disables random actions');
 console.log('Pet actions: eight distinct repertoires, no consecutive repeat, single animation, interaction cancellation, cooldown, hidden surfaces and reduced-motion pause PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
