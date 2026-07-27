// Darstellung: Strecke einmalig auf ein Offscreen-Canvas backen, pro Frame
// Kamera, Streckenelemente, Fahrzeuge, Raketen und Partikel zeichnen – dazu
// die Minimap.
//
// Höhenebenen
// -----------
// Bodenelemente (Öllachen, Sprungschanzen, Schrankensockel, Brückenschatten)
// liegen unter den Fahrzeugen, Brückendeck und Schlagbäume darüber. Fahrzeuge
// auf `level 1` fahren über dem Deck, fliegende Fahrzeuge werden zuletzt und
// vergrößert gezeichnet, damit die Flughöhe ablesbar bleibt.
//
// Alle Elementfunktionen arbeiten in Weltkoordinaten und kommen ohne `race`
// aus – der Streckeneditor benutzt dieselben Zeichenroutinen für Vorschau und
// Auswahl.

import { ROAD_WIDTH, WORLD, posAt } from './trackGeometry.js';
import { gateState } from './elements.js';

const MINIMAP_SIZE = 96;
const TAU = Math.PI * 2;

/** Halbe Breite des Brückendecks – deckt die Fahrbahn samt Randstein ab. */
const DECK_HALF = ROAD_WIDTH / 2 + 8;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Deterministisches Pseudo-Rauschen 0…1 – gleiche Optik bei jedem Start. */
const hash01 = (n) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

// Deckkraft-Faktor für Geistervorschauen. Alle Zeichenroutinen setzen ihre
// Transparenz über `A()`, damit eine Vorschau durchgängig halbtransparent wird.
let alphaScale = 1;
const A = (ctx, a = 1) => { ctx.globalAlpha = a * alphaScale; };

/** Strecke (Gras, Curbs, Asphalt, Start/Ziel) als statisches Bild rendern. */
export function bakeTrack(track) {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD;
  canvas.height = WORLD;
  const g = canvas.getContext('2d');

  // Gras mit deterministischem Pseudo-Rauschen (gleiche Optik bei jedem Start).
  g.fillStyle = '#3f7d2e';
  g.fillRect(0, 0, WORLD, WORLD);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#376e28';
  for (let i = 0; i < 2600; i++) g.fillRect(rnd() * WORLD, rnd() * WORLD, 4, 4);
  g.fillStyle = '#4a8f38';
  for (let i = 0; i < 1600; i++) g.fillRect(rnd() * WORLD, rnd() * WORLD, 3, 3);

  const path = () => {
    g.beginPath();
    g.moveTo(track.pts[0][0], track.pts[0][1]);
    for (let i = 1; i < track.n; i++) g.lineTo(track.pts[i][0], track.pts[i][1]);
    g.closePath();
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Randsteine: weiße Basis, rote Striche darüber.
  path();
  g.strokeStyle = '#e9e9e9';
  g.lineWidth = ROAD_WIDTH + 16;
  g.stroke();
  path();
  g.strokeStyle = '#d3402f';
  g.setLineDash([20, 20]);
  g.stroke();
  g.setLineDash([]);

  path();
  g.strokeStyle = '#43474d';
  g.lineWidth = ROAD_WIDTH;
  g.stroke();
  path();
  g.strokeStyle = '#4b5057';
  g.lineWidth = ROAD_WIDTH - 26;
  g.stroke();

  path();
  g.strokeStyle = 'rgba(240,240,240,.55)';
  g.lineWidth = 4;
  g.setLineDash([22, 26]);
  g.stroke();
  g.setLineDash([]);

  // Start/Ziel-Schachbrett quer über die Fahrbahn.
  const a = track.pts[0];
  const b = track.pts[1];
  g.save();
  g.translate(a[0], a[1]);
  g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
  const sq = 12;
  const rows = Math.ceil(ROAD_WIDTH / sq);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < rows; row++) {
      const y = -ROAD_WIDTH / 2 + row * sq;
      g.fillStyle = (col + row) % 2 === 0 ? '#f2f2f2' : '#111';
      g.fillRect(col * sq, y, sq, Math.min(sq, ROAD_WIDTH / 2 - y));
    }
  }
  g.restore();
  return canvas;
}

/* ========================= Zeichenhilfen ========================= */

/**
 * In das lokale Koordinatensystem eines Elements wechseln: Ursprung auf dem
 * Elementpunkt, +x zeigt in Fahrtrichtung, +y ist der positive Seitenversatz
 * (gleiche Konvention wie `offsetPoint`).
 */
function inLocal(ctx, el, fn) {
  ctx.save();
  ctx.translate(el.x, el.y);
  ctx.rotate(el.angle);
  fn();
  ctx.restore();
}

/** Geschlossener, weicher Umriss durch eine Punktliste (Mittelpunkt-Quadratik). */
function blobPath(ctx, pts) {
  const n = pts.length;
  const first = pts[0];
  const last = pts[n - 1];
  ctx.beginPath();
  ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const next = pts[(i + 1) % n];
    ctx.quadraticCurveTo(c[0], c[1], (c[0] + next[0]) / 2, (c[1] + next[1]) / 2);
  }
  ctx.closePath();
}

/** Gelb-schwarze Warnschraffur als Balken (lokale Koordinaten). */
function hazardBar(ctx, x, y, w, h, step = 7) {
  const along = w >= h;
  const len = along ? w : h;
  for (let i = 0; i * step < len; i++) {
    const o = i * step;
    const size = Math.min(step, len - o);
    A(ctx, 1);
    ctx.fillStyle = i % 2 === 0 ? '#ffd23f' : '#1c1f26';
    if (along) ctx.fillRect(x + o, y, size, h);
    else ctx.fillRect(x, y + o, w, size);
  }
}

/* ========================= Öllache ========================= */

function drawOil(ctx, el, time) {
  const r = el.radius ?? 28;
  inLocal(ctx, el, () => {
    // Umriss einmal pro Frame aus dem Ortshash aufbauen – bleibt stabil, damit
    // die Lache nicht flimmert.
    const seed = el.x * 0.137 + el.y * 0.311;
    const steps = 14;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU;
      const wob = 0.8 + 0.34 * hash01(seed + i * 3.73);
      pts.push([Math.cos(a) * r * wob, Math.sin(a) * r * wob * 0.86]);
    }

    // Weicher Rand, damit sich die Lache vom Asphalt löst.
    A(ctx, 0.5);
    ctx.fillStyle = '#0a0d13';
    ctx.save();
    ctx.scale(1.1, 1.1);
    blobPath(ctx, pts);
    ctx.fill();
    ctx.restore();

    // Dunkle, glänzende Fläche.
    const body = ctx.createRadialGradient(-r * 0.28, -r * 0.24, r * 0.1, 0, 0, r);
    body.addColorStop(0, '#05070c');
    body.addColorStop(0.6, '#101520');
    body.addColorStop(1, '#1e2431');
    A(ctx, 1);
    ctx.fillStyle = body;
    blobPath(ctx, pts);
    ctx.fill();

    // Schillernder Rand – der Farbverlauf wandert langsam und macht die Lache
    // auch bei Tempo unübersehbar.
    const shim = time * 0.018;
    const gx = Math.cos(shim) * r;
    const gy = Math.sin(shim) * r;
    const rim = ctx.createLinearGradient(-gx, -gy, gx, gy);
    rim.addColorStop(0, '#9d6bff');
    rim.addColorStop(0.3, '#54d6ff');
    rim.addColorStop(0.58, '#5be07a');
    rim.addColorStop(0.82, '#ffd23f');
    rim.addColorStop(1, '#ff4f7b');
    A(ctx, 0.85);
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rim;
    blobPath(ctx, pts);
    ctx.stroke();

    // Innerer Glanz und zwei Lichtpunkte.
    A(ctx, 0.35);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#cfe6ff';
    ctx.save();
    ctx.scale(0.72, 0.72);
    blobPath(ctx, pts);
    ctx.stroke();
    ctx.restore();

    A(ctx, 0.5);
    ctx.fillStyle = '#e8f2ff';
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 0.32, r * 0.22, r * 0.1, -0.5, 0, TAU);
    ctx.fill();
    A(ctx, 0.3);
    ctx.beginPath();
    ctx.ellipse(r * 0.28, r * 0.2, r * 0.13, r * 0.06, 0.4, 0, TAU);
    ctx.fill();
    A(ctx, 1);
  });
}

/* ========================= Sprungschanze ========================= */

function drawRamp(ctx, el) {
  const len = el.length ?? 40;
  const wid = el.width ?? 52;
  const hl = len / 2;
  const hw = wid / 2;
  inLocal(ctx, el, () => {
    // Schatten hinter der Absprungkante.
    A(ctx, 0.35);
    ctx.fillStyle = '#000';
    ctx.fillRect(-hl + 4, -hw + 5, len, wid);

    // Auffahrt: dunkel am Fuß, hell an der Kante – liest sich als Steigung.
    const body = ctx.createLinearGradient(-hl, 0, hl, 0);
    body.addColorStop(0, '#2c3037');
    body.addColorStop(0.5, '#5c626d');
    body.addColorStop(1, '#98a1af');
    A(ctx, 1);
    ctx.fillStyle = body;
    ctx.fillRect(-hl, -hw, len, wid);

    // Querfugen als Stufen.
    A(ctx, 0.22);
    ctx.fillStyle = '#000';
    for (let x = -hl + 6; x < hl - 2; x += 8) ctx.fillRect(x, -hw, 2, wid);

    // Richtungspfeile in Fahrtrichtung.
    const count = Math.max(2, Math.floor(len / 15));
    const spacing = (len - 10) / count;
    ctx.lineWidth = Math.min(6, hw * 0.45);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (let i = 0; i < count; i++) {
      const x = -hl + 8 + i * spacing;
      const tip = Math.min(spacing * 0.7, hw * 0.7);
      A(ctx, 0.35 + (i / Math.max(1, count - 1)) * 0.6);
      ctx.strokeStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(x, -hw * 0.66);
      ctx.lineTo(x + tip, 0);
      ctx.lineTo(x, hw * 0.66);
      ctx.stroke();
    }

    // Absprungkante mit Lichtkante.
    A(ctx, 1);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(hl - 5, -hw, 5, wid);
    A(ctx, 0.85);
    ctx.fillStyle = '#fff6d0';
    ctx.fillRect(hl - 5, -hw, 5, 3);
    ctx.fillRect(hl - 5, hw - 3, 5, 3);

    // Seitenwangen mit Warnschraffur.
    hazardBar(ctx, -hl, -hw - 4, len, 4);
    hazardBar(ctx, -hl, hw, len, 4);
    A(ctx, 1);
  });
}

/* ========================= Schranke ========================= */

/** Fahrbahnmarkierung und Pfostensockel – liegt unter den Fahrzeugen. */
function drawGateBase(ctx, el, time) {
  const wid = el.width ?? 48;
  const hw = wid / 2;
  const st = gateState(el, time);
  inLocal(ctx, el, () => {
    // Dauerhaft aufgemalter Sperrbereich: auch bei offener Schranke sichtbar.
    A(ctx, 0.4);
    ctx.fillStyle = '#15181f';
    ctx.fillRect(-10, -hw, 20, wid);
    A(ctx, 0.5);
    ctx.strokeStyle = '#e6e9ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = -hw; y < hw; y += 9) {
      ctx.moveTo(-9, y);
      ctx.lineTo(9, y + 9);
    }
    ctx.stroke();

    // Farbige Warnfläche: gelb pulsierend vor dem Schließen, rot bei Sperre.
    if (st.closed || st.warning) {
      const pulse = st.closed ? 0.24 : 0.14 + 0.14 * Math.abs(Math.sin(time * 0.16));
      A(ctx, pulse);
      ctx.fillStyle = st.closed ? '#ff4f7b' : '#ffd23f';
      ctx.fillRect(-13, -hw, 26, wid);
    }

    // Pfostensockel an beiden Enden.
    A(ctx, 1);
    for (const side of [-1, 1]) {
      const y = side * hw;
      ctx.fillStyle = '#000';
      A(ctx, 0.35);
      ctx.fillRect(-7, y - 7 + 3, 14, 14);
      A(ctx, 1);
      ctx.fillStyle = '#2a2e36';
      ctx.fillRect(-7, y - 7, 14, 14);
      hazardBar(ctx, -6, y - 6, 12, 12, 4);
    }
    A(ctx, 1);
  });
}

/** Schlagbaum und Warnleuchten – liegen über den Fahrzeugen. */
function drawGateBoom(ctx, el, time) {
  const wid = el.width ?? 48;
  const hw = wid / 2;
  const st = gateState(el, time);
  const drop = clamp(st.drop, 0, 1);
  const blink = Math.floor(time / 8) % 2 === 0;

  inLocal(ctx, el, () => {
    // Der Balken wächst vom oberen Pfosten aus über die Fahrbahn. Ein kurzer
    // Stummel bleibt stehen, solange er senkrecht in der Luft steht.
    const len = wid * (0.1 + 0.9 * drop);
    const thick = 8 - 2 * drop;
    const y0 = -hw;

    // Schatten – je weiter oben der Balken, desto stärker versetzt.
    A(ctx, 0.3);
    ctx.fillStyle = '#000';
    ctx.fillRect(-thick / 2 + 4 + (1 - drop) * 8, y0 + 5, thick, len);

    // Rot-weiß gestreifter Balken.
    A(ctx, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-thick / 2, y0, thick, len);
    ctx.clip();
    for (let i = 0; i * 10 < len; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e33b2e' : '#f3f3f3';
      ctx.fillRect(-thick / 2, y0 + i * 10, thick, 10);
    }
    ctx.restore();
    A(ctx, 0.6);
    ctx.strokeStyle = '#12141a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-thick / 2, y0, thick, len);

    // Warnleuchten auf beiden Pfosten.
    const lamp = st.closed
      ? (blink ? '#ff4f7b' : '#8d2338')
      : st.warning
        ? (blink ? '#ffd23f' : '#6b5514')
        : '#5be07a';
    const bright = st.closed || st.warning ? (blink ? 1 : 0.55) : 0.7;
    for (const side of [-1, 1]) {
      const y = side * hw;
      A(ctx, bright * 0.35);
      ctx.fillStyle = lamp;
      ctx.beginPath();
      ctx.arc(0, y, 9, 0, TAU);
      ctx.fill();
      A(ctx, bright);
      ctx.beginPath();
      ctx.arc(0, y, 4, 0, TAU);
      ctx.fill();
      A(ctx, 0.8);
      ctx.strokeStyle = '#14161c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    A(ctx, 1);
  });
}

/* ========================= Brücke ========================= */

/**
 * Stützpunkte des Decks. Mit `track` folgt das Deck der Fahrbahn, ohne ihn
 * (z. B. bei einer Editor-Vorschau ohne aufgelöste Bogenlänge) wird ein
 * geradlinges Deck in Blickrichtung gezeichnet.
 */
function bridgeSamples(el, track) {
  const len = el.length ?? 150;
  const steps = clamp(Math.round(len / 12), 2, 48);
  const out = [];
  const s0 = el.s ?? (track ? (el.at ?? 0) * track.total : 0);
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * len;
    if (track) {
      const p = posAt(track, s0 + d);
      out.push(p);
    } else {
      out.push({
        x: el.x + Math.cos(el.angle) * d,
        y: el.y + Math.sin(el.angle) * d,
        angle: el.angle,
      });
    }
  }
  return out;
}

/** Umriss des Decks als geschlossener Pfad (Weltkoordinaten). */
function deckPath(ctx, samples, half) {
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const x = p.x - Math.sin(p.angle) * half;
    const y = p.y + Math.cos(p.angle) * half;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    const p = samples[i];
    ctx.lineTo(p.x + Math.sin(p.angle) * half, p.y - Math.cos(p.angle) * half);
  }
  ctx.closePath();
}

/** Schattenwurf der Brücke auf die darunterliegende Fahrbahn. */
function drawBridgeShadow(ctx, el, track) {
  const samples = bridgeSamples(el, track);
  ctx.save();
  ctx.translate(9, 12);
  A(ctx, 0.2);
  ctx.fillStyle = '#000';
  deckPath(ctx, samples, DECK_HALF + 4);
  ctx.fill();
  ctx.translate(-3, -4);
  A(ctx, 0.3);
  deckPath(ctx, samples, DECK_HALF);
  ctx.fill();
  ctx.restore();
  A(ctx, 1);
}

/** Deck mit Geländern – verdeckt die Strecke darunter. */
function drawBridgeDeck(ctx, el, track) {
  const samples = bridgeSamples(el, track);
  const edge = (p, side) => [p.x - Math.sin(p.angle) * side, p.y + Math.cos(p.angle) * side];

  // Tragende Kante als dunkler Sockel – gibt dem Deck Dicke.
  A(ctx, 1);
  ctx.fillStyle = '#1d2028';
  deckPath(ctx, samples, DECK_HALF + 5);
  ctx.fill();

  // Deckbelag, etwas heller als der Asphalt darunter.
  ctx.fillStyle = '#5f6672';
  deckPath(ctx, samples, DECK_HALF);
  ctx.fill();

  // Querbohlen.
  ctx.lineCap = 'butt';
  ctx.lineWidth = 3;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const a = edge(p, DECK_HALF);
    const b = edge(p, -DECK_HALF);
    A(ctx, i % 2 === 0 ? 0.22 : 0.1);
    ctx.strokeStyle = i % 2 === 0 ? '#1b1e25' : '#8d95a3';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Mittelstreifen wie auf der Fahrbahn.
  A(ctx, 0.4);
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 4;
  ctx.setLineDash([22, 26]);
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Geländer beidseitig: heller Holm plus dunkle Pfosten.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const side of [DECK_HALF, -DECK_HALF]) {
    A(ctx, 1);
    ctx.strokeStyle = '#161920';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const [x, y] = edge(samples[i], side);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#cfd6e2';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    // Pfosten
    ctx.fillStyle = '#20242c';
    for (let i = 0; i < samples.length; i += 2) {
      const [x, y] = edge(samples[i], side);
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
  }

  // Auf- und Abfahrt mit Warnschraffur markieren.
  for (const idx of [0, samples.length - 1]) {
    const p = samples[idx];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    hazardBar(ctx, idx === 0 ? 0 : -5, -DECK_HALF, 5, DECK_HALF * 2, 8);
    ctx.restore();
  }
  A(ctx, 1);
}

/* ========================= Element-Dispatch ========================= */

function elementBelow(ctx, el, time, track) {
  if (el.type === 'oil') drawOil(ctx, el, time);
  else if (el.type === 'ramp') drawRamp(ctx, el);
  else if (el.type === 'gate') drawGateBase(ctx, el, time);
  else if (el.type === 'bridge') drawBridgeShadow(ctx, el, track);
}

function elementAbove(ctx, el, time, track) {
  if (el.type === 'gate') drawGateBoom(ctx, el, time);
  else if (el.type === 'bridge') drawBridgeDeck(ctx, el, track);
}

/** Umriss für Auswahl und Vorschau (lokale Koordinaten des Elements). */
function elementBounds(el) {
  switch (el.type) {
    case 'oil': {
      const r = (el.radius ?? 28) + 6;
      return { cx: 0, cy: 0, w: r * 2, h: r * 2 };
    }
    case 'ramp':
      return { cx: 0, cy: 0, w: (el.length ?? 40) + 10, h: (el.width ?? 52) + 16 };
    case 'gate':
      return { cx: 0, cy: 0, w: 30, h: (el.width ?? 48) + 24 };
    case 'bridge':
      return { cx: (el.length ?? 150) / 2, cy: 0, w: (el.length ?? 150) + 14, h: DECK_HALF * 2 + 14 };
    default:
      return { cx: 0, cy: 0, w: 40, h: 40 };
  }
}

function drawOutline(ctx, el, color) {
  const b = elementBounds(el);
  inLocal(ctx, el, () => {
    A(ctx, 1);
    ctx.setLineDash([9, 6]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h);
    ctx.setLineDash([]);
    // Eckmarken
    ctx.fillStyle = color;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.fillRect(b.cx + (sx * b.w) / 2 - 3, b.cy + (sy * b.h) / 2 - 3, 6, 6);
      }
    }
  });
}

/**
 * Ein einzelnes Element vollständig zeichnen (Boden- und Oberlage).
 * Wird vom Streckeneditor benutzt und kommt ohne `race` aus.
 *
 * `opts`:
 *   `time`     Tick für Animationen (Schrankentakt, Ölschimmer)
 *   `selected` deutlicher Auswahlrahmen
 *   `ghost`    halbtransparente Vorschau beim Platzieren
 *   `track`    optional – lässt Brückendecks der Fahrbahn folgen
 */
export function drawElement(ctx, el, opts = {}) {
  if (!el || !el.type) return;
  const { time = 0, selected = false, ghost = false, track = null } = opts;
  ctx.save();
  alphaScale = ghost ? 0.5 : 1;
  A(ctx, 1);
  elementBelow(ctx, el, time, track);
  elementAbove(ctx, el, time, track);
  alphaScale = 1;
  A(ctx, 1);
  if (ghost) drawOutline(ctx, el, '#54d6ff');
  if (selected) drawOutline(ctx, el, '#ffd23f');
  ctx.setLineDash([]);
  ctx.restore();
}

/** Bodenelemente: Öllachen, Schanzen, Schrankensockel, Brückenschatten. */
export function drawElementsBelow(ctx, elements, time = 0, track = null) {
  if (!elements?.length) return;
  ctx.save();
  alphaScale = 1;
  for (const el of elements) elementBelow(ctx, el, time, track);
  alphaScale = 1;
  A(ctx, 1);
  ctx.setLineDash([]);
  ctx.restore();
}

/** Oberlage: Brückendeck und Schlagbäume. */
export function drawElementsAbove(ctx, elements, time = 0, track = null) {
  if (!elements?.length) return;
  ctx.save();
  alphaScale = 1;
  // Brücken zuerst, damit ein Schlagbaum auf einer Brücke darüber liegt.
  for (const el of elements) if (el.type === 'bridge') elementAbove(ctx, el, time, track);
  for (const el of elements) if (el.type !== 'bridge') elementAbove(ctx, el, time, track);
  alphaScale = 1;
  A(ctx, 1);
  ctx.setLineDash([]);
  ctx.restore();
}

/* ========================= Fahrzeuge ========================= */

/** Flughöhe 0…1 aus den Sprungfeldern des Fahrzeugs. */
function airHeight(car) {
  if (!(car.air > 0) || !(car.airMax > 0)) return 0;
  return Math.sin(Math.PI * clamp(1 - car.air / car.airMax, 0, 1));
}

/** Karosserie im lokalen Fahrzeugsystem. */
function carBody(ctx, car) {
  A(ctx, 1);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-14, -5, 28, 16);
  ctx.fillStyle = '#111';
  ctx.fillRect(-12, -10, 7, 4);
  ctx.fillRect(5, -10, 7, 4);
  ctx.fillRect(-12, 6, 7, 4);
  ctx.fillRect(5, 6, 7, 4);
  ctx.fillStyle = car.color;
  ctx.fillRect(-14, -7, 28, 14);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(2, -5, 7, 10);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(-14, -7, 6, 14);
}

/** Rauchfahne und Schlieren, solange das Fahrzeug schleudert. */
function drawSpinTrail(ctx, car, time) {
  ctx.save();
  const strength = Math.min(1, car.oil / 20);
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  for (let i = 0; i < 5; i++) {
    const age = ((time * 0.07 + i * 0.2) % 1);
    const back = 10 + age * 30;
    const jitter = (hash01(i * 7.7 + Math.floor(time * 0.07 + i * 0.2)) - 0.5) * 18;
    const x = car.x - cos * back - sin * jitter;
    const y = car.y - sin * back + cos * jitter;
    A(ctx, (1 - age) * 0.4 * strength);
    ctx.fillStyle = '#9aa2ad';
    ctx.beginPath();
    ctx.arc(x, y, 4 + age * 7, 0, TAU);
    ctx.fill();
  }
  // Dunkle Schleuderspur direkt hinter den Rädern.
  A(ctx, 0.28 * strength);
  ctx.strokeStyle = '#15171c';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const side of [-7, 7]) {
    ctx.beginPath();
    ctx.moveTo(car.x - sin * side, car.y + cos * side);
    ctx.lineTo(car.x - cos * 26 - sin * (side + Math.sin(time * 0.3) * 10),
      car.y - sin * 26 + cos * (side + Math.sin(time * 0.3) * 10));
    ctx.stroke();
  }
  ctx.restore();
  A(ctx, 1);
}

function drawCar(ctx, car, time) {
  if (car.respawn > 0) return;
  if (car.invuln > 0 && Math.floor(time / 5) % 2 === 0) return; // blinkt nach Respawn

  if (car.oil > 0) drawSpinTrail(ctx, car, time);

  const h = airHeight(car);
  if (h > 0) {
    // Schlagschatten versetzt unter dem Fahrzeug – zeigt die Flughöhe an.
    A(ctx, 0.36 - 0.14 * h);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(car.x + h * 10, car.y + h * 13, 15 * (1 - 0.2 * h), 9 * (1 - 0.2 * h),
      car.angle, 0, TAU);
    ctx.fill();
    A(ctx, 1);
  }

  // Schlingern beim Schleudern ist rein optisch – die Physik bleibt unberührt.
  const wobble = car.oil > 0 ? Math.sin(time * 0.45) * 0.3 * Math.min(1, car.oil / 20) : 0;

  ctx.save();
  ctx.translate(car.x - h * 10, car.y - h * 13);
  ctx.rotate(car.angle + wobble);
  if (h > 0) ctx.scale(1 + h * 0.5, 1 + h * 0.5);
  carBody(ctx, car);
  ctx.restore();
  A(ctx, 1);
}

/* ========================= Renderer ========================= */

export function createRenderer(canvas, minimapCanvas) {
  const ctx = canvas.getContext('2d');
  const mctx = minimapCanvas.getContext('2d');
  let scale = 1;
  let baked = { track: null, image: null };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Zoomstufe an die kürzere Bildschirmkante koppeln, damit auf dem Handy
    // ähnlich viel Strecke sichtbar ist wie am Desktop.
    scale = Math.max(0.62, Math.min(1.45, Math.min(window.innerWidth, window.innerHeight) / 460));
  }

  /** Elemente als kleine Marker in der Minimap andeuten. */
  function drawMinimapElements(track, elements, s, off, time) {
    for (const el of elements) {
      const x = off + el.x * s;
      const y = off + el.y * s;
      if (el.type === 'bridge') {
        const end = posAt(track, (el.s ?? 0) + (el.length ?? 0));
        mctx.strokeStyle = '#54d6ff';
        mctx.lineWidth = 2;
        mctx.lineCap = 'round';
        mctx.beginPath();
        mctx.moveTo(x, y);
        mctx.lineTo(off + end.x * s, off + end.y * s);
        mctx.stroke();
      } else if (el.type === 'oil') {
        mctx.fillStyle = '#12161f';
        mctx.beginPath();
        mctx.arc(x, y, 2.2, 0, TAU);
        mctx.fill();
        mctx.strokeStyle = '#9d6bff';
        mctx.lineWidth = 0.8;
        mctx.stroke();
      } else if (el.type === 'ramp') {
        mctx.fillStyle = '#ffd23f';
        mctx.beginPath();
        mctx.moveTo(x, y - 2.4);
        mctx.lineTo(x + 2.4, y);
        mctx.lineTo(x, y + 2.4);
        mctx.lineTo(x - 2.4, y);
        mctx.closePath();
        mctx.fill();
      } else if (el.type === 'gate') {
        const st = gateState(el, time);
        mctx.fillStyle = st.closed ? '#ff4f7b' : st.warning ? '#ffd23f' : '#5be07a';
        mctx.save();
        mctx.translate(x, y);
        mctx.rotate(el.angle);
        mctx.fillRect(-1, -2.6, 2, 5.2);
        mctx.restore();
      }
    }
  }

  function drawMinimap(race) {
    const track = race.track;
    mctx.setTransform(2, 0, 0, 2, 0, 0);
    mctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    const s = (MINIMAP_SIZE - 8) / WORLD;
    const off = 4;
    mctx.beginPath();
    mctx.moveTo(off + track.pts[0][0] * s, off + track.pts[0][1] * s);
    for (let i = 1; i < track.n; i++) mctx.lineTo(off + track.pts[i][0] * s, off + track.pts[i][1] * s);
    mctx.closePath();
    mctx.lineJoin = 'round';
    mctx.strokeStyle = '#5a638f';
    mctx.lineWidth = 5;
    mctx.stroke();
    mctx.strokeStyle = '#20264a';
    mctx.lineWidth = 2.5;
    mctx.stroke();
    if (track.elements?.length) drawMinimapElements(track, track.elements, s, off, race.time);
    for (const car of race.cars) {
      if (car.respawn > 0) continue;
      const r = car.isPlayer ? 3 : 2.4;
      mctx.fillStyle = car.color;
      mctx.fillRect(off + car.x * s - r, off + car.y * s - r, r * 2, r * 2);
    }
  }

  function draw(race) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.fillStyle = '#20301a';
    ctx.fillRect(0, 0, w, h);
    if (!race) return;

    if (baked.track !== race.track) baked = { track: race.track, image: bakeTrack(race.track) };

    // Kamera läuft dem Spieler etwas voraus und bleibt am Weltrand stehen.
    const me = race.cars.find((c) => c.isPlayer);
    const viewW = w / scale;
    const viewH = h / scale;
    const camX = Math.max(-80, Math.min(WORLD - viewW + 80, me.x + Math.cos(me.angle) * 46 - viewW / 2));
    const camY = Math.max(-80, Math.min(WORLD - viewH + 80, me.y + Math.sin(me.angle) * 46 - viewH / 2));

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);
    ctx.drawImage(baked.image, 0, 0);

    const track = race.track;
    const elements = track.elements ?? [];
    const flying = (car) => car.air > 0;
    const upper = (car) => car.level > 0;

    drawElementsBelow(ctx, elements, race.time, track);
    for (const car of race.cars) if (!flying(car) && !upper(car)) drawCar(ctx, car, race.time);
    drawElementsAbove(ctx, elements, race.time, track);
    for (const car of race.cars) if (!flying(car) && upper(car)) drawCar(ctx, car, race.time);
    for (const car of race.cars) if (flying(car)) drawCar(ctx, car, race.time);

    for (const m of race.missiles) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.fillStyle = '#eee';
      ctx.fillRect(-7, -2.5, 14, 5);
      ctx.fillStyle = '#ff5a2e';
      ctx.fillRect(4, -2.5, 4, 5);
      ctx.restore();
    }
    for (const p of race.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawMinimap(race);
  }

  resize();
  return { resize, draw };
}
