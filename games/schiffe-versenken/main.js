// Schiffe versenken – Verdrahtung von Partie, Darstellung und Bedienung.
//
// Die Regeln liegen DOM-frei in `logic/`. Hier kommt zusammen, was der
// Browser beisteuert: zwei Meere auf dem Bildschirm, Aufstellung, Zielen,
// die Übergabe zwischen zwei Spielern an einem Gerät, Klang und Speicher.

import { FLEETS, fleetPieces, cellName } from './logic/rules.js';
import { randomFleet } from './logic/fleet.js';
import { createBoard, fire, publicView, shipsLeft, canFire } from './logic/board.js';
import {
  createMatch, commitFleet, shoot, stats, incomingSinceLastTurn, opponentOf, serialize, restore,
} from './logic/match.js';
import { chooseShot, LEVELS } from './logic/ai.js';
import { createBoardView } from './gfx/boardview.js';
import { createPlacement } from './placement.js';
import { attachTargeting } from './input.js';
import { createScreens, buildChoices } from './ui/screens.js';
import { paintTitleScene } from './ui/title-art.js';
import { createFireworks } from './ui/fireworks.js';
import { loadSettings, saveSettings, loadMatch, saveMatch, clearMatch } from './storage.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('stage'),
  statusTitle: $('status-title'), statusSub: $('status-sub'),
  slotMajor: $('slot-major'), slotMinor: $('slot-minor'),
  frameOwn: $('frame-own'), frameEnemy: $('frame-enemy'),
  captionOwn: $('caption-own'), captionEnemy: $('caption-enemy'),
  fleetEnemy: $('fleet-enemy'), fleetOwn: $('fleet-own'),
  fire: $('btn-fire'), ready: $('btn-ready'), placeHint: $('place-hint'),
  sound: $('btn-sound'),
  titleCanvas: $('title-canvas'), fireworks: $('fireworks'),
  toast: $('toast'),
};

const screens = createScreens({
  title: $('screen-title'), setup: $('screen-setup'), handover: $('screen-handover'),
  menu: $('screen-menu'), rules: $('screen-rules'), over: $('screen-over'), toast: el.toast,
}, 'title');

const ownView = createBoardView($('board-own'));
const enemyView = createBoardView($('board-enemy'), { enemy: true });
const fireworks = createFireworks(el.fireworks);

let settings = loadSettings();
audio.setEnabled(settings.sound);

/** @type {ReturnType<typeof createMatch>|null} */
let match = null;
/** Aus wessen Sicht die Meere gerade gezeigt werden. */
let viewer = 0;
/** 'title' | 'place' | 'battle' | 'review' */
let phase = 'title';
/** Läuft gerade eine Animation, die keine Eingabe verträgt? */
let busy = false;
let aim = -1;
/** Wechselt bei jeder neuen Partie – verwaiste Abläufe brechen daran ab. */
let generation = 0;
/** Rückschau der gegnerischen Schüsse überspringen (Tippen). */
let skipReplay = false;
/** Wohin die Übergabe führt, wenn „Ich bin bereit“ getippt wird. */
let afterHandover = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, skipReplay ? Math.min(ms, 60) : ms));
const nameOf = (player) => match.names[player];
const isComputer = (player) => match?.mode === 'ki' && player === 1;

// ── Aufstellung ─────────────────────────────────────────────────────────────

const placement = createPlacement({
  view: ownView,
  dock: $('dock'),
  sound: (name) => audio[name]?.(),
  onChange: () => {
    if (phase !== 'place') return;
    el.ready.disabled = !placement.complete;
    el.placeHint.textContent = placement.complete
      ? 'Alles auf Position? Dann ab ins Gefecht.'
      : placement.remaining === fleetPieces(match.rules.fleet).length
        ? 'Schiff aufs Meer ziehen – oder antippen und dann ein Feld wählen.'
        : `Noch ${placement.remaining} ${placement.remaining === 1 ? 'Schiff' : 'Schiffe'}. Antippen auf dem Meer dreht ein Schiff.`;
  },
});

function startPlacement(player) {
  phase = 'place';
  viewer = player;
  busy = false;
  arrange('own');
  setStatus(
    match.mode === 'duo' ? `${nameOf(player)}: Flotte aufstellen` : 'Flotte aufstellen',
    match.mode === 'duo' ? 'Der andere schaut bitte weg!' : FLEETS[match.rules.fleet].note,
  );
  ownView.set({ shots: null, dim: false, aim: -1 });
  placement.start(match.rules.fleet, match.rules.spacing);
}

$('btn-random').addEventListener('click', () => placement.randomize());
$('btn-clear').addEventListener('click', () => placement.clear());
$('btn-rotate').addEventListener('click', () => placement.rotate());

el.ready.addEventListener('click', () => {
  if (phase !== 'place' || !placement.complete) return;
  const ships = placement.ships.map(({ id, type, name, length, x, y, dir }) => ({ id, type, name, length, x, y, dir }));
  placement.stop();
  commitFleet(match, viewer, ships);
  audio.turn();

  if (match.mode === 'ki') {
    commitFleet(match, 1, randomFleet(match.rules.fleet, match.rules.spacing));
    persist();
    startBattle();
    return;
  }
  persist();
  if (match.phase === 'setup') {
    handover(match.turn, {
      title: `Gib das Gerät an ${nameOf(match.turn)}`,
      sub: `${nameOf(match.turn)} stellt jetzt die eigene Flotte auf. ${nameOf(viewer)} schaut weg!`,
      button: `Ich bin ${nameOf(match.turn)} – aufstellen`,
      result: '⚓ Flotte von ' + nameOf(viewer) + ' liegt bereit',
      then: () => startPlacement(match.turn),
    });
  } else {
    handover(match.turn, {
      title: `Gib das Gerät an ${nameOf(match.turn)}`,
      sub: `Beide Flotten liegen bereit. ${nameOf(match.turn)} feuert den ersten Schuss.`,
      button: `Ich bin ${nameOf(match.turn)} – los!`,
      result: '⚓ Beide Flotten sind auf See',
      then: () => startBattle(),
    });
  }
});

// ── Gefecht ─────────────────────────────────────────────────────────────────

function startBattle() {
  phase = 'battle';
  viewer = match.mode === 'ki' ? 0 : match.turn;
  if (isComputer(match.turn)) {
    arrange('own');
    renderBoards();
    computerTurn();
    return;
  }
  beginTurn();
}

/**
 * Der Spieler am Zug übernimmt. Im Zweierspiel sieht er zuerst auf der
 * eigenen Flotte, was der andere angerichtet hat.
 */
async function beginTurn() {
  const gen = generation;
  viewer = match.mode === 'ki' ? 0 : match.turn;
  aim = -1;
  const incoming = match.mode === 'duo' ? incomingSinceLastTurn(match, viewer) : [];
  const opponentHasShot = match.log.some((entry) => entry.p !== viewer);

  el.stage.dataset.player = String(viewer);

  if (match.mode === 'duo' && incoming.length && opponentHasShot) {
    busy = true;
    skipReplay = false;
    arrange('own');
    renderBoards();
    const hits = incoming.filter((entry) => entry.r !== 'miss').length;
    setStatus(`So hat ${nameOf(opponentOf(viewer))} geschossen`, `${incoming.length} ${incoming.length === 1 ? 'Schuss' : 'Schüsse'}, ${hits} Treffer`);
    // Die eigene Flotte so zeigen, wie sie vor diesen Schüssen aussah …
    const own = boardAt(viewer, match.log.length - incoming.length);
    ownView.set({ ships: own.ships, shots: own.shots, dim: false, aim: -1 });
    await wait(500);
    // … und die Schüsse dann einzeln nachspielen.
    for (const entry of incoming) {
      if (gen !== generation) return;
      const outcome = fire(own, entry.i, match.rules.spacing);
      await animateShot(ownView, entry.i, outcome.result, outcome.ship, () => {
        ownView.set({ ships: own.ships, shots: own.shots });
      }, true);
      await wait(380);
    }
    if (gen !== generation) return;
    ownView.pulse(incoming.map((entry) => entry.i));
    await wait(skipReplay ? 0 : 700);
    if (gen !== generation) return;
  }
  skipReplay = false;
  busy = false;
  arrange('enemy');
  renderBoards();
  audio.turn();
  setTurnStatus();
}

/** Ein Meer, wie es nach den ersten `logLength` Schüssen der Partie aussah. */
function boardAt(player, logLength) {
  const board = createBoard(match.boards[player].ships.map(({ hits, sunk, ...ship }) => ship));
  for (const entry of match.log.slice(0, logLength)) {
    if (entry.p !== player) fire(board, entry.i, match.rules.spacing);
  }
  return board;
}

function setTurnStatus() {
  const enemy = match.boards[opponentOf(viewer)];
  const own = stats(match, viewer);
  setStatus(
    match.mode === 'ki' ? 'Du bist dran' : `${nameOf(viewer)} ist dran`,
    `Noch ${shipsLeft(enemy)} ${shipsLeft(enemy) === 1 ? 'Schiff' : 'Schiffe'} · ${own.shots} Schüsse · ${own.hits} Treffer`,
  );
}

function setAim(idx) {
  if (phase !== 'battle') return;
  const board = match.boards[opponentOf(viewer)];
  aim = idx >= 0 && canFire(board, idx) ? idx : -1;
  enemyView.set({ aim });
  if (idx >= 0 && aim < 0) screens.toast(`Auf ${cellName(idx)} hast du schon geschossen`, 1400);
  renderFireButton();
}

function renderFireButton() {
  const ready = phase === 'battle' && !busy && aim >= 0 && canFire(match.boards[opponentOf(viewer)], aim);
  el.fire.disabled = !ready;
  el.fire.textContent = ready ? `🔥 Feuer auf ${cellName(aim)}!` : busy ? 'Feuer frei …' : 'Ziel antippen';
}

const canShoot = () =>
  phase === 'battle' && !busy && !screens.isOpen() && match && match.turn === viewer && !isComputer(match.turn);

attachTargeting(enemyView, {
  enabled: canShoot,
  aim: () => aim,
  onAim: setAim,
  onFire: (idx) => fireAt(idx),
});

el.fire.addEventListener('click', () => { if (aim >= 0) fireAt(aim); });

async function fireAt(idx) {
  if (!canShoot()) return;
  if (!canFire(match.boards[opponentOf(viewer)], idx)) {
    setAim(idx);
    return;
  }
  const gen = generation;
  busy = true;
  aim = -1;
  enemyView.set({ aim: -1 });
  renderFireButton();
  const outcome = shoot(match, idx);
  persist();
  await animateShot(enemyView, idx, outcome.result, outcome.ship, () => renderBoards());
  if (gen !== generation) return;
  await wait(outcome.result === 'miss' ? 650 : 900);
  if (gen !== generation) return;

  if (outcome.over) { finish(); return; }
  if (outcome.again) {
    busy = false;
    renderFireButton();
    setTurnStatus();
    screens.toast(outcome.result === 'sunk' ? 'Versenkt! Du darfst nochmal.' : 'Treffer! Du darfst nochmal.', 1600);
    return;
  }
  if (match.mode === 'ki') {
    computerTurn();
    return;
  }
  const next = match.turn;
  handover(next, {
    title: `Gib das Gerät an ${nameOf(next)}`,
    sub: `${nameOf(viewer)} schaut jetzt weg.`,
    button: `Ich bin ${nameOf(next)} – weiter`,
    result: `💧 ${nameOf(viewer)}: Wasser auf ${cellName(idx)}`,
    then: () => beginTurn(),
  });
}

/**
 * Schuss mit allem, was dazugehört: Abschuss, Flug, Einschlag, Schrift und
 * Rütteln. `apply` setzt beim Einschlag den neuen Stand aufs Brett.
 */
async function animateShot(view, idx, result, ship, apply, quick = false) {
  audio.launch(quick ? 0.45 : 0.6);
  await view.fireAt(idx, result, result === 'sunk' ? ship : null);
  apply();
  if (result === 'miss') {
    audio.splash();
    view.showBanner('Wasser', '#bfe6ff', 0.9);
  } else if (result === 'hit') {
    audio.explosion(false);
    audio.rumble(60);
    view.showBanner('Treffer!', '#ffb35c', 1.1);
  } else {
    audio.explosion(true);
    audio.sink();
    audio.rumble([80, 60, 160]);
    view.showBanner(`${ship?.name ?? 'Schiff'} versenkt!`, '#ff6a52', 1.6);
  }
}

async function computerTurn() {
  const gen = generation;
  busy = true;
  renderFireButton();
  await wait(650);
  if (gen !== generation) return;
  arrange('own');
  renderBoards();
  setStatus('Der Computer zielt …', `Spielstärke: ${LEVELS.find((l) => l.id === match.level)?.name ?? ''}`);

  while (gen === generation && match.phase === 'battle' && isComputer(match.turn)) {
    await wait(700 + Math.random() * 500);
    if (gen !== generation) return;
    const idx = chooseShot(publicView(match.boards[0]), { level: match.level, spacing: match.rules.spacing });
    const outcome = shoot(match, idx);
    persist();
    setStatus(`Der Computer schießt auf ${cellName(idx)}`, '');
    await animateShot(ownView, idx, outcome.result, outcome.ship, () => renderBoards());
    if (gen !== generation) return;
    await wait(outcome.result === 'miss' ? 700 : 950);
    if (outcome.over) { finish(); return; }
  }
  if (gen !== generation) return;
  busy = false;
  arrange('enemy');
  renderBoards();
  audio.turn();
  setTurnStatus();
}

// ── Übergabe ────────────────────────────────────────────────────────────────

function handover(player, { title, sub, button, result = '', then }) {
  busy = true;
  aim = -1;
  $('handover-title').textContent = title;
  $('handover-sub').textContent = sub;
  $('handover-result').textContent = result;
  $('handover-result').hidden = !result;
  $('btn-handover').textContent = button;
  afterHandover = then;
  el.stage.dataset.player = String(player);
  screens.show('handover');
}

$('btn-handover').addEventListener('click', () => {
  audio.unlock();
  const then = afterHandover;
  afterHandover = null;
  screens.close();
  then?.();
});

// ── Spielende ───────────────────────────────────────────────────────────────

function finish() {
  phase = 'review';
  busy = false;
  clearMatch();
  const winner = match.winner;
  const loser = opponentOf(winner);
  const humanWon = match.mode === 'duo' || winner === 0;
  viewer = match.mode === 'ki' ? 0 : winner;
  renderBoards();

  $('over-kicker').textContent = 'Seeschlacht beendet';
  if (match.mode === 'ki') {
    $('over-title').textContent = humanWon ? 'Sieg!' : 'Versenkt …';
    $('over-detail').textContent = humanWon
      ? `Die ganze Computerflotte liegt auf dem Meeresgrund – in ${stats(match, 0).shots} Schüssen.`
      : `Der Computer hat deine Flotte in ${stats(match, 1).shots} Schüssen versenkt. Revanche?`;
  } else {
    $('over-title').textContent = `${nameOf(winner)} gewinnt!`;
    $('over-detail').textContent = `Alle Schiffe von ${nameOf(loser)} versenkt – in ${stats(match, winner).shots} Schüssen.`;
  }
  const rows = [0, 1].map((p) => {
    const s = stats(match, p);
    return `<div class="stat ${p === winner ? 'stat--win' : ''}"><b>${escapeHtml(nameOf(p))}${p === winner ? ' 🏆' : ''}</b><span>${s.shots} Schüsse</span><span>${s.hits} Treffer</span><span>${s.rate} % Quote</span></div>`;
  });
  $('over-stats').innerHTML = rows.join('');
  if (humanWon) { audio.win(); fireworks.start(); } else audio.lose();
  setTimeout(() => screens.show('over'), 700);
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function rematch() {
  fireworks.stop();
  const names = match.mode === 'duo' ? [match.names[1], match.names[0]] : match.names;
  newMatch(match.mode, names);
  if (match.mode === 'duo') screens.toast(`${nameOf(0)} beginnt diesmal`, 2000);
}

$('btn-over-again').addEventListener('click', rematch);
$('btn-review-again').addEventListener('click', rematch);
$('btn-over-review').addEventListener('click', () => {
  fireworks.stop();
  screens.close();
  arrange('enemy');
  renderBoards();
  setStatus(match.mode === 'duo' ? `${nameOf(match.winner)} hat gewonnen` : (match.winner === 0 ? 'Gewonnen!' : 'Verloren'), 'Alle Schiffe aufgedeckt');
});
$('btn-over-menu').addEventListener('click', toTitle);
$('btn-review-menu').addEventListener('click', toTitle);

// ── Darstellung ─────────────────────────────────────────────────────────────

/**
 * Die beiden Meere auf die Plätze verteilen. `focus` ist das Meer im großen
 * Platz: beim Aufstellen und während der Gegner schießt das eigene.
 */
function arrange(focus) {
  el.stage.dataset.phase = phase;
  el.stage.dataset.focus = focus;
  const [major, minor] = focus === 'own' ? [el.frameOwn, el.frameEnemy] : [el.frameEnemy, el.frameOwn];
  if (major.parentElement !== el.slotMajor) el.slotMajor.replaceChildren(major);
  if (phase === 'place') el.slotMinor.replaceChildren();
  else if (minor.parentElement !== el.slotMinor) el.slotMinor.replaceChildren(minor);
  ownView.resize();
  enemyView.resize();
}

function renderBoards() {
  if (!match || !match.boards[viewer]) return;
  const own = match.boards[viewer];
  const enemyBoard = match.boards[opponentOf(viewer)];
  const reveal = phase === 'review';
  ownView.set({ ships: own.ships, shots: own.shots, ghost: null, blocked: null, selectedId: null, aim: -1, dim: false });
  if (enemyBoard) {
    enemyView.set({
      ships: enemyBoard.ships.filter((ship) => ship.sunk || reveal),
      shots: enemyBoard.shots,
      aim,
      dim: phase === 'battle' && (busy && isComputer(match.turn)),
    });
  }
  const opp = opponentOf(viewer);
  el.captionOwn.textContent = match.mode === 'duo' ? `Flotte von ${nameOf(viewer)}` : 'Deine Flotte';
  el.captionEnemy.textContent = match.mode === 'duo' ? `Meer von ${nameOf(opp)}` : 'Computerflotte';
  renderFleet(el.fleetEnemy, enemyBoard, match.mode === 'duo' ? nameOf(opp) : 'Computer');
  renderFleet(el.fleetOwn, own, match.mode === 'duo' ? nameOf(viewer) : 'Du');
  renderFireButton();
}

/** Flottenübersicht: je Schiff ein Balken, versenkte durchgestrichen. */
function renderFleet(node, board, label) {
  if (!board) { node.replaceChildren(); return; }
  const head = document.createElement('span');
  head.className = 'fleet-label';
  head.textContent = `${label}: ${shipsLeft(board)}/${board.ships.length}`;
  const list = document.createElement('span');
  list.className = 'fleet-list';
  for (const ship of [...board.ships].sort((a, b) => b.length - a.length)) {
    const bar = document.createElement('span');
    bar.className = `fleet-ship${ship.sunk ? ' is-sunk' : ''}`;
    bar.title = `${ship.name}${ship.sunk ? ' – versenkt' : ''}`;
    for (let i = 0; i < ship.length; i += 1) bar.append(document.createElement('i'));
    list.append(bar);
  }
  node.replaceChildren(head, list);
}

function setStatus(title, sub = '') {
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
}

// ── Partie anlegen, sichern, fortsetzen ─────────────────────────────────────

function newMatch(mode, names) {
  generation += 1;
  fireworks.stop();
  match = createMatch({
    mode,
    names: mode === 'ki' ? ['Du', 'Computer'] : names,
    level: settings.level,
    rules: settings.rules,
  });
  screens.close();
  aim = -1;
  ownView.fx.clear();
  enemyView.fx.clear();
  startPlacement(0);
}

function persist() {
  if (match && match.phase !== 'over') saveMatch(serialize(match));
}

function resume(saved) {
  generation += 1;
  match = saved;
  screens.close();
  if (match.phase === 'setup') {
    // Halb aufgestellte Flotten werden nicht gespeichert – neu aufstellen.
    if (match.mode === 'duo') {
      handover(match.turn, {
        title: `Weiter geht's: ${nameOf(match.turn)}`,
        sub: `${nameOf(match.turn)} stellt die Flotte auf.`,
        button: `Ich bin ${nameOf(match.turn)}`,
        then: () => startPlacement(match.turn),
      });
    } else startPlacement(0);
    return;
  }
  phase = 'battle';
  if (match.mode === 'duo') {
    handover(match.turn, {
      title: `Weiter geht's: ${nameOf(match.turn)} ist dran`,
      sub: 'Die anderen schauen bitte weg.',
      button: `Ich bin ${nameOf(match.turn)}`,
      then: () => startBattle(),
    });
  } else startBattle();
}

function toTitle() {
  generation += 1;
  fireworks.stop();
  placement.stop();
  phase = 'title';
  busy = false;
  el.stage.dataset.phase = 'title';
  $('btn-resume').hidden = !restore(loadMatch());
  screens.show('title');
}

// ── Einrichtung ─────────────────────────────────────────────────────────────

let setupMode = 'duo';

function openSetup(mode) {
  audio.unlock();
  setupMode = mode;
  $('setup-title').textContent = mode === 'duo' ? 'Zu zweit spielen' : 'Gegen den Computer';
  $('setup-sub').textContent = mode === 'duo'
    ? 'Ein Gerät, zwei Kapitäne. Nach jedem Zug wird weitergegeben.'
    : 'Du stellst deine Flotte auf, der Computer seine – dann wird abwechselnd geschossen.';
  $('setup-names').hidden = mode !== 'duo';
  $('setup-level').hidden = mode !== 'ki';
  $('name-a').value = settings.names[0] === 'Spieler 1' ? '' : settings.names[0];
  $('name-b').value = settings.names[1] === 'Spieler 2' ? '' : settings.names[1];

  const levelNote = () => { $('level-note').textContent = LEVELS.find((l) => l.id === settings.level)?.note ?? ''; };
  buildChoices($('level-row'), LEVELS, settings.level, (id) => { settings.level = id; levelNote(); audio.click(); });
  levelNote();

  const fleetNote = () => { $('fleet-note').textContent = FLEETS[settings.rules.fleet].note; };
  const fleetOptions = Object.entries(FLEETS).map(([id, fleet]) => ({ id, name: fleet.name }));
  buildChoices($('fleet-row'), fleetOptions, settings.rules.fleet, (id) => { settings.rules.fleet = id; fleetNote(); audio.click(); });
  fleetNote();

  $('opt-spacing').checked = settings.rules.spacing;
  $('opt-bonus').checked = settings.rules.bonusShot;
  screens.show('setup');
}

$('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  settings.rules.spacing = $('opt-spacing').checked;
  settings.rules.bonusShot = $('opt-bonus').checked;
  const names = [
    $('name-a').value.trim() || 'Spieler 1',
    $('name-b').value.trim() || 'Spieler 2',
  ];
  if (names[0] === names[1]) names[1] += ' (2)';
  if (setupMode === 'duo') settings.names = names;
  saveSettings(settings);
  document.activeElement?.blur?.();
  newMatch(setupMode, names);
});

$('btn-setup-back').addEventListener('click', toTitle);
$('btn-start-duo').addEventListener('click', () => openSetup('duo'));
$('btn-start-ki').addEventListener('click', () => openSetup('ki'));
$('btn-resume').addEventListener('click', () => {
  audio.unlock();
  const saved = restore(loadMatch());
  if (saved) resume(saved);
});

// ── Menü, Regeln, Klang ─────────────────────────────────────────────────────

let rulesReturn = null;

$('btn-menu').addEventListener('click', () => {
  if (phase === 'title') return;
  $('menu-sub').textContent = match?.mode === 'duo'
    ? `${nameOf(0)} gegen ${nameOf(1)}`
    : `Gegen den Computer (${LEVELS.find((l) => l.id === match?.level)?.name ?? ''})`;
  screens.show('menu');
});
$('btn-menu-resume').addEventListener('click', () => screens.close());
$('btn-menu-new').addEventListener('click', () => {
  clearMatch();
  openSetup(match?.mode ?? 'duo');
});
$('btn-menu-rules').addEventListener('click', () => { rulesReturn = 'menu'; screens.show('rules'); });
$('btn-rules').addEventListener('click', () => { rulesReturn = 'title'; screens.show('rules'); });
$('btn-rules-close').addEventListener('click', () => {
  if (rulesReturn === 'title') screens.show('title'); else screens.close();
});

function renderSound() {
  el.sound.textContent = settings.sound ? '🔊' : '🔇';
  el.sound.setAttribute('aria-pressed', String(settings.sound));
}
el.sound.addEventListener('click', () => {
  settings.sound = !settings.sound;
  audio.setEnabled(settings.sound);
  saveSettings(settings);
  renderSound();
});
renderSound();

// Erste Berührung weckt den Klang; Tippen während der Rückschau überspringt sie.
window.addEventListener('pointerdown', () => {
  audio.unlock();
  if (busy && phase === 'battle' && el.stage.dataset.focus === 'own' && match?.mode === 'duo') skipReplay = true;
}, { capture: true });

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (screens.current === 'menu' || screens.current === 'rules') screens.close();
  else if (!screens.isOpen() && phase !== 'title') $('btn-menu').click();
});

// ── Bildtakt ────────────────────────────────────────────────────────────────

function tick(now) {
  requestAnimationFrame(tick);
  const overlay = screens.current;
  if (overlay === 'title' || (overlay === 'rules' && rulesReturn === 'title')) {
    paintTitle(now);
    return;
  }
  if (overlay === 'over') fireworks.frame(now);
  // Hinter undurchsichtigen Bildschirmen muss kein Meer gezeichnet werden.
  if (overlay === 'handover' || overlay === 'setup' || phase === 'title') return;
  ownView.frame(now);
  if (phase !== 'place') enemyView.frame(now);
}

function paintTitle(now) {
  const canvas = el.titleCanvas;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintTitleScene(ctx, w, h, now / 1000);
}

requestAnimationFrame(tick);

// Gespeicherte Partie anbieten
$('btn-resume').hidden = !restore(loadMatch());

// Für die Abnahme im Browser: Zustand von außen einsehen.
if (new URLSearchParams(location.search).has('debug')) {
  globalThis.__schiffe = { get match() { return match; }, get phase() { return phase; }, placement, fireAt, setAim };
}
