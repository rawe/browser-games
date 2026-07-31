// Spielsitzung: der veränderliche Zustand eines laufenden Levels.
//
// Auch dieses Modul ist DOM-frei. Die GUI liest daraus nur ab; die
// Headless-Simulation spielt damit ganze Level durch.
//
// Der gesamte veränderliche Zustand steckt in `config`: ein Zustands-Index je
// Regler. Ein Spiegel hat zwei Zustände, eine Fassung drei (leer → / → \). Ein
// Zug ist immer dasselbe – einen Regler eine Stufe weiterschalten.

import { cellAt, startConfig, deviceState, prismsLeft } from './level.js';
import { traceBeam, litCount } from './beam.js';

/** Neue Sitzung im Startzustand des Levels. */
export function createSession(level) {
  const session = {
    level,
    config: startConfig(level),
    moves: 0,
    trace: null,
    /** Zug-Historie als Regler-Indizes – erlaubt „Zurück“. */
    history: [],
  };
  refresh(session);
  return session;
}

/** Lichtverlauf neu berechnen. Nach jeder Zustandsänderung aufrufen. */
export function refresh(session) {
  session.trace = traceBeam(session.level, session.config);
  session.lit = litCount(session.level, session.trace);
  session.solved = session.trace.solved;
  session.prismsLeft = prismsLeft(session.level, session.config);
  return session.trace;
}

/**
 * Darf dieser Regler eine Stufe weiter?
 *
 * Der einzige Grund, warum nicht: Eine leere Fassung soll ein Prisma aufnehmen,
 * aber der Vorrat ist leer.
 */
function canStep(session, control, step) {
  const device = session.level.controls[control];
  if (device.kind !== 'socket') return true;
  const k = device.states.length;
  const from = device.states[session.config[control]];
  const to = device.states[(session.config[control] + step + k) % k];
  if (from !== null || to === null) return true;
  return prismsLeft(session.level, session.config) > 0;
}

/** Einen Regler um `step` Stufen weiterschalten, ohne Zug zu zählen. */
function step(session, control, delta) {
  const k = session.level.controls[control].states.length;
  session.config[control] = (session.config[control] + delta + k) % k;
}

/**
 * Regler auf (x,y) eine Stufe weiterschalten – Spiegel kippen, Fassungen
 * zyklieren leer → / → \ → leer.
 *
 * @returns {boolean} true, wenn der Zug zustande kam
 */
export function cycleAt(session, x, y) {
  const cell = cellAt(session.level, x, y);
  if (!cell || cell.device === -1) return false;
  const device = session.level.devices[cell.device];
  if (device.control === -1) return false;
  return cycleControl(session, device.control);
}

/** Regler über seinen Index eine Stufe weiterschalten. */
export function cycleControl(session, control) {
  if (control < 0 || control >= session.level.controls.length) return false;
  if (!canStep(session, control, 1)) return false;
  step(session, control, 1);
  session.moves += 1;
  session.history.push(control);
  refresh(session);
  return true;
}

/** Letzten Zug zurücknehmen. */
export function undo(session) {
  const control = session.history.pop();
  if (control === undefined) return false;
  step(session, control, -1);
  session.moves += 1; // Zurücknehmen kostet ebenfalls einen Zug
  refresh(session);
  return true;
}

/** Level auf den Startzustand zurücksetzen. */
export function resetSession(session) {
  session.config = startConfig(session.level);
  session.moves = 0;
  session.history = [];
  refresh(session);
  return session;
}

/** Zustand eines Bauteils in dieser Sitzung – für Renderer und Ausgabe. */
export function stateAt(session, device) {
  return deviceState(session.level, session.config, device);
}

/**
 * Sternbewertung. Der Par-Wert ist die vom Solver ermittelte Mindestzahl an
 * Zügen – wer ihn trifft, hat den kürzesten Weg gefunden.
 *
 * Ohne Par gibt es **keine** Sterne, sondern `null`. Ein Stern ist eine Aussage
 * über Optimalität; wo niemand das Minimum kennt, lässt sie sich nicht treffen.
 * Selbstgebaute Level, deren Suchraum zu groß für die vollständige Suche war,
 * zählen deshalb Züge statt Sterne (siehe `editor/`).
 */
export function rating(level, moves) {
  const par = level.par ?? 0;
  if (!par) return null;
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par / 2))) return 2;
  return 1;
}
