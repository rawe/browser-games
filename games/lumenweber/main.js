// Lumenweber – Verdrahtung von Logik, Darstellung und Bedienung.
//
// Die Spiellogik liegt vollständig in `game.js`/`beam.js` und weiß nichts vom
// DOM. Hier kommt nur zusammen, was der Browser beisteuert: Canvas, Eingabe,
// Bildschirme, Fortschritt.

import { levels } from './levels.js';
import { createSession, toggleAt, undo, resetSession, rating } from './game.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { solveFrom } from './sim/solver.js';
import {
  loadProgress, recordSolve, isUnlocked, nextOpenIndex, totalStars,
  hasSeenRules, markRulesSeen,
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
  hudMoves: $('hud-moves'),
  controls: $('controls'),
  toast: $('toast'),
  screenTitle: $('screen-title'),
  screenLevels: $('screen-levels'),
  screenRules: $('screen-rules'),
  screenWin: $('screen-win'),
  levelGrid: $('level-grid'),
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
let litBefore = 0;

/* ---------- Bildschirme ---------- */

const overlays = [el.screenTitle, el.screenLevels, el.screenRules, el.screenWin];

function showOverlay(node) {
  for (const o of overlays) o.hidden = o !== node;
  const playing = node === null || node === el.screenWin;
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
  litBefore = session.lit;
  renderer.setLevel(level);
  renderer.setSession(session);
  // Erst die Bildschirme schließen, dann messen: HUD und Bedienleiste sind
  // vorher ausgeblendet und hätten die Höhe 0 – das Brett säße zu hoch.
  closeOverlays();
  updateHud();
  layout();
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
}

function onTap(x, y) {
  if (!session || !el.screenWin.hidden) return;
  audio.unlockAudio();
  const before = session.lit;
  if (!toggleAt(session, x, y)) {
    audio.playBlocked();
    return;
  }
  renderer.tapAt(x, y);
  audio.playTurn();
  if (session.lit > before) audio.playLit(session.lit - 1);
  else if (session.lit < before) audio.playUnlit();
  litBefore = session.lit;
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
      ? `${session.moves} Drehungen – der kürzeste Weg.`
      : `${session.moves} Drehungen · Par ${level.par}. Kürzer geht es noch.`;
    $('btn-next').textContent = index + 1 < levels.length ? 'Weiter' : 'Zur Auswahl';
    showOverlay(el.screenWin);
  }, 900);
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

/**
 * Tipp: Der Solver rechnet von der *aktuellen* Stellung aus und nennt einen
 * Spiegel, der noch gedreht gehört – plus die Zahl der verbleibenden Züge.
 */
function giveHint() {
  if (!session) return;
  const level = levels[index];
  let solution;
  try { solution = solveFrom(level, session.orientations); } catch { solution = null; }
  if (!solution?.solvable || solution.moves.length === 0) {
    showToast(level.hint || 'Alle Knoten liegen auf dem Faden – fertig.', 4000);
    return;
  }
  const mirror = level.mirrors[solution.moves[0]];
  renderer.tapAt(mirror.x, mirror.y);
  renderer.setCursor({ x: mirror.x, y: mirror.y });
  const rest = solution.moves.length;
  showToast(
    `Noch ${rest} ${rest === 1 ? 'Drehung' : 'Drehungen'}. Fang mit dem markierten Spiegel an.`,
    4500,
  );
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
