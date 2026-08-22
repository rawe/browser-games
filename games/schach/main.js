// Schach – Verdrahtung von Partie, Darstellung und Bedienung.
//
// Die Regeln liegen vollständig in `engine/` und `game.js` und wissen nichts
// vom DOM; die Suche läuft in einem eigenen Faden (`ai/`). Hier kommt nur
// zusammen, was der Browser beisteuert: Brettfläche, Eingabe, Bildschirme,
// Uhren, Klang und der Speicher für die laufende Partie.

import { WHITE, BLACK, colorOf, toFen, parseFen, START_FEN } from './engine/board.js';
import { CASTLE_KING, CASTLE_QUEEN, EN_PASSANT } from './engine/moves.js';
import { toUci } from './engine/notation.js';
import { REASON_TEXT } from './engine/rules.js';
import {
  createGame, play, takeBack, movesFrom, movesBetween, currentMoves,
  isOver, outcome, lastMove, serialize, restore, endGame,
} from './game.js';
import { createRenderer } from './gfx/render.js';
import { createInput } from './input.js';
import { createOpponent, LEVELS, levelById } from './ai/opponent.js';
import { TIME_CONTROLS, controlById, createClock, startSide, stop, completeMove, flagged } from './clock.js';
import { createScreens, buildChoices } from './ui/screens.js';
import { createPanel, COLOR_NAME } from './ui/panel.js';
import { fillPromotion } from './ui/promotion.js';
import { paintTitleArt } from './ui/title-art.js';
import { loadSettings, saveSettings, loadGame, saveGame, clearGame } from './storage.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

const el = {
  boardArea: $('board-area'),
  canvas: $('board'),
  topBar: $('bar-top'), topName: $('top-name'), topCaptured: $('top-captured'),
  topLead: $('top-lead'), topState: $('top-state'), topClock: $('top-clock'),
  bottomBar: $('bar-bottom'), bottomName: $('bottom-name'), bottomCaptured: $('bottom-captured'),
  bottomLead: $('bottom-lead'), bottomState: $('bottom-state'), bottomClock: $('bottom-clock'),
  moveList: $('move-list'), moveListFull: $('move-list-full'),
  toast: $('toast'),
  title: $('screen-title'), setup: $('screen-setup'), menu: $('screen-menu'),
  moves: $('screen-moves'), rules: $('screen-rules'), promo: $('screen-promo'),
  over: $('screen-over'),
};

const renderer = createRenderer(el.canvas, { onFlip: () => refresh() });
const panel = createPanel(el);
const screens = createScreens({
  title: el.title, setup: el.setup, menu: el.menu, moves: el.moves,
  rules: el.rules, promo: el.promo, over: el.over, toast: el.toast,
}, 'title');
const opponent = createOpponent();

let settings = loadSettings();
audio.setEnabled(settings.sound);

/** Die laufende Partie und alles, was zu ihr gehört. */
let game = createGame();
let mode = 'hotseat';
let humanColor = WHITE;
let clock = createClock(controlById('aus'));
let started = false;

/** Bedienzustand: Auswahl, Ziehen, offene Umwandlung, rechnender Gegner. */
let selected = -1;
let targets = [];
let dragging = null;
let pendingPromo = null;
let thinking = -1;
/** Feld unter dem Tastaturfokus, `-1` solange nur gezeigt wird. */
let cursor = -1;
/**
 * Zähler für laufende Suchaufträge. Nach „Zurück“ oder „Neue Partie“ trifft
 * die Antwort des Workers auf eine andere Stellung – über diesen Zähler wird
 * sie verworfen, statt einen Zug aus einer toten Partie zu spielen.
 */
let generation = 0;

/** Was der Einrichtungsbildschirm gerade zusammenstellt. */
const draft = { mode: 'hotseat', level: settings.level, side: settings.side, time: settings.timeControl };

// ── Bildtakt ────────────────────────────────────────────────────────────────

let frameHandle = 0;

const requestFrame = () => {
  if (!frameHandle) frameHandle = requestAnimationFrame(tick);
};

function tick(now) {
  frameHandle = 0;
  const busy = renderer.frame(now);

  // Die Uhr läuft nur, wenn sie wirklich läuft: Steht sie – etwa weil ein
  // Bildschirm offen ist –, darf der Bildtakt einschlafen statt sechzigmal in
  // der Sekunde dieselbe Zahl zu schreiben.
  let ticking = false;
  if (started && clock.enabled && clock.running >= 0 && !isOver(game)) {
    panel.tick(clock, topColor());
    ticking = true;
    const loser = flagged(clock);
    if (loser >= 0) {
      endGame(game, 'zeit', loser === WHITE ? BLACK : WHITE);
      finishGame();
      ticking = false;
    }
  }

  if (busy || ticking || dragging) requestFrame();
}

// ── Brettfläche ─────────────────────────────────────────────────────────────

function measure() {
  const rect = el.boardArea.getBoundingClientRect();
  renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  requestFrame();
}

new ResizeObserver(measure).observe(el.boardArea);
window.addEventListener('orientationchange', () => setTimeout(measure, 120));

// ── Blickrichtung ───────────────────────────────────────────────────────────

/** Welche Farbe sitzt oben? Das hängt allein daran, wie das Brett steht. */
const topColor = () => (renderer.flipped ? WHITE : BLACK);

/**
 * Brettausrichtung nach einem Zug nachziehen.
 *
 * Am selben Gerät zu zweit ist das mehr als Komfort: Ohne Drehung spielt einer
 * der beiden die ganze Partie über Kopf.
 */
function orient(animate = true) {
  if (mode === 'computer') renderer.setFlipped(humanColor === BLACK, animate);
  else if (settings.autoFlip) renderer.setFlipped(game.state.turn === BLACK, animate);
}

// ── Anzeige ─────────────────────────────────────────────────────────────────

/** Namen der beiden Seiten – gegen den Computer mit Rolle dahinter. */
function playerNames() {
  if (mode !== 'computer') return { [WHITE]: 'Weiß', [BLACK]: 'Schwarz' };
  const level = levelById(settings.level);
  return {
    [humanColor]: `${COLOR_NAME[humanColor]} · Du`,
    [humanColor ^ 1]: `${COLOR_NAME[humanColor ^ 1]} · ${level.name}`,
  };
}

/** Alles nachziehen, was sich nach einem Zug geändert haben kann. */
function refresh() {
  const check = game.status.check && !isOver(game) ? game.state.kings[game.state.turn] : -1;
  const last = lastMove(game);

  renderer.setBoard(game.state.board);
  renderer.setHints({
    selected,
    targets: settings.hints ? targets : [],
    lastMove: last ? [last.from, last.to] : [],
    cursor,
    check,
  });

  panel.render({
    game,
    topColor: topColor(),
    names: playerNames(),
    clock,
    thinking,
    over: isOver(game),
  });

  $('btn-undo').disabled = !game.history.length || isOver(game) || thinking >= 0;
  $('btn-menu-draw').hidden = mode === 'computer';
  requestFrame();
}

// ── Züge ────────────────────────────────────────────────────────────────────

/** Zieht bei einer Rochade der Turm mit? Der Renderer braucht seinen Weg. */
function rookLeg(mv) {
  if (mv.flag === CASTLE_KING) return { from: mv.to + 1, to: mv.to - 1 };
  if (mv.flag === CASTLE_QUEEN) return { from: mv.to - 2, to: mv.to + 1 };
  return null;
}

function playSound(entry) {
  if (entry.flag === CASTLE_KING || entry.flag === CASTLE_QUEEN) audio.castle();
  else if (entry.promo) audio.promote();
  else if (entry.captured || entry.flag === EN_PASSANT) audio.capture();
  else audio.move();
  if (game.status.check && !isOver(game)) setTimeout(audio.check, 90);
}

/**
 * Einen Zug ausführen: Partie fortschreiben, Uhr weiterreichen, Bild bewegen,
 * Klang geben – und den Computer wecken, wenn er dran ist.
 */
function applyMove(mv) {
  const mover = game.state.turn;
  const entry = play(game, mv);
  if (!entry) return false;

  clearSelection();
  renderer.setBoard(game.state.board);
  renderer.animateMove({ from: entry.from, to: entry.to, rook: rookLeg(entry) }, () => {
    // Erst wenn die Figur steht, dreht sich das Brett – sonst kippt die Bühne
    // unter der laufenden Figur weg.
    orient();
    requestFrame();
  });

  playSound(entry);

  if (clock.enabled && !completeMove(clock, mover)) {
    endGame(game, 'zeit', mover === WHITE ? BLACK : WHITE);
  }

  persist();
  refresh();

  if (isOver(game)) finishGame();
  else if (mode === 'computer') queueComputer();
  return true;
}

/** Ein Feldpaar in einen Zug übersetzen – und bei Umwandlung nachfragen. */
function tryMove(from, to) {
  const options = movesBetween(game, from, to);
  if (!options.length) return false;
  if (options.length === 1) return applyMove(options[0]);

  // Mehr als eine Möglichkeit gibt es nur bei der Umwandlung.
  pendingPromo = { from, to, options };
  fillPromotion(el.promo.querySelector('#promo-row'), colorOf(options[0].piece), (type) => {
    const chosen = pendingPromo?.options.find((option) => option.promo === type);
    pendingPromo = null;
    screens.close();
    if (chosen) applyMove(chosen);
  });
  screens.show('promo');
  return true;
}

function clearSelection() {
  selected = -1;
  targets = [];
}

/** Darf diese Seite gerade ziehen? */
const humanToMove = () =>
  started && !isOver(game) && thinking < 0 && !pendingPromo
  && (mode !== 'computer' || game.state.turn === humanColor);

function select(sq) {
  selected = sq;
  targets = movesFrom(game, sq).map((mv) => ({
    sq: mv.to,
    capture: !!mv.captured || mv.flag === EN_PASSANT,
  }));
  // Bei einer Umwandlung stehen vier Züge auf demselben Zielfeld – als Punkt
  // reicht einer davon.
  targets = targets.filter((target, index) =>
    targets.findIndex((other) => other.sq === target.sq) === index);
  refresh();
}

// ── Eingabe ─────────────────────────────────────────────────────────────────

createInput(el.canvas, {
  squareAt: (x, y) => renderer.squareAt(x, y),

  canPickUp: (sq) => {
    if (!humanToMove()) return false;
    const piece = game.state.board[sq];
    return !!piece && colorOf(piece) === game.state.turn;
  },

  onTap(sq) {
    audio.unlock();
    if (!humanToMove()) return;

    if (selected >= 0) {
      if (sq === selected) { clearSelection(); refresh(); return; }
      if (tryMove(selected, sq)) return;
    }

    const piece = game.state.board[sq];
    if (piece && colorOf(piece) === game.state.turn) select(sq);
    else if (selected >= 0) { clearSelection(); refresh(); }
  },

  onDragStart(sq, x, y) {
    audio.unlock();
    select(sq);
    dragging = { from: sq, x, y };
    renderer.setDrag(dragging);
    requestFrame();
  },

  onDragMove(x, y) {
    if (!dragging) return;
    dragging.x = x;
    dragging.y = y;
    renderer.setDrag(dragging);
    requestFrame();
  },

  onDrop(sq) {
    const from = dragging?.from ?? -1;
    dragging = null;
    renderer.setDrag(null);
    if (from < 0) return;
    // Fällt die Figur auf ihr eigenes Feld oder daneben, bleibt sie gewählt –
    // dann zieht man eben tippend weiter.
    if (sq >= 0 && sq !== from && tryMove(from, sq)) return;
    refresh();
  },

  onDragCancel() {
    dragging = null;
    renderer.setDrag(null);
    refresh();
  },

  onAction(name, value) {
    if (name === 'cursor') { moveCursor(value); return; }
    if (screens.isOpen() && name !== 'escape') return;
    if (name === 'undo') undoMove();
    else if (name === 'flip') flipBoard();
    else if (name === 'escape') { if (screens.isOpen()) closeOverlay(); else openMenu(); }
  },
});

/**
 * Tastaturfokus bewegen. Gewählt wird dabei nichts – erst <kbd>Enter</kbd>
 * löst über `onTap` denselben Weg aus wie ein Fingertipp.
 */
function moveCursor(sq) {
  cursor = sq;
  refresh();
}

// ── Computergegner ──────────────────────────────────────────────────────────

async function queueComputer() {
  if (mode !== 'computer' || isOver(game) || game.state.turn === humanColor) return;

  const mark = ++generation;
  const fen = toFen(game.state);
  thinking = game.state.turn;
  refresh();

  let result = null;
  try {
    result = await opponent.think(fen, levelById(settings.level));
  } catch {
    // Abgebrochen oder Worker gestorben – die Partie läuft weiter, sobald der
    // Mensch wieder zieht.
  }

  thinking = -1;
  if (mark !== generation || isOver(game) || toFen(game.state) !== fen) { refresh(); return; }

  const mv = result?.uci && currentMoves(game).find((candidate) => toUci(candidate) === result.uci);
  if (mv) applyMove(mv);
  else refresh();
}

// ── Partie steuern ──────────────────────────────────────────────────────────

function startGame(options) {
  generation += 1;
  opponent.cancel();

  mode = options.mode;
  humanColor = options.humanColor ?? WHITE;
  game = createGame(options.fen ?? START_FEN);
  clock = createClock(controlById(options.time ?? 'aus'));
  clearSelection();
  pendingPromo = null;
  thinking = -1;
  cursor = -1;
  started = true;

  renderer.setBoard(game.state.board);
  renderer.setFlipped(mode === 'computer' ? humanColor === BLACK : false, false);
  if (clock.enabled) startSide(clock, WHITE);

  screens.close();
  persist();
  refresh();
  measure();

  if (mode === 'computer' && humanColor === BLACK) queueComputer();
}

function undoMove() {
  if (!game.history.length || thinking >= 0) return;
  generation += 1;
  opponent.cancel();
  // Gegen den Computer gehen zwei Halbzüge zurück – sonst wäre nach dem
  // Rücknehmen sofort wieder der Rechner am Zug und spielte dasselbe.
  const plies = mode === 'computer' && game.history.length > 1 ? 2 : 1;
  takeBack(game, plies);
  clearSelection();
  renderer.setBoard(game.state.board);
  if (clock.enabled) startSide(clock, game.state.turn);
  orient();
  persist();
  refresh();
  screens.toast(plies === 2 ? 'Zwei Halbzüge zurück' : 'Ein Halbzug zurück');
}

function flipBoard() {
  renderer.setFlipped(!renderer.flipped);
  refresh();
}

function finishGame() {
  const result = outcome(game);
  if (!result) return;
  stop(clock);
  clearGame();

  const reason = REASON_TEXT[result.reason] ?? 'Partie beendet';
  const winner = result.winner;

  $('over-kicker').textContent = winner === null ? 'Unentschieden' : 'Partie entschieden';
  $('over-title').textContent = winner === null
    ? 'Remis'
    : `${COLOR_NAME[winner]} gewinnt`;
  $('over-detail').textContent = reason;
  $('over-score').textContent = result.result ?? game.status.result;

  if (winner === null) audio.draw();
  else if (mode === 'computer') (winner === humanColor ? audio.win : audio.lose)();
  else audio.win();

  refresh();
  setTimeout(() => screens.show('over'), 520);
}

/** Laufende Partie sichern, damit ein Neuladen sie nicht kostet. */
function persist() {
  if (!started || isOver(game)) { clearGame(); return; }
  saveGame({
    mode,
    humanColor,
    level: settings.level,
    time: clock.control.id,
    left: clock.left,
    game: serialize(game),
  });
}

/** Gesicherte Partie zurückholen. */
function resumeGame(snapshot) {
  generation += 1;
  mode = snapshot.mode === 'computer' ? 'computer' : 'hotseat';
  humanColor = snapshot.humanColor === BLACK ? BLACK : WHITE;
  game = restore(snapshot.game);
  clock = createClock(controlById(snapshot.time));
  if (clock.enabled && Array.isArray(snapshot.left)) clock.left = [...snapshot.left];
  clearSelection();
  thinking = -1;
  started = true;

  renderer.setBoard(game.state.board);
  renderer.setFlipped(mode === 'computer' ? humanColor === BLACK : game.state.turn === BLACK && settings.autoFlip, false);
  if (clock.enabled) startSide(clock, game.state.turn);

  screens.close();
  refresh();
  measure();
  if (mode === 'computer' && game.state.turn !== humanColor) queueComputer();
}

// ── Bildschirme und Knöpfe ──────────────────────────────────────────────────

/**
 * Einen Bildschirm öffnen und dabei die Uhr anhalten.
 *
 * Im Menü nachzudenken darf keine Bedenkzeit kosten – die Umwandlung ist die
 * Ausnahme: Sie gehört noch zum laufenden Zug.
 */
function openScreen(name) {
  if (started && !isOver(game) && name !== 'promo') stop(clock);
  screens.show(name);
}

function closeOverlay() {
  if (pendingPromo) { pendingPromo = null; clearSelection(); }
  if (!started) { screens.show('title'); return; }
  screens.close();
  if (!isOver(game) && clock.enabled && clock.running < 0) startSide(clock, game.state.turn);
  refresh();
}

/** Das Menü mit dem Stand der laufenden Partie füllen und öffnen. */
function openMenu() {
  $('menu-sub').textContent = mode === 'computer'
    ? `Gegen ${levelById(settings.level).name} · du spielst ${COLOR_NAME[humanColor]}`
    : 'Zwei Spieler am selben Gerät';
  $('opt-sound').checked = settings.sound;
  $('opt-hints').checked = settings.hints;
  $('opt-autoflip-game').checked = settings.autoFlip;
  $('opt-autoflip-row').hidden = mode === 'computer';
  openScreen('menu');
}

/** Einrichtungsbildschirm für den gewählten Modus zusammenstellen. */
function openSetup(forMode) {
  draft.mode = forMode;
  const computer = forMode === 'computer';

  $('setup-title').textContent = computer ? 'Gegen den Computer' : 'Zwei Spieler';
  $('setup-sub').textContent = computer
    ? 'Der Rechner denkt in einem eigenen Faden – das Brett bleibt flüssig.'
    : 'Am selben Gerät, abwechselnd. Das Brett dreht sich auf Wunsch mit.';
  $('setup-level').hidden = !computer;
  $('setup-side').hidden = !computer;
  $('setup-flip').hidden = computer;
  $('opt-autoflip').checked = settings.autoFlip;

  buildChoices($('level-row'), LEVELS, draft.level, (id) => {
    draft.level = id;
    $('level-note').textContent = levelById(id).note;
  });
  $('level-note').textContent = levelById(draft.level).note;

  buildChoices($('side-row'), [
    { id: 'weiss', name: '♔ Weiß' },
    { id: 'schwarz', name: '♚ Schwarz' },
    { id: 'zufall', name: '🎲 Zufall' },
  ], draft.side, (id) => { draft.side = id; });

  buildChoices($('time-row'), TIME_CONTROLS, draft.time, (id) => { draft.time = id; });

  openScreen('setup');
}

function beginFromDraft() {
  settings = {
    ...settings,
    level: draft.level,
    side: draft.side,
    timeControl: draft.time,
    autoFlip: draft.mode === 'computer' ? settings.autoFlip : $('opt-autoflip').checked,
  };
  saveSettings(settings);

  const side = draft.side === 'zufall'
    ? (Math.random() < 0.5 ? WHITE : BLACK)
    : draft.side === 'schwarz' ? BLACK : WHITE;

  audio.unlock();
  startGame({ mode: draft.mode, humanColor: side, time: draft.time });
  if (draft.mode === 'computer' && draft.side === 'zufall') {
    screens.toast(`Du spielst ${COLOR_NAME[side]}`);
  }
}

$('btn-start-hotseat').addEventListener('click', () => openSetup('hotseat'));
$('btn-start-computer').addEventListener('click', () => openSetup('computer'));
$('btn-setup-start').addEventListener('click', beginFromDraft);
$('btn-setup-back').addEventListener('click', () => (started ? closeOverlay() : screens.show('title')));
$('btn-rules').addEventListener('click', () => openScreen('rules'));
$('btn-rules-close').addEventListener('click', closeOverlay);

$('btn-menu').addEventListener('click', openMenu);

$('btn-menu-resume').addEventListener('click', closeOverlay);
$('btn-menu-rules').addEventListener('click', () => openScreen('rules'));
$('btn-menu-new').addEventListener('click', () => openSetup(mode));

$('btn-menu-resign').addEventListener('click', () => {
  if (isOver(game)) return;
  const loser = mode === 'computer' ? humanColor : game.state.turn;
  endGame(game, 'aufgabe', loser === WHITE ? BLACK : WHITE);
  screens.close();
  finishGame();
});

$('btn-menu-draw').addEventListener('click', () => {
  if (isOver(game)) return;
  endGame(game, 'vereinbart', null);
  screens.close();
  finishGame();
});

$('btn-undo').addEventListener('click', undoMove);
$('btn-flip').addEventListener('click', flipBoard);
$('btn-moves').addEventListener('click', () => openScreen('moves'));
$('btn-moves-close').addEventListener('click', closeOverlay);

$('btn-copy-pgn').addEventListener('click', async () => {
  const text = game.history.map((entry, index) =>
    (index % 2 ? '' : `${index / 2 + 1}. `) + entry.san).join(' ');
  try {
    await navigator.clipboard.writeText(text || '(noch kein Zug)');
    screens.toast('Notation kopiert');
  } catch {
    screens.toast('Kopieren hat nicht geklappt');
  }
});

$('btn-promo-cancel').addEventListener('click', () => {
  pendingPromo = null;
  clearSelection();
  closeOverlay();
});

$('btn-over-again').addEventListener('click', () => {
  startGame({ mode, humanColor, time: clock.control.id });
});
$('btn-over-review').addEventListener('click', () => { screens.close(); refresh(); });
$('btn-over-menu').addEventListener('click', () => openSetup(mode));

$('opt-sound').addEventListener('change', (event) => {
  settings = { ...settings, sound: event.target.checked };
  audio.setEnabled(settings.sound);
  saveSettings(settings);
});

$('opt-hints').addEventListener('change', (event) => {
  settings = { ...settings, hints: event.target.checked };
  saveSettings(settings);
  refresh();
});

$('opt-autoflip-game').addEventListener('change', (event) => {
  settings = { ...settings, autoFlip: event.target.checked };
  saveSettings(settings);
  orient();
  refresh();
});

// Beim Verlassen der Seite den Stand sichern – auf dem Handy kommt oft kein
// `beforeunload`, wohl aber der Wechsel in den Hintergrund.
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
window.addEventListener('pagehide', persist);

// ── Start ───────────────────────────────────────────────────────────────────

paintTitleArt($('title-canvas'));
renderer.setBoard(game.state.board);
measure();
refresh();

/**
 * `?stellung=<FEN>` beginnt zu zweit aus einer gesetzten Stellung.
 *
 * Gedacht zum Nachstellen und Weiterspielen einer Partie – und beim Bauen der
 * schnellste Weg, Umwandlung, Matt oder Endspiel zu prüfen, ohne dreißig Züge
 * dorthin zu spielen.
 */
const wanted = new URLSearchParams(location.search).get('stellung');
if (wanted) {
  try {
    parseFen(wanted);
    startGame({ mode: 'hotseat', time: 'aus', fen: wanted });
    screens.toast('Stellung aus dem Link');
  } catch {
    screens.toast('Diese Stellung war nicht lesbar');
  }
}

const saved = loadGame();
if (!started && saved?.game?.moves?.length) {
  const resume = $('btn-resume');
  resume.hidden = false;
  const plies = saved.game.moves.length;
  resume.textContent = `▶ Partie fortsetzen (${plies} ${plies === 1 ? 'Halbzug' : 'Halbzüge'})`;
  resume.addEventListener('click', () => { audio.unlock(); resumeGame(saved); });
}

if (!started) screens.show('title');
