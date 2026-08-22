// Brettdarstellung im 0x88-Format.
//
// Ein Feld ist `rank * 16 + file`, Reihe 0 ist die weiße Grundreihe, Linie 0
// ist die a-Linie. Die oberen vier Bit jedes Index bilden eine zweite,
// unbenutzte Brettbreite ab – deshalb erkennt `(sq & 0x88) === 0` mit einer
// einzigen Und-Verknüpfung, ob ein Feld noch auf dem Brett liegt. Das spart
// der Zuggenerierung und der Suche pro Schritt eine Bereichsprüfung.
//
// Dieses Modul kennt nur Felder, Figuren und FEN – keine Regeln, kein DOM.

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WHITE = 0;
export const BLACK = 1;

/** Rochaderechte als Bitmaske. */
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

/** Figurencode: Typ in den unteren drei Bit, Farbe im vierten. */
export const makePiece = (type, color) => type | (color << 3);
export const typeOf = (piece) => piece & 7;
export const colorOf = (piece) => piece >> 3;
export const other = (color) => color ^ 1;

export const onBoard = (sq) => (sq & 0x88) === 0;
export const fileOf = (sq) => sq & 15;
export const rankOf = (sq) => sq >> 4;
export const square = (file, rank) => rank * 16 + file;

/** Feldfarbe: 1 für helle Felder, 0 für dunkle. */
export const isLightSquare = (sq) => ((fileOf(sq) + rankOf(sq)) & 1) === 1;

/** `e4` ← 0x34. Für Notation und Fehlermeldungen. */
export const squareName = (sq) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);

/** `e4` → 0x34, `-1` bei Unsinn. */
export function squareFromName(name) {
  const file = 'abcdefgh'.indexOf(name?.[0]);
  const rank = Number(name?.[1]) - 1;
  return file < 0 || !(rank >= 0 && rank <= 7) ? -1 : square(file, rank);
}

const FEN_CHARS = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
const FEN_LETTERS = [null, 'p', 'n', 'b', 'r', 'q', 'k'];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Stellung aus einer FEN lesen.
 *
 * @returns {{board: Int8Array, turn: number, castling: number, ep: number,
 *            half: number, full: number, kings: number[]}}
 */
export function parseFen(fen = START_FEN) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Int8Array(128);
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') { rank -= 1; file = 0; continue; }
    if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
    const type = FEN_CHARS[ch.toLowerCase()];
    if (!type) throw new Error(`FEN: unbekannte Figur "${ch}"`);
    board[square(file, rank)] = makePiece(type, ch === ch.toLowerCase() ? BLACK : WHITE);
    file += 1;
  }

  const state = {
    board,
    turn: turn === 'b' ? BLACK : WHITE,
    castling:
      (castling.includes('K') ? CASTLE_WK : 0) |
      (castling.includes('Q') ? CASTLE_WQ : 0) |
      (castling.includes('k') ? CASTLE_BK : 0) |
      (castling.includes('q') ? CASTLE_BQ : 0),
    ep: ep && ep !== '-' ? squareFromName(ep) : -1,
    half: Number(half ?? 0) || 0,
    full: Number(full ?? 1) || 1,
    kings: [-1, -1],
  };
  refreshKings(state);
  return state;
}

/** Königsfelder aus dem Brett heraussuchen. */
function refreshKings(state) {
  state.kings = [-1, -1];
  for (let sq = 0; sq < 128; sq += 1) {
    if (!onBoard(sq)) continue;
    const piece = state.board[sq];
    if (piece && typeOf(piece) === KING) state.kings[colorOf(piece)] = sq;
  }
}

/** Stellung als FEN. Dient auch als Schlüssel für die Stellungswiederholung. */
export function toFen(state) {
  let placement = '';
  for (let rank = 7; rank >= 0; rank -= 1) {
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = state.board[square(file, rank)];
      if (!piece) { empty += 1; continue; }
      if (empty) { placement += empty; empty = 0; }
      const letter = FEN_LETTERS[typeOf(piece)];
      placement += colorOf(piece) === WHITE ? letter.toUpperCase() : letter;
    }
    if (empty) placement += empty;
    if (rank) placement += '/';
  }

  const rights =
    (state.castling & CASTLE_WK ? 'K' : '') +
    (state.castling & CASTLE_WQ ? 'Q' : '') +
    (state.castling & CASTLE_BK ? 'k' : '') +
    (state.castling & CASTLE_BQ ? 'q' : '');

  return [
    placement,
    state.turn === WHITE ? 'w' : 'b',
    rights || '-',
    state.ep >= 0 ? squareName(state.ep) : '-',
    state.half,
    state.full,
  ].join(' ');
}

export const initialState = () => parseFen(START_FEN);
