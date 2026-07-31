// Mobiles, prozedurales Low-Poly-Supercar. Die Geometrien und die meisten
// Materialien werden von allen Fahrzeugen geteilt; pro Auto variieren nur Lack
// und Livery. So bleibt die markante Silhouette auch mit acht Autos bezahlbar.
import * as THREE from 'three';

const PAINT_VERTEX_SHADES = [0.72, 0.82, 0.9, 1.0, 1.08];

function geometryBuilder() {
  const positions = [];
  const colors = [];

  const triangle = (a, b, c, shade = 1) => {
    positions.push(...a, ...b, ...c);
    const value = PAINT_VERTEX_SHADES[Math.max(0, Math.min(4, shade))];
    colors.push(value, value, value, value, value, value, value, value, value);
  };

  const quad = (a, b, c, d, shade = 1, flipDiagonal = false) => {
    if (flipDiagonal) {
      triangle(a, b, d, shade);
      triangle(b, c, d, Math.min(4, shade + 1));
    } else {
      triangle(a, b, c, shade);
      triangle(a, c, d, Math.max(0, shade - 1));
    }
  };

  const box = (x, y, z, sx, sy, sz, shade = 2) => {
    const x0 = x - sx / 2; const x1 = x + sx / 2;
    const y0 = y - sy / 2; const y1 = y + sy / 2;
    const z0 = z - sz / 2; const z1 = z + sz / 2;
    const p000 = [x0, y0, z0]; const p001 = [x0, y0, z1];
    const p010 = [x0, y1, z0]; const p011 = [x0, y1, z1];
    const p100 = [x1, y0, z0]; const p101 = [x1, y0, z1];
    const p110 = [x1, y1, z0]; const p111 = [x1, y1, z1];
    quad(p100, p110, p111, p101, shade);
    quad(p000, p001, p011, p010, shade - 1);
    quad(p010, p011, p111, p110, shade + 1);
    quad(p000, p100, p101, p001, shade - 2);
    quad(p001, p101, p111, p011, shade);
    quad(p000, p010, p110, p100, shade - 1);
  };

  const build = ({ vertexColors = true } = {}) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (vertexColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const uvs = [];
    for (let i = 0; i < positions.length; i += 3) {
      uvs.push((positions[i] + 2.5) / 5, (positions[i + 2] + 1.2) / 2.4);
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  };

  return { triangle, quad, box, build };
}

function buildBodyGeometry() {
  const g = geometryBuilder();
  // Vier Querschnitte bilden eine breite, nach vorn abfallende Keilform.
  const nose = {
    top: [2.34, 0.54, 0], left: [2.18, 0.42, 0.72], right: [2.18, 0.42, -0.72],
    lowL: [2.14, 0.22, 0.74], lowR: [2.14, 0.22, -0.74],
  };
  const hood = {
    top: [0.72, 0.82, 0], left: [0.62, 0.70, 0.98], right: [0.62, 0.70, -0.98],
    lowL: [0.72, 0.22, 1.0], lowR: [0.72, 0.22, -1.0],
  };
  const rear = {
    top: [-1.28, 0.80, 0], left: [-1.38, 0.71, 1.03], right: [-1.38, 0.71, -1.03],
    lowL: [-1.38, 0.22, 1.03], lowR: [-1.38, 0.22, -1.03],
  };
  const tail = {
    top: [-2.18, 0.61, 0], left: [-2.18, 0.55, 0.91], right: [-2.18, 0.55, -0.91],
    lowL: [-2.14, 0.22, 0.86], lowR: [-2.14, 0.22, -0.86],
  };

  // Motorhaube und hinteres Deck: bewusst trianguliert für die Teaser-Facetten.
  g.triangle(nose.top, hood.top, nose.left, 4);
  g.triangle(nose.left, hood.top, hood.left, 3);
  g.triangle(nose.top, nose.right, hood.top, 3);
  g.triangle(nose.right, hood.right, hood.top, 2);
  g.triangle(rear.top, tail.top, rear.left, 3);
  g.triangle(rear.left, tail.top, tail.left, 2);
  g.triangle(rear.top, rear.right, tail.top, 4);
  g.triangle(rear.right, tail.right, tail.top, 2);

  // Schultern und Seitenflächen.
  g.quad(nose.left, hood.left, hood.lowL, nose.lowL, 3, true);
  g.quad(hood.left, rear.left, rear.lowL, hood.lowL, 2, false);
  g.quad(rear.left, tail.left, tail.lowL, rear.lowL, 3, true);
  g.quad(nose.lowR, hood.lowR, hood.right, nose.right, 1, false);
  g.quad(hood.lowR, rear.lowR, rear.right, hood.right, 2, true);
  g.quad(rear.lowR, tail.lowR, tail.right, rear.right, 1, false);
  g.quad(nose.left, nose.lowR, nose.right, nose.top, 3);
  g.triangle(nose.left, nose.lowL, nose.lowR, 1);
  g.quad(tail.top, tail.lowR, tail.lowL, tail.left, 1);
  g.triangle(tail.top, tail.right, tail.lowR, 2);

  // Spoiler vollständig in die Lack-Geometrie integrieren: klare Teaser-
  // Silhouette ohne zusätzlichen Draw Call.
  g.box(-1.67, 1.34, 0, 0.38, 0.11, 2.18, 3);
  g.box(-1.67, 1.03, 0.65, 0.12, 0.58, 0.12, 2);
  g.box(-1.67, 1.03, -0.65, 0.12, 0.58, 0.12, 2);
  return g.build();
}

function buildCanopyGeometry() {
  const g = geometryBuilder();
  const fl = [0.62, 0.82, 0.72]; const fr = [0.62, 0.82, -0.72];
  const ftl = [0.18, 1.34, 0.53]; const ftr = [0.18, 1.34, -0.53];
  const rtl = [-0.63, 1.39, 0.55]; const rtr = [-0.63, 1.39, -0.55];
  const rl = [-1.27, 0.82, 0.74]; const rr = [-1.27, 0.82, -0.74];
  g.quad(fl, fr, ftr, ftl, 4, true); // Windschutzscheibe
  g.quad(ftl, ftr, rtr, rtl, 3, false); // Dachglas
  g.quad(ftl, rtl, rl, fl, 2, true);
  g.quad(fr, rr, rtr, ftr, 1, false);
  g.quad(rtl, rtr, rr, rl, 0, true);
  return g.build();
}

function buildAeroGeometry() {
  const g = geometryBuilder();
  g.box(2.14, 0.17, 0, 0.50, 0.10, 1.84, 2); // Frontsplitter
  g.box(-2.07, 0.16, 0, 0.44, 0.13, 1.78, 1); // Diffusor
  g.box(0, 0.18, 1.01, 3.35, 0.11, 0.12, 2); // Schweller
  g.box(0, 0.18, -1.01, 3.35, 0.11, 0.12, 1);
  return g.build();
}

function buildLightGeometry(front) {
  const g = geometryBuilder();
  const x = front ? 2.255 : -2.205;
  const y = front ? 0.49 : 0.51;
  const sx = front ? 0.07 : 0.06;
  const sy = front ? 0.15 : 0.18;
  const sz = front ? 0.39 : 0.46;
  for (const z of [0.49, -0.49]) g.box(x, y, z, sx, sy, sz, 4);
  return g.build({ vertexColors: false });
}

function buildStripeGeometry() {
  const g = geometryBuilder();
  // Leicht über der Karosserie, in drei Segmenten an deren Neigung angepasst.
  g.quad([2.22, 0.555, 0.09], [2.22, 0.555, -0.09], [0.72, 0.835, -0.09], [0.72, 0.835, 0.09], 3);
  g.quad([0.55, 0.84, 0.08], [0.55, 0.84, -0.08], [-1.15, 0.825, -0.08], [-1.15, 0.825, 0.08], 3);
  return g.build({ vertexColors: false });
}

const BODY_GEOMETRY = buildBodyGeometry();
const CANOPY_GEOMETRY = buildCanopyGeometry();
const AERO_GEOMETRY = buildAeroGeometry();
const STRIPE_GEOMETRY = buildStripeGeometry();
const TIRE_GEOMETRY = new THREE.CylinderGeometry(0.47, 0.47, 0.42, 10, 1);
TIRE_GEOMETRY.rotateX(Math.PI / 2);
const RIM_GEOMETRY = new THREE.CylinderGeometry(0.285, 0.285, 0.445, 8, 1);
RIM_GEOMETRY.rotateX(Math.PI / 2);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(2.22, 14);

function buildCombinedLightGeometry() {
  const front = buildLightGeometry(true);
  const rear = buildLightGeometry(false);
  const frontPos = front.getAttribute('position');
  const rearPos = rear.getAttribute('position');
  const frontNormal = front.getAttribute('normal');
  const rearNormal = rear.getAttribute('normal');
  const count = frontPos.count + rearPos.count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  positions.set(frontPos.array, 0);
  positions.set(rearPos.array, frontPos.array.length);
  normals.set(frontNormal.array, 0);
  normals.set(rearNormal.array, frontNormal.array.length);
  for (let i = 0; i < count; i++) {
    const color = i < frontPos.count ? [0.58, 0.94, 1] : [1, 0.035, 0.02];
    colors.set(color, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

const LIGHT_GEOMETRY = buildCombinedLightGeometry();

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
  const carbon = makeCarbonTexture();
  sharedMaterials = {
    aero: new THREE.MeshLambertMaterial({ color: 0x252a31, map: carbon }),
    tire: new THREE.MeshLambertMaterial({ color: 0x0b0d11 }),
    rim: new THREE.MeshLambertMaterial({ color: 0x929baa }),
    glass: new THREE.MeshLambertMaterial({ color: 0x4b9ab8, vertexColors: true }),
    playerGlass: new THREE.MeshLambertMaterial({ color: 0x61c8e9, vertexColors: true }),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    shadow: new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
    }),
  };
  return sharedMaterials;
}

function makeWheelInstances(geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, 4);
  const matrix = new THREE.Matrix4();
  const positions = [[1.33, 0.47, 1], [1.33, 0.47, -1], [-1.35, 0.47, 1], [-1.35, 0.47, -1]];
  positions.forEach(([x, y, z], index) => {
    matrix.makeTranslation(x, y, z);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Erstellt das Render-Modell. Keine Maße oder Zustände der Fahrphysik werden
 * verändert; der Fahrzeug-Ursprung und die Vorwärtsachse (+X) bleiben gleich.
 */
export function createSupercarMesh({ color, isPlayer = false, variant = 0 }) {
  const materials = getSharedMaterials();
  const car = new THREE.Group();
  const baseColor = new THREE.Color(color);
  const paint = new THREE.MeshLambertMaterial({ color: baseColor, vertexColors: true });
  const accentColor = isPlayer
    ? new THREE.Color(0xffc43d)
    : baseColor.clone().offsetHSL(0.08 + (variant % 3) * 0.025, 0.08, 0.18);
  const accent = new THREE.MeshBasicMaterial({ color: accentColor, toneMapped: false });

  const body = new THREE.Mesh(BODY_GEOMETRY, paint);
  const canopy = new THREE.Mesh(CANOPY_GEOMETRY, isPlayer ? materials.playerGlass : materials.glass);
  const aero = new THREE.Mesh(AERO_GEOMETRY, materials.aero);
  const stripe = new THREE.Mesh(STRIPE_GEOMETRY, accent);
  const lights = new THREE.Mesh(LIGHT_GEOMETRY, materials.lights);

  const tires = makeWheelInstances(TIRE_GEOMETRY, materials.tire);
  const rims = makeWheelInstances(RIM_GEOMETRY, materials.rim);

  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  shadow.scale.set(1.08, 0.78, 1);

  car.add(shadow, body, canopy, aero, stripe, lights, tires, rims);
  // Eigene Materialien gehören dem Auto und können beim Szenenwechsel entsorgt werden.
  car.userData.ownedMaterials = [paint, accent];
  return car;
}
