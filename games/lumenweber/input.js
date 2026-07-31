// Eingabe: Finger, Maus, Tastatur.
//
// Auf dem Brett zählt nur eines – ein Tipp auf eine Zelle. Alles andere
// (Scrollen, Zoomen, Doppeltipp-Zoom, Kontextmenü) wird unterdrückt, sonst
// rutscht auf dem Handy bei jedem zweiten Zug die Seite weg.

import { cellFromPoint } from './layout.js';

const TAP_SLOP = 14;   // Pixel, die ein Finger wandern darf
const TAP_MS = 700;    // länger gedrückt zählt nicht mehr als Tipp

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   getLayout: () => object,
 *   getLevel: () => object|null,
 *   onTap: (x:number, y:number) => void,
 *   onHover: (cell: {x:number,y:number}|null) => void,
 *   onCursor: (cell: {x:number,y:number}|null) => void,
 *   onAction: (name: string) => void,
 * }} handlers
 */
export function createInput(canvas, handlers) {
  let down = null;
  let cursor = null;

  const toCell = (event) => {
    const level = handlers.getLevel();
    if (!level) return null;
    const rect = canvas.getBoundingClientRect();
    return cellFromPoint(
      handlers.getLayout(), level,
      event.clientX - rect.left, event.clientY - rect.top,
      0.25,
    );
  };

  const onPointerDown = (event) => {
    if (!event.isPrimary) return;
    canvas.setPointerCapture?.(event.pointerId);
    down = { x: event.clientX, y: event.clientY, t: performance.now(), cell: toCell(event) };
    handlers.onHover?.(down.cell);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!down) {
      if (event.pointerType === 'mouse') handlers.onHover?.(toCell(event));
      return;
    }
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > TAP_SLOP) { down.void = true; handlers.onHover?.(null); }
  };

  const onPointerUp = (event) => {
    if (!down) return;
    const dt = performance.now() - down.t;
    const cell = toCell(event);
    const same = cell && down.cell && cell.x === down.cell.x && cell.y === down.cell.y;
    if (!down.void && dt < TAP_MS && same) {
      cursor = cell;
      handlers.onCursor?.(cursor);
      handlers.onTap(cell.x, cell.y);
    }
    down = null;
    if (event.pointerType !== 'mouse') handlers.onHover?.(null);
    event.preventDefault();
  };

  const onPointerCancel = () => { down = null; handlers.onHover?.(null); };
  const onLeave = () => handlers.onHover?.(null);
  const onContextMenu = (event) => event.preventDefault();

  const onKeyDown = (event) => {
    const level = handlers.getLevel();
    if (!level) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (step) {
      const base = cursor ?? { x: 0, y: 0 };
      cursor = {
        x: Math.min(level.width - 1, Math.max(0, base.x + (cursor ? step[0] : 0))),
        y: Math.min(level.height - 1, Math.max(0, base.y + (cursor ? step[1] : 0))),
      };
      handlers.onCursor?.(cursor);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (cursor) handlers.onTap(cursor.x, cursor.y);
      event.preventDefault();
      return;
    }
    const action = {
      r: 'reset', R: 'reset',
      u: 'undo', U: 'undo',
      h: 'hint', H: 'hint',
      l: 'legend', L: 'legend',
      Escape: 'menu',
    }[event.key];
    if (action) { handlers.onAction?.(action); event.preventDefault(); }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    get cursor() { return cursor; },
    setCursor(cell) { cursor = cell; handlers.onCursor?.(cell); },
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
