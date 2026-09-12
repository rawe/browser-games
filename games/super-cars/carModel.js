// Fahrzeug-Zusammenbau: wählt pro Auto eines der drei Facetten-Modelle
// (Roter Keil, Magenta Flügel, Cyan Puls), verwaltet die geteilten Materialien
// und die Räder. Geometrien werden pro Typ einmal gebaut und geteilt; pro Auto
// variiert nur das Lackmaterial. Maße, Ursprung und +X-Vorwärtsachse bleiben
// identisch zur Fahrphysik.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRoterKeil } from './carModels/roterKeil.js';
import { HERO_WHEEL_SCALE as RED_WHEEL_SCALE, HERO_WHEEL_RADIUS as RED_WHEEL_RADIUS } from './carModels/redRacer.js';
import { getRedFinish, createRedPaint } from './carModels/redFinish.js';
import { buildMagentaFluegel } from './carModels/magentaFluegel.js';
import { buildCyanPuls } from './carModels/cyanPuls.js';

const MODEL_BUILDERS = {
  'roter-keil': buildRoterKeil,
  'magenta-fluegel': buildMagentaFluegel,
  'cyan-puls': buildCyanPuls,
};

// Empfohlene Farbzuordnung aus assets/3d-redesign/README.md: Magenta, Violett
// und Blau fahren den Flügel-Typ, die übrigen Rivalen den Cyan-Puls-Typ.
const WING_COLORS = new Set([0xff5ca8, 0xb45cff, 0x3d7bff]);

const modelCache = new Map();

function getModelGeometries(type) {
  if (!modelCache.has(type)) modelCache.set(type, MODEL_BUILDERS[type]());
  return modelCache.get(type);
}

// Annular tire section: the rim opening is real, with a beveled shoulder.
const tireProfile = [[.335,-.15],[.40,-.17],[.455,-.135],[.47,-.095],
  [.47,.095],[.455,.135],[.40,.17],[.335,.15],[.335,-.15]];
const tireShell = new THREE.LatheGeometry(tireProfile.map(([r,y]) => new THREE.Vector2(r,y)),20);
const brakeDisc = new THREE.CylinderGeometry(.292,.292,.025,20);
const TIRE_GEOMETRY = mergeGeometries([tireShell, brakeDisc]);
tireShell.dispose(); brakeDisc.dispose();
TIRE_GEOMETRY.rotateX(Math.PI / 2);

const redTireProfile = [[.385,-.15],[.422,-.17],[.457,-.135],[.47,-.095],
  [.47,.095],[.457,.135],[.422,.17],[.385,.15],[.385,-.15]];
const redTireShell=new THREE.LatheGeometry(redTireProfile.map(([r,y])=>new THREE.Vector2(r,y)),24);
const redBrakeDisc=new THREE.CylinderGeometry(.335,.335,.025,24);
const RED_TIRE_GEOMETRY=mergeGeometries([redTireShell,redBrakeDisc]);
redTireShell.dispose();redBrakeDisc.dispose();RED_TIRE_GEOMETRY.rotateX(Math.PI/2);

function buildRimGeometry(spokes = 5) {
  const red=spokes===10,segments=red?24:20;
  const parts=[];
  const lip = new THREE.TorusGeometry(.331,.018,4,segments);
  lip.rotateX(Math.PI/2); lip.translate(0,.153,0); parts.push(lip);
  const innerLip = new THREE.TorusGeometry(.295,.012,4,segments);
  innerLip.rotateX(Math.PI/2); innerLip.translate(0,.14,0); parts.push(innerLip);
  for(let i=0;i<spokes;i++) {
    let spoke;
    if(red){
      const profile=new THREE.Shape();profile.moveTo(.075,-.022);profile.lineTo(.115,.035);profile.lineTo(.300,.025);profile.lineTo(.305,-.014);profile.closePath();
      spoke=new THREE.ExtrudeGeometry(profile,{depth:.035,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.004,bevelThickness:.004});
      spoke.rotateX(Math.PI/2);spoke.translate(0,.17,0);
    }else{spoke=new THREE.BoxGeometry(.235,.055,.065);spoke.translate(.178,.15,0);}
    spoke.rotateY(i*Math.PI*2/spokes);parts.push(spoke);
  }
  const hub=new THREE.CylinderGeometry(.092,.092,.08,10);
  hub.translate(0,.15,0); parts.push(hub);
  if(red)parts.forEach((part,i)=>{
    const shade=i===0?[1.35,1.40,1.45]:i===1?[.52,.56,.61]:[.25,.28,.32];
    const colors=new Float32Array(part.attributes.position.count*3);
    for(let j=0;j<colors.length;j+=3)colors.set(shade,j);
    part.setAttribute('color',new THREE.BufferAttribute(colors,3));
  });
  const merged=mergeGeometries(parts.map(p=>p.index?p.toNonIndexed():p));
  parts.forEach(p=>p.dispose());
  merged.rotateX(Math.PI/2);
  return merged;
}
const RIM_GEOMETRY = buildRimGeometry();
const RED_RIM_GEOMETRY = buildRimGeometry(10);
RED_RIM_GEOMETRY.scale(1.14,1.14,1);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(2.22, 14);

let sharedMaterials;

function getSharedMaterials() {
  if (sharedMaterials) return sharedMaterials;
  sharedMaterials = {
    carbon: new THREE.MeshLambertMaterial({ color: 0x303640, vertexColors: true }),
    tire: new THREE.MeshLambertMaterial({ color: 0x14171c }),
    rim: new THREE.MeshPhongMaterial({ color: 0x737d8b, specular: 0x9ba6b6, shininess: 70 }),
    glass: new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x749db5, shininess: 95 }),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    shadow: new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
    }),
  };
  return sharedMaterials;
}

function makeWheelInstances(geometry, material, red = false) {
  const mesh = new THREE.InstancedMesh(geometry, material, 4);
  const matrix = new THREE.Matrix4();
  const z = red ? .915 : .855;
  const y = red ? RED_WHEEL_RADIUS : .47;
  const positions = [[1.33, y, z], [1.33, y, -z], [-1.35, y, z], [-1.35, y, -z]];
  positions.forEach(([x, y, pz], index) => {
    matrix.makeRotationY(pz < 0 ? Math.PI : 0);
    if (red) matrix.scale(new THREE.Vector3(RED_WHEEL_SCALE, RED_WHEEL_SCALE, RED_WHEEL_SCALE));
    matrix.setPosition(x, y, pz);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function resolveType({ isPlayer, color, variant }) {
  if (isPlayer) return 'roter-keil';
  if (WING_COLORS.has(color)) return 'magenta-fluegel';
  if (typeof color === 'number') return 'cyan-puls';
  return variant % 2 === 0 ? 'cyan-puls' : 'magenta-fluegel';
}

/**
 * Erstellt das Render-Modell. Keine Maße oder Zustände der Fahrphysik werden
 * verändert; der Fahrzeug-Ursprung und die Vorwärtsachse (+X) bleiben gleich.
 * `type` kann die Farb-Zuordnung übersteuern (z. B. im Modell-Viewer).
 */
export function createSupercarMesh({ color, isPlayer = false, variant = 0, type = null }) {
  const materials = getSharedMaterials();
  const modelType = MODEL_BUILDERS[type] ? type : resolveType({ isPlayer, color, variant });
  const geometries = getModelGeometries(modelType);
  const car = new THREE.Group();
  const red = modelType === 'roter-keil';
  const finish = red ? getRedFinish() : materials;
  const paint = red ? createRedPaint(color) : new THREE.MeshPhongMaterial({ color: new THREE.Color(color), vertexColors: true, specular: 0x554b46, shininess: 45 });

  const body = new THREE.Mesh(geometries.paint, paint);
  const carbonParts = new THREE.Mesh(geometries.carbon, finish.carbon);
  const canopy = new THREE.Mesh(geometries.glass, finish.glass);
  const lights = new THREE.Mesh(geometries.lights, finish.lights);

  const tires = makeWheelInstances(red ? RED_TIRE_GEOMETRY : TIRE_GEOMETRY, materials.tire, red);
  const rims = makeWheelInstances(red ? RED_RIM_GEOMETRY : RIM_GEOMETRY, finish.rim, red);

  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, red ? finish.shadow : materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  shadow.scale.set(1.08, 0.78, 1);

  car.add(shadow, body, carbonParts, canopy, lights, tires, rims);
  // Eigene Materialien gehören dem Auto und können beim Szenenwechsel entsorgt werden.
  car.userData.ownedMaterials = [paint];
  return car;
}
