// Eingabe auf dem Brett: Finger, Maus, Tastatur.
//
// Auf dem Brett gibt es genau zwei Gesten – **tippen** (Figur wählen, dann
// Zielfeld tippen) und **ziehen** (Figur aufnehmen und fallen lassen). Beide
// müssen nebeneinander funktionieren, weil beide erwartet werden: am Schreib-
// tisch zieht man, auf dem Handy tippt man. Unterschieden wird erst an der
// Bewegung, nicht an der Eingabeart – wer mit der Maus tippt, soll tippen
// dürfen.
//
// Alles Übrige (Scrollen, Zoomen, Doppeltipp-Zoom, Kontextmenü) wird auf dem
// Brett unterdrückt: Sonst rutscht auf dem Handy bei jedem zweiten Zug die
// Seite weg oder das Brett zoomt beim schnellen Nachziehen auf.

import { onBoard, fileOf, rankOf, square } from './engine/board.js';

/** Ab dieser Wegstrecke ist es kein Tipp mehr, sondern ein Ziehen. */
const DRAG_SLOP = 9;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   squareAt: (px:number, py:number) => number,
 *   canPickUp: (sq:number) => boolean,
 *   onTap: (sq:number) => void,
 *   onDragStart: (sq:number, x:number, y:number) => void,
 *   onDragMove: (x:number, y:number) => void,
 *   onDrop: (sq:number) => void,
 *   onDragCancel: () => void,
 *   onAction?: (name:string, value?:number) => void,
 * }} handlers
 */
export function createInput(canvas, handlers) {
  let press = null;
  let cursor = -1;

  const localPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event) => {
    if (!event.isPrimary || event.button > 0) return;
    const { x, y } = localPoint(event);
    const sq = handlers.squareAt(x, y);
    press = { id: event.pointerId, sq, startX: x, startY: y, dragging: false };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!press || event.pointerId !== press.id) return;
    const { x, y } = localPoint(event);

    if (!press.dragging) {
      const moved = Math.hypot(x - press.startX, y - press.startY);
      if (moved <= DRAG_SLOP) return;
      // Erst hier steht fest, dass gezogen wird. Nur eine eigene Figur lässt
      // sich aufnehmen; über leeren Feldern bleibt die Geste wirkungslos.
      if (press.sq < 0 || !handlers.canPickUp(press.sq)) { press.spent = true; return; }
      press.dragging = true;
      handlers.onDragStart(press.sq, x, y);
    }
    if (press.dragging) handlers.onDragMove(x, y);
    event.preventDefault();
  };

  const onPointerUp = (event) => {
    if (!press || event.pointerId !== press.id) return;
    const { x, y } = localPoint(event);
    const sq = handlers.squareAt(x, y);

    if (press.dragging) handlers.onDrop(sq);
    else if (!press.spent && sq >= 0) { cursor = sq; handlers.onTap(sq); }

    press = null;
    event.preventDefault();
  };

  const onPointerCancel = () => {
    if (press?.dragging) handlers.onDragCancel();
    press = null;
  };

  const onContextMenu = (event) => event.preventDefault();

  /**
   * Tastatur: Pfeiltasten bewegen einen Fokus über das Brett, Leertaste und
   * Enter tippen das Feld an. Damit ist das Spiel ohne Zeigegerät bedienbar.
   */
  const onKeyDown = (event) => {
    const target = event.target;
    if (target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (step) {
      if (cursor < 0) cursor = square(4, 0);
      else {
        const file = Math.min(7, Math.max(0, fileOf(cursor) + step[0]));
        const rank = Math.min(7, Math.max(0, rankOf(cursor) + step[1]));
        cursor = square(file, rank);
      }
      handlers.onAction?.('cursor', cursor);
      event.preventDefault();
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && onBoard(cursor)) {
      handlers.onTap(cursor);
      event.preventDefault();
      return;
    }

    const action = {
      u: 'undo', U: 'undo',
      f: 'flip', F: 'flip',
      n: 'new', N: 'new',
      Escape: 'escape',
    }[event.key];
    if (action) { handlers.onAction?.(action); event.preventDefault(); }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    get cursor() { return cursor; },
    setCursor(sq) { cursor = sq; },
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
