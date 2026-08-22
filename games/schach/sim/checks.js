// Prüfläufe für die Schach-Engine: `npm run check:schach`.
//
// Die Zuggenerierung wird gegen veröffentlichte Perft-Zahlen gerechnet, alles
// Übrige – Notation, Partieende, Materialbilanz, Bewertung, Suche – gegen
// Stellungen mit eindeutig richtiger Antwort.

import assert from 'node:assert/strict';
import { parseFen, WHITE, BLACK, QUEEN, squareName, squareFromName } from '../engine/board.js';
import { legalMoves, sameMove } from '../engine/moves.js';
import { gameStatus, insufficientMaterial } from '../engine/rules.js';
import { toSan } from '../engine/notation.js';
import { createGame, play, takeBack, movesBetween, material, serialize, restore, isOver, outcome } from '../game.js';
import { evaluate } from '../ai/evaluate.js';
import { search, mateDistance } from '../ai/search.js';
import { runPerft } from './perft.js';

/** Züge in langer Notation nachspielen – kürzt die Testfälle erheblich. */
function playAll(game, uciList) {
  for (const uci of uciList) {
    const from = squareFromName(uci.slice(0, 2));
    const to = squareFromName(uci.slice(2, 4));
    const options = movesBetween(game, from, to);
    const mv = uci.length > 4 ? options.find((m) => 'nbrq'[m.promo - 2] === uci[4]) : options[0];
    assert.ok(mv, `Zug ${uci} ist in dieser Stellung nicht legal`);
    assert.ok(play(game, mv), `Zug ${uci} ließ sich nicht ausführen`);
  }
  return game;
}

// ── Zuggenerierung ──────────────────────────────────────────────────────────
const perftFailures = runPerft();
assert.deepEqual(perftFailures, [], `Perft weicht ab:\n${perftFailures.join('\n')}`);

// ── Notation ────────────────────────────────────────────────────────────────
const sanOf = (fen, uci) => {
  const game = createGame(fen);
  const from = squareFromName(uci.slice(0, 2));
  const to = squareFromName(uci.slice(2, 4));
  const options = movesBetween(game, from, to);
  const mv = uci.length > 4 ? options.find((m) => 'nbrq'[m.promo - 2] === uci[4]) : options[0];
  return toSan(game.state, mv, game.status.moves);
};

assert.equal(sanOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3'), 'Sf3');
assert.equal(sanOf('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', 'f3f7'), 'Dxf7#',
  'Schäfermatt endet mit Doppelkreuz');
assert.equal(sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), '0-0');
assert.equal(sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), '0-0-0');
assert.equal(sanOf('8/PPP4k/8/8/8/8/4Kppp/8 w - - 0 1', 'a7a8q'), 'a8=D', 'Umwandlung wird angehängt');
assert.equal(sanOf('8/PPP4k/8/8/8/8/4Kppp/8 w - - 0 1', 'a7a8n'), 'a8=S', 'Unterverwandlung ebenso');
assert.equal(sanOf('5k2/8/8/3N1N2/8/8/8/4K3 w - - 0 1', 'd5e3'), 'Sde3',
  'Zwei Springer auf dasselbe Feld: die Linie unterscheidet');
assert.equal(sanOf('5k2/8/8/3N4/8/8/8/3N1K2 w - - 0 1', 'd5c3'), 'S5c3',
  'Gleiche Linie: dann unterscheidet die Reihe');
assert.equal(sanOf('4k3/8/8/8/8/8/8/Q5QK w - - 0 1', 'a1d1'), 'Dad1', 'Auch Damen werden unterschieden');
assert.equal(sanOf('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 'e5f6'), 'exf6',
  'En passant wird wie ein Schlag notiert');

// ── Partieende ──────────────────────────────────────────────────────────────
const mate = playAll(createGame(), ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
assert.ok(isOver(mate), 'Schäfermatt beendet die Partie');
assert.equal(outcome(mate).reason, 'schachmatt');
assert.equal(outcome(mate).winner, WHITE);
assert.equal(mate.history.at(-1).san, 'Dxf7#');

const stale = createGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
assert.equal(stale.status.reason, 'patt', 'Patt wird als solches erkannt');
assert.equal(stale.status.winner, null);

assert.ok(insufficientMaterial(parseFen('8/8/4k3/8/8/4K3/8/8 w - - 0 1')), 'König gegen König');
assert.ok(insufficientMaterial(parseFen('8/8/4k3/8/8/4KB2/8/8 w - - 0 1')), 'König und Läufer');
assert.ok(insufficientMaterial(parseFen('2b5/8/4k3/8/8/4KB2/8/8 w - - 0 1')), 'Läufer gleicher Feldfarbe');
assert.ok(!insufficientMaterial(parseFen('8/2b5/4k3/8/8/4KB2/8/8 w - - 0 1')), 'Läufer verschiedener Feldfarbe nicht');
assert.ok(!insufficientMaterial(parseFen('8/8/4k3/8/8/4KBB1/8/8 w - - 0 1')), 'Läuferpaar nicht');
assert.equal(createGame('4k3/8/4K3/8/8/8/8/R7 w - - 99 60').status.reason, '',
  '99 Halbzüge sind noch keine 50-Züge-Regel');
assert.equal(createGame('4k3/8/4K3/8/8/8/8/R7 w - - 100 60').status.reason, '50-züge');

// Dreifache Wiederholung: Springer hin und her, bis die Stellung dreimal stand.
const repeat = playAll(createGame(), ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
assert.equal(repeat.status.reason, 'wiederholung', 'Dreifache Wiederholung ist Remis');

// ── Rücknahme und Wiederherstellung ─────────────────────────────────────────
const back = playAll(createGame(), ['e2e4', 'e7e5', 'g1f3']);
assert.equal(takeBack(back, 2), 2);
assert.equal(back.history.length, 1);
assert.equal(back.state.turn, BLACK, 'Nach zwei Halbzügen zurück ist Schwarz wieder am Zug');
assert.ok(movesBetween(back, squareFromName('e7'), squareFromName('e5')).length, 'e5 ist wieder möglich');

const rescued = restore(serialize(playAll(createGame(), ['e2e4', 'c7c5', 'g1f3', 'd7d6'])));
assert.equal(rescued.history.map((entry) => entry.san).join(' '), 'e4 c5 Sf3 d6');
assert.equal(rescued.history.length, 4, 'Eine gespeicherte Partie kommt vollständig zurück');

// ── Materialbilanz ──────────────────────────────────────────────────────────
const traded = playAll(createGame(), ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5e5', 'f1e2', 'e5g5']);
const bilanz = material(traded);
assert.equal(bilanz.lead, 0, 'Bauer gegen Bauer ist ausgeglichen');
assert.equal(bilanz.captured[WHITE].length, 1, 'Weiß hat genau einen Bauern geschlagen');
assert.equal(bilanz.captured[BLACK].length, 1);

const promoted = createGame('Q6k/8/6K1/8/8/8/8/8 w - - 0 1');
assert.ok(material(promoted).captured[BLACK].every((p) => p.type !== QUEEN),
  'Eine zusätzliche Dame darf nicht als geschlagen gezählt werden');

// ── Bewertung ───────────────────────────────────────────────────────────────
assert.ok(evaluate(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')) === 0,
  'Die Grundstellung ist ausgeglichen');
assert.ok(evaluate(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w Kkq - 0 1')) < -400,
  'Ein Turm weniger schlägt deutlich zu Buche');
assert.ok(evaluate(parseFen('4k3/8/8/3PP3/8/8/8/4K3 w - - 0 1'))
  > evaluate(parseFen('4k3/8/8/8/8/8/3PP3/4K3 w - - 0 1')),
  'Vorgerückte Bauern stehen besser als solche auf der Grundreihe');

// ── Suche ───────────────────────────────────────────────────────────────────
const mateIn1 = search(parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), { depth: 3, random: 0 });
assert.equal(squareName(mateIn1.move.from), 'a1');
assert.equal(squareName(mateIn1.move.to), 'a8', 'Der Turm setzt auf der achten Reihe matt');
assert.ok(mateIn1.score > 9000, 'Ein Matt wird als gewonnen bewertet');

const hangingQueen = search(parseFen('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1'), { depth: 4, random: 0 });
assert.equal(squareName(hangingQueen.move.to), 'd5', 'Eine ungedeckte Dame wird geschlagen');

const freeRook = search(parseFen('r6k/8/8/8/8/8/8/R6K w - - 0 1'), { depth: 4, random: 0 });
assert.equal(squareName(freeRook.move.to), 'a8', 'Ein ungedeckter Turm auf offener Linie wird geschlagen');
assert.ok(freeRook.score > 400, 'Und der Gewinn eines Turms wird auch so bewertet');

// Ohne Ruhesuche stellt eine Engine hier die Dame ein: Dxd5 sieht auf geradem
// Weg nach Bauerngewinn aus – der Rückschlag liegt einen Halbzug dahinter.
const noBlunder = search(parseFen('4k3/8/8/3p4/8/8/3Q4/4K3 w - - 0 1'), { depth: 2, random: 0 });
assert.ok(!(squareName(noBlunder.move.to) === 'd5' && noBlunder.score < 0),
  'Die Ruhesuche verhindert den Griff nach dem gedeckten Bauern');

const mateIn2 = search(parseFen('r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1'), { depth: 5, random: 0 });
assert.equal(squareName(mateIn2.move.to), 'a6', 'Der Turmschwenk nach a6 leitet das Matt ein');
assert.ok(mateIn2.score > 9000, 'Ein erzwungenes Matt wird als solches bewertet');
// Die iterative Vertiefung bricht beim ersten gefundenen Matt ab – die
// Schachverlängerung kann dabei einen Halbzug länger geraten als das kürzeste.
assert.ok(mateDistance(mateIn2.score) <= 3, 'Und die Mattdistanz wird mitgeliefert');

// Die Suche darf nie einen illegalen Zug vorschlagen.
for (const fen of [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 0 3',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
]) {
  const state = parseFen(fen);
  const found = search(state, { depth: 3, random: 0 });
  assert.ok(legalMoves(state).some((mv) => sameMove(mv, found.move)),
    `Die Suche schlug in "${fen}" einen illegalen Zug vor`);
}

// In einer beendeten Stellung gibt es nichts zu suchen – die Oberfläche muss
// sich darauf verlassen können, dass das kein Absturz ist.
assert.equal(search(parseFen('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4'),
  { depth: 3, random: 0 }).move, null, 'Im Matt liefert die Suche keinen Zug');

// Zeitgesteuert muss die Suche das Budget einhalten und trotzdem antworten.
const started = Date.now();
const timed = search(parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'),
  { depth: 30, timeMs: 300, random: 0 });
assert.ok(Date.now() - started < 2500, 'Die Zeitsteuerung bricht die Vertiefung ab');
assert.ok(timed.move, 'Auch abgebrochen liefert die Suche einen Zug');
assert.ok(timed.depth >= 3, 'In 300 ms ist mehr als eine Vollsuche der Tiefe zwei drin');

// Suche gegen Suche: der schärfste Test, weil jede Stellung darin von der
// Engine selbst erzeugt wurde und keine Testliste sie vorgesehen hat.
const selfPlay = createGame();
for (let ply = 0; ply < 80 && !isOver(selfPlay); ply += 1) {
  const best = search(selfPlay.state, { depth: 2, random: 0 });
  assert.ok(best.move, `Selbstspiel: keine Antwort in Halbzug ${ply + 1}`);
  assert.ok(play(selfPlay, best.move), `Selbstspiel: Zug ${ply + 1} war nicht legal`);
}
assert.ok(selfPlay.history.length > 20, 'Das Selbstspiel kam über die Eröffnung hinaus');
assert.ok(selfPlay.history.every((entry) => entry.san), 'Jeder Zug im Selbstspiel hat eine Notation');
assert.equal(restore(serialize(selfPlay)).history.length, selfPlay.history.length,
  'Auch eine lange Partie übersteht Speichern und Laden');

console.log('✓ Schach: Perft, Notation, Partieende, Materialbilanz, Bewertung und Suche geprüft');
