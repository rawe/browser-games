// Lumenweber – Verdrahtung von Logik, Darstellung und Bedienung.
//
// Die Spiellogik liegt vollständig in `game.js`/`beam.js`/`optics.js` und weiß
// nichts vom DOM. Hier kommt nur zusammen, was der Browser beisteuert: Canvas,
// Eingabe, Bildschirme, Fortschritt.

import { levels } from './levels.js';
import { parseLevel } from './level.js';
import { createSession, cycleAt, undo, resetSession, rating } from './game.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { solveFrom } from './sim/solver.js';
import { teachArt } from './teach.js';
import { WANTS, nodeCss } from './nodes.js';
import { legendList } from './legend.js';
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
  legend: $('legend'),
  legendBody: $('legend-body'),
  rulesLegend: $('rules-legend'),
  controls: $('controls'),
  toast: $('toast'),
  screenTitle: $('screen-title'),
  screenLevels: $('screen-levels'),
  screenRules: $('screen-rules'),
  screenTeach: $('screen-teach'),
  screenWin: $('screen-win'),
  screenStudio: $('screen-studio'),
  screenCheck: $('screen-check'),
  screenShare: $('screen-share'),
  screenImport: $('screen-import'),
  screenShared: $('screen-shared'),
  editorBar: $('editor-bar'),
  editorTools: $('editor-tools'),
  btnToEditor: $('btn-to-editor'),
  levelGrid: $('level-grid'),
  teachTitle: $('teach-title'),
  teachBody: $('teach-body'),
  teachArt: $('teach-art'),
  winName: $('win-name'),
  winStars: $('win-stars'),
  winDetail: $('win-detail'),
};

const renderer = createRenderer(el.canvas);

// `?level=7` springt direkt in ein eingebautes Level und öffnet dabei das ganze
// Gitter – zum Durchtesten. Bewusst nur numerisch: geteilte Level bringen ihre
// Daten im Fragment mit (`#geteilt=<code>`, siehe `editor/share.js`) und
// kollidieren so nicht. Der eigene Schlüsselname ist Absicht – „level“ hieße
// hier eine Nummer und dort ein ganzes Level.
const devLevel = (() => {
  const n = Number(new URLSearchParams(location.search).get('level'));
  return Number.isInteger(n) && n >= 1 && n <= levels.length ? n - 1 : null;
})();

let progress = loadProgress();
let index = 0;
let session = null;
let toastTimer = 0;
let winTimer = 0;

/**
 * Woher stammt das laufende Level?
 *
 * Davon hängt ab, was ein Sieg bedeutet und wohin „Weiter“ führt:
 *
 *   'campaign'  eines der 30 eingebauten – schreibt in den Fortschritt
 *   'studio'    ein eigenes aus der Bibliothek – schreibt in die Bibliothek
 *   'test'      Probelauf aus dem Editor – schreibt gar nichts
 *   'shared'    aus einem Link – schreibt gar nichts, bis jemand es übernimmt
 *
 * Die drei letzten fassen den Fortschritt der Kampagne nie an. Das ist keine
 * Bequemlichkeit, sondern die Zusage, dass ein fremder Link nichts anrichtet.
 */
let context = { kind: 'campaign' };

/** Erst geladen, wenn jemand „Eigene Level“ antippt (eigenes Bündel). */
let studio = null;

/** Züge sind nicht mehr nur Drehungen – seit es Fassungen gibt auch Griffe. */
const turns = (n) => `${n} ${n === 1 ? 'Zug' : 'Züge'}`;

/**
 * Die Zeile unter der Zugzahl, wenn es keinen Par-Wert gibt.
 *
 * Der Bestwert ist keine bewiesene Untergrenze, sondern die bisher kürzeste
 * gespielte Lösung – der Text sagt deshalb „bisher“ und nie „am kürzesten“.
 */
function recordLine(moves, previousBest) {
  if (previousBest === null || previousBest === undefined) {
    return `${turns(moves)}. Der erste Bestwert für dieses Level.`;
  }
  if (moves < previousBest) return `${turns(moves)} – bisher waren es ${previousBest}. Neuer Bestwert.`;
  if (moves === previousBest) return `${turns(moves)} – genau der Bestwert. Kürzer war bisher niemand.`;
  return `${turns(moves)} · der Bestwert steht bei ${previousBest}.`;
}

/* ---------- Bildschirme ---------- */

const overlays = [
  el.screenTitle, el.screenLevels, el.screenRules, el.screenTeach, el.screenWin,
  el.screenStudio, el.screenCheck, el.screenShare, el.screenImport, el.screenShared,
];

/**
 * Zwei Betriebsarten teilen sich dieselbe Bühne.
 *
 * `play` zeigt HUD und Bedienleiste, `editor` stattdessen Kopfleiste und
 * Werkzeuge. Das Brett darunter ist beide Male dasselbe Canvas mit demselben
 * Renderer – genau deshalb ist der Weg vom Bauen ins Testen ein Tastendruck und
 * kein Seitenwechsel.
 */
let mode = 'play';

function setMode(next) {
  mode = next;
  showOverlay(null);
}

function showOverlay(node) {
  for (const o of overlays) o.hidden = o !== node;
  // Sieg und Lehrkarte legen sich über das laufende Spiel – HUD und Bedienleiste
  // bleiben stehen, damit sich die Brettgröße darunter nicht verschiebt.
  const open = node === null || node === el.screenWin || node === el.screenTeach;
  const playing = open && mode === 'play' && !!session;
  const building = open && mode === 'editor';
  el.hud.hidden = !playing;
  el.controls.hidden = !playing;
  el.editorBar.hidden = !building;
  el.editorTools.hidden = !building;
  syncLegend();
  layout();
}

const closeOverlays = () => showOverlay(null);

const anyOverlayOpen = () => overlays.some((o) => !o.hidden);

/* ---------- Levelauswahl ---------- */

function buildLevelGrid() {
  el.levelGrid.replaceChildren();
  levels.forEach((level, i) => {
    const done = progress[level.id];
    const open = devLevel !== null || isUnlocked(levels, i, progress);
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
  playLevel(levels[index], { kind: 'campaign' });
}

/**
 * Ein Level spielen – gleich welcher Herkunft.
 *
 * Die Sitzungslogik unterscheidet nicht zwischen eingebauten und selbstgebauten
 * Leveln; ein Level ist ein Level. Nur was ein Sieg *bedeutet*, hängt am
 * Kontext, und das entscheidet `finishLevel`.
 */
function playLevel(level, ctx) {
  context = ctx;
  session = createSession(level);
  renderer.setLevel(level);
  renderer.setSession(session);
  // Erst die Bildschirme schließen, dann messen: HUD und Bedienleiste sind
  // vorher ausgeblendet und hätten die Höhe 0 – das Brett säße zu hoch.
  setMode('play');
  el.btnToEditor.hidden = ctx.kind !== 'test';
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

/** Überschrift des laufenden Levels – „Level 7“ gibt es nur in der Kampagne. */
const contextTitle = {
  campaign: () => `Level ${index + 1}`,
  studio: () => 'Eigenes Level',
  test: () => 'Probelauf',
  shared: () => 'Geteiltes Level',
};

function updateHud() {
  const level = session.level;
  el.hudLevel.textContent = (contextTitle[context.kind] ?? contextTitle.campaign)();
  el.hudName.textContent = level.name;
  el.hudTargets.textContent = `◉ ${session.lit}/${level.targets.length}`;
  el.hudTargets.classList.toggle('chip--good', session.solved);

  // Ohne belastbares Par gibt es keinen Vergleichswert – dann zählt die
  // Anzeige einfach Züge, statt sie an einer Zahl zu messen, die niemand
  // geprüft hat.
  const par = level.par ?? null;
  el.hudMoves.textContent = par ? `↻ ${session.moves}/${par}` : `↻ ${session.moves}`;
  el.hudMoves.title = par ? 'Züge / Par' : 'Züge – für dieses Level gibt es kein geprüftes Par';
  el.hudMoves.classList.toggle('chip--over', Boolean(par) && session.moves > par);

  // Prismenvorrat: gefüllte Rauten liegen bereit, hohle stecken in Fassungen.
  el.hudPrisms.hidden = level.prisms === 0;
  if (level.prisms > 0) {
    const left = session.prismsLeft;
    el.hudPrisms.textContent = '◆'.repeat(left) + '◇'.repeat(level.prisms - left);
    el.hudPrisms.title = `${left} von ${level.prisms} Prismen im Vorrat`;
    el.hudPrisms.classList.toggle('chip--empty', left === 0);
  }

  updateLegend();
}

/* ---------- Legende ---------- */
//
// Die Frage „welche Farbe braucht dieser Knoten?“ ist beim Lösen keine
// Regelfrage, sondern eine Nachschlagefrage – sie darf nicht kosten, dass man
// das Brett verlässt. Deshalb liegt die Legende neben dem Brett und nimmt ihm
// Platz weg, statt ihn zu verdecken: Man sieht Legende und Knoten gleichzeitig.
//
// Gezeigt wird nur, was in diesem Level wirklich vorkommt. Eine Legende, die
// vier Zeilen zeigt, wo zwei Knotenarten liegen, ist wieder Suchen.

let legendOpen = false;

/** Knotenarten dieses Levels mit Zählerstand: wie viele leuchten schon? */
function legendCounts() {
  const counts = {};
  for (const t of session.level.targets) {
    const c = counts[t.want] ?? (counts[t.want] = { lit: 0, total: 0 });
    c.total += 1;
    if (session.trace.litTargets.has(`${t.x},${t.y}`)) c.lit += 1;
  }
  return counts;
}

function updateLegend() {
  if (!session || el.legend.hidden) return;
  const counts = legendCounts();
  el.legendBody.innerHTML = legendList(WANTS.filter((w) => counts[w]), counts);
}

/** Sichtbar ist die Legende nur, wenn sie offen *und* das Brett bedienbar ist. */
function syncLegend() {
  const show = legendOpen && !!session && !el.hud.hidden;
  el.legend.hidden = !show;
  el.hudTargets.setAttribute('aria-expanded', String(show));
}

function setLegend(open) {
  legendOpen = open;
  syncLegend();
  updateLegend();
  layout();
}

function onTap(x, y) {
  // Im Editor ist ein Tipp aufs Brett kein Zug, sondern ein Pinselstrich.
  if (mode === 'editor') {
    if (!anyOverlayOpen()) studio?.tap(x, y);
    return;
  }
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

/**
 * Gelöst – und was das jeweils heißt.
 *
 * In der Kampagne gibt es Sterne, denn dort ist `par` die vom Löser bestimmte
 * Mindestzahl an Zügen (`sim/solver.js`, abgenommen von `check:lumen`).
 *
 * Selbstgebaute und geteilte Level haben kein Par und bekommen deshalb auch
 * keine Sterne, sondern einen **Bestwert**: die kürzeste Zugzahl, die bisher
 * jemand geschafft hat. Der erste Eintrag stammt aus dem Probelauf des
 * Erstellers – der ist zugleich der Nachweis, dass das Level überhaupt lösbar
 * ist. Wer ihn unterbietet, schreibt ihn fort.
 */
function finishLevel() {
  const level = session.level;
  const moves = session.moves;
  const stars = rating(level, moves);
  let previousBest = null;

  if (context.kind === 'campaign') {
    progress = recordSolve(level.id, { stars, moves });
    buildLevelGrid();
  } else if (context.kind === 'studio' && context.id) {
    previousBest = studio?.recordSolve(context.id, moves) ?? null;
  } else if (context.kind === 'test') {
    previousBest = studio?.noteSolved(moves) ?? null;
  } else if (context.kind === 'shared') {
    previousBest = studio?.noteSharedSolved(moves) ?? null;
  }

  renderer.celebrate();
  audio.playWin();
  clearTimeout(winTimer);
  winTimer = setTimeout(() => showWin({ level, moves, stars, previousBest }), 900);
}

function showWin({ level, moves, stars, previousBest }) {
  el.winName.textContent = level.name;

  if (Number.isInteger(stars)) {
    el.winStars.innerHTML = Array.from({ length: 3 }, (_, i) =>
      `<span class="star${i < stars ? ' is-on' : ''}" style="--d:${i * 120}ms">★</span>`).join('');
    el.winDetail.textContent = stars === 3
      ? `${turns(moves)} – der kürzeste Weg.`
      : `${turns(moves)} · Par ${level.par}. Kürzer geht es noch.`;
  } else {
    // Kein Par, also keine Sterne – ein Stern behauptet Optimalität, und die
    // kennt hier niemand. Stattdessen die Zahl selbst, groß, und daneben, wie
    // sie sich zum bisher kürzesten Weg verhält.
    const better = previousBest === null || moves < previousBest;
    el.winStars.innerHTML = `<span class="win-moves${better ? ' is-record' : ''}">${moves}</span>`;
    el.winDetail.textContent = recordLine(moves, previousBest);
  }

  const next = $('btn-next');
  if (context.kind === 'campaign') next.textContent = index + 1 < levels.length ? 'Weiter' : 'Zur Auswahl';
  else if (context.kind === 'test') next.textContent = '✎ Weiterbauen';
  else if (context.kind === 'shared') next.textContent = 'Übernehmen';
  else next.textContent = 'Zur Bibliothek';

  showOverlay(el.screenWin);
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
  const level = session.level;
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

/** Höhe einer Leiste – 0, wenn sie ausgeblendet ist. */
const barHeight = (node) => (node.hidden ? 0 : node.offsetHeight);

function layout() {
  const rect = el.stage.getBoundingClientRect();
  // Spiel und Editor teilen sich Ober- und Unterkante: Es ist immer höchstens
  // eine der beiden Kopfleisten und eine der beiden Fußleisten sichtbar.
  const hudH = barHeight(el.hud) + barHeight(el.editorBar);
  const ctrlH = barHeight(el.controls) + barHeight(el.editorTools);
  // Die offene Legende verdeckt das Brett nicht, sie nimmt ihm Platz weg – auf
  // breiten Schirmen rechts, auf schmalen unten. Sonst läge sie über genau den
  // Knoten, die sie erklärt.
  const wide = window.matchMedia('(min-width: 48rem)').matches;
  const onBoard = !el.legend.hidden;
  const legendW = onBoard && wide ? el.legend.offsetWidth + 8 : 0;
  const legendH = onBoard && !wide ? el.legend.offsetHeight + 8 : 0;
  renderer.resize(rect.width, rect.height, {
    top: hudH + 8,
    bottom: ctrlH + legendH + 8,
    left: 8,
    right: legendW + 8,
  });
}

/* ---------- Eingabe ---------- */

createInput(el.canvas, {
  getLayout: () => renderer.layout,
  // Im Editor liegt auf dem Brett der Entwurf, nicht die Sitzung. Ohne diese
  // Fallunterscheidung fände die Eingabe dort kein Raster und jeder Tipp
  // verpuffte.
  getLevel: () => (mode === 'editor' ? studio?.level ?? null : session?.level ?? null),
  onTap,
  onHover: (cell) => renderer.setHover(cell),
  onCursor: (cell) => renderer.setCursor(cell),
  onAction: (name) => {
    // Im Editor bedeuten die Spieltasten nichts – bis auf Esc, das genauso
    // hinausführt wie im Spiel.
    if (mode === 'editor') {
      if (name === 'menu') studio?.openLibrary();
      return;
    }
    if (!session) return;
    if (name === 'reset') doReset();
    if (name === 'undo') doUndo();
    if (name === 'hint') giveHint();
    if (name === 'legend') setLegend(!legendOpen);
    // Aus dem Probelauf führt Esc zurück ans Bauen, nicht in die Levelauswahl.
    if (name === 'menu') { if (context.kind === 'test') backToEditor(); else openLevels(); }
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

/* ---------- Editor ---------- */
//
// Der Editor kommt als eigenes Bündel und wird erst geholt, wenn ihn jemand
// haben will. Wer nur die Kampagne spielt, lädt weder Editor noch Löser.

/** Was der Editor vom Rahmen braucht – mehr Berührung gibt es nicht. */
const host = {
  renderer,
  relayout: layout,
  toast: showToast,
  setMode,
  showOverlay,
  /** Aus der Bibliothek oder dem Editor heraus ein Level anspielen. */
  playDraft(level, meta) {
    playLevel(level, {
      kind: meta.fromEditor ? 'test' : 'studio',
      id: meta.id,
      best: meta.best ?? null,
    });
  },
  /** Ein geteiltes Level anspielen – ohne jede Spur im Speicher. */
  playShared(draft) {
    playLevel(sharedLevel(draft), { kind: 'shared', draft });
  },
  /** Der Empfänger will das geteilte Level nicht. */
  leaveShared() {
    clearShareFragment();
    showOverlay(session ? null : el.screenTitle);
  },
  leaveStudio() {
    setMode('play');
    showOverlay(session ? null : el.screenTitle);
  },
  clearShareFragment,
};

async function withStudio() {
  if (!studio) {
    const mod = await import('./editor/index.js');
    studio = mod.createStudio(host);
  }
  return studio;
}

async function openStudio() {
  showToast('Editor wird geladen …', 1200);
  (await withStudio()).openLibrary();
}

/** Zurück aus dem Probelauf ins Bauen – ein Griff, kein Umweg. */
function backToEditor() {
  clearTimeout(winTimer);
  session = null;
  studio?.resume();
}

/* ---------- Geteilte Level ---------- */

/** Muss zu `SHARE_KEY` in `editor/share.js` passen – hier nur zum Erkennen. */
const SHARE_KEY = 'geteilt';

function sharedLevel(draft) {
  // Kein `par` – selbstgebaute Level haben keines, und damit auch keine Sterne.
  // Die Messlatte ist der Bestwert aus dem Link, den `finishLevel` auswertet.
  return parseLevel({
    id: `geteilt-${Date.now().toString(36)}`,
    name: draft.name,
    rows: draft.rows,
    prisms: draft.prisms,
    par: null,
  }, { validate: false });
}

/** Fragment leeren, ohne einen Eintrag in der Verlaufsliste zu hinterlassen. */
function clearShareFragment() {
  history.replaceState(null, '', location.pathname + location.search);
}

/**
 * Beim Laden ein geteiltes Level anbieten.
 *
 * Es wird angeboten, nicht ausgeführt: Ein Link darf auf einem fremden Gerät
 * keine stille Nebenwirkung haben. Erst ein Tipp auf „Spielen“ oder
 * „Übernehmen“ tut etwas – und Übernehmen legt immer einen neuen Eintrag an.
 */
async function offerSharedFromUrl() {
  // Erst die billige Frage – ohne Fragment wird der Editor gar nicht geholt.
  if (!location.hash.includes(`${SHARE_KEY}=`)) return false;

  const { readShareFragment, decodeLevel } = await import('./editor/share.js');
  const { inspect } = await import('./editor/validate.js');

  let draft;
  try {
    draft = decodeLevel(readShareFragment());
  } catch (error) {
    showToast(String(error.message ?? error), 6000);
    clearShareFragment();
    return false;
  }
  // Ein Link darf ein kaputtes Level enthalten – er darf nur nichts anrichten.
  const check = inspect(draft, 'geteilt');
  if (!check.ok) {
    showToast(`Dieses geteilte Level ist nicht spielbar: ${check.errors[0].text}`, 6500);
    clearShareFragment();
    return false;
  }
  (await withStudio()).offerShared(draft);
  return true;
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
el.hudTargets.addEventListener('click', () => setLegend(!legendOpen));
$('btn-legend-close').addEventListener('click', () => setLegend(false));
$('btn-undo').addEventListener('click', doUndo);
$('btn-reset').addEventListener('click', doReset);
$('btn-hint').addEventListener('click', giveHint);
$('btn-studio').addEventListener('click', openStudio);
el.btnToEditor.addEventListener('click', backToEditor);

$('btn-again').addEventListener('click', () => {
  if (context.kind === 'campaign') startLevel(index);
  else playLevel(session.level, context);
});

$('btn-next').addEventListener('click', () => {
  if (context.kind === 'test') { backToEditor(); return; }
  if (context.kind === 'shared') { studio?.keepShared(); return; }
  if (context.kind === 'studio') { studio?.openLibrary(); return; }
  if (index + 1 < levels.length) startLevel(index + 1);
  else openLevels();
});

/* ---------- Start ---------- */

// Die Regelseite kennt alle vier Knotenarten – sie steht auch vor dem ersten
// Level offen. Das Stylesheet bekommt die Knotenfarben von hier, damit
// palette.js die einzige Quelle bleibt und die Regelzeichen nicht abdriften.
el.rulesLegend.innerHTML = legendList(WANTS);
for (const want of WANTS) document.body.style.setProperty(`--node-${want}`, nodeCss(want));

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);

// Ein geteilter Link, der geöffnet wird, während das Spiel schon läuft, ändert
// nur das Fragment – der Browser lädt dabei nichts neu. Ohne diesen Draht
// passierte in genau diesem Fall gar nichts.
window.addEventListener('hashchange', () => { offerSharedFromUrl(); });
new ResizeObserver(layout).observe(el.stage);

buildLevelGrid();
layout();
if (devLevel !== null) startLevel(devLevel);
else {
  showOverlay(el.screenTitle);
  // Ein geteilter Link legt sich über das Titelbild – bleibt er aus, ist das
  // Titelbild schon da und niemand sieht ein Flackern.
  offerSharedFromUrl();
}

let raf = 0;
const loop = (now) => { renderer.frame(now); raf = requestAnimationFrame(loop); };
raf = requestAnimationFrame(loop);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(raf);
  else raf = requestAnimationFrame(loop);
});
