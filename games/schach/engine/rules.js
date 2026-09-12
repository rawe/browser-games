// Wann ist Schluss? Matt, Patt und die vier Remisgründe.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, WHITE, BLACK,
  typeOf, colorOf, onBoard, isLightSquare, toFen,
} from './board.js';
import { legalMoves, inCheck } from './moves.js';

/**
 * Schlüssel für die Stellungswiederholung.
 *
 * Es zählt die Stellung samt Zugrecht, Rochaderechten und En-passant-Feld –
 * nicht aber die Zugzähler. Deshalb die FEN ohne ihre letzten beiden Felder.
 */
export const positionKey = (state) => toFen(state).split(' ').slice(0, 4).join(' ');

/**
 * Materialarmes Remis nach Artikel 5.2.2: Mit diesem Material kann keine Seite
 * mehr mattsetzen, egal wie schlecht die andere spielt.
 *
 * Abgedeckt sind die zwingenden Fälle – König gegen König, gegen einen Läufer,
 * gegen einen Springer und Läufer gegen Läufer auf gleicher Feldfarbe. Zwei
 * Springer gegen König zählen nicht dazu: Matt ist dort erzwingbar nicht, aber
 * möglich, und die Regel verlangt Unmöglichkeit.
 */
export function insufficientMaterial(state) {
  const minors = [[], []];
  for (let sq = 0; sq < 128; sq += 1) {
    if (!onBoard(sq)) continue;
    const piece = state.board[sq];
    if (!piece) continue;
    const type = typeOf(piece);
    if (type === PAWN || type === ROOK || type === QUEEN) return false;
    if (type === KNIGHT || type === BISHOP) minors[colorOf(piece)].push({ type, light: isLightSquare(sq) });
  }

  const [white, black] = minors;
  if (white.length + black.length <= 1) return true;
  return white.length === 1 && black.length === 1
    && white[0].type === BISHOP && black[0].type === BISHOP
    && white[0].light === black[0].light;
}

/**
 * Zustand der Partie.
 *
 * @param {object} state
 * @param {string[]} keys  Stellungsschlüssel aller bisherigen Stellungen
 *                         einschließlich der aktuellen
 * @returns {{over: boolean, result: string, reason: string, winner: number|null,
 *            check: boolean, moves: object[]}}
 */
export function gameStatus(state, keys = []) {
  const moves = legalMoves(state);
  const check = inCheck(state);

  if (!moves.length) {
    return check
      ? { over: true, result: state.turn === WHITE ? '0-1' : '1-0', reason: 'schachmatt',
          winner: state.turn === WHITE ? BLACK : WHITE, check, moves }
      : { over: true, result: '½-½', reason: 'patt', winner: null, check, moves };
  }

  const draw = (reason) => ({ over: true, result: '½-½', reason, winner: null, check, moves });
  if (insufficientMaterial(state)) return draw('material');
  if (state.half >= 100) return draw('50-züge');

  const current = keys.length ? keys[keys.length - 1] : positionKey(state);
  if (keys.filter((key) => key === current).length >= 3) return draw('wiederholung');

  return { over: false, result: '*', reason: '', winner: null, check, moves };
}

/** Klartext für die Schlussmeldung. */
export const REASON_TEXT = {
  schachmatt: 'Schachmatt',
  patt: 'Patt – niemand kann mehr ziehen',
  material: 'Remis: zu wenig Material zum Mattsetzen',
  '50-züge': 'Remis: 50 Züge ohne Schlag oder Bauernzug',
  wiederholung: 'Remis: dreifache Stellungswiederholung',
  aufgabe: 'Aufgegeben',
  zeit: 'Zeit abgelaufen',
  vereinbart: 'Remis vereinbart',
};
