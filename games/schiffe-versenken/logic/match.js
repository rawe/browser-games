// Eine Partie: zwei Meere, wer dran ist, wer gewonnen hat.
//
// Spieler 0 beginnt die Aufstellung und den Beschuss. Im Modus 'ki' ist
// Spieler 1 der Computer.

import { DEFAULT_RULES } from './rules.js';
import { createBoard, fire, allSunk, canFire } from './board.js';

/**
 * @param {{mode: 'duo'|'ki', names: string[], level?: string, rules?: object}} options
 */
export function createMatch({ mode, names, level = 'mittel', rules = DEFAULT_RULES }) {
  return {
    version: 1,
    mode,
    names: [...names],
    level,
    rules: { ...DEFAULT_RULES, ...rules },
    phase: 'setup',
    /** Wer gerade aufstellt bzw. schießt. */
    turn: 0,
    boards: [null, null],
    winner: -1,
    /** Jeder Schuss in Reihenfolge – für Statistik und die Rückschau. */
    log: [],
  };
}

/** Flotte eines Spielers übernehmen. Sind beide da, beginnt das Gefecht. */
export function commitFleet(match, player, ships) {
  match.boards[player] = createBoard(ships);
  if (match.boards[0] && match.boards[1]) {
    match.phase = 'battle';
    match.turn = 0;
  } else {
    match.turn = player === 0 ? 1 : 0;
  }
}

export const opponentOf = (player) => 1 - player;

/** Das Meer, auf das der Spieler am Zug schießt. */
export const targetBoard = (match) => match.boards[opponentOf(match.turn)];

/**
 * Der Spieler am Zug schießt auf `idx`.
 *
 * @returns {{result, ship, water, shooter, idx, again: boolean, over: boolean}|null}
 *          `again`: derselbe Spieler darf weiter. `null` bei ungültigem Schuss.
 */
export function shoot(match, idx) {
  if (match.phase !== 'battle') return null;
  const board = targetBoard(match);
  if (!canFire(board, idx)) return null;

  const shooter = match.turn;
  const outcome = fire(board, idx, match.rules.spacing);
  match.log.push({ p: shooter, i: idx, r: outcome.result });

  const over = allSunk(board);
  let again = false;
  if (over) {
    match.phase = 'over';
    match.winner = shooter;
  } else if (outcome.result !== 'miss' && match.rules.bonusShot) {
    again = true;
  } else {
    match.turn = opponentOf(shooter);
  }
  return { ...outcome, shooter, idx, again, over };
}

/** Schüsse, Treffer und Quote eines Spielers. */
export function stats(match, player) {
  const own = match.log.filter((entry) => entry.p === player);
  const hits = own.filter((entry) => entry.r !== 'miss').length;
  return {
    shots: own.length,
    hits,
    sunk: own.filter((entry) => entry.r === 'sunk').length,
    rate: own.length ? Math.round((hits / own.length) * 100) : 0,
  };
}

/**
 * Die Schüsse des Gegners seit dem letzten eigenen Schuss – das, was man nach
 * der Übergabe auf dem eigenen Meer nachgespielt bekommt.
 */
export function incomingSinceLastTurn(match, player) {
  const out = [];
  for (let i = match.log.length - 1; i >= 0; i -= 1) {
    const entry = match.log[i];
    if (entry.p === player) break;
    out.unshift(entry);
  }
  return out;
}

// JSON genügt: Alles in der Partie sind schlichte Daten.
export const serialize = (match) => JSON.parse(JSON.stringify(match));

export function restore(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.boards)) return null;
  return data;
}
