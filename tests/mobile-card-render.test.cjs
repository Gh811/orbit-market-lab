const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
class Node {
  constructor(){this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};this.hidden=false;this.textContent=''}
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(...nodes){this.children=[...nodes]}
  setAttribute(){}
  addEventListener(){}
  querySelector(){return null}
}
const asset={type:'swap',symbol:'BTC',groupId:'one'},next={type:'swap',symbol:'ETH',groupId:'one'};
const nodes=Object.fromEntries(['deckCard','deckPrevious','deckNext','deckCount','petDeck'].map(id=>[id,new Node()]));
const ctx=vm.createContext({window:{},document:{createElement:()=>new Node()},$:id=>nodes[id],assets:[asset,next],accountSpace:'user',petDeckIndex:0,petDeckGroup:'one',HOT_GROUP_ID:'hot',hotUpdatedAt:0,
  deckMembers:()=>[asset,next],assetId:a=>a.type+':'+a.symbol,save(){},localStorage:{getItem:()=>null,setItem(){}},
  quotes:{'swap:BTC':{p:100,base:99}},profiles:{},fmt:v=>v==null?'—':String(v),logoFor:()=>new Node(),prioritizeAssetDisplay(){},
  openInfoForPreview(){},openDeckChart(){},deckAdd(){},queueProfile(){},renderDeckPeriods(){},resetDeckAnalysis(){},deckEnsureRatio(){},deckMobileTf:'15m'});
vm.runInContext(source.slice(source.indexOf('const ASHARE_PERIODS='),source.indexOf('function priceText(')),ctx);
vm.runInContext(source.slice(source.indexOf('function deckUpdateCount(){'),source.indexOf('function deckSlideTransform(')),ctx);
vm.runInContext(source.slice(source.indexOf("const deckColorStore="),source.indexOf('// 手机卡面与展开图表共享')),ctx);
function descendants(node){return [node,...node.children.flatMap(descendants)]}
// Effects are optional: neither a missing script nor an older script may blank the card.
for(const effects of [undefined,{},require('../assets/touch.js')]){
  ctx.window.MarketPhysics=effects;
  assert.doesNotThrow(()=>ctx.buildDeckCard());
  const rendered=descendants(nodes.deckCard);
  assert.equal(nodes.deckCard.children.length,1);
  assert.ok(rendered.some(node=>node.className==='deckFrame'));
  assert.ok(rendered.some(node=>node.className==='deckSpark'));
  assert.equal(rendered.filter(node=>node.className?.startsWith('deckProbability probabilityCard')).length,3);
  assert.equal(rendered.filter(node=>node.className?.startsWith('deckRatioRow ')).length,2);
  assert.ok(rendered.some(node=>node.id==='deckCardPeriods'));
  assert.equal(nodes.deckPrevious.children.length,1);
  const neighbor=descendants(nodes.deckPrevious);
  assert.ok(neighbor.some(n=>n.className==='deckSpark'));
  assert.equal(neighbor.filter(n=>n.className?.startsWith('deckProbability probabilityCard')).length,3);
  assert.equal(neighbor.filter(n=>n.id==='deckCardPeriods').length,0);
  assert.equal(nodes.deckCount.textContent,'1 / 2');
}
console.log('Mobile cards render full content and neighbors with missing, old, and current effects modules: PASS');

for(const type of ['swap','ashare']){
 asset.type=type;asset.symbol=type==='ashare'?'SZ002384':'BTC';ctx.buildDeckCard();
 const rendered=descendants(nodes.deckCard);
 assert.deepEqual(rendered.filter(n=>n.className==='deckRatioDir').map(n=>n.textContent),['↑ 上行','↓ 下行']);
 assert.ok(!rendered.some(n=>/上行参考|下行参考/.test(n.textContent)));
}
