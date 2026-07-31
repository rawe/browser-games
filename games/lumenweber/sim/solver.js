// Vollständiger Löser für Lumenweber-Level.
//
// Ein Level ist gelöst, wenn alle Ziele leuchten. Änderbar ist nur die
// Ausrichtung der drehbaren Spiegel – jeder hat genau zwei Zustände. Damit ist
// der komplette Suchraum 2^n groß und für die im Spiel benutzten Größen
// (n ≤ 20) in Sekundenbruchteilen erschöpfend durchsuchbar.
//
// Weil jeder Spiegel nur zwei Zustände hat, ist die Reihenfolge der Drehungen
// egal: Ein zweimal gedrehter Spiegel steht wieder wie vorher. Die Mindestzahl
// an Zügen ist deshalb schlicht der kleinste Hamming-Abstand zwischen der
// Startstellung und irgendeiner Lösungsstellung.

import { flipOrient, startOrientations } from '../level.js';
import { isSolved } from '../beam.js';

const popcount = (v) => {
  let n = 0;
  let x = v;
  while (x) { x &= x - 1; n += 1; }
  return n;
};

/** Obergrenze, ab der die vollständige Suche zu teuer wird. */
export const MAX_ROTATABLE = 22;

/**
 * Durchsucht alle Spiegelstellungen.
 *
 * @returns {{
 *   solvable: boolean,
 *   par: number|null,          Mindestzahl an Drehungen
 *   moves: number[],           die dafür zu drehenden Spiegel-Indizes
 *   solutions: number,         Zahl aller Lösungsstellungen
 *   optimal: number,           Zahl der Lösungen mit genau `par` Drehungen
 *   solvedAtStart: boolean,    Level ist ohne Zutun schon gelöst
 *   searched: number,
 * }}
 */
export function solveLevel(level) {
  return solveFrom(level, startOrientations(level));
}

/**
 * Dasselbe, aber von einer beliebigen Stellung aus – das ist die Grundlage der
 * Tipp-Funktion im Spiel: Sie sagt, welcher Spiegel von *hier* aus als
 * Nächstes gedreht gehört, nicht welcher vom Levelstart aus.
 */
export function solveFrom(level, base) {
  const rot = level.rotatable;
  const n = rot.length;
  if (n > MAX_ROTATABLE) {
    throw new Error(`Level ${level.id}: ${n} drehbare Spiegel – über der Suchgrenze von ${MAX_ROTATABLE}`);
  }
  const total = 2 ** n;

  let par = null;
  let bestMask = 0;
  let solutions = 0;
  let optimal = 0;
  let solvedAtStart = false;

  const orientations = base.slice();
  for (let mask = 0; mask < total; mask += 1) {
    for (let i = 0; i < n; i += 1) {
      const idx = rot[i];
      orientations[idx] = (mask >> i) & 1 ? flipOrient(base[idx]) : base[idx];
    }
    if (!isSolved(level, orientations)) continue;
    solutions += 1;
    const bits = popcount(mask);
    if (mask === 0) solvedAtStart = true;
    if (par === null || bits < par) { par = bits; bestMask = mask; optimal = 1; }
    else if (bits === par) optimal += 1;
  }

  const moves = [];
  for (let i = 0; i < n; i += 1) if ((bestMask >> i) & 1) moves.push(rot[i]);

  return {
    solvable: solutions > 0,
    par,
    moves,
    solutions,
    optimal,
    solvedAtStart,
    searched: total,
  };
}

/**
 * Wie viele der drehbaren Spiegel sind für *jede* Lösung irrelevant?
 *
 * Solche Spiegel sind reine Deko: Man kann sie beliebig stellen, das Level ist
 * trotzdem lösbar. Ein bisschen davon ist gut (Ablenkung), zu viel heißt, dass
 * das Level kleiner ist, als es aussieht.
 */
export function irrelevantMirrors(level) {
  const rot = level.rotatable;
  const base = startOrientations(level);
  const idle = [];
  for (const idx of rot) {
    // Ein Spiegel ist wirkungslos, wenn das Drehen in *keiner* erreichbaren
    // Stellung etwas am Ergebnis ändert. Näherung: Wir prüfen ihn gegen alle
    // Stellungen der übrigen Spiegel.
    const others = rot.filter((i) => i !== idx);
    if (others.length > MAX_ROTATABLE) return idle;
    let matters = false;
    const orientations = base.slice();
    for (let mask = 0; mask < 2 ** others.length && !matters; mask += 1) {
      for (let i = 0; i < others.length; i += 1) {
        const o = others[i];
        orientations[o] = (mask >> i) & 1 ? flipOrient(base[o]) : base[o];
      }
      orientations[idx] = base[idx];
      const a = isSolved(level, orientations);
      orientations[idx] = flipOrient(base[idx]);
      const b = isSolved(level, orientations);
      if (a !== b) matters = true;
    }
    if (!matters) idle.push(idx);
  }
  return idle;
}
