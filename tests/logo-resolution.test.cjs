const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/app.js','utf8');
let calls=0,paint=0,nextTimer=0;const timers=new Map();
const c={instrumentCatalog:[{symbol:'SZ000001',logo:'/api/logo-image?symbol=SZ000001',logoSource:'公司官网图标'}],resolvedLogos:{},Date,Set,Map,document:{hidden:false,querySelector:()=>({})},publicMarketCache:{setItem(){}},api:async()=>++calls===1?{url:'',pending:true,retryAfter:2}:{url:'/api/logo-image?symbol=SH600000',source:'公司官网图标'},prepareLogoImage:()=>({promise:Promise.resolve({})}),refreshResolvedLogo:()=>paint++,setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function validLogoURL('),source.indexOf('const tfMs=')),c);
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
(async()=>{
 assert.equal(c.resolvedLogos.SZ000001.url,'/api/logo-image?symbol=SZ000001');c.lookupLogo('SZ000001',true);assert.equal(calls,0,'database logo from catalogue needs no separate lookup');
 c.lookupLogo('SH600000');c.lookupLogo('SH600000');await flush();assert.equal(calls,1,'concurrent requests deduplicate');assert.equal(paint,0);assert.equal(timers.size,1);const retry=[...timers.values()][0];assert.equal(retry.ms,2000,'first retry occurs in two seconds');retry.fn();await flush();assert.equal(calls,2);assert.equal(paint,1,'newly saved logo updates the current DOM');assert.ok(c.resolvedLogos.SH600000.url);c.lookupLogo('SH600000',true);assert.equal(calls,2,'successful logo reused');
 c.rememberAssetLogos([{symbol:'BAD',logo:'https://unverified.example/logo.png'}]);assert.equal(c.resolvedLogos.BAD,undefined);
 timers.clear();let recoveredCalls=0;c.api=async()=>{if(++recoveredCalls===1)throw Error('temporary network failure');return {url:'/api/logo-image?symbol=RECOVER',source:'verified'}};
 c.lookupLogo('RECOVER');await flush();assert.equal(timers.size,1,'network failures also schedule automatic recovery');[...timers.values()][0].fn();await flush();assert.equal(recoveredCalls,2);assert.equal(c.resolvedLogos.RECOVER.url,'/api/logo-image?symbol=RECOVER','negative expiry cannot block the recovery timer');
 console.log('Logo resolution: catalogue cache immediately available, pending retry, no stale negative cache, deduplication and cached reuse PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
