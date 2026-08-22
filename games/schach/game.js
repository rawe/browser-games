// Die Partie: Stellung, Zugliste, Stand. Vollständig DOM-frei.
//
// Alles, was die Oberfläche über eine laufende Partie wissen muss, steckt in
// diesem Objekt – und alles, was sie ändert, geht durch `play`, `takeBack` oder
// `resign`. Deshalb lässt sich eine Partie mit `serialize`/`restore` unverändert
// über einen Seitenneuladen retten.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, WHITE, BLACK,
  typeOf, colorOf, onBoard, initialState, parseFen, toFen, START_FEN,
} from './engine/board.js';
import { makeMove, sameMove } from './engine/moves.js';
import { gameStatus, positionKey } from './engine/rules.js';
import { toSan, toUci } from './engine/notation.js';

/** Figurenwerte für die Materialbilanz neben dem Brett. */
export const VALUES = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9 };

/** Vollständiger Figurensatz einer Farbe zu Beginn. */
const FULL_SET = { [PAWN]: 8, [KNIGHT]: 2, [BISHOP]: 2, [ROOK]: 2, [QUEEN]: 1 };

/**
 * Neue Partie.
 *
 * @param {string} fen Startstellung – im Normalfall die Grundstellung
 */
export function createGame(fen = START_FEN) {
  const state = fen === START_FEN ? initialState() : parseFen(fen);
  const game = {
    startFen: fen,
    state,
    /** Ausgeführte Züge, jeweils mit Notation und Stellung davor. */
    history: [],
    /** Stellungsschlüssel aller erreichten Stellungen – für die Wiederholung. */
    keys: [positionKey(state)],
    status: null,
    /** Vorzeitiges Ende: Aufgabe, Zeit, Remisangebot. */
    ended: null,
  };
  game.status = gameStatus(state, game.keys);
  return game;
}

/** Die in der aktuellen Stellung legalen Züge. */
export const currentMoves = (game) => game.status.moves;

/** Legale Züge, die auf `from` beginnen. */
export const movesFrom = (game, from) => currentMoves(game).filter((mv) => mv.from === from);

/**
 * Passt ein Zug von `from` nach `to`? Liefert bei einer Umwandlung alle vier
 * Möglichkeiten, damit die Oberfläche fragen kann.
 */
export const movesBetween = (game, from, to) =>
  currentMoves(game).filter((mv) => mv.from === from && mv.to === to);

/**
 * Zug ausführen.
 *
 * @param {object} game
 * @param {object} mv  ein Zug aus `currentMoves` – fremde Objekte werden über
 *                     Start, Ziel und Umwandlung nachgeschlagen und sonst
 *                     abgelehnt
 * @returns {object|null} der ausgeführte Zug samt `san`, oder `null`
 */
export function play(game, mv) {
  if (game.ended) return null;
  const legal = currentMoves(game).find((candidate) => sameMove(candidate, mv));
  if (!legal) return null;

  const san = toSan(game.state, legal, currentMoves(game));
  const before = toFen(game.state);
  makeMove(game.state, legal);

  const entry = { ...legal, san, uci: toUci(legal), before, no: game.history.length + 1 };
  game.history.push(entry);
  game.keys.push(positionKey(game.state));
  game.status = gameStatus(game.state, game.keys);
  return entry;
}

/**
 * Letzten Zug zurücknehmen.
 *
 * Zurückgesetzt wird über die gespeicherte Stellung *vor* dem Zug statt über
 * `unmakeMove`: Das trifft auch dann, wenn zwischendurch eine Partie geladen
 * wurde, und macht die Rücknahme unabhängig von den Rücknahmedaten der Suche.
 */
export function takeBack(game, plies = 1) {
  let undone = 0;
  for (let i = 0; i < plies && game.history.length; i += 1) {
    const entry = game.history.pop();
    game.state = parseFen(entry.before);
    game.keys.pop();
    undone += 1;
  }
  if (!undone) return 0;
  game.ended = null;
  game.status = gameStatus(game.state, game.keys);
  return undone;
}

/** Partie vorzeitig beenden: Aufgabe, Zeitüberschreitung, vereinbartes Remis. */
export function endGame(game, reason, winner = null) {
  game.ended = { reason, winner, result: winner === null ? '½-½' : winner === WHITE ? '1-0' : '0-1' };
  return game.ended;
}

/** Läuft die Partie noch? */
export const isOver = (game) => !!game.ended || game.status.over;

/** Ergebnis und Grund – aus regulärem Ende oder vorzeitigem Abbruch. */
export const outcome = (game) => game.ended ?? (game.status.over ? game.status : null);

/** Der zuletzt gespielte Zug – für Hervorhebung und Animation. */
export const lastMove = (game) => game.history[game.history.length - 1] ?? null;

/**
 * Geschlagene Figuren und Materialvorsprung.
 *
 * Gezählt wird aus dem Brett, nicht aus der Zugliste: Nach einer Umwandlung
 * stimmt nur diese Rechnung – der Bauer ist dann weder geschlagen noch da.
 *
 * @returns {{captured: object[][], lead: number}} `captured[WHITE]` sind die
 *          von Weiß geschlagenen schwarzen Figuren; `lead` ist Weiß' Vorsprung
 *          in Bauerneinheiten.
 */
export function material(game) {
  const alive = [{}, {}];
  let balance = 0;
  for (let sq = 0; sq < 128; sq += 1) {
    if (!onBoard(sq)) continue;
    const piece = game.state.board[sq];
    if (!piece) continue;
    const type = typeOf(piece);
    const color = colorOf(piece);
    alive[color][type] = (alive[color][type] ?? 0) + 1;
    balance += (VALUES[type] ?? 0) * (color === WHITE ? 1 : -1);
  }

  const captured = [[], []];
  for (const color of [WHITE, BLACK]) {
    for (const type of [QUEEN, ROOK, BISHOP, KNIGHT, PAWN]) {
      const missing = FULL_SET[type] - (alive[color][type] ?? 0);
      // Nach einer Umwandlung kann eine Seite mehr Damen haben als je gehabt –
      // dann ist nichts „geschlagen“, und die Zahl darf nicht negativ werden.
      for (let i = 0; i < missing; i += 1) captured[color ^ 1].push({ type, color });
    }
  }
  return { captured, lead: balance };
}

/** Partie als schlanker Datensatz – für localStorage. */
export const serialize = (game) => ({
  startFen: game.startFen,
  moves: game.history.map((entry) => entry.uci),
  ended: game.ended,
});

/**
 * Partie aus `serialize` wiederherstellen, indem alle Züge nachgespielt werden.
 * Ein unpassender Zug bricht ab und liefert die Partie bis dorthin – lieber
 * eine gekürzte Partie als ein Absturz beim Start.
 */
export function restore(data) {
  const game = createGame(data?.startFen ?? START_FEN);
  for (const uci of data?.moves ?? []) {
    const mv = currentMoves(game).find((candidate) => toUci(candidate) === uci);
    if (!mv || !play(game, mv)) break;
  }
  if (data?.ended && !game.status.over) game.ended = data.ended;
  return game;
}
