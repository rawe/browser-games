// Perft – der Standardtest für Zuggeneratoren.
//
// Gezählt werden alle Blätter des Zugbaums bis zu einer Tiefe. Die Zahlen sind
// für bekannte Stellungen veröffentlicht und unbestechlich: Wer eine En-passant-
// Feinheit, ein Rochaderecht oder eine Fesselung falsch behandelt, weicht ab.

import { parseFen } from '../engine/board.js';
import { generateMoves, makeMove, unmakeMove, inCheck } from '../engine/moves.js';

export function perft(state, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  const color = state.turn;
  for (const mv of generateMoves(state)) {
    const undo = makeMove(state, mv);
    if (!inCheck(state, color)) nodes += perft(state, depth - 1);
    unmakeMove(state, mv, undo);
  }
  return nodes;
}

/** Bekannte Stellungen samt ihrer Knotenzahlen, Index = Tiefe. */
export const POSITIONS = [
  {
    name: 'Grundstellung',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    nodes: [1, 20, 400, 8902, 197281],
  },
  {
    name: 'Kiwipete (Rochade, Fesselung, Schlagfülle)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    nodes: [1, 48, 2039, 97862],
  },
  {
    name: 'Bauernendspiel mit En passant',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    nodes: [1, 14, 191, 2812, 43238],
  },
  {
    name: 'Unterverwandlung und Fesselung',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    nodes: [1, 6, 264, 9467],
  },
  {
    name: 'Enge Stellung mit Umwandlung',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    nodes: [1, 44, 1486, 62379],
  },
];

/** Alle Stellungen durchrechnen. `report(zeile)` bekommt jede Zeile. */
export function runPerft(report = () => {}) {
  const failures = [];
  for (const position of POSITIONS) {
    for (let depth = 1; depth < position.nodes.length; depth += 1) {
      const got = perft(parseFen(position.fen), depth);
      const want = position.nodes[depth];
      report(`${got === want ? '✓' : '✗'} ${position.name} d${depth}: ${got}`);
      if (got !== want) failures.push(`${position.name} d${depth}: ${got} statt ${want}`);
    }
  }
  return failures;
}
