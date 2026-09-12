// Der Umwandlungsdialog.
//
// Die vier Figuren werden mit demselben Zeichner gemalt wie die auf dem Brett –
// keine Sonderbilder, keine Schriftzeichen. So sieht die Dame im Dialog
// genauso aus wie die, die gleich auf dem Feld steht.

import { QUEEN, ROOK, BISHOP, KNIGHT } from '../engine/board.js';
import { drawPiece } from '../gfx/pieces.js';

const CHOICES = [
  { type: QUEEN, name: 'Dame' },
  { type: ROOK, name: 'Turm' },
  { type: BISHOP, name: 'Läufer' },
  { type: KNIGHT, name: 'Springer' },
];

/**
 * @param {HTMLElement} row  Behälter für die vier Knöpfe
 * @param {number} color     Farbe des umwandelnden Bauern
 * @param {(type:number) => void} onPick
 */
export function fillPromotion(row, color, onPick) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const size = 64;

  row.replaceChildren(...CHOICES.map(({ type, name }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'promo-choice';
    button.title = name;
    button.setAttribute('aria-label', name);

    const canvas = document.createElement('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPiece(ctx, type, color, 0, 0, size, { scale: 0.94, shadow: 0.6 });

    button.append(canvas);
    button.addEventListener('click', () => onPick(type));
    return button;
  }));
}
