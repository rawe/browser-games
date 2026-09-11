// Dev-Werkzeug: rendert ein Fahrzeugmodell in sechs Ansichten (Raster wie auf
// den Modellblättern) zur visuellen Abnahme. Kein Teil des Spiels/Builds.
// Aufruf: /games/super-cars/dev/model-viewer.html?type=roter-keil&color=ff4b3a
// GLB-Kandidaten: …?glb=/games/super-cars/dev/candidates/<datei>.glb
// (wird auf Bodenkontakt und die Ziel-Bounding-Box aus MODELLVORGABEN skaliert)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSupercarMesh } from '../carModel.js';

const params = new URLSearchParams(location.search);
const type = params.get('type') || 'roter-keil';
const color = parseInt(params.get('color') || 'ff4b3a', 16);
const isPlayer = params.get('player') !== '0';

const canvas = document.getElementById('stage');
// preserveDrawingBuffer erlaubt canvas.toDataURL()-Exporte für Vergleichsbilder.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9b6b2);
scene.add(new THREE.HemisphereLight(0xc4ceff, 0x3a3226, 1.2));
const dir = new THREE.DirectionalLight(0xffe8c0, 1.25);
dir.position.set(4, 6, 3);
scene.add(dir);
const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35);
fill.position.set(-5, 3, -4);
scene.add(fill);

// Each model already includes a contact shadow; a uniform studio background
// avoids unrelated horizons in the six inspection cameras.

const glbUrl = params.get('glb');
if (glbUrl) {
  new GLTFLoader().load(glbUrl, (gltf) => {
    const model = gltf.scene;
    // Auf die Ziel-Bounding-Box normalisieren: Länge 4,6, Boden bei y=0,
    // Fahrzeugfront in +X (Rohmodelle liegen oft in +Z → um -90° drehen).
    if (params.get('rotate') !== '0') model.rotation.y = -Math.PI / 2;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 4.6 / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    const scaled = new THREE.Box3().setFromObject(model);
    const center = scaled.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= scaled.min.y;
    let tris = 0;
    model.traverse((o) => {
      if (o.isMesh) {
        const index = o.geometry.getIndex();
        tris += (index ? index.count : o.geometry.getAttribute('position').count) / 3;
      }
    });
    scene.add(model);
    document.getElementById('info').textContent = `GLB: ${glbUrl} – ${Math.round(tris)} Dreiecke`;
    render();
  }, undefined, (err) => {
    document.getElementById('info').textContent = `GLB-Fehler: ${err.message || err}`;
  });
} else {
  const car = createSupercarMesh({ color, isPlayer, type });
  scene.add(car);
  document.getElementById('info').textContent =
    `${type} – #${color.toString(16).padStart(6, '0')}`;
}

// Sechs Ansichten: 3/4 vorn, Seite, 3/4 hinten, Front, Heck, oben.
const VIEWS = [
  { pos: [6.2, 2.6, 4.6], look: [0, 0.55, 0], fov: 26 },
  { pos: [0, 1.1, 8.2], look: [0, 0.62, 0], fov: 26 },
  { pos: [-6.2, 2.6, 4.6], look: [0, 0.55, 0], fov: 26 },
  { pos: [8.6, 1.4, 0], look: [0, 0.6, 0], fov: 24 },
  { pos: [-8.6, 1.4, 0], look: [0, 0.6, 0], fov: 24 },
  { pos: [0.01, 10.5, 0], look: [0, 0, 0], fov: 26 },
];

const only = params.has('view') ? parseInt(params.get('view'), 10) : null;

function render() {
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  if (only !== null) {
    const view = VIEWS[only];
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    const camera = new THREE.PerspectiveCamera(view.fov, w / h, 0.1, 100);
    // Bei schmalen Viewports die Kamera zurückziehen, damit das Auto passt.
    const back = Math.max(1, 1.6 / (w / h));
    camera.position.set(view.pos[0] * back, view.pos[1] * back, view.pos[2] * back);
    camera.lookAt(...view.look);
    renderer.render(scene, camera);
    return;
  }
  const cols = w < h ? 2 : 3; const rows = 6 / cols;
  const cw = Math.floor(w / cols); const ch = Math.floor(h / rows);
  VIEWS.forEach((view, i) => {
    const cx = (i % cols) * cw; const cy = (rows - 1 - Math.floor(i / cols)) * ch;
    renderer.setViewport(cx, cy, cw, ch);
    renderer.setScissor(cx, cy, cw, ch);
    const camera = new THREE.PerspectiveCamera(view.fov, cw / ch, 0.1, 100);
    const back = Math.max(1.10, 1.45 / (cw / ch));
    camera.position.set(...view.pos.map(v => v * back));
    camera.lookAt(...view.look);
    renderer.render(scene, camera);
  });
}

render();
window.addEventListener('resize', render);

const modelSelect = document.getElementById('model');
const viewSelect = document.getElementById('view');
modelSelect.value = type;
viewSelect.value = params.get('view') ?? 'all';
modelSelect.addEventListener('change', () => {
  const next = new URL(location.href);
  next.searchParams.delete('glb');
  next.searchParams.set('type', modelSelect.value);
  next.searchParams.set('color', {'roter-keil':'ff4b3a','magenta-fluegel':'ff5ca8','cyan-puls':'2ad4c8'}[modelSelect.value]);
  location.href = next.href;
});
viewSelect.addEventListener('change', () => {
  const next = new URL(location.href);
  if(viewSelect.value === 'all') next.searchParams.delete('view');
  else next.searchParams.set('view', viewSelect.value);
  location.href = next.href;
});
