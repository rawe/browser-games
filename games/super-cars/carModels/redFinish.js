import * as THREE from 'three';
let cached;
// Small local HDR environment. Broad warm/cool sources give readable reflections
// without network textures or changing the illumination of the rival models.
function reflectionEnvironment(){
 const w=128,h=64,data=new Float32Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const theta=(y+.5)/h*Math.PI,phi=(x+.5)/w*Math.PI*2;
  const up=Math.cos(theta),dx=Math.sin(theta)*Math.cos(phi),dz=Math.sin(theta)*Math.sin(phi);
  const sky=Math.max(0,up),horizon=Math.exp(-up*up*20),warm=Math.exp(-((dx-.65)**2+(up-.20)**2+(dz-.40)**2)*12);
  const strip=Math.exp(-((dx-.15)**2+(up-.65)**2+(dz+.75)**2)*18);
  const i=(y*w+x)*4;
  data[i]=.04+sky*.18+horizon*.5+warm*3+strip*.30;
  data[i+1]=.05+sky*.28+horizon*.16+warm*1.6+strip*.40;
  data[i+2]=.08+sky*.65+horizon*.10+warm*.55+strip*.70;data[i+3]=1;
 }
 const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);
 t.mapping=THREE.EquirectangularReflectionMapping;t.needsUpdate=true;return t;
}
function contactShadow(){
 const size=64,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const r=Math.hypot((x+0.5)/size*2-1,(y+0.5)/size*2-1);
  data[(y*size+x)*4+3]=Math.round(180*Math.max(0,1-r*r)**2);
 }
 const map=new THREE.DataTexture(data,size,size);map.needsUpdate=true;
 return new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,opacity:.85});
}
export function getRedFinish(){
 if(cached)return cached;
 const env=reflectionEnvironment();
 cached={
  env,
  shadow:contactShadow(),
  carbon:new THREE.MeshStandardMaterial({color:0x303640,vertexColors:true,roughness:.85,metalness:.05,envMap:env,envMapIntensity:.35}),
  glass:new THREE.MeshPhysicalMaterial({color:0x83d5ef,vertexColors:true,roughness:.12,metalness:.25,clearcoat:.6,transparent:true,opacity:.90,depthWrite:false,envMap:env,envMapIntensity:.65}),
  rim:new THREE.MeshStandardMaterial({color:0x56616b,vertexColors:true,roughness:.48,metalness:.55,envMap:env,envMapIntensity:.75}),
  lights:new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:true}),
 };
 return cached;
}
export function createRedPaint(color){
 return new THREE.MeshPhysicalMaterial({color:new THREE.Color(color===0xff4b3a?0xff3804:color),vertexColors:true,roughness:.36,metalness:.10,clearcoat:.35,specularIntensity:.65,envMap:getRedFinish().env,envMapIntensity:.5});
}
