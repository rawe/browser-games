// Stellungsbewertung in Hundertstelbauern, immer aus Sicht von Weiß.
//
// Material allein ergibt einen Gegner, der Figuren zählt, aber nicht weiß,
// wohin sie gehören. Deshalb kommt zu jedem Figurenwert ein Feldbonus aus
// einer Tabelle (Piece-Square-Table): Springer im Zentrum, Türme auf offenen
// Linien, der König in der Eröffnung hinter Bauern und im Endspiel mitten
// drin. Dazu ein paar Bauernstrukturmerkmale, die auch schwache Gegner
// erkennbar besser machen.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  typeOf, colorOf, onBoard, fileOf, rankOf,
} from '../engine/board.js';

/** Grundwerte. Der Läufer steht bewusst eine Nuance über dem Springer. */
export const PIECE_VALUE = {
  [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 0,
};

// Die Tabellen sind wie ein Brett geschrieben: erste Zeile ist Reihe 8, letzte
// Reihe 1, jeweils aus Sicht von Weiß. Für Schwarz wird die Reihe gespiegelt.
const table = (rows) => Int16Array.from(rows.flat());

const PST = {
  [PAWN]: table([
    [  0,  0,  0,  0,  0,  0,  0,  0],
    [ 50, 50, 50, 50, 50, 50, 50, 50],
    [ 10, 10, 20, 30, 30, 20, 10, 10],
    [  5,  5, 10, 25, 25, 10,  5,  5],
    [  0,  0,  0, 20, 20,  0,  0,  0],
    [  5, -5,-10,  0,  0,-10, -5,  5],
    [  5, 10, 10,-20,-20, 10, 10,  5],
    [  0,  0,  0,  0,  0,  0,  0,  0],
  ]),
  [KNIGHT]: table([
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50],
  ]),
  [BISHOP]: table([
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20],
  ]),
  [ROOK]: table([
    [  0,  0,  0,  0,  0,  0,  0,  0],
    [  5, 10, 10, 10, 10, 10, 10,  5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [  0,  0,  0,  5,  5,  0,  0,  0],
  ]),
  [QUEEN]: table([
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20],
  ]),
};

/** König in der Eröffnung: hinter die Bauern, weg aus dem Zentrum. */
const KING_OPENING = table([
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-30,-30,-20],
  [-10,-20,-20,-20,-20,-20,-20,-10],
  [ 20, 20,  0,  0,  0,  0, 20, 20],
  [ 20, 30, 10,  0,  0, 10, 30, 20],
]);

/** König im Endspiel: ab ins Zentrum, er ist dort die stärkste Figur. */
const KING_ENDGAME = table([
  [-50,-40,-30,-20,-20,-30,-40,-50],
  [-30,-20,-10,  0,  0,-10,-20,-30],
  [-30,-10, 20, 30, 30, 20,-10,-30],
  [-30,-10, 30, 40, 40, 30,-10,-30],
  [-30,-10, 30, 40, 40, 30,-10,-30],
  [-30,-10, 20, 30, 30, 20,-10,-30],
  [-30,-30,  0,  0,  0,  0,-30,-30],
  [-50,-30,-30,-30,-30,-30,-30,-50],
]);

/** Freibauern werden mit jeder Reihe gefährlicher. */
const PASSED_PAWN = [0, 8, 16, 32, 60, 100, 160, 0];

const BISHOP_PAIR = 32;
const DOUBLED_PAWN = -14;
const ISOLATED_PAWN = -16;
const ROOK_OPEN_FILE = 16;
const ROOK_HALF_OPEN = 8;

/** Tabellenindex für ein Feld – für Schwarz wird die Reihe gespiegelt. */
const pstIndex = (sq, color) =>
  (color === WHITE ? 7 - rankOf(sq) : rankOf(sq)) * 8 + fileOf(sq);

/**
 * Spielphase zwischen 0 (Endspiel) und 1 (volles Brett). Steuert, welche
 * Königstabelle gilt – ein König, der in der Eröffnung ins Zentrum läuft, ist
 * verloren, im Turmendspiel gehört er genau dorthin.
 */
const PHASE_WEIGHT = { [KNIGHT]: 1, [BISHOP]: 1, [ROOK]: 2, [QUEEN]: 4 };
const PHASE_MAX = 24;

/**
 * @param {object} state
 * @returns {number} Hundertstelbauern aus Sicht von Weiß
 */
export function evaluate(state) {
  const { board } = state;
  let score = 0;
  let phase = 0;

  // Bauern je Linie und Farbe – Grundlage für Doppel-, Isolani- und Freibauern.
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  const pawnRanks = [new Int8Array(8).fill(-1), new Int8Array(8).fill(8)];
  const bishops = [0, 0];
  const kings = [-1, -1];
  const rooks = [[], []];

  for (let sq = 0; sq < 128; sq += 1) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board[sq];
    if (!piece) continue;
    const type = typeOf(piece);
    const color = colorOf(piece);
    const sign = color === WHITE ? 1 : -1;

    score += sign * PIECE_VALUE[type];
    phase += PHASE_WEIGHT[type] ?? 0;

    if (type === KING) { kings[color] = sq; continue; }
    score += sign * PST[type][pstIndex(sq, color)];

    if (type === PAWN) {
      const file = fileOf(sq);
      pawnFiles[color][file] += 1;
      // Am weitesten vorgerückter Bauer der Linie – nur er kann Freibauer sein.
      if (color === WHITE) pawnRanks[WHITE][file] = Math.max(pawnRanks[WHITE][file], rankOf(sq));
      else pawnRanks[BLACK][file] = Math.min(pawnRanks[BLACK][file], rankOf(sq));
    } else if (type === BISHOP) {
      bishops[color] += 1;
    } else if (type === ROOK) {
      rooks[color].push(sq);
    }
  }

  for (const color of [WHITE, BLACK]) {
    const sign = color === WHITE ? 1 : -1;
    if (bishops[color] >= 2) score += sign * BISHOP_PAIR;

    if (kings[color] >= 0) {
      const opening = KING_OPENING[pstIndex(kings[color], color)];
      const endgame = KING_ENDGAME[pstIndex(kings[color], color)];
      const weight = Math.min(1, phase / PHASE_MAX);
      score += sign * Math.round(opening * weight + endgame * (1 - weight));
    }

    for (let file = 0; file < 8; file += 1) {
      const count = pawnFiles[color][file];
      if (!count) continue;
      if (count > 1) score += sign * DOUBLED_PAWN * (count - 1);
      const left = file > 0 ? pawnFiles[color][file - 1] : 0;
      const right = file < 7 ? pawnFiles[color][file + 1] : 0;
      if (!left && !right) score += sign * ISOLATED_PAWN;
      if (isPassed(pawnFiles, pawnRanks, color, file)) {
        const rank = color === WHITE ? pawnRanks[WHITE][file] : 7 - pawnRanks[BLACK][file];
        score += sign * PASSED_PAWN[rank];
      }
    }

    for (const sq of rooks[color]) {
      const file = fileOf(sq);
      if (pawnFiles[color][file]) continue;
      score += sign * (pawnFiles[color ^ 1][file] ? ROOK_HALF_OPEN : ROOK_OPEN_FILE);
    }
  }

  return score;
}

/**
 * Freibauer: auf der eigenen und den beiden Nachbarlinien steht kein
 * gegnerischer Bauer mehr vor ihm.
 *
 * Geprüft wird nur gegen den jeweils am weitesten zurückstehenden gegnerischen
 * Bauern der Linie – mehr braucht es für diese Näherung nicht.
 */
function isPassed(pawnFiles, pawnRanks, color, file) {
  const foe = color ^ 1;
  const own = color === WHITE ? pawnRanks[WHITE][file] : pawnRanks[BLACK][file];
  for (let near = file - 1; near <= file + 1; near += 1) {
    if (near < 0 || near > 7 || !pawnFiles[foe][near]) continue;
    const block = color === WHITE ? pawnRanks[BLACK][near] : pawnRanks[WHITE][near];
    if (color === WHITE ? block > own : block < own) return false;
  }
  return true;
}
