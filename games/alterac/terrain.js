// Terrain: malt den statischen Hintergrund des Alteractals einmal vor –
// nächtliches Schneetal, Felswände, gefrorene Bäche, verschneite Wälder,
// festgetretene Wege und die Feldlager beider Fraktionen. Keine Spiellogik.

import { edgePoint } from './map.js';

const TAU = Math.PI * 2;

// Deterministischer Zufall für die Landschaftsdeko.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paintTerrain(b, map) {
  const W = map.width;
  const H = map.height;
  const rnd = mulberry32(42);

  // Grundton: Schneetal in der Abenddämmerung, an beiden Enden vom
  // Fraktionslicht gefärbt (Frostwolf-Norden warm, Sturmlanzen-Süden kalt).
  const grad = b.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#38273a');
  grad.addColorStop(0.16, '#2b3046');
  grad.addColorStop(0.5, '#2d3950');
  grad.addColorStop(0.84, '#293a55');
  grad.addColorStop(1, '#25395e');
  b.fillStyle = grad;
  b.fillRect(0, 0, W, H);

  for (const [color, y] of [
    ['rgba(255,110,90,0.16)', 80],
    ['rgba(100,160,255,0.16)', 890],
  ]) {
    const g = b.createRadialGradient(240, y, 20, 240, y, 330);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);
  }

  // Schneedecke: weiche helle Verwehungen über das ganze Tal.
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 26 + rnd() * 62;
    const g = b.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(216,230,248,${0.035 + rnd() * 0.04})`);
    g.addColorStop(1, 'rgba(216,230,248,0)');
    b.fillStyle = g;
    b.beginPath();
    b.arc(x, y, r, 0, TAU);
    b.fill();
  }

  drawStream(b, W, 292, rnd);
  drawStream(b, W, 664, rnd);
  drawRidge(b, W, H, rnd, true);
  drawRidge(b, W, H, rnd, false);
  for (const e of map.edges) drawRoad(b, map, e);
  drawForest(b, map, W, H, rnd);
  drawCamps(b);

  // Glitzernder Pulverschnee.
  for (let i = 0; i < 130; i++) {
    b.fillStyle = `rgba(240,248,255,${0.04 + rnd() * 0.11})`;
    b.beginPath();
    b.arc(rnd() * W, rnd() * H, 0.5 + rnd() * 0.8, 0, TAU);
    b.fill();
  }

  // Vignette.
  const v = b.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(4,6,10,0.45)');
  b.fillStyle = v;
  b.fillRect(0, 0, W, H);
}

// Zugefrorener Bach quer durchs Tal, mit Uferkanten und Rissen im Eis.
function drawStream(b, W, yBase, rnd) {
  const pts = [];
  for (let x = -16; x <= W + 16; x += 22) {
    pts.push({ x, y: yBase + Math.sin(x * 0.021 + yBase) * 13 + (rnd() - 0.5) * 7 });
  }
  b.beginPath();
  b.moveTo(pts[0].x, pts[0].y - 12);
  for (const p of pts) b.lineTo(p.x, p.y - 12);
  for (let i = pts.length - 1; i >= 0; i--) b.lineTo(pts[i].x, pts[i].y + 12);
  b.closePath();
  const ice = b.createLinearGradient(0, yBase - 13, 0, yBase + 13);
  ice.addColorStop(0, 'rgba(140,195,235,0.12)');
  ice.addColorStop(0.5, 'rgba(185,222,250,0.26)');
  ice.addColorStop(1, 'rgba(130,180,230,0.12)');
  b.fillStyle = ice;
  b.fill();
  b.lineWidth = 1.6;
  b.strokeStyle = 'rgba(226,240,252,0.20)';
  for (const off of [-12, 12]) {
    b.beginPath();
    b.moveTo(pts[0].x, pts[0].y + off);
    for (const p of pts) b.lineTo(p.x, p.y + off);
    b.stroke();
  }
  b.strokeStyle = 'rgba(235,248,255,0.22)';
  b.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const p = pts[2 + Math.floor(rnd() * (pts.length - 4))];
    b.beginPath();
    b.moveTo(p.x - 8 + rnd() * 4, p.y - 6 + rnd() * 4);
    b.lineTo(p.x + 2 + rnd() * 4, p.y - 2 + rnd() * 4);
    b.lineTo(p.x + 10 + rnd() * 4, p.y + 2 + rnd() * 5);
    b.stroke();
  }
}

// Felswände an den Talrändern: drei Tiefenschichten mit Schneekanten.
function drawRidge(b, W, H, rnd, left) {
  const layers = [
    { depth: 74, color: '#141a26', snow: 'rgba(212,228,246,0.18)' },
    { depth: 48, color: '#1a2231', snow: 'rgba(220,234,250,0.28)' },
    { depth: 27, color: '#222b3e', snow: 'rgba(228,240,254,0.40)' },
  ];
  for (const { depth, color, snow } of layers) {
    const pts = [];
    let y = -12;
    while (y < H + 12) {
      pts.push({ x: depth * (0.35 + rnd() * 0.75), y });
      y += 32 + rnd() * 52;
    }
    b.beginPath();
    b.moveTo(left ? 0 : W, -12);
    for (const p of pts) b.lineTo(left ? p.x : W - p.x, p.y);
    b.lineTo(left ? 0 : W, H + 12);
    b.closePath();
    b.fillStyle = color;
    b.fill();
    b.beginPath();
    b.moveTo(left ? 0 : W, -12);
    for (const p of pts) b.lineTo(left ? p.x : W - p.x, p.y);
    b.strokeStyle = snow;
    b.lineWidth = 2.4;
    b.stroke();
  }
}

function roadPath(b, map, e) {
  b.beginPath();
  const p0 = edgePoint(map, e.a, e.b, 0);
  b.moveTo(p0.x, p0.y);
  for (let t = 0.08; t <= 1.001; t += 0.08) {
    const p = edgePoint(map, e.a, e.b, Math.min(t, 1));
    b.lineTo(p.x, p.y);
  }
}

// Festgetretener Weg: dunkler Pfad im Schnee mit heller Trittspur und
// Fußabdrücken, die abwechselnd links und rechts der Mitte liegen.
function drawRoad(b, map, e) {
  b.lineCap = 'round';
  b.lineJoin = 'round';
  roadPath(b, map, e);
  b.strokeStyle = 'rgba(8,12,20,0.55)';
  b.lineWidth = 19;
  b.stroke();
  roadPath(b, map, e);
  b.strokeStyle = '#3c4860';
  b.lineWidth = 11;
  b.stroke();
  roadPath(b, map, e);
  b.strokeStyle = 'rgba(226,238,252,0.10)';
  b.lineWidth = 4.5;
  b.stroke();
  b.fillStyle = 'rgba(10,14,22,0.5)';
  let step = 0;
  for (let t = 0.06; t < 0.97; t += 0.055) {
    const p = edgePoint(map, e.a, e.b, t);
    const q = edgePoint(map, e.a, e.b, t + 0.02);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const side = (step++ % 2 ? 1 : -1) * 2.2;
    b.beginPath();
    b.ellipse(p.x + (-dy / len) * side, p.y + (dx / len) * side, 1.5, 0.9, Math.atan2(dy, dx), 0, TAU);
    b.fill();
  }
}

function nearNodeOrRoad(map, x, y) {
  for (const n of map.nodeList) {
    if (Math.hypot(n.x - x, n.y - y) < 58) return true;
  }
  for (const e of map.edges) {
    for (let t = 0; t <= 1; t += 0.1) {
      const p = edgePoint(map, e.a, e.b, t);
      if (Math.hypot(p.x - x, p.y - y) < 34) return true;
    }
  }
  return false;
}

function drawForest(b, map, W, H, rnd) {
  for (let i = 0; i < 64; i++) {
    const side = rnd();
    let x;
    if (side < 0.38) x = 16 + rnd() * 66;
    else if (side < 0.76) x = W - 82 + rnd() * 66;
    else x = 160 + rnd() * 160;
    const y = 120 + rnd() * (H - 230);
    if (nearNodeOrRoad(map, x, y)) continue;
    drawPine(b, x, y, 7 + rnd() * 9);
  }
}

// Verschneite Kiefer: drei Nadel-Etagen mit Schnee auf den Flanken.
function drawPine(b, x, y, s) {
  b.beginPath();
  b.ellipse(x + 2.5, y + s * 0.35, s * 0.8, s * 0.3, 0, 0, TAU);
  b.fillStyle = 'rgba(8,12,20,0.3)';
  b.fill();
  b.fillStyle = '#171f28';
  b.fillRect(x - 1, y, 2, s * 0.35);
  for (const [f, dy] of [
    [1.0, 0],
    [0.78, -s * 0.42],
    [0.55, -s * 0.8],
  ]) {
    const yb = y + dy;
    const yt = y - s * 1.05 + dy;
    const w = s * 0.56 * f;
    b.beginPath();
    b.moveTo(x, yt);
    b.lineTo(x - w, yb);
    b.lineTo(x + w, yb);
    b.closePath();
    b.fillStyle = '#25423d';
    b.fill();
    b.strokeStyle = 'rgba(222,236,250,0.5)';
    b.lineWidth = Math.max(1, s * 0.14);
    b.beginPath();
    b.moveTo(x - w * 0.9, yb - (yb - yt) * 0.1);
    b.lineTo(x, yt);
    b.lineTo(x + w * 0.9, yb - (yb - yt) * 0.1);
    b.stroke();
  }
  b.beginPath();
  b.arc(x, y - s * 1.9, s * 0.18 + 0.6, 0, TAU);
  b.fillStyle = 'rgba(230,240,252,0.85)';
  b.fill();
}

// Feldlager: Frostwolf-Palisade und Zelte im Norden, Sturmlanzen-Steinwall
// und Vorposten im Süden.
function drawCamps(b) {
  for (let x = 118; x <= 362; x += 14) {
    const y = 30 + ((x - 240) / 120) ** 2 * 14;
    b.beginPath();
    b.moveTo(x - 5, y + 18);
    b.lineTo(x, y);
    b.lineTo(x + 5, y + 18);
    b.closePath();
    b.fillStyle = '#3d2b22';
    b.fill();
    b.lineWidth = 1;
    b.strokeStyle = '#120d0a';
    b.stroke();
    b.beginPath();
    b.arc(x, y + 2.5, 1.6, 0, TAU);
    b.fillStyle = 'rgba(228,238,250,0.7)';
    b.fill();
  }
  drawTent(b, 148, 112);
  drawTent(b, 334, 108);

  for (let x = 122; x <= 358; x += 18) {
    const y = 936 - ((x - 240) / 120) ** 2 * 12;
    b.fillStyle = '#46526a';
    b.fillRect(x - 8, y, 16, 11);
    b.lineWidth = 1.2;
    b.strokeStyle = '#10151f';
    b.strokeRect(x - 8, y, 16, 11);
    b.fillStyle = 'rgba(228,238,250,0.5)';
    b.fillRect(x - 8, y, 16, 2.2);
  }
  drawHut(b, 150, 862);
  drawHut(b, 318, 868);
}

function drawTent(b, x, y) {
  b.beginPath();
  b.ellipse(x, y + 9, 15, 5, 0, 0, TAU);
  b.fillStyle = 'rgba(8,12,20,0.35)';
  b.fill();
  b.beginPath();
  b.moveTo(x, y - 12);
  b.lineTo(x - 13, y + 8);
  b.lineTo(x + 13, y + 8);
  b.closePath();
  b.fillStyle = '#5a352b';
  b.fill();
  b.lineWidth = 1.4;
  b.strokeStyle = '#160f0b';
  b.stroke();
  b.beginPath();
  b.moveTo(x, y - 2);
  b.lineTo(x - 4, y + 8);
  b.lineTo(x + 4, y + 8);
  b.closePath();
  b.fillStyle = '#1c1310';
  b.fill();
  b.strokeStyle = 'rgba(228,238,250,0.55)';
  b.lineWidth = 1.6;
  b.beginPath();
  b.moveTo(x - 7, y - 1);
  b.lineTo(x, y - 12);
  b.lineTo(x + 7, y - 1);
  b.stroke();
}

function drawHut(b, x, y) {
  b.beginPath();
  b.ellipse(x, y + 12, 17, 5.5, 0, 0, TAU);
  b.fillStyle = 'rgba(8,12,20,0.35)';
  b.fill();
  b.fillStyle = '#49556c';
  b.fillRect(x - 13, y - 4, 26, 15);
  b.lineWidth = 1.4;
  b.strokeStyle = '#10151f';
  b.strokeRect(x - 13, y - 4, 26, 15);
  for (let i = 0; i < 4; i++) {
    b.fillStyle = '#49556c';
    b.fillRect(x - 13 + i * 7.2, y - 8, 4.4, 4.5);
    b.fillStyle = 'rgba(228,238,250,0.55)';
    b.fillRect(x - 13 + i * 7.2, y - 8, 4.4, 1.4);
  }
  b.fillStyle = '#141924';
  b.fillRect(x - 3.5, y + 3, 7, 8);
}
