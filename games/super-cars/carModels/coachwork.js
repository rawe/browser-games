// Hand-built coachwork based on the teaser and the three concept sheets.
// +X is forward. Each panel has intentional edges; wheel openings are actual
// openings in the body, rather than black shapes drawn on a solid shell.
import { facetBuilder, loftStations } from './facetKit.js';
import { capStation, underbody } from './sharedParts.js';

const TYPES = {
  wedge: { nose: 2.245, noseY: .56, noseWidth: .86, roofFront: -.08, roofRear: -.74, roofY: 1.36, belt: .82 },
  wing: { nose: 2.18, noseY: .48, noseWidth: .83, roofFront: .02, roofRear: -.66, roofY: 1.32, belt: .81 },
  pulse: { nose: 2.24, noseY: .60, noseWidth: .91, roofFront: -.12, roofRear: -.80, roofY: 1.34, belt: .84 },
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mirror = ([x, y, z]) => [x, y, -z];

// Make a framed window on a planar quadrilateral. Window and painted surround
// share boundaries, so no floating pillars or overlapping glass are needed.
function windowPanel(paint, glass, corners, inset = .10, side = false) {
  const [a,b,c,d] = corners;
  const center = mix(mix(a,c,.5),mix(b,d,.5),.5);
  const inside = corners.map(p => mix(p,center,inset));
  for (let i=0;i<4;i++) paint.quad(corners[i],corners[(i+1)%4],inside[(i+1)%4],inside[i],3);
  // Broad reflections baked as vertex colors; opaque glass avoids sorting and
  // gives the dark blue windows from the reference at race-camera distances.
  const [ia,ib,ic,id] = inside;
  glass.setColor(side ? [.11,.23,.31] : [.13,.26,.34]);
  glass.triangle(ia,ib,ic);
  glass.setColor(side ? [.065,.14,.20] : [.075,.16,.23]);
  glass.triangle(ia,ic,id);
}

function stationsFor(c) {
  const xs = [c.nose,1.98,1.84,1.73,1.55,1.33,1.11,.93,.82,.64,.22,-.30,-.72,-.84,-.95,-1.13,-1.35,-1.57,-1.75,-1.86,-2.02,-2.24];
  return xs.map(x => {
    const front = Math.max(0,(x-.64)/(c.nose-.64));
    const rear = Math.max(0,(-x-.72)/1.52);
    const width = x>.64 ? 1.025+(c.noseWidth-1.025)*front : 1.025 + .075*Math.sin(rear*Math.PI);
    const arch = Math.max(...[1.33,-1.35].map(ax => Math.abs(x-ax)<.515 ? .47 + Math.sqrt(Math.max(0,.515**2-(x-ax)**2)) : .18));
    const shoulder = Math.max(c.belt + .10 + .045*rear - .32*front,arch+.055);
    const deck = x>.64 ? .83+(c.noseY-.83)*front : .83-.055*rear;
    const lower = arch>.2 ? arch : .19;
    return {x, pts:[[lower,arch>.2 ? width-.045 : width-.14],[Math.max(lower+.018,shoulder-.19),width],[shoulder,width-.015],[Math.max(deck,shoulder-.055),width-.19],[deck,0]]};
  });
}

function sidePanel(g, points, shade=2) {
  g.quad(...points,shade);
  g.quad(...points.map(mirror).reverse(),shade);
}

export function buildCoachwork(kind) {
  const c=TYPES[kind];
  const paint=facetBuilder({contrast: 0}); const carbon=facetBuilder();
  const glass=facetBuilder(); const lights=facetBuilder();
  const stations=stationsFor(c);
  loftStations(paint,stations,4,{0:{shade:1},1:{shade:2},2:{shade:4},3:{shade:3}});
  paint.mirrorZ();
  capStation(paint,stations[0],.37,1,3);
  capStation(paint,stations.at(-1),.48,-1,2);
  underbody(carbon,stations,.15,.88);

  // Painted roof, windscreen surround and broad C-pillars form one cabin.
  const front=[.66,.835,.78];
  const rf=[c.roofFront,c.roofY,.60];
  const rr=[c.roofRear,c.roofY-.025,.61];
  const back=[-1.20,.855,.83];
  paint.quad(rf,mirror(rf),mirror(rr),rr,4);
  windowPanel(paint,glass,[front,mirror(front),mirror(rf),rf],.12);
  windowPanel(paint,glass,[rr,mirror(rr),[-.99,1.105,-.64],[-.99,1.105,.64]],.20);
  windowPanel(paint,glass,[front,rf,rr,back],.18,true);
  windowPanel(paint,glass,[mirror(back),mirror(rr),mirror(rf),mirror(front)],.18,true);
  // Rear sail panels frame the recessed motor deck, as on the teaser.
  sidePanel(paint,[rr,[-1.66,.90,.78],[-1.91,.82,.96],back],3);
  if(kind==='pulse') sidePanel(carbon,[[-.84,1.27,.62],[-1.57,.92,.76],[-1.60,.895,.79],[-.84,1.23,.65]],2);

  // Mirrors attach to the belt line, with a dark rear-facing glass insert.
  for(const s of [-1,1]) {
    carbon.box(.44,.91,s*.84,.13,.045,.22,2);
    paint.box(.43,.955,s*.93,.22,.11,.20,3);
    glass.setColor([.13,.24,.30]);
    glass.quad([.316,.925,s*.86],[.316,.925,s*1.00],[.316,.99,s*1.00],[.316,.99,s*.86]);
  }

  // Door cutlines and angular air intakes follow the body, not floating boxes.
  sidePanel(carbon,[[.59,.80,1.037],[.56,.78,1.039],[.37,.29,1.01],[.39,.28,1.01]],0);
  sidePanel(carbon,[[.39,.28,1.01],[-.68,.29,1.055],[-.68,.30,1.055],[.39,.29,1.01]],0);
  if(kind==='wing') {
    sidePanel(carbon,[[-.37,.77,1.06],[-.78,.87,1.084],[-.74,.36,1.07],[-.55,.39,1.07]],1);
    sidePanel(paint,[[-.31,.77,1.068],[-.39,.80,1.07],[-.57,.37,1.077],[-.48,.35,1.065]],3);
  } else {
    sidePanel(carbon,[[-.59,.73,1.065],[-.81,.78,1.079],[-.77,.46,1.075],[-.70,.48,1.067]],1);
  }
  for(const s of [-1,1]) carbon.box(-.37,.765,s*1.046,.17,.025,.015,2);
  carbon.box(-.01,.18,0,1.57,.10,2.05,2);

  // Engine bay kept above the body surface, with five readable wide louvers.
  carbon.quad([-.99,1.108,.64],[-.99,1.108,-.64],[-2.05,.862,-.67],[-2.05,.862,.67],1);
  const louverCount=kind==='wing'?3:5;
  for(let i=0;i<louverCount;i++) {
    const offset=i*4/(louverCount-1);
    const x=-1.10-offset*.185,y=1.108-offset*.043;
    carbon.box(x,y,0,.135,.035,1.23+i*.014,3);
  }

  // Rear bumper: deeply inset dark band and a sculpted trapezoidal diffuser.
  carbon.box(-2.249,.57,0,.025,.27,1.79,1);
  carbon.quad([-2.278,.43,.86],[-2.278,.43,-.86],[-2.285,.17,-.66],[-2.285,.17,.66],2);
  // Painted chamfers enclose the diffuser rather than a rectangular rear slab.
  sidePanel(paint,[[-2.29,.43,.88],[-2.29,.18,.68],[-2.29,.19,.97],[-2.29,.49,1.01]],3);
  for(const z of [-.66,-.34,0,.34,.66]) carbon.box(-2.29,.275,z,.02,.23,.028,3);
  paint.box(-2.245,.765,0,.035,.09,1.83,3);
  // Light housings and inset lenses with bright centers.
  for(const s of [-1,1]) {
    const z=s*.66, w=kind==='wing'?.56:.34, h=kind==='wing'?.10:.17;
    carbon.box(-2.267,.625,z,.028,h+.06,w+.07,0);
    lights.setColor(kind==='pulse'?[.48,.92,1]:[.9,.035,.015]);
    lights.box(-2.286,.625,z,.014,h,w);
    lights.setColor(kind==='pulse'?[.84,1,1]:[1,.23,.10]);
    lights.box(-2.295,.637,z,.008,h*.43,w*.81);
  }

  // Broad, low nose. Lamps are set into the sloped hood instead of the floor.
  const nx=c.nose;
  carbon.box(nx+.012,.25,0,.035,.17,1.55,1);
  carbon.box(nx-.08,.145,0,.25,.055,1.89,2);
  for(const z of [-.70,0,.70]) carbon.box(nx+.038,.25,z,.025,.17,.035,3);
  function hoodHeight(x,z) {
    const i=stations.findIndex((p,i)=>i<stations.length-1 && x<=p.x && x>=stations[i+1].x);
    const a=stations[Math.max(0,i)],b=stations[Math.max(0,i)+1];
    const at=(station)=>{
      const [, , shoulder,edge,center]=station.pts;
      if(z<=edge[1]) return center[0]+z/edge[1]*(edge[0]-center[0]);
      return edge[0]+(z-edge[1])/(shoulder[1]-edge[1])*(shoulder[0]-edge[0]);
    };
    const t=(x-a.x)/(b.x-a.x);
    return at(a)+(at(b)-at(a))*t;
  }
  for(const s of [-1,1]) {
    if(kind==='pulse') {
      carbon.box(nx+.027,.51,s*.60,.022,.17,.47,1);
      lights.setColor([.76,1,.96]);
      lights.box(nx+.043,.51,s*.60,.012,.105,.37);
      continue;
    }
    const outline=[[nx-.025,.34],[nx-.025,.79],[nx-.30,kind==='wing'?.84:.79],[nx-.30,.34]];
    const to3=(points,lift)=>points.map(([x,z])=>[x,hoodHeight(x,z)+lift,s*z]);
    const face=to3(outline,.014);
    carbon.quad(...(s>0?face.reverse():face),1);
    const cx=outline.reduce((v,p)=>v+p[0],0)/4,cz=outline.reduce((v,p)=>v+p[1],0)/4;
    const lens=to3(outline.map(([x,z])=>[cx+(x-cx)*.63,cz+(z-cz)*.83]),.024);
    lights.setColor(kind==='pulse'?[.76,1,.96]:[1,.94,.77]);
    lights.quad(...(s>0?lens.reverse():lens));
  }

  if(kind==='wing') {
    // Swept twin pedestals, thin blade, painted endplates.
    for(const sign of [-1,1]) {
      const p=[[-1.87,.83,sign*.55],[-2.00,1.29,sign*.55],[-2.17,1.29,sign*.55],[-2.04,.83,sign*.55]];
      const q=p.map(([x,y,z])=>[x,y,z+sign*.075]);
      paint.quad(...(sign>0?q:q.slice().reverse()),2);
      paint.quad(...(sign>0?p.slice().reverse():p),2);
      for(let i=0;i<4;i++) paint.quad(p[i],p[(i+1)%4],q[(i+1)%4],q[i],3);
    }
    carbon.box(-2.00,1.31,0,.38,.055,2.02,3);
    for(const s of [-1,1]) paint.box(-2.00,1.32,s*1.01,.40,.16,.035,3);
    for(const z of [-.14,.14]) {
      carbon.box(-2.278,.405,z,.045,.14,.23,4);
      carbon.box(-2.29,.405,z,.013,.095,.16,0);
    }
  } else if(kind==='pulse') {
    paint.box(-2.16,.88,0,.17,.09,1.96,4);
    carbon.box(-2.28,.345,0,.035,.13,.30,3);
    carbon.box(-2.29,.345,0,.012,.075,.22,0);
  }
  return {paint:paint.build(),carbon:carbon.build(),glass:glass.build(),lights:lights.build()};
}
