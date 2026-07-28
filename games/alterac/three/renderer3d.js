// 3D-Renderer der Schlacht: bindet Terrain, Bauwerke, Einheiten, Atmosphäre
// und Effekte zu einer Szene zusammen und spiegelt darin je Frame den
// Simulationszustand. KEINE Spiellogik – wie render.js liest er `view.sim`
// nur. Der Vertrag nach außen entspricht dem 2D-Renderer:
//   createRenderer3D({ canvas, map }) → { draw(view, dt), resize(), dispose() }
//
// Kamera: freie Fahrt durch die Landschaft. MapControls (Touch: ein Finger
// verschiebt, zwei Finger drehen/zoomen; Maus: linke Taste verschiebt, rechte
// dreht, Rad zoomt zum Zeiger) mit Dämpfung; Ziel und Abstand sind auf das
// Tal begrenzt, unter das Gelände kommt die Kamera nie.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { toWorldX, toWorldZ, MAP_H, QUALITY } from './world.js';
import { createTerrain3D } from './terrain3d.js';
import { createBuildings3D } from './buildings3d.js';
import { createUnits3D } from './units3d.js';
import { createAtmosphere3D } from './atmosphere3d.js';
import { createEffects3D } from './effects3d.js';

export function createRenderer3D({ canvas, map }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure zusammen mit den Lichtwerten in atmosphere3d.js kalibriert:
  // hoch genug, dass Einheiten auf dem Nachtfeld lesbar bleiben, niedrig
  // genug, dass Feuer und Fenster weiterhin als warme Akzente herausstechen.
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);

  // Startblick: über der Basis des menschlichen Spielers (blau, Süden) das
  // Tal hinab nach Norden – der Blick von Süden ist die vertraute Leserichtung
  // der 2D-Karte (unten = eigen). Bewusst flach angesetzt: So stehen Bergkranz
  // und gemalter Dämmerungshimmel mit im Bild statt nur der Draufsicht.
  // Wichtig: Die Kamera muss INNERHALB des Bergkranzes stehen (begehbarer
  // Kern endet bei y ≈ 920), sonst verstellt die südliche Felswand den Blick.
  camera.position.set(0, 170, toWorldZ(MAP_H - 25));
  const controls = new MapControls(camera, canvas);
  controls.target.set(0, 0, toWorldZ(MAP_H * 0.42));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 70;
  controls.maxDistance = 950;
  controls.maxPolarAngle = 1.32; // nie unter den Horizont
  controls.zoomToCursor = true;

  const terrain = createTerrain3D({ map });
  const heightAt = terrain.heightAt;
  const buildings = createBuildings3D({ map, heightAt });
  const units = createUnits3D({ map, heightAt });
  const atmosphere = createAtmosphere3D({ scene, camera });
  const effects = createEffects3D({ map, heightAt, scene });
  scene.add(terrain.group, buildings.group, units.group);

  // Kameraziel im Tal halten (mit etwas Luft) und Mindesthöhe über Gelände.
  const PAD = 80;
  function clampCamera() {
    const t = controls.target;
    t.x = Math.max(toWorldX(-PAD), Math.min(toWorldX(480 + PAD), t.x));
    t.z = Math.max(toWorldZ(-PAD), Math.min(toWorldZ(960 + PAD), t.z));
    t.y = heightAt(t.x + 240, t.z + 480);
    const minY = heightAt(camera.position.x + 240, camera.position.z + 480) + 14;
    if (camera.position.y < minY) camera.position.y = minY;
  }

  let time = 0;
  const shakeOffset = new THREE.Vector3();

  function draw(view, dt) {
    time += dt;
    controls.update();
    clampCamera();
    terrain.update?.(time, dt);
    buildings.update(view, time, dt);
    units.update(view, time, dt);
    atmosphere.update(time, dt);
    effects.update(view, time, dt);

    // Kurzes Beben (Turm-/Bossfall) als Kameraversatz, additiv und selbstabbauend.
    const shake = effects.getShake();
    camera.position.sub(shakeOffset);
    if (shake > 0.001) {
      shakeOffset.set(
        (Math.random() - 0.5) * 6 * shake,
        (Math.random() - 0.5) * 3 * shake,
        (Math.random() - 0.5) * 6 * shake
      );
      camera.position.add(shakeOffset);
    } else {
      shakeOffset.set(0, 0, 0);
    }

    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    controls.dispose();
    terrain.dispose();
    buildings.dispose();
    units.dispose();
    atmosphere.dispose();
    effects.dispose();
    renderer.dispose();
  }

  // Entwicklungshilfe: Kamera und Szene in der Konsole erreichbar machen
  // (nur im Dev-Server, im Build entfernt das Vite per Dead-Code-Elimination).
  if (import.meta.env.DEV) {
    window.__alterac3d = { camera, controls, scene, renderer };
  }

  resize();
  return { draw, resize, dispose };
}
