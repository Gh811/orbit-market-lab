const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const physics=require('../assets/touch.js');
assert.equal(physics.palette.length,100);
assert.equal(new Set(physics.palette.map(c=>JSON.stringify(c))).size,100);
assert.equal(new Set(physics.palette.map(c=>c.h)).size,25);
assert.equal(new Set(physics.palette.map(c=>c.l)).size,4);
for(let i=0;i<500;i++){
  const values={up:Math.random(),flat:Math.random(),down:Math.random()};
  const result=physics.percentages(values);assert.equal(result.reduce((a,b)=>a+b,0),100);assert.ok(result.every(v=>Number.isInteger(v)&&v>=0));
}
assert.deepEqual(physics.percentages({up:0,flat:0,down:1}),[0,0,100]);
assert.deepEqual(physics.percentages({up:1,flat:1,down:1}),[34,33,33]);
assert.equal(physics.percentages({up:-1,flat:1,down:1}),null);
assert.equal(physics.percentages(undefined),null);
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const snippet=source.slice(source.indexOf('const deckColorStore='),source.indexOf('function buildDeckCard(){'));
const storage=new Map(),assets=Array.from({length:100},(_,i)=>({symbol:'S'+i}));let saves=0;
const context={assets,accountSpace:'alice',assetId:a=>a.symbol,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},window:{MarketPhysics:physics},save(){saves++}};
vm.createContext(context);vm.runInContext(snippet,context);
const colors=assets.map(a=>context.deckColor(a));assert.ok(colors.every(c=>c.s<25),'unknown logos use subdued colors');
const before=saves;assert.deepEqual(assets.map(a=>context.deckColor(a)),colors);assert.equal(saves,before);
const reload={...context,assets:assets.map(a=>({symbol:a.symbol}))};vm.createContext(reload);vm.runInContext(snippet,reload);assert.equal(JSON.stringify(reload.assets.map(a=>reload.deckColor(a))),JSON.stringify(colors),'symbol-based tones survive reload');
console.log('Logo colors: stable refresh/reload and neutral fallback; exact probability rounding and missing-data handling: PASS');
