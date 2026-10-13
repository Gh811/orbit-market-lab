const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const events={};let now=0,clicks=0;
class Element{
  constructor(parent=null,interactive=false){this.parent=parent;this.interactive=interactive;this.isConnected=true;this.tagName=interactive?'BUTTON':'DIV';this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k)};}
  closest(selector){if(selector==='[inert]')return null;return this.interactive?this:this.parent?.closest(selector)||null}
  matches(){return false}
  contains(other){for(let n=other;n;n=n.parent)if(n===this)return true;return false}
  click(){clicks++}
}
const parent=new Element(),button=new Element(parent,true),child=new Element(button);
const c={Element,performance:{now:()=>now},navigator:{},setTimeout(){},clearTimeout(){},
window:{innerWidth:428,matchMedia:()=>({matches:false}),addEventListener(){}},
document:{hidden:false,addEventListener:(type,handler)=>{const previous=events[type];events[type]=previous?(event=>{previous(event);handler(event)}):handler}}};
vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/touch.js'),'utf8'),c);
function tap(target=button){events.pointerdown({target,isPrimary:true,button:0,pointerId:1,clientX:100,clientY:100});events.pointerup({pointerId:1})}
function click(target){const e={target,detail:1,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};events.click(e);return e}
tap();const recovered=click(parent);assert.equal(clicks,1);assert.equal(recovered.stopped,true);
tap();click(child);assert.equal(clicks,1,'normal child click is never replayed');
tap();click(new Element());assert.equal(clicks,1,'new page never receives a forwarded click');
tap();now=600;click(parent);assert.equal(clicks,1,'late click is never replayed');
events.pointerdown({target:button,isPrimary:true,button:0,pointerId:1,clientX:100,clientY:100});
events.pointermove({pointerId:1,clientX:150,clientY:100});events.pointerup({pointerId:1});click(parent);
assert.equal(clicks,1,'drag never becomes a click');
console.log('Mobile feedback: recover ancestor-only retargeting, no duplicate normal clicks, no forwarding into new page, stale click and drag suppression: PASS');
