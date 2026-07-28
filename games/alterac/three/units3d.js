// Einheiten des 3D-Modus: Low-Poly-Soldaten beider Fraktionen.
//
// VERTRAG (renderer3d.js verlässt sich darauf):
//   createUnits3D({ map, heightAt }) → {
//     group,                  // THREE.Group mit allen Einheiten-Objekten
//     update(view, time, dt), // je Frame: Positionen/Posen aus view.sim
//     dispose(),
//   }
//
// Datenquelle ist ausschließlich view.sim (rein lesend, kann null sein).
// Gelesene Felder je Trupp (sim.js, makeGroup): id, faction, ally, ordinal,
// def (key/radius), hp, maxHp, attackInterval, state ('atNode' | 'moving' |
// 'edgeFight' | 'defending' | 'capturing' | 'dead' | 'gone'), node,
// edgeFrom/edgeTo + departT/arriveT (unterwegs), edgeFrac + edgeCombat
// (Begegnungskampf), fighting, entrenched. Dazu sim.time und sim.groups.
// Ein „alive“-Feld gibt es nicht: gefallen ist state 'dead' (kehrt mit der
// Respawn-Welle zurück) bzw. 'gone' (endgültig).
//
// Aufbau: Je (Typ, Fraktion) EINE handgebaute Template-Figur aus wenigen
// Primitiven (Vertex-Farben, flatShading, geteilte Materialien), je Trupp ein
// Group.clone(). Bewegliche Teile (torso, armL/armR, legL/legR) sind benannte
// Untergruppen mit Pivot am Gelenk – die Posen entstehen rein prozedural in
// update() (Marsch, Kampf, Stellung, Idle, Fallen, Respawn), keine Skelette.
// Die Aufstellung am Knoten/auf der Kante folgt exakt der 2D-Lesart in
// render.js (drawSim): gleiche Fächerwinkel, Fahrspuren und Sortierung, damit
// 2D- und 3D-Bild dieselbe Schlacht erzählen.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toWorldX, toWorldZ, FACTION_COLOR, FACTION_DARK, PALETTE, seededRand } from './world.js';
import { edgePoint } from '../map.js';
import { toRoman } from '../config.js';

// Gemeinsame Materialfarben der Figuren (neutral – die Fraktion kommt wie bei
// den 2D-Porträts nur über Stoff-/Akzentflächen in FACTION_COLOR/FACTION_DARK).
const C = {
  mail: 0x8b93a6,
  steel: 0x9aa2b5,
  steelDark: 0x666e84,
  blade: 0xdde4f0,
  // Die Brauntöne liegen bewusst heller als „natürlich": Unter dem rein kalten
  // Licht der Szene (Mond + blaugraue Hemisphäre) reflektiert Braun kaum etwas
  // und säuft mit dem ACES-Tone-Mapping zu Schwarz ab – schneegepudertes,
  // ausgeblichenes Leder und Fell bleiben dagegen lesbar.
  leather: 0x8f6f52,
  leatherDark: 0x6a5340,
  hood: 0x66503c,
  skin: 0xd9b08c,
  fur: 0xa89684,
  wood: 0x4d3d33,
  bark: 0x4a3a30,
  barkDark: 0x352822,
  pine: 0x2c4a3f,
  pineBright: 0x3f6b4a,
  ice: 0xa9cbe8,
  iceBright: 0xd6ecfa,
};

// Posen-Parameter je Figurentyp: Maße, Schrittlänge (Weltstrecke je
// Gangzyklus), Pendel-Amplituden, Ruhehaltung und Angriffsstil.
const RIGS = {
  light: {
    ui: 15, stepLen: 14, legAmp: 0.85, armAmp: 0.6, bob: 0.35,
    torsoRest: 0.2, armRest: 0.3, speedRef: 26, attack: 'stab', shield: false,
  },
  medium: {
    ui: 17, stepLen: 17, legAmp: 0.7, armAmp: 0.5, bob: 0.4,
    torsoRest: 0.05, armRest: 0.15, speedRef: 20, attack: 'slash', shield: true,
  },
  heavy: {
    ui: 20, stepLen: 20, legAmp: 0.55, armAmp: 0.35, bob: 0.5,
    torsoRest: 0.08, armRest: 0.2, speedRef: 15, attack: 'smash', shield: false,
  },
  ally: {
    ui: 28, stepLen: 30, legAmp: 0.4, armAmp: 0.3, bob: 0.8,
    torsoRest: 0.02, armRest: 0.15, speedRef: 15, attack: 'smash', shield: false,
  },
};

// Auffächerung wie in render.js: Radius/Spurabstand wachsen mit dem größten
// Token einer Gruppe, damit sich Trupps am selben Ort nicht überlappen.
const tokenRadius = (g) => g.def?.radius ?? 16;
const maxTokenRadius = (list) => list.reduce((m, g) => Math.max(m, tokenRadius(g)), 16);
const spreadRadius = (list, base) => base + (maxTokenRadius(list) - 16) * 2.2;
const laneGap = (list) => Math.max(18, maxTokenRadius(list) + 2);
const byId = (a, b) => (a.id < b.id ? -1 : 1);

function css(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

// Glatte Überblendung 0→1 für Posenübergänge.
function smooth(k) {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

// Ein Waffenschlag über den Zyklus u∈[0,1): langsames Ausholen (bis 0.7),
// schneller Hieb (bis 0.82), Zurückführen in die Ruhelage.
function swing(u, windup, strike, rest) {
  if (u < 0.7) return rest + (windup - rest) * smooth(u / 0.7);
  if (u < 0.82) {
    const k = (u - 0.7) / 0.12;
    return windup + (strike - windup) * k * k;
  }
  return strike + (rest - strike) * smooth((u - 0.82) / 0.18);
}

export function createUnits3D({ map, heightAt }) {
  const group = new THREE.Group();
  group.name = 'units3d';

  // ------------------------------------------------------------ Materialien
  // Geteilt über alle Figuren – Klone teilen Geometrie UND Material, dadurch
  // bleibt der Speicher konstant, egal wie viele Trupps auflaufen.
  const matBody = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const matIce = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 0.72,
  });
  const matGlowGreen = new THREE.MeshBasicMaterial({ color: 0xaef0b4 });
  const matGlowIce = new THREE.MeshBasicMaterial({ color: 0xcfe9ff });
  const geoms = []; // alle gebauten Geometrien, für dispose()

  // -------------------------------------------------------- Geometrie-Bau
  // Primitive in Figurenkoordinaten (Füße auf y=0, Blick nach +z) erzeugen,
  // einfärben (leichtes deterministisches Flächen-Zittern für den handgemachten
  // Low-Poly-Look) und transformieren. Erst beim Zusammenfügen je Körperteil
  // entsteht EINE Geometrie – so bleibt es bei ~5 Draw-Calls je Figur.
  function prim(rand, kind, args, hex, opts = {}) {
    let geo;
    if (kind === 'box') geo = new THREE.BoxGeometry(...args);
    else if (kind === 'cyl') geo = new THREE.CylinderGeometry(...args);
    else if (kind === 'cone') geo = new THREE.ConeGeometry(...args);
    else if (kind === 'oct') geo = new THREE.OctahedronGeometry(...args);
    else geo = new THREE.IcosahedronGeometry(...args);
    if (geo.index) {
      const ni = geo.toNonIndexed();
      geo.dispose();
      geo = ni;
    }
    const base = new THREE.Color(hex);
    const jitter = opts.jitter ?? 0.08;
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const face = new THREE.Color();
    for (let i = 0; i < count; i += 3) {
      const f = 1 + (rand() - 0.5) * jitter * 2;
      face.copy(base).multiplyScalar(f);
      for (let v = 0; v < 3; v++) {
        colors[(i + v) * 3] = face.r;
        colors[(i + v) * 3 + 1] = face.g;
        colors[(i + v) * 3 + 2] = face.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(opts.p ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opts.r ?? [0, 0, 0]))),
      new THREE.Vector3(...(opts.s ?? [1, 1, 1]))
    );
    geo.applyMatrix4(m);
    return geo;
  }

  // Körperteil: Teilgeometrien (Figurenraum) verschmelzen, auf den Gelenk-Pivot
  // beziehen und als benannte Gruppe zurückgeben – update() schwenkt die Gruppe.
  function part(name, pivot, pieces, material = matBody) {
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    merged.translate(-pivot[0], -pivot[1], -pivot[2]);
    geoms.push(merged);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.set(pivot[0], pivot[1], pivot[2]);
    grp.add(mesh);
    return grp;
  }

  // Leuchtende Zusatzflächen (Augen, Eiskern) – eigenes Material, kein Schatten.
  function glowPart(target, pivot, pieces, material) {
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    merged.translate(-pivot[0], -pivot[1], -pivot[2]);
    geoms.push(merged);
    const mesh = new THREE.Mesh(merged, material);
    target.add(mesh);
  }

  // Arme hängen am Torso (schwenken beim Rumpfbeugen mit): Position von
  // Figurenraum auf Torso-Pivot umrechnen.
  function attachToTorso(torso, torsoPivot, arm) {
    arm.position.y -= torsoPivot[1];
    torso.add(arm);
  }

  // ------------------------------------------------------------ Figurentypen
  // Alle Baupläne liefern dieselben Teilnamen (torso, armL/armR, legL/legR),
  // damit der Posen-Code generisch bleiben kann.

  // Mittlerer Soldat (~13 hoch, ~420 Dreiecke): Helm, Kettenhemd, Schwert und
  // Rundschild; Wappenrock und Schildfläche tragen die Fraktionsfarbe.
  function buildMedium(faction) {
    const rand = seededRand(faction === 'blue' ? 210 : 211);
    const F = FACTION_COLOR[faction];
    const FD = FACTION_DARK[faction];
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    fig.add(
      part('legL', [-1.25, 5.0, 0], [
        p('box', [1.5, 4.4, 1.6], C.mail, { p: [-1.25, 2.9, 0] }),
        p('box', [1.8, 1.2, 2.3], C.leatherDark, { p: [-1.25, 0.6, 0.25] }),
      ]),
      part('legR', [1.25, 5.0, 0], [
        p('box', [1.5, 4.4, 1.6], C.mail, { p: [1.25, 2.9, 0] }),
        p('box', [1.8, 1.2, 2.3], C.leatherDark, { p: [1.25, 0.6, 0.25] }),
      ])
    );

    const torsoPivot = [0, 5.2, 0];
    const torso = part('torso', torsoPivot, [
      p('box', [4.6, 4.6, 2.8], C.mail, { p: [0, 7.5, 0] }),
      p('box', [4.8, 0.9, 3.0], C.leatherDark, { p: [0, 5.45, 0] }),
      p('box', [4.2, 2.2, 2.6], FD, { p: [0, 4.2, 0] }), // Waffenrock
      p('box', [2.6, 4.2, 0.4], F, { p: [0, 7.4, 1.5] }), // Wappenrock vorn
      p('box', [2.6, 4.2, 0.4], FD, { p: [0, 7.4, -1.5] }),
      p('box', [2.6, 1.8, 2.7], C.steel, { p: [-3.0, 9.7, 0], r: [0, 0, 0.15] }), // Schultern
      p('box', [2.6, 1.8, 2.7], C.steel, { p: [3.0, 9.7, 0], r: [0, 0, -0.15] }),
      p('box', [1.8, 1.7, 1.7], C.skin, { p: [0, 10.55, 0.25] }),
      p('cyl', [1.35, 1.5, 1.6, 7], C.steel, { p: [0, 11.5, 0] }), // Helm
      p('cone', [0.5, 1.0, 6], C.steel, { p: [0, 12.7, 0] }),
      p('box', [0.5, 1.2, 0.5], C.steel, { p: [0, 10.6, 1.05] }), // Nasal
    ]);
    fig.add(torso);

    const armR = part('armR', [3.0, 9.15, 0], [
      p('box', [1.25, 3.4, 1.35], C.mail, { p: [3.0, 7.5, 0] }),
      p('box', [1.3, 1.1, 1.3], C.leather, { p: [3.0, 5.6, 0] }),
      p('cyl', [0.26, 0.26, 1.4, 6], C.leatherDark, { p: [3.0, 5.6, 0.5] }),
      p('box', [1.5, 0.28, 0.5], C.steel, { p: [3.0, 6.35, 0.5] }),
      p('box', [0.85, 4.6, 0.2], C.blade, { p: [3.0, 8.7, 0.5] }),
      p('cone', [0.44, 0.9, 4], C.blade, { p: [3.0, 11.4, 0.5] }),
    ]);
    const armL = part('armL', [-3.0, 9.15, 0], [
      p('box', [1.25, 3.4, 1.35], C.mail, { p: [-3.0, 7.5, 0] }),
      p('cyl', [2.6, 2.6, 0.35, 8], FD, { p: [-3.4, 6.7, 0.85], r: [Math.PI / 2, 0, 0] }),
      p('cyl', [2.1, 2.1, 0.4, 8], F, { p: [-3.4, 6.7, 0.9], r: [Math.PI / 2, 0, 0] }),
      p('cyl', [0.6, 0.6, 0.5, 6], C.steel, { p: [-3.4, 6.7, 1.05], r: [Math.PI / 2, 0, 0] }),
    ]);
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Leichter Späher (~11 hoch, ~330 Dreiecke): Kapuze mit Fellkragen, Leder,
  // zwei Dolche, von Natur aus geduckt (torsoRest); Schärpe in Fraktionsfarbe.
  function buildLight(faction) {
    const rand = seededRand(faction === 'blue' ? 220 : 221);
    const F = FACTION_COLOR[faction];
    const FD = FACTION_DARK[faction];
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    fig.add(
      part('legL', [-1.0, 4.6, 0], [
        p('box', [1.2, 4.2, 1.3], C.leather, { p: [-1.0, 2.7, 0] }),
        p('box', [1.4, 1.0, 1.9], C.leatherDark, { p: [-1.0, 0.5, 0.2] }),
      ]),
      part('legR', [1.0, 4.6, 0], [
        p('box', [1.2, 4.2, 1.3], C.leather, { p: [1.0, 2.7, 0] }),
        p('box', [1.4, 1.0, 1.9], C.leatherDark, { p: [1.0, 0.5, 0.2] }),
      ])
    );

    const torsoPivot = [0, 4.6, 0];
    const torso = part('torso', torsoPivot, [
      p('box', [3.6, 4.0, 2.2], C.leather, { p: [0, 6.6, 0] }),
      p('box', [3.8, 0.8, 2.4], C.leatherDark, { p: [0, 4.9, 0] }),
      p('box', [1.1, 4.4, 0.35], F, { p: [0, 6.7, 1.15], r: [0, 0, 0.6] }), // Schärpe
      p('box', [2.2, 1.8, 0.3], FD, { p: [0, 3.9, 1.0] }), // Lendenschurz
      p('cyl', [1.9, 2.2, 1.1, 7], C.fur, { p: [0, 8.75, 0], jitter: 0.16 }), // Fellkragen
      p('box', [1.7, 1.7, 1.7], C.skin, { p: [0, 9.55, 0.3] }),
      p('cone', [1.9, 2.6, 6], C.hood, { p: [0, 10.9, -0.1] }), // Kapuze
      p('box', [2.1, 1.4, 1.9], C.hood, { p: [0, 9.9, -0.35] }),
    ]);
    fig.add(torso);

    const dagger = (x) => [
      p('box', [1.0, 2.8, 1.1], C.leather, { p: [x, 6.7, 0] }),
      p('box', [1.05, 0.9, 1.05], C.skin, { p: [x, 5.15, 0] }),
      p('cyl', [0.2, 0.2, 0.9, 6], C.leatherDark, { p: [x, 5.15, 0.4] }),
      p('box', [0.95, 0.22, 0.4], C.steelDark, { p: [x, 5.65, 0.4] }),
      p('box', [0.55, 2.1, 0.14], C.blade, { p: [x, 6.8, 0.4] }),
      p('cone', [0.28, 0.6, 4], C.blade, { p: [x, 8.15, 0.4] }),
    ];
    const armR = part('armR', [2.25, 8.15, 0], dagger(2.25));
    const armL = part('armL', [-2.25, 8.15, 0], dagger(-2.25));
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Schwerer Koloss (~15 hoch, ~500 Dreiecke): massige Platte, Stachelschultern,
  // Fellumhang-Andeutung, Zweihandhammer; Waffenrock/Tabard in Fraktionsfarbe.
  function buildHeavy(faction) {
    const rand = seededRand(faction === 'blue' ? 230 : 231);
    const F = FACTION_COLOR[faction];
    const FD = FACTION_DARK[faction];
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    fig.add(
      part('legL', [-1.8, 5.6, 0], [
        p('box', [2.2, 5.0, 2.3], C.steelDark, { p: [-1.8, 3.2, 0] }),
        p('box', [2.5, 1.4, 2.9], C.leatherDark, { p: [-1.8, 0.7, 0.25] }),
      ]),
      part('legR', [1.8, 5.6, 0], [
        p('box', [2.2, 5.0, 2.3], C.steelDark, { p: [1.8, 3.2, 0] }),
        p('box', [2.5, 1.4, 2.9], C.leatherDark, { p: [1.8, 0.7, 0.25] }),
      ])
    );

    const torsoPivot = [0, 5.8, 0];
    const torso = part('torso', torsoPivot, [
      p('box', [6.6, 5.2, 3.8], C.steel, { p: [0, 8.6, 0] }),
      p('box', [6.8, 1.1, 4.0], C.leatherDark, { p: [0, 6.1, 0] }),
      p('box', [5.6, 2.6, 3.4], FD, { p: [0, 4.9, 0] }), // Waffenrock
      p('box', [3.4, 4.8, 0.45], F, { p: [0, 8.4, 2.0] }), // Tabard
      p('box', [7.0, 6.2, 0.9], C.fur, { p: [0, 8.8, -2.25], jitter: 0.16 }), // Fellumhang
      p('box', [3.4, 2.4, 3.6], C.steel, { p: [-4.2, 11.4, 0], r: [0, 0, 0.2] }), // Schultern
      p('box', [3.4, 2.4, 3.6], C.steel, { p: [4.2, 11.4, 0], r: [0, 0, -0.2] }),
      p('cone', [0.7, 1.9, 5], C.steelDark, { p: [-4.5, 13.3, 0] }), // Stacheln
      p('cone', [0.7, 1.9, 5], C.steelDark, { p: [4.5, 13.3, 0] }),
      p('box', [1.9, 1.6, 1.8], C.skin, { p: [0, 11.85, 0.55] }),
      p('cyl', [1.55, 1.7, 1.9, 7], C.steelDark, { p: [0, 12.9, 0.2] }), // Helm
      p('cone', [0.5, 1.4, 5], C.steelDark, { p: [-1.5, 13.6, 0.2], r: [0, 0, 0.9] }), // Hörner
      p('cone', [0.5, 1.4, 5], C.steelDark, { p: [1.5, 13.6, 0.2], r: [0, 0, -0.9] }),
    ]);
    fig.add(torso);

    const armR = part('armR', [4.3, 11.0, 0], [
      p('box', [1.8, 4.4, 1.9], C.steel, { p: [4.3, 8.8, 0] }),
      p('box', [2.0, 1.5, 2.0], C.steelDark, { p: [4.3, 6.3, 0.2] }),
      p('cyl', [0.35, 0.35, 7.6, 6], C.wood, { p: [4.3, 8.0, 0.75] }), // Hammerstiel
      p('box', [3.3, 2.2, 2.3], C.steelDark, { p: [4.3, 11.6, 0.75] }), // Hammerkopf
      p('box', [3.5, 0.6, 2.5], C.steel, { p: [4.3, 11.6, 0.75] }),
    ]);
    const armL = part('armL', [-4.3, 11.0, 0], [
      p('box', [1.8, 4.4, 1.9], C.steel, { p: [-4.3, 8.8, 0] }),
      p('box', [2.2, 1.7, 2.2], C.steelDark, { p: [-4.3, 6.2, 0.2] }),
    ]);
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Ivus der Waldlord (~23 hoch, ~560 Dreiecke): borkiger Rumpf, Nadelkrone,
  // Ast-Arme, glimmende Augen; blaues Banntuch als Fraktionsakzent.
  function buildIvus() {
    const rand = seededRand(240);
    const F = FACTION_COLOR.blue;
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    fig.add(
      part('legL', [-1.9, 6.0, 0], [
        p('cyl', [1.1, 1.8, 6.2, 6], C.bark, { p: [-1.9, 3.0, 0], jitter: 0.2 }),
        p('cone', [0.7, 1.6, 5], C.barkDark, { p: [-2.6, 0.6, 1.1], r: [1.2, 0, 0] }),
        p('cone', [0.7, 1.6, 5], C.barkDark, { p: [-1.2, 0.6, 1.1], r: [1.2, 0, 0] }),
      ]),
      part('legR', [1.9, 6.0, 0], [
        p('cyl', [1.1, 1.8, 6.2, 6], C.bark, { p: [1.9, 3.0, 0], jitter: 0.2 }),
        p('cone', [0.7, 1.6, 5], C.barkDark, { p: [2.6, 0.6, 1.1], r: [1.2, 0, 0] }),
        p('cone', [0.7, 1.6, 5], C.barkDark, { p: [1.2, 0.6, 1.1], r: [1.2, 0, 0] }),
      ])
    );

    const torsoPivot = [0, 6.0, 0];
    const torso = part('torso', torsoPivot, [
      p('cyl', [2.7, 3.7, 9.2, 7], C.bark, { p: [0, 10.4, 0], jitter: 0.22 }),
      p('box', [2.2, 2.6, 0.9], C.pineBright, { p: [-1.6, 9.0, 2.6], r: [0.2, 0.4, 0] }), // Moos
      p('box', [1.8, 2.0, 0.8], C.pineBright, { p: [1.8, 11.6, -2.3], r: [0, -0.5, 0.2] }),
      p('box', [2.4, 2.6, 1.4], C.barkDark, { p: [0, 14.6, 2.4] }), // Gesichtsknorren
      p('cone', [3.5, 4.6, 7], C.pine, { p: [0, 17.8, 0], jitter: 0.14 }), // Nadelkrone
      p('cone', [2.6, 3.8, 7], C.pine, { p: [0, 19.9, 0], jitter: 0.14 }),
      p('cone', [1.5, 3.0, 6], C.pineBright, { p: [0, 21.9, 0], jitter: 0.14 }),
      p('box', [1.8, 4.2, 0.35], F, { p: [0, 10.6, 3.15] }), // Banntuch der Allianz
    ]);
    glowPart(torso, torsoPivot, [
      p('box', [0.55, 0.55, 0.35], 0xaef0b4, { p: [-0.65, 15.0, 3.15] }),
      p('box', [0.55, 0.55, 0.35], 0xaef0b4, { p: [0.65, 15.0, 3.15] }),
    ], matGlowGreen);
    fig.add(torso);

    const branchArm = (side) => [
      p('box', [1.5, 6.6, 1.5], C.bark, { p: [side * 4.4, 10.6, 0], r: [0, 0, -side * 0.22], jitter: 0.2 }),
      p('box', [1.2, 4.6, 1.2], C.bark, { p: [side * 5.3, 6.0, 0.4], r: [0.15, 0, -side * 0.1], jitter: 0.2 }),
      p('cone', [0.5, 1.8, 5], C.pine, { p: [side * 5.6, 3.4, 0.7], r: [Math.PI, 0, 0] }),
      p('cone', [0.4, 1.4, 5], C.pine, { p: [side * 4.7, 3.9, 0.2], r: [Math.PI, 0, 0.4] }),
    ];
    const armR = part('armR', [3.9, 13.6, 0], branchArm(1));
    const armL = part('armL', [-3.9, 13.6, 0], branchArm(-1));
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Lokholar der Eislord (~22 hoch, ~380 Dreiecke): kantige Eisbrocken in
  // halbtransparentem Material, kalt glimmender Kern; rotes Banner als Akzent.
  function buildLokholar() {
    const rand = seededRand(241);
    const F = FACTION_COLOR.red;
    const FD = FACTION_DARK.red;
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    fig.add(
      part('legL', [-2.0, 6.5, 0], [
        p('oct', [1.9, 0], C.ice, { p: [-2.0, 3.6, 0], s: [1, 1.8, 1], jitter: 0.16 }),
        p('oct', [1.4, 0], C.iceBright, { p: [-2.0, 0.9, 0.3], jitter: 0.16 }),
      ], matIce),
      part('legR', [2.0, 6.5, 0], [
        p('oct', [1.9, 0], C.ice, { p: [2.0, 3.6, 0], s: [1, 1.8, 1], jitter: 0.16 }),
        p('oct', [1.4, 0], C.iceBright, { p: [2.0, 0.9, 0.3], jitter: 0.16 }),
      ], matIce)
    );

    const torsoPivot = [0, 6.5, 0];
    const torso = part('torso', torsoPivot, [
      p('ico', [4.4, 0], C.ice, { p: [0, 11.6, 0], s: [1, 1.5, 0.9], jitter: 0.18 }),
      p('oct', [3.0, 0], C.iceBright, { p: [0, 14.9, 1.0], jitter: 0.18 }),
      p('oct', [2.6, 0], C.ice, { p: [-1.4, 13.6, -1.8], jitter: 0.18 }),
      p('oct', [2.4, 0], C.iceBright, { p: [-4.9, 16.3, 0], jitter: 0.18 }), // Schulterbrocken
      p('oct', [2.4, 0], C.iceBright, { p: [4.9, 16.3, 0], jitter: 0.18 }),
      p('oct', [1.9, 0], C.iceBright, { p: [0, 18.9, 0], s: [1, 1.5, 1], jitter: 0.18 }), // Haupt
      p('cone', [0.55, 2.2, 4], C.iceBright, { p: [-1.1, 20.6, -0.3], r: [0, 0, 0.5] }),
      p('cone', [0.55, 2.2, 4], C.iceBright, { p: [1.1, 20.6, -0.3], r: [0, 0, -0.5] }),
    ], matIce);
    glowPart(torso, torsoPivot, [
      p('ico', [1.7, 0], 0xcfe9ff, { p: [0, 12.2, 0] }), // Kern, schimmert durchs Eis
      p('box', [0.5, 0.5, 0.4], 0xcfe9ff, { p: [-0.65, 19.2, 1.35] }),
      p('box', [0.5, 0.5, 0.4], 0xcfe9ff, { p: [0.65, 19.2, 1.35] }),
    ], matGlowIce);
    // Undurchsichtiges Horden-Banner, damit der blaugraue Eisleib nicht mit der
    // Allianzfarbe verwechselt wird.
    glowPart(torso, torsoPivot, [
      p('box', [1.9, 4.8, 0.35], F, { p: [0, 12.0, 3.4] }),
      p('box', [2.1, 0.7, 0.45], FD, { p: [0, 14.3, 3.4] }),
    ], matBody);
    fig.add(torso);

    const iceArm = (side) => [
      p('oct', [2.0, 0], C.ice, { p: [side * 5.0, 13.6, 0], s: [1, 1.7, 1], jitter: 0.18 }),
      p('oct', [2.4, 0], C.iceBright, { p: [side * 5.1, 10.6, 0.5], jitter: 0.18 }),
    ];
    const armR = part('armR', [4.9, 15.8, 0], iceArm(1), matIce);
    const armL = part('armL', [-4.9, 15.8, 0], iceArm(-1), matIce);
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // ------------------------------------------------------------- Templates
  const templates = new Map(); // 'typ:fraktion' → Template-Gruppe
  function templateFor(key, faction) {
    const id = key + ':' + faction;
    let tpl = templates.get(id);
    if (!tpl) {
      if (key === 'ally') tpl = faction === 'blue' ? buildIvus() : buildLokholar();
      else if (key === 'light') tpl = buildLight(faction);
      else if (key === 'heavy') tpl = buildHeavy(faction);
      else tpl = buildMedium(faction);
      templates.set(id, tpl);
    }
    return tpl;
  }

  // ------------------------------------------------------- Overhead-Sprites
  // Ein Canvas-Sprite je Figur: Ziffernband in Fraktionsfarbe, darunter der
  // HP-Balken (nur bei Schaden). Texturen/Materialien werden nach Schlüssel
  // (Fraktion, Beschriftung, quantisierte HP-Stufe) gecacht und geteilt –
  // gezeichnet wird nur, wenn eine Stufe zum ersten Mal gebraucht wird.
  const uiCache = new Map();
  const HP_STEPS = 24;

  function uiMaterial(faction, label, step) {
    const key = faction + '|' + label + '|' + step;
    let entry = uiCache.get(key);
    if (entry) return entry.material;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const ally = label === '✦';
    const band = ally ? css(FACTION_DARK[faction]) : css(FACTION_COLOR[faction]);
    ctx.font = `700 ${label.length > 3 ? 17 : 21}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bw = Math.min(120, ctx.measureText(label).width + 18);
    ctx.fillStyle = band;
    ctx.strokeStyle = 'rgba(8,10,18,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(64 - bw / 2, 3, bw, 27, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ally ? css(PALETTE.gold) : '#f4f7ff';
    ctx.fillText(label, 64, 17.5);
    if (step < HP_STEPS) {
      // HP-Balken mit den 2D-Farbstufen (>0.5 grün, >0.25 gelb, sonst rot).
      const ratio = step / HP_STEPS;
      ctx.fillStyle = 'rgba(10,13,22,0.88)';
      ctx.strokeStyle = 'rgba(8,10,18,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(16, 38, 96, 11, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ratio > 0.5 ? '#57c766' : ratio > 0.25 ? '#e0bd4a' : '#de5145';
      ctx.fillRect(18, 40, Math.max(3, 92 * ratio), 7);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    entry = { texture, material };
    uiCache.set(key, entry);
    return material;
  }

  // Respawn-Blitz: ein additiver Glimmer-Sprite je Figur, geteiltes Material;
  // die Textur ist ein simpler radialer Verlauf.
  const pulseCanvas = document.createElement('canvas');
  pulseCanvas.width = 64;
  pulseCanvas.height = 64;
  {
    const ctx = pulseCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,236,190,0.95)');
    grad.addColorStop(0.5, 'rgba(255,215,106,0.4)');
    grad.addColorStop(1, 'rgba(255,215,106,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const pulseTexture = new THREE.CanvasTexture(pulseCanvas);
  const pulseMaterial = new THREE.SpriteMaterial({
    map: pulseTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // ------------------------------------------------------------ Truppbestand
  // Sim-Gruppe (Objekt-Identität) → Figuren-Datensatz. Trupps kommen (Ally)
  // und gehen ('gone'); bei einem neuen sim-Objekt wird alles zurückgesetzt.
  const records = new Map();
  let lastSim = null;
  let frameId = 0;

  function phaseOf(id) {
    const s = String(id);
    return ((s.charCodeAt(0) || 0) * 7 + (s.charCodeAt(s.length - 1) || 0) * 13) % 7;
  }

  function recordFor(g) {
    let rec = records.get(g);
    if (rec) return rec;
    const key = g.def?.key ?? (g.ally ? 'ally' : 'medium');
    const rig = RIGS[key] ?? RIGS.medium;
    const fig = templateFor(key, g.faction).clone();
    const parts = {
      torso: fig.getObjectByName('torso'),
      armL: fig.getObjectByName('armL'),
      armR: fig.getObjectByName('armR'),
      legL: fig.getObjectByName('legL'),
      legR: fig.getObjectByName('legR'),
    };
    const label = g.ally ? '✦' : toRoman(g.ordinal ?? 1);
    const ui = new THREE.Sprite(uiMaterial(g.faction, label, HP_STEPS));
    ui.scale.set(7, 3.5, 1);
    ui.position.y = rig.ui;
    fig.add(ui);
    const pulse = new THREE.Sprite(pulseMaterial);
    pulse.visible = false;
    pulse.position.y = rig.ui * 0.45;
    fig.add(pulse);
    const phase = phaseOf(g.id);
    rec = {
      fig, parts, rig, ui, pulse, label,
      uiStep: HP_STEPS,
      phase,
      fallSide: phase % 2 ? 1 : -1,
      mode: 'live', // 'live' | 'dying' | 'hidden'
      dieAt: 0,
      spawnAt: -Infinity,
      yaw: g.faction === 'blue' ? Math.PI : 0,
      targetYaw: g.faction === 'blue' ? Math.PI : 0,
      px: 0, py: 0, hasPrev: false,
      speed: 0, travel: 0,
      groundY: 0, lastBob: 0,
      seen: 0,
    };
    records.set(g, rec);
    group.add(fig);
    return rec;
  }

  function resetAll() {
    for (const rec of records.values()) group.remove(rec.fig);
    records.clear();
  }

  // --------------------------------------------------------------- Posen
  // Liefert den vertikalen Wipp-Anteil; alle Teilrotationen werden komplett
  // neu gesetzt (kein Aufaddieren, damit nichts wegdriftet).
  function applyPose(rec, g, time, simT) {
    const R = rec.rig;
    const P = rec.parts;
    const ph = rec.phase;
    let legSwing = 0;
    let splay = 0.05;
    let armLx = R.armRest;
    let armRx = R.armRest;
    let armLz = 0.1;
    let armRz = -0.1;
    let torsoX = R.torsoRest;
    let bob = 0;
    const mv = Math.min(1, rec.speed / R.speedRef);

    if (g.fighting) {
      // Waffen-Hiebe im Rhythmus des Angriffsintervalls (Sim-Zeit, damit die
      // Schläge bei Pause einfrieren); Phase je Trupp versetzt.
      const iv = Math.max(0.25, g.attackInterval || 1);
      const u = ((simT + ph) % iv) / iv;
      if (R.attack === 'stab') {
        armRx = swing(u, -0.55, 1.35, 0.25);
        armLx = swing((u + 0.5) % 1, -0.55, 1.35, 0.25);
        torsoX = R.torsoRest + 0.12;
      } else if (R.attack === 'slash') {
        armRx = swing(u, -1.7, 0.95, 0.2);
        armLx = 0.75; // Schild halb vor
      } else {
        // Beidhändiger Überkopfschlag (schwer und Verbündete).
        armRx = swing(u, -2.3, 1.15, 0.15);
        armLx = swing(u, -2.05, 1.0, 0.15);
        armLz = 0.25;
        armRz = -0.25;
        torsoX = R.torsoRest + swing(u, -0.16, 0.38, 0.05);
      }
      bob = Math.sin(time * 5 + ph) * 0.08;
      splay = 0.1;
    } else if (mv > 0.04) {
      // Marsch: Pendel aus der tatsächlich zurückgelegten Strecke, dadurch
      // passt die Schrittfrequenz automatisch zur Geschwindigkeit.
      const c = (rec.travel / R.stepLen) * Math.PI * 2 + ph;
      const s = Math.sin(c);
      legSwing = s * R.legAmp * mv;
      armLx = R.armRest + s * R.armAmp * mv;
      armRx = R.armRest - s * R.armAmp * mv;
      bob = Math.abs(Math.cos(c)) * R.bob * mv;
      torsoX = R.torsoRest + 0.07 * mv;
    } else if (g.state === 'defending') {
      // Stellung halten: breiter Stand, Schild vor, ruhiges Atmen; eingegraben
      // noch etwas geduckter.
      splay = 0.16;
      armLx = R.shield ? 1.05 : 0.5;
      torsoX = R.torsoRest + (g.entrenched ? 0.12 : 0.04);
      bob = Math.sin(time * 1.5 + ph) * 0.1;
    } else {
      // Warten am Knoten: leichtes Wippen und Armpendeln.
      const s = Math.sin(time * 1.9 + ph);
      bob = s * 0.12;
      armLx = R.armRest + s * 0.05;
      armRx = R.armRest - s * 0.05;
    }

    P.legL.rotation.set(legSwing, 0, -splay);
    P.legR.rotation.set(-legSwing, 0, splay);
    P.torso.rotation.x = torsoX;
    P.armL.rotation.set(armLx, 0, armLz);
    P.armR.rotation.set(armRx, 0, armRz);
    return bob;
  }

  // ------------------------------------------------------- Figur platzieren
  // (x, y) in Kartenkoordinaten; (lx, ly) ist der Blickpunkt (Kampfort bzw.
  // ein Punkt in Bewegungs-/Grundrichtung).
  function placeFigure(g, x, y, lx, ly, time, simT, dt) {
    const rec = recordFor(g);
    rec.seen = frameId;

    if (rec.mode !== 'live') {
      // Wiederkehr vom Friedhof: Figur aufrichten, kurz aufleuchten lassen und
      // aus dem Boden hochkommen.
      rec.mode = 'live';
      rec.spawnAt = time;
      rec.fig.visible = true;
      rec.fig.rotation.z = 0;
      rec.ui.visible = true;
      rec.hasPrev = false;
      rec.speed = 0;
    }

    // Geschwindigkeit aus der Kartenbewegung messen (geglättet); große Sprünge
    // sind Teleports (Respawn/Reset) und zählen nicht als Marsch.
    if (rec.hasPrev) {
      const dist = Math.hypot(x - rec.px, y - rec.py);
      if (dist > 60) {
        rec.speed = 0;
      } else {
        rec.speed += (dist / dt - rec.speed) * Math.min(1, dt * 8);
        rec.travel += dist;
      }
    }
    rec.px = x;
    rec.py = y;
    rec.hasPrev = true;

    // Sanft in Blickrichtung drehen (kürzester Winkelweg), nie schnappen.
    const dx = lx - x;
    const dz = ly - y;
    if (dx * dx + dz * dz > 1e-4) rec.targetYaw = Math.atan2(dx, dz);
    let d = rec.targetYaw - rec.yaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    rec.yaw += d * (1 - Math.exp(-8 * dt));
    rec.fig.rotation.y = rec.yaw;

    const bob = applyPose(rec, g, time, simT);

    // Respawn-Einblendung: von leicht versenkt hochkommen + Glimmer-Implosion.
    let yOff = 0;
    const spawnK = (time - rec.spawnAt) / 0.6;
    if (spawnK < 1) {
      yOff = -2.2 * (1 - smooth(spawnK));
      const s = 3 + 15 * (1 - spawnK);
      rec.pulse.visible = true;
      rec.pulse.scale.set(s, s, 1);
    } else if (rec.pulse.visible) {
      rec.pulse.visible = false;
    }

    const gy = heightAt(x, y);
    rec.groundY = gy;
    rec.lastBob = bob;
    rec.fig.position.set(toWorldX(x), gy + bob + yOff, toWorldZ(y));

    // Overhead-Anzeige nur bei geänderter (quantisierter) HP-Stufe neu binden.
    const ratio = g.maxHp > 0 ? g.hp / g.maxHp : 1;
    const step = ratio >= 1 ? HP_STEPS : Math.max(0, Math.ceil(ratio * HP_STEPS));
    if (step !== rec.uiStep) {
      rec.uiStep = step;
      rec.ui.material = uiMaterial(g.faction, rec.label, step);
    }
  }

  // Gefallene: einmal umkippen und versinken (~1 s), danach unsichtbar bis zum
  // Respawn ('gone' bleibt für immer verborgen).
  function updateDead(rec, time) {
    rec.seen = frameId;
    if (rec.mode === 'hidden') return;
    if (rec.mode === 'live') {
      rec.mode = 'dying';
      rec.dieAt = time;
      rec.ui.visible = false;
      rec.pulse.visible = false;
    }
    const k = Math.min(1, (time - rec.dieAt) / 1.0);
    rec.fig.rotation.z = rec.fallSide * k * k * 1.45;
    const sink = Math.max(0, (k - 0.55) / 0.45);
    rec.fig.position.y = rec.groundY + rec.lastBob - sink * sink * 7;
    if (k >= 1) {
      rec.mode = 'hidden';
      rec.fig.visible = false;
    }
  }

  // --------------------------------------------------------------- update
  // Wiederverwendete Eimer je Frame (Arrays bleiben stehen, nur geleert) –
  // im Frame entstehen so gut wie keine neuen Objekte.
  const byNode = new Map();
  const byEdge = new Map();
  const byEdgeCombat = new Map();
  function bucket(mapRef, key, g) {
    let list = mapRef.get(key);
    if (!list) {
      list = [];
      mapRef.set(key, list);
    }
    list.push(g);
  }

  function update(view, time, dt) {
    const sim = view?.sim ?? null;
    if (!sim) {
      if (records.size) resetAll();
      lastSim = null;
      return;
    }
    if (sim !== lastSim) {
      resetAll();
      lastSim = sim;
    }
    if (dt <= 0) dt = 1e-3;
    const simT = sim.time;
    frameId++;

    for (const list of byNode.values()) list.length = 0;
    for (const list of byEdge.values()) list.length = 0;
    byEdgeCombat.clear(); // Schlüssel sind kurzlebige Kampf-Objekte

    for (const g of sim.groups) {
      if (g.state === 'moving') {
        const key = g.edgeFrom < g.edgeTo ? g.edgeFrom + '>' + g.edgeTo : g.edgeTo + '>' + g.edgeFrom;
        bucket(byEdge, key, g);
      } else if (g.state === 'edgeFight') {
        bucket(byEdgeCombat, g.edgeCombat, g);
      } else if (g.state === 'dead' || g.state === 'gone') {
        const rec = records.get(g);
        if (rec) updateDead(rec, time);
      } else {
        bucket(byNode, g.node, g);
      }
    }

    // Marsch auf Wegstücken: Anteil aus depart/arrive, Punkt auf der Kurve,
    // Fahrspur-Versatz wie in 2D; Blick in Bewegungsrichtung (frac + ε).
    for (const list of byEdge.values()) {
      if (!list.length) continue;
      list.sort(byId);
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        const frac = Math.min(1, (simT - g.departT) / (g.arriveT - g.departT || 1));
        const p = edgePoint(map, g.edgeFrom, g.edgeTo, frac);
        const q = edgePoint(map, g.edgeFrom, g.edgeTo, Math.min(1, frac + 0.02));
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const side = g.edgeFrom < g.edgeTo ? 1 : -1;
        const off = side * 7 + (i - (list.length - 1) / 2) * laneGap(list);
        const tx = p.x + (-dy / len) * off;
        const ty = p.y + (dx / len) * off;
        placeFigure(g, tx, ty, tx + dx, ty + dy, time, simT, dt);
      }
    }

    // Begegnungskämpfe: beide Seiten fächern um den Treffpunkt auf (rot nach
    // Norden, blau nach Süden – wie 2D) und blicken zum Kampfort.
    for (const list of byEdgeCombat.values()) {
      list.sort(byId);
      const first = list[0];
      const p = edgePoint(map, first.edgeFrom, first.edgeTo, first.edgeFrac);
      const rad = spreadRadius(list, 26);
      for (const fac of ['red', 'blue']) {
        const base = fac === 'red' ? -Math.PI / 2 : Math.PI / 2;
        let n = 0;
        for (const g of list) if (g.faction === fac) n++;
        let i = 0;
        for (const g of list) {
          if (g.faction !== fac) continue;
          const ang = base + (i - (n - 1) / 2) * 1.05;
          i++;
          placeFigure(g, p.x + Math.cos(ang) * rad, p.y + Math.sin(ang) * rad, p.x, p.y, time, simT, dt);
        }
      }
    }

    // Am Knoten: Auffächerung exakt wie render.js (rot oben, blau unten, an
    // Festungen seitlich). Kämpfer visieren die Knotenmitte an, alle anderen
    // blicken in Richtung des Feindes (blau nach Norden, rot nach Süden).
    for (const [nodeId, list] of byNode) {
      if (!list.length) continue;
      const n = map.nodes[nodeId];
      list.sort(byId);
      let blueCount = 0;
      for (const g of list) if (g.faction === 'blue') blueCount++;
      const both = blueCount > 0 && blueCount < list.length;
      const isBossNode = n.type === 'boss';
      for (const fac of ['red', 'blue']) {
        const fl = fac === 'blue' ? blueCount : list.length - blueCount;
        const base = isBossNode
          ? fac === 'red'
            ? Math.PI
            : 0
          : fac === 'red'
            ? -Math.PI / 2
            : Math.PI / 2;
        const spread = both || fl > 1;
        let i = 0;
        for (const g of list) {
          if (g.faction !== fac) continue;
          const rad = spread || isBossNode ? spreadRadius(list, isBossNode ? 48 : 32) : 0;
          const ang = base + (i - (fl - 1) / 2) * 1.05;
          i++;
          const x = n.x + Math.cos(ang) * rad;
          const y = n.y + Math.sin(ang) * rad;
          const lx = g.fighting && rad > 0.5 ? n.x : x;
          const ly = g.fighting && rad > 0.5 ? n.y : y + (g.faction === 'blue' ? -10 : 10);
          placeFigure(g, x, y, lx, ly, time, simT, dt);
        }
      }
    }

    // Verwaiste Figuren (Trupp existiert im Sim nicht mehr) entsorgen.
    if (records.size) {
      for (const [g, rec] of records) {
        if (rec.seen !== frameId) {
          group.remove(rec.fig);
          records.delete(g);
        }
      }
    }
  }

  function dispose() {
    resetAll();
    for (const tpl of templates.values()) tpl.clear();
    templates.clear();
    for (const geo of geoms) geo.dispose();
    geoms.length = 0;
    for (const { texture, material } of uiCache.values()) {
      texture.dispose();
      material.dispose();
    }
    uiCache.clear();
    pulseTexture.dispose();
    pulseMaterial.dispose();
    matBody.dispose();
    matIce.dispose();
    matGlowGreen.dispose();
    matGlowIce.dispose();
    group.clear();
  }

  return { group, update, dispose };
}
