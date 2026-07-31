// Untergrund der Rennstrecken: die Grasnarbe samt Erdflecken.
//
// Reihenfolge beim Backen (`bakeTrack` in `render.js`): `paintGrass` zuerst
// über die gesamte Weltfläche, erst danach Fahrbahn, Randsteine und
// Start-/Zielfeld darüber. Das Modul kennt die Streckenform nicht und darf
// nichts über sie annehmen – es füllt schlicht die ganze Welt.
//
// Optik: ein dichtes Schachbrett aus 4-px-Zellen in den fünf GRASS-Tönen,
// dazwischen seltene Lichtpunkte, noch seltenere Trockenhalme und verstreute,
// ausgefranste Erdnester.

import { GRASS, GRASS_ACCENT, GRASS_DRY, DIRT, DIRT_CORE } from './palette.js';

/** Kantenlänge einer Narbenzelle. Zentral, weil die gesamte Optik daran hängt. */
const CELL = 4;

/** Anteil der Zellen mit hellem Lichtpunkt bzw. mit trockenem Halm-Nest. */
const ACCENT_RATE = 0.009;
const DRY_SEED_RATE = 0.0008;

/** Anzahl der Erdflecken auf der ganzen Weltfläche. */
const DIRT_MIN = 22;
const DIRT_SPAN = 10;

/**
 * Kantenlänge einer Zelle des groben Helligkeitsfeldes. Ohne dieses Feld ist
 * die Narbe überall gleich stark verrauscht und wirkt wie Bildrauschen; der
 * Teaser hat deutlich hellere und dunklere Wiesenpartien. Das Feld verschiebt
 * nur die Tonauswahl, die Zellkanten bleiben hart – der Pixel-Look bleibt.
 */
const FIELD = 160;

/* ---------------- Hilfsmittel ---------------- */

/** Deterministischer LCG. Math.random ist tabu – gleicher Seed, gleiches Bild. */
function makeRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Grobes Helligkeitsfeld über die Welt, bilinear geglättet. Werte um 0 herum;
 * positive Bereiche wählen hellere Grastöne, negative dunklere.
 */
function makeField(world, rnd) {
  const n = Math.ceil(world / FIELD) + 2;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;

  return (x, y) => {
    const fx = x / FIELD;
    const fy = y / FIELD;
    const ix = Math.min(n - 2, fx | 0);
    const iy = Math.min(n - 2, fy | 0);
    const tx = fx - ix;
    const ty = fy - iy;
    // Glättung, damit keine sichtbaren Feldkanten entstehen.
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = grid[iy * n + ix];
    const b = grid[iy * n + ix + 1];
    const c = grid[(iy + 1) * n + ix];
    const d = grid[(iy + 1) * n + ix + 1];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Farben als fertige 32-Bit-Werte, damit das Zellraster über eine Uint32-Sicht
 * auf den Pixelpuffer geschrieben werden kann – vier Mal weniger Schreibzugriffe
 * als byteweise. Die Bytereihenfolge muss dafür zur Maschine passen.
 */
function packer() {
  const little = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
  return (hex) => {
    const [r, gr, b] = hexToRgb(hex);
    return little
      ? ((255 << 24) | (b << 16) | (gr << 8) | r) >>> 0
      : ((r << 24) | (gr << 16) | (b << 8) | 255) >>> 0;
  };
}

/* ---------------- Grasnarbe ---------------- */

/**
 * Malt die komplette Weltfläche als Grasnarbe mit Erdflecken.
 *
 * @param {CanvasRenderingContext2D} g Zielkontext (Offscreen-Canvas world×world)
 * @param {number} world Kantenlänge der Welt in Pixeln
 * @param {number} seed Startwert des PRNG – gleicher Seed ergibt exakt dasselbe Bild
 */
export function paintGrass(g, world, seed = 7) {
  const rnd = makeRng(seed);
  const pack = packer();
  const grass = GRASS.map(pack);
  const accent = GRASS_ACCENT.map(pack);
  const dry = GRASS_DRY.map(pack);

  const field = makeField(world, rnd);
  const cols = Math.ceil(world / CELL);
  const rows = Math.ceil(world / CELL);
  const mid = (GRASS.length - 1) / 2;

  const img = g.createImageData(world, world);
  const px = new Uint32Array(img.data.buffer);

  // Tonindex der darüberliegenden Zellreihe – nötig, damit keine Zelle den
  // gleichen Ton wie ihr oberer oder linker Nachbar bekommt.
  const above = new Uint8Array(cols);
  // Wie viele Zellen der aktuellen Reihe noch Trockenhalm bleiben (Nester aus 1–2 Zellen).
  let dryRun = 0;
  let left = 255;

  for (let cy = 0; cy < rows; cy++) {
    const y0 = cy * CELL;
    const rowStart = y0 * world;
    dryRun = 0;
    left = 255;

    for (let cx = 0; cx < cols; cx++) {
      const x0field = cx * CELL;
      // Grundton aus dem groben Feld, darum herum streut die einzelne Zelle.
      let tone = Math.round(mid + field(x0field, y0) * 1.4 + (rnd() - 0.5) * 2.6);
      if (tone < 0) tone = 0;
      if (tone >= GRASS.length) tone = GRASS.length - 1;
      // Nachbarkollisionen nur meist auflösen: ein paar gleichfarbige Nester
      // sind im Teaser vorhanden und nehmen der Fläche das Flimmern.
      if ((tone === left || tone === above[cx]) && rnd() < 0.6) {
        let shift = 1 + ((rnd() * (GRASS.length - 1)) | 0);
        for (let tries = 0; tries < GRASS.length; tries++) {
          const cand = (tone + shift) % GRASS.length;
          if (cand !== left && cand !== above[cx]) { tone = cand; break; }
          shift++;
        }
      }
      above[cx] = tone;
      left = tone;

      let color = grass[tone];
      if (dryRun > 0) {
        dryRun--;
        color = dry[(rnd() * dry.length) | 0];
      } else {
        const r = rnd();
        if (r < DRY_SEED_RATE) {
          color = dry[(rnd() * dry.length) | 0];
          dryRun = rnd() < 0.55 ? 1 : 0;
        } else if (r < DRY_SEED_RATE + ACCENT_RATE) {
          color = accent[(rnd() * accent.length) | 0];
        }
      }

      const x0 = cx * CELL;
      px.fill(color, rowStart + x0, rowStart + Math.min(x0 + CELL, world));
    }

    // Die fertige Pixelzeile auf die restlichen Zeilen der Zelle kopieren.
    const lastRow = Math.min(y0 + CELL, world);
    for (let y = y0 + 1; y < lastRow; y++) {
      px.copyWithin(y * world, rowStart, rowStart + world);
    }
  }

  g.putImageData(img, 0, 0);
  paintDirt(g, world, rnd);
}

/* ---------------- Erdflecken ---------------- */

/**
 * Streut ausgefranste Erdnester über die Fläche. Sie kommen bewusst nach dem
 * `putImageData`, damit der teure Pixelpuffer nur einmal geschrieben wird; die
 * paar tausend Zellen hier sind als normale `fillRect`-Aufrufe billig genug.
 */
function paintDirt(g, world, rnd) {
  const count = DIRT_MIN + ((rnd() * DIRT_SPAN) | 0);

  for (let i = 0; i < count; i++) {
    const cxWorld = rnd() * world;
    const cyWorld = rnd() * world;
    // Auf Spielzoom waren Flecken mit 24–60 px kaum mehr als Punkte.
    const radius = 16 + rnd() * 26; // Durchmesser ca. 32–84 px

    // Mehrere überlappende Klumpen ergeben eine organische, nicht runde Form.
    const lobes = [];
    const lobeCount = 3 + ((rnd() * 3) | 0);
    for (let l = 0; l < lobeCount; l++) {
      const ang = rnd() * Math.PI * 2;
      const dist = l === 0 ? 0 : rnd() * radius * 0.45;
      lobes.push({
        x: cxWorld + Math.cos(ang) * dist,
        y: cyWorld + Math.sin(ang) * dist,
        r: radius * (0.55 + rnd() * 0.3),
      });
    }

    drawPatch(g, world, rnd, lobes, radius);
  }
}

/** Rastert einen Fleck in dieselben 4-px-Zellen wie das Gras und füllt ihn. */
function drawPatch(g, world, rnd, lobes, radius) {
  // Klumpen sitzen versetzt, der Saum reicht darüber hinaus – Rahmen großzügig.
  const reach = radius * 1.7;
  const cx0 = Math.max(0, Math.floor((lobes[0].x - reach) / CELL));
  const cy0 = Math.max(0, Math.floor((lobes[0].y - reach) / CELL));
  const cx1 = Math.min(Math.ceil(world / CELL), Math.ceil((lobes[0].x + reach) / CELL));
  const cy1 = Math.min(Math.ceil(world / CELL), Math.ceil((lobes[0].y + reach) / CELL));

  for (let cy = cy0; cy < cy1; cy++) {
    const py = cy * CELL + CELL / 2;
    let runStart = -1;
    let runColor = '';

    for (let cx = cx0; cx < cx1; cx++) {
      const pxc = cx * CELL + CELL / 2;

      // Kleinster relativer Abstand zu einem der Klumpen bestimmt die Zugehörigkeit.
      let m = Infinity;
      for (let l = 0; l < lobes.length; l++) {
        const dx = pxc - lobes[l].x;
        const dy = py - lobes[l].y;
        const d = Math.sqrt(dx * dx + dy * dy) / lobes[l].r;
        if (d < m) m = d;
      }

      // Weicher Saum: der Rand franst zellweise aus statt sauber zu schließen.
      let inside = m < 0.85;
      if (!inside && m < 1.12) inside = rnd() < (1.12 - m) / 0.27;

      let color = '';
      if (inside) {
        if (m < 0.34) color = DIRT_CORE;
        else if (m < 0.48 && rnd() < 0.5) color = DIRT_CORE;
        else color = DIRT[(rnd() * DIRT.length) | 0];
      }

      // Gleichfarbige Nachbarzellen zu einem Rechteck zusammenfassen.
      if (color !== runColor) {
        if (runColor) {
          g.fillStyle = runColor;
          g.fillRect(runStart * CELL, cy * CELL, (cx - runStart) * CELL, CELL);
        }
        runColor = color;
        runStart = cx;
      }
    }

    if (runColor) {
      g.fillStyle = runColor;
      g.fillRect(runStart * CELL, cy * CELL, (cx1 - runStart) * CELL, CELL);
    }
  }
}
