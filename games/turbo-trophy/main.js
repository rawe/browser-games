// Einstiegspunkt: Spielzustände (Titel → Werkstatt → Rennen → Ergebnis)
// verdrahten und die feste 60-Hz-Schleife antreiben.

import { tracks } from './tracks.js';
import { createCareer, applyResult, buyAmmo, buyRepair, buyUpgrade, QUALIFY_PLACES } from './career.js';
import { createRace, fire, playerCar, standings, stepRace } from './race.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createScreens } from './screens.js';

const STEP_MS = 1000 / 60;

const renderer = createRenderer(document.getElementById('scene'), document.getElementById('minimap'));
const screens = createScreens(document.getElementById('overlay'));
const hud = createHud();
const audio = createAudio();

let career = createCareer();
let race = null;
let mode = 'title'; // title | shop | race | results | champion

const input = createInput({
  onFire: (rear) => {
    // Der Sound hängt am Renn-Event, damit Spieler und KI gleich klingen.
    if (mode === 'race' && race) fire(race, playerCar(race), rear);
  },
  onActivate: () => audio.unlock(),
  isRacing: () => mode === 'race',
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
  });
}

function buy(kind) {
  const bought = kind === 'repair' ? buyRepair(career)
    : kind === 'ammoFront' ? buyAmmo(career, 'front')
    : kind === 'ammoRear' ? buyAmmo(career, 'rear')
    : buyUpgrade(career, kind);
  if (bought) audio.cash();
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

function startRace() {
  race = createRace(tracks[career.stage], career);
  input.reset();
  hud.clear();
  screens.hide();
  renderer.resize();
  mode = 'race';
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
const SOUNDS = { fire: audio.fire, boom: audio.explosion, beep: audio.beep, go: audio.go };

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
  if (race.over) endRace();
}

showTitle();
requestAnimationFrame(frame);
