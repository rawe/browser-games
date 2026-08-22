// Die Figuren – als Vektoren, nicht als Bilder.
//
// Jede Figur ist eine Handvoll Pfade in einem 100×100-Feld, Standfläche auf
// y = 90, Mittelachse auf x = 50. Daraus folgt alles Weitere: Die Figuren
// bleiben auf jedem Bildschirm gestochen scharf, sie skalieren mit der
// Feldgröße statt in Stufen, und der Satz kostet keine einzige Bilddatei.
//
// Gezeichnet wird jede Figur dreimal übereinander: Schlagschatten, Körper mit
// Verlauf, und ein feiner Glanzstrich an der Oberkante. Dass dabei Innenkanten
// sichtbar bleiben – Kragen, Ringe, die Zinnen des Turms – ist Absicht: Genau
// diese Linien machen aus einer Silhouette eine Figur.

import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE } from '../engine/board.js';

/**
 * Pfaddaten je Figur. Reihenfolge ist Zeichenreihenfolge: erst der Sockel,
 * zuletzt der Kopf. `line: true` markiert reine Zierlinien, die nur
 * nachgezogen und nicht gefüllt werden.
 */
const SHAPES = {
  [PAWN]: [
    { d: 'M28 90 L72 90 C72 84 65 82 63 78 L37 78 C35 82 28 84 28 90 Z' },
    { d: 'M37 78 C37 68 40 62 42 55 L58 55 C60 62 63 68 63 78 Z' },
    { d: 'M40 55 L60 55 C62 51 62 48 60 46 L40 46 C38 48 38 51 40 55 Z' },
    { d: 'M50 21 A13 13 0 1 1 49.9 21 Z' },
  ],
  [ROOK]: [
    { d: 'M25 90 L75 90 C75 84 67 82 65 78 L35 78 C33 82 25 84 25 90 Z' },
    { d: 'M36 78 C36 68 38 60 39 52 L61 52 C62 60 64 68 64 78 Z' },
    { d: 'M31 52 L69 52 C71 48 71 45 69 43 L31 43 C29 45 29 48 31 52 Z' },
    { d: 'M30 43 L30 24 L39 24 L39 31 L46 31 L46 24 L54 24 L54 31 L61 31 L61 24 L70 24 L70 43 Z' },
    { d: 'M33 39 L67 39', line: true },
  ],
  [KNIGHT]: [
    { d: 'M26 90 L74 90 C74 84 66 82 64 78 L37 78 C35 82 26 84 26 90 Z' },
    {
      d: 'M64 78 C64 70 65 62 64 55 C63 45 60 36 53 30 '
        + 'C49 26 45 24 41 23 C39 20 37 17 34 15 '
        + 'C33 19 34 23 35 26 C31 28 27 31 24 35 '
        + 'C21 39 18 44 17 48 C16 52 18 54 22 54 '
        + 'C26 54 30 52 33 50 C34 55 36 60 39 64 '
        + 'C42 69 40 73 39 78 Z',
    },
    { d: 'M35 26 C40 30 44 35 46 41', line: true },
    { d: 'M28 45 C31 43 34 43 36 44', line: true },
    { d: 'M31 39 A2.6 2.6 0 1 1 30.9 39 Z' },
  ],
  [BISHOP]: [
    { d: 'M27 90 L73 90 C73 84 66 82 64 78 L36 78 C34 82 27 84 27 90 Z' },
    { d: 'M38 78 C38 69 41 63 43 57 L57 57 C59 63 62 69 62 78 Z' },
    { d: 'M35 57 L65 57 C67 53 67 50 65 48 L35 48 C33 50 33 53 35 57 Z' },
    { d: 'M50 17 C59 26 65 35 65 42 C65 47 58 50 50 50 C42 50 35 47 35 42 C35 35 41 26 50 17 Z' },
    { d: 'M50 24 L60 36', line: true },
    { d: 'M50 10 A4.5 4.5 0 1 1 49.9 10 Z' },
  ],
  [QUEEN]: [
    { d: 'M25 90 L75 90 C75 84 67 82 65 78 L35 78 C33 82 25 84 25 90 Z' },
    { d: 'M36 78 C36 68 40 61 42 54 L58 54 C60 61 64 68 64 78 Z' },
    { d: 'M33 54 L67 54 C69 50 69 47 67 45 L33 45 C31 47 31 50 33 54 Z' },
    {
      d: 'M31 45 C29 39 28 33 28 28 L35 37 L40 22 L45 36 L50 19 L55 36 L60 22 L65 37 L72 28 '
        + 'C72 33 71 39 69 45 Z',
    },
    { d: 'M32 39 L68 39', line: true },
    { d: 'M28 24 A4.2 4.2 0 1 1 27.9 24 Z' },
    { d: 'M40 18 A4.2 4.2 0 1 1 39.9 18 Z' },
    { d: 'M50 15 A4.6 4.6 0 1 1 49.9 15 Z' },
    { d: 'M60 18 A4.2 4.2 0 1 1 59.9 18 Z' },
    { d: 'M72 24 A4.2 4.2 0 1 1 71.9 24 Z' },
  ],
  [KING]: [
    { d: 'M24 90 L76 90 C76 84 68 82 66 78 L34 78 C32 82 24 84 24 90 Z' },
    { d: 'M35 78 C35 68 39 61 41 54 L59 54 C61 61 65 68 65 78 Z' },
    { d: 'M32 54 L68 54 C70 50 70 47 68 45 L32 45 C30 47 30 50 32 54 Z' },
    { d: 'M32 45 C30 38 31 32 36 28 C41 24 45 23 50 23 C55 23 59 24 64 28 C69 32 70 38 68 45 Z' },
    { d: 'M34 36 C40 33 45 32 50 32 C55 32 60 33 66 36', line: true },
    { d: 'M46 22 L46 15 L41 15 L41 9 L46 9 L46 3 L54 3 L54 9 L59 9 L59 15 L54 15 L54 22 Z' },
  ],
};

/** Farbwerte der beiden Sätze. */
const SETS = [
  {
    top: '#fdfaf3', bottom: '#cdbfa4', edge: '#3b2f22',
    shine: 'rgba(255,255,255,0.85)', detail: 'rgba(59,47,34,0.7)',
  },
  {
    top: '#565f6e', bottom: '#151920', edge: '#05070b',
    shine: 'rgba(190,208,235,0.5)', detail: 'rgba(220,232,250,0.32)',
  },
];

const cache = new Map();

/** Pfade einer Figur – einmal gebaut, danach aus dem Zwischenspeicher. */
function pathsFor(type) {
  let paths = cache.get(type);
  if (!paths) {
    paths = SHAPES[type].map((shape) => ({ path: new Path2D(shape.d), line: !!shape.line }));
    cache.set(type, paths);
  }
  return paths;
}

/**
 * Eine Figur zeichnen.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} type   PAWN … KING
 * @param {number} color  WHITE oder BLACK
 * @param {number} x      linke Kante des Feldes
 * @param {number} y      obere Kante des Feldes
 * @param {number} size   Feldkante in Pixeln
 * @param {{scale?: number, alpha?: number, shadow?: number, lift?: number}} opts
 *        `lift` hebt eine angehobene Figur samt Schatten an – das gibt dem
 *        Ziehen Tiefe, ohne dass die Figur ihr Feld verlässt.
 */
export function drawPiece(ctx, type, color, x, y, size, opts = {}) {
  const { scale = 0.86, alpha = 1, shadow = 1, lift = 0 } = opts;
  const paths = pathsFor(type);
  const set = SETS[color === WHITE ? 0 : 1];
  const unit = (size * scale) / 100;

  ctx.save();
  ctx.globalAlpha = alpha;
  // Ursprung so setzen, dass die Standfläche (y = 90) etwas unter der Mitte
  // sitzt – so wirkt die Figur auf dem Feld stehend und nicht schwebend.
  ctx.translate(x + size / 2 - 50 * unit, y + size * 0.94 - 90 * unit - lift);
  ctx.scale(unit, unit);

  if (shadow > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.3 * shadow;
    ctx.fillStyle = '#000';
    ctx.filter = 'blur(2px)';
    ctx.beginPath();
    ctx.ellipse(50, 92 + lift / unit, 26, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const body = ctx.createLinearGradient(0, 0, 0, 100);
  body.addColorStop(0, set.top);
  body.addColorStop(1, set.bottom);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const { path, line } of paths) {
    if (line) {
      ctx.strokeStyle = set.detail;
      ctx.lineWidth = 2;
      ctx.stroke(path);
      continue;
    }
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.strokeStyle = set.edge;
    ctx.lineWidth = 3;
    ctx.stroke(path);
  }

  // Glanzkante: dieselben Pfade noch einmal, aber nur die obere Hälfte des
  // Strichs. Der Streifen sitzt links oben, wo das Licht herkommt.
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = set.shine;
  ctx.lineWidth = 1.4;
  ctx.translate(-0.9, -0.9);
  for (const { path, line } of paths) if (!line) ctx.stroke(path);
  ctx.restore();

  ctx.restore();
}
