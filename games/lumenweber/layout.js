// Geometrie des Spielfelds.
//
// Renderer und Eingabe teilen sich dieselbe Rechnung – nur so trifft ein
// Fingertipp genau die Zelle, die auch gezeichnet wurde.

/**
 * Größte Kantenlänge einer Zelle in CSS-Pixeln.
 *
 * Die Deckelung greift nur bei kleinen Rastern auf großen Schirmen – dort
 * würde ein 5×5-Brett sonst die ganze Fläche fluten. 108 war zu streng: Auf
 * einem Tablet blieb rundherum mehr leerer Nebel als Spielfeld.
 */
const MAX_CELL = 132;
/** Kleinste Kantenlänge, bei der ein Finger noch sicher trifft. */
const MIN_TOUCH_CELL = 34;

/**
 * @param {number} width   nutzbare Breite in CSS-Pixeln
 * @param {number} height  nutzbare Höhe in CSS-Pixeln
 * @param {object} level
 * @param {{top?:number,right?:number,bottom?:number,left?:number}} insets
 *        Platz für HUD und Bedienleiste
 */
export function computeLayout(width, height, level, insets = {}) {
  const top = insets.top ?? 0;
  const bottom = insets.bottom ?? 0;
  const left = insets.left ?? 0;
  const right = insets.right ?? 0;

  const availW = Math.max(1, width - left - right);
  const availH = Math.max(1, height - top - bottom);

  const cell = Math.min(MAX_CELL, availW / level.width, availH / level.height);
  const boardW = cell * level.width;
  const boardH = cell * level.height;

  return {
    cell,
    boardW,
    boardH,
    originX: left + (availW - boardW) / 2,
    originY: top + (availH - boardH) / 2,
    /** Zellen sind unter diesem Wert für Finger zu klein – die UI warnt dann. */
    tight: cell < MIN_TOUCH_CELL,
  };
}

/** Mitte einer Zelle in Pixeln. */
export const cellCenter = (layout, x, y) => ({
  px: layout.originX + (x + 0.5) * layout.cell,
  py: layout.originY + (y + 0.5) * layout.cell,
});

/** Rasterpunkt (Einheit: Zellen) in Pixel umrechnen. */
export const gridToPixel = (layout, gx, gy) => ({
  px: layout.originX + gx * layout.cell,
  py: layout.originY + gy * layout.cell,
});

/**
 * Pixelposition → Zelle. Liefert `null` außerhalb des Bretts.
 *
 * Die Trefferfläche wird um eine halbe Zelle nach außen erweitert (`slack`),
 * damit auch ein etwas danebenliegender Fingertipp noch den gemeinten Spiegel
 * erwischt – auf dem Handy ist das der Unterschied zwischen „spielt sich gut“
 * und „hakelig“.
 */
export function cellFromPoint(layout, level, px, py, slack = 0) {
  const gx = (px - layout.originX) / layout.cell;
  const gy = (py - layout.originY) / layout.cell;
  const x = Math.floor(gx);
  const y = Math.floor(gy);
  if (x >= 0 && y >= 0 && x < level.width && y < level.height) return { x, y };
  if (slack <= 0) return null;
  const cx = Math.min(level.width - 1, Math.max(0, x));
  const cy = Math.min(level.height - 1, Math.max(0, y));
  const dx = gx - (cx + 0.5);
  const dy = gy - (cy + 0.5);
  return Math.abs(dx) <= 0.5 + slack && Math.abs(dy) <= 0.5 + slack ? { x: cx, y: cy } : null;
}
