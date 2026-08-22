// Geometrie des Bretts.
//
// Renderer und Eingabe rechnen mit denselben Zahlen – sonst trifft ein
// Fingertipp nicht das Feld, das darunter gezeichnet wurde.

import { fileOf, rankOf, square } from '../engine/board.js';

/** Größte Feldkante in CSS-Pixeln – sonst flutet das Brett große Schirme. */
const MAX_SQUARE = 96;
/** Rahmenbreite als Anteil der Feldkante. */
const FRAME_RATIO = 0.22;

/**
 * @param {number} width   nutzbare Breite in CSS-Pixeln
 * @param {number} height  nutzbare Höhe
 * @param {{top?:number,right?:number,bottom?:number,left?:number}} insets
 *        Platz für Kopf- und Fußleiste
 */
export function computeLayout(width, height, insets = {}) {
  const top = insets.top ?? 0;
  const bottom = insets.bottom ?? 0;
  const left = insets.left ?? 0;
  const right = insets.right ?? 0;

  const availW = Math.max(64, width - left - right);
  const availH = Math.max(64, height - top - bottom);

  // Der Rahmen zählt zur Fläche: Ohne diese Rechnung ragen die Koordinaten
  // auf schmalen Schirmen über den Rand hinaus.
  const outer = Math.min(availW, availH, MAX_SQUARE * (8 + 2 * FRAME_RATIO));
  const cell = outer / (8 + 2 * FRAME_RATIO);
  const frame = cell * FRAME_RATIO;
  const boardSize = cell * 8;

  return {
    cell,
    frame,
    boardSize,
    outer,
    originX: left + (availW - outer) / 2 + frame,
    originY: top + (availH - outer) / 2 + frame,
  };
}

/**
 * Linke obere Ecke eines Feldes in Pixeln.
 *
 * `flipped` dreht das Brett auf Schwarz' Sicht – im Zweispielermodus am selben
 * Gerät sitzt der Gegner ja gegenüber.
 */
export function squareOrigin(layout, sq, flipped = false) {
  const file = fileOf(sq);
  const rank = rankOf(sq);
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { x: layout.originX + col * layout.cell, y: layout.originY + row * layout.cell };
}

/** Mittelpunkt eines Feldes. */
export function squareCenter(layout, sq, flipped = false) {
  const { x, y } = squareOrigin(layout, sq, flipped);
  return { x: x + layout.cell / 2, y: y + layout.cell / 2 };
}

/** Pixelposition → Feld, oder `-1` außerhalb des Bretts. */
export function squareFromPoint(layout, px, py, flipped = false) {
  const col = Math.floor((px - layout.originX) / layout.cell);
  const row = Math.floor((py - layout.originY) / layout.cell);
  if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
  return flipped ? square(7 - col, row) : square(col, 7 - row);
}
