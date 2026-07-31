// Lumenweber – Verdrahtung von Logik, Darstellung und Bedienung.
//
// Die Spiellogik liegt vollständig in `game.js`/`beam.js`/`optics.js` und weiß
// nichts vom DOM. Hier kommt nur zusammen, was der Browser beisteuert: Canvas,
// Eingabe, Bildschirme, Fortschritt.

import { levels } from './levels.js';
import { createSession, cycleAt, undo, resetSession, rating } from './game.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { solveFrom } from './sim/solver.js';
import { teachArt } from './teach.js';
import {
  loadProgress, recordSolve, isUnlocked, nextOpenIndex, totalStars,
  hasSeenRules, markRulesSeen, hasSeenTeach, markTeachSeen,
} from './progress.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('stage'),
  canvas: $('board'),
  hud: $('hud'),
  hudLevel: $('hud-level'),
  hudName: $('hud-name'),
  hudTargets: $('hud-targets'),
  hudPrisms: $('hud-prisms'),
  hudMoves: $('hud-moves'),
  controls: $('controls'),
  toast: $('toast'),
  screenTitle: $('screen-title'),
  screenLevels: $('screen-levels'),
  screenRules: $('screen-rules'),
  screenTeach: $('screen-teach'),
  screenWin: $('screen-win'),
  levelGrid: $('level-grid'),
  teachTitle: $('teach-title'),
  teachBody: $('teach-body'),
  teachArt: $('teach-art'),
  winName: $('win-name'),
  winStars: $('win-stars'),
  winDetail: $('win-detail'),
};

const renderer = createRenderer(el.canvas);

let progress = loadProgress();
let index = 0;
let session = null;
let toastTimer = 0;
let winTimer = 0;

/** Züge sind nicht mehr nur Drehungen – seit es Fassungen gibt auch Griffe. */
const turns = (n) => `${n} ${n === 1 ? 'Zug' : 'Züge'}`;

/* ---------- Bildschirme ---------- */

const overlays = [el.screenTitle, el.screenLevels, el.screenRules, el.screenTeach, el.screenWin];

function showOverlay(node) {
  for (const o of overlays) o.hidden = o !== node;
  // Sieg und Lehrkarte legen sich über das laufende Spiel – HUD und Bedienleiste
  // bleiben stehen, damit sich die Brettgröße darunter nicht verschiebt.
  const playing = node === null || node === el.screenWin || node === el.screenTeach;
  el.hud.hidden = !playing || !session;
  el.controls.hidden = !playing || !session;
}

const closeOverlays = () => showOverlay(null);

/* ---------- Levelauswahl ---------- */

function buildLevelGrid() {
  el.levelGrid.replaceChildren();
  levels.forEach((level, i) => {
    const done = progress[level.id];
    const open = isUnlocked(levels, i, progress);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `level-chip${done ? ' is-done' : ''}${open ? '' : ' is-locked'}`;
    btn.disabled = !open;
    btn.innerHTML = open
      ? `<span class="chip-no">${i + 1}</span>
         <span class="chip-name">${level.name}</span>
         <span class="chip-stars">${done ? '★'.repeat(done.stars) + '☆'.repeat(3 - done.stars) : '·····'}</span>`
      : `<span class="chip-no">🔒</span><span class="chip-name">verborgen</span><span class="chip-stars">·····</span>`;
    btn.addEventListener('click', () => { startLevel(i); });
    li.append(btn);
    el.levelGrid.append(li);
  });
  const stars = totalStars(levels, progress);
  el.levelGrid.dataset.stars = String(stars);
}

/* ---------- Level spielen ---------- */

function startLevel(i) {
  index = Math.max(0, Math.min(levels.length - 1, i));
  const level = levels[index];
  session = createSession(level);
  renderer.setLevel(level);
  renderer.setSession(session);
  // Erst die Bildschirme schließen, dann messen: HUD und Bedienleiste sind
  // vorher ausgeblendet und hätten die Höhe 0 – das Brett säße zu hoch.
  closeOverlays();
  updateHud();
  layout();
  // Eine neue Mechanik wird genau einmal erklärt, und zwar vor dem ersten Zug.
  if (level.teach && !hasSeenTeach(level.teach.id)) {
    showTeach(level.teach);
    return;
  }
  if (level.hint) showToast(level.hint, 6200);
  else hideToast();
}

function updateHud() {
  const level = levels[index];
  el.hudLevel.textContent = `Level ${index + 1}`;
  el.hudName.textContent = level.name;
  el.hudTargets.textContent = `◉ ${session.lit}/${level.targets.length}`;
  el.hudMoves.textContent = `↻ ${session.moves}/${level.par}`;
  el.hudTargets.classList.toggle('chip--good', session.solved);
  el.hudMoves.classList.toggle('chip--over', session.moves > level.par);

  // Prismenvorrat: gefüllte Rauten liegen bereit, hohle stecken in Fassungen.
  el.hudPrisms.hidden = level.prisms === 0;
  if (level.prisms > 0) {
    const left = session.prismsLeft;
    el.hudPrisms.textContent = '◆'.repeat(left) + '◇'.repeat(level.prisms - left);
    el.hudPrisms.title = `${left} von ${level.prisms} Prismen im Vorrat`;
    el.hudPrisms.classList.toggle('chip--empty', left === 0);
  }
}

function onTap(x, y) {
  if (!session || !el.screenWin.hidden || !el.screenTeach.hidden) return;
  audio.unlockAudio();
  const before = session.lit;
  const stock = session.prismsLeft;
  if (!cycleAt(session, x, y)) {
    audio.playBlocked();
    return;
  }
  renderer.tapAt(x, y);
  if (session.prismsLeft < stock) audio.playPlace();
  else if (session.prismsLeft > stock) audio.playLift();
  else audio.playTurn();
  if (session.lit > before) audio.playLit(session.lit - 1);
  else if (session.lit < before) audio.playUnlit();
  updateHud();
  if (session.solved) finishLevel();
}

function finishLevel() {
  const level = levels[index];
  const stars = rating(level, session.moves);
  progress = recordSolve(level.id, { stars, moves: session.moves });
  renderer.celebrate();
  audio.playWin();
  buildLevelGrid();
  clearTimeout(winTimer);
  winTimer = setTimeout(() => {
    el.winName.textContent = level.name;
    el.winStars.innerHTML = Array.from({ length: 3 }, (_, i) =>
      `<span class="star${i < stars ? ' is-on' : ''}" style="--d:${i * 120}ms">★</span>`).join('');
    el.winDetail.textContent = stars === 3
      ? `${turns(session.moves)} – der kürzeste Weg.`
      : `${turns(session.moves)} · Par ${level.par}. Kürzer geht es noch.`;
    $('btn-next').textContent = index + 1 < levels.length ? 'Weiter' : 'Zur Auswahl';
    showOverlay(el.screenWin);
  }, 900);
}

/* ---------- Lehrkarte ---------- */

function showTeach(teach) {
  el.teachTitle.textContent = teach.title;
  el.teachBody.textContent = teach.body;
  el.teachArt.innerHTML = teachArt(teach.id);
  hideToast();
  showOverlay(el.screenTeach);
}

function closeTeach() {
  const level = levels[index];
  if (level.teach) markTeachSeen(level.teach.id);
  closeOverlays();
  layout();
  if (level.hint) showToast(level.hint, 6200);
}

/* ---------- Hinweise ---------- */

function showToast(text, ms = 4000) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  el.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  el.toast.classList.remove('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 320);
}

/** Wie heißt das Bauteil, auf das der Tipp zeigt – samt passendem Artikel? */
function nameOf(device, state) {
  if (device.kind === 'mirror') return 'dem markierten Spiegel';
  if (device.kind === 'prism') return 'dem markierten Prisma';
  return state === null ? 'der markierten Fassung' : 'dem markierten Prisma';
}

/**
 * Tipp: Der Solver rechnet von der *aktuellen* Stellung aus und nennt ein
 * Bauteil, das noch dran ist – plus die Zahl der verbleibenden Züge.
 */
function giveHint() {
  if (!session) return;
  const level = levels[index];
  let solution;
  try { solution = solveFrom(level, session.config); } catch { solution = null; }
  if (!solution?.solvable || solution.moves.length === 0) {
    showToast(level.hint || 'Alle Knoten liegen auf dem Faden – fertig.', 4000);
    return;
  }
  const control = solution.moves[0];
  const device = level.controls[control];
  renderer.tapAt(device.x, device.y);
  renderer.setCursor({ x: device.x, y: device.y });
  const what = nameOf(device, device.states[session.config[control]]);
  showToast(`Noch ${turns(solution.moves.length)}. Fang mit ${what} an.`, 4500);
}

/* ---------- Größe ---------- */

function layout() {
  const rect = el.stage.getBoundingClientRect();
  const hudH = el.hud.hidden ? 0 : el.hud.offsetHeight;
  const ctrlH = el.controls.hidden ? 0 : el.controls.offsetHeight;
  renderer.resize(rect.width, rect.height, {
    top: hudH + 8,
    bottom: ctrlH + 8,
    left: 8,
    right: 8,
  });
}

/* ---------- Eingabe ---------- */

createInput(el.canvas, {
  getLayout: () => renderer.layout,
  getLevel: () => (session ? session.level : null),
  onTap,
  onHover: (cell) => renderer.setHover(cell),
  onCursor: (cell) => renderer.setCursor(cell),
  onAction: (name) => {
    if (!session) return;
    if (name === 'reset') doReset();
    if (name === 'undo') doUndo();
    if (name === 'hint') giveHint();
    if (name === 'menu') openLevels();
  },
});

function doUndo() {
  if (!session || session.history.length === 0) return;
  audio.unlockAudio();
  undo(session);
  audio.playTurn();
  updateHud();
}

function doReset() {
  if (!session) return;
  audio.unlockAudio();
  resetSession(session);
  audio.playTurn();
  updateHud();
}

function openLevels() {
  buildLevelGrid();
  showOverlay(el.screenLevels);
}

/* ---------- Knöpfe ---------- */

$('btn-play').addEventListener('click', () => {
  audio.unlockAudio();
  if (!hasSeenRules()) {
    markRulesSeen();
    showOverlay(el.screenRules);
    return;
  }
  startLevel(nextOpenIndex(levels, progress));
});
$('btn-rules').addEventListener('click', () => { markRulesSeen(); showOverlay(el.screenRules); });
$('btn-rules-close').addEventListener('click', () => {
  if (session) closeOverlays(); else startLevel(nextOpenIndex(levels, progress));
});
$('btn-teach-close').addEventListener('click', closeTeach);
$('btn-menu').addEventListener('click', openLevels);
$('btn-help').addEventListener('click', () => showOverlay(el.screenRules));
$('btn-levels-close').addEventListener('click', () => {
  if (session) closeOverlays(); else showOverlay(el.screenTitle);
});
$('btn-undo').addEventListener('click', doUndo);
$('btn-reset').addEventListener('click', doReset);
$('btn-hint').addEventListener('click', giveHint);
$('btn-again').addEventListener('click', () => startLevel(index));
$('btn-next').addEventListener('click', () => {
  if (index + 1 < levels.length) startLevel(index + 1);
  else openLevels();
});

/* ---------- Start ---------- */

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
new ResizeObserver(layout).observe(el.stage);

buildLevelGrid();
layout();
showOverlay(el.screenTitle);

let raf = 0;
const loop = (now) => { renderer.frame(now); raf = requestAnimationFrame(loop); };
raf = requestAnimationFrame(loop);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(raf);
  else raf = requestAnimationFrame(loop);
});
