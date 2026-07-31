// Lumenweber ohne Browser spielen.
//
// Benutzt exakt dieselben Module wie die GUI (`level.js`, `beam.js`,
// `game.js`) – nur eben ohne Canvas, DOM und Eingabegeräte. Damit lässt sich
// jedes Level durchspielen, messen und prüfen, bevor überhaupt ein Pixel
// gezeichnet wird.

import { createSession, toggleMirror, resetSession, rating } from '../game.js';
import { solveLevel, irrelevantMirrors } from './solver.js';
import { renderSession } from './ascii.js';

/** Kleiner deterministischer Zufallsgenerator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Level mit der optimalen Zugfolge lösen und die Sitzung zurückgeben. */
export function playSolution(level) {
  const session = createSession(level);
  const solution = solveLevel(level);
  if (!solution.solvable) return { session, solution, ok: false };
  for (const index of solution.moves) toggleMirror(session, index);
  return { session, solution, ok: session.solved };
}

/** Kennzahlen eines Levels – die Tabelle von `npm run sim:lumen`. */
export function levelReport(level) {
  const { session, solution, ok } = playSolution(level);
  const start = createSession(level);
  const idle = irrelevantMirrors(level);
  return {
    id: level.id,
    name: level.name,
    size: `${level.width}×${level.height}`,
    mirrors: level.mirrors.length,
    rotatable: level.rotatable.length,
    locked: level.mirrors.length - level.rotatable.length,
    walls: level.cells.filter((c) => c.type === 'wall').length,
    targets: level.targets.length,
    litAtStart: start.lit,
    declaredPar: level.par,
    solvedPar: solution.par,
    solutions: solution.solutions,
    optimal: solution.optimal,
    idleMirrors: idle.length,
    beamLength: Number(session.trace.length.toFixed(1)),
    solvable: solution.solvable,
    solvedAtStart: solution.solvedAtStart,
    ok,
  };
}

/**
 * Zufälliges Herumtippen – prüft, dass die Logik in jedem erreichbaren
 * Zustand stabil bleibt (endlicher Strahl, konsistente Zähler, keine
 * Ausnahmen). Schleifen im Lichtweg sind dabei ausdrücklich erlaubt und
 * müssen ohne Endlosschleife enden.
 */
export function fuzzLevel(level, { taps = 400, seed = 1 } = {}) {
  const random = rng(seed);
  const session = createSession(level);
  const rot = level.rotatable;
  let solvedSeen = 0;
  let maxLength = 0;
  for (let i = 0; i < taps; i += 1) {
    toggleMirror(session, rot[Math.floor(random() * rot.length)]);
    if (session.solved) solvedSeen += 1;
    maxLength = Math.max(maxLength, session.trace.length);
    if (!Number.isFinite(session.trace.length)) {
      throw new Error(`Level ${level.id}: unendlicher Lichtweg nach ${i} Tipps`);
    }
    if (session.lit > level.targets.length) {
      throw new Error(`Level ${level.id}: mehr Ziele erhellt als vorhanden`);
    }
  }
  resetSession(session);
  return { taps, solvedSeen, maxLength: Number(maxLength.toFixed(1)) };
}

/** Vollständige Textausgabe eines gelösten Levels. */
export function showSolved(level) {
  const { session } = playSolution(level);
  return `${renderSession(session)}  ·  ${rating(level, session.moves)}★`;
}

/** Textausgabe des Startzustands. */
export function showStart(level) {
  return renderSession(createSession(level));
}
