// Dev-Werkzeug: rendert ein Fahrzeugmodell in sechs Ansichten (Raster wie auf
// den Modellblättern) zur visuellen Abnahme. Kein Teil des Spiels/Builds.
// Aufruf: /games/super-cars/dev/model-viewer.html?type=roter-keil&color=ff4b3a
import * as THREE from 'three';
import { createSupercarMesh } from '../carModel.js';

const params = new URLSearchParams(location.search);
const type = params.get('type') || 'roter-keil';
const color = parseInt(params.get('color') || 'ff4b3a', 16);
const isPlayer = params.get('player') !== '0';

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshLambertMaterial({ color: 0xa8a5a1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const car = createSupercarMesh({ color, isPlayer, type });
scene.add(car);

document.getElementById('info').textContent =
  `${type} – #${color.toString(16).padStart(6, '0')}`;

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
  const cw = Math.floor(w / 3); const ch = Math.floor(h / 2);
  VIEWS.forEach((view, i) => {
    const cx = (i % 3) * cw; const cy = (1 - Math.floor(i / 3)) * ch;
    renderer.setViewport(cx, cy, cw, ch);
    renderer.setScissor(cx, cy, cw, ch);
    const camera = new THREE.PerspectiveCamera(view.fov, cw / ch, 0.1, 100);
    camera.position.set(...view.pos);
    camera.lookAt(...view.look);
    renderer.render(scene, camera);
  });
}

render();
window.addEventListener('resize', render);
