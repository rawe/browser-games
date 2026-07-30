// Spielsitzung: der veränderliche Zustand eines laufenden Levels.
//
// Auch dieses Modul ist DOM-frei. Die GUI liest daraus nur ab; die
// Headless-Simulation spielt damit ganze Level durch.

import { flipOrient, startOrientations, cellAt } from './level.js';
import { traceBeam, litCount } from './beam.js';

/** Neue Sitzung im Startzustand des Levels. */
export function createSession(level) {
  const session = {
    level,
    orientations: startOrientations(level),
    moves: 0,
    trace: null,
    /** Zug-Historie als Spiegel-Indizes – erlaubt „Zurück“. */
    history: [],
  };
  refresh(session);
  return session;
}

/** Lichtverlauf neu berechnen. Nach jeder Zustandsänderung aufrufen. */
export function refresh(session) {
  session.trace = traceBeam(session.level, session.orientations);
  session.lit = litCount(session.level, session.trace);
  session.solved = session.trace.solved;
  return session.trace;
}

/**
 * Spiegel auf (x,y) drehen.
 * @returns {boolean} true, wenn dort ein drehbarer Spiegel lag
 */
export function toggleAt(session, x, y) {
  const cell = cellAt(session.level, x, y);
  if (!cell || cell.type !== 'mirror' || cell.locked) return false;
  return toggleMirror(session, cell.index);
}

/** Spiegel über seinen Index drehen. */
export function toggleMirror(session, index) {
  const mirror = session.level.mirrors[index];
  if (!mirror || mirror.locked) return false;
  session.orientations[index] = flipOrient(session.orientations[index]);
  session.moves += 1;
  session.history.push(index);
  refresh(session);
  return true;
}

/** Letzten Zug zurücknehmen. */
export function undo(session) {
  const index = session.history.pop();
  if (index === undefined) return false;
  session.orientations[index] = flipOrient(session.orientations[index]);
  session.moves += 1; // Zurücknehmen kostet ebenfalls einen Zug
  refresh(session);
  return true;
}

/** Level auf den Startzustand zurücksetzen. */
export function resetSession(session) {
  session.orientations = startOrientations(session.level);
  session.moves = 0;
  session.history = [];
  refresh(session);
  return session;
}

/**
 * Sternbewertung. Der Par-Wert ist die vom Solver ermittelte Mindestzahl an
 * Drehungen – wer ihn trifft, hat den kürzesten Weg gefunden.
 */
export function rating(level, moves) {
  const par = level.par ?? 0;
  if (!par) return 3;
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par / 2))) return 2;
  return 1;
}
