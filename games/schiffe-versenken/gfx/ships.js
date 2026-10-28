// Schiffe von oben – reine Vektorzeichnung, je Typ mit eigener Silhouette.
//
// Jedes Schiff wird einmal pro Feldgröße in ein eigenes Bild gezeichnet
// (samt weichem Schatten) und danach nur noch kopiert. Schatten mit
// `shadowBlur` in jedem Bild neu zu rechnen, kostet auf dem Handy spürbar.

const cache = new Map();

/**
 * Das Schiff in Blickrichtung „Bug nach rechts“ als fertiges Bild.
 *
 * @returns {{image: HTMLCanvasElement, margin: number}} `margin` in Pixeln der
 *          Feldgröße – um so viel ragt das Bild (Schatten) übers Schiff hinaus.
 */
export function shipSprite(type, length, cell, dpr, sunk = false) {
  const key = `${type}:${length}:${Math.round(cell * dpr)}:${sunk}`;
  let sprite = cache.get(key);
  if (sprite) return sprite;

  const margin = cell * 0.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((length * cell + margin * 2) * dpr);
  canvas.height = Math.ceil((cell + margin * 2) * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(margin, margin + cell / 2);
  paintShip(ctx, type, length * cell, cell, sunk);

  sprite = { image: canvas, margin };
  if (cache.size > 80) cache.clear();
  cache.set(key, sprite);
  return sprite;
}

/** Eigenschaften der Rümpfe: Breite relativ zum Feld und Grundfarben. */
const HULLS = {
  schlachtschiff: { width: 0.66, bowShare: 0.24, deck: 'teak' },
  kreuzer: { width: 0.58, bowShare: 0.26, deck: 'teak' },
  zerstoerer: { width: 0.5, bowShare: 0.3, deck: 'grau' },
  uboot: { width: 0.42, bowShare: 0, deck: 'boot' },
  schnellboot: { width: 0.46, bowShare: 0.36, deck: 'grau' },
};

/**
 * Ein Schiff im lokalen Rahmen zeichnen: Heck bei x = 0, Bug bei x = len,
 * Mittellinie bei y = 0.
 */
export function paintShip(ctx, type, len, cell, sunk = false) {
  const hull = HULLS[type] ?? HULLS.zerstoerer;
  const w = cell * hull.width;
  const pad = cell * 0.08;
  const x0 = pad;
  const x1 = len - pad;

  ctx.save();
  // Weicher Schatten unter dem Rumpf – liegt tiefer im Wasser, also versetzt.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 8, 20, 0.55)';
  ctx.shadowBlur = cell * 0.22;
  ctx.shadowOffsetX = cell * 0.06;
  ctx.shadowOffsetY = cell * 0.1;
  hullPath(ctx, x0, x1, w, hull, cell);
  ctx.fillStyle = '#39424d';
  ctx.fill();
  ctx.restore();

  // Rumpf mit Rundung quer zur Fahrtrichtung.
  const side = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
  if (type === 'uboot') {
    side.addColorStop(0, '#4a5562');
    side.addColorStop(0.4, '#2c343e');
    side.addColorStop(1, '#141a21');
  } else {
    side.addColorStop(0, '#9aa6b4');
    side.addColorStop(0.3, '#7b8796');
    side.addColorStop(0.7, '#5f6a78');
    side.addColorStop(1, '#353d48');
  }
  hullPath(ctx, x0, x1, w, hull, cell);
  ctx.fillStyle = side;
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, cell * 0.025);
  ctx.strokeStyle = 'rgba(10, 16, 24, 0.75)';
  ctx.stroke();

  // Deck
  ctx.save();
  hullPath(ctx, x0, x1, w, hull, cell);
  ctx.clip();
  if (hull.deck === 'teak') paintTeak(ctx, x0, x1, w, cell);
  else if (hull.deck === 'grau') paintGreyDeck(ctx, x0, x1, w, cell);
  else paintBoatDeck(ctx, x0, x1, w, cell);
  ctx.restore();

  const at = (share) => x0 + (x1 - x0) * share;
  switch (type) {
    case 'schlachtschiff':
      turret(ctx, at(0.13), 0, w * 0.34, -1, cell, 3);
      turret(ctx, at(0.71), 0, w * 0.34, 1, cell, 3);
      turret(ctx, at(0.83), 0, w * 0.3, 1, cell, 3);
      superstructure(ctx, at(0.28), at(0.6), w * 0.52, cell);
      bridge(ctx, at(0.56), w * 0.42, cell);
      funnel(ctx, at(0.42), w * 0.2, cell);
      mast(ctx, at(0.5), cell);
      boats(ctx, at(0.33), w, cell);
      break;
    case 'kreuzer':
      turret(ctx, at(0.14), 0, w * 0.32, -1, cell, 2);
      turret(ctx, at(0.79), 0, w * 0.32, 1, cell, 2);
      superstructure(ctx, at(0.3), at(0.63), w * 0.5, cell);
      bridge(ctx, at(0.6), w * 0.4, cell);
      funnel(ctx, at(0.39), w * 0.17, cell);
      funnel(ctx, at(0.49), w * 0.17, cell);
      mast(ctx, at(0.55), cell);
      break;
    case 'zerstoerer':
      turret(ctx, at(0.78), 0, w * 0.3, 1, cell, 1);
      turret(ctx, at(0.12), 0, w * 0.26, -1, cell, 1);
      superstructure(ctx, at(0.36), at(0.66), w * 0.5, cell);
      bridge(ctx, at(0.62), w * 0.42, cell);
      funnel(ctx, at(0.44), w * 0.2, cell);
      torpedoes(ctx, at(0.25), w, cell);
      break;
    case 'uboot':
      conningTower(ctx, at(0.56), w, cell);
      break;
    case 'schnellboot':
      superstructure(ctx, at(0.36), at(0.62), w * 0.56, cell);
      bridge(ctx, at(0.58), w * 0.48, cell);
      turret(ctx, at(0.8), 0, w * 0.26, 1, cell, 1);
      break;
    default:
      break;
  }

  if (sunk) {
    // Verkohlt: dunkle Lasur nur über dem Schiff, dazu Rußflecken.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(40, 20, 10, 0.42)';
    ctx.fillRect(-cell, -cell, len + cell * 2, cell * 2);
    for (let i = 0; i < len / cell * 2; i += 1) {
      const sx = x0 + ((i * 0.618) % 1) * (x1 - x0);
      const g = ctx.createRadialGradient(sx, 0, 0, sx, 0, cell * 0.35);
      g.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - cell, -cell, cell * 2, cell * 2);
    }
  }
  ctx.restore();
}

function hullPath(ctx, x0, x1, w, hull, cell) {
  const len = x1 - x0;
  const h = w / 2;
  ctx.beginPath();
  if (!hull.bowShare) {
    // U-Boot: Zigarre, beide Enden rund – der Bug etwas voller.
    ctx.moveTo(x0 + h, -h);
    ctx.lineTo(x1 - h * 1.6, -h);
    ctx.bezierCurveTo(x1 - h * 0.4, -h, x1, -h * 0.3, x1, 0);
    ctx.bezierCurveTo(x1, h * 0.3, x1 - h * 0.4, h, x1 - h * 1.6, h);
    ctx.lineTo(x0 + h, h);
    ctx.bezierCurveTo(x0 + h * 0.2, h, x0, h * 0.4, x0, 0);
    ctx.bezierCurveTo(x0, -h * 0.4, x0 + h * 0.2, -h, x0 + h, -h);
    ctx.closePath();
    return;
  }
  const bow = Math.min(len * hull.bowShare, cell * 1.3);
  const stern = h * 0.55;
  ctx.moveTo(x0 + stern, -h);
  ctx.lineTo(x1 - bow, -h);
  ctx.bezierCurveTo(x1 - bow * 0.45, -h, x1 - bow * 0.12, -h * 0.45, x1, 0);
  ctx.bezierCurveTo(x1 - bow * 0.12, h * 0.45, x1 - bow * 0.45, h, x1 - bow, h);
  ctx.lineTo(x0 + stern, h);
  ctx.quadraticCurveTo(x0, h * 0.95, x0, h * 0.35);
  ctx.lineTo(x0, -h * 0.35);
  ctx.quadraticCurveTo(x0, -h * 0.95, x0 + stern, -h);
  ctx.closePath();
}

function paintTeak(ctx, x0, x1, w, cell) {
  const inset = w * 0.12;
  ctx.fillStyle = '#b89b6e';
  ctx.fillRect(x0, -w / 2 + inset, x1 - x0, w - inset * 2);
  // Planken längs, mit leicht wechselnder Tönung
  const plank = Math.max(1.2, cell * 0.045);
  for (let y = -w / 2 + inset, i = 0; y < w / 2 - inset; y += plank, i += 1) {
    ctx.fillStyle = i % 3 === 0 ? 'rgba(90, 60, 30, 0.18)' : i % 3 === 1 ? 'rgba(255, 240, 210, 0.08)' : 'rgba(0,0,0,0)';
    ctx.fillRect(x0, y, x1 - x0, plank * 0.9);
  }
  ctx.strokeStyle = 'rgba(70, 45, 20, 0.35)';
  ctx.lineWidth = Math.max(0.5, cell * 0.012);
  ctx.beginPath();
  for (let x = x0 + cell * 0.6; x < x1; x += cell * 0.6) {
    ctx.moveTo(x, -w / 2 + inset);
    ctx.lineTo(x, w / 2 - inset);
  }
  ctx.stroke();
  // Bordwand als dunkler Saum
  ctx.strokeStyle = 'rgba(40, 46, 54, 0.9)';
  ctx.lineWidth = inset * 1.1;
  ctx.strokeRect(x0 - inset, -w / 2, x1 - x0 + inset * 2, w);
}

function paintGreyDeck(ctx, x0, x1, w, cell) {
  const inset = w * 0.1;
  const g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
  g.addColorStop(0, '#9ba6b2');
  g.addColorStop(1, '#727d8a');
  ctx.fillStyle = g;
  ctx.fillRect(x0, -w / 2 + inset, x1 - x0, w - inset * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = Math.max(0.5, cell * 0.015);
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(x1, 0);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30, 36, 44, 0.9)';
  ctx.lineWidth = inset * 1.2;
  ctx.strokeRect(x0 - inset, -w / 2, x1 - x0 + inset * 2, w);
}

function paintBoatDeck(ctx, x0, x1, w, cell) {
  // Schmaler Laufsteg auf dem Rücken des U-Boots
  ctx.fillStyle = 'rgba(120, 132, 146, 0.35)';
  const sw = w * 0.22;
  ctx.fillRect(x0 + w * 0.6, -sw / 2, x1 - x0 - w * 1.2, sw);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = Math.max(0.5, cell * 0.012);
  for (let x = x0 + w * 0.7; x < x1 - w * 0.6; x += cell * 0.12) {
    ctx.beginPath();
    ctx.moveTo(x, -sw / 2);
    ctx.lineTo(x, sw / 2);
    ctx.stroke();
  }
}

/** Geschützturm mit Rohren in Richtung `facing` (+1 Bug, −1 Heck). */
function turret(ctx, x, y, r, facing, cell, barrels) {
  const barrelLen = r * 2.1;
  const gap = r * 0.42;
  ctx.fillStyle = '#3d454f';
  for (let i = 0; i < barrels; i += 1) {
    const by = y + (i - (barrels - 1) / 2) * gap;
    ctx.fillRect(facing > 0 ? x : x - barrelLen, by - r * 0.1, barrelLen, r * 0.2);
  }
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#b5bfca');
  g.addColorStop(1, '#5c6672');
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.05, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, cell * 0.018);
  ctx.strokeStyle = 'rgba(20, 26, 34, 0.8)';
  ctx.stroke();
}

function superstructure(ctx, xa, xb, w, cell) {
  roundRect(ctx, xa, -w / 2, xb - xa, w, w * 0.25);
  const g = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
  g.addColorStop(0, '#e4e8ed');
  g.addColorStop(1, '#a9b2bd');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, cell * 0.018);
  ctx.strokeStyle = 'rgba(30, 36, 44, 0.7)';
  ctx.stroke();
}

function bridge(ctx, x, w, cell) {
  const d = cell * 0.22;
  roundRect(ctx, x - d, -w / 2, d, w, d * 0.3);
  ctx.fillStyle = '#f1f4f7';
  ctx.fill();
  // Fensterband
  ctx.fillStyle = '#25303c';
  ctx.fillRect(x - d * 0.25, -w / 2 + w * 0.12, d * 0.15, w * 0.76);
}

function funnel(ctx, x, r, cell) {
  ctx.beginPath();
  ctx.ellipse(x, 0, r * 1.25, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2a3039';
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, cell * 0.03);
  ctx.strokeStyle = '#c94f3d';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, 0, r * 0.8, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0c0f13';
  ctx.fill();
}

function mast(ctx, x, cell) {
  ctx.strokeStyle = 'rgba(30, 36, 44, 0.85)';
  ctx.lineWidth = Math.max(0.6, cell * 0.025);
  ctx.beginPath();
  ctx.moveTo(x - cell * 0.12, 0);
  ctx.lineTo(x + cell * 0.12, 0);
  ctx.moveTo(x, -cell * 0.18);
  ctx.lineTo(x, cell * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, 0, cell * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = '#e8eef4';
  ctx.fill();
}

function boats(ctx, x, w, cell) {
  ctx.fillStyle = '#eef1f4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x, side * w * 0.33, cell * 0.14, cell * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function torpedoes(ctx, x, w, cell) {
  ctx.fillStyle = '#4a535e';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(x, side * w * 0.12);
    ctx.rotate(side * 0.35);
    roundRect(ctx, -cell * 0.18, -cell * 0.035, cell * 0.36, cell * 0.07, cell * 0.03);
    ctx.fill();
    ctx.restore();
  }
}

function conningTower(ctx, x, w, cell) {
  const lenT = cell * 0.55;
  ctx.beginPath();
  ctx.ellipse(x, 0, lenT / 2, w * 0.3, 0, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, -w * 0.3, 0, w * 0.3);
  g.addColorStop(0, '#5a6674');
  g.addColorStop(1, '#1b2129');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = Math.max(0.5, cell * 0.02);
  ctx.stroke();
  // Sehrohr
  ctx.strokeStyle = '#9aa6b4';
  ctx.lineWidth = Math.max(0.8, cell * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + lenT * 0.1, 0);
  ctx.lineTo(x + lenT * 0.35, 0);
  ctx.stroke();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
