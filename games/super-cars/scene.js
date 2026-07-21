// 3D-Darstellung mit Three.js: Strecke, Fahrzeuge, Raketen, Effekte, Verfolgerkamera.
import * as THREE from 'three';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function makeCarMesh(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x15161a });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd8ff });

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, 1.8), bodyMat);
  body.position.y = 0.55;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 1.5), bodyMat);
  nose.position.set(2.05, 0.45, 0);
  group.add(nose);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.3), glassMat);
  cabin.position.set(-0.1, 1.15, 0);
  group.add(cabin);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 2.0), bodyMat);
  spoiler.position.set(-1.75, 1.15, 0);
  group.add(spoiler);
  const spoilerLegL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.12), darkMat);
  spoilerLegL.position.set(-1.7, 0.95, 0.7);
  group.add(spoilerLegL);
  const spoilerLegR = spoilerLegL.clone();
  spoilerLegR.position.z = -0.7;
  group.add(spoilerLegR);

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 10);
  wheelGeo.rotateX(Math.PI / 2);
  for (const [wx, wz] of [[1.25, 1.0], [1.25, -1.0], [-1.25, 1.0], [-1.25, -1.0]]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.position.set(wx, 0.42, wz);
    group.add(wheel);
  }

  // weicher Schattenfleck statt echter Schatten (mobil-freundlich)
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  group.add(blob);
  return group;
}

function ribbonGeometry(track, innerOffset, outerOffset, y = 0.01) {
  const { samples, count } = track;
  const positions = new Float32Array(count * 2 * 3);
  const index = [];
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    positions.set([s.x + s.nx * innerOffset, y, s.z + s.nz * innerOffset], i * 6);
    positions.set([s.x + s.nx * outerOffset, y, s.z + s.nz * outerOffset], i * 6 + 3);
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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
  const index = [];
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    positions.set([s.x + s.nx * off, 0, s.z + s.nz * off], i * 6);
    positions.set([s.x + s.nx * off, h, s.z + s.nz * off], i * 6 + 3);
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1, a, b, a + 1, b, b + 1, a + 1); // beidseitig sichtbar
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
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

  // Boden
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(320, 40),
    new THREE.MeshLambertMaterial({ color: env.grass })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Fahrbahn + Randsteine + Banden
  const road = new THREE.Mesh(
    ribbonGeometry(track, -track.halfWidth, track.halfWidth, 0.0),
    new THREE.MeshLambertMaterial({ color: 0x5d6472 })
  );
  scene.add(road);
  const kerbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  scene.add(new THREE.Mesh(kerbGeometry(track, 1, 0.015), kerbMat));
  scene.add(new THREE.Mesh(kerbGeometry(track, -1, 0.015), kerbMat));
  const centerLine = new THREE.Mesh(
    ribbonGeometry(track, -0.15, 0.15, 0.012),
    new THREE.MeshBasicMaterial({ color: 0x8a8f9a })
  );
  scene.add(centerLine);
  const barrierMat = new THREE.MeshBasicMaterial({ color: 0x9aa2b5 });
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

  // Deko: Bäume + Werbetafeln außerhalb der Strecke
  const treeGeo = new THREE.ConeGeometry(1.6, 4.5, 6);
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x1e3d26 });
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.4, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3626 });
  const isNearTrack = (x, z, margin) => track.samples.some(
    (s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < margin * margin
  );
  let placed = 0;
  let attempts = 0;
  const rand = mulberry32(hash(track.def.id));
  while (placed < 70 && attempts < 600) {
    attempts++;
    const x = (rand() - 0.5) * 300;
    const z = (rand() - 0.5) * 300;
    if (isNearTrack(x, z, track.halfWidth + track.shoulder + 5)) continue;
    const tree = new THREE.Group();
    const cone = new THREE.Mesh(treeGeo, treeMat);
    cone.position.y = 3.4;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.7;
    tree.add(cone, trunk);
    const sc = 0.7 + rand() * 0.9;
    tree.scale.setScalar(sc);
    tree.position.set(x, 0, z);
    scene.add(tree);
    placed++;
  }

  const adTexts = [['TURBO', '#12151c', '#ffc233'], ['NITRO GP', '#2a1420', '#ff5ca8'], ['BOXENSTOPP', '#101c2a', '#5a9bff'], ['RAKETEN-SHOP', '#1c1210', '#ff8a2a']];
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
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.0, 6), barrierMat);
    post.position.set(board.position.x, 0.9, board.position.z);
    scene.add(post);
  }

  // Fahrzeuge
  const carMeshes = race.cars.map((car) => {
    const mesh = makeCarMesh(car.color);
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
      const dist = 11.5;
      const height = 5.8;
      const targetPos = new THREE.Vector3(p.x - fx2 * dist, height, p.z - fz2 * dist);
      if (!camInit) { camPos.copy(targetPos); camInit = true; }
      const k = 1 - Math.exp(-dt * 4.5);
      camPos.lerp(targetPos, k);
      shake = Math.max(0, shake - dt * 2.5);
      const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
      const sy = shake > 0 ? (Math.random() - 0.5) * shake * 0.5 : 0;
      camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z + sx);
      camTarget.set(p.x + fx2 * 9, 1.0, p.z + fz2 * 9);
      camera.lookAt(camTarget);
    },

    resize(w, h) {
      camera.aspect = w / h;
      camera.fov = w < h ? 74 : 62; // Hochformat: weiterer Blickwinkel
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
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
