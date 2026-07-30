// Rückfall-Renderer auf der 2D-Canvas-API.
//
// Erfüllt denselben Vertrag wie der WebGL2-Renderer (siehe `../render.js`),
// nur ohne Shader. Er ist bewusst schlicht gehalten: Sein Zweck ist, dass das
// Spiel auch dort spielbar bleibt, wo kein WebGL2-Kontext zustande kommt –
// alte Geräte, abgeschaltete Hardwarebeschleunigung, Kontextverlust ohne
// Wiederherstellung.

import { computeLayout, cellCenter, gridToPixel } from '../layout.js';

const PALETTE = {
  bgTop: '#070912',
  bgBottom: '#0d1226',
  grid: 'rgba(126,166,255,0.07)',
  gridEdge: 'rgba(126,166,255,0.16)',
  wall: '#0a0d18',
  wallEdge: 'rgba(120,150,220,0.25)',
  mirror: '#a8d8ff',
  mirrorLocked: '#6f7f9c',
  beamCore: '#e8f6ff',
  beamGlow: '#4aa8ff',
  source: '#ffd9a0',
  targetOff: 'rgba(150,170,210,0.45)',
  targetOn: '#ffe6a8',
};

/** Deterministischer Zufall für das Sternenfeld – gleicher Hintergrund je Level. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
/** Rahmenratenunabhängiges Annähern. */
const approach = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

export function createCanvas2dRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Lumenweber: weder WebGL2 noch 2D-Canvas verfügbar');
  let level = null;
  let session = null;
  let layout = computeLayout(1, 1, { width: 1, height: 1 });
  let cssW = 1;
  let cssH = 1;
  let insets = {};
  let dpr = 1;

  let hover = null;
  let cursor = null;
  let stars = [];
  let ripples = [];
  let celebrateAt = -1e9;
  let lastNow = 0;

  /** Animationszustände je Spiegel / Ziel, damit nichts hart umspringt. */
  let mirrorAngle = [];
  let targetGlow = [];
  let beamPhase = 0;

  function rebuildStars() {
    const random = rng(1337);
    const count = Math.round((cssW * cssH) / 9000);
    stars = Array.from({ length: Math.min(220, Math.max(40, count)) }, () => ({
      x: random(), y: random(),
      r: 0.4 + random() * 1.3,
      a: 0.15 + random() * 0.5,
      tw: 0.4 + random() * 2.2,
      ph: random() * Math.PI * 2,
    }));
  }

  function resize(width, height, nextInsets = {}) {
    cssW = Math.max(1, width);
    cssH = Math.max(1, height);
    insets = nextInsets;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (level) layout = computeLayout(cssW, cssH, level, insets);
    rebuildStars();
  }

  function setLevel(next) {
    level = next;
    mirrorAngle = level ? level.mirrors.map((m) => (m.start === '/' ? -Math.PI / 4 : Math.PI / 4)) : [];
    targetGlow = level ? level.targets.map(() => 0) : [];
    ripples = [];
    celebrateAt = -1e9;
    if (level) layout = computeLayout(cssW, cssH, level, insets);
  }

  const setSession = (next) => { session = next; };
  const setHover = (cell) => { hover = cell; };
  const setCursor = (cell) => { cursor = cell; };
  const tapAt = (x, y) => ripples.push({ x, y, t: 0 });
  const celebrate = () => { celebrateAt = performance.now(); };

  /* ---------- Zeichnen ---------- */

  function drawBackground(now) {
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, PALETTE.bgTop);
    g.addColorStop(1, PALETTE.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const a = s.a * (0.6 + 0.4 * Math.sin(now / 1000 * s.tw + s.ph));
      ctx.fillStyle = `rgba(200,225,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x * cssW, s.y * cssH, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGrid() {
    const { cell, originX, originY, boardW, boardH } = layout;
    ctx.save();
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= level.width; x += 1) {
      const px = Math.round(originX + x * cell) + 0.5;
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + boardH);
    }
    for (let y = 0; y <= level.height; y += 1) {
      const py = Math.round(originY + y * cell) + 0.5;
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + boardW, py);
    }
    ctx.stroke();

    ctx.strokeStyle = PALETTE.gridEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(originX, originY, boardW, boardH);
    ctx.restore();
  }

  function drawWalls() {
    const { cell } = layout;
    for (const c of level.cells) {
      if (c.type !== 'wall') continue;
      const { px, py } = gridToPixel(layout, c.x, c.y);
      const inset = cell * 0.06;
      ctx.fillStyle = PALETTE.wall;
      ctx.beginPath();
      ctx.roundRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2, cell * 0.14);
      ctx.fill();
      ctx.strokeStyle = PALETTE.wallEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawBeam(now) {
    if (!session?.trace) return;
    const { cell } = layout;
    const width = cell * 0.11;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const passes = [
      { w: width * 5.5, a: 0.10, c: PALETTE.beamGlow },
      { w: width * 2.6, a: 0.22, c: PALETTE.beamGlow },
      { w: width * 1.25, a: 0.55, c: PALETTE.beamCore },
      { w: width * 0.5, a: 0.95, c: '#ffffff' },
    ];

    for (const pass of passes) {
      ctx.lineWidth = pass.w;
      ctx.strokeStyle = pass.c;
      ctx.globalAlpha = pass.a;
      ctx.beginPath();
      for (const points of session.trace.paths) {
        points.forEach((p, i) => {
          const px = layout.originX + p.x * cell;
          const py = layout.originY + p.y * cell;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
      }
      ctx.stroke();
    }

    // Energie, die sichtbar durch den Faden läuft.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = width * 0.9;
    ctx.setLineDash([cell * 0.12, cell * 0.5]);
    ctx.lineDashOffset = -beamPhase;
    ctx.beginPath();
    for (const points of session.trace.paths) {
      points.forEach((p, i) => {
        const px = layout.originX + p.x * cell;
        const py = layout.originY + p.y * cell;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawSources(now) {
    const { cell } = layout;
    for (const s of level.sources) {
      const { px, py } = cellCenter(layout, s.x, s.y);
      const pulse = 0.85 + 0.15 * Math.sin(now / 320);
      const r = cell * 0.3 * pulse;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(px, py, 0, px, py, cell * 0.75);
      g.addColorStop(0, 'rgba(255,225,170,0.95)');
      g.addColorStop(0.4, 'rgba(255,180,90,0.35)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = PALETTE.source;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      // Richtungsnase
      const angle = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 }[s.dir];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillStyle = '#fff6e0';
      ctx.beginPath();
      ctx.moveTo(cell * 0.34, 0);
      ctx.lineTo(cell * 0.14, -cell * 0.13);
      ctx.lineTo(cell * 0.14, cell * 0.13);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTargets(now) {
    const { cell } = layout;
    level.targets.forEach((t, i) => {
      const { px, py } = cellCenter(layout, t.x, t.y);
      const lit = targetGlow[i];
      const r = cell * 0.26;

      if (lit > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(px, py, 0, px, py, cell * (0.55 + 0.35 * lit));
        g.addColorStop(0, `rgba(255,240,200,${0.9 * lit})`);
        g.addColorStop(0.45, `rgba(255,200,110,${0.35 * lit})`);
        g.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.lineWidth = Math.max(2, cell * 0.055);
      ctx.strokeStyle = lit > 0.5 ? PALETTE.targetOn : PALETTE.targetOff;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();

      const inner = r * (0.35 + 0.25 * lit * (0.9 + 0.1 * Math.sin(now / 260)));
      ctx.fillStyle = lit > 0.5 ? '#fff8e6' : 'rgba(150,170,210,0.35)';
      ctx.beginPath();
      ctx.arc(px, py, inner, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawMirrors(now) {
    const { cell } = layout;
    level.mirrors.forEach((m, i) => {
      const { px, py } = cellCenter(layout, m.x, m.y);
      const angle = mirrorAngle[i];
      const half = cell * 0.34;
      const isLit = session?.trace?.litMirrors.has(i);
      const isHover = hover && hover.x === m.x && hover.y === m.y && !m.locked;

      ctx.save();
      ctx.translate(px, py);

      // Fassung: drehbare Spiegel bekommen einen hellen Ring, feste einen dunklen.
      ctx.beginPath();
      ctx.arc(0, 0, cell * 0.42, 0, Math.PI * 2);
      ctx.strokeStyle = m.locked
        ? 'rgba(110,125,155,0.55)'
        : `rgba(150,200,255,${isHover ? 0.7 : 0.32})`;
      ctx.lineWidth = m.locked ? Math.max(2, cell * 0.05) : Math.max(1.5, cell * 0.032);
      if (m.locked) ctx.setLineDash([cell * 0.1, cell * 0.07]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.rotate(angle);
      if (isLit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(120,200,255,0.35)';
        ctx.lineWidth = cell * 0.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(half, 0);
        ctx.stroke();
        ctx.restore();
      }

      const g = ctx.createLinearGradient(0, -cell * 0.06, 0, cell * 0.06);
      g.addColorStop(0, m.locked ? '#c7d2e6' : '#ffffff');
      g.addColorStop(0.5, m.locked ? PALETTE.mirrorLocked : PALETTE.mirror);
      g.addColorStop(1, m.locked ? '#3d465c' : '#3f7fbf');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(3, cell * 0.11);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-half, 0);
      ctx.lineTo(half, 0);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawOverlays(now) {
    const { cell } = layout;

    for (const r of ripples) {
      const { px, py } = cellCenter(layout, r.x, r.y);
      const t = r.t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.6;
      ctx.strokeStyle = '#9fd7ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, cell * (0.2 + t * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (cursor) {
      const { px, py } = cellCenter(layout, cursor.x, cursor.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(px - cell * 0.46, py - cell * 0.46, cell * 0.92, cell * 0.92);
      ctx.restore();
    }

    const since = (now - celebrateAt) / 1000;
    if (since >= 0 && since < 1.4) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, 0.35 * (1 - since / 1.4));
      ctx.fillStyle = '#bfe4ff';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastNow) / 1000 || 0.016);
    lastNow = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    drawBackground(now);
    if (!level || !session) return;

    // Zustände weich nachführen
    session.orientations.forEach((o, i) => {
      const target = o === '/' ? -Math.PI / 4 : Math.PI / 4;
      mirrorAngle[i] = approach(mirrorAngle[i], target, 18, dt);
    });
    level.targets.forEach((t, i) => {
      const on = session.trace.litTargets.has(`${t.x},${t.y}`) ? 1 : 0;
      targetGlow[i] = approach(targetGlow[i], on, 10, dt);
    });
    beamPhase = (beamPhase + dt * layout.cell * 2.4) % 100000;
    ripples = ripples.filter((r) => (r.t += dt * 2.2) < 1);

    drawGrid();
    drawWalls();
    drawBeam(now);
    drawTargets(now);
    drawMirrors(now);
    drawSources(now);
    drawOverlays(now);
  }

  return {
    backend: '2d',
    setLevel, setSession, resize, setHover, setCursor, tapAt, celebrate, frame,
    get layout() { return layout; },
    dispose() { /* nichts zu räumen */ },
  };
}
