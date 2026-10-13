const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8'),c={};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function restorePetDragArtwork('),source.indexOf('function wirePetStage(')),c);
let removed=0;const image={href:'/original.png'},model={dataset:{petMood:'happy',artKind:'0'},image};
const ghost={querySelectorAll:q=>q==='.petExpression'?[{remove(){removed++}}]:[model]};
c.restorePetDragArtwork(ghost);assert.equal(removed,1);assert.equal(model.dataset.petMood,undefined);assert.equal(model.image,image);assert.equal(model.dataset.artKind,'0');
const wire=source.slice(source.indexOf('function wirePetStage('),source.indexOf('function petSlotGroups('));assert.match(wire,/restorePetDragArtwork\(ghost\)/);assert.doesNotMatch(wire,/skewX|scale\(1\.06,1\.1\)|scale\(1\.1,\.9\)/);
console.log('Pet drag: strips facial overlays and mood state, original image stays intact, no skew or unequal stretching PASS');
