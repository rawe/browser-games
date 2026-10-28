// Titelbild: Seegefecht in der Abenddämmerung, von der Seite gesehen.
//
// Läuft auf dem Startbildschirm als leise bewegte Szene und liefert in einem
// festen Moment auch das Kartenbild für die Übersicht.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} t  Sekunden
 */
export function paintTitleScene(ctx, w, h, t) {
  // Im Hochformat liegt der Horizont höher, damit unten Platz für die
  // Knöpfe bleibt und das Schiff nicht hinter ihnen verschwindet.
  const portrait = h > w * 1.1;
  const horizon = h * (portrait ? 0.47 : 0.6);
  const sunX = w * 0.68;
  const scale = Math.min(h * 0.0062, w * 0.0058);
  const shipX = w * (portrait ? 0.4 : 0.3);
  const shipY = horizon + (portrait ? h * 0.085 : h * 0.12) + Math.sin(t * 1.1) * h * 0.004;
  const sunY = horizon - h * 0.04;

  // Himmel
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0b1230');
  sky.addColorStop(0.45, '#3a2456');
  sky.addColorStop(0.78, '#b8475a');
  sky.addColorStop(1, '#f39a5a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon + 1);

  // Sterne oben, sie verblassen zum Horizont hin
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 90; i += 1) {
    const sx = rand() * w;
    const sy = rand() * horizon * 0.5;
    const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
    ctx.fillStyle = `rgba(255,255,255,${(0.15 + 0.5 * tw) * (1 - sy / (horizon * 0.5))})`;
    ctx.fillRect(sx, sy, 1.4, 1.4);
  }

  // Sonne mit Hof
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.45);
  glow.addColorStop(0, 'rgba(255, 220, 150, 0.85)');
  glow.addColorStop(0.08, 'rgba(255, 170, 100, 0.55)');
  glow.addColorStop(0.35, 'rgba(230, 90, 90, 0.18)');
  glow.addColorStop(1, 'rgba(120, 40, 90, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizon);
  ctx.beginPath();
  ctx.arc(sunX, sunY, h * 0.075, Math.PI, 0);
  ctx.fillStyle = '#ffe2a6';
  ctx.fill();

  // Wolkenbänder
  for (let i = 0; i < 6; i += 1) {
    const cy = horizon * (0.35 + i * 0.09);
    const drift = ((t * (4 + i)) % (w * 1.4));
    ctx.fillStyle = `rgba(60, 25, 60, ${0.18 + i * 0.03})`;
    ctx.beginPath();
    ctx.ellipse((i * w * 0.37 + drift) % (w * 1.4) - w * 0.2, cy, w * (0.22 + 0.04 * i), h * 0.012 + i * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // See
  const sea = ctx.createLinearGradient(0, horizon, 0, h);
  sea.addColorStop(0, '#5a3550');
  sea.addColorStop(0.15, '#1d2d4a');
  sea.addColorStop(1, '#060d1c');
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Wellenkämme: dichter am Horizont, länger im Vordergrund; nahe der
  // Sonnenbahn glühen sie golden.
  for (let row = 0; row < 46; row += 1) {
    const depth = row / 46;
    const y = horizon + (h - horizon) * depth ** 1.6 + 2;
    const len = 10 + depth * 70;
    const step = len * 2.4;
    const offset = ((t * (8 + depth * 30)) + row * 37) % step;
    for (let x = -step + offset; x < w + step; x += step) {
      const wobble = Math.sin(x * 0.013 + t * 1.7 + row) * 0.5 + 0.5;
      const nearSun = Math.max(0, 1 - Math.abs(x + len / 2 - sunX) / (w * (0.05 + depth * 0.12)));
      const a = (0.05 + 0.1 * wobble) + nearSun * 0.6 * wobble;
      ctx.strokeStyle = nearSun > 0.05 ? `rgba(255, 200, 130, ${a})` : `rgba(150, 190, 230, ${a * 0.8})`;
      ctx.lineWidth = 0.8 + depth * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len / 2, y - 1 - depth * 3, x + len, y);
      ctx.stroke();
    }
  }

  // Ferne Flotte am Horizont
  warship(ctx, w * 0.86, horizon + 2, h * 0.0016, -1, '#24152b', 0.5);
  warship(ctx, w * 0.95, horizon + 1, h * 0.0011, -1, '#2a1830', 0.4);

  // Einschlag beim Gegner: Wassersäule, die steigt und fällt
  const cycle = (t % 4.2) / 4.2;
  const splashK = cycle > 0.32 && cycle < 0.62 ? Math.sin(((cycle - 0.32) / 0.3) * Math.PI) : 0;
  if (splashK > 0) {
    const sx = w * 0.79;
    const sh = h * 0.16 * splashK;
    const g = ctx.createLinearGradient(0, horizon - sh, 0, horizon);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, `rgba(240, 230, 230, ${0.75 * splashK})`);
    g.addColorStop(1, `rgba(220, 210, 220, ${0.9 * splashK})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.012, horizon + 2);
    ctx.quadraticCurveTo(sx - w * 0.006, horizon - sh * 0.6, sx, horizon - sh);
    ctx.quadraticCurveTo(sx + w * 0.006, horizon - sh * 0.6, sx + w * 0.012, horizon + 2);
    ctx.fill();
  }

  // Leuchtspur der Granate im Bogen
  if (cycle < 0.32) {
    const k = cycle / 0.32;
    const from = { x: shipX + 44 * scale, y: shipY - 16 * scale };
    const to = { x: w * 0.79, y: horizon };
    const pos = (q) => ({ x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q - Math.sin(q * Math.PI) * h * 0.38 });
    ctx.strokeStyle = 'rgba(255, 210, 140, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let q = Math.max(0, k - 0.18); q <= k; q += 0.01) {
      const p = pos(q);
      if (q === Math.max(0, k - 0.18)) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    const p = pos(k);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, h * 0.02);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - h * 0.02, p.y - h * 0.02, h * 0.04, h * 0.04);
  }

  // Das eigene Schlachtschiff im Vordergrund, mit Mündungsfeuer beim Abschuss
  const flash = cycle < 0.05 ? 1 - cycle / 0.05 : 0;
  warship(ctx, shipX, shipY, scale, 1, '#0b0e18', 1, flash, t);
}

/**
 * Silhouette eines Schlachtschiffs, Wasserlinie bei `y`. Maße in Einheiten
 * von −50 (Heck) bis +52 (Bug).
 */
function warship(ctx, x, y, s, dir, color, alpha = 1, flash = 0, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * dir, s);
  ctx.globalAlpha = alpha;

  // Rauchfahne aus dem Schornstein
  if (alpha === 1) {
    for (let i = 0; i < 7; i += 1) {
      const age = ((t * 0.35 + i / 7) % 1);
      ctx.fillStyle = `rgba(30, 24, 36, ${0.35 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(-9 - age * 40, -24 - age * 12, 3 + age * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-49, -4);
  ctx.lineTo(38, -5);
  ctx.lineTo(52, -9);
  ctx.lineTo(45, 4);
  ctx.lineTo(-45, 4);
  ctx.quadraticCurveTo(-50, 1, -49, -4);
  ctx.fill();
  // Aufbauten
  ctx.fillRect(-22, -12, 34, 8);
  ctx.fillRect(-4, -20, 12, 9);
  ctx.fillRect(-1, -27, 7, 8);
  ctx.beginPath();
  ctx.moveTo(-14, -12); ctx.lineTo(-12, -24); ctx.lineTo(-6, -24); ctx.lineTo(-6, -12);
  ctx.fill();
  // Mast und Rahen
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(2, -27); ctx.lineTo(2, -40);
  ctx.moveTo(-2, -36); ctx.lineTo(6, -36);
  ctx.moveTo(-30, -6); ctx.lineTo(-30, -22);
  ctx.stroke();
  // Türme mit erhobenen Rohren
  ctx.fillRect(16, -10, 10, 5);
  ctx.fillRect(25, -13, 9, 5);
  ctx.fillRect(-37, -10, 10, 5);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(25, -8.5); ctx.lineTo(36, -12);
  ctx.moveTo(33, -11.5); ctx.lineTo(44, -16);
  ctx.moveTo(-37, -8.5); ctx.lineTo(-47, -11);
  ctx.stroke();

  // Lichtkante von der Sonne
  if (alpha === 1) {
    ctx.strokeStyle = 'rgba(255, 170, 110, 0.55)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-49, -4.4); ctx.lineTo(38, -5.4); ctx.lineTo(52, -9.4);
    ctx.moveTo(-22, -12.3); ctx.lineTo(12, -12.3);
    ctx.moveTo(-4, -20.3); ctx.lineTo(8, -20.3);
    ctx.stroke();
    // Spiegelung im Wasser
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 54, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fy] of [[44, -16], [36, -12]]) {
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 16);
      g.addColorStop(0, `rgba(255, 245, 200, ${flash})`);
      g.addColorStop(0.3, `rgba(255, 170, 60, ${0.8 * flash})`);
      g.addColorStop(1, 'rgba(255, 80, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(fx - 16, fy - 16, 32, 32);
    }
  }
  ctx.restore();
}
