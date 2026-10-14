const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/touch.js'),'utf8');
const handlers={},contexts=[];let now=1000,starts=0,primes=0,buffers=0,releases=[];
const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param(),start(){if(this.buffer?.length===1)primes++;else starts++},stop(){}});
class Audio{constructor(){this.state='suspended';this.currentTime=1;this.sampleRate=1000;this.destination={};contexts.push(this)}resume(){return new Promise(resolve=>releases.push(()=>{this.state='running';resolve()}))}createGain(){return node()}createOscillator(){return node()}createBufferSource(){return node()}createBiquadFilter(){return node()}createBuffer(c,n){buffers++;return {length:n,getChannelData:()=>new Float32Array(n)}}}
const document={hidden:false,addEventListener(type,fn){handlers[type]=fn}},window={AudioContext:Audio,MarketDevice:{isMobile:()=>true}};
const c={window,document,Date:{now:()=>now}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('((root,factory)=>')),c);
const sound=window.MarketPhysics.sound,flush=()=>new Promise(setImmediate),resume=()=>{const pending=releases;releases=[];pending.forEach(f=>f())};
(async()=>{
 const prepared=window.MarketPhysics.prepareAudio();assert.equal(prepared.prepared,true);assert.equal(prepared.enabled,false);assert.equal(buffers,3);assert.equal(starts,0,'preparing resources stays silent and does not pretend audio is enabled');window.MarketPhysics.prepareAudio();assert.equal(buffers,3,'prepared sound buffers are reused');
 sound('card');assert.equal(starts,0);resume();await flush();assert.equal(starts,1,'first sound waits for audio resume');
 const audio=contexts[0];audio.currentTime+=1;audio.state='interrupted';sound('lift');resume();await flush();assert.equal(starts,2,'Safari interrupted state resumes');
 audio.currentTime+=1;audio.state='suspended';sound('card');sound('swap');resume();await flush();assert.equal(starts,3,'only latest pending sound plays');
 audio.currentTime+=1;audio.state='suspended';sound('card');now+=351;resume();await flush();assert.equal(starts,3,'stale action does not play late');
 audio.state='suspended';sound('card');document.hidden=true;handlers.visibilitychange();resume();await flush();assert.equal(starts,3,'backgrounded page drops pending sound');document.hidden=false;
 audio.state='closed';handlers.touchend();assert.equal(contexts.length,2);resume();await flush();assert.equal(starts,3,'unlock gesture alone stays silent');sound('insert');assert.equal(starts,4,'closed context recreated');
 assert.ok(handlers.pointerdown&&handlers.touchend&&handlers.click&&handlers.keydown);assert.ok(primes>0,'gesture primes the mobile output silently');const before=buffers;contexts.at(-1).currentTime+=1;sound('card');contexts.at(-1).currentTime+=1;sound('swap');assert.equal(buffers,before,'swiping never rebuilds the sound resources');
 const mutedStarts=starts;window.MarketPhysics.setMuted(true);assert.equal(window.MarketPhysics.audioStatus().muted,true);sound('card');sound('swap');assert.equal(starts,mutedStarts,'muted effects never start audio');window.MarketPhysics.setMuted(false);contexts.at(-1).currentTime+=1;sound('card');assert.equal(starts,mutedStarts+1,'unmuting restores playback');
 console.log('Audio PASS: initial resume, Safari interruption recovery, latest-only playback, stale/background cancellation, closed context and gesture unlock');
})().catch(e=>{console.error(e);process.exitCode=1});
