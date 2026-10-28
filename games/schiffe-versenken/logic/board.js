// Ein Meer mit Flotte und den Schüssen, die darauf gefallen sind.

import { CELLS, surrounding } from './rules.js';
import { shipCells } from './fleet.js';

/** Was auf einem Feld bekannt ist. */
export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;
/** Kein Schuss, aber sicher Wasser – direkt neben einem versenkten Schiff. */
export const WATER = 3;

export function createBoard(ships) {
  return {
    ships: ships.map((ship) => ({ ...ship, hits: 0, sunk: false })),
    shots: new Array(CELLS).fill(UNKNOWN),
  };
}

export const shipAt = (board, idx) =>
  board.ships.find((ship) => shipCells(ship).includes(idx)) ?? null;

/** Darf hier noch geschossen werden? Vermerktes Wasser bleibt frei wählbar. */
export const canFire = (board, idx) =>
  idx >= 0 && idx < CELLS && (board.shots[idx] === UNKNOWN || board.shots[idx] === WATER);

/**
 * Ein Schuss.
 *
 * @returns {{result: 'miss'|'hit'|'sunk', ship: object|null, water: number[]}}
 *          `water` sind die Felder, die durch ein Versenken als Wasser
 *          feststehen (nur mit Abstandsregel).
 */
export function fire(board, idx, spacing) {
  if (!canFire(board, idx)) throw new Error(`Feld ${idx} ist schon beschossen`);
  const ship = shipAt(board, idx);
  if (!ship) {
    board.shots[idx] = MISS;
    return { result: 'miss', ship: null, water: [] };
  }
  board.shots[idx] = HIT;
  ship.hits += 1;
  if (ship.hits < ship.length) return { result: 'hit', ship, water: [] };

  ship.sunk = true;
  const water = [];
  if (spacing) {
    for (const cell of shipCells(ship)) {
      for (const n of surrounding(cell)) {
        if (board.shots[n] === UNKNOWN) {
          board.shots[n] = WATER;
          water.push(n);
        }
      }
    }
  }
  return { result: 'sunk', ship, water };
}

export const allSunk = (board) => board.ships.every((ship) => ship.sunk);
export const shipsLeft = (board) => board.ships.filter((ship) => !ship.sunk).length;

/**
 * Was der Gegner von diesem Meer weiß: Schüsse und versenkte Schiffe. Die
 * Lage noch schwimmender Schiffe bleibt verborgen – auch für den Computer.
 */
export function publicView(board) {
  return {
    shots: [...board.shots],
    sunk: board.ships.filter((ship) => ship.sunk).map(({ id, type, length, x, y, dir }) => ({ id, type, length, x, y, dir })),
    remaining: board.ships.filter((ship) => !ship.sunk).map((ship) => ship.length),
  };
}
