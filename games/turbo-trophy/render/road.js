// Fahrbahn auf die gebackene Streckengrafik malen: Randstein mit Bevel,
// brauner Saum, gefleckter Asphalt, abgefahrene Mittellinie und Start-/Zielfeld.
//
// Schichtreihenfolge quer zur Fahrbahn, von außen nach innen – und genau in
// dieser Reihenfolge auch gezeichnet, weil jeder Stroke breit beginnt und der
// nächste seinen Innenteil wieder überdeckt:
//   Randstein (breitester Stroke) → brauner Saum → Asphalt → Mittellinie →
//   Start-/Zielfeld.
//
// Das Modul malt keinen Untergrund. Es muss NACH der Grasfläche aufgerufen
// werden, sonst fehlt außerhalb des Randsteins alles.
//
// Alle Zufallsanteile (Asphaltflecken, Abnutzung der Mittellinie) stammen aus
// einem aus der Streckenform abgeleiteten Seed: gleiche Strecke ⇒ gleiches Bild,
// auch nach einem Neustart oder im Editor.

import {
  ASPHALT,
  KERB_RED,
  KERB_RED_DARK,
  KERB_WHITE,
  KERB_WHITE_DARK,
  KERB_EDGE,
  LANE_LINE,
  CHECKER_LIGHT,
  CHECKER_DARK,
} from './palette.js';
import { ROAD_WIDTH } from '../trackGeometry.js';

const TAU = Math.PI * 2;
const HALF_ROAD = ROAD_WIDTH / 2;

// Die folgenden Maße sind aus einem Querschnitt durch das Titelbild abgeleitet:
// dort liegen 288 px Asphalt, 17,5 px Randstein, 5 px brauner Saum, 11 px
// Mittellinie und rund 30 px Blocklänge nebeneinander. Umgerechnet auf
// ROAD_WIDTH sind das die Anteile 6,1 % / 1,7 % / 3,8 % / 10 %.

/** Randsteinbreite quer zur Fahrbahn. */
const KERB_WIDTH = 6;
/** Innerer, abgedunkelter Anteil jedes Randsteinblocks – erzeugt die Fase. */
const KERB_BEVEL = 2.2;
/** Länge eines Randsteinblocks; rot und cremeweiß wechseln sich ab. */
const KERB_BLOCK = 10;
/** Brauner Saum (Abrieb/Erde) zwischen Randstein und Asphalt. */
const SEAM_WIDTH = 1.8;

// Aus den Breiten abgeleitete Strichstärken. Ein Stroke deckt immer beide
// Fahrbahnseiten ab, deshalb zählt der seitliche Abstand doppelt.
const KERB_STROKE = ROAD_WIDTH + 2 * (SEAM_WIDTH + KERB_WIDTH);
const BEVEL_STROKE = ROAD_WIDTH + 2 * (SEAM_WIDTH + KERB_BEVEL);
const SEAM_STROKE = ROAD_WIDTH + 2 * SEAM_WIDTH;

/** Mittellinie: Strichlänge, Wunschabstand und Strichstärke. */
const LANE_DASH = 22;
const LANE_GAP = 26;
const LANE_WIDTH = 4;

/** Start-/Zielfeld: Kantenlänge eines Feldes und Tiefe in Fahrtrichtung. */
const CHECKER_SIZE = 12;
const CHECKER_COLS = 4;

/** Asphaltflecken pro Streckenpixel und Obergrenze, damit lange Kurse nicht ausufern. */
const SPECK_DENSITY = 1.15;
const SPECK_LIMIT = 7200;

/**
 * Fahrbahn auf `g` malen. `track` liefert nur die Mittellinie als geschlossenen
 * Linienzug (`pts`, `n`) – über die Streckenform wird nichts angenommen.
 */
export function paintRoad(g, track) {
  const pts = track?.pts;
  if (!pts || pts.length < 2) return;

  const road = measure(track);
  if (!(road.total > 0)) return;
  const rnd = makeRng(seedOf(road));

  g.save();
  g.lineJoin = 'round';
  g.globalAlpha = 1;

  paintKerb(g, road);
  paintSeam(g, road);
  paintAsphalt(g, road, rnd);
  paintLaneLine(g, road, rnd);
  paintStartGrid(g, road);

  g.setLineDash([]);
  g.globalAlpha = 1;
  g.restore();
}

/* ========================= Streckenmaße ========================= */

/**
 * Segmentlängen und Bogenlängentabelle selbst aufbauen, statt sie aus `track`
 * zu lesen: der Editor reicht auch Zwischenstände ohne Längentabelle herein.
 */
function measure(track) {
  const pts = track.pts;
  const n = track.n ?? pts.length;
  const len = new Float64Array(n);
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    len[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum[i + 1] = cum[i] + len[i];
  }
  return { pts, n, len, cum, total: cum[n] };
}

/** Punkt bei Bogenlänge `s` (läuft zyklisch um die geschlossene Strecke). */
function pointAt(road, s) {
  const d = ((s % road.total) + road.total) % road.total;
  let i = 0;
  while (i < road.n - 1 && road.cum[i + 1] <= d) i++;
  const t = (d - road.cum[i]) / (road.len[i] || 1);
  const a = road.pts[i];
  const b = road.pts[(i + 1) % road.n];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Geschlossener Pfad entlang der Streckenmitte. */
function centerPath(g, road) {
  g.beginPath();
  g.moveTo(road.pts[0][0], road.pts[0][1]);
  for (let i = 1; i < road.n; i++) g.lineTo(road.pts[i][0], road.pts[i][1]);
  g.closePath();
}

/* ========================= Zufall ========================= */

/** Seed aus der Streckenform – verschiedene Kurse fleckt es unterschiedlich. */
function seedOf(road) {
  let h = 0x811c9dc5;
  for (let i = 0; i < road.n; i++) {
    h = Math.imul(h ^ ((road.pts[i][0] * 16) | 0), 16777619);
    h = Math.imul(h ^ ((road.pts[i][1] * 16) | 0), 16777619);
  }
  return h >>> 0;
}

/** mulberry32 – kompakt, schnell und ohne Zustand außerhalb des Aufrufs. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ========================= Randstein ========================= */

/**
 * Rot-weiße Blöcke plus Fase. Die Blöcke entstehen als Strichmuster auf dem
 * gestrichenen Streckenpfad – so bleiben sie unabhängig von der Streckenform.
 * Die Fase ist ein zweiter, schmalerer Stroke in den dunklen Tönen: er deckt
 * nur den zur Fahrbahn zeigenden Teil des Randsteins ab, der äußere Rest bleibt
 * hell stehen. Ohne diesen Höhenversatz sieht der Randstein aufgemalt aus.
 */
function paintKerb(g, road) {
  // Butt-Caps sind Pflicht: bei runden Kappen würde jeder Strich um die halbe
  // Strichstärke (über 60 px) auslaufen und das Muster zu Rot verschmieren.
  g.lineCap = 'butt';

  centerPath(g, road);
  g.lineWidth = KERB_STROKE;
  g.strokeStyle = KERB_WHITE;
  g.stroke();

  g.setLineDash([KERB_BLOCK, KERB_BLOCK]);
  g.lineDashOffset = 0;
  g.strokeStyle = KERB_RED;
  g.stroke();
  g.setLineDash([]);

  // Fase: gleiche Strichphase, nur schmaler – damit sitzt der dunkle Anteil bei
  // jedem Block exakt unter seinem hellen Anteil.
  centerPath(g, road);
  g.lineWidth = BEVEL_STROKE;
  g.strokeStyle = KERB_WHITE_DARK;
  g.stroke();

  g.setLineDash([KERB_BLOCK, KERB_BLOCK]);
  g.lineDashOffset = 0;
  g.strokeStyle = KERB_RED_DARK;
  g.stroke();
  g.setLineDash([]);
}

/** Schmaler brauner Saum – trennt Randstein und Asphalt sichtbar voneinander. */
function paintSeam(g, road) {
  centerPath(g, road);
  g.lineCap = 'round';
  g.lineWidth = SEAM_STROKE;
  g.strokeStyle = KERB_EDGE;
  g.stroke();
}

/* ========================= Asphalt ========================= */

/**
 * Fahrbahnband als Pfad: pro Segment ein Rechteck, pro Stützpunkt ein Kreis.
 * Alle Teilpfade laufen gleichsinnig, deshalb ergibt die Nonzero-Regel exakt
 * ihre Vereinigung – also dieselbe Fläche wie ein Stroke mit runden Übergängen.
 */
function roadBandPath(g, road, half) {
  g.beginPath();
  for (let i = 0; i < road.n; i++) {
    const l = road.len[i];
    if (!l) continue;
    const a = road.pts[i];
    const b = road.pts[(i + 1) % road.n];
    const nx = (-(b[1] - a[1]) / l) * half;
    const ny = ((b[0] - a[0]) / l) * half;
    g.moveTo(a[0] + nx, a[1] + ny);
    g.lineTo(b[0] + nx, b[1] + ny);
    g.lineTo(b[0] - nx, b[1] - ny);
    g.lineTo(a[0] - nx, a[1] - ny);
    g.closePath();
  }
  for (let i = 0; i < road.n; i++) {
    const p = road.pts[i];
    g.moveTo(p[0] + half, p[1]);
    // Gegenläufig, damit die Kreise dieselbe Windungsrichtung wie die Rechtecke
    // haben und sich nicht gegenseitig auslöschen.
    g.arc(p[0], p[1], half, 0, TAU, true);
  }
}

/**
 * Grundton flächig, darüber unruhige Flecken aus den drei Asphalttönen. Die
 * Flecken werden je Ton in einem eigenen Durchgang gesetzt – ein `fillStyle`
 * pro Ton statt einem pro Fleck. Geclippt wird auf das Fahrbahnband, damit
 * nichts über den Saum oder den Randstein läuft.
 */
function paintAsphalt(g, road, rnd) {
  centerPath(g, road);
  g.lineCap = 'round';
  g.lineWidth = ROAD_WIDTH;
  g.strokeStyle = ASPHALT[0];
  g.stroke();

  g.save();
  roadBandPath(g, road, HALF_ROAD);
  g.clip();

  const density = Math.min(SPECK_DENSITY, SPECK_LIMIT / road.total) / ASPHALT.length;
  for (const tone of ASPHALT) {
    g.fillStyle = tone;
    for (let i = 0; i < road.n; i++) {
      const l = road.len[i];
      if (!l) continue;
      const a = road.pts[i];
      const b = road.pts[(i + 1) % road.n];
      const ux = (b[0] - a[0]) / l;
      const uy = (b[1] - a[1]) / l;
      const count = Math.round(l * density);
      for (let k = 0; k < count; k++) {
        const t = rnd() * l;
        const lat = (rnd() * 2 - 1) * HALF_ROAD;
        const x = a[0] + ux * t - uy * lat;
        const y = a[1] + uy * t + ux * lat;
        g.fillRect(Math.round(x), Math.round(y), 4 + ((rnd() * 5) | 0), 4 + ((rnd() * 5) | 0));
      }
    }
  }
  g.restore();
}

/* ========================= Mittellinie ========================= */

/** Ein Teilstück der Streckenmitte stricheln – folgt auch engen Kurven. */
function strokeAlong(g, road, s0, s1, width, color, alpha) {
  const steps = Math.max(2, Math.ceil((s1 - s0) / 6));
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const [x, y] = pointAt(road, s0 + ((s1 - s0) * i) / steps);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.globalAlpha = alpha;
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

/**
 * Gestrichelte Mittellinie in vergrauten Beigetönen. Der Abstand wird auf die
 * Rundenlänge verteilt, sonst stößt der letzte Strich als Stummel an den ersten.
 * Jeder Strich bekommt eigenen Ton, eigene Stärke und ein paar überlagerte
 * Abriebstellen – aufgemalt und abgefahren statt frisch lackiert.
 */
function paintLaneLine(g, road, rnd) {
  g.lineCap = 'round';
  const count = Math.max(1, Math.round(road.total / (LANE_DASH + LANE_GAP)));
  const span = road.total / count;
  const dash = Math.min(LANE_DASH, span * 0.6);

  for (let i = 0; i < count; i++) {
    const s0 = i * span + (rnd() - 0.5) * 2;
    const s1 = s0 + dash * (0.85 + rnd() * 0.3);
    strokeAlong(g, road, s0, s1, LANE_WIDTH * (0.85 + rnd() * 0.35),
      LANE_LINE[(rnd() * LANE_LINE.length) | 0], 0.62 + rnd() * 0.3);

    // Abrieb: ein bis zwei kurze, dunklere Stellen im Strich.
    const wear = 1 + ((rnd() * 2) | 0);
    for (let w = 0; w < wear; w++) {
      const a = s0 + rnd() * (s1 - s0) * 0.7;
      strokeAlong(g, road, a, a + 2 + rnd() * 5, LANE_WIDTH * 0.7, LANE_LINE[2], 0.45 + rnd() * 0.3);
    }
  }
  g.globalAlpha = 1;
}

/* ========================= Start und Ziel ========================= */

/**
 * Schachbrett quer über die Fahrbahn am ersten Streckenpunkt, ausgerichtet an
 * der Richtung zum zweiten. Ein Clip auf die Fahrbahnbreite schneidet die
 * Randreihen sauber ab, damit die Felder nicht auf den Saum laufen.
 */
function paintStartGrid(g, road) {
  const a = road.pts[0];
  const b = road.pts[1 % road.n];
  const rows = Math.ceil(ROAD_WIDTH / CHECKER_SIZE);
  const y0 = -(rows * CHECKER_SIZE) / 2;

  g.save();
  g.translate(a[0], a[1]);
  g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.beginPath();
  g.rect(0, -HALF_ROAD, CHECKER_COLS * CHECKER_SIZE, ROAD_WIDTH);
  g.clip();
  for (let col = 0; col < CHECKER_COLS; col++) {
    for (let row = 0; row < rows; row++) {
      g.fillStyle = (col + row) % 2 === 0 ? CHECKER_LIGHT : CHECKER_DARK;
      g.fillRect(col * CHECKER_SIZE, y0 + row * CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE);
    }
  }
  g.restore();
}
