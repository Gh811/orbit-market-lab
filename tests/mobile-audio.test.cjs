const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/touch.js'),'utf8');
const handlers={},contexts=[];let now=1000,starts=0,releases=[];
const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param(),start(){starts++},stop(){}});
class Audio{constructor(){this.state='suspended';this.currentTime=1;this.sampleRate=1000;this.destination={};contexts.push(this)}resume(){return new Promise(resolve=>releases.push(()=>{this.state='running';resolve()}))}createGain(){return node()}createOscillator(){return node()}createBufferSource(){return node()}createBiquadFilter(){return node()}createBuffer(c,n){return {getChannelData:()=>new Float32Array(n)}}}
const document={hidden:false,addEventListener(type,fn){handlers[type]=fn}},window={AudioContext:Audio,MarketDevice:{isMobile:()=>true}};
const c={window,document,Date:{now:()=>now}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('((root,factory)=>')),c);
const sound=window.MarketPhysics.sound,flush=()=>new Promise(setImmediate),resume=()=>{const pending=releases;releases=[];pending.forEach(f=>f())};
(async()=>{
 sound('card');assert.equal(starts,0);resume();await flush();assert.equal(starts,1,'first sound waits for audio resume');
 const audio=contexts[0];audio.currentTime+=1;audio.state='interrupted';sound('lift');resume();await flush();assert.equal(starts,2,'Safari interrupted state resumes');
 audio.currentTime+=1;audio.state='suspended';sound('card');sound('swap');resume();await flush();assert.equal(starts,3,'only latest pending sound plays');
 audio.currentTime+=1;audio.state='suspended';sound('card');now+=351;resume();await flush();assert.equal(starts,3,'stale action does not play late');
 audio.state='suspended';sound('card');document.hidden=true;handlers.visibilitychange();resume();await flush();assert.equal(starts,3,'backgrounded page drops pending sound');document.hidden=false;
 audio.state='closed';handlers.touchend();assert.equal(contexts.length,2);resume();await flush();assert.equal(starts,3,'unlock gesture alone stays silent');sound('insert');assert.equal(starts,4,'closed context recreated');
 assert.ok(handlers.pointerdown&&handlers.touchend&&handlers.click&&handlers.keydown);
 console.log('Audio PASS: initial resume, Safari interruption recovery, latest-only playback, stale/background cancellation, closed context and gesture unlock');
})().catch(e=>{console.error(e);process.exitCode=1});
