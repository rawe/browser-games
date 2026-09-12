// Suche: Negamax mit Alpha-Beta-Schnitt, Ruhesuche und iterativer Vertiefung.
//
// Negamax ist Minimax in einer Zeile: Was für die eine Seite gut ist, ist für
// die andere schlecht, also genügt ein Vorzeichenwechsel pro Halbzug. Der
// Alpha-Beta-Schnitt überspringt Varianten, die nachweislich nicht mehr
// gewählt werden – bei guter Zugsortierung schafft er statt der halben Tiefe
// fast die volle.
//
// Zwei Dinge tragen die Spielstärke:
//   * **Ruhesuche** – am Ende der Tiefe wird nicht mitten im Abtausch
//     abgebrochen, sondern nur noch geschlagen, bis das Brett ruhig ist. Ohne
//     sie stellt die Engine ihre Dame ein, weil sie den Rückschlag einen
//     Halbzug hinter dem Horizont nicht mehr sieht.
//   * **Zugsortierung** – Hauptvariante der Vorrunde, dann Schlagzüge nach
//     MVV-LVA (billige Figur schlägt teure zuerst), dann Killerzüge.

import { WHITE, typeOf, colorOf } from '../engine/board.js';
import { generateMoves, makeMove, unmakeMove, inCheck, sameMove } from '../engine/moves.js';
import { evaluate, PIECE_VALUE } from './evaluate.js';

export const MATE = 30000;
/** Ab diesem Betrag ist eine Bewertung ein Matt und keine Stellungszahl mehr. */
export const MATE_THRESHOLD = MATE - 1000;

/** Wie viele Züge trennen uns vom Matt? Für die Anzeige „Matt in 3“. */
export const mateDistance = (score) =>
  Math.abs(score) >= MATE_THRESHOLD ? Math.ceil((MATE - Math.abs(score)) / 2) : null;

const now = () => (typeof performance === 'object' ? performance.now() : Date.now());

/**
 * Besten Zug suchen.
 *
 * @param {object} state Stellung – wird während der Suche verändert und am
 *                       Ende unverändert zurückgelassen
 * @param {{depth?: number, timeMs?: number, random?: number,
 *          onProgress?: (info: object) => void}} options
 *        `random` streut die Wurzelbewertung in Hundertstelbauern – so spielt
 *        ein schwacher Gegner nicht immer dieselbe Partie und lässt hin und
 *        wieder etwas liegen.
 * @returns {{move: object|null, score: number, depth: number, nodes: number,
 *            line: object[]}}
 */
export function search(state, options = {}) {
  const { depth = 4, timeMs = Infinity, random = 0, onProgress } = options;
  const deadline = timeMs === Infinity ? Infinity : now() + timeMs;

  const context = {
    nodes: 0,
    deadline,
    stop: false,
    // Killerzüge: stille Züge, die auf dieser Tiefe schon einmal einen Schnitt
    // ausgelöst haben. Sie kosten nichts und ordnen erstaunlich gut.
    killers: Array.from({ length: 64 }, () => [null, null]),
    history: new Int32Array(128 * 128),
  };

  const rootColor = state.turn;
  let best = { move: null, score: 0, depth: 0, nodes: 0, line: [] };
  let previous = null;

  for (let iteration = 1; iteration <= depth; iteration += 1) {
    const line = [];
    const score = negamax(state, iteration, 0, -MATE, MATE, context, previous, line, random);
    if (context.stop && iteration > 1) break;

    previous = line[0] ?? previous;
    best = {
      move: line[0] ?? best.move,
      score: rootColor === WHITE ? score : -score,
      depth: iteration,
      nodes: context.nodes,
      line: [...line],
    };
    onProgress?.(best);

    // Ein erzwungenes Matt macht tiefer suchen sinnlos.
    if (Math.abs(score) >= MATE_THRESHOLD) break;
    if (now() >= deadline) break;
  }

  // Die Bewertung wird nach außen aus Sicht von Weiß gemeldet, damit ein
  // Bewertungsbalken sie ohne Rückfrage anzeigen kann.
  return best;
}

function negamax(state, depth, ply, alpha, beta, context, pvMove, line, random) {
  if ((context.nodes & 1023) === 0 && now() >= context.deadline) context.stop = true;
  if (context.stop && ply > 0) return 0;

  const color = state.turn;
  const checked = inCheck(state, color);
  // Im Schach eine Tiefe zugeben: Die Fortsetzung ist erzwungen und dadurch
  // billig – und ein Mattnetz eine Tiefe zu früh abzuschneiden ist teuer.
  if (checked) depth += 1;

  if (depth <= 0) return quiescence(state, alpha, beta, context, ply);

  context.nodes += 1;
  const moves = generateMoves(state);
  order(moves, state, context, ply, ply === 0 ? pvMove : null);

  let legal = 0;
  let bestScore = -MATE - 1;
  const childLine = [];

  for (const mv of moves) {
    const undo = makeMove(state, mv);
    if (inCheck(state, color)) { unmakeMove(state, mv, undo); continue; }
    legal += 1;

    childLine.length = 0;
    let score = -negamax(state, depth - 1, ply + 1, -beta, -alpha, context, null, childLine, 0);
    // Etwas Rauschen an der Wurzel: gleichwertige Züge werden dadurch
    // gewürfelt, statt immer den ersten der Liste zu nehmen.
    if (random && ply === 0) score += Math.round((Math.random() * 2 - 1) * random);

    unmakeMove(state, mv, undo);
    if (context.stop && ply > 0) return 0;

    if (score > bestScore) {
      bestScore = score;
      if (score > alpha) {
        alpha = score;
        line.length = 0;
        line.push(mv, ...childLine);
      }
    }

    if (alpha >= beta) {
      if (!mv.captured && !mv.promo) {
        const killers = context.killers[ply];
        if (!sameMove(killers[0], mv)) { killers[1] = killers[0]; killers[0] = mv; }
        context.history[mv.from * 128 + mv.to] += depth * depth;
      }
      break;
    }
  }

  if (!legal) {
    line.length = 0;
    // Matt möglichst spät, Patt ist null. Der Abstand zum Wurzelknoten macht
    // ein schnelles Matt attraktiver als ein langsames.
    return checked ? -MATE + ply : 0;
  }
  return bestScore;
}

/**
 * Ruhesuche: nur noch Schlagzüge und Umwandlungen, bis nichts mehr hängt.
 *
 * `standPat` ist die Bewertung des Nichtstuns. Wer schon über `beta` steht,
 * braucht gar nicht mehr zu schlagen; wer darunter steht, versucht es.
 */
function quiescence(state, alpha, beta, context, ply) {
  context.nodes += 1;
  if ((context.nodes & 1023) === 0 && now() >= context.deadline) context.stop = true;

  const raw = evaluate(state);
  const standPat = state.turn === WHITE ? raw : -raw;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  // Ohne Deckel könnte eine lange Schlagfolge die Suche in seltenen Stellungen
  // sehr tief treiben.
  if (ply > 32) return alpha;

  const color = state.turn;
  const captures = generateMoves(state, true);
  order(captures, state, context, ply, null);

  for (const mv of captures) {
    const undo = makeMove(state, mv);
    if (inCheck(state, color)) { unmakeMove(state, mv, undo); continue; }
    const score = -quiescence(state, -beta, -alpha, context, ply + 1);
    unmakeMove(state, mv, undo);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** MVV-LVA: das wertvollste Opfer zuerst, geschlagen von der billigsten Figur. */
const captureScore = (mv) =>
  1_000_000 + PIECE_VALUE[typeOf(mv.captured)] * 16 - PIECE_VALUE[typeOf(mv.piece)];

function order(moves, state, context, ply, pvMove) {
  const killers = context.killers[ply] ?? [null, null];
  for (const mv of moves) {
    if (pvMove && sameMove(mv, pvMove)) { mv.order = 9_000_000; continue; }
    if (mv.captured) { mv.order = captureScore(mv); continue; }
    if (mv.promo) { mv.order = 800_000 + PIECE_VALUE[mv.promo]; continue; }
    if (sameMove(killers[0], mv)) { mv.order = 700_000; continue; }
    if (sameMove(killers[1], mv)) { mv.order = 690_000; continue; }
    mv.order = context.history[mv.from * 128 + mv.to];
  }
  moves.sort((a, b) => b.order - a.order);
}
