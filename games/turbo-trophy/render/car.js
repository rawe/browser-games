// Fahrzeug-Karosserie in Aufsicht.
//
// Bewusst prozedural statt als Sprite: Wagen drehen sich frei und werden bei
// Sprüngen bis etwa 1,75× vergrößert. Ein Pixel-Sprite müsste dafür in mehreren
// Größen vorliegen und würde beim Hochskalieren ausfransen; gezeichnet bleibt
// die Karosserie in jeder Größe und jedem Winkel sauber.
//
// Der Pixel-Look entsteht über harte Kanten und abgeschrägte Ecken statt über
// Verläufe – dieselbe Bildsprache wie im Titelbild. Lichtkante liegt lokal
// oben (-y), Schattenkante unten (+y); da beides mit dem Wagen rotiert,
// verhält es sich wie ein gedrehtes Sprite.
//
// Lokales System: +x ist die Fahrtrichtung, der Ursprung liegt in der
// Wagenmitte. Alle Maße sind auf CAR_RADIUS = 13 aus `race.js` abgestimmt.

import {
  CAR_OUTLINE, TYRE, TYRE_TREAD,
  CANOPY, CANOPY_LIGHT, CANOPY_GLINT, CANOPY_FRAME,
} from './palette.js';

const HALF_LEN = 15;
const HALF_WID = 8;

/* ---------------- Farbableitung ---------------- */

const parseHex = (hex) => {
  const s = String(hex).trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const toHex = (rgb) =>
  '#' + rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');

/**
 * Lack aufhellen (t > 0) oder abdunkeln (t < 0). Ergebnisse werden gemerkt:
 * pro Bild werden bis zu acht Wagen mehrfach gezeichnet, und die Lackfarben
 * ändern sich während eines Rennens nicht.
 */
const shadeCache = new Map();
function shade(color, t) {
  const key = `${color}|${t}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const rgb = parseHex(color);
  // Unbekanntes Format (z. B. rgba-Partikelfarben) unverändert durchreichen.
  const out = rgb
    ? toHex(rgb.map((c) => (t >= 0 ? c + (255 - c) * t : c * (1 + t))))
    : color;
  shadeCache.set(key, out);
  return out;
}

/* ---------------- Formen ---------------- */

/**
 * Rechteck mit abgeschrägten Ecken. Die Schräge ersetzt die runde Ecke: sie
 * wirkt in der Aufsicht wie gesetzte Pixel, während `roundRect` weich und
 * dadurch fremd aussähe.
 */
function chamfer(ctx, x, y, w, h, c) {
  const k = Math.min(c, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.lineTo(x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.lineTo(x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.lineTo(x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.closePath();
}

const fillChamfer = (ctx, x, y, w, h, c, color) => {
  ctx.fillStyle = color;
  chamfer(ctx, x, y, w, h, c);
  ctx.fill();
};

/** Ein Reifen: dunkler Block mit aufgehelltem Profilstrich in der Mitte. */
function tyre(ctx, x, y, w, h) {
  ctx.fillStyle = TYRE;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = TYRE_TREAD;
  ctx.fillRect(x + w * 0.22, y + h * 0.38, w * 0.56, h * 0.24);
}

/**
 * Kanzel: heller Blauton, zur Front hin aufgehellt, hinten ein silberner
 * Rahmenfuß und oben links ein harter Glanzpunkt. Ohne den Glanzpunkt wirkt
 * die Fläche tot – im Titelbild ist er auf jedem Wagen zu sehen.
 */
function canopy(ctx) {
  // Breite am Teaser gemessen: die Kanzel bedeckt dort rund 48 % der
  // Wagenbreite, nicht zwei Drittel – sonst frisst sie den Lack auf.
  fillChamfer(ctx, -6.4, -5.1, 12.8, 10.2, 1.8, CAR_OUTLINE);
  fillChamfer(ctx, -5.3, -3.9, 10.6, 7.8, 1.4, CANOPY);
  // Vordere Hälfte heller: die Scheibe fängt dort mehr Licht.
  ctx.fillStyle = CANOPY_LIGHT;
  ctx.fillRect(-0.4, -3.2, 5, 6.4);
  ctx.fillStyle = CANOPY_FRAME;
  ctx.fillRect(-5.1, -3.7, 1.6, 7.4);
  ctx.fillStyle = CANOPY_GLINT;
  ctx.fillRect(1.4, -3, 2.4, 1.9);
}

/* ---------------- Karosserie ---------------- */

/**
 * Zeichnet den Wagen im lokalen System. `alpha` ist die FERTIGE Deckkraft –
 * der Aufrufer verrechnet Geistervorschau und Turbo-Nachzieheffekt bereits,
 * damit dieses Modul ohne globalen Zustand auskommt.
 */
export function drawCarBody(ctx, car, alpha = 1) {
  const paint = car.color;
  const light = shade(paint, 0.34);
  const dark = shade(paint, -0.3);
  const seam = shade(paint, -0.46);

  ctx.globalAlpha = alpha;

  // Bodenschatten, leicht versetzt – hebt den Wagen von der Fahrbahn ab.
  ctx.globalAlpha = alpha * 0.34;
  fillChamfer(ctx, -HALF_LEN + 1.5, -HALF_WID + 2.5, HALF_LEN * 2, HALF_WID * 2, 3, '#000');
  ctx.globalAlpha = alpha;

  // Reifen liegen unter der Karosserie, stehen aber seitlich über.
  for (const sx of [-11.5, 4.5]) {
    tyre(ctx, sx, -HALF_WID - 3.4, 7, 3.8);
    tyre(ctx, sx, HALF_WID - 0.4, 7, 3.8);
  }

  // Umriss als etwas größere Grundform – im Titelbild ein satter dunkler Rand.
  fillChamfer(ctx, -HALF_LEN - 0.9, -HALF_WID - 0.9,
    (HALF_LEN + 0.9) * 2, (HALF_WID + 0.9) * 2, 3.6, CAR_OUTLINE);
  fillChamfer(ctx, -HALF_LEN, -HALF_WID, HALF_LEN * 2, HALF_WID * 2, 3, paint);

  // Licht- und Schattenkante entlang der Längsseiten.
  ctx.fillStyle = light;
  ctx.fillRect(-HALF_LEN + 3, -HALF_WID, HALF_LEN * 2 - 6, 1.8);
  ctx.fillStyle = dark;
  ctx.fillRect(-HALF_LEN + 3, HALF_WID - 1.8, HALF_LEN * 2 - 6, 1.8);

  // Fugen teilen Bug, Kabine und Heck – ohne sie wirkt der Lack als eine
  // einzige Fläche und der Wagen flach.
  ctx.fillStyle = seam;
  ctx.fillRect(-7.6, -HALF_WID + 1.2, 1.1, HALF_WID * 2 - 2.4);
  ctx.fillRect(7.2, -HALF_WID + 1.2, 1.1, HALF_WID * 2 - 2.4);

  // Bugpartie: schmalerer, hellerer Block als Nase, dahinter das dunkle Heck.
  ctx.fillStyle = shade(paint, 0.14);
  ctx.fillRect(9.4, -HALF_WID + 2.2, 4.6, HALF_WID * 2 - 4.4);
  ctx.fillStyle = dark;
  ctx.fillRect(-13.8, -HALF_WID + 2.2, 4.4, HALF_WID * 2 - 4.4);

  canopy(ctx);

  ctx.globalAlpha = 1;
}
