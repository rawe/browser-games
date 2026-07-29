// Atmosphäre des 3D-Modus: Licht, Himmel, Nebel und Schneetreiben.
//
// VERTRAG (renderer3d.js verlässt sich darauf):
//   createAtmosphere3D({ scene, camera }) → { update(time, dt), dispose() }
//   Das Modul hängt Lichter/Himmel/Partikel selbst in die Szene und setzt
//   scene.fog + scene.background.
//
// Stimmung (Palette in world.js): düstere Abenddämmerung im Hochtal – kaltes
// Mondlicht aus Nordwest, tief hängender Talnebel, feines Schneetreiben und
// hoch am Nordhimmel ein zurückhaltendes Nordlicht.

import * as THREE from 'three';
import { PALETTE, QUALITY, seededRand } from './world.js';
import { getTexture } from './textures.js';

// Weiche runde Flocke als Canvas-Sprite – kein Bild-Asset nötig, und die
// Additiv-Mischung braucht ohnehin nur den Alphakanal.
function makeFlakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Nordlicht-Vorhang: das Wabern läuft komplett im Shader (Vertex-Wellen +
// wandernde Helligkeitsbänder), damit pro Frame nur eine Uniform anfällt.
const AURORA_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w = sin(uv.x * 9.0 + uTime * 0.22 + uSeed) * 0.6
            + sin(uv.x * 23.0 - uTime * 0.13 + uSeed * 2.0) * 0.4;
    p.y += w * 42.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const AURORA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    // Weich an allen Rändern; die vertikalen Helligkeitsbänder ziehen langsam
    // durch. Alpha bleibt unter ~0,2 – subtil, kein Kirmeslicht.
    float ax = sin(vUv.x * 3.14159);
    float ay = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float bands = 0.6 + 0.4 * sin(vUv.x * 26.0 + uTime * 0.35 + uSeed * 3.0);
    vec3 col = mix(vec3(0.15, 0.85, 0.55), vec3(0.2, 0.7, 0.8), vUv.y);
    gl_FragColor = vec4(col, ax * ay * bands * 0.18);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  varying float vTwinkle;
  void main() {
    // Jede Phase liefert zugleich eine eigene Funkel-Frequenz – so wirkt das
    // Blinken unregelmäßig, ohne ein zweites Attribut zu kosten.
    vTwinkle = 0.6 + 0.4 * sin(uTime * (0.4 + fract(aPhase * 0.37) * 1.4) + aPhase);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const STAR_FRAG = /* glsl */ `
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float m = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(vec3(0.80, 0.86, 1.0), m * vTwinkle * 0.75);
  }
`;

const SNOW_VERT = /* glsl */ `
  attribute float aSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Perspektivische Größe wie PointsMaterial (sizeAttenuation), aber mit
    // Per-Flocke-Größe; Clamp hält ferne Flocken sichtbar und nahe zivil.
    gl_PointSize = clamp(aSize * (420.0 / -mv.z), 1.0, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const SNOW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vec3(0.85, 0.89, 0.96), a * 0.55);
  }
`;

export function createAtmosphere3D({ scene, camera }) {
  const group = new THREE.Group();
  const disposables = [];

  // ------------------------------------------------------------------ Himmel
  let starMat = null;
  const skyTex = getTexture('sky-dusk', { repeat: false });
  if (skyTex) {
    // Gemaltes Panorama liegt vor – äquirektangular als Szenenhintergrund.
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = skyTex;
  } else {
    // Prozeduraler Dome: Der Vertex-Verlauf skyTop→skyHorizon reicht bei den
    // gedeckten Dämmerungsfarben völlig; ein Shader wäre nur Mehrgewicht.
    scene.background = new THREE.Color(PALETTE.skyTop);
    const domeGeo = new THREE.SphereGeometry(2600, 28, 14);
    const top = new THREE.Color(PALETTE.skyTop);
    const hor = new THREE.Color(PALETTE.skyHorizon);
    const posA = domeGeo.attributes.position;
    const cols = new Float32Array(posA.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < posA.count; i++) {
      // Unter dem Horizont bleibt die Horizontfarbe stehen – dort steht Gelände.
      const t = Math.pow(Math.max(0, posA.getY(i) / 2600), 0.55);
      c.copy(hor).lerp(top, t);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    domeGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const domeMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false, // der Dome IST der Fernhorizont, Nebel darauf wäre doppelt
      depthWrite: false,
    });
    group.add(new THREE.Mesh(domeGeo, domeMat));
    disposables.push(domeGeo, domeMat);

    // Erste Sterne der Dämmerung: nur oberhalb ~9° Höhe, damit sie nicht im
    // hellen Dunstsaum am Horizont kleben. Deterministisch (seededRand).
    const STARS = 320;
    const rnd = seededRand(1187);
    const sPos = new Float32Array(STARS * 3);
    const sPhase = new Float32Array(STARS);
    const sSize = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      let x, y, z, l;
      do {
        x = rnd() * 2 - 1;
        y = rnd();
        z = rnd() * 2 - 1;
        l = Math.hypot(x, y, z);
      } while (l > 1 || l < 0.1 || y / l < 0.16);
      sPos[i * 3] = (x / l) * 2500;
      sPos[i * 3 + 1] = (y / l) * 2500;
      sPos[i * 3 + 2] = (z / l) * 2500;
      sPhase[i] = rnd() * 100;
      sSize[i] = 1.4 + rnd() * 1.8;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
    starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false; // Vollhimmel – Culling-Rechnung lohnt nicht
    group.add(stars);
    disposables.push(starGeo, starMat);
  }

  // --------------------------------------------------------------- Nordlicht
  // Zwei große additive Vorhänge hoch über dem Nordkamm – bewusst in beiden
  // Himmelsvarianten, denn das langsame Wabern kann kein statisches Panorama.
  const auroraMats = [];
  const auroraGeo = new THREE.PlaneGeometry(1500, 300, 48, 1);
  disposables.push(auroraGeo);
  const auroraDefs = [
    { x: -260, y: 860, z: -2050, seed: 0.0, tilt: 0.16, scale: 1 },
    { x: 340, y: 1010, z: -2120, seed: 3.7, tilt: 0.22, scale: 0.8 },
  ];
  for (const d of auroraDefs) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: d.seed } },
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(auroraGeo, mat);
    mesh.position.set(d.x, d.y, d.z);
    mesh.rotation.x = d.tilt;
    mesh.scale.setScalar(d.scale);
    mesh.frustumCulled = false; // Vertex-Wellen sprengen sonst die Bounding-Box
    group.add(mesh);
    auroraMats.push(mat);
    disposables.push(mat);
  }

  // ------------------------------------------------------------------- Licht
  // Die Hemisphäre hebt Schattenseiten auf lesbares Blaugrau, der „Mond" aus
  // Nordwest setzt harte kalte Kanten. Intensitäten liegen bewusst über 1,
  // weil das ACES-Tone-Mapping (renderer3d, Exposure 1.28) sonst absäuft.
  // Kalibriert auf „blaue Stunde mit Biss": deutlich heller als reine Nacht,
  // damit Felswände, Türme und Schattenseiten nicht schwarz absaufen –
  // geprüft am dunkelsten Fall, einer mondabgewandten Figur auf freiem Feld.
  const hemi = new THREE.HemisphereLight(PALETTE.ambientSky, PALETTE.ambientGround, 2.6);
  const moon = new THREE.DirectionalLight(PALETTE.moonlight, 2.3);
  moon.position.set(-430, 290, -470); // Nordwest, tief über den Graten
  moon.castShadow = true;
  moon.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
  // Ortho-Kaskade exakt über das Tal (480×960 plus Rand): je enger der
  // Frustum, desto mehr Schattenauflösung pro Meter.
  const sc = moon.shadow.camera;
  sc.left = -420;
  sc.right = 420;
  sc.top = 680;
  sc.bottom = -680;
  sc.near = 60;
  sc.far = 1600; // Licht→fernste Talecke ≈ 1200, mit Luft
  moon.shadow.bias = -0.0006; // gegen Akne auf den flachen Schneeflächen
  moon.shadow.normalBias = 2; // gegen Lichtlecks an den Low-Poly-Kanten
  moon.target.position.set(0, 0, 0);
  // Gegenlicht aus Süden: reißt die mondabgewandten Seiten (Figuren von hinten,
  // Süd-Fassaden) aus dem Schwarz, kühl getönt, damit es nicht als zweite
  // sichtbare Lichtquelle auffällt, sondern nur als Aufhellung liest.
  const fire = new THREE.DirectionalLight(0x93a8d4, 1.15);
  fire.position.set(140, 190, 640);
  group.add(hemi, moon, moon.target, fire);

  // ------------------------------------------------------------------- Nebel
  // FogExp2 mit 0.0011: bei 600 Einheiten bleiben ~65 % Restsicht, bei 900
  // noch ~37 % – die jeweils ferne Talhälfte versinkt stimmungsvoll, der
  // Nahbereich (Kampfdistanz < 400) bleibt klar lesbar.
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0011);

  // ----------------------------------------------------------- Schneetreiben
  // EIN Points-System in einer kamerazentrierten Box: Flocken, die die Box
  // verlassen, werden zyklisch versetzt – so schneit es überall, wohin die
  // Kamera fährt, ohne je Partikel nachzuerzeugen.
  const SNOW = QUALITY.snowParticles;
  const HX = 250;
  const HY = 150;
  const HZ = 250;
  const flakeTex = makeFlakeTexture();
  const snowPos = new Float32Array(SNOW * 3);
  const snowSize = new Float32Array(SNOW);
  const fall = new Float32Array(SNOW); // Fallgeschwindigkeit je Flocke
  const sway = new Float32Array(SNOW); // Phase fürs seitliche Pendeln
  const srnd = seededRand(4409);
  for (let i = 0; i < SNOW; i++) {
    snowPos[i * 3] = (srnd() * 2 - 1) * HX;
    snowPos[i * 3 + 1] = (srnd() * 2 - 1) * HY;
    snowPos[i * 3 + 2] = (srnd() * 2 - 1) * HZ;
    fall[i] = 26 + srnd() * 38;
    sway[i] = srnd() * Math.PI * 2;
    // Zwei Größenklassen: wenige „nahe" dicke Flocken vor vielen feinen.
    snowSize[i] = i % 4 === 0 ? 3.0 : 1.7;
  }
  const snowGeo = new THREE.BufferGeometry();
  const snowPosAttr = new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage);
  snowGeo.setAttribute('position', snowPosAttr);
  snowGeo.setAttribute('aSize', new THREE.BufferAttribute(snowSize, 1));
  const snowMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: flakeTex } },
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false; // die Box hängt an der Kamera, nie außer Sicht
  group.add(snow);
  disposables.push(snowGeo, snowMat, flakeTex);

  scene.add(group);

  function update(time, dt) {
    if (starMat) starMat.uniforms.uTime.value = time;
    for (const m of auroraMats) m.uniforms.uTime.value = time;

    // Grundwind nach Ost/Süd mit langsamer Drift; jede Flocke pendelt dazu
    // mit eigener Phase, damit das Treiben nicht wie ein Vorhang wirkt.
    const windX = 13 + 9 * Math.sin(time * 0.05);
    const windZ = 7 * Math.sin(time * 0.031 + 1.3);
    const cx = camera.position.x;
    const cy = camera.position.y + 50; // Box etwas nach oben versetzt: es fällt mehr zu als weg
    const cz = camera.position.z;
    for (let i = 0; i < SNOW; i++) {
      const j = i * 3;
      snowPos[j] += (windX + 7 * Math.sin(time * 0.8 + sway[i])) * dt;
      snowPos[j + 1] -= fall[i] * dt;
      snowPos[j + 2] += windZ * dt;
      // Modulo-Wrap relativ zur Kamera: funktioniert auch nach Kamerasprüngen
      // in einem Schritt, nicht erst nach mehreren Box-Längen.
      let d = snowPos[j] - cx;
      d -= Math.floor((d + HX) / (2 * HX)) * 2 * HX;
      snowPos[j] = cx + d;
      d = snowPos[j + 1] - cy;
      d -= Math.floor((d + HY) / (2 * HY)) * 2 * HY;
      snowPos[j + 1] = cy + d;
      d = snowPos[j + 2] - cz;
      d -= Math.floor((d + HZ) / (2 * HZ)) * 2 * HZ;
      snowPos[j + 2] = cz + d;
    }
    snowPosAttr.needsUpdate = true;
  }

  function dispose() {
    scene.remove(group);
    scene.fog = null;
    scene.background = null; // die geteilte sky-Textur lebt im textures-Cache weiter
    for (const d of disposables) d.dispose();
  }

  return { update, dispose };
}
