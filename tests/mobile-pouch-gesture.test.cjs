const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
const a=source.indexOf('function beginPetPouchGesture('),b=source.indexOf('\nfunction startPetPouchDrag(',a);
let received;const c={startPetPouchDrag(...args){received=args},setTimeout(){assert.fail('Dragging must not wait for a timer')}};
vm.createContext(c);vm.runInContext(source.slice(a,b),c);
const down={pointerId:1,isPrimary:true,button:0,clientX:100,clientY:100},card={};
c.beginPetPouchGesture(down,card);assert.deepEqual(received,[down,card,card]);
console.log('Pouch gesture: direct pointerdown starts card dragging without a long-press delay PASS');
