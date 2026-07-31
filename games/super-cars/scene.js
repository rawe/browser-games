// 3D-Darstellung mit Three.js: Strecke, Fahrzeuge, Raketen, Effekte, Verfolgerkamera.
import * as THREE from 'three';
import { createSupercarMesh } from './carModel.js';
import { addEnvironmentScenery } from './environment.js';

const ROAD_TEXTURE_URL = new URL('./assets/textures/road-asphalt.webp', import.meta.url).href;
const GROUND_TEXTURE_URL = new URL('./assets/textures/alpine-ground.webp', import.meta.url).href;

function repeatTexture(url, repeatX = 1, repeatY = repeatX) {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const mobileDprCap = matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileDprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  return renderer;
}

function ribbonGeometry(track, innerOffset, outerOffset, y = 0.01) {
  const { samples, count } = track;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const index = [];
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const innerX = s.x + s.nx * innerOffset;
    const innerZ = s.z + s.nz * innerOffset;
    const outerX = s.x + s.nx * outerOffset;
    const outerZ = s.z + s.nz * outerOffset;
    positions.set([innerX, y, innerZ], i * 6);
    positions.set([outerX, y, outerZ], i * 6 + 3);
    // Weltkoordinaten halten die isotrope Asphaltstruktur über die geschlossene
    // Naht hinweg kachelbar, ohne zusätzliche Seam-Vertices.
    uvs.set([innerX / 18, innerZ / 18, outerX / 18, outerZ / 18], i * 4);
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    // Außenkante zuerst: die Dreiecke zeigen nach oben und bleiben mit
    // FrontSide sichtbar (weniger Fragmentarbeit als DoubleSide auf Mobilgeräten).
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  // flache Fahrbahn: Normalen zeigen einheitlich nach oben
  const normals = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count * 2; i++) normals[i * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(index);
  return geo;
}

function kerbGeometry(track, side, y) {
  // Randsteine als rot/weiß wechselnde Segmente (Vertex-Farben)
  const { samples, count } = track;
  const inner = side * (track.halfWidth - 0.1);
  const outer = side * (track.halfWidth + 0.8);
  const positions = [];
  const colors = [];
  const index = [];
  const red = [0.85, 0.2, 0.16];
  const white = [0.92, 0.92, 0.9];
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const c = Math.floor(s.s / 3) % 2 === 0 ? red : white;
    positions.push(s.x + s.nx * inner, y, s.z + s.nz * inner);
    positions.push(s.x + s.nx * outer, y, s.z + s.nz * outer);
    colors.push(...c, ...c);
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(index);
  return geo;
}

function barrierGeometry(track, side) {
  const { samples, count } = track;
  const off = side * (track.halfWidth + track.shoulder + 0.4);
  const h = 1.0;
  const positions = new Float32Array(count * 2 * 3);
  const colors = new Float32Array(count * 2 * 3);
  const index = [];
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    positions.set([s.x + s.nx * off, 0, s.z + s.nz * off], i * 6);
    positions.set([s.x + s.nx * off, h, s.z + s.nz * off], i * 6 + 3);
    const block = Math.floor(s.s / 5);
    const color = block % 8 === 0 ? [0.82, 0.08, 0.06] : (block % 2 ? [0.76, 0.77, 0.8] : [0.93, 0.92, 0.88]);
    colors.set(color, i * 6);
    colors.set(color, i * 6 + 3);
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1, a, b, a + 1, b, b + 1, a + 1); // beidseitig sichtbar
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  return geo;
}

function startLineTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 1; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#e8e8e8' : '#1a1a1a';
      ctx.fillRect(x * 8, 0, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

function billboardTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = fg;
  ctx.font = 'italic 900 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  return new THREE.CanvasTexture(c);
}

export function createRaceScene(race) {
  const { track } = race;
  const env = track.def.env;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.Fog(env.fog, 60, 190);

  const hemi = new THREE.HemisphereLight(0xc4ceff, 0x3a3226, 1.2);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffe8c0, 1.25);
  dir.position.set(40, 70, 20);
  scene.add(dir);
  const rand = mulberry32(hash(track.def.id));
  addEnvironmentScenery(scene, track, env, rand);

  // Boden
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(640, 640),
    new THREE.MeshLambertMaterial({ color: 0xa4b19b, map: repeatTexture(GROUND_TEXTURE_URL, 32) })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Fahrbahn + Randsteine + Banden
  const road = new THREE.Mesh(
    ribbonGeometry(track, -track.halfWidth, track.halfWidth, 0.0),
    new THREE.MeshLambertMaterial({ color: 0xc5cad6, map: repeatTexture(ROAD_TEXTURE_URL) })
  );
  scene.add(road);
  const kerbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  scene.add(new THREE.Mesh(kerbGeometry(track, 1, 0.015), kerbMat));
  scene.add(new THREE.Mesh(kerbGeometry(track, -1, 0.015), kerbMat));
  const barrierMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  scene.add(new THREE.Mesh(barrierGeometry(track, 1), barrierMat));
  scene.add(new THREE.Mesh(barrierGeometry(track, -1), barrierMat));

  // Ziellinie
  const s0 = track.samples[0];
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(3, track.width),
    new THREE.MeshBasicMaterial({ map: startLineTexture() })
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -Math.atan2(s0.tz, s0.tx);
  startLine.position.set(s0.x, 0.02, s0.z);
  scene.add(startLine);

  // Werbetafeln außerhalb der Strecke
  const adTexts = [['TURBO', '#12151c', '#ffc233'], ['NITRO GP', '#2a1420', '#ff5ca8'], ['BOXENSTOPP', '#101c2a', '#5a9bff'], ['RAKETEN-SHOP', '#1c1210', '#ff8a2a']];
  const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 6);
  const posts = new THREE.InstancedMesh(postGeo, barrierMat, adTexts.length);
  const postMatrix = new THREE.Matrix4();
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor((i / 4) * track.count);
    const s = track.samples[idx];
    const off = track.halfWidth + track.shoulder + 4.5;
    const [text, bg, fg] = adTexts[i % adTexts.length];
    // zwei Rücken an Rücken stehende Flächen, damit der Text von beiden Seiten lesbar ist
    const boardMat = new THREE.MeshBasicMaterial({ map: billboardTexture(text, bg, fg) });
    const board = new THREE.Group();
    const faceA = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.6), boardMat);
    const faceB = faceA.clone();
    faceB.rotation.y = Math.PI;
    board.add(faceA, faceB);
    board.position.set(s.x + s.nx * off, 2.6, s.z + s.nz * off);
    board.lookAt(s.x, 2.6, s.z);
    scene.add(board);
    postMatrix.makeTranslation(board.position.x, 0.9, board.position.z);
    posts.setMatrixAt(i, postMatrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.computeBoundingSphere();
  scene.add(posts);

  // Fahrzeuge
  const carMeshes = race.cars.map((car) => {
    const mesh = createSupercarMesh({ color: car.color, isPlayer: car.isPlayer, variant: car.id });
    scene.add(mesh);
    return mesh;
  });

  // Raketen-Pool
  const rocketGeo = new THREE.ConeGeometry(0.28, 1.4, 6);
  rocketGeo.rotateZ(-Math.PI / 2);
  const rocketMat = new THREE.MeshBasicMaterial({ color: 0xffd873 });
  const rocketMeshes = [];

  // Kamera: schräg von hinten
  const camera = new THREE.PerspectiveCamera(66, 1, 0.5, 500);
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let camInit = false;
  let shake = 0;
  let portrait = false;

  const effects = []; // Explosionen etc.

  function spawnExplosion(x, z, big) {
    const mat = new THREE.MeshBasicMaterial({
      color: big ? 0xffa03a : 0xffd873, transparent: true, opacity: 0.95,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
    mesh.position.set(x, 1, z);
    scene.add(mesh);
    effects.push({ mesh, t: 0, dur: big ? 0.7 : 0.35, maxR: big ? 4.5 : 2.2 });
    if (big) shake = Math.max(shake, 0.8);
  }

  return {
    scene,
    camera,

    handleEvent(ev) {
      if (ev.type === 'explosion') spawnExplosion(ev.x, ev.z, true);
      else if (ev.type === 'rocketHit') spawnExplosion(ev.x, ev.z, false);
      else if (ev.type === 'wallHit' && ev.carId === 0) shake = Math.max(shake, 0.35);
    },

    update(dt) {
      // Fahrzeuge
      race.cars.forEach((car, i) => {
        const m = carMeshes[i];
        m.visible = !car.destroyed;
        m.position.set(car.state.x, 0, car.state.z);
        m.rotation.y = -car.state.heading;
      });

      // Raketen-Pool angleichen
      while (rocketMeshes.length < race.rockets.length) {
        const m = new THREE.Mesh(rocketGeo, rocketMat);
        scene.add(m);
        rocketMeshes.push(m);
      }
      rocketMeshes.forEach((m, i) => {
        const r = race.rockets[i];
        if (!r) { m.visible = false; return; }
        m.visible = true;
        m.position.set(r.x, 0.8, r.z);
        m.rotation.y = -r.heading;
      });

      // Effekte
      for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i];
        fx.t += dt;
        const p = fx.t / fx.dur;
        if (p >= 1) {
          scene.remove(fx.mesh);
          fx.mesh.geometry.dispose();
          fx.mesh.material.dispose();
          effects.splice(i, 1);
        } else {
          fx.mesh.scale.setScalar(0.5 + p * fx.maxR);
          fx.mesh.material.opacity = 0.95 * (1 - p);
        }
      }

      // Verfolgerkamera: hinter dem Wagen, leicht erhöht
      const p = race.cars[0].state;
      const fx2 = Math.cos(p.heading);
      const fz2 = Math.sin(p.heading);
      const dist = portrait ? 12.8 : 10.2;
      const height = portrait ? 5.9 : 4.7;
      const targetPos = new THREE.Vector3(p.x - fx2 * dist, height, p.z - fz2 * dist);
      if (!camInit) { camPos.copy(targetPos); camInit = true; }
      const k = 1 - Math.exp(-dt * 4.5);
      camPos.lerp(targetPos, k);
      shake = Math.max(0, shake - dt * 2.5);
      const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
      const sy = shake > 0 ? (Math.random() - 0.5) * shake * 0.5 : 0;
      camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z + sx);
      camTarget.set(p.x + fx2 * 8, 0.95, p.z + fz2 * 8);
      camera.lookAt(camTarget);
    },

    resize(w, h) {
      portrait = w < h;
      camera.aspect = w / h;
      camera.fov = portrait ? 84 : 62;
      camera.updateProjectionMatrix();
    },

    dispose() {
      // Fahrzeuggeometrien und Standardmaterialien sind modulweit geteilt und
      // bleiben über Rennwechsel hinweg im GPU-Cache. Nur Lack/Livery gehören
      // der konkreten Szene.
      for (const car of carMeshes) {
        scene.remove(car);
        car.userData.ownedMaterials?.forEach((material) => material.dispose());
      }
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      scene.traverse((obj) => {
        if (obj.geometry) geometries.add(obj.geometry);
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((material) => {
            materials.add(material);
            if (material.map) textures.add(material.map);
          });
        }
      });
      textures.forEach((texture) => texture.dispose());
      materials.forEach((material) => material.dispose());
      geometries.forEach((geometry) => geometry.dispose());
    },
  };
}

// deterministische Zufallszahlen, damit die Deko pro Strecke stabil ist
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
