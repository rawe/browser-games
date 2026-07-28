// Optionale Bild-Texturen des 3D-Modus.
//
// Alle Dateien unter assets/3d/ sind REIN KOSMETISCH und dürfen fehlen –
// jedes Modul muss ohne sie funktionieren (Vertex-Farben bzw. prozedural
// gebackene Canvas-Texturen). Liegt eine Datei vor, wird sie über Vite
// mitgebündelt und hier nachgeladen; `getTexture` liefert sonst null.
//
// Die Promptdaten zum Erzeugen der Bilder stehen in prompt-3d-texturen.md.
// Erwartete Dateien (Name = Schlüssel für getTexture):
//   sky-dusk.webp     2048×1024, äquirektangulärer Dämmerungshimmel
//   snow.webp         512×512, kachelbar, Schneefläche
//   rock.webp         512×512, kachelbar, Felswand mit Schneeresten
//   path.webp         512×512, kachelbar, festgetretener Schnee/Erde
//   stone-wall.webp   512×512, kachelbar, Festungsmauerwerk
//   wood-dark.webp    512×512, kachelbar, dunkles Bohlenholz
//   banner-blue.webp  256×512, Bannertuch Sturmlanze
//   banner-red.webp   256×512, Bannertuch Frostwolf

import * as THREE from 'three';

// Nur tatsächlich vorhandene Dateien landen im Glob – fehlende Assets sind
// damit kein Build- oder Ladefehler, sondern schlicht `null`.
const FILES = import.meta.glob('../assets/3d/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const loader = new THREE.TextureLoader();
const cache = new Map();

function urlFor(name) {
  for (const [path, url] of Object.entries(FILES)) {
    if (path.endsWith(`/${name}.webp`)) return url;
  }
  return null;
}

// HTMLImageElement einer Asset-Datei als Promise – für Canvas-Bakes, die das
// Bild selbst zeichnen (z. B. als CanvasPattern) statt es als THREE.Texture zu
// nutzen. Löst mit null auf, wenn die Datei fehlt oder nicht lädt; das Promise
// wird gecacht, jede Datei lädt also höchstens einmal.
const imageCache = new Map();

export function loadImage(name) {
  if (imageCache.has(name)) return imageCache.get(name);
  const url = urlFor(name);
  const promise = !url
    ? Promise.resolve(null)
    : new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
  imageCache.set(name, promise);
  return promise;
}

// Texture oder null. Kachelbare Texturen bekommen RepeatWrapping; der
// Aufrufer setzt repeat/colorSpace-Feinheiten selbst, sRGB ist Standard.
export function getTexture(name, { repeat = true } = {}) {
  if (cache.has(name)) return cache.get(name);
  const url = urlFor(name);
  let tex = null;
  if (url) {
    tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
  }
  cache.set(name, tex);
  return tex;
}
