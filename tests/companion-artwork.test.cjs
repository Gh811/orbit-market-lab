const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const context={};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const SPACE_PETS='),source.indexOf('function renderPetArtwork'))+'\nthis.catalog=SPACE_PETS;',context);
assert.equal(context.catalog.length,8);
assert.equal(new Set(context.catalog.map(p=>p.image)).size,8);
assert.equal(context.catalog[0].image,'space-rabbit-3d-v2.png');
for(let kind=0;kind<8;kind++){
 const pet=context.catalog[kind],png=fs.readFileSync(path.join(root,'assets/pets',pet.image));
 const publicName=pet.image.replace('space-','space').replace(/-3d-v\d+/,'');
 const web=fs.readFileSync(path.join(root,'assets/icons/crypto',publicName));
 assert.equal(web.readUInt32BE(16),384);assert.equal(web.readUInt32BE(20),384);assert.equal(web[25],6,'optimized artwork preserves alpha');assert.ok(web.length<png.length/4,'web artwork is substantially smaller than source');
 assert.equal(png[25],6,'RGBA transparency');
 assert.ok(context.spacePetMarkup(kind,'test').includes(publicName));
 assert.ok(!context.spacePetMarkup(kind,'test').includes('hue-rotate'));
}
assert.ok(source.includes("svg.setAttribute('viewBox','0 0 160 160')"));
console.log('Companions: eight distinct illustrations, rabbit replacement, alpha, public mirrors and full artwork bounds PASS');
