// Die Anzeige rund um das Brett: Namen, geschlagene Figuren, Uhren, Zugliste.
//
// Alles hier liest nur aus der Partie und schreibt ins DOM – kein Zustand,
// keine Regeln. Dadurch genügt nach jeder Änderung ein einziger Aufruf von
// `render()`, statt an zwanzig Stellen einzelne Felder nachzuziehen.

import { WHITE, BLACK } from '../engine/board.js';
import { material } from '../game.js';
import { movePairs } from '../engine/notation.js';
import { drawPiece } from '../gfx/pieces.js';
import { remaining, formatTime } from '../clock.js';

const COLOR_NAME = { [WHITE]: 'Weiß', [BLACK]: 'Schwarz' };

export function createPanel(el) {
  /** Geschlagene Figuren einer Seite in ihre kleine Canvas malen. */
  const paintCaptured = (canvas, pieces) => {
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const size = 20;
    const step = 12;
    const width = pieces.length ? step * (pieces.length - 1) + size : 0;
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(size * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${size}px`;
    if (!pieces.length) return;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Die Figuren überlappen sich leicht: So passen auch acht Bauern in eine
    // Leiste, die auf dem Handy keine 12 rem breit ist.
    pieces.forEach((piece, index) => {
      drawPiece(ctx, piece.type, piece.color, index * step, 0, size, { scale: 1, shadow: 0 });
    });
  };

  const paintMoveList = (node, history) => {
    if (!node) return;
    if (!history.length) {
      node.replaceChildren(Object.assign(document.createElement('li'), {
        className: 'move-empty',
        textContent: 'Noch kein Zug.',
      }));
      return;
    }

    const pairs = movePairs(history.map((entry) => entry.san));
    const lastIndex = history.length - 1;
    node.replaceChildren(...pairs.map((pair, index) => {
      const row = document.createElement('li');
      const white = document.createElement('span');
      const black = document.createElement('span');
      const number = document.createElement('span');
      number.className = 'move-no';
      number.textContent = `${pair.no}.`;
      white.textContent = pair.white;
      black.textContent = pair.black;
      if (index * 2 === lastIndex) white.className = 'move--last';
      if (index * 2 + 1 === lastIndex) black.className = 'move--last';
      row.append(number, white, black);
      return row;
    }));
    node.scrollTop = node.scrollHeight;
  };

  return {
    /**
     * @param {{game: object, topColor: number, names: object, clock: object,
     *          thinking: number, now: number}} view
     */
    render(view) {
      const { game, topColor, names, clock, thinking, now = Date.now() } = view;
      const bottomColor = topColor ^ 1;
      const { captured, lead } = material(game);
      const turn = game.state.turn;
      const over = view.over;

      for (const [side, color] of [['top', topColor], ['bottom', bottomColor]]) {
        const bar = el[`${side}Bar`];
        const active = !over && color === turn;
        bar.classList.toggle('player-bar--active', active);
        el[`${side}Name`].textContent = names[color] ?? COLOR_NAME[color];

        paintCaptured(el[`${side}Captured`], captured[color]);
        const advantage = color === WHITE ? lead : -lead;
        el[`${side}Lead`].textContent = advantage > 0 ? `+${advantage}` : '';

        const state = el[`${side}State`];
        if (thinking === color) {
          state.textContent = 'denkt …';
          state.className = 'player-state player-state--think';
          state.hidden = false;
        } else if (!over && active && game.status.check) {
          state.textContent = 'Schach';
          state.className = 'player-state';
          state.hidden = false;
        } else {
          state.hidden = true;
        }

        const clockNode = el[`${side}Clock`];
        if (clock?.enabled) {
          const left = remaining(clock, color, now);
          clockNode.hidden = false;
          clockNode.textContent = formatTime(left);
          clockNode.classList.toggle('clock--low', left < 30_000);
        } else {
          clockNode.hidden = true;
        }
      }

      paintMoveList(el.moveList, game.history);
      paintMoveList(el.moveListFull, game.history);
    },

    /** Nur die Uhren nachziehen – das läuft im Bildtakt und muss billig sein. */
    tick(clock, topColor, now = Date.now()) {
      if (!clock?.enabled) return;
      for (const [side, color] of [['top', topColor], ['bottom', topColor ^ 1]]) {
        const left = remaining(clock, color, now);
        el[`${side}Clock`].textContent = formatTime(left);
        el[`${side}Clock`].classList.toggle('clock--low', left < 30_000);
      }
    },
  };
}

export { COLOR_NAME };
