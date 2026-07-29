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

// PROTOTYP: Hinter dem URL-Flag `?models` ersetzen fertige GLB-Modelle
// (models3d.js, dynamischer Import) testweise die handgebauten Figuren –
// je Fraktion+Trupptyp ein Modell, dazu der Yeti als Boss Lokholar.
// Ivus (blauer Boss) bleibt immer handgebaut. Ohne Flag bleibt ALLES exakt
// wie bisher, das Modul models3d.js wird dann nie geladen.
const USE_MODELS =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('models');

// Gemeinsame Materialfarben der Figuren (neutral – die Fraktion kommt wie bei
// den 2D-Porträts nur über Stoff-/Akzentflächen in FACTION_COLOR/FACTION_DARK).
const C = {
  mail: 0x99a1b4,
  steel: 0x9aa2b5,
  steelDark: 0x757d93,
  blade: 0xdde4f0,
  // Die Braun- und Dunkeltöne liegen deutlich heller als „natürlich": Unter dem
  // rein kalten Licht der Szene (Mond + blaugraue Hemisphäre) reflektiert Braun
  // kaum etwas, und alles unter ~0x50 pro Kanal säuft mit dem ACES-Tone-Mapping
  // zu Schwarz ab – so bleiben die Figuren auch auf der lichtabgewandten Seite
  // lesbar.
  leather: 0xa08063,
  leatherDark: 0x7d654f,
  hood: 0x78604a,
  skin: 0xd9b08c,
  fur: 0xb8a794,
  wood: 0x5d4c40,
  boot: 0x6b5c50, // Stiefel/Handschuhe des Spähers – dunkelste noch lesbare Lederstufe
  eye: 0x2a2623, // Augen – bewusst unter der ACES-Grenze, winzige Flächen sollen dunkel bleiben

  bark: 0x594840,
  barkDark: 0x44362e,
  // Haupt-Trunk-Flächen von Ivus: heller Treibholz-Ton, der auch unter dem
  // kalten Szenenlicht klar als Braun liest – C.bark rutscht dort ins Schwarze
  // und bleibt nur noch für Vertiefungen/Beine, C.barkDark für schmale Fugen.
  barkLight: 0x7a6a58,
  pine: 0x365a4c,
  pineBright: 0x4a7d58,
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

  // ------------------------------------------- PROTOTYP: GLB-Modelle laden
  // Nur bei aktivem `?models`-Flag: models3d.js dynamisch nachladen. Bis die
  // Modelle da sind, bleiben betroffene Trupps ein leerer Wrapper (nur
  // UI-Sprite sichtbar); bei Ladefehlern fällt alles auf die handgebauten
  // Figuren zurück (rec.useModel wird zurückgesetzt, s. attachModel/Fallback).
  let modelsApi = null; // Modul models3d.js
  // { blue: {light,medium,heavy}, red: {light,medium,heavy,lokholar} } nach
  // erfolgreichem Laden – einzelne Slots können fehlen (Ladefehler je Modell).
  let unitModels = null;
  let modelsFailed = false;
  let disposed = false;
  if (USE_MODELS) {
    import('./models3d.js')
      .then(async (mod) => {
        const loaded = await mod.loadUnitModels();
        if (disposed) {
          mod.disposeUnitModels(loaded);
          return;
        }
        modelsApi = mod;
        unitModels = loaded;
        // Bereits angelegte Trupps nachrüsten.
        for (const rec of records.values()) if (rec.useModel && !rec.mixer) attachModel(rec);
      })
      .catch((err) => {
        console.warn('[units3d] GLB-Prototyp konnte nicht laden – Fallback auf handgebaute Figuren.', err);
        modelsFailed = true;
        for (const rec of records.values()) if (rec.useModel && !rec.mixer) fallbackToTemplate(rec);
      });
  }

  // Hängt den passenden Modell-Klon samt AnimationMixer in den Wrapper eines
  // Trupp-Records (erst möglich, sobald die GLBs geladen sind).
  function attachModel(rec) {
    const entry = unitModels?.[rec.modelFaction]?.[rec.modelSlot];
    // PROTOTYP-Diagnose: belegt je Trupp die Zuordnung Fraktion+Typ→Modell
    // (Sichtprüfung: Position auf der Karte verrät NICHT die Fraktion –
    // blaue Angreifer stehen auch an der roten Nord-Festung).
    console.log(
      '[units3d] attach faction=%s slot=%s → %s',
      rec.modelFaction,
      rec.modelSlot,
      entry ? entry.label : 'FEHLT → handgebauter Fallback'
    );
    if (!entry) {
      // Nur dieses eine Modell fehlt (Ladefehler): der betroffene Trupp fällt
      // auf die handgebaute Figur zurück, alle anderen behalten ihr Modell.
      fallbackToTemplate(rec);
      return;
    }
    const target = modelsApi.TARGET_HEIGHT[rec.modelSlot] ?? modelsApi.TARGET_HEIGHT.medium;
    const model = modelsApi.cloneModel(entry, target);
    rec.fig.add(model);
    rec.mixer = new THREE.AnimationMixer(model);
    rec.actions = {};
    const roles = modelsApi.pickClips(entry.clips, entry.attack);
    for (const role of Object.keys(roles)) {
      if (roles[role]) rec.actions[role] = rec.mixer.clipAction(roles[role]);
    }
    if (rec.actions.death) {
      rec.actions.death.setLoop(THREE.LoopOnce, 1);
      rec.actions.death.clampWhenFinished = true;
    }
    rec.currentAction = null;
  }

  // Fallback bei Ladefehler: handgebaute Figur nachträglich in den (leeren)
  // Wrapper hängen, damit der Trupp nicht dauerhaft unsichtbar bleibt.
  function fallbackToTemplate(rec) {
    rec.useModel = false;
    const tpl = templateFor(rec.modelKey, rec.modelFaction).clone();
    rec.fig.add(tpl);
    rec.parts = {
      torso: tpl.getObjectByName('torso'),
      armL: tpl.getObjectByName('armL'),
      armR: tpl.getObjectByName('armR'),
      legL: tpl.getObjectByName('legL'),
      legR: tpl.getObjectByName('legR'),
    };
  }

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

  // Mittlerer Soldat (~13 hoch, ~550 Dreiecke): Kettenhemd mit Wappenrock,
  // Helm mit Wangenschutz und Fraktions-Kamm, vorgehaltenes Schwert und
  // Rundschild auf Brusthöhe. Die Materialien sind bewusst gestuft (Kette,
  // Stahl, Leder, Stiefel), damit die Figur auch im kalten Licht nicht zu
  // einer Fläche verschmilzt; die Fraktion kommt über Wappenrock, Schildfläche
  // und Helmkamm.
  function buildMedium(faction) {
    const rand = seededRand(faction === 'blue' ? 210 : 211);
    const F = FACTION_COLOR[faction];
    const FD = FACTION_DARK[faction];
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    // Beine: Kettenschenkel, Stahl-Knieplatte, dunkle Stiefel – dieselbe
    // Stufung wie beim Späher, damit die Silhouette unten nicht zuläuft.
    const leg = (x) => [
      p('box', [1.55, 3.0, 1.65], C.mail, { p: [x, 3.8, 0] }), // Kettenschenkel
      p('box', [1.35, 0.85, 0.5], C.steel, { p: [x, 2.9, 0.8] }), // Knieplatte
      p('box', [1.65, 2.4, 2.05], C.boot, { p: [x, 1.2, 0.2] }), // Stiefel
    ];
    fig.add(part('legL', [-1.25, 5.0, 0], leg(-1.25)), part('legR', [1.25, 5.0, 0], leg(1.25)));

    const torsoPivot = [0, 5.2, 0];
    const torso = part('torso', torsoPivot, [
      p('box', [4.6, 4.6, 2.8], C.mail, { p: [0, 7.5, 0] }), // Kettenhemd
      p('box', [4.8, 0.9, 3.0], C.leatherDark, { p: [0, 5.45, 0] }), // Gürtel
      p('box', [0.9, 0.65, 0.3], PALETTE.gold, { p: [0, 5.45, 1.5], jitter: 0.05 }), // Schnalle
      p('box', [4.2, 2.2, 2.6], FD, { p: [0, 4.2, 0] }), // Waffenrock
      p('box', [2.6, 4.2, 0.4], F, { p: [0, 7.4, 1.5] }), // Wappenrock vorn
      p('box', [2.3, 1.9, 0.4], F, { p: [0, 4.1, 1.4] }), // Wappenrock über dem Rock
      p('box', [2.3, 0.55, 0.44], FD, { p: [0, 3.3, 1.41] }), // Bordüre unten
      p('box', [2.6, 4.2, 0.4], FD, { p: [0, 7.4, -1.5] }), // Rückenbahn
      // Schulterplatten mit schmaler FD-Zierlinie, damit sich der Stahl vom
      // Kettenhemd absetzt.
      p('box', [2.7, 1.9, 2.8], C.steel, { p: [-3.05, 9.75, 0], r: [0, 0, 0.15] }),
      p('box', [2.7, 1.9, 2.8], C.steel, { p: [3.05, 9.75, 0], r: [0, 0, -0.15] }),
      p('box', [2.8, 0.45, 2.9], FD, { p: [-3.05, 9.15, 0], r: [0, 0, 0.15] }),
      p('box', [2.8, 0.45, 2.9], FD, { p: [3.05, 9.15, 0], r: [0, 0, -0.15] }),
      // Kopf: größere Gesichtsbox mit Augen, flach ausgestellte Helmglocke,
      // Wangenschutz und schmaler Nasal – das Gesicht bleibt von schräg oben
      // frei sichtbar.
      p('box', [2.0, 1.9, 1.8], C.skin, { p: [0, 10.6, 0.2] }), // Gesicht
      p('box', [0.38, 0.34, 0.16], C.eye, { p: [-0.45, 10.7, 1.12], jitter: 0.03 }), // Augen
      p('box', [0.38, 0.34, 0.16], C.eye, { p: [0.45, 10.7, 1.12], jitter: 0.03 }),
      p('cyl', [1.25, 1.7, 1.6, 7], C.steel, { p: [0, 12.1, 0.1] }), // Helmglocke
      p('box', [0.5, 1.3, 1.2], C.steelDark, { p: [-1.05, 10.9, 0.55] }), // Wangenschutz
      p('box', [0.5, 1.3, 1.2], C.steelDark, { p: [1.05, 10.9, 0.55] }),
      p('box', [0.32, 1.1, 0.35], C.steel, { p: [0, 10.95, 1.2] }), // Nasal
      p('box', [0.34, 0.75, 2.6], F, { p: [0, 12.9, -0.05] }), // Helmkamm (Fraktion)
    ]);
    fig.add(torso);

    // Schwertarm: Kettenärmel, Stahl-Armschiene, Lederfaust. Die Klinge sitzt
    // um 1.0 rad nach vorn-oben gekippt an der Faust – in Ruhe (armRest 0.15)
    // zeigt sie vorgestreckt auf Brusthöhe nach vorn, beim 'slash'-Ausholen
    // (-1.7) steht sie senkrecht über dem Kopf und im Hieb (0.95) schneidet
    // sie vorn-unten durch – nie hinter der Schulter.
    const armR = part('armR', [3.0, 9.15, 0], [
      p('box', [1.3, 2.3, 1.4], C.mail, { p: [3.0, 8.15, 0] }), // Kettenärmel
      p('box', [1.45, 1.8, 1.55], C.steel, { p: [3.05, 6.35, 0.15] }), // Armschiene
      p('box', [1.15, 1.05, 1.25], C.boot, { p: [3.05, 5.2, 0.35] }), // Lederfaust
      p('box', [0.42, 1.5, 0.42], C.leatherDark, { p: [3.05, 5.2, 0.45], r: [1.0, 0, 0] }), // Griff
      p('box', [0.6, 0.55, 0.6], C.steel, { p: [3.05, 4.69, -0.35], r: [1.0, 0, 0] }), // Knauf
      p('box', [1.9, 0.28, 0.55], C.steel, { p: [3.05, 5.66, 1.16], r: [1.0, 0, 0] }), // Parierstange
      p('box', [0.95, 4.4, 0.24], C.blade, { p: [3.05, 6.85, 3.02], r: [1.0, 0, 0] }), // Klinge
      p('cone', [0.5, 1.1, 4], C.blade, { p: [3.05, 8.31, 5.29], r: [1.0, 0, 0] }), // Spitze
    ]);
    // Schildarm: Der Rundschild sitzt am Unterarm auf Brusthöhe (Mitte ~7.8),
    // leicht nach außen und oben gekippt – Stahlrand, FD-Rand, F-Fläche und
    // Stahlbuckel staffeln sich entlang der Schildnormalen. Beim Verteidigen
    // (armLx 1.05) wandert er angehoben vor die Brustseite.
    const shieldTilt = [Math.PI / 2 - 0.22, 0, 0.28];
    const armL = part('armL', [-3.0, 9.15, 0], [
      p('box', [1.3, 2.3, 1.4], C.mail, { p: [-3.0, 8.15, 0] }), // Kettenärmel
      p('box', [1.45, 1.8, 1.55], C.steel, { p: [-3.05, 6.35, 0.15] }), // Armschiene
      p('box', [1.15, 1.05, 1.25], C.boot, { p: [-3.05, 5.2, 0.35] }), // Lederfaust
      p('cyl', [2.7, 2.7, 0.3, 7], C.steel, { p: [-3.8, 8.0, 1.45], r: shieldTilt }), // Stahlrand
      p('cyl', [2.35, 2.35, 0.3, 7], FD, { p: [-3.83, 8.02, 1.54], r: shieldTilt }), // FD-Rand
      p('cyl', [1.9, 1.9, 0.32, 7], F, { p: [-3.86, 8.04, 1.64], r: shieldTilt }), // Fläche
      p('cone', [0.9, 1.0, 6], C.steel, { p: [-3.94, 8.11, 1.92], r: shieldTilt }), // Buckel
    ]);
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Leichter Späher (~11 hoch, ~470 Dreiecke): zurückgeschlagene Kapuze mit
  // freiem Gesicht, Fellkragen, Lederkluft in drei Helligkeitsstufen, Köcher
  // auf dem Rücken und zwei vorgehaltene Dolche; die Fraktion kommt über die
  // anliegende Diagonal-Schärpe.
  function buildLight(faction) {
    const rand = seededRand(faction === 'blue' ? 220 : 221);
    const F = FACTION_COLOR[faction];
    const FD = FACTION_DARK[faction];
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    // Beine: dunkle Hose, fast schwarze Stiefel mit Fellrand – bewusst dunkler
    // als die Tunika, damit sich die Silhouette in Stufen liest.
    const leg = (x) => [
      p('box', [1.2, 2.4, 1.3], C.leatherDark, { p: [x, 3.55, 0] }), // Hose
      p('box', [1.45, 0.55, 1.55], C.fur, { p: [x, 2.25, 0.05], jitter: 0.16 }), // Fellrand
      p('box', [1.3, 1.8, 1.4], C.boot, { p: [x, 1.1, 0.05] }), // Stiefelschaft
      p('box', [1.35, 0.9, 1.9], C.boot, { p: [x, 0.45, 0.3] }), // Fußkappe
    ];
    fig.add(part('legL', [-1.0, 4.6, 0], leg(-1.0)), part('legR', [1.0, 4.6, 0], leg(1.0)));

    const torsoPivot = [0, 4.6, 0];
    const torso = part('torso', torsoPivot, [
      p('box', [3.6, 3.4, 2.2], C.leather, { p: [0, 6.9, 0] }), // Tunika
      p('box', [3.8, 1.1, 2.4], C.leatherDark, { p: [0, 4.85, 0] }), // Rocksaum
      p('box', [3.9, 0.55, 2.5], C.leatherDark, { p: [0, 5.55, 0] }), // Gürtel
      p('box', [0.6, 0.45, 0.2], C.steel, { p: [0, 5.55, 1.3] }), // Schnalle
      // Schärpe: zwei dünne, anliegende Diagonalbahnen (vorn F, hinten FD) von
      // der rechten Schulter zur linken Hüfte; die Enden tauchen unter Kragen
      // bzw. Gürtel ab, nichts schwebt.
      p('box', [1.05, 3.4, 0.22], F, { p: [0, 7.15, 1.22], r: [0, 0, -0.7] }),
      p('box', [1.05, 3.4, 0.22], FD, { p: [0, 7.15, -1.22], r: [0, 0, -0.7] }),
      p('cyl', [1.7, 2.0, 1.0, 7], C.fur, { p: [0, 8.75, -0.2], jitter: 0.18 }), // Fellkragen
      p('box', [1.8, 1.8, 1.6], C.skin, { p: [0, 9.9, 0.4] }), // Gesicht
      p('box', [0.34, 0.3, 0.14], C.eye, { p: [-0.42, 10.15, 1.22], jitter: 0.03 }), // Augen
      p('box', [0.34, 0.3, 0.14], C.eye, { p: [0.42, 10.15, 1.22], jitter: 0.03 }),
      // Kapuze: kleiner, nach hinten gekippter Kegel plus Nacken- und Stirnteil –
      // die Öffnung bleibt vorn, das Gesicht frei.
      p('cone', [1.55, 1.9, 6], C.hood, { p: [0, 11.35, -0.45], r: [-0.4, 0, 0] }),
      p('box', [2.0, 1.7, 1.3], C.hood, { p: [0, 10.05, -0.8] }), // Nackenteil
      p('box', [1.9, 0.4, 0.5], C.hood, { p: [0, 10.7, 0.95] }), // Stirnrand
      // Köcher schräg auf dem Rücken – das Späher-Erkennungszeichen.
      p('cyl', [0.32, 0.36, 2.7, 5], C.leatherDark, { p: [0.85, 8.1, -1.55], r: [-0.2, 0, -0.5] }),
      p('cone', [0.13, 0.45, 4], C.blade, { p: [1.55, 9.5, -1.8], r: [-0.2, 0, -0.5] }), // Pfeilspitzen
      p('cone', [0.13, 0.45, 4], C.blade, { p: [1.28, 9.3, -1.65], r: [-0.2, 0, -0.5] }),
      p('cone', [0.13, 0.45, 4], C.blade, { p: [1.7, 9.2, -1.95], r: [-0.2, 0, -0.5] }),
    ]);
    fig.add(torso);

    // Arm mit Dolch: Die Klinge sitzt um ~0.95 rad nach vorn gekippt an der
    // Faust. Der Stich-Angriff schwenkt den Arm um X von -0.55 (ausholen) bis
    // 1.35 (Stoß) – die Klinge zeigt dabei immer nach vorn: erhoben beim
    // Ausholen, vorn-unten im Stoß, und in Ruhe (armRest 0.3) schräg vor.
    const arm = (x) => [
      p('box', [1.15, 1.6, 1.25], C.leather, { p: [x, 7.6, 0] }), // Ärmel
      p('box', [1.05, 2.0, 1.15], C.boot, { p: [x, 6.15, 0.3], r: [-0.3, 0, 0] }), // Armstulpe
      p('box', [0.95, 0.9, 0.95], C.skin, { p: [x, 5.1, 0.7] }), // Faust
      p('box', [0.34, 0.34, 0.34], C.steelDark, { p: [x, 4.75, 0.21], r: [0.95, 0, 0] }), // Knauf
      p('box', [1.0, 0.2, 0.38], C.steelDark, { p: [x, 5.42, 1.15], r: [0.95, 0, 0] }), // Parierstange
      p('box', [0.5, 2.3, 0.16], C.blade, { p: [x, 6.15, 2.16], r: [0.95, 0, 0] }), // Klinge
      p('cone', [0.27, 0.6, 4], C.blade, { p: [x, 6.97, 3.32], r: [0.95, 0, 0] }), // Spitze
    ];
    const armR = part('armR', [2.25, 8.15, 0], arm(2.25));
    const armL = part('armL', [-2.25, 8.15, 0], arm(-2.25));
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Schwerer Koloss (~15.5 hoch, ~620 Dreiecke): gestufte Plattenrüstung
  // (heller Brustpanzer, dunkle Beinschienen, Stiefel), ausladende Stier-Hörner,
  // Visierschlitz statt offenem Gesicht, Fellkragen über beiden Schultern plus
  // Umhangplatte hinten. Der Zweihandhammer lehnt schräg nach vorn-außen an der
  // rechten Faust – der zweifarbige Stachelkopf steht frei über und außerhalb
  // der Schultersilhouette. Fraktion über Tabard, Waffenrock und Schulter-Fugen.
  function buildHeavy(faction) {
    const rand = seededRand(faction === 'blue' ? 230 : 231);
    const F = FACTION_COLOR[faction];
    const FD = FACTION_DARK[faction];
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    // Beine: dunkle Beinschiene, helle Kniekachel, Stiefel mit Fußkappe –
    // dieselbe Dreier-Stufung wie bei Späher und Soldat, nur wuchtiger.
    const leg = (x) => [
      p('box', [2.3, 3.2, 2.4], C.steelDark, { p: [x, 4.1, 0] }), // Beinschiene
      p('box', [2.0, 1.0, 0.55], C.steel, { p: [x, 3.1, 1.25] }), // Kniekachel
      p('box', [2.4, 2.4, 2.5], C.boot, { p: [x, 1.2, 0.1] }), // Stiefelschaft
      p('box', [2.5, 1.0, 3.0], C.boot, { p: [x, 0.5, 0.4] }), // Fußkappe
    ];
    fig.add(part('legL', [-1.8, 5.6, 0], leg(-1.8)), part('legR', [1.8, 5.6, 0], leg(1.8)));

    const torsoPivot = [0, 5.8, 0];
    const torso = part('torso', torsoPivot, [
      // Rumpf: oben schmaler als früher, damit die größeren Schulterplatten die
      // Silhouette dominieren; Gürtel mit Stahlschnalle trennt Panzer und Rock.
      p('box', [5.8, 4.8, 3.6], C.steel, { p: [0, 8.9, 0] }), // Brustpanzer
      p('box', [6.2, 1.3, 3.9], C.leatherDark, { p: [0, 6.3, 0] }), // Gürtel
      p('box', [1.5, 0.95, 0.4], C.steel, { p: [0, 6.3, 2.0], jitter: 0.05 }), // Schnalle
      p('box', [5.5, 2.4, 3.4], FD, { p: [0, 4.9, 0] }), // Waffenrock
      p('box', [3.2, 4.4, 0.45], F, { p: [0, 9.0, 1.95] }), // Tabard auf der Brust
      p('box', [2.7, 2.1, 0.42], F, { p: [0, 4.75, 1.85] }), // Tabard über dem Rock
      p('box', [2.8, 0.6, 0.46], FD, { p: [0, 3.85, 1.86] }), // Bordüre unten
      // Fell: Umhangplatte hinten plus Kragen, der über beide Schultern nach
      // vorn herumreicht – so liest sich das Fell auch frontal.
      p('box', [7.2, 6.6, 0.9], C.fur, { p: [0, 8.7, -2.35], jitter: 0.18 }), // Umhang
      // Kragen sitzt tiefer und weiter hinten als der Kopf, damit Gesichtsband
      // und Sehschlitze frontal frei bleiben.
      p('cyl', [2.2, 3.0, 1.4, 7], C.fur, { p: [0, 11.15, -0.15], jitter: 0.18 }), // Fellkragen
      p('box', [2.4, 1.3, 1.5], C.fur, { p: [-2.0, 10.5, 1.6], r: [0, 0.35, 0], jitter: 0.2 }),
      p('box', [2.4, 1.3, 1.5], C.fur, { p: [2.0, 10.5, 1.6], r: [0, -0.35, 0], jitter: 0.2 }),
      // Schulterplatten: größer, höher und stärker gekippt als der Rumpf breit
      // ist; die FD-Zierfuge darunter setzt sie sichtbar vom Panzer ab.
      p('box', [3.8, 2.6, 4.0], C.steel, { p: [-4.4, 12.0, 0], r: [0, 0, 0.35] }),
      p('box', [3.8, 2.6, 4.0], C.steel, { p: [4.4, 12.0, 0], r: [0, 0, -0.35] }),
      p('box', [3.9, 0.55, 4.1], FD, { p: [-4.35, 10.75, 0], r: [0, 0, 0.35] }), // Zierfuge
      p('box', [3.9, 0.55, 4.1], FD, { p: [4.35, 10.75, 0], r: [0, 0, -0.35] }),
      p('cone', [0.95, 2.6, 5], C.steel, { p: [-5.15, 14.2, 0], r: [0, 0, 0.35] }), // Stacheln
      p('cone', [0.95, 2.6, 5], C.steel, { p: [5.15, 14.2, 0], r: [0, 0, -0.35] }),
      // Kopf: sitzt komplett über der Fellkragen-Oberkante (~11.85), damit
      // Gesichtsband und Sehschlitze frontal frei bleiben – Kieferschutz unten,
      // Haut nur als schmales Band, darüber die Helmglocke mit Stier-Hörnern.
      p('box', [2.1, 1.0, 1.9], C.steelDark, { p: [0, 11.9, 0.55] }), // Kieferschutz
      p('box', [1.9, 0.85, 1.7], C.skin, { p: [0, 12.65, 0.55] }), // Gesichtsband
      p('box', [0.55, 0.3, 0.2], C.eye, { p: [-0.48, 12.7, 1.43], jitter: 0.03 }), // Sehschlitze
      p('box', [0.55, 0.3, 0.2], C.eye, { p: [0.48, 12.7, 1.43], jitter: 0.03 }),
      p('cyl', [1.6, 1.85, 1.8, 7], C.steel, { p: [0, 13.9, 0.3] }), // Helmglocke
      p('cone', [0.75, 2.0, 5], C.steel, { p: [-2.25, 14.25, 0.3], r: [0, 0, 1.15] }), // Hörner
      p('cone', [0.75, 2.0, 5], C.steel, { p: [2.25, 14.25, 0.3], r: [0, 0, -1.15] }),
    ]);
    fig.add(torso);

    // Hammerarm: Der Stiel lehnt schräg nach vorn-außen in der Faust, der Kopf
    // steht in Ruhe (armRest 0.2) frei bei ~(7.4, 14, 4.5) – klar über und
    // außerhalb der Schulterplatte. Beim 'smash' (-2.3..1.15 um X) wandert er
    // hinter den Rücken, im Bogen über den Kopf (Scheitel ~18, unter ui 20)
    // und schlägt vorn auf Brusthöhe ein.
    const hr = [0.37, 0, -0.33]; // Stiel-Neigung (vorn-außen)
    const armR = part('armR', [4.3, 11.0, 0], [
      p('box', [2.0, 2.6, 2.1], C.steel, { p: [4.3, 9.6, 0] }), // Oberarm
      p('box', [1.9, 2.4, 2.0], C.steelDark, { p: [4.3, 7.5, 0.25] }), // Armschiene
      p('box', [1.7, 1.5, 1.7], C.boot, { p: [4.3, 6.3, 0.5] }), // Faust
      p('cyl', [0.5, 0.5, 11.5, 6], C.wood, { p: [5.64, 9.97, 1.92], r: hr }), // Stiel
      p('cyl', [0.62, 0.62, 0.8, 6], C.steel, { p: [4.72, 7.45, 0.95], r: hr }), // Griffzwinge
      p('cyl', [0.65, 0.65, 0.9, 6], C.steel, { p: [6.85, 13.3, 3.22], r: hr }), // Kopfzwinge
      p('box', [0.85, 0.6, 0.85], C.steelDark, { p: [3.79, 4.93, -0.03], r: hr }), // Knauf
      p('box', [3.8, 2.4, 2.4], C.steelDark, { p: [7.4, 14.8, 3.8], r: hr }), // Hammerkopf
      p('box', [4.0, 0.9, 2.6], C.steel, { p: [7.4, 14.8, 3.8], r: hr }), // Stahlband
      // Stacheln auf den Schlagflächen (entlang der Kopfachse ausgerichtet).
      p('cone', [0.42, 1.1, 4], C.steel, { p: [9.43, 13.9, 4.2], r: [0.37, 0, -1.9] }),
      p('cone', [0.42, 1.1, 4], C.steel, { p: [9.43, 14.4, 2.9], r: [0.37, 0, -1.9] }),
      p('cone', [0.65, 1.5, 5], C.steel, { p: [5.22, 15.49, 4.07], r: [0.37, 0, 1.24] }),
    ]);
    // Zweithand: angewinkelt nach vorn-innen, die Faust liegt auf Höhe des
    // unteren Stielendes – beim Smash schwingt sie mit (-2.05..1.0) und liest
    // sich als packende Hand, ohne starr am Stiel zu hängen.
    const armL = part('armL', [-4.3, 11.0, 0], [
      p('box', [2.0, 2.7, 2.1], C.steel, { p: [-4.3, 9.5, 0] }), // Oberarm
      p('box', [1.8, 2.5, 1.9], C.steelDark, { p: [-3.8, 7.3, 0.75], r: [-0.5, 0, 0.28] }), // Armschiene
      p('box', [1.6, 1.4, 1.6], C.boot, { p: [-3.35, 6.3, 1.75] }), // Faust
    ]);
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Ivus der Waldlord (~23 hoch, ~650 Dreiecke): heller Treibholz-Stamm mit
  // dunklen Borkenfugen, Baum-Gesicht (Brauen-Wulst über glimmenden Augen),
  // krumme Ast-Arme mit Zweig-Fingern und Nadelbüscheln, verschneite
  // Nadelkrone; das blaue Banntuch ist um den Stamm geschnürt.
  function buildIvus() {
    const rand = seededRand(240);
    const F = FACTION_COLOR.blue;
    const FD = FACTION_DARK.blue;
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    // Beine: helles Treibholz wie der Stamm, dunklere Töne nur als Akzent
    // (Astknubbel und Wurzelzehen), damit die untere Hälfte nicht zuläuft.
    fig.add(
      part('legL', [-1.9, 6.0, 0], [
        p('cyl', [1.1, 1.8, 6.2, 6], C.barkLight, { p: [-1.9, 3.0, 0], jitter: 0.24 }),
        p('oct', [0.75, 0], C.bark, { p: [-2.5, 4.4, 0.9], jitter: 0.18 }), // Astknubbel
        p('cone', [0.7, 1.6, 5], C.bark, { p: [-2.6, 0.6, 1.1], r: [1.2, 0, 0] }), // Wurzelzehen
        p('cone', [0.7, 1.6, 5], C.bark, { p: [-1.2, 0.6, 1.1], r: [1.2, 0, 0] }),
      ]),
      part('legR', [1.9, 6.0, 0], [
        p('cyl', [1.1, 1.8, 6.2, 6], C.barkLight, { p: [1.9, 3.0, 0], jitter: 0.24 }),
        p('oct', [0.75, 0], C.bark, { p: [2.5, 4.6, 0.8], jitter: 0.18 }),
        p('cone', [0.7, 1.6, 5], C.bark, { p: [2.6, 0.6, 1.1], r: [1.2, 0, 0] }),
        p('cone', [0.7, 1.6, 5], C.bark, { p: [1.2, 0.6, 1.1], r: [1.2, 0, 0] }),
      ])
    );

    const torsoPivot = [0, 6.0, 0];
    const torso = part('torso', torsoPivot, [
      // Stamm in hellem Treibholz-Ton, kräftiges Zittern als Borkenstruktur.
      p('cyl', [2.7, 3.7, 9.2, 7], C.barkLight, { p: [0, 10.4, 0], jitter: 0.24 }),
      // Eingesenkte Borkenfugen brechen die Zylinderfläche auf.
      p('box', [0.5, 6.8, 0.6], C.bark, { p: [-2.4, 10.0, 1.6], r: [0, 0.5, 0.06], jitter: 0.15 }),
      p('box', [0.45, 5.6, 0.6], C.bark, { p: [2.6, 9.6, -1.0], r: [0, -0.4, -0.05], jitter: 0.15 }),
      p('box', [0.5, 6.2, 0.6], C.bark, { p: [0.4, 10.4, -2.9], r: [0, 0.1, 0.08], jitter: 0.15 }),
      // Moos an Schulter und Flanke – groß genug, um im Viewer zu lesen.
      p('box', [2.8, 3.0, 0.9], C.pineBright, { p: [-2.2, 13.2, 1.3], r: [0, 0.7, 0.15] }),
      p('box', [2.6, 2.2, 0.9], C.pineBright, { p: [2.5, 10.4, -1.4], r: [0, -0.6, 0] }),
      // Gesicht: helles Gesichtsfeld, vorspringender Brauen-Wulst, Nasenknubbel.
      p('box', [2.7, 2.6, 1.1], C.barkLight, { p: [0, 14.2, 2.35], jitter: 0.18 }),
      p('box', [3.0, 0.8, 1.3], C.barkDark, { p: [0, 15.35, 2.6], r: [0.25, 0, 0] }),
      p('box', [0.7, 1.15, 0.65], C.bark, { p: [0, 14.15, 3.0], r: [0.1, 0, 0], jitter: 0.2 }),
      // Nadelkrone mit Schneehauben – bindet Ivus an die verschneiten Bäume.
      p('cone', [3.5, 4.6, 7], C.pine, { p: [0, 17.8, 0], jitter: 0.14 }),
      p('cone', [2.6, 3.8, 7], C.pine, { p: [0, 19.9, 0], jitter: 0.14 }),
      p('cone', [1.5, 3.0, 6], C.pineBright, { p: [0, 21.9, 0], jitter: 0.14 }),
      p('cone', [0.85, 1.5, 5], PALETTE.snowHigh, { p: [0, 22.7, 0], jitter: 0.06 }), // Schneespitze
      p('oct', [0.85, 0], PALETTE.snowHigh, { p: [-2.1, 16.6, 2.0], s: [1.5, 0.5, 1.1], r: [0.35, 0.5, 0], jitter: 0.06 }),
      p('oct', [0.8, 0], PALETTE.snowHigh, { p: [2.3, 16.4, -1.4], s: [1.4, 0.5, 1.0], r: [-0.3, -0.4, 0], jitter: 0.06 }),
      p('oct', [0.7, 0], PALETTE.snowHigh, { p: [1.5, 19.0, 1.4], s: [1.4, 0.5, 1.0], r: [0.4, -0.6, 0], jitter: 0.06 }),
      p('oct', [0.65, 0], PALETTE.snowHigh, { p: [-1.4, 19.2, -1.2], s: [1.3, 0.5, 1.0], r: [-0.35, 0.6, 0], jitter: 0.06 }),
      // Aststummel mit Nadelbüscheln lockern den Übergang Stamm→Krone auf.
      p('cyl', [0.3, 0.45, 2.4, 5], C.bark, { p: [3.0, 15.4, 0.7], r: [0, 0, -1.3], jitter: 0.2 }),
      p('cone', [0.75, 1.5, 5], C.pine, { p: [4.0, 15.0, 0.8], r: [Math.PI, 0, 0] }),
      p('cyl', [0.28, 0.4, 2.2, 5], C.bark, { p: [-2.9, 15.7, -0.9], r: [0.3, 0, 1.3], jitter: 0.2 }),
      p('cone', [0.65, 1.3, 5], C.pineBright, { p: [-3.8, 15.3, -1.2], r: [Math.PI, 0, 0.3] }),
      // Banntuch der Allianz: mit dunkler Schnur um den Stamm geschnürt,
      // FD-Bordüre oben, unten eine Kerbe aus zwei getrennten Bahnen.
      p('cyl', [3.2, 3.3, 0.5, 7, 1, true], C.barkDark, { p: [0, 12.4, 0], jitter: 0.1 }), // Schnur
      p('box', [2.3, 0.7, 0.4], FD, { p: [0, 11.85, 3.15], r: [0.08, 0, 0] }), // Bordüre
      p('box', [2.0, 2.9, 0.32], F, { p: [0, 10.1, 3.3], r: [0.1, 0, 0] }), // Tuch
      p('box', [0.8, 1.3, 0.32], F, { p: [-0.55, 8.2, 3.42], r: [0.1, 0, 0] }), // Kerbe links
      p('box', [0.8, 1.3, 0.32], F, { p: [0.55, 8.2, 3.42], r: [0.1, 0, 0] }), // Kerbe rechts
    ]);
    // Glimmende Augen unter dem Brauen-Wulst plus schmaler Mundschlitz.
    glowPart(torso, torsoPivot, [
      p('box', [0.75, 0.75, 0.4], 0xaef0b4, { p: [-0.8, 14.55, 3.0] }),
      p('box', [0.75, 0.75, 0.4], 0xaef0b4, { p: [0.8, 14.55, 3.0] }),
      p('box', [1.15, 0.22, 0.35], 0xaef0b4, { p: [0, 13.4, 2.95] }),
    ], matGlowGreen);
    fig.add(torso);

    // Krummer Ast statt Brett: zwei versetzte, sich verjüngende Segmente mit
    // Knick-Knubbel, Zweig-Fingern und Nadelbüscheln am Handgelenk.
    const branchArm = (side) => [
      p('cyl', [0.7, 0.95, 4.8, 5], C.barkLight, { p: [side * 4.5, 11.5, 0], r: [0, 0, -side * 0.3], jitter: 0.24 }), // Oberast
      p('oct', [0.85, 0], C.bark, { p: [side * 5.5, 9.2, 0.3], jitter: 0.2 }), // Astknick
      p('cyl', [0.42, 0.62, 4.0, 5], C.barkLight, { p: [side * 5.8, 7.0, 0.8], r: [0.3, 0, side * 0.12], jitter: 0.22 }), // Unterast
      p('cone', [0.26, 1.7, 4], C.bark, { p: [side * 5.4, 4.4, 1.0], r: [Math.PI, 0, -side * 0.25] }), // Zweig-Finger
      p('cone', [0.24, 1.5, 4], C.bark, { p: [side * 6.2, 4.6, 1.2], r: [Math.PI, 0, side * 0.3] }),
      p('cone', [0.22, 1.3, 4], C.bark, { p: [side * 5.9, 4.7, 0.4], r: [Math.PI - 0.3, 0, 0] }),
      p('cone', [0.7, 1.6, 5], C.pine, { p: [side * 5.6, 5.4, 1.4], r: [Math.PI, 0, 0] }), // Nadelbüschel
      p('cone', [0.5, 1.2, 4], C.pineBright, { p: [side * 6.1, 5.6, 0.6], r: [Math.PI, 0, side * 0.4] }),
    ];
    const armR = part('armR', [3.9, 13.6, 0], branchArm(1));
    const armL = part('armL', [-3.9, 13.6, 0], branchArm(-1));
    attachToTorso(torso, torsoPivot, armR);
    attachToTorso(torso, torsoPivot, armL);
    return fig;
  }

  // Lokholar der Eislord (~22 hoch, Krone bis ~23, ~500 Dreiecke): kantige
  // Eisbrocken in halbtransparentem Material mit gezackter Kontur – Rückenkamm,
  // Schulterspitzen und Eiskrone lesen auch als Fernsilhouette. Der glimmende
  // Kern bricht durch Glimm-Ritzen an den Torso-Fugen nach außen; das rote
  // Horden-Banner hängt als zerrissener Wimpel an der linken Schulter.
  function buildLokholar() {
    const rand = seededRand(241);
    const F = FACTION_COLOR.red;
    const FD = FACTION_DARK.red;
    const p = (kind, args, hex, opts) => prim(rand, kind, args, hex, opts);
    const fig = new THREE.Group();
    fig.rotation.order = 'YXZ';

    // Massige Beine: breite Waden-Brocken über flachen Fuß-Platten, dazu je
    // zwei Eiszapfen an Wade/Knöchel, die nach unten zeigen.
    const iceLeg = (side) => [
      p('oct', [1.9, 0], C.ice, { p: [side * 2.0, 4.2, 0], s: [1, 1.7, 1], jitter: 0.16 }), // Schenkel
      p('oct', [1.8, 0], C.ice, { p: [side * 2.1, 2.0, 0.1], s: [1.35, 1.15, 1.35], jitter: 0.16 }), // Wade
      p('oct', [1.5, 0], C.iceBright, { p: [side * 2.0, 0.9, 0.5], s: [1.4, 0.7, 1.6], jitter: 0.16 }), // Fußplatte
      p('cone', [0.45, 1.8, 4], C.iceBright, { p: [side * 3.3, 1.6, 0.6], r: [Math.PI, 0, side * 0.2] }), // Wadenzapfen
      p('cone', [0.4, 1.5, 4], C.iceBright, { p: [side * 1.1, 1.4, -0.7], r: [Math.PI - 0.2, 0, 0] }), // Knöchelzapfen
    ];
    fig.add(
      part('legL', [-2.0, 6.5, 0], iceLeg(-1), matIce),
      part('legR', [2.0, 6.5, 0], iceLeg(1), matIce)
    );

    const torsoPivot = [0, 6.5, 0];
    const torso = part('torso', torsoPivot, [
      p('ico', [4.4, 0], C.ice, { p: [0, 11.6, 0], s: [1.05, 1.5, 0.95], jitter: 0.18 }), // Leib
      p('oct', [3.0, 0], C.iceBright, { p: [0, 14.7, 1.2], s: [1.15, 1.1, 0.8], jitter: 0.18 }), // Brustplatte
      p('oct', [2.6, 0], C.ice, { p: [-1.2, 13.4, -2.0], jitter: 0.18 }), // Rückenbrocken
      p('oct', [2.5, 0], C.iceBright, { p: [-5.0, 16.5, 0], s: [1.1, 0.9, 1], jitter: 0.18 }), // Schulterbrocken
      p('oct', [2.5, 0], C.iceBright, { p: [5.0, 16.5, 0], s: [1.1, 0.9, 1], jitter: 0.18 }),
      // Schulterspitzen: kräftige, nach oben-außen gekippte Zacken.
      p('cone', [0.8, 3.4, 4], C.iceBright, { p: [-5.6, 18.9, -0.6], r: [0, 0, 0.45] }),
      p('cone', [0.8, 3.4, 4], C.iceBright, { p: [5.6, 18.9, -0.6], r: [0, 0, -0.45] }),
      p('cone', [0.55, 2.4, 4], C.iceBright, { p: [-4.3, 18.6, 0.4], r: [0.15, 0, 0.2] }),
      p('cone', [0.55, 2.4, 4], C.iceBright, { p: [4.3, 18.6, 0.4], r: [0.15, 0, -0.2] }),
      // Rückenkamm: vier gestaffelte, nach hinten gekippte Eiszapfen.
      p('cone', [0.7, 3.6, 4], C.iceBright, { p: [0, 18.0, -2.2], r: [-0.55, 0, 0] }),
      p('cone', [0.6, 3.0, 4], C.iceBright, { p: [0, 16.2, -2.8], r: [-0.75, 0, 0.1] }),
      p('cone', [0.55, 2.6, 4], C.iceBright, { p: [0, 14.2, -3.2], r: [-0.9, 0, -0.1] }),
      p('cone', [0.45, 2.2, 4], C.iceBright, { p: [0, 12.2, -3.4], r: [-1.05, 0, 0] }),
      // Haupt mit Eiskrone: drei große Hörner statt Mini-Kegel.
      p('oct', [2.0, 0], C.iceBright, { p: [0, 19.3, 0.15], s: [1.05, 1.35, 1.05], jitter: 0.18 }),
      p('cone', [0.7, 3.2, 4], C.iceBright, { p: [0, 21.3, -0.5], r: [-0.2, 0, 0] }), // Mittelhorn
      p('cone', [0.6, 2.6, 4], C.iceBright, { p: [-1.4, 20.8, -0.2], r: [-0.1, 0, 0.5] }),
      p('cone', [0.6, 2.6, 4], C.iceBright, { p: [1.4, 20.8, -0.2], r: [-0.1, 0, -0.5] }),
      // Schräge Brauen-Zacken über den Augen – finsterer Blick.
      p('cone', [0.32, 1.5, 4], C.iceBright, { p: [-1.15, 20.5, 1.2], r: [0.55, 0, 0.9] }),
      p('cone', [0.32, 1.5, 4], C.iceBright, { p: [1.15, 20.5, 1.2], r: [0.55, 0, -0.9] }),
    ], matIce);
    // Kern und Ritzen: das Licht bricht aus dem Inneren durch die Eisplatten –
    // der Kern sitzt weit vorn, damit er durchs transparente Eis liest, die
    // Ritzen liegen auf den Torso-Fugen (eine frontal, eine schräg, eine seitlich).
    glowPart(torso, torsoPivot, [
      p('ico', [2.6, 0], 0xcfe9ff, { p: [0, 12.4, 0.8] }), // Kern
      p('box', [0.4, 3.2, 0.35], 0xcfe9ff, { p: [1.1, 12.8, 3.3], r: [0.08, 0, -0.22] }), // Ritze frontal
      p('box', [0.35, 2.2, 0.3], 0xcfe9ff, { p: [-1.6, 11.2, 3.4], r: [0.12, 0, 0.35] }),
      p('box', [0.35, 2.8, 0.3], 0xcfe9ff, { p: [3.4, 13.0, 1.2], r: [0, -0.55, 0.3] }), // Ritze Flanke
      p('box', [0.7, 0.7, 0.5], 0xcfe9ff, { p: [-0.8, 19.6, 1.5] }), // Augen
      p('box', [0.7, 0.7, 0.5], 0xcfe9ff, { p: [0.8, 19.6, 1.5] }),
    ], matGlowIce);
    // Undurchsichtiger Horden-Wimpel an der linken Schulterspitze (damit der
    // blaugraue Eisleib nicht mit der Allianzfarbe verwechselt wird): FD-Quer-
    // stange und Bordüre, schräg wehende F-Bahn, unten eine Kerbe aus zwei Bahnen.
    glowPart(torso, torsoPivot, [
      p('box', [2.6, 0.5, 0.5], FD, { p: [-3.3, 16.9, 2.9], r: [0.1, 0, 0.3] }), // Querstange
      p('box', [2.3, 0.65, 0.4], FD, { p: [-3.15, 16.2, 3.1], r: [0.1, 0, 0.28] }), // Bordüre
      p('box', [2.1, 3.4, 0.34], F, { p: [-2.75, 14.2, 3.35], r: [0.12, 0, 0.24] }), // Bahn
      p('box', [0.75, 1.7, 0.34], F, { p: [-3.35, 11.8, 3.6], r: [0.12, 0, 0.3] }), // Kerbe außen
      p('box', [0.75, 1.5, 0.34], F, { p: [-2.0, 12.0, 3.55], r: [0.12, 0, 0.16] }), // Kerbe innen
    ], matBody);
    fig.add(torso);

    // Lange Brocken-Arme (Reichweite grob wie bei Ivus) mit Klauen-Händen aus
    // drei Eiszapfen – schwingen beim Überkopfschlag frei an Krone und Kamm vorbei.
    const iceArm = (side) => [
      p('oct', [2.1, 0], C.ice, { p: [side * 5.2, 13.2, 0.2], s: [1, 1.6, 1], jitter: 0.18 }), // Oberarm
      p('oct', [1.7, 0], C.iceBright, { p: [side * 5.5, 10.4, 0.6], jitter: 0.18 }), // Ellbogen
      p('oct', [1.8, 0], C.ice, { p: [side * 5.6, 8.4, 0.9], s: [1, 1.5, 1], jitter: 0.18 }), // Unterarm
      p('oct', [1.6, 0], C.iceBright, { p: [side * 5.6, 6.2, 1.2], jitter: 0.18 }), // Handbrocken
      p('cone', [0.5, 2.6, 4], C.iceBright, { p: [side * 4.8, 4.6, 1.6], r: [Math.PI - 0.3, 0, side * 0.15] }), // Klauen
      p('cone', [0.55, 3.0, 4], C.iceBright, { p: [side * 5.7, 4.4, 1.4], r: [Math.PI - 0.2, 0, -side * 0.1] }),
      p('cone', [0.5, 2.4, 4], C.iceBright, { p: [side * 6.4, 4.7, 1.0], r: [Math.PI - 0.25, 0, -side * 0.35] }),
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
    // PROTOTYP: Bei aktivem Flag bekommen Trupps mit passendem GLB-Slot statt
    // der handgebauten Figur einen leeren Wrapper, in den (sobald geladen) der
    // Modell-Klon gehängt wird. Je Fraktion+Trupptyp ein Modell; der rote
    // Boss Lokholar nutzt den Yeti-Slot, Ivus (blau) bleibt immer handgebaut.
    // Ohne Flag ist useModel konstant false → alter Pfad.
    const modelSlot = key === 'ally' ? (g.faction === 'red' ? 'lokholar' : null) : key;
    const useModel = USE_MODELS && !modelsFailed && modelSlot !== null;
    let fig;
    let parts = null;
    if (useModel) {
      fig = new THREE.Group();
      fig.rotation.order = 'YXZ'; // wie die Template-Figuren (updateDead kippt um z)
    } else {
      fig = templateFor(key, g.faction).clone();
      parts = {
        torso: fig.getObjectByName('torso'),
        armL: fig.getObjectByName('armL'),
        armR: fig.getObjectByName('armR'),
        legL: fig.getObjectByName('legL'),
        legR: fig.getObjectByName('legR'),
      };
    }
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
      // PROTOTYP: Felder des GLB-Pfads (ohne Flag dauerhaft false/null).
      useModel,
      modelKey: key, // Rig-/Template-Schlüssel (für den handgebauten Fallback)
      modelSlot, // GLB-Slot in unitModels ('light'|'medium'|'heavy'|'lokholar')
      modelFaction: g.faction,
      mixer: null,
      actions: null,
      currentAction: null,
      deathClipPlaying: false,
    };
    records.set(g, rec);
    group.add(fig);
    if (useModel && unitModels) attachModel(rec);
    return rec;
  }

  function resetAll() {
    for (const rec of records.values()) {
      if (rec.mixer) rec.mixer.stopAllAction(); // PROTOTYP
      group.remove(rec.fig);
    }
    records.clear();
  }

  // ---------------------------------------------- PROTOTYP: Modell-Animation
  // Ersetzt für GLB-Trupps die prozeduralen Teilrotationen durch Clip-Auswahl
  // nach Sim-Zustand, mit weichen Überblendungen (~0.2 s). Läuft der Mixer
  // noch nicht (Modelle laden gerade), passiert nichts – der Wrapper ist leer.
  // Rückgabe immer 0: kein prozedurales Wippen für Modell-Figuren.
  function applyModelPose(rec, g, dt) {
    if (!rec.mixer) return 0;
    const A = rec.actions;
    let role;
    let timeScale = 1;
    if (g.fighting) {
      role = 'attack';
      // Schlagrhythmus grob an das Angriffsintervall der Sim koppeln.
      if (A.attack) {
        const iv = Math.max(0.25, g.attackInterval || 1);
        timeScale = A.attack.getClip().duration / iv;
      }
    } else if (rec.speed / rec.rig.speedRef > 0.04) {
      role = A.walk ? 'walk' : 'run';
      // Basis 1.0 bei speedRef – die Schrittfrequenz folgt der Geschwindigkeit.
      timeScale = Math.min(1.8, Math.max(0.4, rec.speed / rec.rig.speedRef));
    } else if (g.state === 'defending') {
      role = 'block';
    } else {
      role = 'idle';
    }
    const action = A[role] ?? A.idle ?? null;
    if (action && action !== rec.currentAction) {
      if (rec.currentAction) rec.currentAction.fadeOut(0.2);
      action.reset().fadeIn(0.2).play();
      // Desynchronisation: Loop-Posen (Idle/Walk/Block) starten zufällig
      // versetzt im Zyklus, damit nicht alle Figuren synchron atmen/laufen.
      // Attacken bleiben bei 0 – sie takten über timeScale aufs Intervall.
      if (role !== 'attack') action.time = Math.random() * action.getClip().duration;
      rec.currentAction = action;
    }
    if (action) action.timeScale = timeScale;
    rec.mixer.update(dt);
    return 0;
  }

  // --------------------------------------------------------------- Posen
  // Liefert den vertikalen Wipp-Anteil; alle Teilrotationen werden komplett
  // neu gesetzt (kein Aufaddieren, damit nichts wegdriftet).
  function applyPose(rec, g, time, simT, dt) {
    // PROTOTYP: GLB-Trupps haben keine benannten Teile → Clip-Pfad.
    if (rec.useModel) return applyModelPose(rec, g, dt);
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
      // PROTOTYP: liegengebliebenen Death-Clip verwerfen, Animation neu starten.
      if (rec.mixer) {
        rec.mixer.stopAllAction();
        rec.currentAction = null;
        rec.deathClipPlaying = false;
      }
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

    const bob = applyPose(rec, g, time, simT, dt);

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
  function updateDead(rec, time, dt) {
    rec.seen = frameId;
    if (rec.mode === 'hidden') return;
    if (rec.mode === 'live') {
      rec.mode = 'dying';
      rec.dieAt = time;
      rec.ui.visible = false;
      rec.pulse.visible = false;
      // PROTOTYP: Gibt es einen Death-Clip, spielt der statt des Umkippens
      // (LoopOnce/clampWhenFinished ist in attachModel gesetzt).
      rec.deathClipPlaying = false;
      if (rec.mixer && rec.actions?.death) {
        if (rec.currentAction) rec.currentAction.fadeOut(0.15);
        rec.actions.death.reset().fadeIn(0.15).play();
        rec.currentAction = rec.actions.death;
        rec.deathClipPlaying = true;
      }
    }
    const k = Math.min(1, (time - rec.dieAt) / 1.0);
    if (rec.deathClipPlaying) {
      rec.mixer.update(dt); // Umkippen entfällt, das Versinken unten bleibt
    } else {
      rec.fig.rotation.z = rec.fallSide * k * k * 1.45;
    }
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
        if (rec) updateDead(rec, time, dt);
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
    disposed = true; // PROTOTYP: noch laufende GLB-Ladevorgänge ins Leere laufen lassen
    resetAll();
    if (unitModels && modelsApi) {
      modelsApi.disposeUnitModels(unitModels); // PROTOTYP: Template-Ressourcen der GLBs
      unitModels = null;
    }
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
