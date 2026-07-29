// Dev-Viewer: Einzelsichtung der Bauwerke des 3D-Modus unter der Lichtstimmung
// des Spiels – exakt die Fabrik createBuildings3D aus buildings3d.js, gefüttert
// mit einer kleinen Fake-Karte, deren Knoten in einer Reihe liegen. Kein
// Build-Einstieg (siehe dev-buildings.html); nur über den Dev-Server aufrufen.
//
// Gezeigte Varianz (aus buildings3d.js abgeleitet, keine Phantasie-Varianten):
//  - Festung je Fraktion (Banner, Torlicht, Schildtönung; Rot blickt nach +z,
//    Blau nach −z – wie im Spiel, per Orbit umrundbar)
//  - Wachturm je Fraktion (nur das Banner ist fraktionsabhängig; `rank`
//    beeinflusst ausschließlich die Sichtbarkeit bei towersPerFaction,
//    NICHT das Aussehen – darum genügt ein Turm je Fraktion)
//  - Friedhof dreimal: neutral/blau/rot – die Fahnenfarbe folgt map.graveyards
//    [id].owner (Geometrie identisch, Details je Knoten zufällig geseedet)
//  - Vorratslager je Fraktion (Zeltfarbe FACTION_DARK + Banner)
//
// Tasten: ←/→ bzw. A/D Gebäude fokussieren, 0 Überblick, L Aufhell-Lampe.
// Touch:  kompakte Leiste unten (dev-buildings.html) – ruft dieselben
//         Funktionen wie die Tasten auf, keine doppelte Logik.
// Konsolen-API: window.__devBuildings = { focus(i|null), list(), step(s),
//   shoot(w,h), setRuin(on) } – setRuin schaltet die Türme über eine minimale
//   Fake-Sim auf ihre Ruinen-Variante (inkl. Rauch), alles andere bleibt gleich.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuildings3D } from './three/buildings3d.js';
import { PALETTE, QUALITY, MAP_W, MAP_H } from './three/world.js';

// ------------------------------------------------------------------ Aufstellung
// Reihenfolge und Weltposition (worldX) der Bauwerke; `half` = halbe Grundfläche
// fürs Kamera-Framing, `height` = Gesamthöhe inkl. Mast/Fahne (Maße aus den
// Bauplänen in buildings3d.js). Die Kartenkoordinate ergibt sich umgekehrt zu
// toWorldX/toWorldZ: x = worldX + MAP_W/2, y = MAP_H/2 (⇒ worldZ = 0, eine Reihe).
const ROW = [
  { id: 'fortB', kind: 'fortress', faction: 'blue', wx: -290, half: 55, height: 92, label: 'Festung', sub: 'Sturmlanze (Tor zeigt nach −z)' },
  { id: 'fortR', kind: 'fortress', faction: 'red', wx: -160, half: 55, height: 92, label: 'Festung', sub: 'Frostwolf (Tor zeigt nach +z)' },
  { id: 'towerB', kind: 'tower', faction: 'blue', wx: -60, half: 16, height: 62, label: 'Wachturm', sub: 'Sturmlanze' },
  { id: 'towerR', kind: 'tower', faction: 'red', wx: -5, half: 16, height: 62, label: 'Wachturm', sub: 'Frostwolf' },
  { id: 'gyN', kind: 'graveyard', faction: null, wx: 55, half: 24, height: 14, label: 'Friedhof', sub: 'Fahne: Neutral' },
  { id: 'gyB', kind: 'graveyard', faction: 'blue', wx: 110, half: 24, height: 14, label: 'Friedhof', sub: 'Fahne: Blau' },
  { id: 'gyR', kind: 'graveyard', faction: 'red', wx: 165, half: 24, height: 14, label: 'Friedhof', sub: 'Fahne: Rot' },
  { id: 'supB', kind: 'supply', faction: 'blue', wx: 230, half: 20, height: 16, label: 'Vorratslager', sub: 'Sturmlanze' },
  { id: 'supR', kind: 'supply', faction: 'red', wx: 290, half: 20, height: 16, label: 'Vorratslager', sub: 'Frostwolf' },
];

// Fake-Karte mit genau den Feldern, die createBuildings3D liest: nodeList
// (Typen boss/graveyard), nodes (per Id), towerSites, supplyCamps, graveyards.
function makeFakeMap() {
  const nodes = {};
  for (const e of ROW) {
    nodes[e.id] = {
      id: e.id,
      type: e.kind === 'fortress' ? 'boss' : e.kind === 'graveyard' ? 'graveyard' : 'combat',
      faction: e.kind === 'fortress' ? e.faction : undefined,
      x: e.wx + MAP_W / 2,
      y: MAP_H / 2,
    };
  }
  return {
    nodes,
    nodeList: ROW.map((e) => nodes[e.id]),
    towerSites: { blue: ['towerB'], red: ['towerR'] },
    supplyCamps: { supB: 'blue', supR: 'red' },
    // owner steuert die Fahnenfarbe (update() liest ihn, solange keine Sim läuft)
    graveyards: { gyN: { owner: null }, gyB: { owner: 'blue' }, gyR: { owner: 'red' } },
  };
}

// ------------------------------------------------------------ Renderer/Szene
// Tone-Mapping und Exposure wie renderer3d.js, Licht wie atmosphere3d.js –
// die Bauwerke sollen exakt in der Nachtstimmung des Spiels beurteilt werden.
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxPixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.fog);
scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0011);

const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Überblicksposition: frontal auf die Reihe (Süd-Seite, +z).
const OVERVIEW = {
  pos: new THREE.Vector3(0, 95, 470),
  target: new THREE.Vector3(0, 26, 0),
};
camera.position.copy(OVERVIEW.pos);
controls.target.copy(OVERVIEW.target);

// ------------------------------------------------------------------- Licht
// Werte aus atmosphere3d.js (Hemisphäre 2.6, Mond 2.3, kühles Gegenlicht
// 1.15); der Schattenfrustum umfasst die ganze Gebäudereihe (~±350).
const hemi = new THREE.HemisphereLight(PALETTE.ambientSky, PALETTE.ambientGround, 2.6);
const moon = new THREE.DirectionalLight(PALETTE.moonlight, 2.3);
moon.position.set(-130, 90, -140); // Richtung wie im Spiel: Nordwest, tief
moon.castShadow = true;
moon.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
const sc = moon.shadow.camera;
sc.left = -380;
sc.right = 380;
sc.top = 160;
sc.bottom = -160;
sc.near = 20;
sc.far = 800;
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 2;
moon.target.position.set(0, 0, 0);
const counter = new THREE.DirectionalLight(0x93a8d4, 1.15); // Gegenlicht Süden
counter.position.set(40, 55, 180);
scene.add(hemi, moon, moon.target, counter);

// Schwache neutrale Aufhell-Lampe, Taste L, Standard aus – zum Prüfen von
// Details, die im kalten Nachtlicht absaufen.
const fillLight = new THREE.AmbientLight(0xffffff, 0.85);
fillLight.visible = false;
scene.add(fillLight);

// ------------------------------------------------------------------- Boden
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1100, 500),
  new THREE.MeshLambertMaterial({ color: PALETTE.snowLow })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(1100, 110, PALETTE.snowShadow, PALETTE.snowShadow);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.02; // knapp über dem Boden gegen Z-Fighting
scene.add(grid);

// ----------------------------------------------------------------- Bauwerke
// EINE Instanz der echten Spiel-Fabrik über der Fake-Karte; heightAt = 0,
// weil der Viewer-Boden eben ist (die Sockel ragen ohnehin ins Gelände).
const buildings = createBuildings3D({ map: makeFakeMap(), heightAt: () => 0 });
scene.add(buildings.group);

// Ruinen-Ansicht der Türme: update() schaltet die fertig gebaute Ruine nur per
// Sichtbarkeit um, braucht dafür aber eine Sim. Diese Minimal-Sim ändert
// AUSSCHLIESSLICH die Türme (alive: false); Festungen, Friedhöfe und Lager
// verhalten sich exakt wie im Ausgangszustand ohne Sim.
const RUIN_SIM = {
  time: 0,
  config: { graveyardCaptureTime: 1 },
  bossAlive: { blue: true, red: true },
  get bossShield() {
    return { blue: 0, red: 0 };
  },
  towers: {
    towerB: { alive: false, hp: 0, maxHp: 1 },
    towerR: { alive: false, hp: 0, maxHp: 1 },
  },
  graveyards: { owner: { gyN: null, gyB: 'blue', gyR: 'red' }, captures: {} },
  supplyState: { camps: ['supB', 'supR'], active: {}, blocked: {} },
};
let ruinMode = false;

function setRuin(on = true) {
  ruinMode = !!on;
  console.info(`[dev-buildings] Turm-Ruinen ${ruinMode ? 'AN' : 'aus'}`);
}

// ------------------------------------------------------------------- Labels
const labelsEl = document.getElementById('labels');
const FACTION_CLASS = { blue: 'blue', red: 'red' };
for (const e of ROW) {
  const el = document.createElement('div');
  el.className = `unit-label ${FACTION_CLASS[e.faction] ?? ''}`;
  el.innerHTML = `<strong>${e.label}</strong><br>${e.sub}`;
  labelsEl.appendChild(el);
  e.labelEl = el;
}

// -------------------------------------------------------------- Kamerafokus
// focus(i): Kamera fährt frontal nah an Gebäude i, Ziel auf halber Höhe.
// focus(null) bzw. Taste 0: zurück zum Überblick. Weiche Fahrt per Tween.
let focused = null;
const tween = { active: false, t: 0, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3() };

function flyTo(pos, target) {
  tween.fromPos.copy(camera.position);
  tween.fromTarget.copy(controls.target);
  tween.toPos.copy(pos);
  tween.toTarget.copy(target);
  tween.t = 0;
  tween.active = true;
}

function focus(index) {
  if (index == null || index < 0 || index >= ROW.length) {
    focused = null;
    flyTo(OVERVIEW.pos, OVERVIEW.target);
    return;
  }
  focused = index;
  const e = ROW[index];
  const midY = e.height * 0.5;
  // Abstand: das größere aus Höhen- und Breitenbedarf. Anders als bei den
  // schmalen Einheiten muss die Breite hier das Seitenverhältnis einrechnen,
  // sonst laufen Festung und Lager im Hochformat seitlich aus dem Bild.
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const dist = Math.max(e.height * 1.8, (e.half * 1.6) / Math.tan(hHalf));
  flyTo(
    new THREE.Vector3(e.wx, midY + dist * 0.18, dist),
    new THREE.Vector3(e.wx, midY, 0)
  );
}

function focusStep(dir) {
  const next = focused == null ? (dir > 0 ? 0 : ROW.length - 1) : (focused + dir + ROW.length) % ROW.length;
  focus(next);
}

// ------------------------------------------------------------------ Eingabe
function toggleLamp() {
  fillLight.visible = !fillLight.visible;
  document.getElementById('btnLamp').classList.toggle('active', fillLight.visible);
  console.info(`[dev-buildings] Aufhell-Licht ${fillLight.visible ? 'AN' : 'aus'}`);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowRight' || e.code === 'KeyD') return focusStep(1);
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') return focusStep(-1);
  if (e.code === 'Digit0') return focus(null);
  if (e.code === 'KeyL') return toggleLamp();
});

// Touch-Leiste (dev-buildings.html): identische Funktionen wie die Tasten.
document.getElementById('btnPrev').addEventListener('click', () => focusStep(-1));
document.getElementById('btnNext').addEventListener('click', () => focusStep(1));
document.getElementById('btnOverview').addEventListener('click', () => focus(null));
document.getElementById('btnLamp').addEventListener('click', toggleLamp);

// ------------------------------------------------------- Labels projizieren
const projV = new THREE.Vector3();

function updateLabels() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const e of ROW) {
    projV.set(e.wx, 0, e.half + 6).project(camera); // Fußpunkt vor dem Bauwerk
    const visible = projV.z < 1;
    e.labelEl.style.display = visible ? '' : 'none';
    if (!visible) continue;
    e.labelEl.style.left = `${((projV.x + 1) / 2) * w}px`;
    e.labelEl.style.top = `${((1 - projV.y) / 2) * h + 8}px`;
  }
}

// --------------------------------------------------------------- Renderloop
// Ein verstecktes/frisch geladenes Browser-Panel kann 0×0 melden – dann würde
// aspect NaN und die Szene bliebe dauerhaft leer. Solche Größen überspringen
// und im Renderloop nachholen, sobald das Fenster echte Maße hat.
let sizedW = 0;
let sizedH = 0;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h || (w === sizedW && h === sizedH)) return;
  sizedW = w;
  sizedH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let simTime = 0; // eigene Uhr, damit __devBuildings.step() vorspulen kann

// Ein Simulationstick des Viewers: Bauwerks-Update (Fahnen, Fensterflackern,
// Feuerschale, ggf. Ruinenrauch) plus Kamerafahrt. Wird vom rAF-Loop UND von
// step() benutzt – keine doppelte Logik.
function tick(dt) {
  simTime += dt;
  buildings.update(ruinMode ? { sim: RUIN_SIM } : null, simTime, dt);
  if (tween.active) {
    tween.t = Math.min(1, tween.t + dt / 0.6);
    const k = tween.t * tween.t * (3 - 2 * tween.t); // smoothstep
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    if (tween.t >= 1) tween.active = false;
  }
}

function frame() {
  requestAnimationFrame(frame);
  resize(); // holt eine beim Laden verpasste Fenstergröße nach (0×0-Panel)
  tick(Math.min(clock.getDelta(), 0.1));
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
}
frame();

// ------------------------------------------------------------- Konsolen-API
window.__devBuildings = {
  focus,
  list: () =>
    ROW.map((e, index) => ({
      index,
      label: `${e.label} – ${e.sub}`,
      kind: e.kind,
      faction: e.faction,
    })),
  setRuin,
  // Screenshot-Helfer: rAF pausiert im versteckten Browser-Panel, darum
  // manuell vorspulen (Bauwerks-Update + Kamerafahrt) und explizit rendern.
  step(seconds = 1) {
    let rest = seconds;
    while (rest > 0) {
      const dt = Math.min(rest, 1 / 30);
      rest -= dt;
      tick(dt);
    }
    controls.update();
    updateLabels();
    renderer.render(scene, camera);
  },
  shoot(w = 1280, h = 720) {
    // Verstecktes Browser-Panel meldet 0×0 – für den Export feste Größe setzen.
    sizedW = sizedH = 0; // nächster sichtbarer Frame stellt die Fenstergröße wieder her
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
console.info('[dev-buildings] bereit –', ROW.length, 'Bauwerke. API: window.__devBuildings');
