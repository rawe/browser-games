// Fahrzeug-Zusammenbau: wählt pro Auto eines der drei Facetten-Modelle
// (Roter Keil, Magenta Flügel, Cyan Puls), verwaltet die geteilten Materialien
// und die Räder. Geometrien werden pro Typ einmal gebaut und geteilt; pro Auto
// variiert nur das Lackmaterial. Maße, Ursprung und +X-Vorwärtsachse bleiben
// identisch zur Fahrphysik.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRoterKeil } from './carModels/roterKeil.js';
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

function buildRimGeometry() {
  const parts=[];
  const lip = new THREE.TorusGeometry(.331,.018,4,20);
  lip.rotateX(Math.PI/2); lip.translate(0,.153,0); parts.push(lip);
  const innerLip = new THREE.TorusGeometry(.295,.012,4,20);
  innerLip.rotateX(Math.PI/2); innerLip.translate(0,.14,0); parts.push(innerLip);
  for(let i=0;i<5;i++) {
    const spoke=new THREE.BoxGeometry(.235,.055,.065);
    spoke.translate(.178,.15,0); spoke.rotateY(i*Math.PI*2/5); parts.push(spoke);
  }
  const hub=new THREE.CylinderGeometry(.092,.092,.08,10);
  hub.translate(0,.15,0); parts.push(hub);
  const merged=mergeGeometries(parts.map(p=>p.index?p.toNonIndexed():p));
  parts.forEach(p=>p.dispose());
  merged.rotateX(Math.PI/2);
  return merged;
}
const RIM_GEOMETRY = buildRimGeometry();
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

function makeWheelInstances(geometry, material, outerShift = 0) {
  const mesh = new THREE.InstancedMesh(geometry, material, 4);
  const matrix = new THREE.Matrix4();
  const z = 0.855 + outerShift;
  const positions = [[1.33, 0.47, z], [1.33, 0.47, -z], [-1.35, 0.47, z], [-1.35, 0.47, -z]];
  positions.forEach(([x, y, pz], index) => {
    matrix.makeRotationY(pz < 0 ? Math.PI : 0);
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
  const paint = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), vertexColors: true, specular: 0x554b46, shininess: 45 });

  const body = new THREE.Mesh(geometries.paint, paint);
  const carbonParts = new THREE.Mesh(geometries.carbon, materials.carbon);
  const canopy = new THREE.Mesh(geometries.glass, materials.glass);
  const lights = new THREE.Mesh(geometries.lights, materials.lights);

  const tires = makeWheelInstances(TIRE_GEOMETRY, materials.tire);
  const rims = makeWheelInstances(RIM_GEOMETRY, materials.rim);

  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  shadow.scale.set(1.08, 0.78, 1);

  car.add(shadow, body, carbonParts, canopy, lights, tires, rims);
  // Eigene Materialien gehören dem Auto und können beim Szenenwechsel entsorgt werden.
  car.userData.ownedMaterials = [paint];
  return car;
}
