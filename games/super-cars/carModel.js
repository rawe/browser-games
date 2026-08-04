// Fahrzeug-Zusammenbau: wählt pro Auto eines der drei Facetten-Modelle
// (Roter Keil, Magenta Flügel, Cyan Puls), verwaltet die geteilten Materialien
// und die Räder. Geometrien werden pro Typ einmal gebaut und geteilt; pro Auto
// variiert nur das Lackmaterial. Maße, Ursprung und +X-Vorwärtsachse bleiben
// identisch zur Fahrphysik.
import * as THREE from 'three';
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

// Sichtbare Räder bewusst kleiner als der Physik-Radius (0,47): Die
// Modellblätter zeigen die Reifenoberkante unterhalb der Schulterlinie.
// Bodenkontakt bleibt bei Y = 0, die Fahrphysik nutzt diese Meshes nicht.
const TIRE_GEOMETRY = new THREE.CylinderGeometry(0.36, 0.36, 0.30, 10, 1);
TIRE_GEOMETRY.rotateX(Math.PI / 2);
const RIM_GEOMETRY = new THREE.CylinderGeometry(0.26, 0.26, 0.28, 8, 1);
RIM_GEOMETRY.rotateX(Math.PI / 2);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(2.22, 14);

let sharedMaterials;

function makeCarbonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#11151b'; ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#202731';
  ctx.fillRect(0, 0, 8, 4); ctx.fillRect(8, 8, 8, 4);
  ctx.fillStyle = '#0a0d11';
  ctx.fillRect(8, 4, 8, 4); ctx.fillRect(0, 12, 8, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getSharedMaterials() {
  if (sharedMaterials) return sharedMaterials;
  sharedMaterials = {
    carbon: new THREE.MeshLambertMaterial({ color: 0x565e68, map: makeCarbonTexture(), vertexColors: true }),
    tire: new THREE.MeshLambertMaterial({ color: 0x0b0d11 }),
    rim: new THREE.MeshLambertMaterial({ color: 0x343a44 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x2c6e96, vertexColors: true }),
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
  const z = 0.84 + outerShift;
  const positions = [[1.33, 0.36, z], [1.33, 0.36, -z], [-1.35, 0.36, z], [-1.35, 0.36, -z]];
  positions.forEach(([x, y, pz], index) => {
    matrix.makeTranslation(x, y, pz);
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
  const paint = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), vertexColors: true });

  const body = new THREE.Mesh(geometries.paint, paint);
  const carbonParts = new THREE.Mesh(geometries.carbon, materials.carbon);
  const canopy = new THREE.Mesh(geometries.glass, materials.glass);
  const lights = new THREE.Mesh(geometries.lights, materials.lights);

  const tires = makeWheelInstances(TIRE_GEOMETRY, materials.tire);
  const rims = makeWheelInstances(RIM_GEOMETRY, materials.rim, 0.02);

  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  shadow.scale.set(1.08, 0.78, 1);

  car.add(shadow, body, carbonParts, canopy, lights, tires, rims);
  // Eigene Materialien gehören dem Auto und können beim Szenenwechsel entsorgt werden.
  car.userData.ownedMaterials = [paint];
  return car;
}
