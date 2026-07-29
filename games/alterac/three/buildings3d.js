// Bauwerke des 3D-Modus: Festungen, Wachtürme, Friedhöfe, Vorratslager.
//
// VERTRAG (renderer3d.js verlässt sich darauf):
//   createBuildings3D({ map, heightAt }) → {
//     group,                  // THREE.Group mit allen Bauwerken
//     update(view, time, dt), // je Frame: Zustände aus view.sim spiegeln
//                             // (view.sim kann null sein → Ausgangszustand)
//     dispose(),
//   }
//
// Bauprinzip: Jedes Bauwerk wird aus bemalten Grundkörpern (Box, Zylinder,
// Kegel …) zusammengesetzt und je Materialgruppe zu EINER BufferGeometry
// verschmolzen. Ohne Bild-Texturen bleibt es bei einer Gruppe (Vertex-Farben
// + flatShading → ein Bauwerk, ein Draw-Call, exakt der bisherige Look);
// liegen Mauerwerk-/Holz-Texturen vor, kommen je Bauwerk höchstens zwei
// weitere Gruppen dazu. Nur Zustandsträger (flackernde Fenster, Fahnentuch,
// Schildkuppel, Fortschrittsring) bekommen eigene kleine Materialien, weil
// sie sich unabhängig voneinander ändern müssen.
//
// update() arbeitet allokationsfrei: alle Vektoren/Farben/Canvas-Texturen
// entstehen beim Aufbau und werden nur noch beschrieben; Canvas-Texturen
// (Lebensbalken) werden ausschließlich bei Wertänderung neu gezeichnet.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toWorldX, toWorldZ, PALETTE, FACTION_COLOR, FACTION_DARK, seededRand } from './world.js';
import { getTexture } from './textures.js';

const TAU = Math.PI * 2;
const NEUTRAL_FLAG = 0x7c88a2; // Fahnengrau herrenloser Punkte (wie 2D)

// ---------------------------------------------------------------- Geometriebau

// Vertex-Farbattribut in einer Einheitsfarbe – flatShading macht daraus die
// facettierte Low-Poly-Optik, ohne dass wir je Fläche Farben mischen müssten.
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Kachelgrößen der Bild-Texturen in Welteinheiten: eine volle Textur-Kachel
// deckt so viele Einheiten ab. Damit wirken Steinfugen und Bohlenbreiten an
// allen Bauwerken gleich groß, egal wie groß das jeweilige Grundkörper-Teil ist.
const STONE_TILE = 30;
const WOOD_TILE = 16;

// Weltplanare UV-Projektion je Dreiecksfläche: die dominante Achse der
// Flächennormale bestimmt die Projektionsebene, UV = Bauwerkskoordinate /
// Kachelgröße. Vorteil gegenüber den nativen 0..1-UVs der Grundkörper: die
// Kachelung ist überall gleich groß UND Fugen benachbarter Teile fluchten
// (Mauersegmente, Zinnen, Kistenstapel). Erwartet non-indexed Geometrie und
// läuft NACH den Transformationen des Teils. Nur Bauzeit, keine Frame-Kosten.
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _pc = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
function projectWorldUVs(geo, tile) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    _pa.fromBufferAttribute(pos, i);
    _pb.fromBufferAttribute(pos, i + 1);
    _pc.fromBufferAttribute(pos, i + 2);
    const n = _ab.subVectors(_pb, _pa).cross(_ac.subVectors(_pc, _pa));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let j = 0; j < 3; j++) {
      const p = j === 0 ? _pa : j === 1 ? _pb : _pc;
      let u;
      let v;
      if (ay >= ax && ay >= az) {
        u = p.x; // Boden-/Deckflächen: von oben projizieren
        v = p.z;
      } else if (ax >= az) {
        u = p.z; // Blick entlang x
        v = p.y;
      } else {
        u = p.x; // Blick entlang z
        v = p.y;
      }
      uv[(i + j) * 2] = u / tile;
      uv[(i + j) * 2 + 1] = v / tile;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Zylinder/Kegel-Mäntel behalten ihre nativen UVs (x: einmal um den Umfang,
// y: über die Höhe) und werden nur auf Weltmaß skaliert – so bleibt die
// Kachelung rundum nahtlos, was die planare Projektion dort nicht schafft.
function scaleUVs(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

// Tönung texturierter Teile: die Bild-Textur bringt Struktur und Eigenfarbe
// mit, die Vertex-Farbe multipliziert nur noch darüber. Die bisherigen
// Grau-/Brauntöne würden das Ergebnis doppelt abdunkeln – darum werden sie
// Richtung Weiß angehoben; die relativen Helligkeitsunterschiede der Teile
// (z. B. Zinnen dunkler als Mauer) bleiben dabei erhalten.
const WHITE = new THREE.Color(0xffffff);
function liftColor(hex, amount) {
  return new THREE.Color(hex).lerp(WHITE, amount).getHex();
}

// ---------------------------------------------------------------- Shader

// Schildkuppel: fresnel-artig – am Rand (Blick streift die Kugel) deutlich,
// in der Mitte fast durchsichtig. Additiv, damit sie wie kaltes Licht wirkt.
const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float puls = 0.85 + 0.15 * sin(uTime * 2.3);
    gl_FragColor = vec4(
      uColor * (0.35 + 0.65 * fres),
      uOpacity * (0.16 + 0.84 * fres) * puls
    );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Fortschrittsring der Friedhofseinnahme: EIN fester Ring, der Fortschritt
// lebt in einer Uniform – so entsteht je Frame keine neue Geometrie. Winkel 0
// liegt „oben" (Norden), der Bogen wächst im Uhrzeigersinn wie in der 2D-Karte.
const RING_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
  uniform float uFrac;
  uniform vec3 uColor;
  varying vec2 vPos;
  void main() {
    float ang = atan(vPos.x, vPos.y);
    if (ang < 0.0) ang += 6.28318530718;
    if (ang / 6.28318530718 > uFrac) discard;
    gl_FragColor = vec4(uColor, 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- Fabrik

export function createBuildings3D({ map, heightAt }) {
  const group = new THREE.Group();

  // --------------------------------------------------------- geteilte Basis
  // EIN Material für alle soliden Bauteile – Farben stecken in den Vertices.
  const solidMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
  });

  // Kacheltexturen für Mauerwerk und Holz: rein kosmetisch. Fehlt eine Datei
  // (getTexture → null), bleibt das jeweilige Material null und alle Teile
  // laufen unverändert über solidMat – der Look ohne Assets ändert sich nicht.
  // Die Vertex-Farben bleiben auch mit Textur aktiv und tönen sie.
  function tiledMaterial(map) {
    return new THREE.MeshStandardMaterial({
      map,
      vertexColors: true,
      flatShading: true,
      roughness: 0.92,
      metalness: 0,
    });
  }
  const stoneWallTex = getTexture('stone-wall');
  const woodTex = getTexture('wood-dark');
  const stoneWallMat = stoneWallTex ? tiledMaterial(stoneWallTex) : null;
  const woodMat = woodTex ? tiledMaterial(woodTex) : null;

  // Sammler für Einzelteile eines Bauwerks. `colorHex` = null lässt das
  // Farbattribut weg (für rein emissive Teile, deren Material die Farbe trägt).
  // Alle Teile werden non-indexed gehalten, damit mergeGeometries beliebige
  // Grundkörper (auch Polyeder ohne Index) mischen kann.
  //
  // Textur-Gruppen: `opts.tex = 'stone' | 'wood'` legt ein Teil in die
  // Mauerwerk- bzw. Holz-Gruppe; fehlt die Textur, fällt es lautlos in die
  // Basis-Gruppe zurück (inklusive Originalfarbe). `opts.uvCyl = [Radius,
  // Höhe]` skaliert die nativen Mantel-UVs eines Zylinders/Kegels auf
  // Weltmaß (Umfang bzw. Höhe je Kachel) – rundum nahtlos; ohne uvCyl werden
  // die UVs weltplanar projiziert (für Boxen: fluchtende Fugen).
  function makeParts(withColor = true) {
    const buckets = { base: [], stone: [], wood: [] };
    return {
      add(geoIn, colorHex, opts = {}) {
        const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = opts;
        let geo = geoIn;
        if (geo.index) {
          const ni = geo.toNonIndexed();
          geo.dispose();
          geo = ni;
        }
        if (sx !== 1 || sy !== 1 || sz !== 1) geo.scale(sx, sy, sz);
        if (rz) geo.rotateZ(rz);
        if (rx) geo.rotateX(rx);
        if (ry) geo.rotateY(ry);
        geo.translate(x, y, z);
        let bucket = 'base';
        if (opts.tex === 'stone' && stoneWallMat) bucket = 'stone';
        else if (opts.tex === 'wood' && woodMat) bucket = 'wood';
        if (bucket !== 'base') {
          const tile = bucket === 'stone' ? STONE_TILE : WOOD_TILE;
          if (opts.uvCyl) scaleUVs(geo, (TAU * opts.uvCyl[0]) / tile, opts.uvCyl[1] / tile);
          else projectWorldUVs(geo, tile);
          // Holz etwas stärker anheben – die Bohlentextur ist selbst dunkel.
          colorHex = liftColor(colorHex, bucket === 'stone' ? 0.55 : 0.6);
        }
        if (withColor && colorHex != null) paint(geo, colorHex);
        buckets[bucket].push(geo);
      },
      // merge() liefert nur die Basis-Gruppe – für die kleinen Sammler mit
      // eigenem Material (Fenster, Grabsteine), die keine Texturen nutzen.
      merge() {
        const merged = mergeGeometries(buckets.base, false);
        for (const p of buckets.base) p.dispose();
        return merged;
      },
      // attach() erzeugt je belegter Gruppe ein Mesh unter `parent` –
      // Basis mit solidMat, Textur-Gruppen mit ihrem Kachel-Material.
      attach(parent) {
        for (const [name, mat] of [['base', solidMat], ['stone', stoneWallMat], ['wood', woodMat]]) {
          const list = buckets[name];
          if (!list.length) continue;
          const merged = mergeGeometries(list, false);
          for (const p of list) p.dispose();
          const mesh = new THREE.Mesh(merged, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
        }
      },
    };
  }

  // Bannertuch: Bild-Textur falls vorhanden, sonst schlichte Fraktionsfarbe.
  // Nachts hängt das Tuch fast immer auf der Schattenseite des Mondlichts –
  // eine dezente Eigenleuchte über dieselbe Textur hält Emblem und Farbe
  // lesbar, ohne dass das Banner wie eine Lampe strahlt.
  function bannerMaterial(faction) {
    const tex = getTexture(`banner-${faction}`, { repeat: false });
    return new THREE.MeshLambertMaterial({
      map: tex ?? null,
      color: tex ? 0xffffff : FACTION_COLOR[faction],
      emissive: tex ? 0xffffff : FACTION_COLOR[faction],
      emissiveMap: tex ?? null,
      emissiveIntensity: tex ? 0.42 : 0.2,
      side: THREE.DoubleSide,
    });
  }
  const bannerMat = { blue: bannerMaterial('blue'), red: bannerMaterial('red') };

  // Weiche Radialverläufe für Flammen/Rauch – einmal gebacken, überall benutzt.
  function makeRadialTexture(stops) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const flameTex = makeRadialTexture([
    [0, 'rgba(255,225,160,1)'],
    [0.35, 'rgba(255,165,70,0.8)'],
    [0.7, 'rgba(210,85,30,0.25)'],
    [1, 'rgba(120,40,10,0)'],
  ]);
  const smokeTex = makeRadialTexture([
    [0, 'rgba(150,155,170,0.5)'],
    [0.6, 'rgba(110,115,130,0.22)'],
    [1, 'rgba(90,95,110,0)'],
  ]);
  // Flammen teilen sich ein Material (nur Skalierung wird animiert); Rauch
  // braucht je Fahne eigene Deckkraft und bekommt darum geklonte Materialien.
  const flameMat = new THREE.SpriteMaterial({
    map: flameTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  // ------------------------------------------------------- Zustandsregister
  const fortressEntries = [];
  const towerEntries = [];
  const gyEntries = [];
  const supplyEntries = [];
  const flags = []; // alle wehenden Tücher: { mesh, holder, geo, base, w, phase, amp }

  // Wiederverwendete Rechenobjekte für update() – keine Frame-Allokationen.
  const fireCol = new THREE.Color(PALETTE.fireLight);
  const neutralCol = new THREE.Color(NEUTRAL_FLAG);
  const factionCol = {
    blue: new THREE.Color(FACTION_COLOR.blue),
    red: new THREE.Color(FACTION_COLOR.red),
  };

  // Wehendes Tuch: Plane mit fixierter Mastkante, Welle wächst zur freien
  // Kante hin (nx = 0 am Mast … 1 außen), wie das 2D-`traceFlag`.
  function makeFlag(w, h, material, phase, amp, holder = null) {
    const geo = new THREE.PlaneGeometry(w, h, 10, 6);
    geo.translate(w / 2, 0, 0);
    const mesh = new THREE.Mesh(geo, material);
    flags.push({ mesh, holder, geo, base: geo.attributes.position.array.slice(), w, phase, amp });
    return mesh;
  }

  function waveFlags(time) {
    for (const f of flags) {
      if (!f.mesh.visible || (f.holder && !f.holder.visible)) continue;
      const arr = f.geo.attributes.position.array;
      const base = f.base;
      for (let i = 0; i < arr.length; i += 3) {
        const nx = base[i] / f.w;
        arr[i + 2] = Math.sin(time * 6 + nx * 4.2 + f.phase) * f.amp * nx;
        arr[i + 1] = base[i + 1] + Math.sin(time * 3.3 + nx * 2.6 + f.phase) * 0.3 * nx;
      }
      f.geo.attributes.position.needsUpdate = true;
    }
  }

  // Schwebender Lebensbalken (Canvas-Sprite). Neu gezeichnet wird nur, wenn
  // sich der quantisierte Füllstand ändert; Farbstufen wie drawHpBar in 2D.
  function makeHpSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 12;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(16, 3, 1);
    sprite.renderOrder = 5;
    sprite.visible = false;
    return { sprite, ctx: canvas.getContext('2d'), tex, lastKey: -1 };
  }

  function drawHpSprite(h, ratio) {
    const key = Math.round(Math.max(0, Math.min(1, ratio)) * 48);
    if (key === h.lastKey) return;
    h.lastKey = key;
    const ctx = h.ctx;
    ctx.clearRect(0, 0, 64, 12);
    ctx.fillStyle = 'rgba(5,8,13,0.85)';
    ctx.fillRect(0, 0, 64, 12);
    ctx.fillStyle = '#2a3346';
    ctx.fillRect(2, 2, 60, 8);
    const r = key / 48;
    ctx.fillStyle = r > 0.5 ? '#6ecf73' : r > 0.25 ? '#ffd76a' : '#ff6b5e';
    ctx.fillRect(2, 2, Math.round(60 * r), 8);
    h.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------- Festungen
  // Bergfried mit Mauerring, Torbogen, Zinnen und Ecktürmchen. Mauerwerk in
  // Steintönen, Fraktionsfarbe nur als Akzent (Banner, Torlicht).
  function buildFortress(node) {
    const faction = node.faction;
    const rng = seededRand(node.x * 73 + node.y * 131);
    const g = new THREE.Group();
    // ~2 Einheiten ins Gelände versenkt, damit der Sockel nirgends schwebt.
    g.position.set(toWorldX(node.x), heightAt(node.x, node.y) - 2, toWorldZ(node.y));
    // Das Tor blickt ins Tal: Rot (Norden) nach Süden (+z), Blau umgekehrt.
    g.rotation.y = faction === 'red' ? 0 : Math.PI;
    group.add(g);

    const parts = makeParts();
    const half = 30; // halbe Kantenlänge des Mauerrings
    const wallH = 16;
    // Sockelplatte (ragt 10 nach unten – fängt Hanglagen ab)
    parts.add(new THREE.BoxGeometry(78, 12, 78), PALETTE.stoneDark, { y: -4, tex: 'stone' });
    // Mauerring; die Frontmauer lässt das Tor frei
    parts.add(new THREE.BoxGeometry(66, wallH, 5), PALETTE.stone, { y: wallH / 2 + 2, z: -half, tex: 'stone' });
    parts.add(new THREE.BoxGeometry(5, wallH, 66), PALETTE.stone, { x: -half, y: wallH / 2 + 2, tex: 'stone' });
    parts.add(new THREE.BoxGeometry(5, wallH, 66), PALETTE.stone, { x: half, y: wallH / 2 + 2, tex: 'stone' });
    parts.add(new THREE.BoxGeometry(23, wallH, 5), PALETTE.stone, { x: -21.5, y: wallH / 2 + 2, z: half, tex: 'stone' });
    parts.add(new THREE.BoxGeometry(23, wallH, 5), PALETTE.stone, { x: 21.5, y: wallH / 2 + 2, z: half, tex: 'stone' });
    // Torbogen: Sturz über der Öffnung (steinsichtig, gehört zum Mauerwerk)
    parts.add(new THREE.BoxGeometry(21, 6, 6), PALETTE.stone, { y: wallH + 1, z: half, tex: 'stone' });
    // Zinnen entlang der Mauern (die Front nur über den Mauersegmenten)
    for (let i = -3; i <= 3; i++) {
      const x = i * 8.5;
      parts.add(new THREE.BoxGeometry(3.4, 3, 5.6), PALETTE.stoneDark, { x, y: wallH + 3.5, z: -half, tex: 'stone' });
      parts.add(new THREE.BoxGeometry(5.6, 3, 3.4), PALETTE.stoneDark, { x: -half, y: wallH + 3.5, z: x, tex: 'stone' });
      parts.add(new THREE.BoxGeometry(5.6, 3, 3.4), PALETTE.stoneDark, { x: half, y: wallH + 3.5, z: x, tex: 'stone' });
      if (Math.abs(x) > 12) {
        parts.add(new THREE.BoxGeometry(3.4, 3, 5.6), PALETTE.stoneDark, { x, y: wallH + 3.5, z: half, tex: 'stone' });
      }
    }
    // Ecktürmchen mit spitzen Dächern (Schaft: mittlerer Radius 7 für die UVs)
    for (const [cx, cz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
      parts.add(new THREE.CylinderGeometry(6.5, 7.5, 26, 8), PALETTE.stone, { x: cx, y: 13, z: cz, tex: 'stone', uvCyl: [7, 26] });
      parts.add(new THREE.ConeGeometry(8.5, 12, 8), PALETTE.roof, { x: cx, y: 32, z: cz });
    }
    // Bergfried: massiver Sockelklotz, Obergeschoss, Pyramidendach (~78 hoch)
    parts.add(new THREE.BoxGeometry(30, 38, 30), PALETTE.stone, { y: 21, tex: 'stone' });
    parts.add(new THREE.BoxGeometry(24, 20, 24), PALETTE.stoneDark, { y: 50, tex: 'stone' });
    for (const [zx, zz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      parts.add(new THREE.BoxGeometry(3.5, 3, 3.5), PALETTE.stoneDark, { x: zx, y: 61.5, z: zz, tex: 'stone' });
    }
    parts.add(new THREE.ConeGeometry(17, 18, 4), PALETTE.roof, { y: 69, ry: Math.PI / 4 });
    // Bannermast auf der Dachspitze (zu dünn für sichtbare Holzmaserung)
    parts.add(new THREE.CylinderGeometry(0.5, 0.7, 20, 5), PALETTE.woodDark, { y: 84 });
    // Feuerschale vor dem Tor (auf der Sockelplatte; zu klein für Mauerwerk)
    parts.add(new THREE.CylinderGeometry(3.6, 2.2, 3, 8), PALETTE.stoneDark, { x: 15, y: 3.5, z: 33 });
    parts.attach(g);

    // Emissive Flächen: Fenster des Bergfrieds + Glut in der Feuerschale.
    // Eigenes Material je Festung, weil Flackerphase und Boss-Tod lokal sind.
    const windowsMat = new THREE.MeshBasicMaterial({ color: PALETTE.fireLight });
    const winParts = makeParts(false);
    winParts.add(new THREE.PlaneGeometry(3.4, 5), null, { x: -7, y: 26, z: 15.15 });
    winParts.add(new THREE.PlaneGeometry(3.4, 5), null, { x: 7, y: 32, z: 15.15 });
    winParts.add(new THREE.PlaneGeometry(3, 4.2), null, { y: 50, z: 12.15 });
    winParts.add(new THREE.CylinderGeometry(2.8, 2.8, 0.8, 8), null, { x: 15, y: 5.1, z: 33 });
    const windowsMesh = new THREE.Mesh(winParts.merge(), windowsMat);
    g.add(windowsMesh);

    // Torlicht in Fraktionsfarbe – der einzige farbige Akzent am Mauerwerk.
    const accentMat = new THREE.MeshBasicMaterial({
      color: FACTION_COLOR[faction],
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const accentMesh = new THREE.Mesh(new THREE.PlaneGeometry(13, 11), accentMat);
    accentMesh.position.set(0, 7.5, half + 0.3);
    g.add(accentMesh);

    // Genau EIN Punktlicht je Festung (Budget!) über der Feuerschale.
    const lightBase = 2200; // physikalischer Abfall (decay 2) braucht große Werte
    const light = new THREE.PointLight(PALETTE.fireLight, lightBase, 120, 2);
    light.position.set(15, 9, 33);
    g.add(light);

    // Kleine additive Flammenzungen über der Schale
    const flames = [];
    for (let i = 0; i < 2; i++) {
      const sprite = new THREE.Sprite(flameMat);
      sprite.position.set(15 + (i - 0.5) * 1.6, 7.5 + i * 1.4, 33);
      flames.push({ sprite, phase: rng() * TAU, base: 4.5 - i });
      g.add(sprite);
    }

    // Fraktionsbanner am Mast
    const flag = makeFlag(15, 8, bannerMat[faction], rng() * TAU, 1.3, g);
    flag.position.set(0.6, 89, 0);
    g.add(flag);

    // Schildkuppel: fraktionsgetöntes Eisblau, fresnel-artig, additiv.
    const shieldMat = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0x9fd4ff).lerp(factionCol[faction], 0.35) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 14, 0, TAU, 0, Math.PI * 0.6),
      shieldMat
    );
    shield.position.y = 4;
    shield.visible = false;
    g.add(shield);

    fortressEntries.push({
      faction,
      phase: rng() * TAU,
      windowsMat,
      windowsMesh,
      accentMat,
      accentMesh,
      light,
      lightBase,
      flames,
      flag,
      shield,
      shieldMat,
      shieldLevel: 0, // weiches Ein-/Ausblenden der Kuppel
      shieldStrength: 0, // geglätteter Blockanteil aus sim.bossShield
    });
  }

  // ------------------------------------------------------------- Wachtürme
  // Je Standort ZWEI fertige Varianten (intakt/Ruine), zwischen denen update()
  // nur die Sichtbarkeit umschaltet – kein Umbau zur Laufzeit.
  function buildTower(node, faction, rank) {
    const rng = seededRand(node.x * 37 + node.y * 101);
    const g = new THREE.Group();
    g.position.set(toWorldX(node.x), heightAt(node.x, node.y) - 2, toWorldZ(node.y));
    g.rotation.y = rng() * TAU;
    group.add(g);

    // --- intakter Turm: runder Steinschaft, Holz-Wehrgang, spitzes Dach
    const intact = new THREE.Group();
    g.add(intact);
    const tp = makeParts();
    tp.add(new THREE.CylinderGeometry(11.5, 13, 6, 10), PALETTE.stoneDark, { y: 1, tex: 'stone', uvCyl: [12.25, 6] });
    tp.add(new THREE.CylinderGeometry(7.5, 9.5, 30, 10), PALETTE.stone, { y: 19, tex: 'stone', uvCyl: [8.5, 30] });
    tp.add(new THREE.CylinderGeometry(11, 11, 4, 10), PALETTE.woodDark, { y: 36, tex: 'wood', uvCyl: [11, 4] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      tp.add(new THREE.BoxGeometry(2.4, 2.6, 1.6), PALETTE.woodDark, {
        x: Math.cos(a) * 10,
        y: 39.2,
        z: Math.sin(a) * 10,
        ry: -a,
        tex: 'wood',
      });
    }
    tp.add(new THREE.ConeGeometry(11.5, 14, 10), PALETTE.roof, { y: 45 });
    tp.add(new THREE.CylinderGeometry(0.4, 0.5, 10, 5), PALETTE.woodDark, { y: 55 });
    tp.attach(intact);

    // Zwei Schießscharten mit demselben Flackern wie die Festungsfenster
    const windowsMat = new THREE.MeshBasicMaterial({ color: PALETTE.fireLight });
    const wp = makeParts(false);
    wp.add(new THREE.PlaneGeometry(1.6, 3.6), null, { y: 21, z: 8.9 });
    wp.add(new THREE.PlaneGeometry(1.6, 3.6), null, { x: 8.9, y: 26, ry: Math.PI / 2 });
    intact.add(new THREE.Mesh(wp.merge(), windowsMat));

    const flag = makeFlag(9, 5, bannerMat[faction], rng() * TAU, 0.8, intact);
    flag.position.set(0.4, 57, 0);
    intact.add(flag);

    // --- Ruine: geborstener Stumpf, verkohlte Balken, Schutt
    const ruin = new THREE.Group();
    ruin.visible = false;
    g.add(ruin);
    const rp = makeParts();
    // Sockel und Stumpf tragen dasselbe Mauerwerk wie der intakte Turm –
    // so liest sich die Ruine klar als geborstenes Bauwerk, nicht als Fels.
    rp.add(new THREE.CylinderGeometry(11.5, 13, 6, 10), PALETTE.rockDark, { y: 1, tex: 'stone', uvCyl: [12.25, 6] });
    // Stumpf mit unregelmäßiger Abbruchkante: obere Ringvertices absenken
    // (die UVs stauchen sich dort mit – an einer Bruchkante unauffällig)
    const stump = new THREE.CylinderGeometry(9, 10.5, 14, 10, 1, true);
    const sPos = stump.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      if (sPos.getY(i) > 0) sPos.setY(i, 7 - rng() * 6);
    }
    stump.computeVertexNormals();
    rp.add(stump, PALETTE.rockDark, { y: 9, tex: 'stone', uvCyl: [9.75, 14] });
    // dunkle Schuttfüllung im offenen Stumpf
    rp.add(new THREE.CircleGeometry(9, 10), 0x191b24, { y: 8.2, rx: -Math.PI / 2 });
    for (let i = 0; i < 3; i++) {
      const a = rng() * TAU;
      rp.add(new THREE.BoxGeometry(1.4, 12, 1.4), 0x201a15, {
        x: Math.cos(a) * 7,
        y: 6.5,
        z: Math.sin(a) * 7,
        rz: 0.5 + rng() * 0.5,
        ry: a,
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = rng() * TAU;
      const r = 10 + rng() * 4;
      rp.add(new THREE.DodecahedronGeometry(1.4 + rng() * 1.2), PALETTE.rockDark, {
        x: Math.cos(a) * r,
        y: 1 + rng(),
        z: Math.sin(a) * r,
        ry: rng() * TAU,
      });
    }
    rp.attach(ruin);

    // dünne, aufsteigende Rauchfahnen (je Sprite eigene Deckkraft → Klon)
    const smoke = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      const x0 = (rng() - 0.5) * 8;
      const z0 = (rng() - 0.5) * 8;
      sprite.position.set(x0, 10, z0);
      smoke.push({ sprite, mat, x0, off: rng() * 22, speed: 3 + rng() * 1.5 });
      ruin.add(sprite);
    }

    const hp = makeHpSprite();
    hp.sprite.position.set(0, 62, 0);
    g.add(hp.sprite);

    towerEntries.push({
      nodeId: node.id,
      faction,
      rank,
      groupAll: g,
      intact,
      ruin,
      windowsMat,
      phase: node.x * 0.1,
      smoke,
      hp,
    });
  }

  // ------------------------------------------------------------- Friedhöfe
  // Grabsteine liegen als EIN InstancedMesh über allen Friedhöfen; Steinkreis,
  // kahler Baum und Fahnenmast sind je Friedhof ein verschmolzenes Mesh.
  const graveyardNodes = map.nodeList.filter((n) => n.type === 'graveyard');
  const GRAVES_PER_YARD = 5;

  function buildGraveyard(node) {
    const rng = seededRand(node.x * 53 + node.y * 97);
    const g = new THREE.Group();
    g.position.set(toWorldX(node.x), heightAt(node.x, node.y) - 0.6, toWorldZ(node.y));
    g.rotation.y = rng() * TAU;
    group.add(g);

    const parts = makeParts();
    // Steinkreis
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rng() * 0.2;
      parts.add(
        new THREE.BoxGeometry(1.8, 2 + rng() * 1.6, 1.2),
        i % 2 ? PALETTE.rock : PALETTE.rockDark,
        { x: Math.cos(a) * 13.5, y: 1.2, z: Math.sin(a) * 13.5, ry: -a, rz: (rng() - 0.5) * 0.2 }
      );
    }
    // kahler Baum: schiefer Stamm, drei dürre Äste
    const tx = -8;
    const tz = -7;
    parts.add(new THREE.CylinderGeometry(0.7, 1.3, 9, 6), 0x3b2f27, { x: tx, y: 4.5, z: tz, rz: 0.12 });
    parts.add(new THREE.CylinderGeometry(0.2, 0.45, 5, 4), 0x352a23, { x: tx + 1.8, y: 9.5, z: tz, rz: -0.9 });
    parts.add(new THREE.CylinderGeometry(0.15, 0.4, 4, 4), 0x352a23, { x: tx - 1.4, y: 8.6, z: tz + 0.6, rz: 0.8, rx: 0.4 });
    parts.add(new THREE.CylinderGeometry(0.12, 0.3, 3, 4), 0x352a23, { x: tx + 0.4, y: 11, z: tz - 0.8, rx: -0.7 });
    // Fahnenmast (Friedhöfe bleiben komplett texturlos: Naturfels und dünne
    // Masten profitieren nicht vom Mauerwerk/Bohlenholz – spart Draw-Calls)
    parts.add(new THREE.CylinderGeometry(0.35, 0.5, 13, 5), PALETTE.woodDark, { x: 6, y: 6.5, z: 5 });
    parts.attach(g);

    // Fahne: Tuchfarbe folgt dem Besitzer (weicher Übergang in update())
    const flagMat = new THREE.MeshLambertMaterial({ color: NEUTRAL_FLAG, side: THREE.DoubleSide });
    const flag = makeFlag(8, 4.5, flagMat, rng() * TAU, 0.7, g);
    flag.position.set(6.35, 11, 5);
    g.add(flag);

    // Fortschrittsring der Einnahme: fester Ring + Uniform, dazu ein blasser
    // Hintergrundring (wie die 2D-Fassung). Ringe drehen die Kreiselung des
    // Friedhofs zurück, damit „oben" wieder Norden ist.
    const ringGeo = new THREE.RingGeometry(15, 17.5, 48);
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uFrac: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.set(-Math.PI / 2, 0, 0);
    ring.position.y = 1;
    ring.visible = false;
    const backMat = new THREE.MeshBasicMaterial({
      color: 0xe2eefc,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const back = new THREE.Mesh(ringGeo, backMat);
    back.rotation.set(-Math.PI / 2, 0, 0);
    back.position.y = 0.9;
    back.visible = false;
    const ringHolder = new THREE.Group();
    ringHolder.rotation.y = -g.rotation.y;
    ringHolder.add(ring, back);
    g.add(ringHolder);

    gyEntries.push({ nodeId: node.id, flagMat, ring, back, ringMat });
  }

  // Grabstein-Geometrie (Platte + Kopfstück), einmal für alle Instanzen
  function buildGraves() {
    const gp = makeParts();
    gp.add(new THREE.BoxGeometry(2.6, 3.6, 0.8), PALETTE.stoneDark, { y: 1.8 });
    gp.add(new THREE.BoxGeometry(2, 1, 0.8), PALETTE.rock, { y: 3.9 });
    const geo = gp.merge();
    const inst = new THREE.InstancedMesh(geo, solidMat, graveyardNodes.length * GRAVES_PER_YARD);
    inst.castShadow = true;
    inst.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    let idx = 0;
    for (const node of graveyardNodes) {
      const rng = seededRand(node.x * 211 + node.y * 17);
      for (let i = 0; i < GRAVES_PER_YARD; i++) {
        const a = (i / GRAVES_PER_YARD) * TAU + rng() * 0.8;
        const r = 4 + rng() * 5;
        const gx = node.x + Math.cos(a) * r;
        const gy = node.y + Math.sin(a) * r;
        // leicht eingesunken und verkippt – alte Gräber stehen nie gerade
        v.set(toWorldX(gx), heightAt(gx, gy) - 0.4, toWorldZ(gy));
        e.set((rng() - 0.5) * 0.16, rng() * TAU, (rng() - 0.5) * 0.16);
        q.setFromEuler(e);
        const sc = 0.85 + rng() * 0.4;
        s.set(sc, sc, sc);
        m.compose(v, q, s);
        inst.setMatrixAt(idx++, m);
      }
    }
    group.add(inst);
  }

  // ---------------------------------------------------------- Vorratslager
  // Zelte in Fraktions-Dunkelfarbe, Kisten/Fässer, Palisade, Bannerstange.
  // Kein eigenes Punktlicht (Budget: die Festungen haben schon je eins) –
  // das Lagerfeuer glimmt rein emissiv plus Flammen-Sprites.
  function buildSupply(node, faction) {
    const rng = seededRand(node.x * 149 + node.y * 59);
    const g = new THREE.Group();
    g.position.set(toWorldX(node.x), heightAt(node.x, node.y) - 1, toWorldZ(node.y));
    // Palisadenlücke zeigt zur Talmitte (dort kommt der Weg an)
    g.rotation.y = Math.atan2(240 - node.x, 480 - node.y);
    group.add(g);

    const parts = makeParts();
    // Palisade: Dreiviertelkreis aus zugespitzten Pfählen, Lücke bei +z
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * 0.32 + (i / 11) * Math.PI * 1.36;
      const px = Math.sin(a) * 17;
      const pz = -Math.cos(a) * 17;
      const h = 5 + rng() * 2;
      parts.add(new THREE.CylinderGeometry(0.9, 1.1, h, 5), PALETTE.woodDark, { x: px, y: h / 2, z: pz, tex: 'wood', uvCyl: [1, h] });
      parts.add(new THREE.ConeGeometry(0.9, 1.8, 5), PALETTE.woodDark, { x: px, y: h + 0.9, z: pz, tex: 'wood', uvCyl: [0.9, 1.8] });
    }
    // Zelte (vierseitige Pyramiden) in der Dunkelfarbe der Fraktion
    const tentCol = FACTION_DARK[faction];
    parts.add(new THREE.ConeGeometry(5.5, 7, 4), tentCol, { x: -7, y: 3.5, z: -6, ry: rng() });
    parts.add(new THREE.ConeGeometry(4.5, 6, 4), tentCol, { x: 7, y: 3, z: -7, ry: rng() });
    parts.add(new THREE.ConeGeometry(4, 5.5, 4), tentCol, { x: -9, y: 2.75, z: 5, ry: rng() });
    // Kisten und Fass
    parts.add(new THREE.BoxGeometry(3, 3, 3), 0x5c4a3d, { x: 9, y: 1.5, z: 3, ry: 0.4, tex: 'wood' });
    parts.add(new THREE.BoxGeometry(2.4, 2.4, 2.4), 0x6a563f, { x: 9.4, y: 4.2, z: 3.2, ry: 0.9, tex: 'wood' });
    parts.add(new THREE.BoxGeometry(2.6, 2.6, 2.6), 0x5c4a3d, { x: 12, y: 1.3, z: 0.5, ry: 1.2, tex: 'wood' });
    parts.add(new THREE.CylinderGeometry(1.7, 1.4, 3.6, 8), 0x6a543f, { x: 5.5, y: 1.8, z: 7, tex: 'wood', uvCyl: [1.55, 3.6] });
    // Feuerstelle: Steinring + zwei gekreuzte Scheite
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      parts.add(new THREE.DodecahedronGeometry(0.9), PALETTE.rockDark, {
        x: Math.cos(a) * 2.8,
        y: 0.5,
        z: 2 + Math.sin(a) * 2.8,
      });
    }
    parts.add(new THREE.BoxGeometry(0.9, 0.9, 4.4), 0x33261d, { y: 0.8, z: 2, ry: 0.5 });
    parts.add(new THREE.BoxGeometry(0.9, 0.9, 4.4), 0x33261d, { y: 0.8, z: 2, ry: -0.6 });
    // Bannerstange (zu dünn für Maserung; die Scheite bleiben verkohlt-dunkel)
    parts.add(new THREE.CylinderGeometry(0.35, 0.5, 14, 5), PALETTE.woodDark, { x: 0, y: 7, z: -12 });
    parts.attach(g);

    // Glutfläche des Lagerfeuers – Zustandsträger (warm/kalt/dunkel)
    const emberMat = new THREE.MeshBasicMaterial({ color: 0x181310 });
    const ember = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.6, 8), emberMat);
    ember.position.set(0, 0.9, 2);
    g.add(ember);

    const flames = [];
    for (let i = 0; i < 2; i++) {
      const sprite = new THREE.Sprite(flameMat);
      sprite.position.set((i - 0.5) * 1.2, 2.2 + i * 1.1, 2);
      sprite.visible = false;
      flames.push({ sprite, phase: rng() * TAU, base: 3.2 - i * 0.8 });
      g.add(sprite);
    }

    const flag = makeFlag(9, 5, bannerMat[faction], rng() * TAU, 0.8, g);
    flag.position.set(0.35, 12.5, -12);
    g.add(flag);

    supplyEntries.push({ nodeId: node.id, faction, groupAll: g, emberMat, flames, phase: rng() * TAU });
  }

  // --------------------------------------------------------------- Aufbau
  for (const node of map.nodeList) {
    if (node.type === 'boss') buildFortress(node);
  }
  for (const faction of ['blue', 'red']) {
    (map.towerSites?.[faction] ?? []).forEach((id, rank) => buildTower(map.nodes[id], faction, rank));
  }
  for (const node of graveyardNodes) buildGraveyard(node);
  buildGraves();
  for (const [nodeId, faction] of Object.entries(map.supplyCamps ?? {})) {
    buildSupply(map.nodes[nodeId], faction);
  }

  // --------------------------------------------------------------- update
  function update(view, time, dt) {
    const sim = view?.sim ?? null;
    waveFlags(time);
    // sim.bossShield ist ein Getter, der ein frisches Objekt baut – genau
    // einmal je Frame lesen.
    const shieldNow = sim ? sim.bossShield : null;

    // --- Festungen
    for (const f of fortressEntries) {
      const alive = sim ? sim.bossAlive[f.faction] : true;
      f.windowsMesh.visible = alive;
      f.accentMesh.visible = alive;
      f.flag.visible = alive;
      if (alive) {
        // Fensterflackern wie in 2D: 0.55 + 0.45·sin(t·9), Phase je Festung
        const flick = 0.55 + 0.45 * Math.sin(time * 9 + f.phase);
        f.windowsMat.color.copy(fireCol).multiplyScalar(0.35 + 0.65 * flick);
        f.accentMat.opacity = 0.55 + 0.2 * Math.sin(time * 2.2 + f.phase);
        f.light.intensity =
          f.lightBase * (0.84 + 0.11 * Math.sin(time * 11 + f.phase) + 0.05 * Math.sin(time * 23 + f.phase * 2));
      } else {
        f.light.intensity = 0;
      }
      for (const fl of f.flames) {
        fl.sprite.visible = alive;
        if (alive) {
          const s = fl.base * (0.85 + 0.15 * Math.sin(time * 13 + fl.phase));
          fl.sprite.scale.set(s, s * (1.25 + 0.2 * Math.sin(time * 9 + fl.phase)), 1);
        }
      }
      // Schildkuppel: Ziel 1 solange Schild anliegt, sonst 0; das weiche
      // Nachziehen (~0.5 s) erledigt Skalierung UND Ausblenden zugleich.
      const raw = sim && alive ? shieldNow[f.faction] : 0;
      const target = raw > 0 ? 1 : 0;
      f.shieldLevel += (target - f.shieldLevel) * Math.min(1, dt * 4);
      if (target === 0 && f.shieldLevel < 0.02) {
        f.shieldLevel = 0;
        f.shield.visible = false;
      } else {
        f.shield.visible = true;
        f.shieldStrength += (raw - f.shieldStrength) * Math.min(1, dt * 6);
        f.shield.scale.setScalar(Math.max(0.001, f.shieldLevel * (0.97 + 0.03 * Math.sin(time * 1.7 + f.phase))));
        f.shieldMat.uniforms.uTime.value = time;
        f.shieldMat.uniforms.uOpacity.value = f.shieldLevel * (0.35 + 0.65 * f.shieldStrength);
      }
    }

    // --- Wachtürme
    for (const t of towerEntries) {
      let present = true;
      let alive = true;
      let hp = 1;
      let maxHp = 1;
      if (sim) {
        const tw = sim.towers[t.nodeId];
        if (tw) {
          alive = tw.alive;
          hp = tw.hp;
          maxHp = tw.maxHp;
        } else {
          present = false; // Knoten ohne Turm-Eintrag im Sim bleibt leer
        }
      } else {
        // Ausgangszustand: intakt; falls die Konfiguration weniger Türme
        // vorsieht, zählen nur die ersten Kandidaten je Fraktion (wie 2D).
        const per = view?.config?.towersPerFaction;
        present = per == null || t.rank < per;
      }
      t.intact.visible = present && alive;
      t.ruin.visible = present && !alive;
      if (t.intact.visible) {
        const flick = 0.55 + 0.45 * Math.sin(time * 9 + t.phase);
        t.windowsMat.color.copy(fireCol).multiplyScalar(0.35 + 0.65 * flick);
        const damaged = sim && hp < maxHp - 1e-6;
        t.hp.sprite.visible = !!damaged;
        if (damaged) drawHpSprite(t.hp, maxHp > 0 ? hp / maxHp : 0);
      } else {
        t.hp.sprite.visible = false;
      }
      if (t.ruin.visible) {
        // Rauchfahnen: zyklisch aufsteigen, dabei wachsen und verblassen
        for (const s of t.smoke) {
          const cy = (time * s.speed + s.off) % 24;
          s.sprite.position.y = 10 + cy;
          s.sprite.position.x = s.x0 + Math.sin(time * 0.7 + s.off) * 1.5;
          const sc = 3 + cy * 0.28;
          s.sprite.scale.set(sc, sc, 1);
          s.mat.opacity = 0.34 * Math.min(1, cy / 3) * (1 - cy / 24);
        }
      }
    }

    // --- Friedhöfe
    for (const gy of gyEntries) {
      const owner = sim ? sim.graveyards.owner[gy.nodeId] : map.graveyards[gy.nodeId].owner;
      const target = owner ? factionCol[owner] : neutralCol;
      // exponentiell gedämpfter Farbübergang beim Besitzerwechsel
      gy.flagMat.color.lerp(target, 1 - Math.exp(-dt * 3.2));
      const cap = sim ? sim.graveyards.captures[gy.nodeId] : null;
      if (cap) {
        const dur = sim.config.graveyardCaptureTime || 1;
        gy.ringMat.uniforms.uFrac.value = Math.max(0, Math.min(1, (sim.time - cap.startedAt) / dur));
        gy.ringMat.uniforms.uColor.value.copy(factionCol[cap.faction]);
        gy.ring.visible = true;
        gy.back.visible = true;
      } else {
        gy.ring.visible = false;
        gy.back.visible = false;
      }
    }

    // --- Vorratslager
    for (const s of supplyEntries) {
      const st = sim?.supplyState ?? null;
      // Ohne Simulation zeigt die Karte das Lager im Ruhezustand; ist das
      // System abgeschaltet (nicht in st.camps bzw. per Konfiguration),
      // verschwindet das Lager ganz – wie in der 2D-Fassung.
      const enabled = st ? st.camps.includes(s.nodeId) : view?.config?.supplyEnabled !== false;
      s.groupAll.visible = enabled;
      if (!enabled) continue;
      const active = st ? !!st.active[s.nodeId] : false;
      const blocked = st ? !!st.blocked[s.nodeId] : false;
      const live = active && !blocked;
      for (const fl of s.flames) {
        fl.sprite.visible = live;
        if (live) {
          const sc = fl.base * (0.85 + 0.15 * Math.sin(time * 12 + fl.phase));
          fl.sprite.scale.set(sc, sc * (1.3 + 0.2 * Math.sin(time * 8 + fl.phase)), 1);
        }
      }
      if (live) {
        // warmes Glimmen mit leichtem Flackern
        const flick = 0.7 + 0.3 * Math.sin(time * 10 + s.phase);
        s.emberMat.color.copy(fireCol).multiplyScalar(0.4 + 0.6 * flick);
      } else if (blocked) {
        s.emberMat.color.setHex(0x27364f); // erloschen und kalt
      } else {
        s.emberMat.color.setHex(0x181310); // nie entzündet
      }
    }
  }

  // -------------------------------------------------------------- dispose
  function dispose() {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        // Geteilte Materialien mehrfach zu entsorgen ist unschädlich.
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    // Eigene Canvas-Texturen; die Bild-Texturen (Banner, Mauerwerk, Holz)
    // gehören dem Textur-Cache und bleiben unangetastet. Die Kachel-Materialien
    // selbst hängen an Meshes der Gruppe und laufen über traverse() mit.
    flameTex.dispose();
    smokeTex.dispose();
    for (const t of towerEntries) t.hp.tex.dispose();
    group.clear();
  }

  return { group, update, dispose };
}
