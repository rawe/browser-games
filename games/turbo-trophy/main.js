// Einstiegspunkt: Spielzustände (Titel → Werkstatt → Rennen → Ergebnis)
// verdrahten und die feste 60-Hz-Schleife antreiben.

import { tracks } from './tracks.js';
import { createCareer, applyResult, buyItem, buyRepair, buyUpgrade, QUALIFY_PLACES } from './career.js';
import { createRace, playerCar, standings, stepRace, useItem } from './race.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createScreens, ITEM_BUY_PREFIX } from './screens.js';
import { createEditor } from './editor.js';
import { elementsFor } from './trackStorage.js';

const STEP_MS = 1000 / 60;

const renderer = createRenderer(document.getElementById('scene'), document.getElementById('minimap'));
const screens = createScreens(document.getElementById('overlay'));
const hud = createHud();
const audio = createAudio();
const testExitBtn = document.getElementById('test-exit');

let career = createCareer();
let race = null;
let testing = false; // Testfahrt aus dem Editor – ohne Folgen für die Karriere
let mode = 'title'; // title | shop | race | results | champion | editor

const input = createInput({
  onUse: (id) => {
    // Der Sound hängt am Renn-Event, damit Spieler und KI gleich klingen.
    if (mode === 'race' && race) useItem(race, playerCar(race), id);
  },
  onActivate: () => audio.unlock(),
  isRacing: () => mode === 'race',
  onLatch: (latched) => hud.setThrottleLatched(latched && mode === 'race'),
});

const editor = createEditor({
  host: document.getElementById('editor'),
  tracks,
  onExit: () => { editor.close(); showTitle(); },
  onTest: (stage) => { audio.unlock(); startTestDrive(stage); },
});

window.addEventListener('resize', () => renderer.resize());

/* ---------- Zustandswechsel ---------- */
function setDifficulty(id) {
  career.difficulty = id;
}

function showTitle() {
  mode = 'title';
  hud.clear();
  hud.showCareerAmmo(career);
  screens.title({
    audio,
    difficulty: career.difficulty,
    onDifficulty: (id) => { setDifficulty(id); showTitle(); },
    onStart: () => { audio.unlock(); showShop(); },
    onEditor: () => { audio.unlock(); showEditor(); },
  });
}

function showEditor() {
  mode = 'editor';
  race = null;
  hud.clear();
  screens.hide();
  editor.open();
}

function buy(kind) {
  const bought = kind === 'repair' ? buyRepair(career)
    : kind.startsWith(ITEM_BUY_PREFIX) ? buyItem(career, kind.slice(ITEM_BUY_PREFIX.length))
    : buyUpgrade(career, kind);
  if (!bought) return;
  audio.cash();
  hud.showCareerAmmo(career);
}

function showShop() {
  mode = 'shop';
  hud.showCareerAmmo(career);
  screens.shop({
    career,
    track: tracks[career.stage],
    onBuy: buy,
    onDifficulty: setDifficulty,
    onStart: () => { audio.unlock(); startRace(); },
  });
}

/** Streckendefinition samt der im Editor gespeicherten Elemente. */
function raceDef(stage) {
  const def = tracks[stage];
  return { ...def, elements: elementsFor(def) };
}

function startRace() {
  race = createRace(raceDef(career.stage), career);
  testing = false;
  input.reset();
  hud.clear();
  screens.hide();
  editor.close();
  renderer.resize();
  mode = 'race';
}

/** Probefahrt aus dem Editor: eigene Karriere-Kopie, kein Preisgeld, kein Aufstieg. */
function startTestDrive(stage) {
  race = createRace(raceDef(stage), { ...createCareer(career.difficulty), stage });
  testing = true;
  input.reset();
  hud.clear();
  screens.hide();
  editor.close();
  testExitBtn.classList.remove('hidden');
  renderer.resize();
  mode = 'race';
}

function endTestDrive() {
  testing = false;
  race = null;
  input.reset();
  testExitBtn.classList.add('hidden');
  showEditor();
}

function endRace() {
  const order = standings(race);
  const me = playerCar(race);
  const place = order.indexOf(me);
  const prize = applyResult(career, { place, car: me });
  const qualified = place < QUALIFY_PLACES;
  const isFinalStage = career.stage >= tracks.length - 1;

  input.reset();
  hud.clear();
  hud.showCareerAmmo(career);
  if (qualified) audio.cash();

  if (qualified && isFinalStage) {
    mode = 'champion';
    screens.champion({
      career,
      onRestart: () => { career = createCareer(career.difficulty); showShop(); },
    });
    return;
  }

  mode = 'results';
  screens.results({
    career,
    result: { order, place, prize, qualified, trackName: race.track.def.name },
    onNext: () => {
      audio.unlock();
      if (qualified) career.stage++;
      showShop();
    },
  });
}

/* ---------- Schleife ---------- */
const SOUNDS = {
  fire: audio.fire, boom: audio.explosion, beep: audio.beep, go: audio.go,
  // Streckenelemente – unbekannte Ereignisse bleiben stumm.
  jump: audio.jump, land: audio.land, skid: audio.skid,
  // Arsenal
  homing: audio.homing, turbo: audio.turbo, ram: audio.ram, drop: audio.drop,
};

let lastFrame = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(120, now - lastFrame);
  lastFrame = now;

  if (mode !== 'race' || !race) {
    accumulator = 0;
    return;
  }

  accumulator += elapsed;
  while (accumulator >= STEP_MS && !race.over) {
    accumulator -= STEP_MS;
    stepRace(race, input.controls);
  }

  for (const event of race.events) {
    SOUNDS[event.type]?.();
    if (event.type === 'go') hud.flash('LOS!', 700);
  }
  race.events.length = 0;

  hud.update(race);
  renderer.draw(race);
  if (race.over) {
    if (testing) endTestDrive();
    else endRace();
  }
}

testExitBtn.addEventListener('click', endTestDrive);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && testing) endTestDrive();
});

showTitle();
requestAnimationFrame(frame);
