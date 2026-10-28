// Zielen und Feuern auf dem Feindmeer.
//
// Mit dem Finger wird erst gezielt und dann bestätigt – ein Fehltipp auf dem
// kleinen Handyraster soll keinen Schuss kosten. Mit der Maus feuert ein
// Klick sofort; das Fadenkreuz folgt dem Zeiger.

import { SIZE } from './logic/rules.js';

/**
 * @param {object} view  Brettansicht des Feindmeers
 * @param {{enabled: () => boolean, onAim: (idx: number) => void,
 *          onFire: (idx: number) => void, aim: () => number}} handlers
 */
export function attachTargeting(view, { enabled, onAim, onFire, aim }) {
  const canvas = view.canvas;
  let down = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (!enabled() || event.button > 0) return;
    down = { x: event.clientX, y: event.clientY, idx: view.cellAt(event.clientX, event.clientY), type: event.pointerType };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!enabled()) return;
    if (event.pointerType === 'mouse') {
      const idx = view.cellAt(event.clientX, event.clientY);
      if (idx !== aim()) onAim(idx);
    } else if (down) {
      // Finger auf dem Raster gleiten lassen bewegt das Fadenkreuz mit.
      const idx = view.cellAt(event.clientX, event.clientY);
      if (idx >= 0 && idx !== aim()) { onAim(idx); down.slid = true; }
    }
  });

  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && enabled()) onAim(-1);
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!down || !enabled()) { down = null; return; }
    const idx = view.cellAt(event.clientX, event.clientY);
    const wasAimed = aim() === idx && !down.slid;
    const type = down.type;
    down = null;
    if (idx < 0) return;
    if (type === 'mouse' || wasAimed) onFire(idx);
    else onAim(idx);
  });

  canvas.addEventListener('pointercancel', () => { down = null; });

  // Tastatur: Pfeile bewegen das Fadenkreuz, Enter oder Leertaste feuern.
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (event) => {
    if (!enabled()) return;
    const current = aim() < 0 ? 44 : aim();
    let x = current % SIZE;
    let y = Math.floor(current / SIZE);
    switch (event.key) {
      case 'ArrowLeft': x = Math.max(0, x - 1); break;
      case 'ArrowRight': x = Math.min(SIZE - 1, x + 1); break;
      case 'ArrowUp': y = Math.max(0, y - 1); break;
      case 'ArrowDown': y = Math.min(SIZE - 1, y + 1); break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (aim() >= 0) onFire(aim());
        return;
      default:
        return;
    }
    event.preventDefault();
    onAim(y * SIZE + x);
  });
}
