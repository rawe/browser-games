// Standard-Algebraische Notation (SAN) – das, was in der Zugliste steht.
//
// SAN ist stellungsabhängig: „Sf3“ verlangt zu wissen, ob ein zweiter Springer
// dasselbe Feld erreicht, und ob der Zug Schach oder Matt gibt. Deshalb nimmt
// `toSan` die Stellung *vor* dem Zug entgegen und braucht die Liste der dort
// legalen Züge.

import { PAWN, KING, typeOf, squareName, fileOf, rankOf } from './board.js';
import { CASTLE_KING, CASTLE_QUEEN, makeMove, unmakeMove, legalMoves, inCheck } from './moves.js';

const LETTERS = [null, '', 'S', 'L', 'T', 'D', 'K'];

/** Figurenbuchstabe im deutschen Sprachgebrauch: Springer, Läufer, Turm, Dame. */
export const pieceLetter = (type) => LETTERS[type];

/**
 * @param {object} state   Stellung vor dem Zug
 * @param {object} mv      auszuführender Zug
 * @param {object[]} legal legale Züge dieser Stellung (spart die Neuberechnung)
 */
export function toSan(state, mv, legal = legalMoves(state)) {
  if (mv.flag === CASTLE_KING) return withCheck(state, mv, '0-0');
  if (mv.flag === CASTLE_QUEEN) return withCheck(state, mv, '0-0-0');

  const type = typeOf(mv.piece);
  const capture = mv.captured ? 'x' : '';
  let text;

  if (type === PAWN) {
    text = (mv.captured ? 'abcdefgh'[fileOf(mv.from)] : '') + capture + squareName(mv.to);
  } else {
    text = pieceLetter(type) + disambiguate(mv, legal) + capture + squareName(mv.to);
  }

  if (mv.promo) text += `=${pieceLetter(mv.promo)}`;
  return withCheck(state, mv, text);
}

/**
 * Kürzestmögliche Unterscheidung, wenn mehrere gleichartige Figuren dasselbe
 * Feld erreichen: erst die Linie, dann die Reihe, notfalls beides.
 */
function disambiguate(mv, legal) {
  const rivals = legal.filter((other) =>
    other.to === mv.to && other.from !== mv.from && other.piece === mv.piece);
  if (!rivals.length) return '';

  const file = 'abcdefgh'[fileOf(mv.from)];
  const rank = String(rankOf(mv.from) + 1);
  if (!rivals.some((other) => fileOf(other.from) === fileOf(mv.from))) return file;
  if (!rivals.some((other) => rankOf(other.from) === rankOf(mv.from))) return rank;
  return file + rank;
}

/** Hängt `+` oder `#` an – dafür muss der Zug kurz ausgeführt werden. */
function withCheck(state, mv, text) {
  const undo = makeMove(state, mv);
  const check = inCheck(state);
  const mate = check && legalMoves(state).length === 0;
  unmakeMove(state, mv, undo);
  return text + (mate ? '#' : check ? '+' : '');
}

/** Züge in Paare (Weiß, Schwarz) gruppieren – für die Anzeige der Zugliste. */
export function movePairs(sans, startsWithBlack = false) {
  const pairs = [];
  let index = 0;
  if (startsWithBlack && sans.length) pairs.push({ no: 1, white: '…', black: sans[index++] });
  while (index < sans.length) {
    pairs.push({ no: pairs.length + 1, white: sans[index++], black: sans[index++] ?? '' });
  }
  return pairs;
}

/** Lange Notation für den Ausdruck im Partieprotokoll. */
export const toUci = (mv) =>
  squareName(mv.from) + squareName(mv.to) + (mv.promo ? 'nbrq'[mv.promo - 2] : '');
