// Schiffe setzen, prüfen und zufällig verteilen.
//
// Ein Schiff ist `{ id, type, name, length, x, y, dir }` mit `dir` 'h' (nach
// rechts) oder 'v' (nach unten). `x`/`y` ist das Bug-Feld oben links.

import { SIZE, at, surrounding, fleetPieces } from './rules.js';
import { defaultRng } from './rng.js';

/** Feldindizes, die ein Schiff belegt – oder `null`, wenn es übers Brett ragt. */
export function shipCells(ship) {
  const cells = [];
  for (let i = 0; i < ship.length; i += 1) {
    const idx = ship.dir === 'h' ? at(ship.x + i, ship.y) : at(ship.x, ship.y + i);
    if (idx < 0) return null;
    cells.push(idx);
  }
  return cells;
}

/** Belegungskarte: Feld → Schiffskennung. */
export function occupancy(ships, ignoreId = null) {
  const map = new Map();
  for (const ship of ships) {
    if (ship.id === ignoreId || ship.x == null) continue;
    for (const idx of shipCells(ship) ?? []) map.set(idx, ship.id);
  }
  return map;
}

/**
 * Passt das Schiff an diese Stelle? Mit `spacing` muss es auch über Eck
 * einen Feldabstand zu allen anderen halten.
 */
export function canPlace(ships, ship, spacing, ignoreId = ship.id) {
  const cells = shipCells(ship);
  if (!cells) return false;
  const taken = occupancy(ships, ignoreId);
  for (const idx of cells) {
    if (taken.has(idx)) return false;
    if (spacing && surrounding(idx).some((n) => taken.has(n))) return false;
  }
  return true;
}

/**
 * Zufällige Aufstellung. Große Schiffe zuerst, weil sie am schwersten Platz
 * finden; misslingt ein Durchlauf, beginnt der nächste von vorn.
 */
export function randomFleet(fleetId, spacing, rng = defaultRng) {
  const pieces = fleetPieces(fleetId).sort((a, b) => b.length - a.length);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const placed = [];
    let ok = true;
    for (const piece of pieces) {
      const options = [];
      for (const dir of ['h', 'v']) {
        for (let y = 0; y < SIZE; y += 1) {
          for (let x = 0; x < SIZE; x += 1) {
            const ship = { ...piece, x, y, dir };
            if (canPlace(placed, ship, spacing)) options.push(ship);
          }
        }
      }
      if (!options.length) { ok = false; break; }
      placed.push(rng.pick(options));
    }
    if (ok) return restoreOrder(placed, fleetId);
  }
  throw new Error('Keine gültige Aufstellung gefunden');
}

/** In die Reihenfolge der Flottenliste zurücksortieren (für Anzeige und Dock). */
function restoreOrder(ships, fleetId) {
  const order = fleetPieces(fleetId).map((p) => p.id);
  return [...ships].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Sind alle Schiffe der Flotte gültig gesetzt? */
export function fleetComplete(ships, fleetId, spacing) {
  const pieces = fleetPieces(fleetId);
  if (ships.length !== pieces.length) return false;
  return ships.every((ship) => ship.x != null && canPlace(ships, ship, spacing));
}

/**
 * Drehen um das Feld, an dem das Schiff angefasst wurde. Passt die gedrehte
 * Lage nicht, wird sie ein Stück verschoben gesucht – sonst bleibt es, wie
 * es war.
 */
export function rotated(ships, ship, spacing, pivot = 0) {
  const dir = ship.dir === 'h' ? 'v' : 'h';
  const px = ship.dir === 'h' ? ship.x + pivot : ship.x;
  const py = ship.dir === 'h' ? ship.y : ship.y + pivot;
  const tries = [];
  for (let shift = 0; shift < ship.length; shift += 1) {
    for (const s of shift ? [pivot - shift, pivot + shift] : [pivot]) {
      if (s < 0 || s >= ship.length) continue;
      tries.push(dir === 'h' ? { x: px - s, y: py } : { x: px, y: py - s });
    }
  }
  // Erst die naheliegenden Lagen, dann auch über den Rand hinweg geklemmt.
  for (const t of tries) {
    const candidate = { ...ship, ...t, dir };
    if (canPlace(ships, candidate, spacing)) return candidate;
  }
  for (const t of tries) {
    const candidate = {
      ...ship, dir,
      x: Math.max(0, Math.min(SIZE - (dir === 'h' ? ship.length : 1), t.x)),
      y: Math.max(0, Math.min(SIZE - (dir === 'v' ? ship.length : 1), t.y)),
    };
    if (canPlace(ships, candidate, spacing)) return candidate;
  }
  return null;
}
