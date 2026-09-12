// Manual landmark calibration for the original 1536 × 640 title image.
// This estimates perspective; it does not certify artistic fidelity.
// Run: node games/super-cars/dev/fit-title-camera.mjs
import * as THREE from 'three';
let points=[
 ['tail far',[-2.24,.99,-1.025],[87,359]],['tail near',[-2.24,.99,1.025],[427,422]],
 ['rear wheel',[-1.35,.39,1.0165],[533,490]],['front wheel',[1.33,.39,1.0165],[700,369]],
 ['rear top',[-1.35,.78,1.0165],[547,417]],['rear bottom',[-1.35,0,1.0165],[525,568]],
 ['front top',[1.33,.78,1.0165],[708,327]],['front bottom',[1.33,0,1.0165],[694,417]],
];
function project(a){
 const [yaw,pitch,dist,focal,cx,cy]=a;
 const cam=new THREE.PerspectiveCamera(50,1,.01,1000);
 cam.position.set(-Math.cos(yaw)*Math.cos(pitch)*dist, Math.sin(pitch)*dist+.6, Math.sin(yaw)*Math.cos(pitch)*dist);
 cam.lookAt(0,.6,0);cam.updateMatrixWorld();
 return points.map(([name,xyz,ref])=>{let p=new THREE.Vector3(...xyz).applyMatrix4(cam.matrixWorldInverse);return [cx-focal*p.x/p.z,cy+focal*p.y/p.z];});
}
const loss=a=>{
 if(a[0]<.1||a[0]>1.3||a[1]<.05||a[1]>.8||a[2]<3||a[2]>50||a[3]<100||a[3]>10000)return 1e9;
 return project(a).flatMap((p,i)=>p.map((x,k)=>x-points[i][2][k])).reduce((s,x)=>s+x*x,0);
};
// Nelder Mead, deterministic and dependency-free.
function fit(initial,steps,lossFn=loss){
 let simplex=[initial,...initial.map((_,i)=>initial.map((x,k)=>x+(i===k?steps[i]:0)))].map(a=>({a,f:lossFn(a)}));
 for(let it=0;it<7000;it++){
  simplex.sort((a,b)=>a.f-b.f);const n=initial.length,center=initial.map((_,i)=>simplex.slice(0,n).reduce((s,p)=>s+p.a[i]/n,0));
  const op=(factor)=>center.map((x,i)=>x+factor*(center[i]-simplex[n].a[i]));
  const r={a:op(1)};r.f=lossFn(r.a);
  if(r.f<simplex[0].f){const e={a:op(2)};e.f=lossFn(e.a);simplex[n]=e.f<r.f?e:r;}
  else if(r.f<simplex[n-1].f)simplex[n]=r;
  else {const c={a:op(r.f<simplex[n].f?.5:-.5)};c.f=lossFn(c.a);if(c.f<Math.min(simplex[n].f,r.f))simplex[n]=c;else for(let j=1;j<=n;j++){simplex[j].a=simplex[j].a.map((x,i)=>(x+simplex[0].a[i])/2);simplex[j].f=lossFn(simplex[j].a);}}
 }
 simplex.sort((a,b)=>a.f-b.f);return simplex[0];
}
const result=fit([.55,.28,6,800,490,375],[.1,.05,1,200,50,50]);
console.log(result);console.log(project(result.a).map((p,i)=>[points[i][0],p,points[i][2]]));
const [yaw,pitch,dist,focal,cx,cy]=result.a;console.log('camera',[-Math.cos(yaw)*Math.cos(pitch)*dist,Math.sin(pitch)*dist+.6,Math.sin(yaw)*Math.cos(pitch)*dist]);

