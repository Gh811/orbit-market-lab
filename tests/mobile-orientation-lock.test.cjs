const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(require('node:path').join(__dirname,'../assets/theme.js'),'utf8');
assert.equal(JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../assets/site.webmanifest'),'utf8')).orientation,'portrait-primary');
const snippet=s.slice(s.indexOf('  let portraitLockPending='),s.indexOf('  const lockedSheets='));
function setup(lock,phone=true){const handlers={},c={phone,detectedPhone:phone,screen:{orientation:lock?{lock}:{}},document:{hidden:false,addEventListener(n,f){handlers[n]=f}},Date:{now:()=>c.now},now:1000};vm.createContext(c);vm.runInContext(snippet,c);return {c,handlers}}
const flush=()=>new Promise(setImmediate);
(async()=>{
 let calls=0,arg,resolve;
 const supported=setup(value=>{calls++;arg=value;return new Promise(r=>resolve=r)});
 supported.handlers.click({isTrusted:false});assert.equal(calls,0);
 supported.handlers.touchend({isTrusted:true});supported.handlers.click({isTrusted:true});assert.equal(calls,1);assert.equal(arg,'portrait-primary');resolve();await flush();supported.handlers.click({isTrusted:true});assert.equal(calls,1,'successful lock is not repeated');
 const safari=setup();assert.doesNotThrow(()=>safari.handlers.click({isTrusted:true}));
 calls=0;const restricted=setup(()=>{calls++;return Promise.reject(new Error('requires fullscreen'))});restricted.handlers.click({isTrusted:true});await flush();restricted.handlers.touchend({isTrusted:true});assert.equal(calls,1,'failed calls are throttled');restricted.c.now+=5001;restricted.handlers.click({isTrusted:true});await flush();assert.equal(calls,2);
 restricted.c.document.fullscreenElement={};restricted.handlers.fullscreenchange();await flush();assert.equal(calls,3,'user-entered fullscreen allows retry');
 calls=0;const desktop=setup(()=>{calls++;return Promise.resolve()},false);desktop.handlers.click({isTrusted:true});assert.equal(calls,0);
 const broken=setup(()=>{throw Error('not supported')});assert.doesNotThrow(()=>broken.handlers.click({isTrusted:true}));
 assert.doesNotMatch(snippet,/requestFullscreen|alert\(|deviceorientation|orientationchange/);
 console.log('Portrait lock PASS: feature detection, trusted action, supported success, Safari fallback, permission rejection/throttle, fullscreen retry, desktop isolation, no forced fullscreen or notice');
})().catch(e=>{console.error(e);process.exitCode=1});
