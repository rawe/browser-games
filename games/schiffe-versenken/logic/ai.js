// Der Computergegner. Er sieht nur, was ein Mensch auch sähe: das eigene
// Schussbild auf dem fremden Meer und welche Schiffe schon versenkt sind
// (siehe `publicView`).

import { SIZE, CELLS, at, xOf, yOf, orthogonal, surrounding } from './rules.js';
import { UNKNOWN, HIT } from './board.js';
import { shipCells } from './fleet.js';
import { defaultRng } from './rng.js';

export const LEVELS = [
  { id: 'leicht', name: 'Leicht', note: 'Schießt meist aufs Geratewohl – gut für den Einstieg.' },
  { id: 'mittel', name: 'Mittel', note: 'Bleibt an Treffern dran und sucht im Schachbrettmuster.' },
  { id: 'schwer', name: 'Schwer', note: 'Rechnet für jedes Feld aus, wie wahrscheinlich dort ein Schiff liegt.' },
];

/** Treffer, deren Schiff noch schwimmt – dort wird weitergesucht. */
function openHits(view) {
  const sunkCells = new Set(view.sunk.flatMap((ship) => shipCells(ship)));
  const hits = [];
  for (let i = 0; i < CELLS; i += 1) {
    if (view.shots[i] === HIT && !sunkCells.has(i)) hits.push(i);
  }
  return hits;
}

const unknownCells = (view) => {
  const out = [];
  for (let i = 0; i < CELLS; i += 1) if (view.shots[i] === UNKNOWN) out.push(i);
  return out;
};

/**
 * @param {{shots: number[], sunk: object[], remaining: number[]}} view
 * @param {{level: string, spacing: boolean}} options
 * @returns {number} Feldindex
 */
export function chooseShot(view, { level = 'mittel', spacing = true } = {}, rng = defaultRng) {
  const free = unknownCells(view);
  if (!free.length) throw new Error('Kein freies Feld mehr');
  if (level === 'leicht') return easy(view, free, rng);
  if (level === 'schwer') return hard(view, free, spacing, rng);
  return medium(view, free, spacing, rng);
}

function easy(view, free, rng) {
  const hits = openHits(view);
  if (hits.length && rng() < 0.55) {
    const around = hits.flatMap(orthogonal).filter((n) => view.shots[n] === UNKNOWN);
    if (around.length) return rng.pick(around);
  }
  return rng.pick(free);
}

function medium(view, free, spacing, rng) {
  const target = followHits(view, rng);
  if (target >= 0) return target;

  // Schachbrettmuster: Jedes Schiff ist mindestens zwei Felder lang und
  // muss deshalb ein Feld jeder Farbe bedecken.
  const smallest = Math.min(...view.remaining);
  let pool = free.filter((i) => (xOf(i) + yOf(i)) % smallest === 0);
  if (spacing) pool = pool.filter((i) => !touchesSunk(view, i));
  return rng.pick(pool.length ? pool : free);
}

const touchesSunk = (view, idx) => surrounding(idx).some((n) => view.shots[n] === HIT);

/**
 * Am angeschossenen Schiff dranbleiben: Liegen zwei Treffer in einer Linie,
 * an deren Enden weiter; sonst rundherum probieren.
 */
function followHits(view, rng) {
  const hits = openHits(view);
  if (!hits.length) return -1;
  const set = new Set(hits);

  for (const h of hits) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const next = at(xOf(h) + dx, yOf(h) + dy);
      if (!set.has(next)) continue;
      // Linie in beide Richtungen bis zum ersten Nicht-Treffer verfolgen.
      const ends = [];
      for (const sign of [-1, 1]) {
        let x = xOf(h);
        let y = yOf(h);
        while (set.has(at(x, y))) { x += dx * sign; y += dy * sign; }
        const end = at(x, y);
        if (end >= 0 && view.shots[end] === UNKNOWN) ends.push(end);
      }
      if (ends.length) return rng.pick(ends);
    }
  }
  const around = hits.flatMap(orthogonal).filter((n) => view.shots[n] === UNKNOWN);
  return around.length ? rng.pick(around) : -1;
}

/**
 * Wahrscheinlichkeitsdichte: Für jedes noch schwimmende Schiff jede Lage
 * zählen, die zum bisherigen Schussbild passt. Lagen durch offene Treffer
 * zählen vielfach – dort liegt sicher ein Schiff.
 */
export function density(view, spacing) {
  const heat = new Float64Array(CELLS);
  const hits = openHits(view);
  const hitSet = new Set(hits);
  const sunkCells = new Set(view.sunk.flatMap((ship) => shipCells(ship)));
  const blocked = (i) => !(view.shots[i] === UNKNOWN || hitSet.has(i));

  for (const length of view.remaining) {
    for (const dir of ['h', 'v']) {
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const cells = shipCells({ x, y, dir, length });
          if (!cells || cells.some(blocked)) continue;
          if (spacing && !respectsSpacing(cells, hits, sunkCells)) continue;
          const covered = cells.filter((c) => hitSet.has(c)).length;
          if (hits.length && !covered) {
            // Solange ein Treffer offen ist, zählt nur, was ihn erklärt.
            continue;
          }
          const weight = covered ? 1 + covered * 12 : 1;
          for (const c of cells) if (!hitSet.has(c)) heat[c] += weight;
        }
      }
    }
  }
  return heat;
}

/**
 * Mit Abstandsregel darf eine Lage keinen offenen Treffer berühren, den sie
 * nicht selbst enthält – sonst lägen zwei Schiffe aneinander.
 */
function respectsSpacing(cells, hits, sunkCells) {
  const own = new Set(cells);
  for (const c of cells) {
    for (const n of surrounding(c)) {
      if (sunkCells.has(n)) return false;
    }
  }
  for (const h of hits) {
    if (own.has(h)) continue;
    if (surrounding(h).some((n) => own.has(n))) return false;
  }
  return true;
}

function hard(view, free, spacing, rng) {
  const heat = density(view, spacing);
  let best = -1;
  let ties = [];
  for (const i of free) {
    if (heat[i] > best) { best = heat[i]; ties = [i]; } else if (heat[i] === best) ties.push(i);
  }
  // Findet die Dichte nichts (kann bei offenen Treffern über mehrere Schiffe
  // passieren), hilft die einfache Verfolgung weiter.
  if (best <= 0) {
    const target = followHits(view, rng);
    return target >= 0 ? target : rng.pick(free);
  }
  return rng.pick(ties);
}
