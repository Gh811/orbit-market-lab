// Minimal GLB/WebGL viewer for the fixed rover asset; no continuously running loop.
const modelUrl='/assets/models/rover-v1.glb?v=20261012-rover96';
let modelPromise;
function decodeGLB(buffer){
 const view=new DataView(buffer);if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw Error('无效 GLB');
 const length=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length))),binary=28+length;
 if(view.getUint32(24+length,true)!==0x004e4942)throw Error('缺少模型数据');
 const primitive=doc.meshes[0].primitives[0];
 const read=index=>{const a=doc.accessors[index],b=doc.bufferViews[a.bufferView],offset=binary+(b.byteOffset||0)+(a.byteOffset||0),count=a.count*(a.type==='VEC3'?3:1);if(a.componentType===5126)return new Float32Array(buffer,offset,count);if(a.componentType===5123)return new Uint16Array(buffer,offset,count);throw Error('不支持的模型格式')};
 return {positions:read(primitive.attributes.POSITION),normals:read(primitive.attributes.NORMAL),colors:read(primitive.attributes.COLOR_0),indices:read(primitive.indices),bounds:doc.accessors[primitive.attributes.POSITION]};
}
function fetchModel(){if(!modelPromise)modelPromise=fetch(modelUrl).then(r=>{if(!r.ok)throw Error('模型加载失败');return r.arrayBuffer()}).then(decodeGLB).catch(e=>{modelPromise=null;throw e});return modelPromise}
function multiply(a,b){const out=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];return out}
function matrices(angle,aspect){
 const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),model=new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,-1.47,0,1]);
 // Slight elevation shows the solar wings and all four wheels.
 const pitch=.16,cp=Math.cos(pitch),sp=Math.sin(pitch),distance=Math.max(5.2,3.9/aspect+0.9);
 const view=new Float32Array([1,0,0,0,0,cp,sp,0,0,-sp,cp,0,0,0,-distance,1]);
 const near=.1,far=30,f=1/Math.tan(35*Math.PI/360),projection=new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
 return {model,mvp:multiply(projection,multiply(view,model))};
}
const vertex=`attribute vec3 position;attribute vec3 normal;attribute vec3 color;uniform mat4 mvp;uniform mat4 model;varying vec3 vColor;varying vec3 vNormal;void main(){vColor=color;vNormal=mat3(model)*normal;gl_Position=mvp*vec4(position,1.0);}`;
const fragment=`precision mediump float;varying vec3 vColor;varying vec3 vNormal;void main(){vec3 n=normalize(vNormal);float key=max(dot(n,normalize(vec3(-0.6,0.9,1.0))),0.0);float fill=max(dot(n,normalize(vec3(0.8,0.2,-0.5))),0.0);float spec=pow(max(dot(n,normalize(vec3(-0.3,0.5,1.0))),0.0),28.0);vec3 c=vColor*(0.40+key*0.65+fill*0.24)+vec3(0.16)*spec;gl_FragColor=vec4(pow(c,vec3(0.85)),1.0);}`;
export async function mountRover(container,onFailure){
 const data=await fetchModel();
 if(!container.isConnected||container.closest('dialog')?.open===false)throw Error('展舱已关闭');
 const canvas=document.createElement('canvas');canvas.className='petWorldModelCanvas';canvas.setAttribute('aria-label','探测车三维模型');
 const gl=canvas.getContext('webgl',{alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:false});
 if(!gl)throw Error('此设备未提供 WebGL');
 let disposed=false,frame=0,angle=0,draws=0;const buffers=[],shaders=[];let program,observer,visibility;
 const dispose=()=>{if(disposed)return;disposed=true;if(frame)cancelAnimationFrame(frame);observer?.disconnect();if(visibility)document.removeEventListener('visibilitychange',visibility);canvas.removeEventListener('webglcontextlost',lost);for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();};
 const lost=event=>{event.preventDefault();if(disposed)return;dispose();onFailure?.(new Error('三维显示暂不可用'));};canvas.addEventListener('webglcontextlost',lost);
 try{
  const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('三维着色器编译失败');return shader};
  program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('三维程序加载失败');gl.useProgram(program);
  for(const [name,values]of [['position',data.positions],['normal',data.normals],['color',data.colors]]){const buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);const location=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,gl.FLOAT,false,0,0)}
  const index=gl.createBuffer();buffers.push(index);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.indices,gl.STATIC_DRAW);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);
  const mvp=gl.getUniformLocation(program,'mvp'),model=gl.getUniformLocation(program,'model');
  const draw=()=>{frame=0;if(disposed||document.hidden)return;const box=container.getBoundingClientRect();if(box.width<1||box.height<1)return;const dpr=Math.min(window.devicePixelRatio||1,1.5),w=Math.round(box.width*dpr),h=Math.round(box.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const matrix=matrices(angle,w/h);gl.uniformMatrix4fv(mvp,false,matrix.mvp);gl.uniformMatrix4fv(model,false,matrix.model);gl.drawElements(gl.TRIANGLES,data.indices.length,gl.UNSIGNED_SHORT,0);canvas.dataset.drawCount=String(++draws);canvas.dataset.angle=String(angle)};
  const request=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(draw)};
  visibility=()=>{if(!document.hidden)request()};document.addEventListener('visibilitychange',visibility);
  container.append(canvas);observer=new ResizeObserver(request);observer.observe(container);draw();
  return {setAngle(value){angle=Number.isFinite(value)?value:0;request()},dispose,canvas,triangles:data.indices.length/3};
 }catch(error){dispose();throw error}
}
