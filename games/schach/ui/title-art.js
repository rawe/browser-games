// Das Bild auf dem Titelbildschirm.
//
// Statt einer Bilddatei eine kleine Szene aus denselben Vektorfiguren: eine
// Reihe Figuren auf einem angedeuteten Brett, von einem warmen Lichtkegel
// getroffen. Kostet keinen Download und passt sich der Pixeldichte an.

import { KING, QUEEN, BISHOP, KNIGHT, ROOK, PAWN, WHITE, BLACK } from '../engine/board.js';
import { drawPiece } from '../gfx/pieces.js';

/** Wer steht wo? Leichte Höhenversätze geben der Reihe Tiefe. */
const CAST = [
  { type: PAWN, color: BLACK, x: 0.09, scale: 0.72, depth: 0.22 },
  { type: KNIGHT, color: BLACK, x: 0.23, scale: 0.86, depth: 0.1 },
  { type: ROOK, color: BLACK, x: 0.36, scale: 0.8, depth: 0.18 },
  { type: KING, color: WHITE, x: 0.53, scale: 1, depth: 0 },
  { type: QUEEN, color: WHITE, x: 0.69, scale: 0.94, depth: 0.06 },
  { type: BISHOP, color: WHITE, x: 0.83, scale: 0.82, depth: 0.16 },
  { type: PAWN, color: WHITE, x: 0.93, scale: 0.7, depth: 0.24 },
];

export function paintTitleArt(canvas) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const width = canvas.width / dpr || 720;
  const height = canvas.height / dpr || 220;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Lichtkegel von oben – er trennt die Figuren vom dunklen Hintergrund.
  const beam = ctx.createRadialGradient(width / 2, height * 0.1, 10, width / 2, height * 0.55, height * 1.15);
  beam.addColorStop(0, 'rgba(255, 226, 160, 0.3)');
  beam.addColorStop(0.55, 'rgba(255, 200, 120, 0.06)');
  beam.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, width, height);

  // Angedeutetes Brett: perspektivisch schmaler werdende Felderreihen.
  const floor = height * 0.86;
  for (let row = 0; row < 3; row += 1) {
    const rowHeight = height * (0.055 - row * 0.012);
    const y = floor - row * rowHeight * 1.15;
    const inset = width * row * 0.045;
    for (let col = 0; col < 8; col += 1) {
      const cellWidth = (width - inset * 2) / 8;
      ctx.fillStyle = (col + row) % 2
        ? `rgba(233, 217, 187, ${0.16 - row * 0.04})`
        : `rgba(120, 84, 56, ${0.3 - row * 0.07})`;
      ctx.fillRect(inset + col * cellWidth, y - rowHeight, cellWidth + 0.5, rowHeight);
    }
  }

  const size = height * 0.78;
  for (const actor of CAST) {
    const pieceSize = size * actor.scale;
    drawPiece(
      ctx, actor.type, actor.color,
      actor.x * width - pieceSize / 2,
      floor - pieceSize * 0.95 - height * actor.depth * 0.12,
      pieceSize,
      { scale: 1, shadow: 1.2 },
    );
  }

  // Weicher Abschluss nach unten, damit das Bild in die Karte übergeht.
  const fade = ctx.createLinearGradient(0, height * 0.72, 0, height);
  fade.addColorStop(0, 'rgba(12, 15, 22, 0)');
  fade.addColorStop(1, 'rgba(12, 15, 22, 0.95)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);
}
