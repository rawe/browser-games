// Wasser: eine kachelbare Lichtnetz-Textur (Kaustik), einmal beim Start
// gerechnet. Auf dem Brett laufen zwei Lagen davon gegeneinander – das kostet
// pro Bild nur zwei Kachelfüllungen statt Rauschen in jedem Pixel.

const TILE = 192;
let tile = null;

/** Zellrauschen (Worley) mit Abstand F2 − F1: helle, dünne Netzlinien. */
function buildTile() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(TILE, TILE);

  // Feste Punkte, damit das Wasser bei jedem Laden gleich aussieht.
  let seed = 1337;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const points = Array.from({ length: 34 }, () => [rand() * TILE, rand() * TILE]);

  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      let f1 = Infinity;
      let f2 = Infinity;
      for (const [px, py] of points) {
        // Kachelbar: jeden Punkt auch in den Nachbarkacheln betrachten.
        for (let oy = -TILE; oy <= TILE; oy += TILE) {
          for (let ox = -TILE; ox <= TILE; ox += TILE) {
            const dx = px + ox - x;
            const dy = py + oy - y;
            const d = dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
        }
      }
      const edge = Math.sqrt(f2) - Math.sqrt(f1);
      const v = Math.max(0, 1 - edge / 9) ** 3;
      const o = (y * TILE + x) * 4;
      image.data[o] = 170;
      image.data[o + 1] = 235;
      image.data[o + 2] = 255;
      image.data[o + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function causticTile() {
  tile ??= buildTile();
  return tile;
}

/**
 * Wasserfläche in das Rechteck malen.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} t  Zeit in Sekunden
 * @param {{deep: string, shallow: string, glow: number}} look
 */
export function paintWater(ctx, x, y, w, h, t, look, scale = 1) {
  const grad = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
  grad.addColorStop(0, look.shallow);
  grad.addColorStop(1, look.deep);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  const pattern = ctx.createPattern(causticTile(), 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (const layer of LAYERS) {
    const k = scale * layer.size;
    const span = TILE * k;
    const ox = wrap(t * layer.drift[0] * scale, span);
    const oy = wrap(t * layer.drift[1] * scale, span);
    ctx.save();
    ctx.globalAlpha = layer.alpha * look.glow;
    ctx.translate(x + ox - span, y + oy - span);
    ctx.scale(k, k);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w / k + TILE * 2, h / k + TILE * 2);
    ctx.restore();
  }
  ctx.restore();
}

/** Zwei Lagen, die gegeneinander treiben – daraus entsteht das Flimmern. */
const LAYERS = [
  { drift: [9, 5], alpha: 0.11, size: 1 },
  { drift: [-6, 8], alpha: 0.08, size: 1.37 },
];

const wrap = (v, m) => ((v % m) + m) % m;
