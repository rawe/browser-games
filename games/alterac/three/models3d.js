// Kuratierte GLB-Charaktermodelle – die Standardbesetzung der Trupps im
// 3D-Modus (units3d.js). Das Modul wird von units3d.js dynamisch nachgeladen;
// mit `?models=0` (siehe USE_MODELS dort) unterbleibt der Import, dann werden
// die GLBs nie angefragt und alle Trupps bleiben handgebaut.
//
// Quellen (alle CC0), je Fraktion+Trupptyp ein Modell:
//   Rogue.glb     – KayKit „Adventurers",
//                   github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//                   (blau/leicht)
//   Knight.glb    – ebenda (blau/mittel)
//   Barbarian.glb – ebenda (blau/schwer)
//   Goblin.glb    – Quaternius, poly.pizza/m/OdCOFSmEhl (rot/leicht)
//   Orc.glb       – Quaternius, poly.pizza/m/5vO2YJsPEf (rot/mittel)
//   Giant.glb     – Quaternius, poly.pizza/m/BldaiPtyJa (rot/schwer)
//   Yeti.glb      – Quaternius, poly.pizza/m/xtMYEVzyw0 (Boss Lokholar, rot)
// Für Ivus (blauer Boss) gibt es bewusst KEIN Modell – er bleibt handgebaut,
// der Slot existiert in SOURCES nicht.
//
// Clip-Benennung (verifiziert):
//   * KayKit (Rogue/Knight/Barbarian): 76 Clips ohne Präfix, u. a. Idle,
//     Walking_A, Running_A, Blocking, Death_A sowie waffenspezifische
//     Attacken – die bevorzugte Attacke steht je Modell in SOURCES.
//   * Quaternius (Goblin/Giant/Yeti): 7 Clips mit Präfix
//     „EnemyArmature|EnemyArmature|EnemyArmature|" (Attack, Death,
//     HitRecieve, Idle, Jump, Run, Walk). KEIN Block-Clip – pickClips
//     liefert dafür null, units3d fällt auf Idle zurück.
//   * Orc.glb weicht ab: Präfix „CharacterArmature|" mit Idle/Walk/Run/
//     Punch/Weapon/Death – „Weapon" ist dessen Waffenangriff.
//
// Annahmen (nach Sichtung der GLB-Metadaten, ggf. hier korrigieren):
//   * Alle Modelle blicken nach +z (glTF-Konvention). Darum keine
//     Wrapper-Rotation – falls ein Modell doch falsch herum steht: in
//     SOURCES ein `yaw` am betroffenen Eintrag setzen.
//   * Füße stehen nach dem Versatz um -box.min.y auf y=0.
//   * Höhe wird per Box3 am geladenen Template gemessen (in three r185 ist
//     Box3.setFromObject skinning-bewusst) und je Slot auf die Zielhöhe
//     skaliert – Skalierung sitzt am Wrapper, nie am Modell selbst.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Zielhöhen in Welteinheiten je Modell-Slot: light/medium/heavy angelehnt an
// die handgebauten Figuren (Späher ~11, Soldat ~13.3, Koloss ~15.5); der Yeti
// tritt als Boss Lokholar in ~Ivus-Größe an (~22, wie die handgebaute Figur).
export const TARGET_HEIGHT = { light: 11, medium: 13.3, heavy: 15.5, lokholar: 22 };

// Je Fraktion die Trupptyp-Slots (blau ohne Boss-Slot – Ivus bleibt
// handgebaut). `attack` sind die bevorzugten Attack-Clips (Kleinschreibung,
// exakter Basisname nach FBX-Präfix) passend zur getragenen Waffe; pickClips
// hängt die generischen Kandidaten hinten an. `recolor` markiert die
// KayKit-Modelle, deren rote Stoff-Texel für die blaue Fraktion per
// Hue-Rotation nach Blau geschoben werden (s. redToBlueTexture).
const SOURCES = {
  blue: {
    light: {
      url: new URL('../assets/3d/units/Rogue.glb', import.meta.url).href,
      label: 'Rogue',
      attack: ['dualwield_melee_attack_slice', 'dualwield_melee_attack_stab'],
      recolor: true,
    },
    medium: {
      url: new URL('../assets/3d/units/Knight.glb', import.meta.url).href,
      label: 'Knight',
      attack: ['1h_melee_attack_slice_diagonal'],
      recolor: true,
    },
    heavy: {
      url: new URL('../assets/3d/units/Barbarian.glb', import.meta.url).href,
      label: 'Barbarian',
      attack: ['2h_melee_attack_chop'],
      recolor: true,
    },
  },
  red: {
    light: {
      url: new URL('../assets/3d/units/Goblin.glb', import.meta.url).href,
      label: 'Goblin',
      attack: ['attack'],
    },
    medium: {
      url: new URL('../assets/3d/units/Orc.glb', import.meta.url).href,
      label: 'Orc',
      attack: ['weapon', 'punch'],
    },
    heavy: {
      url: new URL('../assets/3d/units/Giant.glb', import.meta.url).href,
      label: 'Giant',
      attack: ['attack'],
    },
    lokholar: {
      url: new URL('../assets/3d/units/Yeti.glb', import.meta.url).href,
      label: 'Yeti',
      attack: ['attack'],
    },
  },
};

// Lädt alle GLBs parallel und misst sie einmalig aus.
// → Promise auf { blue: {light,medium,heavy}, red: {light,medium,heavy,lokholar} }
//   mit entry = { scene, clips, height, minY, faction, label, attack, yaw }.
// Ein einzelner Fehlschlag reißt nicht alles: der betroffene Slot bleibt
// leer (undefined), units3d fällt dort auf die handgebaute Figur zurück.
export async function loadUnitModels() {
  const loader = new GLTFLoader();
  const models = { blue: {}, red: {} };
  const jobs = [];
  for (const faction of Object.keys(SOURCES)) {
    for (const [slot, src] of Object.entries(SOURCES[faction])) {
      jobs.push(
        loader
          .loadAsync(src.url)
          .then((gltf) => {
            models[faction][slot] = prepare(faction, src, gltf);
          })
          .catch((err) => {
            console.warn(
              `[models3d] ${src.label} (${faction}/${slot}) konnte nicht laden – betroffene Trupps nutzen die handgebaute Figur.`,
              err
            );
          })
      );
    }
  }
  await Promise.all(jobs);
  return models;
}

function prepare(faction, src, gltf) {
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      // Skinned Meshes nicht cullen: bei den Quaternius-Rigs ist die
      // Bind-Geometrie winzig (Skalierung steckt in der Armature), das
      // Culling griffe sonst daneben.
      if (o.isSkinnedMesh) o.frustumCulled = false;
    }
  });
  // Blaue Fraktion: rote Stoff-Texel der KayKit-Atlanten nach Blau schieben –
  // einmalig pro Template, die Klone teilen sich das Material.
  if (src.recolor) recolorMaterials(scene);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const ok = Number.isFinite(size.y) && size.y > 1e-4;
  const entry = {
    scene,
    clips: gltf.animations ?? [],
    height: ok ? size.y : 1,
    minY: ok ? box.min.y : 0,
    faction,
    label: src.label,
    attack: src.attack ?? [],
    yaw: src.yaw ?? 0,
  };
  return entry;
}

// ---------------------------------------------- Fraktionsfärbung Blau
// Die KayKit-Figuren tragen ROTE Stoffelemente (Wappenrock/Kleidung im
// Textur-Atlas) – für die blaue Fraktion irreführend. Da je Figur nur EIN
// Material mit EINER Atlas-Textur existiert, werden die eindeutig roten
// Texel gezielt umgefärbt (Sättigung/Helligkeit bleiben erhalten):
//   * Rot-Fenster: Hue ≤ 14° oder ≥ 348°, Sättigung ≥ 0.40, Wert ≥ 40 –
//     Haut (~28°), Leder/Holz (~20–35°) und graue Metalle bleiben unberührt.
//   * Ziel-Hue 222° (Allianz-Blau), Sättigung gedeckelt auf 0.8; der Wert
//     bekommt eine Untergrenze von 0x58, denn unter dem rein kalten
//     Nachtlicht + ACES-Tone-Mapping säuft alles unter ~0x50/Kanal zu
//     Schwarz ab (siehe Kommentare in world.js/units3d.js).
function recolorMaterials(scene) {
  const seenMats = new Set();
  const texCache = new Map(); // Original-Textur → umgefärbte CanvasTexture
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seenMats.has(m)) continue;
      seenMats.add(m);
      if (!m.map) continue;
      let tex = texCache.get(m.map);
      if (!tex) {
        tex = redToBlueTexture(m.map);
        texCache.set(m.map, tex);
      }
      if (tex !== m.map) {
        const old = m.map;
        m.map = tex;
        m.needsUpdate = true;
        old.dispose(); // Original wird nirgends mehr referenziert
      }
    }
  });
}

// Zeichnet das Textur-Bild auf ein Canvas, färbt rote Texel um und liefert
// eine CanvasTexture mit identischen colorSpace/flipY/Filter-Einstellungen
// (die Hue-Mathematik läuft direkt auf den sRGB-Bytes – für die
// Fensterprüfung und Rotation völlig ausreichend).
function redToBlueTexture(texture) {
  const img = texture.image;
  if (!img || !img.width || !img.height) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  // Ziel-Hue 222° liegt im HSV-Sektor 3 (180°–240°), f = 222/60 - 3 = 0.7:
  // → r = v·(1-s), g = v·(1-0.7·s), b = v.
  const F = 222 / 60 - 3;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40) continue; // fast Schwarz – kein lesbares Rot
    const sat = (max - min) / max;
    if (sat < 0.4) continue; // zu blass: Grau/Metall/helle Haut
    const d = max - min;
    let hue = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
    hue = (hue * 60 + 360) % 360;
    if (hue > 14 && hue < 348) continue; // nur eindeutiges Rot anfassen
    const v = Math.max(max, 0x58); // ACES-Untergrenze, s. Kopfkommentar
    const s = Math.min(sat, 0.8);
    px[i] = Math.round(v * (1 - s));
    px[i + 1] = Math.round(v * (1 - s * F));
    px[i + 2] = Math.round(v);
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = texture.colorSpace;
  out.flipY = texture.flipY;
  out.wrapS = texture.wrapS;
  out.wrapT = texture.wrapT;
  out.magFilter = texture.magFilter;
  out.minFilter = texture.minFilter;
  out.generateMipmaps = texture.generateMipmaps;
  out.anisotropy = texture.anisotropy;
  out.needsUpdate = true;
  return out;
}

// Klont ein Template (SkeletonUtils, damit das Skelett mitkommt) und packt es
// in einen Wrapper: Skalierung auf Zielhöhe, Füße auf y=0, Blick nach +z.
// Der zurückgegebene Wrapper ist das Animations-Root für den AnimationMixer.
export function cloneModel(entry, targetHeight) {
  const model = SkeletonUtils.clone(entry.scene);
  model.position.y = -entry.minY;
  const wrapper = new THREE.Group();
  wrapper.name = 'glbModel';
  wrapper.scale.setScalar((targetHeight ?? TARGET_HEIGHT.medium) / entry.height);
  wrapper.rotation.y = entry.yaw ?? 0;
  wrapper.add(model);
  return wrapper;
}

// Ordnet den Rollen des Posen-Codes je einen AnimationClip zu. Zwei Pässe:
// erst exakte Namen (nach FBX-Präfix „Armature|…" getrennt), dann
// case-insensitive Teilstrings – deckt KayKit- und Quaternius-Benennung ab.
// `preferredAttack` (aus entry.attack) sind die waffenpassenden Kandidaten
// des jeweiligen Modells; die generische Liste hängt dahinter.
export function pickClips(clips, preferredAttack = []) {
  const lower = clips.map((c) => c.name.toLowerCase());
  const find = (candidates) => {
    for (const cand of candidates) {
      for (let i = 0; i < clips.length; i++) {
        const n = lower[i];
        const base = n.includes('|') ? n.slice(n.lastIndexOf('|') + 1) : n;
        if (base === cand) return clips[i];
      }
    }
    for (const cand of candidates) {
      for (let i = 0; i < clips.length; i++) {
        if (lower[i].includes(cand)) return clips[i];
      }
    }
    return null;
  };
  return {
    idle: find(['idle']),
    walk: find(['walking_a', 'walk']),
    run: find(['running_a', 'run']),
    attack: find([...preferredAttack, 'attack', 'slash', 'punch', 'weapon']),
    block: find(['blocking', 'block']),
    death: find(['death_a', 'death', 'die']),
  };
}

// Gibt die GPU-Ressourcen der Template-Szenen frei. Die Klone teilen sich
// Geometrien/Materialien mit den Templates, damit ist alles abgedeckt
// (inklusive der umgefärbten CanvasTextures, die als material.map hängen).
export function disposeUnitModels(models) {
  if (!models) return;
  for (const slots of Object.values(models)) {
    for (const entry of Object.values(slots)) {
      entry.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          for (const key of Object.keys(m)) {
            const v = m[key];
            if (v && v.isTexture) v.dispose();
          }
          m.dispose();
        }
      });
    }
  }
}
