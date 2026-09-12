// Dev-Werkzeug: rendert ein Fahrzeugmodell in sechs Ansichten (Raster wie auf
// den Modellblättern) zur visuellen Abnahme. Kein Teil des Spiels/Builds.
// Aufruf: /games/super-cars/dev/model-viewer.html?type=roter-keil&color=ff4b3a
// GLB-Kandidaten: …?glb=/games/super-cars/dev/candidates/<datei>.glb
// (wird auf Bodenkontakt und die Ziel-Bounding-Box aus MODELLVORGABEN skaliert)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSupercarMesh } from '../carModel.js';
import { createCarPresentation } from '../carPresentation.js';

const params = new URLSearchParams(location.search);
const embedded = params.has('embed');
if (embedded) {
  document.querySelector('nav').hidden = true;
  document.querySelector('nav').style.display = 'none';
  document.getElementById('info').hidden = true;
}
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
if (type === 'roter-keil') {
  scene.background = new THREE.Color(0x242633);
  scene.fog = new THREE.Fog(0x242633,12,50);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  dir.color.set(0xffc38b); dir.intensity = 3.4; dir.position.set(5,8,-1);
  dir.castShadow = true; dir.shadow.mapSize.set(2048,2048);
  Object.assign(dir.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});
  dir.shadow.bias=-.0004; dir.shadow.normalBias=.035;
  fill.color.set(0xffd4bd); fill.intensity=.85; fill.position.set(-5,3,4);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x242c39,roughness:.84,metalness:.05}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.007;ground.receiveShadow=true;scene.add(ground);
}

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
  if(type === 'roter-keil') {
    car.children[0].visible=false;
    car.traverse(obj=>{if(obj.isMesh){obj.castShadow=true;obj.receiveShadow=false;}});
  }
  scene.add(car);
  document.getElementById('info').textContent =
    `${type} – #${color.toString(16).padStart(6, '0')}`;
}

// Sechs Ansichten: 3/4 vorn, Seite, 3/4 hinten, Front, Heck, oben.
const VIEWS = [
  { pos: [6.2,2.6,4.6], look: [0,.55,0], fov: type === 'roter-keil' ? 24 : 26 },
  { pos: [0, 1.1, 8.2], look: [0, 0.62, 0], fov: 26 },
  { pos: type === 'roter-keil' ? [-4.4804, 1.9004, 2.6501] : [-6.2, 2.6, 4.6], look: [0, 0.55, 0], fov: type === 'roter-keil' ? 32.7 : 26 },
  { pos: [8.6, 1.4, 0], look: [0, 0.6, 0], fov: 24 },
  { pos: [-8.6, 1.4, 0], look: [0, 0.6, 0], fov: 24 },
  { pos: [0.01, 10.5, 0], look: [0, 0, 0], fov: 26 },
];

const only = params.has('view') ? parseInt(params.get('view'), 10) : null;
const presentation = type === 'roter-keil' && only !== null ? createCarPresentation(renderer) : null;

function render() {
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  if (only !== null) {
    const view = VIEWS[only];
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    const camera = new THREE.PerspectiveCamera(view.fov, w / h, 0.1, 100);
    // Bei schmalen Viewports die Kamera zurückziehen, damit das Auto passt.
    const back = Math.max(1, (embedded ? 1.45 : 1.6) / (w / h));
    const fittedRear=type==='roter-keil' && only===2;
    const distanceScale=fittedRear?1:back;
    if(fittedRear){camera.fov=2*Math.atan(Math.tan(view.fov*Math.PI/360)*back)*180/Math.PI;camera.updateProjectionMatrix();}
    camera.position.set(view.pos[0] * distanceScale, view.pos[1] * distanceScale, view.pos[2] * distanceScale * (embedded && (only === 0 || only === 1) ? -1 : 1));
    camera.lookAt(...view.look);
    if(fittedRear && embedded){
      // Match the title crop's original 1536 × 640 pixel coordinates.
      const scale=2.05*w/1536;
      camera.fov=2*Math.atan(320/790.027)*180/Math.PI;
      camera.setViewOffset(1536,640,768-496.549,320-365.069+.23*h/scale,w/scale,h/scale);
      camera.lookAt(0,.6,0);
    }
    if(presentation) { renderer.setScissorTest(false); presentation.render(scene,camera); }
    else renderer.render(scene, camera);
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
