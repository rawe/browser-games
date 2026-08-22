// Zuggenerierung, Angriffserkennung, Zug ausführen und zurücknehmen.
//
// Erzeugt werden zunächst *pseudolegale* Züge: alles, was die Gangart der Figur
// hergibt, ohne Rücksicht auf den eigenen König. `legalMoves()` spielt jeden
// davon aus und verwirft ihn, wenn der eigene König danach im Schach steht.
// Das ist der langsamere, aber kurze und nachweislich korrekte Weg – die Suche
// arbeitet ohnehin mit `makeMove`/`unmakeMove` und zahlt kaum drauf.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
  makePiece, typeOf, colorOf, other, onBoard, rankOf, square,
} from './board.js';

const KNIGHT_STEPS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_STEPS = [16, -16, 1, -1, 17, 15, -15, -17];
const BISHOP_DIRS = [17, 15, -15, -17];
const ROOK_DIRS = [16, -16, 1, -1];
const QUEEN_DIRS = KING_STEPS;

/** Gleitfiguren: welche Richtungen laufen sie ab? */
const SLIDERS = { [BISHOP]: BISHOP_DIRS, [ROOK]: ROOK_DIRS, [QUEEN]: QUEEN_DIRS };

/** Marschrichtung, Grundreihe und Umwandlungsreihe je Farbe. */
export const PAWN_DIR = [16, -16];
const PAWN_HOME = [1, 6];
const PROMO_RANK = [7, 0];

/** Zugarten. `flag` steuert Ausführung, Notation, Klang und Animation. */
export const NORMAL = 0;
export const DOUBLE_PAWN = 1;
export const EN_PASSANT = 2;
export const CASTLE_KING = 3;
export const CASTLE_QUEEN = 4;

const move = (from, to, piece, captured, promo = 0, flag = NORMAL) =>
  ({ from, to, piece, captured, promo, flag });

/**
 * Wird `sq` von einer Figur der Farbe `by` angegriffen?
 *
 * Gefragt wird rückwärts: Von `sq` aus in alle Richtungen schauen, ob dort
 * eine Figur steht, die genau so ziehen könnte. Das kostet konstante Zeit
 * statt einer vollständigen Zuggenerierung der Gegenseite.
 */
export function isAttacked(board, sq, by) {
  // Bauern schlagen dem Marsch entgegen – also von `sq` aus gegen ihre
  // Laufrichtung suchen.
  const pawnStep = -PAWN_DIR[by];
  for (const side of [1, -1]) {
    const from = sq + pawnStep + side;
    if (onBoard(from) && board[from] === makePiece(PAWN, by)) return true;
  }

  const knight = makePiece(KNIGHT, by);
  for (const step of KNIGHT_STEPS) {
    const from = sq + step;
    if (onBoard(from) && board[from] === knight) return true;
  }

  const king = makePiece(KING, by);
  for (const step of KING_STEPS) {
    const from = sq + step;
    if (onBoard(from) && board[from] === king) return true;
  }

  for (const dirs of [BISHOP_DIRS, ROOK_DIRS]) {
    const slider = dirs === BISHOP_DIRS ? BISHOP : ROOK;
    for (const dir of dirs) {
      for (let from = sq + dir; onBoard(from); from += dir) {
        const piece = board[from];
        if (!piece) continue;
        if (colorOf(piece) === by) {
          const type = typeOf(piece);
          if (type === slider || type === QUEEN) return true;
        }
        break;
      }
    }
  }
  return false;
}

/** Steht der König von `color` im Schach? */
export const inCheck = (state, color = state.turn) =>
  state.kings[color] >= 0 && isAttacked(state.board, state.kings[color], other(color));

/**
 * Alle pseudolegalen Züge der Seite am Zug.
 *
 * @param {object} state
 * @param {boolean} capturesOnly  nur Schlagzüge und Umwandlungen – für die
 *                                Ruhesuche der KI
 */
export function generateMoves(state, capturesOnly = false) {
  const { board, turn } = state;
  const foe = other(turn);
  const moves = [];

  for (let from = 0; from < 128; from += 1) {
    if (from & 0x88) { from += 7; continue; }
    const piece = board[from];
    if (!piece || colorOf(piece) !== turn) continue;
    const type = typeOf(piece);

    if (type === PAWN) {
      pawnMoves(state, from, piece, moves, capturesOnly);
      continue;
    }

    if (type === KNIGHT || type === KING) {
      for (const step of type === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
        const to = from + step;
        if (!onBoard(to)) continue;
        const target = board[to];
        if (target && colorOf(target) === turn) continue;
        if (capturesOnly && !target) continue;
        moves.push(move(from, to, piece, target));
      }
      continue;
    }

    for (const dir of SLIDERS[type]) {
      for (let to = from + dir; onBoard(to); to += dir) {
        const target = board[to];
        if (target && colorOf(target) === turn) break;
        if (!capturesOnly || target) moves.push(move(from, to, piece, target));
        if (target) break;
      }
    }
  }

  if (!capturesOnly) castlingMoves(state, foe, moves);
  return moves;
}

function pawnMoves(state, from, piece, moves, capturesOnly) {
  const { board, turn } = state;
  const dir = PAWN_DIR[turn];
  const promoRank = PROMO_RANK[turn];

  const push = (to, captured, flag = NORMAL) => {
    if (rankOf(to) === promoRank) {
      for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
        moves.push(move(from, to, piece, captured, promo, flag));
      }
    } else {
      moves.push(move(from, to, piece, captured, 0, flag));
    }
  };

  const ahead = from + dir;
  // Die Umwandlung ist auch ohne Schlag ein scharfer Zug – die Ruhesuche darf
  // sie nicht übersehen, sonst hängt eine Dame einen Halbzug hinter dem
  // Horizont.
  if (onBoard(ahead) && !board[ahead]) {
    if (!capturesOnly || rankOf(ahead) === promoRank) push(ahead, 0);
    const twoAhead = ahead + dir;
    if (!capturesOnly && rankOf(from) === PAWN_HOME[turn] && !board[twoAhead]) {
      moves.push(move(from, twoAhead, piece, 0, 0, DOUBLE_PAWN));
    }
  }

  for (const side of [1, -1]) {
    const to = ahead + side;
    if (!onBoard(to)) continue;
    const target = board[to];
    if (target && colorOf(target) !== turn) push(to, target);
    else if (!target && to === state.ep) {
      moves.push(move(from, to, piece, makePiece(PAWN, other(turn)), 0, EN_PASSANT));
    }
  }
}

/**
 * Rochade. Geprüft wird hier schon vollständig: Recht vorhanden, Felder
 * zwischen König und Turm frei, König steht nicht im Schach und überschreitet
 * kein angegriffenes Feld. Damit ist die Rochade der einzige Zug, der bereits
 * pseudolegal auch legal ist – der Rest erledigt `legalMoves`.
 */
function castlingMoves(state, foe, moves) {
  const { board, turn, castling } = state;
  const king = state.kings[turn];
  if (king < 0) return;
  const home = turn === WHITE ? square(4, 0) : square(4, 7);
  if (king !== home) return;
  if (isAttacked(board, king, foe)) return;

  const shortRight = turn === WHITE ? CASTLE_WK : CASTLE_BK;
  const longRight = turn === WHITE ? CASTLE_WQ : CASTLE_BQ;
  const rook = makePiece(ROOK, turn);

  if (castling & shortRight
    && board[king + 3] === rook
    && !board[king + 1] && !board[king + 2]
    && !isAttacked(board, king + 1, foe) && !isAttacked(board, king + 2, foe)) {
    moves.push(move(king, king + 2, board[king], 0, 0, CASTLE_KING));
  }

  if (castling & longRight
    && board[king - 4] === rook
    && !board[king - 1] && !board[king - 2] && !board[king - 3]
    && !isAttacked(board, king - 1, foe) && !isAttacked(board, king - 2, foe)) {
    moves.push(move(king, king - 2, board[king], 0, 0, CASTLE_QUEEN));
  }
}

/** Welche Rochaderechte hängen an welchem Feld? */
const RIGHTS_LOST = new Int8Array(128);
RIGHTS_LOST[square(4, 0)] = CASTLE_WK | CASTLE_WQ;
RIGHTS_LOST[square(0, 0)] = CASTLE_WQ;
RIGHTS_LOST[square(7, 0)] = CASTLE_WK;
RIGHTS_LOST[square(4, 7)] = CASTLE_BK | CASTLE_BQ;
RIGHTS_LOST[square(0, 7)] = CASTLE_BQ;
RIGHTS_LOST[square(7, 7)] = CASTLE_BK;

/**
 * Zug ausführen. Gibt die Rücknahmedaten zurück – ohne sie ist `unmakeMove`
 * nicht möglich, weil Rochaderecht, En-passant-Feld und Zugzähler nicht aus
 * dem Brett allein rekonstruierbar sind.
 */
export function makeMove(state, mv) {
  const { board } = state;
  const undo = { castling: state.castling, ep: state.ep, half: state.half, capturedSq: -1 };
  const color = colorOf(mv.piece);

  if (mv.flag === EN_PASSANT) {
    const victim = mv.to - PAWN_DIR[color];
    undo.capturedSq = victim;
    board[victim] = 0;
  } else if (mv.captured) {
    undo.capturedSq = mv.to;
  }

  board[mv.from] = 0;
  board[mv.to] = mv.promo ? makePiece(mv.promo, color) : mv.piece;

  if (mv.flag === CASTLE_KING) {
    board[mv.to + 1] = 0;
    board[mv.to - 1] = makePiece(ROOK, color);
  } else if (mv.flag === CASTLE_QUEEN) {
    board[mv.to - 2] = 0;
    board[mv.to + 1] = makePiece(ROOK, color);
  }

  if (typeOf(mv.piece) === KING) state.kings[color] = mv.to;

  state.castling &= ~(RIGHTS_LOST[mv.from] | RIGHTS_LOST[mv.to]);
  state.ep = mv.flag === DOUBLE_PAWN ? mv.from + PAWN_DIR[color] : -1;
  state.half = mv.captured || typeOf(mv.piece) === PAWN ? 0 : state.half + 1;
  if (color === BLACK) state.full += 1;
  state.turn = other(color);
  return undo;
}

/** Zug zurücknehmen. `undo` stammt aus dem zugehörigen `makeMove`. */
export function unmakeMove(state, mv, undo) {
  const { board } = state;
  const color = colorOf(mv.piece);

  board[mv.from] = mv.piece;
  board[mv.to] = 0;
  if (undo.capturedSq >= 0) board[undo.capturedSq] = mv.captured;

  if (mv.flag === CASTLE_KING) {
    board[mv.to - 1] = 0;
    board[mv.to + 1] = makePiece(ROOK, color);
  } else if (mv.flag === CASTLE_QUEEN) {
    board[mv.to + 1] = 0;
    board[mv.to - 2] = makePiece(ROOK, color);
  }

  if (typeOf(mv.piece) === KING) state.kings[color] = mv.from;

  state.castling = undo.castling;
  state.ep = undo.ep;
  state.half = undo.half;
  if (color === BLACK) state.full -= 1;
  state.turn = color;
}

/** Alle Züge, nach denen der eigene König nicht im Schach steht. */
export function legalMoves(state) {
  const color = state.turn;
  const legal = [];
  for (const mv of generateMoves(state)) {
    const undo = makeMove(state, mv);
    if (!inCheck(state, color)) legal.push(mv);
    unmakeMove(state, mv, undo);
  }
  return legal;
}

/** Zwei Züge sind gleich, wenn Start, Ziel und Umwandlungsfigur übereinstimmen. */
export const sameMove = (a, b) =>
  !!a && !!b && a.from === b.from && a.to === b.to && a.promo === b.promo;
