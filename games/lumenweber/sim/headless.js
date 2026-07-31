// Lumenweber ohne Browser spielen.
//
// Benutzt exakt dieselben Module wie die GUI (`level.js`, `optics.js`,
// `beam.js`, `game.js`) – nur eben ohne Canvas, DOM und Eingabegeräte. Damit
// lässt sich jedes Level durchspielen, messen und prüfen, bevor überhaupt ein
// Pixel gezeichnet wird.

import { createSession, cycleControl, resetSession, rating } from '../game.js';
import { placedPrisms } from '../level.js';
import { solveLevel, irrelevantControls, searchSpace } from './solver.js';
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
  for (const control of solution.moves) {
    if (!cycleControl(session, control)) {
      throw new Error(`Level ${level.id}: Zug auf Regler ${control} wurde abgewiesen`);
    }
  }
  return { session, solution, ok: session.solved };
}

/** Kennzahlen eines Levels – die Tabelle von `npm run sim:lumen`. */
export function levelReport(level) {
  const { session, solution, ok } = playSolution(level);
  const start = createSession(level);
  const idle = irrelevantControls(level);
  const count = (kind) => level.devices.filter((d) => d.kind === kind).length;
  return {
    id: level.id,
    name: level.name,
    size: `${level.width}×${level.height}`,
    mirrors: count('mirror'),
    prisms: count('prism'),
    sockets: count('socket'),
    stock: level.prisms,
    usedPrisms: solution.config ? placedPrisms(level, solution.config) : 0,
    controls: level.controls.length,
    locked: level.devices.filter((d) => d.locked).length,
    walls: level.cells.filter((c) => c.type === 'wall').length,
    targets: level.targets.length,
    colored: level.targets.filter((t) => t.want !== 'any').length,
    litAtStart: start.lit,
    declaredPar: level.par,
    solvedPar: solution.par,
    solutions: solution.solutions,
    optimal: solution.optimal,
    idleControls: idle.length,
    states: searchSpace(level),
    beamLength: Number(session.trace.length.toFixed(1)),
    paths: session.trace.paths.length,
    splits: session.trace.splits.length,
    solvable: solution.solvable,
    solvedAtStart: solution.solvedAtStart,
    ok,
  };
}

/**
 * Zufälliges Herumtippen – prüft, dass die Logik in jedem erreichbaren
 * Zustand stabil bleibt (endlicher Strahl, konsistente Zähler, keine
 * Ausnahmen). Ringe im Lichtweg sind dabei ausdrücklich erlaubt und müssen
 * ohne Endlosschleife enden.
 */
export function fuzzLevel(level, { taps = 400, seed = 1 } = {}) {
  const random = rng(seed);
  const session = createSession(level);
  let solvedSeen = 0;
  let maxLength = 0;
  let maxPaths = 0;
  for (let i = 0; i < taps; i += 1) {
    cycleControl(session, Math.floor(random() * level.controls.length));
    if (session.solved) solvedSeen += 1;
    maxLength = Math.max(maxLength, session.trace.length);
    maxPaths = Math.max(maxPaths, session.trace.paths.length);
    if (!Number.isFinite(session.trace.length)) {
      throw new Error(`Level ${level.id}: unendlicher Lichtweg nach ${i} Tipps`);
    }
    if (session.lit > level.targets.length) {
      throw new Error(`Level ${level.id}: mehr Ziele erhellt als vorhanden`);
    }
    if (session.prismsLeft < 0) {
      throw new Error(`Level ${level.id}: mehr Prismen gesetzt als im Vorrat`);
    }
  }
  resetSession(session);
  return { taps, solvedSeen, maxLength: Number(maxLength.toFixed(1)), maxPaths };
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
