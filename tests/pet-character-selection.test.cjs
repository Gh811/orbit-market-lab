const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
class Element{
  constructor(){this.children=[];this.attrs={}}
  setAttribute(name,value){this.attrs[name]=value}
  append(child){this.children.push(child)}
  replaceChildren(){this.children=[]}
}
const own={id:'main',petKind:0},other={id:'ga',petKind:1},box=new Element(),message={};let saved=0;
const c={SPACE_PETS:Array.from({length:8},(_,i)=>({name:'伙伴'+i})),petDraft:null,
  petSlotGroups:()=>[own,other,null],petManagedGroup:()=>own,
  $:id=>id==='petChoices'?box:message,document:{createElement:()=>new Element()},
  setPetManagerNotice(text){message.textContent=text},spacePetMarkup:()=>'',save(){saved++},renderPets(){},window:{MarketTouch:{pulse(){}}}};
vm.createContext(c);vm.runInContext(['appendComingSoonPets','petKindInUse','renderPetChoices'].map(fn).join('\n'),c);
c.renderPetChoices();assert.equal(box.children.length,10);
for(const teaser of box.children.slice(8)){assert.equal(teaser.attrs['aria-disabled'],'true');assert.match(teaser.innerHTML,/敬请期待/);assert.equal(teaser.onclick,undefined)}
assert.equal(box.children[0].disabled,false);assert.equal(box.children[0].attrs['aria-pressed'],'true');
const occupied=box.children[1];assert.equal(occupied.disabled,true);assert.match(occupied.children[0].textContent,/已使用/);
assert.equal(box.children[0].children[0].textContent,'✓ 当前已选');
box.children[0].onclick();assert.equal(saved,0,'current selection does not resave');
occupied.onclick();assert.equal(own.petKind,0);assert.equal(saved,0);
// A choice that becomes occupied after rendering cannot bypass the disabled state.
const stale=box.children[3];other.petKind=3;stale.onclick();assert.equal(own.petKind,0);assert.equal(saved,0);
other.petKind=2;c.renderPetChoices();box.children[3].onclick();assert.equal(own.petKind,3);assert.equal(saved,1);
assert.equal(box.children[0].disabled,false);assert.equal(box.children[3].attrs['aria-pressed'],'true');
assert.equal(box.children[2].disabled,true);
c.petDraft={id:'draft',petKind:4};c.petManagedGroup=()=>c.petDraft;c.renderPetChoices();
assert.equal(box.children[3].disabled,true);assert.equal(box.children[4].disabled,false);
// 创建按钮：默认不预选宠物，标的和宠物都选好才可点。
assert.equal(message.disabled,true,'create stays disabled while the draft has no标的');
c.petDraft={id:'draft',petKind:null,assets:[{symbol:'BTC'}]};c.renderPetChoices();
assert.equal(box.children[0].attrs['aria-pressed'],'false','draft with no pet shows no current choice');
assert.equal(message.disabled,true,'create stays disabled until a pet is picked');
box.children[0].onclick();assert.equal(message.disabled,false,'create enables once标的 and pet are chosen');
other.petKind=own.petKind;c.petDraft=null;c.petManagedGroup=()=>own;c.renderPetChoices();assert.equal(box.children[own.petKind].disabled,false,'own current choice remains available even for legacy duplicate assignments');
console.log('Pet character selection: used stamp and disabled choice, current selection allowed, stale selection rejected, old character released, draft respects existing owners: PASS');
