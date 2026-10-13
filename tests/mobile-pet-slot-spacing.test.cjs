const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),s=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');const c={getComputedStyle:()=>({paddingTop:'16px',paddingBottom:'16px',paddingLeft:'14px',paddingRight:'14px'})};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function syncPetSlotSpacing('),s.indexOf('function setupPetSlotSpacing(')),c);
for(const [width,height] of [[320,568],[360,640],[375,667],[390,844],[393,873],[412,915],[430,932],[480,960]]){
 const stageHeight=height-140,values={},stage={getBoundingClientRect:()=>({width,height:stageHeight}),style:{setProperty:(name,value)=>values[name]=parseFloat(value)}};
 c.syncPetSlotSpacing(stage);const lift=values['--pet-lower-lift'];assert.ok(lift>=0&&lift<=160);assert.equal(values['--pet-fit-size'],undefined,'spacing cannot shrink the original artwork');
 const actor=(width-28-16)/3-4,row=(stageHeight-32-16)/2;
 if(lift>0)assert.ok(row-lift>=actor+88-.02,'upward movement keeps artwork and labels inside the row');
 if(height>=844)assert.ok(lift>=90,'lower platforms move visibly closer on tall phones');
}
const values={};c.syncPetSlotSpacing({getBoundingClientRect:()=>({height:0,width:390}),style:{setProperty:(n,v)=>values[n]=v}});assert.equal(Object.keys(values).length,0);
const css=fs.readFileSync(path.join(__dirname,'../assets/styles.css'),'utf8');assert.match(css,/#petHome \.petActor\{width:calc\(100% \+ 8px\)/);assert.doesNotMatch(css,/width:min\(calc\(100% - 8px\),var\(--pet-fit-size/);
console.log('Original pet size preserved; lower platforms, names and artwork lift together with eight phone-size clearance budgets PASS');
