// Canvas-Renderer: zeichnet die Karte (vorgerenderter Hintergrund), Knoten,
// Einheiten-Token, Planungs-Overlays, Wetter und Effekte. Keine Spiellogik.

import { FACTIONS, enemyOf, edgePoint, shortestPath } from './map.js';
import { paintTerrain, mulberry32 } from './terrain.js';
import { createEffects } from './effects.js';

const TAU = Math.PI * 2;

export function createRenderer(canvas, map) {
  const W = map.width;
  const H = map.height;
  const ctx = canvas.getContext('2d');
  const bg = document.createElement('canvas');
  const effects = createEffects(map);
  let scale = 1;
  let anim = 0; // fortlaufende Animationszeit in Sekunden
  let frameDt = 0;

  // Zwei Schneeschichten: ferner Schleier und nahe, große Flocken.
  const snow = [];
  {
    const rnd = mulberry32(7);
    for (let i = 0; i < 110; i++) {
      const near = i < 40;
      snow.push({
        x: rnd() * W,
        y: rnd() * H,
        r: near ? 1.4 + rnd() * 1.6 : 0.6 + rnd() * 1.1,
        vy: near ? 26 + rnd() * 26 : 10 + rnd() * 14,
        drift: rnd() * TAU,
        a: near ? 0.55 : 0.3,
      });
    }
  }

  function resize() {
    const cssWidth = canvas.clientWidth || W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    scale = (cssWidth * dpr) / W;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    paintBackground();
  }

  function paintBackground() {
    bg.width = canvas.width;
    bg.height = canvas.height;
    const b = bg.getContext('2d');
    b.setTransform(scale, 0, 0, scale, 0, 0);
    paintTerrain(b, map);
  }

  // ---------------------------------------------------------------- Bausteine
  function label(x, y, text, opts = {}) {
    const family = opts.serif ? "Georgia, 'Times New Roman', serif" : 'system-ui, sans-serif';
    ctx.font = `${opts.weight ?? 500} ${opts.size ?? 11}px ${family}`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,8,13,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = opts.color ?? (opts.serif ? '#cfc39a' : '#aebacd');
    ctx.fillText(text, x, y);
  }

  // Wehende Schwalbenschwanz-Flagge, Mastspitze bei (x, y).
  function traceFlag(x, y, len, h, t) {
    const wave = (k, row) => Math.sin(t * 3.1 + k * 2.6 + row) * 2.4 * k;
    const seg = 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 1; i <= seg; i++) {
      const k = i / seg;
      ctx.lineTo(x + len * k, y + wave(k, 0));
    }
    ctx.lineTo(x + len * 0.7, y + h / 2 + wave(0.7, 1.6));
    ctx.lineTo(x + len, y + h + wave(1, 3.2));
    for (let i = seg - 1; i >= 0; i--) {
      const k = i / seg;
      ctx.lineTo(x + len * k, y + h + wave(k, 3.2));
    }
    ctx.closePath();
  }

  // Flackernde Fackel-/Feuerschalenflamme.
  function drawFlame(x, y, phase) {
    const f = Math.sin(anim * 11 + phase) * 0.5 + Math.sin(anim * 17.3 + phase * 2) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = 7 + f * 1.5;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    glow.addColorStop(0, 'rgba(255,160,70,0.30)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,170,80,0.85)';
    ctx.beginPath();
    ctx.ellipse(x, y - 1 - f, 2.6, 4.2 + f, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,170,0.9)';
    ctx.beginPath();
    ctx.ellipse(x, y - f * 0.6, 1.3, 2.2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBrazier(x, y) {
    ctx.fillStyle = '#1a212e';
    ctx.fillRect(x - 1.5, y + 2, 3, 6);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#2b3547';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
    drawFlame(x, y - 4, x * 0.7 + y);
  }

  // Kampfpunkt: Steinsockel mit Fahnenmast, Flagge in der Farbe der
  // haltenden Fraktion (neutral grau), umkämpft mit pulsierendem Ring.
  function drawFlagNode(n, owner, ring) {
    const phase = n.x * 0.05 + n.y * 0.07;
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 6, 13, 5.5, 0, 0, TAU);
    ctx.fillStyle = 'rgba(6,10,18,0.5)';
    ctx.fill();
    const base = ctx.createRadialGradient(n.x - 3, n.y - 3, 1, n.x, n.y, 9);
    base.addColorStop(0, '#5f6d88');
    base.addColorStop(1, '#303a4e');
    ctx.beginPath();
    ctx.arc(n.x, n.y, 8.5, 0, TAU);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(n.x, n.y, 6, -TAU * 0.42, -TAU * 0.12);
    ctx.strokeStyle = 'rgba(228,240,252,0.5)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Mast
    ctx.strokeStyle = '#0a0f18';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y + 2);
    ctx.lineTo(n.x, n.y - 27);
    ctx.stroke();
    ctx.strokeStyle = '#9a7a4e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y + 2);
    ctx.lineTo(n.x, n.y - 27);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(n.x, n.y - 28, 1.8, 0, TAU);
    ctx.fillStyle = '#e6d9a8';
    ctx.fill();
    // Flagge
    const c = owner ? FACTIONS[owner] : null;
    traceFlag(n.x + 1, n.y - 26, 21, 12, anim + phase);
    const grad = ctx.createLinearGradient(n.x, 0, n.x + 22, 0);
    grad.addColorStop(0, c ? c.color : '#7c88a2');
    grad.addColorStop(1, c ? c.dark : '#454f64');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(8,12,20,0.85)';
    ctx.stroke();
    if (ring) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 19, 0, TAU);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = ring;
      ctx.stroke();
    }
  }

  // Friedhof: Grabsteine im pulsierenden Geisterlicht mit kreisenden Wisps.
  // Der Besitzring zeigt die haltende Fraktion (neutral grau); eine laufende
  // Einnahme wird als wachsender Fortschrittsbogen in der Farbe der
  // einnehmenden Fraktion dargestellt.
  function drawGraveyard(n, owner, capture) {
    const pulse = 0.5 + 0.5 * Math.sin(anim * 2 + n.y);
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 8, 16, 6.5, 0, 0, TAU);
    ctx.fillStyle = 'rgba(226,238,252,0.10)';
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 26);
    glow.addColorStop(0, `rgba(150,220,255,${0.10 + 0.08 * pulse})`);
    glow.addColorStop(1, 'rgba(150,220,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 26, 0, TAU);
    ctx.fill();
    const beam = ctx.createLinearGradient(0, n.y - 34, 0, n.y + 6);
    beam.addColorStop(0, 'rgba(170,225,255,0)');
    beam.addColorStop(1, `rgba(170,225,255,${0.07 + 0.05 * pulse})`);
    ctx.fillStyle = beam;
    ctx.fillRect(n.x - 6, n.y - 34, 12, 40);
    ctx.restore();
    // Kleine Nebensteine
    for (const [dx, s] of [
      [-11, 4.5],
      [11, 4],
    ]) {
      ctx.beginPath();
      ctx.moveTo(n.x + dx - s, n.y + 8);
      ctx.lineTo(n.x + dx - s, n.y + 2);
      ctx.arc(n.x + dx, n.y + 2, s, Math.PI, 0);
      ctx.lineTo(n.x + dx + s, n.y + 8);
      ctx.closePath();
      ctx.fillStyle = '#3e4759';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#0a0f18';
      ctx.stroke();
    }
    // Hauptgrabstein mit Kreuz
    ctx.beginPath();
    ctx.moveTo(n.x - 6, n.y + 9);
    ctx.lineTo(n.x - 6, n.y - 4);
    ctx.arc(n.x, n.y - 4, 6, Math.PI, 0);
    ctx.lineTo(n.x + 6, n.y + 9);
    ctx.closePath();
    ctx.fillStyle = '#4a5468';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,238,252,0.6)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y - 6);
    ctx.lineTo(n.x, n.y + 2);
    ctx.moveTo(n.x - 3, n.y - 3);
    ctx.lineTo(n.x + 3, n.y - 3);
    ctx.stroke();
    // Kreisende Geisterlichter
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const wx = n.x + Math.cos(anim * 1.3 + i * Math.PI) * 11;
      const wy = n.y - 6 + Math.sin(anim * 0.9 + i * 2.1) * 5;
      const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, 4);
      g.addColorStop(0, 'rgba(190,235,255,0.7)');
      g.addColorStop(1, 'rgba(190,235,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(wx, wy, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(n.x, n.y + 2, 14, 0, TAU);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = owner ? `${FACTIONS[owner].color}55` : 'rgba(124,136,162,0.35)';
    ctx.stroke();
    if (capture) {
      ctx.beginPath();
      ctx.arc(n.x, n.y + 2, 19, 0, TAU);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(226,238,252,0.18)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.x, n.y + 2, 19, -Math.PI / 2, -Math.PI / 2 + TAU * capture.frac);
      ctx.lineCap = 'round';
      ctx.strokeStyle = capture.color;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  // Lebensanzeige: Balken mit aktuellem/maximalem Hitpoint-Stand darüber.
  function drawHpBar(cx, top, w, hp, maxHp, opts = {}) {
    const h = opts.h ?? 5;
    const x = cx - w / 2;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    const shown = hp > 0 ? Math.max(1, Math.round(hp)) : 0;
    ctx.fillStyle = 'rgba(5,8,13,0.85)';
    ctx.fillRect(x - 1.5, top - 1.5, w + 3, h + 3);
    ctx.fillStyle = '#2a3346';
    ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ratio > 0.5 ? '#6ecf73' : ratio > 0.25 ? '#ffd76a' : '#ff6b5e';
    ctx.fillRect(x, top, w * ratio, h);
    if (opts.gold) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#a8854a';
      ctx.strokeRect(x - 1.5, top - 1.5, w + 3, h + 3);
    }
    label(cx, top - 7, `${shown}/${Math.round(maxHp)}`, { size: 9, weight: 700, color: '#e6eefb' });
  }

  // Festung: Turm mit Seitenmauern, Feuerschalen, leuchtenden Schießscharten
  // und großem Fraktionsbanner. Zerstört: dunkel, rissig, rauchend.
  function drawKeep(n, alive, bossState) {
    const c = FACTIONS[n.faction];
    const w = 40;
    const h = 46;
    const x0 = n.x - w / 2;
    const y0 = n.y - h / 2 - 4;
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 18, 42, 12, 0, 0, TAU);
    ctx.fillStyle = 'rgba(10,15,24,0.6)';
    ctx.fill();
    // Seitenmauern mit Zinnen und Schneeauflage
    for (const side of [-1, 1]) {
      const mx = side === -1 ? x0 - 15 : x0 + w;
      const my = y0 + h - 22;
      const mg = ctx.createLinearGradient(0, my, 0, my + 22);
      mg.addColorStop(0, alive ? '#4d5972' : '#333a49');
      mg.addColorStop(1, alive ? '#2c3548' : '#202531');
      ctx.fillStyle = mg;
      ctx.fillRect(mx, my, 15, 22);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0a0f18';
      ctx.strokeRect(mx, my, 15, 22);
      ctx.fillStyle = alive ? '#4d5972' : '#333a49';
      ctx.fillRect(mx + 1, my - 4, 4.5, 4.5);
      ctx.fillRect(mx + 9, my - 4, 4.5, 4.5);
      ctx.fillStyle = 'rgba(226,238,252,0.4)';
      ctx.fillRect(mx + 1, my - 4, 4.5, 1.4);
      ctx.fillRect(mx + 9, my - 4, 4.5, 1.4);
    }
    // Turmkörper mit Steinfugen
    const stone = ctx.createLinearGradient(x0, y0, x0, y0 + h);
    stone.addColorStop(0, alive ? '#68748f' : '#3a4150');
    stone.addColorStop(1, alive ? '#333d52' : '#242a36');
    ctx.fillStyle = stone;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(10,15,24,0.28)';
    ctx.lineWidth = 1;
    for (let row = 0; row < 5; row++) {
      const yy = y0 + 8 + row * 8;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, yy);
      ctx.lineTo(x0 + w - 1, yy);
      ctx.stroke();
      for (let vx = x0 + (row % 2 ? 9 : 15); vx < x0 + w - 3; vx += 12) {
        ctx.beginPath();
        ctx.moveTo(vx, yy - 8);
        ctx.lineTo(vx, yy);
        ctx.stroke();
      }
    }
    // Zinnen mit Schnee
    for (let i = 0; i < 4; i++) {
      const zx = x0 + i * (w / 3.6);
      ctx.fillStyle = alive ? '#68748f' : '#3a4150';
      ctx.fillRect(zx, y0 - 6, w / 6, 7);
      ctx.fillStyle = 'rgba(226,238,252,0.45)';
      ctx.fillRect(zx, y0 - 6, w / 6, 2);
    }
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0a0f18';
    ctx.strokeRect(x0, y0, w, h);
    // Schießscharten mit warmem, flackerndem Licht
    for (const sx of [n.x - 9, n.x + 9]) {
      if (alive) {
        const flick = 0.7 + 0.3 * Math.sin(anim * 9 + sx);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(sx, y0 + 14, 0, sx, y0 + 14, 8);
        g.addColorStop(0, `rgba(255,180,90,${0.25 * flick})`);
        g.addColorStop(1, 'rgba(255,180,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, y0 + 14, 8, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = `rgba(255,210,122,${flick})`;
      } else {
        ctx.fillStyle = '#1a212e';
      }
      ctx.fillRect(sx - 1.5, y0 + 10, 3, 8);
    }
    // Tor mit Metallbändern
    ctx.beginPath();
    ctx.moveTo(n.x - 7, y0 + h);
    ctx.lineTo(n.x - 7, y0 + h - 13);
    ctx.arc(n.x, y0 + h - 13, 7, Math.PI, 0);
    ctx.lineTo(n.x + 7, y0 + h);
    ctx.closePath();
    ctx.fillStyle = '#171c28';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190,200,220,0.25)';
    ctx.lineWidth = 1.2;
    for (const gy of [y0 + h - 4, y0 + h - 9]) {
      ctx.beginPath();
      ctx.moveTo(n.x - 6.5, gy);
      ctx.lineTo(n.x + 6.5, gy);
      ctx.stroke();
    }
    if (alive) {
      // Feuerschalen auf den Seitenmauern
      drawBrazier(x0 - 7.5, y0 + h - 26);
      drawBrazier(x0 + w + 7.5, y0 + h - 26);
      // Banner
      ctx.strokeStyle = '#0a0f18';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(n.x, y0 - 6);
      ctx.lineTo(n.x, y0 - 30);
      ctx.stroke();
      ctx.strokeStyle = '#9a7a4e';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(n.x, y0 - 6);
      ctx.lineTo(n.x, y0 - 30);
      ctx.stroke();
      traceFlag(n.x + 1, y0 - 29, 20, 12, anim + n.y * 0.02);
      const bg2 = ctx.createLinearGradient(n.x, 0, n.x + 21, 0);
      bg2.addColorStop(0, c.color);
      bg2.addColorStop(1, c.dark);
      ctx.fillStyle = bg2;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(8,12,20,0.85)';
      ctx.stroke();
      drawHpBar(n.x, y0 - 40, 54, bossState.hp, bossState.maxHp, { gold: true, h: 6 });
    } else {
      // Risse und aufsteigender Rauch
      ctx.strokeStyle = 'rgba(8,12,18,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(n.x - 4, y0 + 2);
      ctx.lineTo(n.x - 10, y0 + 16);
      ctx.lineTo(n.x - 5, y0 + 30);
      ctx.lineTo(n.x - 12, y0 + h - 4);
      ctx.moveTo(n.x + 8, y0 + 4);
      ctx.lineTo(n.x + 4, y0 + 20);
      ctx.lineTo(n.x + 12, y0 + 34);
      ctx.stroke();
      if (Math.random() < frameDt * 4) {
        effects.smoke(n.x + (Math.random() - 0.5) * 22, y0 + 4);
      }
    }
  }

  // Zwei Hex-Farben mischen (t = 0 → a, t = 1 → b).
  function mixHex(a, b, t) {
    const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const m = (i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t);
    return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
  }

  // Wachturm auf einem Kampfknoten: schlanker Steinturm in der Fraktionsfarbe
  // mit Zinnen, Fraktionsbanner, Schießscharte und Lebensanzeige. Zerstört:
  // dunkel, rissig, ohne Banner und rauchend. `info` = { faction, hp, maxHp,
  // alive, engaged }; `ring` markiert einen laufenden Kampf am Knoten.
  function drawTower(n, info, ring) {
    const alive = info.alive;
    const c = FACTIONS[info.faction];
    // Fraktionsgetönter Stein: klar erkennbare Fraktionsfarbe, aber steinern
    // gedämpft, damit der Turm in die winterliche Szene passt.
    const bodyTop = alive ? mixHex(c.color, '#6b7488', 0.5) : '#3a4150';
    const bodyBot = alive ? mixHex(c.dark, '#2a3140', 0.42) : '#242a36';
    const crenel = alive ? mixHex(c.color, '#586377', 0.42) : '#333a49';
    const w = 22;
    const h = alive ? 34 : 22;
    const x0 = n.x - w / 2;
    const y0 = n.y - h / 2 - 4;
    // Schatten
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 15, 19, 6.5, 0, 0, TAU);
    ctx.fillStyle = 'rgba(10,15,24,0.55)';
    ctx.fill();
    // Fraktions-Basisring (immer sichtbar – klare Zuordnung der Fraktion)
    ctx.beginPath();
    ctx.arc(n.x, n.y + 11, 15, 0, TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = alive ? c.color : 'rgba(120,132,152,0.55)';
    ctx.globalAlpha = alive ? 0.75 : 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Turmkörper mit Steinfugen – in der Fraktionsfarbe getönt.
    const stone = ctx.createLinearGradient(x0, y0, x0, y0 + h);
    stone.addColorStop(0, bodyTop);
    stone.addColorStop(1, bodyBot);
    ctx.fillStyle = stone;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(10,15,24,0.28)';
    ctx.lineWidth = 1;
    for (let row = 1; row * 8 < h - 2; row++) {
      const yy = y0 + row * 8;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, yy);
      ctx.lineTo(x0 + w - 1, yy);
      ctx.stroke();
    }
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#0a0f18';
    ctx.strokeRect(x0, y0, w, h);
    // Auskragung mit Zinnen (und Schneeauflage) – ebenfalls fraktionsgetönt.
    const cw = w + 8;
    const cx0 = n.x - cw / 2;
    ctx.fillStyle = crenel;
    ctx.fillRect(cx0, y0 - 8, cw, 8);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0a0f18';
    ctx.strokeRect(cx0, y0 - 8, cw, 8);
    for (let i = 0; i < 4; i++) {
      const zx = cx0 + i * (cw / 3.5);
      ctx.fillStyle = crenel;
      ctx.fillRect(zx, y0 - 13, cw / 6.5, 6);
      ctx.fillStyle = 'rgba(226,238,252,0.45)';
      ctx.fillRect(zx, y0 - 13, cw / 6.5, 1.6);
    }
    // Schießscharte
    if (alive) {
      const flick = 0.7 + 0.3 * Math.sin(anim * 9 + n.x);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(n.x, y0 + 15, 0, n.x, y0 + 15, 7);
      g.addColorStop(0, `rgba(255,190,100,${0.25 * flick})`);
      g.addColorStop(1, 'rgba(255,190,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, y0 + 15, 7, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = `rgba(255,208,120,${flick})`;
    } else {
      ctx.fillStyle = '#1a212e';
    }
    ctx.fillRect(n.x - 1.5, y0 + 11, 3, 9);
    if (alive) {
      // Fraktionsbanner an kurzem Mast
      ctx.strokeStyle = '#0a0f18';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(n.x, y0 - 12);
      ctx.lineTo(n.x, y0 - 30);
      ctx.stroke();
      ctx.strokeStyle = '#9a7a4e';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(n.x, y0 - 12);
      ctx.lineTo(n.x, y0 - 30);
      ctx.stroke();
      traceFlag(n.x + 1, y0 - 29, 16, 9, anim + n.x * 0.02);
      const bg2 = ctx.createLinearGradient(n.x, 0, n.x + 17, 0);
      bg2.addColorStop(0, c.color);
      bg2.addColorStop(1, c.dark);
      ctx.fillStyle = bg2;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(8,12,20,0.85)';
      ctx.stroke();
      drawHpBar(n.x, y0 - 44, 34, info.hp, info.maxHp);
    } else {
      // Risse und aufsteigender Rauch
      ctx.strokeStyle = 'rgba(8,12,18,0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(n.x - 3, y0 + 1);
      ctx.lineTo(n.x - 6, y0 + 10);
      ctx.lineTo(n.x - 2, y0 + h - 2);
      ctx.moveTo(n.x + 5, y0 + 3);
      ctx.lineTo(n.x + 2, y0 + 12);
      ctx.stroke();
      if (Math.random() < frameDt * 2.5) {
        effects.smoke(n.x + (Math.random() - 0.5) * 14, y0 + 2);
      }
    }
    if (ring) {
      ctx.beginPath();
      ctx.arc(n.x, n.y + 4, 20, 0, TAU);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = ring;
      ctx.stroke();
    }
  }

  // Turminfo eines Knotens: im Gefecht aus der Simulation, sonst aus der
  // Kartenmarkierung + Konfiguration (Anzahl aktiver Türme je Fraktion).
  function towerInfoAt(nodeId, view) {
    if (view.sim) {
      const tw = view.sim.towers[nodeId];
      return tw ? { faction: tw.faction, hp: tw.hp, maxHp: tw.maxHp, alive: tw.alive, engaged: tw.engaged } : null;
    }
    const per = view.config?.towersPerFaction ?? 0;
    for (const faction of ['blue', 'red']) {
      if ((map.towerSites?.[faction] ?? []).slice(0, per).includes(nodeId)) {
        const hp = view.config?.towerHp ?? 0;
        return { faction, hp, maxHp: hp, alive: true, engaged: false };
      }
    }
    return null;
  }

  function drawShieldIcon(x, y, s, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s, y - s, x + s, y - s * 0.3);
    ctx.quadraticCurveTo(x + s, y + s * 0.55, x, y + s);
    ctx.quadraticCurveTo(x - s, y + s * 0.55, x - s, y - s * 0.3);
    ctx.quadraticCurveTo(x - s, y - s, x, y - s);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
  }

  function drawSwords(x, y, t) {
    const flash = 0.55 + 0.45 * Math.sin(t * 7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22);
    g.addColorStop(0, `rgba(255,200,120,${0.10 + flash * 0.18})`);
    g.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.lineCap = 'round';
    for (const rot of [-Math.PI / 4, Math.PI / 4]) {
      const dx = Math.cos(rot);
      const dy = Math.sin(rot);
      ctx.strokeStyle = '#e8eef8';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x - dx * 11, y - dy * 11);
      ctx.lineTo(x + dx * 11, y + dy * 11);
      ctx.stroke();
      // Parierstange
      ctx.strokeStyle = '#b9884a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x + dx * 5 - dy * 4, y + dy * 5 + dx * 4);
      ctx.lineTo(x + dx * 5 + dy * 4, y + dy * 5 - dx * 4);
      ctx.stroke();
    }
  }

  // Einheiten-Token: Größe und Kurzzeichen kommen aus der Typdefinition
  // (g.def), damit neue Einheitentypen ohne Renderer-Anpassung funktionieren.
  function drawToken(x, y, g, opts = {}) {
    const c = FACTIONS[g.faction];
    const r = g.def?.radius ?? 16;
    ctx.save();
    if (opts.ghost) ctx.globalAlpha = 0.45;
    // Marschieren wippt, Kämpfen zittert.
    let yy = y;
    if (opts.moving) yy += Math.sin(anim * 9 + (opts.bobPhase ?? 0)) * 1.4;
    if (g.fighting) x += Math.sin(anim * 31 + r) * 0.9;
    if (g.fighting) {
      const pulse = 0.5 + 0.5 * Math.sin(anim * 8);
      ctx.beginPath();
      ctx.arc(x, yy, r + 4 + pulse * 2, 0, TAU);
      ctx.strokeStyle = `rgba(255,120,100,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y + 3, r, 0, TAU);
    ctx.fillStyle = 'rgba(4,7,12,0.5)';
    ctx.fill();
    const fill = ctx.createRadialGradient(x - r * 0.35, yy - r * 0.45, r * 0.2, x, yy, r);
    fill.addColorStop(0, c.color);
    fill.addColorStop(1, c.dark);
    ctx.beginPath();
    ctx.arc(x, yy, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(8,12,20,0.9)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, yy, r - 1.6, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, yy, r - 2.8, -TAU * 0.38, -TAU * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    label(x, yy + 0.5, g.def?.short ?? '', { color: '#fff', weight: 700, size: r > 13 ? 13 : 11 });
    if (g.maxHp != null && !opts.ghost) {
      drawHpBar(x, yy - r - 11, Math.max(28, r * 2.1), g.hp, g.maxHp);
    }
    if (g.state === 'defending' && g.entrenched && !opts.ghost) {
      drawShieldIcon(x + r * 0.85, yy - r * 0.85, 5.5, '#ffd76a');
    }
    if (opts.countdown != null) {
      ctx.beginPath();
      ctx.arc(x, yy, r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * opts.countdown);
      ctx.strokeStyle = 'rgba(226,238,252,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Vollständige Route eines Plans (Start → Ziele → ggf. Boss) als Punktliste.
  function routePoints(nodeSeq) {
    const pts = [];
    for (let i = 0; i < nodeSeq.length - 1; i++) {
      const seg = shortestPath(map, nodeSeq[i], nodeSeq[i + 1]);
      if (!seg) continue;
      for (let s = 0; s < seg.length - 1; s++) {
        for (let t = 0; t <= 1.001; t += 0.1) {
          pts.push(edgePoint(map, seg[s], seg[s + 1], Math.min(t, 1)));
        }
      }
    }
    return pts;
  }

  function strokeRoute(pts, color) {
    if (pts.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = color;
    ctx.lineWidth = 9;
    ctx.stroke();
    // Wandernde Marschlinie
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -anim * 26;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Pfeilspitze
    const last = pts[pts.length - 1];
    const prev = pts[Math.max(0, pts.length - 4)];
    const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x - 11 * Math.cos(ang - 0.45), last.y - 11 * Math.sin(ang - 0.45));
    ctx.lineTo(last.x - 11 * Math.cos(ang + 0.45), last.y - 11 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---------------------------------------------------------------- Knoten
  function drawNodes(view) {
    const sim = view.sim;
    const bossHp = view.config.bossHp;
    for (const n of map.nodeList) {
      let ring = null;
      let owner = null;
      if (sim) {
        const here = sim.groups.filter(
          (g) => g.node === n.id && (g.state === 'atNode' || g.state === 'defending')
        );
        const fac = new Set(here.map((g) => g.faction));
        if (fac.size === 2 || here.some((g) => g.fighting)) {
          const pulse = 0.5 + 0.5 * Math.sin(anim * 6);
          ring = `rgba(255,120,100,${0.55 + pulse * 0.4})`;
        } else if (fac.size === 1) {
          owner = [...fac][0];
        }
      }
      const towerInfo = n.type === 'combat' ? towerInfoAt(n.id, view) : null;
      if (towerInfo) drawTower(n, towerInfo, ring);
      else if (n.type === 'combat') drawFlagNode(n, owner, ring);
      else if (n.type === 'graveyard') {
        // Besitz kommt im Gefecht aus der Simulation, sonst aus der
        // Kartenkonfiguration (Startbesitz).
        const gyOwner = sim ? sim.graveyards.owner[n.id] : map.graveyards[n.id].owner;
        let capture = null;
        const cap = sim ? sim.graveyards.captures[n.id] : null;
        if (cap) {
          capture = {
            color: FACTIONS[cap.faction].color,
            frac: Math.min(1, (sim.time - cap.startedAt) / sim.config.graveyardCaptureTime),
          };
        }
        drawGraveyard(n, gyOwner, capture);
      } else {
        const bossState = sim ? sim.boss[n.faction] : { hp: bossHp, maxHp: bossHp };
        drawKeep(n, sim ? sim.bossAlive[n.faction] : true, bossState);
      }
      label(n.x + (n.labelDx ?? 0), n.y + (n.labelDy ?? 30), n.name, {
        align: n.labelDx ? 'left' : 'center',
        serif: true,
        size: 11.5,
      });
    }
  }

  // ---------------------------------------------------------------- Simulation
  function bobPhase(g) {
    return (g.id.charCodeAt(0) * 7 + g.id.charCodeAt(1) * 13) % 7;
  }

  function drawSim(sim) {
    const byNode = new Map();
    const byEdge = new Map();
    const byEdgeCombat = new Map();
    const dead = [];
    for (const g of sim.groups) {
      if (g.state === 'moving') {
        const key = [g.edgeFrom, g.edgeTo].sort().join('>');
        if (!byEdge.has(key)) byEdge.set(key, []);
        byEdge.get(key).push(g);
      } else if (g.state === 'edgeFight') {
        if (!byEdgeCombat.has(g.edgeCombat)) byEdgeCombat.set(g.edgeCombat, []);
        byEdgeCombat.get(g.edgeCombat).push(g);
      } else if (g.state === 'dead') {
        dead.push(g);
      } else if (g.state === 'gone') {
        // Endgültig gefallen (kein Friedhof für den Respawn) – nicht mehr gezeichnet.
      } else {
        if (!byNode.has(g.node)) byNode.set(g.node, []);
        byNode.get(g.node).push(g);
      }
    }

    for (const [key, list] of byEdge) {
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
      list.forEach((g, i) => {
        const frac = Math.min(1, (sim.time - g.departT) / (g.arriveT - g.departT || 1));
        const p = edgePoint(map, g.edgeFrom, g.edgeTo, frac);
        const q = edgePoint(map, g.edgeFrom, g.edgeTo, Math.min(1, frac + 0.02));
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        // Gegenverkehr weicht zur eigenen Seite aus, mehrere Gruppen fächern auf
        // (Abstand groß genug, damit sich die Lebensanzeigen nicht überlappen).
        const side = g.edgeFrom < g.edgeTo ? 1 : -1;
        const off = side * 7 + (i - (list.length - 1) / 2) * 18;
        const tx = p.x + (-dy / len) * off;
        const ty = p.y + (dx / len) * off;
        // Aufgewirbelter Schnee hinter marschierenden Trupps.
        if (Math.random() < frameDt * 7) effects.snowKick(tx - (dx / len) * 10, ty + 6);
        drawToken(tx, ty, g, { moving: true, bobPhase: bobPhase(g) });
      });
    }

    // Begegnungskämpfe auf Wegstücken: Trupps stehen am Treffpunkt (rot in
    // Richtung Norden, blau in Richtung Süden), Schwerter markieren die Stelle.
    for (const [, list] of byEdgeCombat) {
      const first = list[0];
      const p = edgePoint(map, first.edgeFrom, first.edgeTo, first.edgeFrac);
      drawSwords(p.x, p.y, anim);
      const byFaction = { blue: [], red: [] };
      for (const g of list.sort((a, b) => (a.id < b.id ? -1 : 1))) byFaction[g.faction].push(g);
      for (const fac of ['red', 'blue']) {
        const fl = byFaction[fac];
        const base = fac === 'red' ? -Math.PI / 2 : Math.PI / 2;
        fl.forEach((g, i) => {
          const ang = base + (i - (fl.length - 1) / 2) * 1.05;
          drawToken(p.x + Math.cos(ang) * 30, p.y + Math.sin(ang) * 30, g);
        });
      }
    }

    for (const [nodeId, list] of byNode) {
      const n = map.nodes[nodeId];
      const both = new Set(list.map((g) => g.faction)).size === 2;
      const byFaction = { blue: [], red: [] };
      for (const g of list.sort((a, b) => (a.id < b.id ? -1 : 1))) byFaction[g.faction].push(g);
      // Schwerter zuerst, damit die Lebensanzeigen der Tokens lesbar darüberliegen.
      if (both || list.some((g) => g.fighting)) drawSwords(n.x, n.y, anim);
      for (const fac of ['red', 'blue']) {
        const fl = byFaction[fac];
        const isBossNode = n.type === 'boss';
        // An Festungen fächern Trupps seitlich auf, damit weder Boss-Balken
        // noch Banner verdeckt werden; sonst rot oben, blau unten.
        const base = isBossNode
          ? fac === 'red'
            ? Math.PI
            : 0
          : fac === 'red'
            ? -Math.PI / 2
            : Math.PI / 2;
        const spread = both || fl.length > 1;
        fl.forEach((g, i) => {
          const rad = spread || isBossNode ? (isBossNode ? 48 : 32) : 0;
          const ang = base + (i - (fl.length - 1) / 2) * 1.05;
          drawToken(n.x + Math.cos(ang) * rad, n.y + Math.sin(ang) * rad, g);
        });
      }
    }
    // Bosskampf ohne stehende Verteidiger sichtbar machen.
    for (const fac of ['blue', 'red']) {
      const bossNode = map.nodes[map.bosses[fac]];
      const attacked = sim.groups.some(
        (g) => g.node === bossNode.id && g.faction !== fac && g.fighting
      );
      if (attacked && !byNode.has(bossNode.id)) drawSwords(bossNode.x, bossNode.y, anim);
    }

    dead.sort((a, b) => (a.id < b.id ? -1 : 1));
    const perGy = new Map();
    for (const g of dead) {
      // Ohne kontrollierten Friedhof gibt es keinen Warteplatz für den Geist.
      if (!g.graveyardNode) continue;
      const i = perGy.get(g.graveyardNode) ?? 0;
      perGy.set(g.graveyardNode, i + 1);
      const n = map.nodes[g.graveyardNode];
      const remaining = Math.max(0, g.respawnAt - sim.time);
      drawToken(n.x - 26 - i * 24, n.y - 14, g, {
        ghost: true,
        countdown: 1 - remaining / sim.config.respawnTime,
      });
    }
  }

  // ---------------------------------------------------------------- Planung
  function drawPlanning(view) {
    const pl = view.planning;
    const faction = pl.faction;
    const c = FACTIONS[faction];
    const start = map.start[faction];
    const enemyBoss = map.bosses[enemyOf(faction)];
    const enemy = enemyOf(faction);
    // Endet ein Angriffspfad auf einem gegnerischen Turm, ist der Turm das Ziel
    // (kein automatischer Weitermarsch zum Boss in der Vorschau).
    const isEnemyTower = (id) => {
      const ti = id ? towerInfoAt(id, view) : null;
      return !!(ti && ti.faction === enemy);
    };

    // Halte-Marker aller Einheiten (Pfadende von Einheiten mit „Halten").
    const holdCount = new Map();
    for (const u of pl.units) {
      if (u.stance !== 'defend') continue;
      const end = u.path.length ? u.path[u.path.length - 1] : start;
      holdCount.set(end, (holdCount.get(end) ?? 0) + 1);
    }

    // Pfad der ausgewählten Einheit hervorheben.
    const sel = pl.units[pl.selected] ?? null;
    if (sel) {
      const endTowerTarget = sel.stance === 'attack' && isEnemyTower(sel.path[sel.path.length - 1]);
      const seq = [start, ...sel.path];
      if (sel.stance === 'attack' && !endTowerTarget && seq[seq.length - 1] !== enemyBoss) {
        seq.push(enemyBoss);
      }
      strokeRoute(routePoints(seq), c.color);
      sel.path.forEach((t, i) => {
        const n = map.nodes[t];
        ctx.beginPath();
        ctx.arc(n.x + 14, n.y - 14, 8.5, 0, TAU);
        ctx.fillStyle = c.dark;
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#0a0f18';
        ctx.stroke();
        label(n.x + 14, n.y - 13.5, String(i + 1), { color: '#fff', weight: 700 });
      });
      const endId = sel.path.length ? sel.path[sel.path.length - 1] : start;
      if (sel.stance === 'defend') {
        const n = map.nodes[endId];
        drawShieldIcon(n.x + 16, n.y - 14, 8, c.color);
      } else if (endTowerTarget) {
        // Turmangriff-Marker: gekreuzte Schwerter am Ziel-Turm.
        drawSwords(map.nodes[endId].x, map.nodes[endId].y, anim);
      }
      // Mögliche nächste Wegpunkte (Nachbarn des Pfadendes) pulsierend markieren.
      const pulse = 0.5 + 0.5 * Math.sin(anim * 5);
      ctx.save();
      ctx.setLineDash([5, 7]);
      ctx.lineDashOffset = -anim * 16;
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 0.45 + pulse * 0.35;
      for (const nb of map.adjacency[endId]) {
        const n = map.nodes[nb];
        ctx.beginPath();
        ctx.arc(n.x, n.y, 22 + pulse * 2.5, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const [t, count] of holdCount) {
      const n = map.nodes[t];
      drawShieldIcon(n.x - 17, n.y - 14, 6.5, 'rgba(255,215,106,0.9)');
      if (count > 1) label(n.x - 17, n.y - 26, `×${count}`, { color: '#ffd76a' });
    }

    // Eigene Armee wartet am Start (Zahl = angeworbene Einheiten).
    const sn = map.nodes[start];
    drawToken(sn.x - 46, sn.y + 6, {
      faction,
      def: { radius: 15, short: String(pl.units.length) },
      state: 'atNode',
    });
    // Gegnerische Armee als Silhouette am anderen Ende – ihr Plan bleibt geheim.
    const en = map.nodes[map.start[enemyOf(faction)]];
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawToken(en.x - 46, en.y + 6, {
      faction: enemyOf(faction),
      def: { radius: 15, short: '?' },
      state: 'atNode',
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- Hauptzeichnung
  function draw(view, dt) {
    anim += dt;
    frameDt = dt;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Erschütterung (Boss-Fall) als kleiner Kamera-Versatz.
    const sh = effects.shake;
    if (sh > 0) ctx.translate((Math.random() - 0.5) * sh * 9, (Math.random() - 0.5) * sh * 9);
    ctx.clearRect(-10, -10, W + 20, H + 20);
    ctx.drawImage(bg, 0, 0, W, H);

    effects.consume(view.sim ?? null);
    if (view.phase === 'plan' && view.planning) drawPlanning(view);
    drawNodes(view);
    if (view.phase === 'sim' && view.sim) drawSim(view.sim);
    effects.draw(ctx, dt);

    // Treibende Nebelschwaden
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const fx = W / 2 + Math.sin(anim * 0.05 + i * 2.1) * (150 + i * 30);
      const fy = 180 + i * 280 + Math.sin(anim * 0.037 + i * 1.3) * 50;
      const fr = 130 + i * 25;
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
      g.addColorStop(0, 'rgba(180,200,225,0.05)');
      g.addColorStop(1, 'rgba(180,200,225,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Schnee (zwei Schichten über per-Flocke-Werte)
    for (const f of snow) {
      f.y += f.vy * dt;
      f.x += Math.sin(anim * 0.7 + f.drift) * 12 * dt;
      if (f.y > H + 4) {
        f.y = -4;
      }
      if (f.x < -4) f.x = W + 4;
      if (f.x > W + 4) f.x = -4;
      ctx.fillStyle = `rgba(235,243,252,${f.a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    }
  }

  function hitNode(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    let best = null;
    let bestD = 34;
    for (const n of map.nodeList) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  return { draw, resize, hitNode };
}
