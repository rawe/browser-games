// Kampfeffekte des 3D-Modus: übersetzt die typisierten Sim-Ereignisse in
// kurzlebige 3D-Partikel – das Gegenstück zu effects.js der 2D-Fassung.
//
// VERTRAG (renderer3d.js verlässt sich darauf):
//   createEffects3D({ map, heightAt, scene }) → {
//     update(view, time, dt), // neue Ereignisse konsumieren + Partikel bewegen
//     getShake(),             // Kamerabeben 0..1, klingt exponentiell ab
//     dispose(),
//   }
//   heightAt(x, y) nimmt KARTENkoordinaten (x 0–480, y 0–960).
//
// Alles ist gepoolt und wird beim Sim-Wechsel nur zurückgesetzt: ein
// Points-System für Funken/Staub/Glitzer, eine Ring-Flotte für sämtliche
// Bodenringe, kleine Sprite-Pools für Blitze, Schadenszahlen und Geister,
// Zylinder für Lichtsäulen. Im Frame wird nichts allokiert; läuft ein Pool
// über, wird schlicht der älteste Eintrag überschrieben – bei Effekten mit
// Lebensdauern unter einer Sekunde fällt das nicht auf.

import * as THREE from 'three';
import { edgePoint, enemyOf } from '../map.js';
import { toWorldX, toWorldZ, PALETTE, FACTION_COLOR } from './world.js';

const TAU = Math.PI * 2;

// Budgets – bewusst klein, Zielgerät iPad (siehe QUALITY in world.js).
const POOL = 600; // Punktpartikel
const RINGS = 14; // Bodenringe (alle Ringtypen teilen sich diese Flotte)
const FLASHES = 8; // additive Blitz-Sprites
const TEXTS = 10; // Schadenszahlen (nur Boss/Turm)
const WISPS = 10; // Totengeister auf dem Weg zum Friedhof
const BEAMS = 5; // Lichtsäulen (Respawn, Friedhof, Beschwörung)

const rand = (a, b) => a + Math.random() * (b - a);

// Weicher Lichtpunkt für Partikel, Blitze und Geister.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Vertikaler Verlauf für die Lichtsäulen: unten satt, nach oben verhauchend.
function makeBeamTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 128);
  return new THREE.CanvasTexture(c);
}

// Punktpartikel: Größe mit Perspektive (wie sizeAttenuation), Farbe/Alpha je
// Partikel aus Attributen – so reicht EIN Draw-Call für alle Funken.
const PARTICLE_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (420.0 / -mv.z), 0.0, 64.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export function createEffects3D({ map, heightAt, scene }) {
  const group = new THREE.Group();
  scene.add(group);

  const dotTex = makeGlowTexture();
  const beamTex = makeBeamTexture();

  // Vorbelegte Farben – im Ereignis-Handler wird nichts konstruiert.
  const COL = {
    blue: new THREE.Color(FACTION_COLOR.blue),
    red: new THREE.Color(FACTION_COLOR.red),
    warm: new THREE.Color(PALETTE.ember), // Trümmerglut bei Turm-/Bossfall
    white: new THREE.Color(0xfff3d8),
    warn: new THREE.Color(0xff9678), // Kampfbeginn, wie die 2D-Warnfarbe
    snow: new THREE.Color(0xdce8f8), // aufgewirbelter Pulverschnee
    dust: new THREE.Color(0xaeb9cf), // Einsturzstaub
    shield: new THREE.Color(0x9ad4ff),
    beam: new THREE.Color(0xaadfff),
  };
  const facCol = (f) => (f === 'blue' ? COL.blue : COL.red);

  // ------------------------------------------------------------ Punktpartikel
  const pPos = new Float32Array(POOL * 3);
  const pCol = new Float32Array(POOL * 3);
  const pAlpha = new Float32Array(POOL);
  const pSize = new Float32Array(POOL);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  // Simulationszustand außerhalb der GPU-Attribute:
  const pVel = new Float32Array(POOL * 3);
  const pLife = new Float32Array(POOL); // Restleben; <= 0 heißt frei
  const pLife0 = new Float32Array(POOL);
  const pSize0 = new Float32Array(POOL);
  const pGrow = new Float32Array(POOL); // Größenzuwachs über die Lebenszeit (Staubwolken)
  const pGrav = new Float32Array(POOL);
  const pAlpha0 = new Float32Array(POOL);
  const pDelay = new Float32Array(POOL); // verzögerter Start wie in effects.js (negatives Alter)
  let pCursor = 0;

  const pMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: dotTex } },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false; // Partikel liegen über das ganze Tal verstreut
  group.add(points);

  function spawnP(x, y, z, vx, vy, vz, life, size, color, alpha, grav, grow, delay) {
    const i = pCursor;
    pCursor = (pCursor + 1) % POOL;
    const j = i * 3;
    pPos[j] = x;
    pPos[j + 1] = y;
    pPos[j + 2] = z;
    pVel[j] = vx;
    pVel[j + 1] = vy;
    pVel[j + 2] = vz;
    pLife[i] = life;
    pLife0[i] = life;
    pSize0[i] = size;
    pGrow[i] = grow;
    pGrav[i] = grav;
    pAlpha0[i] = alpha;
    pDelay[i] = delay;
    pCol[j] = color.r;
    pCol[j + 1] = color.g;
    pCol[j + 2] = color.b;
    pAlpha[i] = 0;
    pSize[i] = 0;
  }

  function stepParticles(dt) {
    for (let i = 0; i < POOL; i++) {
      if (pLife[i] <= 0) continue;
      if (pDelay[i] > 0) {
        pDelay[i] -= dt;
        continue;
      }
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        pAlpha[i] = 0;
        pSize[i] = 0;
        continue;
      }
      const j = i * 3;
      pVel[j + 1] += pGrav[i] * dt;
      pPos[j] += pVel[j] * dt;
      pPos[j + 1] += pVel[j + 1] * dt;
      pPos[j + 2] += pVel[j + 2] * dt;
      const k = 1 - pLife[i] / pLife0[i];
      pAlpha[i] = pAlpha0[i] * (1 - k);
      pSize[i] = pSize0[i] + pGrow[i] * k;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aAlpha.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
  }

  // Funken-Burst: horizontal streuend mit Aufwärtsanteil, fällt unter Schwerkraft.
  function sparks(wx, wy, wz, color, count, speed, up = 0.6, delay = 0) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * TAU;
      const v = speed * rand(0.35, 1.25);
      spawnP(
        wx,
        wy + 2,
        wz,
        Math.cos(a) * v * 0.8,
        up * speed * rand(0.3, 1.2),
        Math.sin(a) * v * 0.8,
        rand(0.3, 0.65),
        rand(1.5, 3.2),
        color,
        1,
        -170,
        0,
        delay ? Math.random() * delay : 0
      );
    }
  }

  // Heller Schneestaub statt dunklem Qualm: additiv gerendert trägt nur ein
  // helles Grau – im Schneetal liest sich das als aufgewirbelter Pulverschnee.
  function dust(wx, wy, wz, count, size, life, color, alpha) {
    for (let n = 0; n < count; n++) {
      spawnP(
        wx + rand(-12, 12),
        wy + rand(0, 6),
        wz + rand(-12, 12),
        rand(-5, 5),
        rand(8, 20),
        rand(-5, 5),
        life * rand(0.7, 1.3),
        size * rand(0.8, 1.3),
        color,
        alpha,
        0,
        size * 1.6,
        rand(0, 0.15)
      );
    }
  }

  // Aufsteigende Lichtstäubchen, begleiten die Lichtsäulen.
  function glitter(wx, wy, wz, count) {
    for (let n = 0; n < count; n++) {
      spawnP(
        wx + rand(-8, 8),
        wy + rand(0, 6),
        wz + rand(-8, 8),
        rand(-3, 3),
        rand(22, 42),
        rand(-3, 3),
        rand(0.5, 1.0),
        rand(1.2, 2.2),
        COL.beam,
        0.9,
        0,
        0,
        rand(0, 0.25)
      );
    }
  }

  // ------------------------------------------------------------------- Ringe
  const ringGeo = new THREE.RingGeometry(0.82, 1, 40); // Einheitsring, Radius kommt über scale
  const rings = [];
  let ringCursor = 0;
  for (let i = 0; i < RINGS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    group.add(mesh);
    rings.push({ mesh, mat, age: 0, life: 0, maxR: 0, delay: 0, active: false });
  }
  function spawnRing(wx, wy, wz, color, maxR, life, delay = 0) {
    let r = null;
    for (const q of rings) {
      if (!q.active) {
        r = q;
        break;
      }
    }
    if (!r) {
      r = rings[ringCursor];
      ringCursor = (ringCursor + 1) % RINGS;
    }
    r.active = true;
    r.age = 0;
    r.life = life;
    r.maxR = maxR;
    r.delay = delay;
    r.mat.color.copy(color);
    r.mesh.position.set(wx, wy + 0.7, wz); // knapp über dem Boden gegen Z-Fighting
    r.mesh.visible = false;
  }
  function stepRings(dt) {
    for (const r of rings) {
      if (!r.active) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.age += dt;
      if (r.age >= r.life) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const fade = 1 - r.age / r.life;
      // Schnell aufreißen, weich verklingen – dieselbe Kurve wie in 2D.
      r.mesh.scale.setScalar(Math.max(0.001, r.maxR * (1 - fade * fade)));
      r.mat.opacity = fade * 0.85;
      r.mesh.visible = true;
    }
  }

  // ------------------------------------------------------------------ Blitze
  const flashes = [];
  let flashCursor = 0;
  for (let i = 0; i < FLASHES; i++) {
    const mat = new THREE.SpriteMaterial({
      map: dotTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    group.add(sprite);
    flashes.push({ sprite, mat, age: 0, life: 0, size: 0, delay: 0, active: false });
  }
  function spawnFlash(wx, wy, wz, color, size, life, delay = 0) {
    let f = null;
    for (const q of flashes) {
      if (!q.active) {
        f = q;
        break;
      }
    }
    if (!f) {
      f = flashes[flashCursor];
      flashCursor = (flashCursor + 1) % FLASHES;
    }
    f.active = true;
    f.age = 0;
    f.life = life;
    f.size = size;
    f.delay = delay;
    f.mat.color.copy(color);
    f.sprite.position.set(wx, wy, wz);
    f.sprite.visible = false;
  }
  function stepFlashes(dt) {
    for (const f of flashes) {
      if (!f.active) continue;
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.age += dt;
      if (f.age >= f.life) {
        f.active = false;
        f.sprite.visible = false;
        continue;
      }
      const k = f.age / f.life;
      const s = f.size * (0.75 + 0.45 * k);
      f.sprite.scale.set(s, s, 1);
      f.mat.opacity = 1 - k;
      f.sprite.visible = true;
    }
  }

  // ---------------------------------------------------------- Schadenszahlen
  // Nur Boss-/Turmtreffer bekommen eine Zahl – alles andere wäre bei laufender
  // Schlacht aus jeder Kameradistanz reines Flackern.
  const texts = [];
  let textCursor = 0;
  for (let i = 0; i < TEXTS; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    group.add(sprite);
    texts.push({ sprite, mat, tex, ctx, age: 0, life: 0, base: 0, active: false });
  }
  function spawnText(wx, wy, wz, str, cssColor, big) {
    let t = null;
    for (const q of texts) {
      if (!q.active) {
        t = q;
        break;
      }
    }
    if (!t) {
      t = texts[textCursor];
      textCursor = (textCursor + 1) % TEXTS;
    }
    const ctx = t.ctx;
    ctx.clearRect(0, 0, 192, 96);
    ctx.font = '800 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(10,8,4,0.9)';
    ctx.strokeText(str, 96, 48);
    ctx.fillStyle = cssColor;
    ctx.fillText(str, 96, 48);
    t.tex.needsUpdate = true;
    t.active = true;
    t.age = 0;
    t.life = 1.0;
    t.base = big ? 34 : 26;
    t.sprite.position.set(wx + rand(-8, 8), wy, wz + rand(-8, 8));
    t.sprite.visible = false;
  }
  function stepTexts(dt) {
    for (const t of texts) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.active = false;
        t.sprite.visible = false;
        continue;
      }
      const k = t.age / t.life;
      t.sprite.position.y += 15 * dt;
      const s = t.base * (0.7 + 0.3 * Math.min(1, t.age / 0.12)); // kurzes Aufploppen
      t.sprite.scale.set(s, s / 2, 1);
      t.mat.opacity = k > 0.55 ? (1 - k) / 0.45 : 1;
      t.sprite.visible = true;
    }
  }

  // ----------------------------------------------------------------- Geister
  // Zieht in Kartenkoordinaten vom Todesort zum Friedhof (Höhe folgt dem
  // Gelände) – dieselbe geschmeidige Bahn wie der 2D-„wisp".
  const wisps = [];
  let wispCursor = 0;
  for (let i = 0; i < WISPS; i++) {
    const mat = new THREE.SpriteMaterial({
      map: dotTex,
      color: 0xbfe6ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(10, 10, 1);
    sprite.visible = false;
    group.add(sprite);
    wisps.push({ sprite, mat, age: 0, life: 0, sx: 0, sy: 0, tx: 0, ty: 0, active: false });
  }
  function spawnWisp(sx, sy, tx, ty) {
    let w = null;
    for (const q of wisps) {
      if (!q.active) {
        w = q;
        break;
      }
    }
    if (!w) {
      w = wisps[wispCursor];
      wispCursor = (wispCursor + 1) % WISPS;
    }
    w.active = true;
    w.age = 0;
    w.life = 1.5;
    w.sx = sx;
    w.sy = sy;
    w.tx = tx;
    w.ty = ty;
    w.sprite.visible = false;
  }
  function stepWisps(dt) {
    for (const w of wisps) {
      if (!w.active) continue;
      w.age += dt;
      if (w.age >= w.life) {
        w.active = false;
        w.sprite.visible = false;
        continue;
      }
      const k = w.age / w.life;
      const e = k * k * (3 - 2 * k); // smoothstep: sanft los, sanft ankommen
      const mx = w.sx + (w.tx - w.sx) * e;
      const my = w.sy + (w.ty - w.sy) * e;
      const y = heightAt(mx, my) + 15 + Math.sin(Math.PI * e) * 10;
      w.sprite.position.set(toWorldX(mx) + Math.sin(w.age * 7) * 3, y, toWorldZ(my));
      w.mat.opacity = (k > 0.8 ? (1 - k) / 0.2 : 1) * 0.9;
      w.sprite.visible = true;
    }
  }

  // -------------------------------------------------------------- Lichtsäulen
  const beamGeo = new THREE.CylinderGeometry(3, 3.6, 40, 12, 1, true);
  const beams = [];
  let beamCursor = 0;
  for (let i = 0; i < BEAMS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: beamTex,
      color: COL.beam,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(beamGeo, mat);
    mesh.visible = false;
    group.add(mesh);
    beams.push({ mesh, mat, age: 0, life: 0, delay: 0, active: false });
  }
  function spawnBeam(wx, wy, wz, color = COL.beam, delay = 0) {
    let b = null;
    for (const q of beams) {
      if (!q.active) {
        b = q;
        break;
      }
    }
    if (!b) {
      b = beams[beamCursor];
      beamCursor = (beamCursor + 1) % BEAMS;
    }
    b.active = true;
    b.age = 0;
    b.life = 1.0;
    b.delay = delay;
    b.mat.color.copy(color);
    b.mesh.position.set(wx, wy + 20, wz); // Zylinderzentrum: Säule steht auf dem Boden
    b.mesh.visible = false;
  }
  function stepBeams(dt) {
    for (const b of beams) {
      if (!b.active) continue;
      if (b.delay > 0) {
        b.delay -= dt;
        continue;
      }
      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const k = b.age / b.life;
      // Schnell aufglimmen, dann ausklingen; die Säule wird dabei schlanker.
      b.mat.opacity = Math.min(1, k / 0.2) * (1 - k) * 0.9;
      const s = 1 - 0.3 * k;
      b.mesh.scale.set(s, 1, s);
      b.mesh.visible = true;
    }
  }

  // ------------------------------------------------------------ Ereigniskonsum
  let eventIndex = 0;
  let lastSim = null;
  let shake = 0;

  function resolveWhere(where) {
    if (where.node != null) return map.nodes[where.node];
    return edgePoint(map, where.edge.a, where.edge.b, where.edge.frac);
  }

  function resetAll() {
    pLife.fill(0);
    pAlpha.fill(0);
    pSize.fill(0);
    pGeo.attributes.aAlpha.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
    for (const r of rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const f of flashes) {
      f.active = false;
      f.sprite.visible = false;
    }
    for (const t of texts) {
      t.active = false;
      t.sprite.visible = false;
    }
    for (const w of wisps) {
      w.active = false;
      w.sprite.visible = false;
    }
    for (const b of beams) {
      b.active = false;
      b.mesh.visible = false;
    }
    eventIndex = 0;
    shake = 0;
  }

  // Neue Sim-Ereignisse seit dem letzten Frame übersetzen – gleiche Typen und
  // Größenordnungen wie effects.js, nur eben am Boden des Tals statt auf der
  // 2D-Karte. Radien sind Karteneinheiten und damit 1:1 Weltmeter.
  function consume(sim) {
    const evs = sim.events;
    for (; eventIndex < evs.length; eventIndex++) {
      const ev = evs[eventIndex];
      const p = resolveWhere(ev.where);
      const wx = toWorldX(p.x);
      const wz = toWorldZ(p.y);
      const wy = heightAt(p.x, p.y);
      if (ev.type === 'damage') {
        sparks(wx, wy + 6, wz, facCol(ev.faction), ev.tower ? 7 : 5, 40);
        if (ev.boss || ev.tower) {
          spawnText(
            wx,
            wy + (ev.boss ? 34 : 26),
            wz,
            `-${Math.max(1, Math.round(ev.amount))}`,
            ev.boss ? '#ffb14e' : '#dfe6f2',
            !!ev.boss
          );
        }
      } else if (ev.type === 'bossAoe') {
        shake = Math.max(shake, 0.35);
        spawnRing(wx, wy, wz, facCol(ev.faction), 62, 0.55);
        spawnRing(wx, wy, wz, COL.warm, 92, 0.72, 0.08);
        sparks(wx, wy + 4, wz, facCol(ev.faction), 16, 90);
      } else if (ev.type === 'bossShielded') {
        // Abgewehrter Treffer: kurzes Aufblitzen auf Kuppelhöhe des Schilds.
        spawnFlash(wx, wy + 35, wz, COL.shield, 26, 0.35);
      } else if (ev.type === 'towerFight') {
        spawnRing(wx, wy, wz, facCol(ev.faction), 30, 0.5);
      } else if (ev.type === 'towerDown') {
        shake = 1;
        spawnFlash(wx, wy + 16, wz, COL.warm, 70, 0.45);
        spawnRing(wx, wy, wz, COL.warm, 58, 0.6);
        spawnRing(wx, wy, wz, COL.white, 88, 0.8, 0.12);
        sparks(wx, wy + 8, wz, COL.warm, 24, 120, 1.1, 0.1); // Funkenfontäne
        dust(wx, wy, wz, 8, 9, 1.6, COL.dust, 0.3);
      } else if (ev.type === 'combatStart') {
        spawnRing(wx, wy, wz, COL.warn, 34, 0.5);
        sparks(wx, wy + 4, wz, COL.white, 10, 70);
      } else if (ev.type === 'death') {
        dust(wx, wy, wz, 3, 5, 0.7, COL.snow, 0.35);
        // Ohne kontrollierten Friedhof verweht der Geist an Ort und Stelle.
        if (ev.graveyard != null) {
          const gy = map.nodes[ev.graveyard];
          if (gy) spawnWisp(p.x, p.y, gy.x, gy.y);
        }
      } else if (ev.type === 'captureStart') {
        spawnRing(wx, wy, wz, facCol(ev.faction), 26, 0.6);
      } else if (ev.type === 'graveyardCaptured') {
        spawnRing(wx, wy, wz, facCol(ev.faction), 44, 0.7);
        sparks(wx, wy + 4, wz, facCol(ev.faction), 14, 80);
        spawnBeam(wx, wy, wz);
        glitter(wx, wy, wz, 10);
      } else if (ev.type === 'supplyCaptureStart' || ev.type === 'supplyCaptureResumed') {
        // Beginnende/fortgesetzte Inbetriebnahme: dezent wie beim Friedhof.
        spawnRing(wx, wy, wz, facCol(ev.faction), 28, 0.6);
      } else if (ev.type === 'supplyCaptured') {
        shake = Math.max(shake, 0.25);
        spawnFlash(wx, wy + 10, wz, facCol(ev.faction), 45, 0.35);
        spawnRing(wx, wy, wz, facCol(ev.faction), 50, 0.65);
        spawnRing(wx, wy, wz, facCol(ev.faction), 80, 0.85, 0.12);
        sparks(wx, wy + 4, wz, facCol(ev.faction), 20, 100);
        dust(wx, wy, wz, 4, 5, 0.6, COL.snow, 0.3);
      } else if (ev.type === 'supplyBlocked') {
        // Die Blockade geht vom Gegner aus, also trägt sie dessen Farbe.
        const c = facCol(enemyOf(ev.faction));
        spawnRing(wx, wy, wz, c, 42, 0.5);
        sparks(wx, wy + 4, wz, c, 8, 55);
        dust(wx, wy, wz, 3, 7, 1.4, COL.dust, 0.25);
      } else if (ev.type === 'supplyResumed') {
        spawnRing(wx, wy, wz, facCol(ev.faction), 46, 0.6);
        sparks(wx, wy + 4, wz, facCol(ev.faction), 10, 70);
      } else if (ev.type === 'allySummoned') {
        const c = facCol(ev.faction);
        shake = 1;
        spawnFlash(wx, wy + 14, wz, c, 95, 0.6);
        spawnFlash(wx, wy + 22, wz, COL.white, 55, 0.5, 0.18);
        spawnBeam(wx, wy, wz);
        spawnBeam(wx, wy, wz, c, 0.12);
        for (let i = 0; i < 3; i++) {
          spawnRing(wx, wy, wz, i % 2 ? COL.white : c, 66 + i * 42, 0.8 + i * 0.18, i * 0.14);
        }
        sparks(wx, wy + 6, wz, c, 32, 150, 0.8, 0.2);
        sparks(wx, wy + 14, wz, COL.white, 16, 90, 0.8, 0.2);
        dust(wx, wy, wz, 4, 8, 1.2, COL.snow, 0.3);
      } else if (ev.type === 'respawn') {
        spawnBeam(wx, wy, wz);
        glitter(wx, wy, wz, 10);
      } else if (ev.type === 'bossDown') {
        shake = 1;
        spawnFlash(wx, wy + 20, wz, COL.warm, 110, 0.5);
        spawnRing(wx, wy, wz, COL.warm, 90, 0.7);
        spawnRing(wx, wy, wz, COL.white, 130, 0.9, 0.15);
        sparks(wx, wy + 10, wz, COL.warm, 38, 160, 1.0, 0.15);
        dust(wx, wy, wz, 8, 10, 1.8, COL.dust, 0.3);
      }
    }
  }

  function update(view, time, dt) {
    void time;
    const sim = view ? view.sim : null;
    if (sim !== lastSim) {
      resetAll();
      lastSim = sim;
    }
    if (sim) consume(sim);
    stepParticles(dt);
    stepRings(dt);
    stepFlashes(dt);
    stepTexts(dt);
    stepWisps(dt);
    stepBeams(dt);
    // Beben klingt exponentiell ab, Halbwertszeit ~0,25 s – kurz und knackig,
    // ohne dass sich zwei nahe Einschläge zu Dauergewackel aufschaukeln.
    shake *= Math.pow(0.5, dt / 0.25);
    if (shake < 0.001) shake = 0;
  }

  function getShake() {
    return shake;
  }

  function dispose() {
    scene.remove(group);
    pGeo.dispose();
    pMat.dispose();
    ringGeo.dispose();
    beamGeo.dispose();
    for (const r of rings) r.mat.dispose();
    for (const f of flashes) f.mat.dispose();
    for (const t of texts) {
      t.mat.dispose();
      t.tex.dispose();
    }
    for (const w of wisps) w.mat.dispose();
    for (const b of beams) b.mat.dispose();
    dotTex.dispose();
    beamTex.dispose();
  }

  return { update, getShake, dispose };
}
