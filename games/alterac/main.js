// Einstiegspunkt: Bildschirm-Ablauf (Setup → Planung → Simulation → Ergebnis),
// Render-Schleife und Simulationssteuerung.

import { createMap, FACTIONS, enemyOf } from './map.js';
import {
  DEFAULT_CONFIG,
  TEMPO_OPTIONS,
  RESPAWN_OPTIONS,
  BOSS_OPTIONS,
} from './config.js';
import { createSim } from './sim.js';
import { createRenderer } from './render.js';
import { createPlanner } from './planner.js';
import { aiPlan } from './ai.js';

const map = createMap();
const canvas = document.getElementById('map');
const renderer = createRenderer(canvas, map);

const setupEl = document.getElementById('screen-setup');
const gameEl = document.getElementById('screen-game');
const panelEl = document.getElementById('panel');
const overlayEl = document.getElementById('overlay');
const overlayCard = document.getElementById('overlay-card');

let config = { ...DEFAULT_CONFIG };
let mode = 'cpu';
let plans = { blue: null, red: null };
let planner = null;
let sim = null;
let speed = 1;
let paused = false;
let resultShown = false;
let lastLogCount = 0;

const view = { phase: 'setup', planning: null, sim: null, config };

// ------------------------------------------------------------------ Setup-Formular
function fillSelect(el, options, selectedValue) {
  el.innerHTML = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value ?? o.edgeTime);
    opt.textContent = o.label;
    if ((o.value ?? o.edgeTime) === selectedValue) opt.selected = true;
    el.appendChild(opt);
  }
}

const unitsInput = document.getElementById('opt-units');
const unitsOut = document.getElementById('opt-units-out');
unitsInput.addEventListener('input', () => (unitsOut.textContent = unitsInput.value));
fillSelect(document.getElementById('opt-tempo'), TEMPO_OPTIONS, DEFAULT_CONFIG.edgeTime);
fillSelect(document.getElementById('opt-respawn'), RESPAWN_OPTIONS, DEFAULT_CONFIG.respawnTime);
fillSelect(document.getElementById('opt-boss'), BOSS_OPTIONS, DEFAULT_CONFIG.bossHp);

document.getElementById('setup-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  config = {
    ...DEFAULT_CONFIG,
    units: Number(unitsInput.value),
    edgeTime: Number(document.getElementById('opt-tempo').value),
    respawnTime: Number(document.getElementById('opt-respawn').value),
    bossHp: Number(document.getElementById('opt-boss').value),
  };
  view.config = config;
  mode = document.getElementById('opt-mode').value;
  plans = { blue: null, red: null };
  startPlanning('blue');
});

// ------------------------------------------------------------------ Phasenwechsel
function showScreen(phase) {
  setupEl.hidden = phase === 'setup' ? false : true;
  gameEl.hidden = phase === 'setup';
  document.body.classList.toggle('phase-plan', phase === 'plan');
  document.body.classList.toggle('phase-sim', phase === 'sim');
  view.phase = phase;
}

function startPlanning(faction) {
  showScreen('plan');
  view.sim = null;
  sim = null;
  renderer.resize();
  planner = createPlanner({
    map,
    faction,
    unitCount: config.units,
    panel: panelEl,
    canvas,
    renderer,
    onConfirm: (orders) => {
      plans[faction] = orders;
      planner = null;
      view.planning = null;
      if (faction === 'blue') {
        if (mode === 'cpu') {
          plans.red = aiPlan(config.units, map, 'red');
          startSim();
        } else {
          showHandover('red', () => startPlanning('red'));
        }
      } else {
        startSim();
      }
    },
  });
  view.planning = planner.state;
  // Zur eigenen Basis scrollen (blau unten, rot oben).
  requestAnimationFrame(() => {
    window.scrollTo({ top: faction === 'blue' ? document.body.scrollHeight : 0 });
  });
}

function showHandover(nextFaction, next) {
  const fac = FACTIONS[nextFaction];
  overlayCard.innerHTML = `
    <div class="overlay-emoji">🤝</div>
    <h2>Gerät weitergeben</h2>
    <p>Jetzt plant <strong style="color:${fac.color}">${fac.name}</strong> (${fac.player}).<br>
    Die Planung der Gegenseite bleibt geheim.</p>
    <button class="btn primary" id="btn-next" style="--fac:${fac.color};--fac-dark:${fac.dark}">Bereit</button>
  `;
  overlayEl.hidden = false;
  document.getElementById('btn-next').addEventListener('click', () => {
    overlayEl.hidden = true;
    next();
  });
}

// ------------------------------------------------------------------ Simulation
function startSim() {
  sim = createSim({ map, config, plans });
  view.sim = sim;
  speed = 1;
  paused = false;
  resultShown = false;
  lastLogCount = 0;
  showScreen('sim');
  renderer.resize();
  buildSimPanel();
  requestAnimationFrame(() => {
    window.scrollTo({ top: (document.body.scrollHeight - innerHeight) / 2 });
  });
}

function buildSimPanel() {
  panelEl.innerHTML = `
    <div class="sim-controls">
      <button class="btn ghost" id="btn-pause">⏸</button>
      <div class="speed-group" id="speed-group">
        <button class="btn ghost speed active" data-s="1">1×</button>
        <button class="btn ghost speed" data-s="2">2×</button>
        <button class="btn ghost speed" data-s="4">4×</button>
      </div>
      <span class="sim-clock" id="sim-clock">0:00</span>
    </div>
    <div class="ticker" id="ticker"><p class="muted">Die Schlacht beginnt …</p></div>
  `;
  document.getElementById('btn-pause').addEventListener('click', (ev) => {
    paused = !paused;
    ev.currentTarget.textContent = paused ? '▶' : '⏸';
  });
  document.getElementById('speed-group').addEventListener('click', (ev) => {
    const b = ev.target.closest('.speed');
    if (!b) return;
    speed = Number(b.dataset.s);
    for (const el of panelEl.querySelectorAll('.speed')) el.classList.toggle('active', el === b);
  });
}

function fmtTime(t) {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateSimPanel() {
  const clock = document.getElementById('sim-clock');
  if (clock) clock.textContent = fmtTime(sim.time);
  if (sim.log.length !== lastLogCount) {
    lastLogCount = sim.log.length;
    const ticker = document.getElementById('ticker');
    if (ticker) {
      ticker.innerHTML = sim.log
        .slice(-3)
        .map((e) => `<p><span class="t">${fmtTime(e.t)}</span> ${e.text}</p>`)
        .join('');
    }
  }
}

function showResult() {
  resultShown = true;
  const r = sim.result;
  let title;
  let emoji;
  if (r.winner === 'draw') {
    emoji = '🤝';
    title = 'Unentschieden';
  } else {
    emoji = '🏆';
    title = `${FACTIONS[r.winner].name} siegt!`;
  }
  overlayCard.innerHTML = `
    <div class="overlay-emoji">${emoji}</div>
    <h2 ${r.winner !== 'draw' ? `style="color:${FACTIONS[r.winner].color}"` : ''}>${title}</h2>
    <p>${r.reason}</p>
    <div class="overlay-buttons">
      <button class="btn primary" id="btn-rematch">Revanche</button>
      <button class="btn ghost" id="btn-new">Neue Einstellungen</button>
    </div>
  `;
  overlayEl.hidden = false;
  document.getElementById('btn-rematch').addEventListener('click', () => {
    overlayEl.hidden = true;
    plans = { blue: null, red: null };
    startPlanning('blue');
  });
  document.getElementById('btn-new').addEventListener('click', () => {
    overlayEl.hidden = true;
    view.sim = null;
    sim = null;
    showScreen('setup');
    window.scrollTo({ top: 0 });
  });
}

// ------------------------------------------------------------------ Render-Schleife
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (view.phase === 'sim' && sim) {
    if (!paused && !sim.result) sim.advance(dt * speed);
    updateSimPanel();
    if (sim.result && !resultShown) showResult();
  }
  if (view.phase !== 'setup') renderer.draw(view, dt);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  if (view.phase !== 'setup') renderer.resize();
});

// Testeinstieg für Entwicklung: ?test=sim startet direkt eine CPU-Schlacht.
const params = new URLSearchParams(location.search);
if (params.get('test') === 'sim') {
  mode = 'cpu';
  plans.blue = aiPlan(config.units, map, 'blue', () => 0.3);
  plans.red = aiPlan(config.units, map, 'red', () => 0.8);
  startSim();
} else if (params.get('test') === 'plan') {
  startPlanning('blue');
}

requestAnimationFrame(frame);
