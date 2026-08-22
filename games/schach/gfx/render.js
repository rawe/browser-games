// Brett, Figuren, Hervorhebungen, Animation.
//
// Gezeichnet wird auf einer einzigen 2D-Canvas. Rahmen und Felder liegen in
// einer eigenen, zwischengespeicherten Ebene, die sich nur bei Größenänderung
// neu aufbaut – die Maserung des Holzes und die Koordinaten in jedem Bild neu
// zu rechnen wäre auf dem Handy verschwendete Zeit. Darüber kommt pro Bild die
// bewegliche Schicht: letzter Zug, Auswahl, Zielfelder, Schachwarnung, Figuren.
//
// ── Schnittstelle (Vertrag mit main.js) ─────────────────────────────────────
//   createRenderer(canvas) → {
//     resize(cssW, cssH, insets)   Fläche neu vermessen
//     layout                       aktuelle Geometrie (siehe layout.js)
//     flipped                      Blickrichtung (Schwarz unten)
//     setFlipped(value, animate)   Brett drehen
//     setBoard(board)              Stellung, aus der gezeichnet wird
//     setHints(hints)              Auswahl, Zielfelder, letzter Zug, Schach
//     animateMove(move, done)      Figur von Feld zu Feld gleiten lassen
//     setDrag(drag|null)           Figur am Finger
//     frame(nowMs) → boolean       ein Bild zeichnen; `true` = es bewegt sich
//     squareAt(px, py)             Pixel → Feld
//   }
// ────────────────────────────────────────────────────────────────────────────

import { typeOf, colorOf, onBoard, isLightSquare, fileOf, rankOf } from '../engine/board.js';
import { computeLayout, squareOrigin, squareCenter, squareFromPoint } from './layout.js';
import { drawPiece } from './pieces.js';

/** Farben der Bühne. Warmes Holz, kühle Umgebung – das trennt Brett und Rand. */
const THEME = {
  backdrop: '#0e1117',
  light: '#e9d9bb',
  lightGrain: 'rgba(255,255,255,0.5)',
  dark: '#9b6f4c',
  darkGrain: 'rgba(255,255,255,0.16)',
  frameTop: '#4c3524',
  frameBottom: '#2a1b11',
  frameEdge: 'rgba(255,226,180,0.22)',
  coords: 'rgba(255,232,200,0.62)',
  select: 'rgba(255, 208, 92, 0.5)',
  lastMove: 'rgba(255, 208, 92, 0.26)',
  hintDark: 'rgba(28, 32, 40, 0.34)',
  hintLight: 'rgba(255, 250, 235, 0.44)',
  cursor: 'rgba(255, 226, 150, 0.9)',
};

const MOVE_MS = 190;
const FLIP_MS = 420;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onFlip?: (flipped: boolean) => void}} hooks
 *        `onFlip` meldet, wann die Drehung wirklich umschlägt. Das ist nicht
 *        der Moment des Auslösens: Die Bühne kippt erst, und in der Mitte der
 *        Bewegung tauschen Blickrichtung und damit auch die beiden
 *        Spielerleisten die Seiten. Ohne diese Meldung stünde nach jeder
 *        Drehung der falsche Name über dem Brett.
 */
export function createRenderer(canvas, hooks = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });

  let layout = computeLayout(320, 320);
  let dpr = 1;
  let board = null;
  let hints = {};
  let flipped = false;
  /** Läuft eine Brettdrehung, kippt sie das Brett um die Waagerechte. */
  let flip = null;
  let anim = null;
  let drag = null;
  let boardLayer = null;

  /** Rahmen und Felder in eine eigene Ebene malen – die ändert sich selten. */
  function buildBoardLayer() {
    const size = Math.ceil(layout.outer * dpr);
    if (size <= 0) return;
    boardLayer = document.createElement('canvas');
    boardLayer.width = size;
    boardLayer.height = size;
    const layer = boardLayer.getContext('2d');
    layer.scale(dpr, dpr);
    paintBoard(layer, layout, flipped);
  }

  function resize(cssW, cssH, insets) {
    dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    layout = computeLayout(cssW, cssH, insets);
    buildBoardLayer();
  }

  /**
   * Ein Bild zeichnen. Rückgabe `true` heißt: es bewegt sich noch, das nächste
   * Bild wird gebraucht.
   */
  function frame(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = THEME.backdrop;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    let squash = 1;
    if (flip) {
      const t = Math.min(1, (now - flip.start) / FLIP_MS);
      const turned = easeInOut(t);
      // Bei der Hälfte steht das Brett hochkant – genau dann wird die Ebene
      // umgebaut, damit Feldfarben und Koordinaten zur neuen Sicht passen.
      if (turned >= 0.5 && !flip.swapped) {
        flip.swapped = true;
        flipped = flip.target;
        buildBoardLayer();
        hooks.onFlip?.(flipped);
      }
      squash = Math.max(0.02, Math.abs(Math.cos(turned * Math.PI)));
      if (t >= 1) flip = null;
    }

    ctx.save();
    if (squash !== 1) {
      const cx = layout.originX + layout.boardSize / 2;
      const cy = layout.originY + layout.boardSize / 2;
      ctx.translate(cx, cy);
      ctx.scale(1, squash);
      ctx.translate(-cx, -cy);
    }

    if (boardLayer) {
      ctx.drawImage(
        boardLayer,
        layout.originX - layout.frame, layout.originY - layout.frame,
        layout.outer, layout.outer,
      );
    }

    if (board) {
      paintHighlights(ctx, layout, flipped, hints, now);
      paintPieces(ctx, layout, flipped, board, anim, drag, now);
    }
    ctx.restore();

    if (anim && now - anim.start >= MOVE_MS) {
      const { done } = anim;
      anim = null;
      done?.();
    }
    return !!anim || !!flip || hints.check >= 0;
  }

  return {
    get layout() { return layout; },
    get flipped() { return flipped; },
    get animating() { return !!anim || !!flip; },
    resize,
    frame,
    setBoard(next) { board = next; },
    setHints(next) { hints = next ?? {}; },
    setDrag(next) { drag = next; },
    setFlipped(value, animate = true) {
      const target = flip ? flip.target : flipped;
      if (value === target) return;
      if (!animate) { flip = null; flipped = value; buildBoardLayer(); hooks.onFlip?.(flipped); return; }
      flip = { target: value, start: performance.now(), swapped: false };
    },
    animateMove(move, done) { anim = { move, start: performance.now(), done }; },
    squareAt: (px, py) => squareFromPoint(layout, px, py, flipped),
    centerOf: (sq) => squareCenter(layout, sq, flipped),
  };
}

/** Rahmen, Felder, Maserung, Koordinaten. */
function paintBoard(ctx, layout, flipped) {
  const { frame, boardSize, cell, outer } = layout;

  const wood = ctx.createLinearGradient(0, 0, outer, outer);
  wood.addColorStop(0, THEME.frameTop);
  wood.addColorStop(1, THEME.frameBottom);
  roundRect(ctx, 0, 0, outer, outer, cell * 0.16);
  ctx.fillStyle = wood;
  ctx.fill();

  roundRect(ctx, 0.75, 0.75, outer - 1.5, outer - 1.5, cell * 0.15);
  ctx.strokeStyle = THEME.frameEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  for (let sq = 0; sq < 128; sq += 1) {
    if (!onBoard(sq)) continue;
    const col = flipped ? 7 - fileOf(sq) : fileOf(sq);
    const row = flipped ? rankOf(sq) : 7 - rankOf(sq);
    const x = frame + col * cell;
    const y = frame + row * cell;
    const light = isLightSquare(sq);

    ctx.fillStyle = light ? THEME.light : THEME.dark;
    ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
    paintGrain(ctx, x, y, cell, sq, light);
  }

  // Ein weicher Schatten der Rahmenkante auf die Felder – so wirkt das Brett
  // vertieft und nicht aufgeklebt.
  const shade = ctx.createLinearGradient(frame, frame, frame + cell, frame + cell);
  shade.addColorStop(0, 'rgba(0,0,0,0.32)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(frame, frame, boardSize, boardSize);

  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(frame - 0.5, frame - 0.5, boardSize + 1, boardSize + 1);

  paintCoordinates(ctx, layout, flipped);
}

/**
 * Maserung: ein paar gebogene Striche je Feld, aus dem Feldindex abgeleitet.
 * Kein Zufall – dieselbe Stellung sieht dadurch immer gleich aus, und die
 * Ebene bleibt zwischenspeicherbar.
 */
function paintGrain(ctx, x, y, cell, sq, light) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, cell, cell);
  ctx.clip();
  ctx.strokeStyle = light ? THEME.lightGrain : THEME.darkGrain;
  ctx.lineWidth = Math.max(0.5, cell * 0.012);
  const seed = (sq * 2654435761) >>> 0;
  for (let line = 0; line < 5; line += 1) {
    const offset = ((seed >> (line * 5)) & 31) / 31;
    const ly = y + (line + offset) * (cell / 5.2);
    ctx.globalAlpha = 0.2 + offset * 0.35;
    ctx.beginPath();
    ctx.moveTo(x - 2, ly);
    ctx.bezierCurveTo(
      x + cell * 0.3, ly + cell * (offset - 0.5) * 0.12,
      x + cell * 0.7, ly - cell * (offset - 0.5) * 0.12,
      x + cell + 2, ly,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Linien a–h und Reihen 1–8 auf dem Rahmen. */
function paintCoordinates(ctx, layout, flipped) {
  const { frame, cell } = layout;
  ctx.save();
  ctx.fillStyle = THEME.coords;
  ctx.font = `600 ${Math.max(8, cell * 0.2)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 8; i += 1) {
    const file = flipped ? 7 - i : i;
    const rank = flipped ? i : 7 - i;
    ctx.fillText('abcdefgh'[file], frame + (i + 0.5) * cell, frame + 8 * cell + frame / 2);
    ctx.fillText(String(rank + 1), frame / 2, frame + (i + 0.5) * cell);
  }
  ctx.restore();
}

/** Auswahl, letzter Zug, Zielfelder, Schach. */
function paintHighlights(ctx, layout, flipped, hints, now) {
  const { cell } = layout;

  for (const sq of hints.lastMove ?? []) {
    const { x, y } = squareOrigin(layout, sq, flipped);
    ctx.fillStyle = THEME.lastMove;
    ctx.fillRect(x, y, cell, cell);
  }

  if (hints.selected >= 0) {
    const { x, y } = squareOrigin(layout, hints.selected, flipped);
    ctx.fillStyle = THEME.select;
    ctx.fillRect(x, y, cell, cell);
  }

  // Der Tastaturfokus bekommt einen Rahmen statt einer Füllung – er soll
  // sichtbar sein, ohne mit der Auswahl verwechselt zu werden.
  if (hints.cursor >= 0) {
    const { x, y } = squareOrigin(layout, hints.cursor, flipped);
    ctx.strokeStyle = THEME.cursor;
    ctx.lineWidth = Math.max(2, cell * 0.055);
    const inset = ctx.lineWidth / 2;
    ctx.strokeRect(x + inset, y + inset, cell - ctx.lineWidth, cell - ctx.lineWidth);
  }

  if (hints.check >= 0) {
    // Der Schachring pulsiert, damit er auch im Augenwinkel auffällt.
    const pulse = 0.6 + 0.4 * Math.sin(now / 260);
    const { x, y } = squareCenter(layout, hints.check, flipped);
    const glow = ctx.createRadialGradient(x, y, cell * 0.08, x, y, cell * 0.62);
    glow.addColorStop(0, `rgba(232, 74, 62, ${0.6 * pulse})`);
    glow.addColorStop(1, 'rgba(232, 74, 62, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - cell * 0.7, y - cell * 0.7, cell * 1.4, cell * 1.4);
  }

  for (const target of hints.targets ?? []) {
    const { x, y } = squareCenter(layout, target.sq, flipped);
    const ink = isLightSquare(target.sq) ? THEME.hintDark : THEME.hintLight;
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    if (target.capture) {
      // Schlagfelder bekommen einen Ring statt eines Punktes – ein Punkt
      // verdeckt genau das, was man schlagen will.
      ctx.lineWidth = cell * 0.085;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Alle Figuren – die ziehende zuletzt, damit sie über den anderen liegt. */
function paintPieces(ctx, layout, flipped, board, anim, drag, now) {
  const { cell } = layout;
  const progress = anim ? easeOut(Math.min(1, (now - anim.start) / MOVE_MS)) : 1;

  for (let sq = 0; sq < 128; sq += 1) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board[sq];
    if (!piece) continue;
    if (drag && drag.from === sq) continue;
    // Die ziehende Figur steht im Brett schon auf dem Zielfeld; sie wird
    // stattdessen auf dem Weg dorthin gezeichnet.
    if (anim && (sq === anim.move.to || sq === anim.move.rook?.to)) continue;

    const { x, y } = squareOrigin(layout, sq, flipped);
    drawPiece(ctx, typeOf(piece), colorOf(piece), x, y, cell);
  }

  if (anim) {
    // Bei der Rochade laufen König und Turm gemeinsam los.
    for (const leg of [anim.move, anim.move.rook].filter(Boolean)) {
      const piece = board[leg.to];
      if (!piece) continue;
      const from = squareOrigin(layout, leg.from, flipped);
      const to = squareOrigin(layout, leg.to, flipped);
      drawPiece(
        ctx, typeOf(piece), colorOf(piece),
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        cell,
        // Ein leichtes Anheben in der Zugmitte gibt der Bewegung Gewicht.
        { lift: Math.sin(progress * Math.PI) * cell * 0.09 },
      );
    }
  }

  if (drag) {
    const piece = board[drag.from];
    if (piece) {
      // Am Finger wird die Figur größer und schwebt – so bleibt sie unter der
      // Fingerkuppe sichtbar statt darunter zu verschwinden.
      drawPiece(
        ctx, typeOf(piece), colorOf(piece),
        drag.x - cell / 2, drag.y - cell / 2, cell,
        { scale: 1.02, lift: cell * 0.24, shadow: 1.5 },
      );
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
