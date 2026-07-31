// Rückfall-Renderer auf der 2D-Canvas-API.
//
// Erfüllt denselben Vertrag wie der WebGL2-Renderer (siehe `../render.js`),
// nur ohne Shader. Er ist bewusst schlicht gehalten: Sein Zweck ist, dass das
// Spiel auch dort spielbar bleibt, wo kein WebGL2-Kontext zustande kommt –
// alte Geräte, abgeschaltete Hardwarebeschleunigung, Kontextverlust ohne
// Wiederherstellung.
//
// Schlicht heißt aber nicht unvollständig: Jedes Bauteil und jede Lichtfarbe,
// die das Spiel kennt, muss auch hier gezeichnet werden. Ein Prisma, das man
// nicht sieht, macht das Level unlösbar.

import { computeLayout, cellCenter, gridToPixel } from '../layout.js';
import { deviceState } from '../level.js';
import { beamCss, TARGET_CSS, TARGET_DIM_CSS } from './palette.js';
// Die Eckenzahl ist Auskunft, keine Zierde – sie kommt aus derselben Quelle wie
// die Legende, damit Brett und Erklärung nie verschiedene Formen zeigen.
import { NODE_CORNERS } from '../nodes.js';

const PALETTE = {
  bgTop: '#070912',
  bgBottom: '#0d1226',
  grid: 'rgba(126,166,255,0.07)',
  gridEdge: 'rgba(126,166,255,0.16)',
  wall: '#0a0d18',
  wallEdge: 'rgba(120,150,220,0.25)',
  mirror: '#a8d8ff',
  mirrorLocked: '#6f7f9c',
  prismAmber: '#ffb343',
  prismCyan: '#4de6ff',
  socket: 'rgba(150,200,255,0.55)',
  source: '#ffd9a0',
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

const angleOf = (orient) => (orient === '\\' ? Math.PI / 4 : -Math.PI / 4);

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

  /** Animationszustände je Bauteil / Ziel, damit nichts hart umspringt. */
  let deviceAngle = [];
  let devicePresence = [];
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

  // `options.animate` kennt der 2D-Rückfall nicht – er webt den Faden ohnehin
  // nicht ein, sondern zeichnet ihn fertig. Die Signatur bleibt trotzdem gleich.
  function setLevel(next) {
    level = next;
    const devices = level ? level.devices : [];
    deviceAngle = devices.map((d) => angleOf(d.states[d.start]));
    devicePresence = devices.map((d) => (d.states[d.start] === null ? 0 : 1));
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

  /** Eine Polylinie in Pixel übersetzen. */
  function tracePath(points) {
    const { cell, originX, originY } = layout;
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = originX + p.x * cell;
      const py = originY + p.y * cell;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
  }

  /**
   * Der Lichtfaden – vier gestapelte Striche je Linie, von weit und schwach
   * nach schmal und hell. Die Farbe hängt an der Linie: Hinter einem Prisma
   * laufen Bernstein und Cyan getrennt, und wo sie sich wieder treffen, legt
   * die additive Mischung sie von selbst zu Weiß zusammen.
   */
  function drawBeam() {
    if (!session?.trace) return;
    const { cell } = layout;
    const width = cell * 0.11;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const { points, colors } of session.trace.paths) {
      const css = beamCss(colors);
      const passes = [
        { w: width * 5.5, a: 0.10, c: css.glow },
        { w: width * 2.6, a: 0.22, c: css.glow },
        { w: width * 1.25, a: 0.55, c: css.core },
        { w: width * 0.5, a: 0.95, c: '#ffffff' },
      ];
      for (const pass of passes) {
        ctx.lineWidth = pass.w;
        ctx.strokeStyle = pass.c;
        ctx.globalAlpha = pass.a;
        tracePath(points);
        ctx.stroke();
      }
    }

    // Energie, die sichtbar durch den Faden läuft.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = width * 0.9;
    ctx.setLineDash([cell * 0.12, cell * 0.5]);
    ctx.lineDashOffset = -beamPhase;
    for (const { points } of session.trace.paths) {
      tracePath(points);
      ctx.stroke();
    }
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
      const tint = TARGET_CSS[t.want];
      // Wartend trägt der Knoten denselben Farbton, nur leise – erst dadurch
      // sieht man beim Lösen, welches Licht er verlangt.
      const dim = TARGET_DIM_CSS[t.want];
      const corners = NODE_CORNERS[t.want];

      if (lit > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(px, py, 0, px, py, cell * (0.55 + 0.35 * lit));
        g.addColorStop(0, `rgba(255,255,255,${0.7 * lit})`);
        g.addColorStop(0.45, tint);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55 * lit;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(px, py);
      ctx.lineWidth = Math.max(2, cell * 0.055);
      ctx.strokeStyle = lit > 0.5 ? tint : dim;

      // Kreis für „jedes Licht“, sonst ein Vieleck – die Form nennt die Farbe
      // auch dann, wenn man Farben schlecht unterscheidet.
      ctx.beginPath();
      if (corners === 0) {
        ctx.arc(0, 0, r, 0, Math.PI * 2);
      } else {
        for (let k = 0; k < corners; k += 1) {
          // Halbe Segmentbreite versetzt: oben liegt eine Fläche, keine Spitze –
          // genauso rechnet es der Shader in `sprite.js`.
          const a = -Math.PI / 2 + ((k + 0.5) / corners) * Math.PI * 2;
          const fx = Math.cos(a) * r;
          const fy = Math.sin(a) * r;
          if (k === 0) ctx.moveTo(fx, fy); else ctx.lineTo(fx, fy);
        }
        ctx.closePath();
      }
      ctx.stroke();

      // Der Weißknoten trägt einen zweiten Reif: Er will beide Farben.
      if (t.want === 'white') {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, cell * 0.03);
        ctx.stroke();
      }

      const inner = r * (0.35 + 0.25 * lit * (0.9 + 0.1 * Math.sin(now / 260)));
      ctx.fillStyle = lit > 0.5 ? '#fff8e6' : dim;
      ctx.beginPath();
      ctx.arc(0, 0, inner, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /** Ein Spiegel: eine schmale Glasscheibe auf der Diagonalen. */
  function strokeMirror(cell, locked, lit) {
    const half = cell * 0.34;
    if (lit) {
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
    g.addColorStop(0, locked ? '#c7d2e6' : '#ffffff');
    g.addColorStop(0.5, locked ? PALETTE.mirrorLocked : PALETTE.mirror);
    g.addColorStop(1, locked ? '#3d465c' : '#3f7fbf');
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(3, cell * 0.11);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
  }

  /**
   * Ein Prisma: ein Glaskeil auf der Diagonalen, dessen Flanken die beiden
   * Grundfarben tragen. Oben biegt Cyan ab, unten läuft Bernstein durch.
   */
  function strokePrism(cell, locked, lit, scale) {
    const half = cell * 0.38 * scale;
    const thick = cell * 0.21 * scale;

    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4;
      const flare = ctx.createLinearGradient(0, -thick * 2, 0, thick * 2);
      flare.addColorStop(0, PALETTE.prismCyan);
      flare.addColorStop(0.5, '#ffffff');
      flare.addColorStop(1, PALETTE.prismAmber);
      ctx.fillStyle = flare;
      ctx.beginPath();
      ctx.ellipse(0, 0, half * 1.2, thick * 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const g = ctx.createLinearGradient(0, -thick, 0, thick);
    g.addColorStop(0, locked ? '#2c5f70' : PALETTE.prismCyan);
    g.addColorStop(0.5, locked ? '#e8eef6' : '#ffffff');
    g.addColorStop(1, locked ? '#6b4a20' : PALETTE.prismAmber);
    ctx.fillStyle = g;
    ctx.globalAlpha = locked ? 0.75 : 1;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(0, -thick);
    ctx.lineTo(half, 0);
    ctx.lineTo(0, thick);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1, cell * 0.018);
    ctx.stroke();
  }

  /**
   * Eine leere Fassung: vier Eckwinkel am Zellenrand und innen der gestrichelte
   * Umriss dessen, was hineingehört.
   *
   * Die Eckwinkel sitzen bewusst weit außen – eine Fassung liegt oft mitten im
   * hellen Strahl, und der überstrahlt alles innerhalb seines Hofs.
   */
  function strokeSocket(cell, ready, isHover, now) {
    const half = cell * 0.38;
    const thick = cell * 0.21;
    const r = cell * 0.42;
    const arm = cell * 0.16;
    const breathe = ready ? 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(now / 500)) : 0.45;

    ctx.save();
    ctx.globalAlpha = breathe * (isHover ? 1 : 0.85);
    ctx.strokeStyle = isHover || ready ? '#c8ecff' : PALETTE.socket;
    ctx.lineCap = 'round';

    ctx.lineWidth = Math.max(2, cell * 0.045);
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.moveTo(sx * r, sy * (r - arm));
        ctx.lineTo(sx * r, sy * r);
        ctx.lineTo(sx * (r - arm), sy * r);
      }
    }
    ctx.stroke();

    ctx.globalAlpha *= 0.7;
    ctx.lineWidth = Math.max(1.5, cell * 0.032);
    ctx.setLineDash([cell * 0.08, cell * 0.06]);
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(0, -thick);
    ctx.lineTo(half, 0);
    ctx.lineTo(0, thick);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawDevices(now) {
    const { cell } = layout;
    const ready = session.prismsLeft > 0;
    level.devices.forEach((device, i) => {
      const { px, py } = cellCenter(layout, device.x, device.y);
      const isLit = session?.trace?.litDevices.has(i);
      const isHover = Boolean(hover && hover.x === device.x && hover.y === device.y && !device.locked);
      const presence = devicePresence[i];

      ctx.save();
      ctx.translate(px, py);

      if (device.kind === 'socket' && presence < 0.995) {
        strokeSocket(cell, ready, isHover, now);
      }

      if (presence > 0.005) {
        // Fassung: bewegliche Bauteile bekommen einen hellen Ring, feste einen
        // dunklen, gestrichelten.
        ctx.globalAlpha = presence;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.42, 0, Math.PI * 2);
        ctx.strokeStyle = device.locked
          ? 'rgba(110,125,155,0.55)'
          : `rgba(150,200,255,${isHover ? 0.7 : 0.32})`;
        ctx.lineWidth = device.locked ? Math.max(2, cell * 0.05) : Math.max(1.5, cell * 0.032);
        if (device.locked) ctx.setLineDash([cell * 0.1, cell * 0.07]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.rotate(deviceAngle[i]);
        if (device.kind === 'mirror') strokeMirror(cell, device.locked, isLit);
        else strokePrism(cell, device.locked, isLit, presence);
      }
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
    level.devices.forEach((device, i) => {
      const orient = deviceState(level, session.config, device);
      devicePresence[i] = approach(devicePresence[i], orient === null ? 0 : 1, 16, dt);
      if (orient !== null) deviceAngle[i] = approach(deviceAngle[i], angleOf(orient), 18, dt);
    });
    level.targets.forEach((t, i) => {
      const on = session.trace.litTargets.has(`${t.x},${t.y}`) ? 1 : 0;
      targetGlow[i] = approach(targetGlow[i], on, 10, dt);
    });
    beamPhase = (beamPhase + dt * layout.cell * 2.4) % 100000;
    ripples = ripples.filter((r) => (r.t += dt * 2.2) < 1);

    drawGrid();
    drawWalls();
    drawBeam();
    drawTargets(now);
    drawDevices(now);
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
