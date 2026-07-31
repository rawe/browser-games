// Vollständiger Löser für Lumenweber-Level.
//
// Ein Level ist gelöst, wenn alle Ziele leuchten. Änderbar sind ausschließlich
// die Regler: ein Spiegel mit zwei Zuständen, eine Fassung mit dreien
// (leer → / → \ → leer). Der Suchraum ist damit das Produkt aller
// Zustandszahlen – eine Zahl in gemischter Basis, die sich erschöpfend
// durchzählen lässt.
//
// Entscheidend ist, dass die Regler **voneinander unabhängig** sind: Jeder
// zykliert für sich, also ist die Reihenfolge der Züge egal und die
// Mindestzahl an Zügen schlicht die Summe der zyklischen Abstände
// (`configCost` in `level.js`). Es braucht deshalb keine Pfadsuche, sondern nur
// eine Aufzählung – und das gilt genauso, wenn später Bauteile mit vier oder
// fünf Zuständen dazukommen.

import { startConfig, configCost, configAllowed, placedPrisms } from '../level.js';
import { isSolved } from '../beam.js';

/** Obergrenze, ab der die vollständige Suche zu teuer wird. */
export const MAX_STATES = 1 << 22;

/** Obergrenze für die Deko-Analyse – sie kostet noch einmal das n-Fache. */
export const MAX_IDLE_STATES = 1 << 18;

/** Größe des Suchraums: Produkt der Zustandszahlen aller Regler. */
export const searchSpace = (level) => level.controls.reduce((n, c) => n * c.states.length, 1);

/** Zählt eine Stellung in gemischter Basis um eins hoch. `false` am Ende. */
function advance(config, radix) {
  for (let i = 0; i < config.length; i += 1) {
    config[i] += 1;
    if (config[i] < radix[i]) return true;
    config[i] = 0;
  }
  return false;
}

/**
 * Durchsucht alle Reglerstellungen.
 *
 * @returns {{
 *   solvable: boolean,
 *   par: number|null,          Mindestzahl an Zügen
 *   config: number[]|null,     die dafür nötige Reglerstellung
 *   moves: number[],           Regler-Indizes in spielbarer Reihenfolge
 *   solutions: number,         Zahl aller Lösungsstellungen
 *   optimal: number,           Zahl der Lösungen mit genau `par` Zügen
 *   solvedAtStart: boolean,    Level ist ohne Zutun schon gelöst
 *   searched: number,
 * }}
 */
export function solveLevel(level) {
  return solveFrom(level, startConfig(level));
}

/**
 * Dasselbe, aber von einer beliebigen Stellung aus – das ist die Grundlage der
 * Tipp-Funktion im Spiel: Sie sagt, welcher Regler von *hier* aus als Nächstes
 * dran ist, nicht welcher vom Levelstart aus.
 */
export function solveFrom(level, base) {
  const total = searchSpace(level);
  if (total > MAX_STATES) {
    throw new Error(`Level ${level.id}: Suchraum ${total} – über der Grenze von ${MAX_STATES}`);
  }
  const radix = level.controls.map((c) => c.states.length);
  const config = new Array(radix.length).fill(0);

  let par = null;
  let best = null;
  let solutions = 0;
  let optimal = 0;
  let solvedAtStart = false;
  let searched = 0;

  do {
    searched += 1;
    if (!configAllowed(level, config)) continue;
    if (!isSolved(level, config)) continue;
    solutions += 1;
    const cost = configCost(level, base, config);
    if (cost === 0) solvedAtStart = true;
    if (par === null || cost < par) { par = cost; best = config.slice(); optimal = 1; }
    else if (cost === par) optimal += 1;
  } while (advance(config, radix));

  return {
    solvable: solutions > 0,
    par,
    config: best,
    moves: best ? movesBetween(level, base, best) : [],
    solutions,
    optimal,
    solvedAtStart,
    searched,
  };
}

/**
 * Zugfolge von einer Stellung zur anderen, in einer Reihenfolge, die den
 * Prismenvorrat nie überzieht.
 *
 * Erst leeren, dann umsetzen, dann füllen: So ist die Zahl der belegten
 * Fassungen nie größer als am Anfang oder am Ende – und beide liegen im Vorrat.
 * Die Gesamtzahl der Züge hängt von der Reihenfolge nicht ab.
 */
export function movesBetween(level, from, to) {
  const phase = (i) => {
    const device = level.controls[i];
    if (device.kind !== 'socket') return 3;
    const a = device.states[from[i]];
    const b = device.states[to[i]];
    if (b === null) return 0;      // gibt ein Prisma frei
    if (a !== null) return 1;      // bleibt belegt, dreht nur
    return 2;                      // nimmt ein Prisma auf
  };

  const order = level.controls.map((_, i) => i).sort((a, b) => phase(a) - phase(b));
  const moves = [];
  for (const i of order) {
    const k = level.controls[i].states.length;
    const steps = (to[i] - from[i] + k) % k;
    for (let s = 0; s < steps; s += 1) moves.push(i);
  }
  return moves;
}

/**
 * Welche Regler sind für *jede* Lösung irrelevant?
 *
 * Solche Bauteile sind reine Ablenkung: Man kann sie beliebig stellen, das
 * Level bleibt lösbar. Ein bisschen davon ist gut, zu viel heißt, dass das
 * Level kleiner ist, als es aussieht.
 */
export function irrelevantControls(level) {
  const total = searchSpace(level);
  if (total > MAX_IDLE_STATES) {
    throw new Error(`Level ${level.id}: Suchraum ${total} zu groß für die Deko-Analyse (Grenze ${MAX_IDLE_STATES})`);
  }
  const radix = level.controls.map((c) => c.states.length);
  const idle = [];

  for (let idx = 0; idx < level.controls.length; idx += 1) {
    const k = radix[idx];
    const config = new Array(radix.length).fill(0);
    let matters = false;
    do {
      if (config[idx] !== 0) continue;   // jede Stellung der übrigen genau einmal
      let seen = null;
      for (let s = 0; s < k && !matters; s += 1) {
        config[idx] = s;
        if (!configAllowed(level, config)) continue;
        const solved = isSolved(level, config);
        if (seen === null) seen = solved;
        else if (seen !== solved) matters = true;
      }
      config[idx] = 0;
    } while (!matters && advance(config, radix));
    if (!matters) idle.push(idx);
  }
  return idle;
}

/** Wie viele Prismen steckt die Lösung tatsächlich in Fassungen? */
export const prismsUsed = (level, config) => (config ? placedPrisms(level, config) : 0);
