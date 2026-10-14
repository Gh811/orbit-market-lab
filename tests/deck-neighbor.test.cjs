const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const layers=Object.fromEntries(['deckPrevious','deckNext'].map(id=>[id,{inactive:false,style:{setProperty(){assert.fail('Neighbor content must not fade according to swipe distance')}},classList:{toggle(k,v){layers[id].inactive=v}}}]));
const core={};const card={clientWidth:372,style:{setProperty:(key,value)=>core[key]=value}};
const ctx={window:{innerWidth:428},$:id=>id==='deckCard'?card:layers[id]};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function deckNeighborReveal('),source.indexOf('const deckColorStore=')),ctx);
for(const dx of [1,30,150,186,220,300,-1,-30,-150,-186,-220,-300]){
  ctx.deckNeighborReveal(dx);
  assert.equal(layers.deckPrevious.inactive,dx<0);
  assert.equal(layers.deckNext.inactive,dx>0);
  const transform=ctx.deckSlideTransform(dx);
  assert.ok(transform.startsWith('translate3d('+dx+'px,'));assert.match(transform,/rotateY\(/);assert.match(transform,/rotateZ\(/);assert.doesNotMatch(transform,/NaN|Infinity/);
}
ctx.deckNeighborReveal(0);assert.equal(layers.deckPrevious.inactive,true);assert.equal(layers.deckNext.inactive,true);
ctx.deckNeighborReveal(-186);assert.equal(layers.deckNext.style.transform,'translate3d(0,0,-70px)','half swipe brings the incoming card halfway out of screen depth');
ctx.deckNeighborReveal(-372);assert.equal(layers.deckNext.style.transform,'translate3d(0,0,0px)','incoming card reaches the exact handoff position');
ctx.deckNeighborReveal(0,true);assert.equal(layers.deckNext.inactive,false,'cancel keeps incoming card visible while it settles');assert.equal(layers.deckNext.style.transform,'translate3d(0,0,-140px)');assert.match(layers.deckNext.style.transition,/300ms/);
ctx.deckNeighborReveal(0);assert.equal(layers.deckNext.inactive,true);

const css=fs.readFileSync(require('node:path').join(__dirname,'../assets/styles.css'),'utf8').split('/* Mobile cards reveal their contents')[1];
assert.match(css,/\.deckNeighbor\{opacity:1/);assert.match(css,/\.deckNeighbor> \*\{opacity:1;transition:none\}/);assert.match(css,/width:34px;height:34px/);
assert.doesNotMatch(css,/--neighbor-reveal/);
console.log('Progressive neighbor reveal: readable from first pixel, correct direction, reversible horizontal movement, opaque backing and bounded logo: PASS');

const flip=source.slice(source.indexOf('function flipDeck('),source.indexOf('// 复用原图表'));
assert.doesNotMatch(flip,/opacity='0'/);assert.doesNotMatch(flip,/deckSlideTransform\(dir\*window.innerWidth\)/);
assert.match(flip,/deckSlideTransform\(0\)/);

assert.equal(ctx.deckSlideTransform(0),'translate3d(0px,0px,0px) rotateY(0deg) rotateZ(0deg)');
assert.match(ctx.deckSlideTransform(-186),/rotateY\(-13deg\)/);
assert.match(ctx.deckSlideTransform(186),/rotateY\(13deg\)/);
// 前牌不后退穿过正在浮出的邻牌；牌芯不再单独随拖动横移。
for(const dx of [-372,-300,-186,-30,30,186,300,372]){
  ctx.deckNeighborReveal(dx);
  const frontZ=Number(ctx.deckSlideTransform(dx).match(/translate3d\([^,]+,[^,]+,([^p]+)px\)/)[1]);
  const incoming=dx<0?layers.deckNext:layers.deckPrevious;
  const backZ=Number(incoming.style.transform.match(/translate3d\(0,0,([^p]+)px\)/)[1]);
  assert.ok(frontZ>=0&&backZ<=0&&frontZ>backZ,'front and incoming depth order never crosses');
}
ctx.window.matchMedia=()=>({matches:true});ctx.deckNeighborReveal(-186);assert.equal(layers.deckNext.style.transform,'translate3d(0,0,0px)','reduced motion disables depth movement');assert.equal(ctx.deckSlideTransform(80),'translate3d(80px,0,0)');
assert.match(css,/\.deckStack i:nth-child\(1\)/);assert.match(css,/\.deckStack\[hidden\]/);
// Equal-distance left/right swipes use mirrored rotation and identical depth/lift.
ctx.window.matchMedia=()=>({matches:false});
for(const distance of [15,60,186,300,372]){
 const parse=dx=>ctx.deckSlideTransform(dx).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px\) rotateY\(([^d]+)deg\) rotateZ\(([^d]+)deg\)/).slice(1).map(Number);
 const left=parse(-distance),right=parse(distance);assert.equal(left[0],-right[0]);assert.equal(left[1],right[1]);assert.equal(left[2],right[2]);assert.equal(left[3],-right[3]);assert.equal(left[4],-right[4]);
 ctx.deckNeighborReveal(-distance);const incomingNext=layers.deckNext.style.transform;ctx.deckNeighborReveal(distance);assert.equal(layers.deckPrevious.style.transform,incomingNext,'incoming cards have equal depth at equal swipe distances');
}
const edgeCSS=css.slice(css.indexOf('/* 卡牌独立实体：'));
assert.match(edgeCSS,/transform:translate\(0,9px\) scaleX\(1\.015\)/,'centered core gives both sides equal thickness');
assert.match(edgeCSS,/\.deckNeighbor\.previous,\s*#petDeck:not\(\.deckChartMode\) \.deckNeighbor\.next\{z-index:1\}/,'both incoming directions use the same layer');
assert.match(edgeCSS,/box-shadow:0 9px 14px/,'outer shadow has no fixed right bias');
console.log('Card edges: centered symmetric thickness and shadow, equal neighbor layers, mirrored swipe rotation and equal depth PASS');

for(const distance of [15,60,186,300,372]){
 ctx.deckNeighborReveal(-distance);const right=Number.parseFloat(core['--deck-core-x']);
 ctx.deckNeighborReveal(distance);const left=Number.parseFloat(core['--deck-core-x']);
 assert.ok(right>0&&left<0,'slab projects on the visible edge for either direction');assert.ok(Math.abs(right+left)<.001,'equal swipe distances expose equal mirrored thickness');assert.ok(Math.abs(left)<=6.14,'projected edge stays inside physical thickness');
}
ctx.deckNeighborReveal(0);assert.equal(Number.parseFloat(core['--deck-core-x']),0,'resting slab remains centered');
const finalEdge=css.slice(css.indexOf('/* Both exposed edges'));
assert.match(finalEdge,/translate\(var\(--deck-core-x,0px\),7px\) scaleX\(1\.008\)/);assert.match(finalEdge,/box-shadow:0 9px 0/);
console.log('Mirrored slab projection PASS: same edge width in both directions, centered at rest, bounded thickness and neutral outer shadow');
