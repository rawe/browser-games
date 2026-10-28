// Prüfläufe für Schiffe versenken: `npm run check:schiffe`.
//
// Regeln, Aufstellung und Partieablauf gegen eindeutige Fälle; danach spielt
// jede Spielstärke des Computers viele Partien gegen zufällige Flotten. Die
// Zahl der nötigen Schüsse muss mit der Stufe deutlich sinken – sonst sind
// die Stufen nur Etiketten.

import assert from 'node:assert/strict';
import { SIZE, CELLS, cellName, fleetPieces, FLEETS } from '../logic/rules.js';
import { shipCells, canPlace, randomFleet, fleetComplete, rotated } from '../logic/fleet.js';
import { createBoard, fire, allSunk, publicView, MISS, HIT, WATER, UNKNOWN } from '../logic/board.js';
import { createMatch, commitFleet, shoot, stats, incomingSinceLastTurn, serialize, restore } from '../logic/match.js';
import { chooseShot, LEVELS } from '../logic/ai.js';
import { createRng } from '../logic/rng.js';

// ── Felder und Schiffe ──────────────────────────────────────────────────────
assert.equal(cellName(0), 'A1');
assert.equal(cellName(CELLS - 1), 'J10');
assert.equal(cellName(23), 'D3');

const cruiser = { id: 'k', type: 'kreuzer', length: 4, x: 7, y: 0, dir: 'h' };
assert.equal(shipCells(cruiser), null, 'Ragt über den Rand');
assert.deepEqual(shipCells({ ...cruiser, x: 6 }), [6, 7, 8, 9]);
assert.deepEqual(shipCells({ ...cruiser, x: 0, dir: 'v' }), [0, 10, 20, 30]);

const a = { id: 'a', length: 3, x: 0, y: 0, dir: 'h' };
const touching = { id: 'b', length: 2, x: 3, y: 1, dir: 'h' };
assert.equal(canPlace([a], touching, false), true, 'Ohne Abstandsregel darf es über Eck berühren');
assert.equal(canPlace([a], touching, true), false, 'Mit Abstandsregel nicht');
assert.equal(canPlace([a], { ...touching, x: 2, y: 0 }, false), false, 'Überlappen geht nie');

const turned = rotated([a], a, true, 1);
assert.deepEqual([turned.x, turned.y, turned.dir], [1, 0, 'v'], 'Dreht um das angefasste Feld');

// Zufällige Flotten: immer vollständig und regelkonform – für beide Flotten.
const rng = createRng(7);
for (const fleetId of Object.keys(FLEETS)) {
  for (const spacing of [true, false]) {
    for (let n = 0; n < 200; n += 1) {
      const ships = randomFleet(fleetId, spacing, rng);
      assert.ok(fleetComplete(ships, fleetId, spacing), `${fleetId}/${spacing} ungültig`);
      assert.equal(ships.length, fleetPieces(fleetId).length);
    }
  }
}

// ── Schüsse ─────────────────────────────────────────────────────────────────
{
  const board = createBoard([{ id: 's', type: 'schnellboot', length: 2, x: 4, y: 4, dir: 'h' }]);
  assert.equal(fire(board, 0, true).result, 'miss');
  assert.equal(board.shots[0], MISS);
  assert.equal(fire(board, 44, true).result, 'hit');
  const sunk = fire(board, 45, true);
  assert.equal(sunk.result, 'sunk');
  assert.equal(sunk.water.length, 10, 'Rund um ein Zweierschiff liegen zehn Felder');
  assert.equal(board.shots[33], WATER);
  assert.ok(allSunk(board));
  assert.throws(() => fire(board, 44, true), 'Doppelt schießen geht nicht');
  const view = publicView(board);
  assert.deepEqual(view.remaining, []);
  assert.equal(view.sunk.length, 1);
}

// ── Partieablauf ────────────────────────────────────────────────────────────
{
  const fleet0 = [{ id: 's', type: 'schnellboot', length: 2, x: 0, y: 0, dir: 'h' }];
  const fleet1 = [{ id: 's', type: 'schnellboot', length: 2, x: 0, y: 9, dir: 'h' }];
  const match = createMatch({ mode: 'duo', names: ['Papa', 'Sohn'], rules: { bonusShot: true } });
  commitFleet(match, 0, fleet0);
  assert.equal(match.phase, 'setup');
  assert.equal(match.turn, 1, 'Nach Spieler 1 stellt Spieler 2 auf');
  commitFleet(match, 1, fleet1);
  assert.equal(match.phase, 'battle');
  assert.equal(match.turn, 0);

  assert.equal(shoot(match, 50).again, false, 'Wasser: Wechsel');
  assert.equal(match.turn, 1);
  assert.equal(shoot(match, 50).shooter, 1, 'Jedes Meer hat seine eigenen Schüsse');
  assert.equal(shoot(match, 50), null, 'Doppelt auf dasselbe Feld geht nicht');
  shoot(match, 51);
  const hit = shoot(match, 0);
  assert.equal(hit.result, 'hit');
  assert.equal(hit.again, true, 'Treffer: nochmal');
  assert.equal(match.turn, 1);
  const win = shoot(match, 1);
  assert.equal(win.over, true);
  assert.equal(match.winner, 1);
  assert.equal(shoot(match, 2), null, 'Nach Spielende wird nicht mehr geschossen');
  assert.deepEqual(stats(match, 1), { shots: 3, hits: 2, sunk: 1, rate: 67 });
  assert.equal(incomingSinceLastTurn(match, 0).length, 2, 'Nur was seit dem eigenen letzten Schuss kam');

  const copy = restore(serialize(match));
  assert.deepEqual(copy, match, 'Speichern und Laden verlustfrei');
}
{
  const match = createMatch({ mode: 'duo', names: ['A', 'B'], rules: { bonusShot: false } });
  commitFleet(match, 0, [{ id: 's', type: 'schnellboot', length: 2, x: 0, y: 0, dir: 'h' }]);
  commitFleet(match, 1, [{ id: 's', type: 'schnellboot', length: 2, x: 0, y: 0, dir: 'h' }]);
  assert.equal(shoot(match, 0).again, false, 'Ohne Bonusregel wechselt es auch nach Treffer');
  assert.equal(match.turn, 1);
}

// ── Computergegner ──────────────────────────────────────────────────────────
function playOut(level, fleetId, spacing, seed) {
  const r = createRng(seed);
  const board = createBoard(randomFleet(fleetId, spacing, r));
  let shots = 0;
  while (!allSunk(board)) {
    const idx = chooseShot(publicView(board), { level, spacing }, r);
    assert.ok(board.shots[idx] === UNKNOWN, `${level} schießt auf ein bekanntes Feld`);
    fire(board, idx, spacing);
    shots += 1;
    assert.ok(shots <= CELLS, `${level} findet kein Ende`);
  }
  return shots;
}

const GAMES = 100;
const averages = {};
for (const { id } of LEVELS) {
  for (const fleetId of Object.keys(FLEETS)) {
    for (const spacing of [true, false]) {
      let total = 0;
      for (let g = 0; g < GAMES; g += 1) total += playOut(id, fleetId, spacing, 1000 + g);
      averages[`${id}/${fleetId}/${spacing ? 'abstand' : 'eng'}`] = total / GAMES;
    }
  }
}
for (const [key, value] of Object.entries(averages)) console.log(`  ${key.padEnd(28)} Ø ${value.toFixed(1)} Schüsse`);
for (const variant of ['klassisch/abstand', 'klassisch/eng', 'gross/abstand', 'gross/eng']) {
  const [e, m, h] = ['leicht', 'mittel', 'schwer'].map((lvl) => averages[`${lvl}/${variant}`]);
  assert.ok(e > m + 5, `${variant}: Leicht (${e}) muss klar schwächer sein als Mittel (${m})`);
  assert.ok(m > h + 3, `${variant}: Mittel (${m}) muss klar schwächer sein als Schwer (${h})`);
}

console.log(`✓ Schiffe versenken: Regeln, Aufstellung, Partie und Computergegner (${SIZE}×${SIZE})`);
