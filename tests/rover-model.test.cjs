const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('rover GLB has complete, finite indexed geometry and outward normals',()=>{
 const bytes=fs.readFileSync(path.join(__dirname,'../assets/models/rover-v1.glb'));
 assert.ok(bytes.length<512*1024,'mobile model size budget');
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const jsonLength=bytes.readUInt32LE(12);assert.equal(bytes.readUInt32LE(16),0x4e4f534a);
 const doc=JSON.parse(bytes.subarray(20,20+jsonLength).toString());const binStart=28+jsonLength;
 assert.equal(bytes.readUInt32LE(24+jsonLength),0x004e4942);assert.equal(bytes.readUInt32LE(20+jsonLength),bytes.length-binStart);
 assert.equal(doc.images,undefined,'no hidden image downloads');
 const primitive=doc.meshes[0].primitives[0];
 const read=index=>{const a=doc.accessors[index],b=doc.bufferViews[a.bufferView],size=a.type==='VEC3'?3:1,length=a.count*size,offset=binStart+(b.byteOffset||0)+(a.byteOffset||0);assert.ok(offset+length*(a.componentType===5126?4:2)<=bytes.length);return Array.from({length},(_,i)=>a.componentType===5126?bytes.readFloatLE(offset+4*i):bytes.readUInt16LE(offset+2*i))};
 const p=read(primitive.attributes.POSITION),n=read(primitive.attributes.NORMAL),c=read(primitive.attributes.COLOR_0),indices=read(primitive.indices);
 assert.equal(p.length,n.length);assert.equal(p.length,c.length);assert.ok(p.every(Number.isFinite));assert.ok(c.every(v=>v>=0&&v<=1));assert.equal(indices.length%3,0);assert.ok(indices.length/3<10000);
 for(let i=0;i<n.length;i+=3)assert.ok(Math.abs(Math.hypot(...n.slice(i,i+3))-1)<1e-5);
 for(let i=0;i<indices.length;i+=3){const ids=indices.slice(i,i+3);assert.ok(ids.every(id=>id>=0&&id<p.length/3));const a=p.slice(ids[0]*3,ids[0]*3+3),b=p.slice(ids[1]*3,ids[1]*3+3),d=p.slice(ids[2]*3,ids[2]*3+3),u=b.map((v,k)=>v-a[k]),v=d.map((x,k)=>x-a[k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],normal=n.slice(ids[0]*3,ids[0]*3+3);assert.ok(cross.reduce((sum,x,k)=>sum+x*normal[k],0)>=-1e-7,'inverted face '+i/3)}
});
