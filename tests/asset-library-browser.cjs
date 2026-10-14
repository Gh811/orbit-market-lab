const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});try{
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),base='http://127.0.0.1:8132';
assert.equal((await context.request.post(base+'/api/auth/register',{data:{username:'cache'+Date.now(),password:'LocalCacheCheck!100'}})).status(),200);
for(const [symbol,name] of [['SZ301308','江波龙'],['SZ000651','格力电器']]){
const state={assets:[{type:'ashare',symbol,groupId:'main'}],groups:[{id:'main',name:'自选',petKind:0}],activeGroup:'main',selected:'ashare:'+symbol,tf:'1d'};
assert.equal((await context.request.post(base+'/api/user/state',{data:state})).status(),200);
const page=await context.newPage(),errors=[];let infoRequests=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/info?')&&r.url().includes(symbol))infoRequests++});
await page.goto(base+'/');await page.waitForFunction(()=>!document.documentElement.classList.contains('bootLoading'),{},{timeout:60000});
await page.waitForFunction(symbol=>{const raw=localStorage.getItem('orbit_asset_v1:ashare:'+symbol);return raw&&JSON.parse(raw).profile.summary&&!JSON.parse(raw).profile.incomplete},symbol,{timeout:45000});
await page.locator('.petSlot[data-group-id="main"]').press('Enter');await page.waitForTimeout(500);const target=await page.locator('#deckCard .deckLogo').boundingBox();await page.touchscreen.tap(target.x+target.width/2,target.y+target.height/2);await page.waitForFunction(name=>document.querySelector('#assetInfo')?.textContent.includes(name),name);
const fields=await page.locator('#assetInfo .infoMetric small').allTextContents();assert.deepEqual(fields,['交易对','交易平台','状态','最小价格变动','产品类型','基础资产','计价资产']);
await page.locator('#assetInfo .profileIdentity img').waitFor({state:'visible',timeout:10000}).catch(async error=>{console.log(await page.locator('#assetInfo .profileIdentity').innerHTML());console.log(await page.evaluate(async()=>{const c=await caches.open('orbit_asset_images_v1');return(await c.keys()).map(k=>k.url)}));console.log(errors);throw error});assert.equal(await page.locator('#assetInfo .profileIdentity img').count(),1);await page.waitForFunction(()=>{const n=document.querySelector('#assetInfo .profileIdentity img');return n?.complete&&n.naturalWidth>0});
const before=infoRequests;await page.reload();await page.waitForFunction(()=>!document.documentElement.classList.contains('bootLoading'),{},{timeout:60000});await page.waitForTimeout(1500);assert.equal(infoRequests,before,'reopening does not refetch a saved complete profile');
assert(await page.evaluate(async symbol=>{const cache=await caches.open('orbit_asset_images_v1'),rows=await cache.keys();return rows.some(row=>row.url.includes(symbol.toLowerCase()))},symbol),'company image bytes are stored on the phone');
assert.deepEqual(errors,[]);await page.close();console.log(symbol,name,'PASS: correct original logo, shared fields, persisted profile and image, no reload request');
}
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exit(1)});
