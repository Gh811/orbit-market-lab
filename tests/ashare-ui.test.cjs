const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(require('path').join(__dirname,'../assets/app.js'),'utf8');
const c={deckPeriodSlots:['15m','4h','6h','1M'],current:()=>({type:'swap',symbol:'BTC'})};vm.createContext(c);
vm.runInContext(app.slice(app.indexOf('function assetMarketType('),app.indexOf('const nfmt=')),c);
assert.equal(c.effectivePeriod({type:'ashare'},'6h'),'1d');assert.equal(c.effectivePeriod({type:'swap'},'6h'),'6h');assert.equal(c.effectivePeriod({type:'ashare'},'15m'),'15m');assert.deepEqual(Array.from(c.deckSlotsFor({type:'ashare'})),['15m','1h','1d','1M']);
vm.runInContext("globalThis.money=fmt",c);assert.equal(c.money(1234.56,{type:'ashare'}),'¥1,234.56');assert.equal(c.money(1234.56,{type:'swap'}),'$1,234.56');assert.equal(c.money(NaN,{type:'ashare'}),'—');
assert.match(app,/assets\.filter\(a=>a\.type==='swap'\)\.map\(a=>a\.symbol\+'-USDT-SWAP'\)/);
console.log('Mixed markets: actual CNY prices, independent period selection and swap-only WebSocket subscriptions PASS');

assert.equal(c.money(100,{type:'swap',symbol:'SH600519'}),'¥100.00','legacy mistaken swap type is repaired only for a venue-prefixed mainland stock');
assert.equal(c.money(100,{type:'swap',symbol:'ZHONGJI'}),'$100.00','OKX Chinese stock-linked perpetual remains dollar quoted');
Object.assign(c,{assets:[{type:'ashare',symbol:'SH600519',groupId:'main'},{type:'ashare',symbol:'SZ002384',groupId:'main'},{type:'swap',symbol:'TRUMP',groupId:'main'}],groups:[{id:'main',name:'自选'}],activeGroupId:'main',selected:'ashare:SH600519',tf:'1d',deckDesktopTf:null,scheme:'redUp',swing:1,toggles:{},targets:{}});
vm.runInContext(app.slice(app.indexOf('function stateSnapshot(){'),app.indexOf('function pendingKey()')),c);
assert.deepEqual(Array.from(c.stateSnapshot().assets,a=>a.type),['ashare','ashare','swap'],'account save and reload retain distinct market types');
