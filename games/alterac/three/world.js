// Gemeinsame Grundlagen des 3D-Modus: Koordinaten, Stilfarben, Zufall.
//
// Koordinatensystem: Die 2D-Karte (map.js) misst 480×960 in „Kartenpixeln",
// x nach Osten, y nach Süden. Die 3D-Welt benutzt DIESELBEN Zahlen als
// Weltmeter, nur zentriert und mit y→z: worldX = x − 240, worldZ = y − 480,
// Y zeigt nach oben. Norden (Frostwolf) liegt bei −z, Süden (Sturmlanze)
// bei +z. Alles, was `edgePoint`/`map.nodes` liefert, wandert also ohne
// Maßstabsrechnung über `toWorld` in die Szene.

export const MAP_W = 480;
export const MAP_H = 960;

// Kartenkoordinate (x, y) → Weltposition (x, z). `heightAt` liefert das
// Terrain-Y an dieser Stelle (siehe terrain3d.js).
export function toWorldX(x) {
  return x - MAP_W / 2;
}
export function toWorldZ(y) {
  return y - MAP_H / 2;
}

// Deterministischer Zufall (Mulberry32) – Dekoration und Geometrie sollen bei
// jedem Laden identisch aussehen, deshalb kein Math.random in Aufbau-Code.
export function seededRand(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ Stilkanon
// Düstere Abenddämmerung im verschneiten Alteractal: kaltes Blaugrau als
// Grundton, warme Feuerakzente nur an bemannten Bauwerken. Alle Module lesen
// ihre Farben hier, damit die Szene aus einem Guss bleibt.
export const PALETTE = {
  // Licht & Himmel
  skyTop: 0x131a2e,
  skyHorizon: 0x3d4a6b,
  fog: 0x353f60,
  moonlight: 0xaec2ea, // kaltes Hauptlicht (tief stehender Mond)
  ambientSky: 0x4a5878,
  ambientGround: 0x39415a,
  fireLight: 0xff9a3d, // warme Akzente (Feuerschalen, Fenster)

  // Gelände
  snowHigh: 0xdde6f2,
  snowLow: 0xb8c6dc,
  snowShadow: 0x9dabc9,
  rock: 0x757e96,
  rockDark: 0x565e76, // bewusst über der ACES-Absauf-Schwelle (~0x50), sonst saufen Schattenflanken schwarz ab
  path: 0x9aa3b8, // festgetretener Schnee der Wege
  ice: 0xa9cbe8,
  pine: 0x31504a,
  pineDark: 0x263e38,
  trunk: 0x584740,

  // Bauwerke
  stone: 0x8b92a8,
  stoneDark: 0x6a7288,
  woodDark: 0x66554a,
  roof: 0x5d6480,
  ember: 0xffb75e,

  // Fraktionen (aus map.js FACTIONS abgeleitet, hier als Hex-Zahl)
  blue: 0x5b9cff,
  blueDark: 0x2c5aa8,
  red: 0xff6b5e,
  redDark: 0xa63a31,
  gold: 0xffd76a,
};

// Fraktionsfarben als { blue, red } für Schleifen.
export const FACTION_COLOR = { blue: PALETTE.blue, red: PALETTE.red };
export const FACTION_DARK = { blue: PALETTE.blueDark, red: PALETTE.redDark };

// ---------------------------------------------------------------- Leistungsbudget
// Zielgerät ist ein iPad (ab ca. A12). Richtwerte für alle Module:
//  - Szene gesamt ≤ ~150 000 Dreiecke, Draw-Calls ≤ ~80
//  - Wiederholte Objekte (Bäume, Felsen, Gräber) als InstancedMesh
//  - Materialien: MeshLambertMaterial/MeshStandardMaterial mit flatShading
//    und Vertex-Farben; KEINE Per-Frame-Geometrie-Neuerzeugung
//  - Texturen ≤ 1024 px; höchstens 2–3 Punktlichter in der ganzen Szene
export const QUALITY = {
  maxPixelRatio: 1.75,
  shadowMapSize: 2048,
  snowParticles: 1400,
};
