const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');let covered=true,called=0;const timers=[];
const c={accountUser:'alice',accountSpace:'a',document:{documentElement:{classList:{contains:()=>covered}}},setTimeout(fn){timers.push(fn)}};
vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function afterMobileEntry('),s.indexOf('async function prepareMobileEntryVisuals(')),c);
c.afterMobileEntry(()=>called++);assert.equal(called,0);assert.equal(timers.length,1);covered=false;timers.shift()();assert.equal(called,1,'data starts only after the entry is visible');
covered=true;c.afterMobileEntry(()=>called++);c.accountSpace='b';covered=false;timers.shift()();assert.equal(called,1,'old account cannot launch deferred requests');
const css=fs.readFileSync(require('node:path').join(__dirname,'../assets/styles.css'),'utf8');assert.doesNotMatch(css,/data:image\/png;base64/);
assert.ok(Buffer.byteLength(css)<300000,'main stylesheet no longer embeds a megabyte image');
console.log('Entry priority: data deferred until reveal, account isolation, small stylesheet and no embedded PNG PASS');
