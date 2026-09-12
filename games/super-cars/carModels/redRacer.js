// The title-screen hero, built as deliberate surface panels and real recesses.
// This model is independent of the two rival bodies.
import { ShapeUtils, Vector2 } from 'three';
import { facetBuilder } from './facetKit.js';
import { applyRedOcclusion } from './redOcclusion.js';

const M=([x,y,z])=>[x,y,-z];
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export const HERO_WHEEL_SCALE=.83;
export const HERO_WHEEL_RADIUS=.47*HERO_WHEEL_SCALE;
const ARCH=.408;
const PROFILE=[
// x, central deck, shoulder, width
 [2.27,.555,.59,.85],[2.06,.64,.73,.95],[1.78,.735,.850,1.015],
 [1.33,.835,.915,1.035],[.77,.89,.940,1.028],[.57,.90,.95,1.02],
 [0,.885,.955,1.025],[-.72,.86,.99,1.078],[-1.05,.845,1.035,1.085],[-1.35,.83,1.04,1.095],[-1.50,.82,1.04,1.095],
 [-1.83,.90,1.015,1.08],[-2.24,.925,.99,1.025],
];
function section(x){
 let i=PROFILE.findIndex((a,i)=>i<PROFILE.length-1&&x<=a[0]&&x>=PROFILE[i+1][0]);i=Math.max(i,0);
 const a=PROFILE[i],b=PROFILE[i+1],t=(x-a[0])/(b[0]-a[0]);return a.slice(1).map((v,i)=>v+(b[i+1]-v)*t);
}
export function heroStations(){
 const xs=new Set([...PROFILE.map(p=>p[0]),-1.5252,-1.2445]);
 for(const ax of [1.33,-1.35])for(const d of [-.423,-.408,-.360,-.265,-.137,0,.137,.265,.360,.408,.423])xs.add(ax+d);
 return [...xs].sort((a,b)=>b-a).map(x=>{
  const [deck,shoulder,width]=section(x);
  const skirt=.19+.15*Math.max(0,Math.min(1,(-x-1.60)/.30));
  const wheelHeight=Math.max(...[1.33,-1.35].map(ax=>Math.abs(x-ax)<=ARCH+1e-8?HERO_WHEEL_RADIUS+Math.sqrt(Math.max(0,ARCH*ARCH-(x-ax)**2)):.19));
  const arch=Math.max(skirt,wheelHeight),overWheel=wheelHeight>.19;
  const middle=Math.max(arch+.009,shoulder-.23);
  return {x,pts:[[arch,overWheel?width-.025:width-.10],[middle,width-(overWheel?0:.05)],[shoulder,width],[deck+.08,width-.22],[deck,0]]};
 });
}

export function buildRedRacer({occlusion=true}={}){
 const paint=facetBuilder({contrast:0}),carbon=facetBuilder({contrast:0}),glass=facetBuilder({contrast:0}),lights=facetBuilder({contrast:0});
 const surfaces={paint,carbon,glass,lights};
 const hoodTriangles=[];
 // Panel helper: explicit outward normals remove ambiguous winding from hand modelling.
 function face(g,points,tone=.9,normal){
  let p=points;
  if(normal){const a=p[0],b=p[1],c=p[2],u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(n.reduce((s,v,i)=>s+v*normal[i],0)<0)p=[...p].reverse();}
  g.setColor(Array.isArray(tone)?tone:[tone,tone,tone]);
  const emit=(a,b,c)=>{
   if(normal){
    const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(cross.reduce((sum,n,i)=>sum+n*normal[i],0)<0)[b,c]=[c,b];
   }
   g.triangle(a,b,c);
  };
  if(p.length>4){
   const n=normal ?? [0,1,0];
   const drop=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
   const axes=[0,1,2].filter(i=>i!==drop);
   for(const t of ShapeUtils.triangulateShape(p.map(v=>new Vector2(v[axes[0]],v[axes[1]])),[]))emit(...t.map(i=>p[i]));
  }else for(let i=1;i<p.length-1;i++)emit(p[0],p[i],p[i+1]);
 }
 function sides(g,points,tone){face(g,points,tone,[0,0,1]);face(g,points.map(M),tone,[0,0,-1]);}
 function inset(g,outer,inner,tone,normal){for(let i=0;i<outer.length;i++)face(g,[outer[i],outer[(i+1)%outer.length],inner[(i+1)%inner.length],inner[i]],tone*(i%2?.88:1),normal);}
 const stations=heroStations();
 for(let i=0;i<stations.length-1;i++) {
  const a=stations[i],b=stations[i+1];
  for(let j=0;j<2;j++) {
   if(a.x<=.57+1e-8 && b.x>=-.72-1e-8)continue;
   if(j===1 && a.x<=-.72)continue;
   if(a.x<=-.72)continue;
   // The engine well is an opening, not a black plane on a solid hood.
   if(j===3&&a.x<=-.72)continue;
   const p=[[a.x,...a.pts[j]],[a.x,...a.pts[j+1]],[b.x,...b.pts[j+1]],[b.x,...b.pts[j]]];
   const tones=[.55,.79,1.02,.94];
   const tone=tones[j]*(j===1&&i%4===0?.94:1);
   if(j===1&&a.x<-.72){
    sides(paint,[p[0],p[1],p[2]],tone*1.10);sides(paint,[p[0],p[2],p[3]],tone*.91);
   } else {face(paint,p,tone,[0,0,1]);face(paint,p.map(M),tone,[0,0,-1]);}
  }
 }
 // Rear quarter control points traced from the title and ray-projected onto
 // the side surface with the fitted reference camera. Both sides share topology.
 // Sculpted-depth corners retain title pixels B=(478,397), C=(513,378),
 // D=(554,368), L=(455,480), Q=(588,369); depth edits must preserve those projections.
 const ridge=[[-.72,.99,1.078],[-.9077,.9114,1.075],[-1.18407,.96985,1.020],[-1.54824,1.00131,1.000],[-1.92810,1.01817,1.055],[-2.24,.99,1.025]];
 const [front,Q,D,C,B,A]=ridge;
 const K=[-2.2783,.7164,.99],J=[-1.9245,.2547,.88],H=[-1.7816,.2556,1.0];
 const L=[-2.05502,.70473,1.025],F=[-1.5252,.800,1.08],E=[-1.2445,.8001,1.08];
 const G=[-1.35,.831,1.095],Mcorner=[-2.1854,.8645,1.01];
 const rawArc=stations.filter(p=>p.x>-1.7816&&p.x<-.72).map(p=>[p.x,...p.pts[0]]);
 const arc=rawArc.map(p=>Math.abs(p[0]+1.35)<=ARCH+1e-7?[p[0],p[1]+.014,p[2]+.010]:p);
 for(let i=0;i<arc.length-1;i++)if(arc[i]!==rawArc[i]&&arc[i+1]!==rawArc[i+1]){
  sides(paint,[arc[i],rawArc[i],rawArc[i+1],arc[i+1]],.83);
 }
 sides(paint,[A,B,Mcorner],.97);sides(paint,[B,L,Mcorner],.88);
 sides(paint,[A,Mcorner,K],.83);sides(paint,[Mcorner,L,K],.72);
 sides(paint,[B,C,F],[1.12,1.60,2.0]);sides(paint,[B,F,L],.91);
 const archHighlight=lerp(C,D,.55);
 sides(paint,[C,archHighlight,E],[1.2,2.0,3.0]);
 // Vertex colours multiply the red pigment in linear space; its blue channel
 // needs a larger multiplier for the title’s pale orange highlight.
 sides(paint,[archHighlight,D,E],[2.5,9.0,70.0]);
 sides(paint,[C,E,G],[1.02,1.25,1.1]);sides(paint,[C,G,F],.93);
 sides(paint,[K,L,H,J],.70);
 const rearArchBreak=[-1.6516,.7184,1.06];
 sides(paint,[F,L,rearArchBreak],.92);
 const archBreak=[rearArchBreak[0],HERO_WHEEL_RADIUS+Math.sqrt(ARCH*ARCH-(rearArchBreak[0]+1.35)**2)+.014,section(rearArchBreak[0])[2]-.015];
 sides(paint,[L,H,...arc.filter(p=>p[0]<rearArchBreak[0]).reverse(),archBreak,rearArchBreak],.78);
 sides(paint,[rearArchBreak,archBreak,...arc.filter(p=>p[0]>rearArchBreak[0]&&p[0]<=F[0]+1e-7).reverse(),F],.86);
 sides(paint,[E,G,F,...arc.filter(p=>p[0]>=F[0]-1e-7&&p[0]<=E[0]+1e-7).reverse()],.93);
 sides(paint,[D,Q,front,[-.72,.19,.978],...arc.filter(p=>p[0]>=E[0]-1e-7),E],.94);
 for(let i=0;i<ridge.length-1;i++){
  const a=ridge[i],b=ridge[i+1];
  const inner=p=>{const [deck,,width]=section(p[0]);return [p[0],deck+.08,width-.22];};
  const q=[a,inner(a),inner(b),b];
  // Two broad facets keep the shoulder convex without small artificial peaks.
  for(const [t,tone] of [[[q[0],q[1],q[2]],1.04],[[q[0],q[2],q[3]],1.12]]){
   face(paint,t,tone,[0,1,0]);face(paint,t.map(M),tone,[0,1,0]);
  }
 }
 // Broad hood panels meet along two converging creases, independent of
 // wheel tessellation. The ridge heights still rise continuously rearward.
 const topStations=PROFILE.map(p=>stations.find(s=>Math.abs(s.x-p[0])<1e-8));
 const topPanel=(q,tone,faceted=false)=>{
  hoodTriangles.push([q[0],q[1],q[2]],[q[0],q[2],q[3]]);
  if(faceted){
   for(const [t,shade] of [[[q[0],q[1],q[2]],tone*.91],[[q[0],q[2],q[3]],tone*1.07]]){
    face(paint,t,shade,[0,1,0]);face(paint,t.map(M),shade,[0,1,0]);
   }
  }else{face(paint,q,tone,[0,1,0]);face(paint,q.map(M),tone,[0,1,0]);}
 };
 const crease=station=>{
  const t=Math.max(0,Math.min(1,(2.27-station.x)/1.70));
  return [station.x,station.pts[4][0]+.06*t,.08+.42*t];
 };
 for(let i=0;i<topStations.length-1;i++)for(let j=2;j<4;j++){
  const a=topStations[i],b=topStations[i+1];
  if(a.x<=-.72||(a.x<=.57+1e-8&&b.x>=-.72-1e-8))continue;
  const q=[[a.x,...a.pts[j]],[a.x,...a.pts[j+1]],[b.x,...b.pts[j+1]],[b.x,...b.pts[j]]];
  if(j===3){
   const ca=crease(a),cb=crease(b);
   const edge=p=>[p[0],p[1]+.004,p[2]+.005+.025*Math.max(0,Math.min(1,(2.27-p[0])/1.70))];
   const ea=edge(ca),eb=edge(cb);
   topPanel([q[0],ea,eb,q[3]],1.02);
   topPanel([ea,ca,cb,eb],1.23);
   topPanel([ca,q[1],q[2],cb],i%2?.95:1.0,true);
  }else topPanel(q,1.0);
 }
 face(carbon,[[2.20,.15,-.82],[-2.20,.15,-.90],[-2.20,.15,.90],[2.20,.15,.82]],.55,[0,-1,0]);
 // Angular fender lips with recessed dark inner walls.
 for(const ax of [1.33,-1.35]){
  const arc=stations.filter(p=>Math.abs(p.x-ax)<=ARCH+1e-7);
  for(let i=0;i<arc.length-1;i++){
   const a=arc[i],b=arc[i+1],pa=[a.x,...a.pts[0]],pb=[b.x,...b.pts[0]];
   const inner=p=>[ax+(p[0]-ax)*.88,HERO_WHEEL_RADIUS+(p[1]-HERO_WHEEL_RADIUS)*.88,p[2]-.025];
   sides(carbon,[pa,pb,inner(pb),inner(pa)],.48);
  }
 }
 // Engine surround uses broad panels, not the many wheel-opening samples.
 const wellTop=[-.99,1.215,.49],wellBottom=[-2.065,.978,.538];
 const collarX=[-.99,-1.10,-1.35,-1.83,-2.065];
 const collarOuter=x=>{const [deck,,w]=section(x);return [x,deck+.08,w-.22];};
 const collarInner=x=>lerp(wellTop,wellBottom,Math.max(0,Math.min(1,(-x-.99)/1.075)));
 for(let i=0;i<collarX.length-1;i++){
  const a=collarX[i],b=collarX[i+1];
  const q=[collarOuter(a),collarInner(a),collarInner(b),collarOuter(b)];
  face(paint,q,.96,[0,1,0]);face(paint,q.map(M),.96,[0,1,0]);
 }
 // A wider, lower greenhouse with a subtly crowned painted roof.
 const wf=[.50,.92,.81],rf=[.25,1.245,.48],rr=[-.98,1.25,.55],wb=[-.77,.99,.80];
 const sideRear=[-.45,1.18,.54],sideFront=[.25,1.21,.48],sideFoot=[.50225,.85935,.81];
 // A broad roof crown follows the title silhouette without raising the window edges.
 const fractions=[0,.21,.5,.79,1];
 const roofFront=fractions.map(t=>lerp(M(rf),rf,t));
 const roofRear=fractions.map(t=>lerp(M(rr),rr,t));
 const roofMiddle=fractions.map((t,i)=>{
  const p=lerp(roofFront[i],roofRear[i],.65/1.23);
  if(i>0&&i<4)p[1]=i===2?1.330:1.318;
  return p;
 });
 for(const [a,b] of [[roofFront,roofMiddle],[roofMiddle,roofRear]])for(let i=0;i<4;i++){
  face(paint,[a[i],a[i+1],b[i+1],b[i]],i===0||i===3?.96:1.04,[0,1,0]);
 }
 function window(outer,normal,frame=.095,side=false){
  const center=outer.reduce((s,p)=>s.map((v,i)=>v+p[i]/outer.length),[0,0,0]);
  const inner=outer.map(p=>lerp(p,center,frame));
  inset(paint,outer,inner,.92,normal);
  const seal=inner.map(p=>lerp(p,center,.027));inset(carbon,inner,seal,.40,normal);
  if(side){
   // The rear quarter pane and its diagonal divider are visible in the title.
   const upper=lerp(seal[2],seal[1],.24),lower=lerp(seal[3],seal[0],.26);
   const upperFrame=lerp(upper,seal[1],.018),lowerFrame=lerp(lower,seal[0],.018);
   face(glass,[seal[2],seal[3],lower,upper],[.10,.22,.31],normal);
   face(carbon,[upper,lower,lowerFrame,upperFrame],.25,normal);
   face(glass,[seal[0],seal[1],upperFrame],[.31,.60,.82],normal);
   face(glass,[seal[0],upperFrame,lowerFrame],[.23,.47,.64],normal);
  }else{
   face(glass,[seal[0],seal[1],seal[2]],[.18,.38,.54],normal);
   face(glass,[seal[0],seal[2],seal[3]],[.26,.49,.65],normal);
  }
 }
 window([wf,M(wf),M(rf),rf],[1,1,0],.085);
 window([sideFoot,sideFront,sideRear,wb],[0,0,1],.07,true);window([M(sideFoot),M(sideFront),M(sideRear),M(wb)],[0,0,-1],.07,true);
 sides(paint,[sideFront,rf,rr,sideRear],1.01);
 sides(paint,[wf,rf,sideFront],.87);
 sides(paint,[wf,sideFront,sideFoot],.87);
 face(carbon,[[.57,.965,.80],[.57,.965,-.80],M(wf),wf],.42,[0,1,0]);
 const pillarFold=[-1.1872,.9976,.88]; // Title corner (528,359).
 sides(paint,[rr,sideRear,wb,pillarFold],[1.35,2.4,3.0]);
 sides(paint,[rr,pillarFold,[-1.35,.91,.875]],[1.05,1.4,1.8]);
 const sailReturn=[rr,wellTop,[-1.35,.91,.875]];
 face(paint,sailReturn,.88,[0,1,0]);face(paint,sailReturn.map(M),.88,[0,1,0]);
 // Simple dark cockpit visible through the blue-tinted glass.
 carbon.box(-.12,.916,0,1.48,.035,1.34,0);
 carbon.box(.40,.935,0,.17,.09,1.20,1);
 for(const z of [-.30,.30]) {
   carbon.box(-.40,.92,z,.15,.37,.30,1);
   carbon.box(-.43,1.13,z,.10,.13,.22,2);
   carbon.box(-.13,.84,z,.45,.07,.30,1);
 }
 // Painted rear sail panels and a deep tapering louver well.

 face(paint,[rr,M(rr),M(wellTop),wellTop],.9,[0,1,0]);
 const outer=[wellTop,M(wellTop),M(wellBottom),wellBottom];
 const inner=[[-1.03,1.170,.46],[-1.03,1.170,-.46],[-2.025,.933,-.493],[-2.025,.933,.493]];
 inset(carbon,outer,inner,.52,[0,1,0]);face(carbon,inner,.35,[0,1,0]);
 // The title has a blue upper rear window and three broad overlapping shutters.
 const rearGlassPoint=(x,z)=>[x,inner[0][1]+(x-inner[0][0])/(inner[3][0]-inner[0][0])*(inner[3][1]-inner[0][1])+.004,z];
 const glassTopNear=rearGlassPoint(-1.04,.45),glassTopFar=M(glassTopNear);
 const glassBottomNear=rearGlassPoint(-1.44,.475),glassBottomFar=M(glassBottomNear);
 const ga=lerp(glassTopFar,glassTopNear,.20),gb=lerp(glassTopFar,glassTopNear,.88);
 const gc=lerp(glassBottomFar,glassBottomNear,.85),gd=lerp(glassBottomFar,glassBottomNear,.20);
 face(glass,[glassTopFar,ga,gd,glassBottomFar],[.035,.065,.10],[0,1,0]);
 face(glass,[ga,gb,gc,gd],[.105,.255,.38],[0,1,0]);
 face(glass,[gb,glassTopNear,glassBottomNear,gc],[.035,.060,.09],[0,1,0]);
 const cheek=[wellTop,wellBottom,[-2.04,.984,.494],rearGlassPoint(-1.44,.34)];
 for(const q of [cheek,cheek.map(M)]){
  face(carbon,[q[0],q[1],q[2]],[.15,.25,.45],[0,1,0]);
  face(carbon,[q[0],q[2],q[3]],[.20,.35,.60],[0,1,0]);
 }
 const shutterWidth=x=>.34+Math.max(0,Math.min(1,(-x-1.44)/.60))*.154;
 for(let i=0;i<3;i++){
  const x=-1.51-.21*i,y=1.058-.041*i,a=shutterWidth(x+.105),b=shutterWidth(x-.155);
  face(carbon,[[x+.105,y+.037,a],[x+.105,y+.037,-a],[x-.155,y+.010,-b],[x-.155,y+.010,b]],[.25-i*.025,.45-i*.045,.85-i*.08],[0,1,0]);
  face(carbon,[[x+.105,y+.037,a],[x+.105,y+.037,-a],[x+.105,y+.014,-a],[x+.105,y+.014,a]],.25,[-1,0,0]);
  face(carbon,[[x-.155,y+.010,b],[x-.155,y+.010,-b],[x-.155,y-.020,-b],[x-.155,y-.020,b]],.28,[-1,0,0]);
 }

 // Actual angular side intake, sill crease and door panel instead of a flat slab.
 const doorTopF=[.57,.84,1.02],doorTopR=[-.72,.99,1.078];
 const doorWaistF=[.38,.50,.905],doorWaistR=[-.50,.50,.920];
 const doorLowF=[.57,.19,.92],doorLowR=[-.72,.19,.978];
 for(const q of [[sideFoot,wb,doorTopR,doorTopF],[sideFoot,wb,doorTopR,doorTopF].map(M)])face(paint,q,1.03,[0,1,0]);
 for(const q of [[wb,pillarFold,[-1.35,.91,.875],[-.9077,.9114,1.075],doorTopR],[wb,pillarFold,[-1.35,.91,.875],[-.9077,.9114,1.075],doorTopR].map(M)])face(paint,q,1.01,[0,1,0]);
 for(const q of [[doorTopF,[.57,.95,1.02],wf,sideFoot],[doorTopF,[.57,.95,1.02],wf,sideFoot].map(M)])face(paint,q,.95,[0,1,0]);
 sides(paint,[doorTopF,doorTopR,doorWaistR,doorWaistF],.80);
 sides(paint,[doorWaistF,doorWaistR,doorLowR,doorLowF],.62);
 sides(paint,[doorTopF,doorWaistF,doorLowF],.87);
 sides(paint,[doorTopR,doorLowR,doorWaistR],1.02);
 // Close the return folds where the inset door meets the quarter-panel waist.
 sides(paint,[doorTopR,[-.72,.76,1.028],doorLowR],.79);
 sides(paint,[doorTopF,doorLowF,[.57,.72,.97]],.79);
 
 
 
 for(const s of [-1,1]){
  carbon.box(-.32,.86,s*1.037,.16,.032,.018,1);
  // A swept mirror housing rather than a rectangular block.
  const a=[.405,.918,s*.85],b=[.541,.9954,s*1.01725],c=[.359,1.0396,s*1.092],d=[.219,.9928,s*1.0115];
  face(paint,[a,b,c,d],.95,[0,1,0]);
  const top=[a,b,c,d],bottom=top.map(([x,y,z])=>[x,y-.095,z]);
  for(let i=0;i<4;i++)face(paint,[top[i],top[(i+1)%4],bottom[(i+1)%4],bottom[i]],.75);
  face(paint,bottom,.5,[0,-1,0]);
  const mirror=[d,c,[.345,.946,s*1.08625],[.233,.9239,s*1.0115]].map(([x,y,z])=>[x-.020,y,z]);
  const mirrorCenter=mirror.reduce((sum,p)=>sum.map((n,i)=>n+p[i]/4),[0,0,0]);
  const mirrorGlass=mirror.map(p=>lerp(p,mirrorCenter,.16));
  inset(carbon,mirror,mirrorGlass,.28,[-1,0,0]);
  face(glass,mirrorGlass,[.08,.18,.25],[-1,0,0]);
 }
 sides(paint,[[.77,.23,1.025],[-.85,.23,1.075],[-.83,.17,1.05],[.77,.17,1.005]],.90);
 sides(carbon,[[.78,.17,1.03],[-.87,.17,1.08],[-.85,.13,1.08],[.78,.13,1.03]],.45);
 // Rear elevations follow the measured title landmarks: lamp centers at .82,
 // a .70 bumper ledge and a shallow valance, rather than a tall flat rear wall.
 const rearNormal=[-1,0,0];
 // The cap meets the inner shoulder edge; extending it to the outer edge
 // overlaps the shoulder triangles and produces flickering highlights.
 const capNear=[-2.24,1.005,.805],capFar=M(capNear);
 const capOuter=collarOuter(-2.065);
 face(paint,[capOuter,wellBottom,capNear],1.0,[0,1,0]);
 face(paint,[M(capOuter),M(wellBottom),capFar],1.0,[0,1,0]);
 const deckCenter=[-2.16,.994,0];
 face(paint,[wellBottom,M(wellBottom),deckCenter],1.09,[0,1,0]);
 face(paint,[M(wellBottom),capFar,deckCenter],1.20,[0,1,0]);
 face(paint,[capFar,capNear,deckCenter],1.04,[0,1,0]);
 face(paint,[capNear,wellBottom,deckCenter],1.12,[0,1,0]);
 face(paint,[capNear,capFar,[-2.24,.99,-1.025],[-2.24,.99,1.025]],.95,rearNormal);
 const lipTop=[[-2.24,.99,1.025],[-2.24,.99,-1.025]];
 const lipChamfer=[[-2.275,.963,.995],[-2.275,.963,-.995]];
 face(paint,[...lipTop,lipChamfer[1],lipChamfer[0]],1.06,[-1,1,0]);
 const lipLower=[[-2.29,.915,.98],[-2.29,.915,.47],[-2.29,.865,.42],[-2.29,.865,-.42],[-2.29,.915,-.47],[-2.29,.915,-.98]];
 face(paint,[...lipChamfer,...lipLower.slice().reverse()],.74,rearNormal);
 for(let i=0;i<lipLower.length-1;i++){
  const a=lipLower[i],b=lipLower[i+1];
  face(carbon,[a,b,[-2.14,b[1]-.045,b[2]],[-2.14,a[1]-.045,a[2]]],.32,[0,-1,0]);
 }
 face(carbon,[[-2.13,.87,.98],[-2.13,.87,-.98],[-2.13,.65,-.98],[-2.13,.65,.98]],.25,rearNormal);
 for(const sign of [-1,1]){
  const P=(x,y,z)=>[x,y,z*sign];
  const socket=[P(-2.29,.932,1.025),P(-2.29,.867,.525),P(-2.29,.717,.58),P(-2.29,.779,.98)];
  // Near-side core corners in the title: (415,449), (342,444), (350,460), (407,464).
  const lens=[P(-2.225,.90866,.98984),P(-2.225,.84083,.57478),P(-2.225,.75192,.61841),P(-2.225,.80917,.94434)];
  const trim=socket.map((p,i)=>lerp(p,lens[i],.70));
  inset(paint,socket,trim,.58,rearNormal);inset(carbon,trim,lens,.30,rearNormal);
  face(paint,[P(-2.24,.99,1.025),socket[0],socket[3],P(-2.2783,.7164,.99)],.83,rearNormal);
  face(lights,lens,[3.0,.025,.01],rearNormal);
  const core=lens.map(([x,y,z])=>[x-.003,.81+(y-.81)*.68,sign*.78+(z-sign*.78)*.87]);
  face(lights,core,[6.5,.65,.22],rearNormal);
  const ledge=[P(-2.21,.72,.52),P(-2.21,.72,.97),P(-2.30,.665,1.035),P(-2.30,.665,.44)];
  face(paint,[socket[3],socket[2],ledge[0],ledge[1]],.65,rearNormal);
  face(paint,ledge,1.02,[-1,1,0]);
  face(paint,[ledge[2],ledge[3],P(-2.28,.545,.46),P(-2.28,.545,.96)],.79,rearNormal);
  const outerLow=P(-1.9245,.2547,.88),innerLow=P(-2.10,.26,.78);
  face(paint,[ledge[2],P(-2.2783,.7164,.99),outerLow,P(-2.28,.545,.96)],.73,rearNormal);
  face(paint,[P(-2.28,.545,.96),outerLow,innerLow,P(-2.25,.52,.82)],.36,rearNormal);
 }
 face(carbon,[[-2.15,.845,.54],[-2.15,.845,-.54],[-2.16,.765,-.53],[-2.16,.765,.53]],.28,rearNormal);
 face(carbon,[[-2.16,.765,.53],[-2.16,.765,-.53],[-2.27,.665,-.49],[-2.27,.665,.49]],.48,[-1,1,0]);
 face(carbon,[[-2.27,.665,.49],[-2.27,.665,-.49],[-2.27,.615,-.46],[-2.27,.615,.46]],.46,rearNormal);
 // The lower opening shares its perimeter with the painted bumper returns.
 // A shallow rim leads into a deeper well; the vanes stay inside that volume.
 face(carbon,[[-2.27,.615,.46],[-2.27,.615,-.46],[-2.25,.52,-.82],[-2.25,.52,.82]],.48,rearNormal);
 const dif=[[-2.25,.52,.82],[-2.25,.52,-.82],[-2.10,.26,-.78],[-2.10,.26,.78]];
 const rim=[[-2.20,.493,.775],[-2.20,.493,-.775],[-2.05,.285,-.737],[-2.05,.285,.737]];
 const well=rim.map(([x,y,z])=>[x+.045,y,z]);
 inset(carbon,dif,rim,1.3,rearNormal);
 inset(carbon,rim,well,.14,rearNormal);face(carbon,well,.06,rearNormal);
 for(const z of [-.27,.27]){
  const vane=[[-2.185,.49,z],[-2.160,.49,z],[-2.040,.287,z],[-2.065,.287,z]];
  face(carbon,vane,.30,[0,0,-1]);
  face(carbon,vane.map(([x,y,pz])=>[x,y,pz+.017]),.30,[0,0,1]);
  face(carbon,[vane[0],vane[3],[-2.065,.287,z+.017],[-2.185,.49,z+.017]],.75,rearNormal);
 }
 // Modern nose: recessed central mouth and angular corner intakes.
 const nose=stations[0];
 const upper=nose.pts.slice(2).map(([y,z])=>[nose.x,y,z]);
 face(paint,[...upper,...upper.slice(0,-1).reverse().map(M),[2.285,.455,-.81],[2.285,.455,.81]],.72,[1,0,0]);
 const mouth=[[2.28,.435,-.35],[2.28,.435,.35],[2.28,.17,.50],[2.28,.17,-.50]];
 const mi=[[2.16,.395,-.29],[2.16,.395,.29],[2.16,.21,.43],[2.16,.21,-.43]];
 inset(carbon,mouth,mi,.75,[1,0,0]);face(carbon,mi,.22,[1,0,0]);
 for(const s of [-1,1]){
  const air=[[2.25,.455,s*.47],[2.19,.515,s*.94],[2.21,.19,s*.98],[2.28,.17,s*.61]];
  const airBack=air.map(([x,y,z])=>[x-.14,.335+(y-.335)*.78,s*.745+(z-s*.745)*.82]);
  inset(carbon,air,airBack,.72,[1,0,0]);face(carbon,airBack,.22,[1,0,0]);
  face(paint,[[2.27,.555,s*.85],[2.19,.515,s*.94],[2.21,.19,s*.98],[2.16,.20,s*1.00],[2.06,.73,s*.95]],.91,[1,0,0]);
  face(paint,[[2.285,.455,s*.35],[2.25,.455,s*.47],[2.28,.17,s*.61],[2.30,.17,s*.50]],.95,[1,0,0]);
  // Narrow angled lamp inside a carbon socket, with a cool white LED core.
  const lamp=[[2.235,.591,s*.36],[2.115,.717,s*.94],[1.83,.762,s*.92],[2.00,.672,s*.40]];
  const height=(x,z)=>{
    let y=-Infinity;
    for(const [a,b,c] of hoodTriangles){
      const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
      if(Math.abs(den)<1e-9)continue;
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
      const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)y=Math.max(y,u*a[1]+v*b[1]+(1-u-v)*c[1]);
    }
    return Number.isFinite(y)?y:.60;
  };
  const onLamp=(u,v,lift)=>{const p=lerp(lerp(lamp[0],lamp[1],u),lerp(lamp[3],lamp[2],u),v);return [p[0],height(p[0],Math.abs(p[2]))+lift,p[2]];};
  const patch=(g,u0,u1,v0,v1,lift,color)=>{
    for(let i=0;i<6;i++)for(let j=0;j<2;j++){
      const a=u0+(u1-u0)*i/6,b=u0+(u1-u0)*(i+1)/6,c=v0+(v1-v0)*j/2,d=v0+(v1-v0)*(j+1)/2;
      face(g,[onLamp(a,c,lift),onLamp(b,c,lift),onLamp(b,d,lift),onLamp(a,d,lift)],color,[0,1,0]);
    }
  };
  patch(carbon,0,1,0,1,.014,.22);
  patch(lights,.08,.93,.14,.37,.025,[1.6,2.2,3.0]);
 }
 carbon.box(2.19,.145,0,.21,.035,1.99,2);
 const result=Object.fromEntries(Object.entries(surfaces).map(([k,g])=>[k,g.build()]));
 if(occlusion)applyRedOcclusion(result.paint);
 return result;
}
