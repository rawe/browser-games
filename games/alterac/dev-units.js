// Dev-Viewer: Einzelsichtung der Einheitenmodelle unter der Lichtstimmung des
// Spiels – die 7 GLB-Modelle (models3d.js) plus der handgebaute Ivus
// (units3d.js, exakt die Spiel-Figur). Kein Build-Einstieg (siehe
// dev-units.html); ausschließlich über den Dev-Server aufrufen.
//
// Tasten: 1–6 Animationszustand (Idle/Walk/Run/Attack/Block/Death),
//         ←/→ bzw. A/D Einzelfigur fokussieren, 0 Überblick,
//         L neutrale Aufhell-Lampe (Standard: aus).
// Touch:  kompakte Leiste unten (dev-units.html) – ruft dieselben Funktionen
//         wie die Tasten auf, keine doppelte Logik.
// Konsolen-API: window.__devUnits = { setState(name), focus(index), list() }.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadUnitModels, cloneModel, pickClips, TARGET_HEIGHT } from './three/models3d.js';
import { createUnits3D } from './three/units3d.js';
import { PALETTE, QUALITY } from './three/world.js';

const FADE = 0.2; // Crossfade-Dauer wie applyModelPose in units3d.js
const SPACING = 24; // Abstand der Figuren in der Reihe (Welteinheiten)

// Aufstellungsreihenfolge: blau light/medium/heavy, rot light/medium/heavy,
// rot lokholar; ans Ende der Reihe kommt zusätzlich der handgebaute Ivus
// (blauer Boss – es gibt bewusst KEIN GLB für ihn). Fehlgeschlagene
// GLB-Slots werden übersprungen (models3d lässt sie undefined und warnt
// selbst in der Konsole).
const ORDER = [
  { faction: 'blue', slot: 'light' },
  { faction: 'blue', slot: 'medium' },
  { faction: 'blue', slot: 'heavy' },
  { faction: 'red', slot: 'light' },
  { faction: 'red', slot: 'medium' },
  { faction: 'red', slot: 'heavy' },
  { faction: 'red', slot: 'lokholar' },
];

const FACTION_NAME = { blue: 'Sturmlanze', red: 'Frostwolf' };
const SLOT_NAME = { light: 'Leicht', medium: 'Mittel', heavy: 'Schwer', lokholar: 'Boss' };

// ------------------------------------------------------------ Renderer/Szene
// Tone-Mapping und Exposure wie renderer3d.js, Licht wie atmosphere3d.js –
// die Figuren sollen exakt in der Nachtstimmung des Spiels beurteilt werden.
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

// Überblicksposition: frontal auf die Reihe (Figuren blicken nach +z).
const OVERVIEW = {
  pos: new THREE.Vector3(0, 26, 130),
  target: new THREE.Vector3(0, 9, 0),
};
camera.position.copy(OVERVIEW.pos);
controls.target.copy(OVERVIEW.target);

// ------------------------------------------------------------------- Licht
// Werte aus atmosphere3d.js (Hemisphäre 2.6, Mond 2.3, kühles Gegenlicht
// 1.15), Schattenfrustum auf die kleine Bühne verengt.
const hemi = new THREE.HemisphereLight(PALETTE.ambientSky, PALETTE.ambientGround, 2.6);
const moon = new THREE.DirectionalLight(PALETTE.moonlight, 2.3);
moon.position.set(-130, 90, -140); // Richtung wie im Spiel: Nordwest, tief
moon.castShadow = true;
moon.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
const sc = moon.shadow.camera;
sc.left = -110;
sc.right = 110;
sc.top = 70;
sc.bottom = -70;
sc.near = 20;
sc.far = 500;
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
  new THREE.PlaneGeometry(600, 300),
  new THREE.MeshLambertMaterial({ color: PALETTE.snowLow })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(600, 60, PALETTE.snowShadow, PALETTE.snowShadow);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.02; // knapp über dem Boden gegen Z-Fighting
scene.add(grid);

// ------------------------------------------------------------------ Figuren
const labelsEl = document.getElementById('labels');
// { entry, wrapper, mixer, actions, current, labelEl, chestY, x, height };
// der handgebaute Ivus hat zusätzlich `ivus` (benannte Teilgruppen) statt
// mixer/actions.
const figures = [];

// Handgebauter Ivus: dieselbe Bau-Logik wie im Spiel – createUnits3D stellt
// die Template-Fabrik über den Dev-Zugang `template` bereit. Die Instanz
// bleibt für die Lebensdauer des Viewers stehen (KEIN dispose – die Figur
// teilt Geometrien/Materialien mit ihr); map/heightAt werden nur von
// update() gebraucht, das der Viewer nie aufruft.
const unitsTemplates = createUnits3D({ map: null, heightAt: () => 0 });
const IVUS_HEIGHT = 23; // Bauplanhöhe (~23 Welteinheiten) – keine Skalierung nötig

function buildIvusFigure(x) {
  const wrapper = new THREE.Group();
  wrapper.add(unitsTemplates.template('ally', 'blue').clone());
  wrapper.position.set(x, 0, 0);
  scene.add(wrapper);

  const labelEl = document.createElement('div');
  labelEl.className = 'unit-label blue';
  labelEl.innerHTML = '<strong>Ivus</strong><br>Sturmlanze · Boss (handgebaut)';
  labelsEl.appendChild(labelEl);

  figures.push({
    entry: { label: 'Ivus' },
    faction: 'blue',
    slot: 'ally',
    wrapper,
    mixer: null, // keine AnimationClips – Posen sind im Spiel prozedural
    actions: {},
    current: null,
    labelEl,
    chestY: IVUS_HEIGHT * 0.55,
    x,
    height: IVUS_HEIGHT,
    ivus: {
      torso: wrapper.getObjectByName('torso'),
      armL: wrapper.getObjectByName('armL'),
      armR: wrapper.getObjectByName('armR'),
      legL: wrapper.getObjectByName('legL'),
      legR: wrapper.getObjectByName('legR'),
    },
  });
}

// Minimale prozedurale Idle-Wippe für Ivus – exakt der Warte-Zweig aus
// units3d.js/applyPose mit den RIGS.ally-Werten (armRest 0.15, torsoRest
// 0.02, bob sin(t·1.9)·0.12, Bein-Splay 0.05). Die Zustands-Buttons
// ignorieren ihn (keine Clips), er bleibt einfach stehen.
let poseTime = 0; // eigene Uhr, damit auch __devUnits.step() vorspulen kann

function updateIvusPose(fig) {
  const P = fig.ivus;
  const s = Math.sin(poseTime * 1.9);
  P.legL.rotation.set(0, 0, -0.05);
  P.legR.rotation.set(0, 0, 0.05);
  P.torso.rotation.x = 0.02;
  P.armL.rotation.set(0.15 + s * 0.05, 0, 0.1);
  P.armR.rotation.set(0.15 - s * 0.05, 0, -0.1);
  fig.wrapper.position.y = s * 0.12;
}

function buildFigures(models) {
  const present = ORDER.filter(({ faction, slot }) => models[faction]?.[slot]);
  const offset = present.length / 2; // + 1 Platz für den handgebauten Ivus
  present.forEach(({ faction, slot }, i) => {
    const entry = models[faction][slot];
    const target = TARGET_HEIGHT[slot] ?? TARGET_HEIGHT.medium;
    const wrapper = cloneModel(entry, target);
    const x = (i - offset) * SPACING;
    wrapper.position.set(x, 0, 0);
    scene.add(wrapper);

    const mixer = new THREE.AnimationMixer(wrapper);
    const roles = pickClips(entry.clips, entry.attack);
    const actions = {};
    for (const [role, clip] of Object.entries(roles)) {
      if (clip) actions[role] = mixer.clipAction(clip);
    }
    if (actions.death) {
      actions.death.setLoop(THREE.LoopOnce, 1);
      actions.death.clampWhenFinished = true;
    }
    // Fehlende Rollen sichtbar machen (z. B. Block bei den Quaternius-Rigs).
    const missing = Object.entries(roles)
      .filter(([, clip]) => !clip)
      .map(([role]) => role);
    if (missing.length) {
      console.info(`[dev-units] ${entry.label} (${faction}/${slot}) ohne Clips: ${missing.join(', ')}`);
    }

    const labelEl = document.createElement('div');
    labelEl.className = `unit-label ${faction}`;
    labelEl.innerHTML = `<strong>${entry.label}</strong><br>${FACTION_NAME[faction]} · ${SLOT_NAME[slot]}`;
    labelsEl.appendChild(labelEl);

    figures.push({
      entry,
      faction,
      slot,
      wrapper,
      mixer,
      actions,
      current: null,
      labelEl,
      chestY: target * 0.55, // Brusthöhe als Fokuspunkt
      x,
      height: target,
    });
  });
  // Der handgebaute Ivus schließt die Reihe rechts ab (neben dem Yeti).
  buildIvusFigure((present.length - offset) * SPACING);
}

// Globaler Zustandswechsel mit Crossfade; Idle/Walk/Run starten je Figur an
// zufälligem Clip-Offset, damit die Reihe nicht synchron marschiert.
const DESYNC = new Set(['idle', 'walk', 'run']);

function setState(name) {
  if (!['idle', 'walk', 'run', 'attack', 'block', 'death'].includes(name)) {
    console.warn(`[dev-units] Unbekannter Zustand „${name}“`);
    return;
  }
  markStateButton(name); // Touch-Leiste synchron halten (auch bei Tastatur)
  for (const fig of figures) {
    // Block ohne Clip → Idle (wie units3d im Spiel); der handgebaute Ivus
    // hat gar keine Clips und bleibt einfach stehen (`continue`).
    const action = fig.actions[name] ?? fig.actions.idle;
    if (!action) continue;
    if (action === fig.current && name !== 'death') continue;
    if (fig.current && fig.current !== action) fig.current.fadeOut(FADE);
    action.reset().fadeIn(FADE).play();
    if (DESYNC.has(name)) action.time = Math.random() * action.getClip().duration;
    fig.current = action;
  }
}

// -------------------------------------------------------------- Kamerafokus
// focus(i): Kamera fährt frontal nah an Figur i, Ziel auf Brusthöhe.
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
  if (index == null || index < 0 || index >= figures.length) {
    focused = null;
    flyTo(OVERVIEW.pos, OVERVIEW.target);
    return;
  }
  focused = index;
  const fig = figures[index];
  const dist = fig.height * 2.1;
  flyTo(
    new THREE.Vector3(fig.x, fig.chestY + dist * 0.18, dist),
    new THREE.Vector3(fig.x, fig.chestY, 0)
  );
}

function focusStep(dir) {
  const next = focused == null ? (dir > 0 ? 0 : figures.length - 1) : (focused + dir + figures.length) % figures.length;
  focus(next);
}

// ------------------------------------------------------------------ Eingabe
function toggleLamp() {
  fillLight.visible = !fillLight.visible;
  document.getElementById('btnLamp').classList.toggle('active', fillLight.visible);
  console.info(`[dev-units] Aufhell-Licht ${fillLight.visible ? 'AN' : 'aus'}`);
}

window.addEventListener('keydown', (e) => {
  const states = { Digit1: 'idle', Digit2: 'walk', Digit3: 'run', Digit4: 'attack', Digit5: 'block', Digit6: 'death' };
  if (states[e.code]) return setState(states[e.code]);
  if (e.code === 'ArrowRight' || e.code === 'KeyD') return focusStep(1);
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') return focusStep(-1);
  if (e.code === 'Digit0') return focus(null);
  if (e.code === 'KeyL') return toggleLamp();
});

// Touch-Leiste (dev-units.html): identische Funktionen wie die Tasten.
const stateButtons = new Map();
for (const btn of document.querySelectorAll('#stateRow button')) {
  stateButtons.set(btn.dataset.state, btn);
  btn.addEventListener('click', () => setState(btn.dataset.state));
}

function markStateButton(name) {
  for (const [state, btn] of stateButtons) btn.classList.toggle('active', state === name);
}

document.getElementById('btnPrev').addEventListener('click', () => focusStep(-1));
document.getElementById('btnNext').addEventListener('click', () => focusStep(1));
document.getElementById('btnOverview').addEventListener('click', () => focus(null));
document.getElementById('btnLamp').addEventListener('click', toggleLamp);

// ------------------------------------------------------- Labels projizieren
const projV = new THREE.Vector3();

function updateLabels() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const fig of figures) {
    projV.set(fig.x, 0, 3).project(camera); // Fußpunkt, leicht vor der Figur
    const visible = projV.z < 1;
    fig.labelEl.style.display = visible ? '' : 'none';
    if (!visible) continue;
    fig.labelEl.style.left = `${((projV.x + 1) / 2) * w}px`;
    fig.labelEl.style.top = `${((1 - projV.y) / 2) * h + 8}px`;
  }
}

// --------------------------------------------------------------- Renderloop
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  poseTime += dt;
  for (const fig of figures) {
    if (fig.mixer) fig.mixer.update(dt);
    else if (fig.ivus) updateIvusPose(fig);
  }
  if (tween.active) {
    tween.t = Math.min(1, tween.t + dt / 0.6);
    const k = tween.t * tween.t * (3 - 2 * tween.t); // smoothstep
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    if (tween.t >= 1) tween.active = false;
  }
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
}

// -------------------------------------------------------------------- Start
loadUnitModels().then((models) => {
  document.getElementById('loading').remove();
  buildFigures(models);
  setState('idle');
  frame();

  // Konsolen-API für automatisiertes Testen / Screenshot-Skripte.
  window.__devUnits = {
    setState,
    focus,
    list: () =>
      figures.map((fig, index) => ({
        index,
        label: fig.entry.label,
        faction: fig.faction,
        slot: fig.slot,
      })),
    // Screenshot-Helfer: rAF pausiert im versteckten Browser-Panel, darum
    // manuell vorspulen (Mixer + Kamerafahrt) und explizit rendern.
    step(seconds = 1) {
      let rest = seconds;
      while (rest > 0) {
        const dt = Math.min(rest, 1 / 30);
        rest -= dt;
        poseTime += dt;
        for (const fig of figures) {
          if (fig.mixer) fig.mixer.update(dt);
          else if (fig.ivus) updateIvusPose(fig);
        }
        if (tween.active) {
          tween.t = Math.min(1, tween.t + dt / 0.6);
          const k = tween.t * tween.t * (3 - 2 * tween.t);
          camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
          controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
          if (tween.t >= 1) tween.active = false;
        }
      }
      controls.update();
      updateLabels();
      renderer.render(scene, camera);
    },
    shoot(w = 1280, h = 720) {
      // Verstecktes Browser-Panel meldet 0×0 – für den Export feste Größe setzen.
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
  };
  console.info('[dev-units] bereit –', figures.length, 'Figuren. API: window.__devUnits');
});
