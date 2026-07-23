// Einstiegspunkt: Bildschirm-Ablauf (Setup → Planung → Simulation → Ergebnis),
// Render-Schleife und Simulationssteuerung.

import { createMap, FACTIONS } from './map.js';
import {
  DEFAULT_CONFIG,
  UNIT_TYPES,
  UNIT_STAT_FIELDS,
  RESOURCE_OPTIONS,
  TEMPO_OPTIONS,
  RESPAWN_OPTIONS,
  GRAVEYARD_CAPTURE_OPTIONS,
  CONFIG_SECTIONS,
  TOWERS_ON_COUNT,
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

fillSelect(document.getElementById('opt-resources'), RESOURCE_OPTIONS, DEFAULT_CONFIG.resources);
fillSelect(document.getElementById('opt-tempo'), TEMPO_OPTIONS, DEFAULT_CONFIG.edgeTime);
fillSelect(document.getElementById('opt-respawn'), RESPAWN_OPTIONS, DEFAULT_CONFIG.respawnTime);
fillSelect(
  document.getElementById('opt-capture'),
  GRAVEYARD_CAPTURE_OPTIONS,
  DEFAULT_CONFIG.graveyardCaptureTime
);

// ---------------------------------------------- Erweiterte Einstellungen (Zahlenfelder)
// Die Felder werden datengetrieben erzeugt: je Einheitentyp eine Gruppe aus
// UNIT_STAT_FIELDS (schreibt nach config.unitStats), dazu die Boss-/Turm-Gruppen
// aus CONFIG_SECTIONS (schreiben direkt in config[key]). Prozent-Felder zeigen
// im Menü ganze Prozent, intern bleibt der Anteil (0–1) erhalten.
const towersToggle = document.getElementById('opt-towers');
const advancedGroups = document.getElementById('advanced-groups');

function fieldToDisplay(field, value) {
  return field.kind === 'percent' ? Math.round(value * 100) : value;
}

function clampField(field, displayValue) {
  return Math.min(field.max, Math.max(field.min, displayValue));
}

// Erzeugt ein beschriftetes Zahlenfeld für ein Feld-Deskriptor (CONFIG_SECTIONS
// oder UNIT_STAT_FIELDS). `id` ist die DOM-Kennung, `rawDefault` der interne
// Ausgangswert (bei Prozent 0–1), auf den leere/ungültige Eingaben zurückfallen.
function buildNumberField(field, id, rawDefault) {
  const label = document.createElement('label');
  label.className = 'num-field';
  const span = document.createElement('span');
  span.textContent = field.unit ? `${field.label} (${field.unit})` : field.label;
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.min = field.min;
  input.max = field.max;
  input.step = field.step;
  input.value = fieldToDisplay(field, rawDefault);
  // Von Hand getippte Werte beim Verlassen sofort auf den gültigen Bereich klemmen.
  input.addEventListener('change', () => {
    if (input.value === '' || Number.isNaN(input.valueAsNumber)) {
      input.value = fieldToDisplay(field, rawDefault);
      return;
    }
    input.value = clampField(field, input.valueAsNumber);
  });
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

// Feld aus dem DOM lesen, auf [min,max] klemmen und in den internen Wert wandeln.
function readNumberField(field, id, rawDefault) {
  const input = document.getElementById(id);
  let v = input.valueAsNumber;
  if (Number.isNaN(v)) v = fieldToDisplay(field, rawDefault);
  v = clampField(field, v);
  if (field.kind === 'int') v = Math.round(v);
  if (field.kind === 'percent') v = v / 100;
  return v;
}

// DOM-Kennung eines Einheiten-Statfelds (Typ × Wert).
const unitFieldId = (typeKey, statKey) => `adv-unit-${typeKey}-${statKey}`;

function buildAdvanced() {
  advancedGroups.innerHTML = '';
  // Einheitentypen zuerst: je Typ eine Gruppe mit den Statfeldern.
  for (const type of UNIT_TYPES) {
    const group = document.createElement('fieldset');
    group.className = 'advanced-group';
    const legend = document.createElement('legend');
    legend.textContent = `${type.icon} ${type.name}`;
    group.appendChild(legend);
    for (const stat of UNIT_STAT_FIELDS) {
      group.appendChild(buildNumberField(stat, unitFieldId(type.key, stat.key), type[stat.key]));
    }
    advancedGroups.appendChild(group);
  }
  // Danach die Boss-/Turm-Gruppen aus CONFIG_SECTIONS.
  for (const section of CONFIG_SECTIONS) {
    const group = document.createElement('fieldset');
    group.className = 'advanced-group';
    if (section.gate) group.dataset.gate = section.gate;
    const legend = document.createElement('legend');
    legend.textContent = section.label;
    group.appendChild(legend);
    for (const field of section.fields) {
      group.appendChild(buildNumberField(field, `adv-${field.key}`, DEFAULT_CONFIG[field.key]));
    }
    advancedGroups.appendChild(group);
  }
}

// Alle Einheiten-Statfelder auslesen → { light: {cost,hp,…}, medium: {…}, … }.
function readUnitStats() {
  const unitStats = {};
  for (const type of UNIT_TYPES) {
    unitStats[type.key] = {};
    for (const stat of UNIT_STAT_FIELDS) {
      unitStats[type.key][stat.key] = readNumberField(
        stat,
        unitFieldId(type.key, stat.key),
        type[stat.key]
      );
    }
  }
  return unitStats;
}

// Turm-Gruppen ausgrauen und deaktivieren, solange der Türme-Schalter aus ist.
function applyTowerGate() {
  const on = towersToggle.checked;
  for (const group of advancedGroups.querySelectorAll('.advanced-group[data-gate="towers"]')) {
    group.classList.toggle('disabled', !on);
    for (const input of group.querySelectorAll('input')) input.disabled = !on;
  }
}

buildAdvanced();
applyTowerGate();
towersToggle.addEventListener('change', applyTowerGate);

// Einheitentypen-Übersicht in den Spielregeln aus den zentralen Definitionen füllen.
{
  const list = document.getElementById('rules-units');
  const fmt = (n) => String(n).replace('.', ',');
  for (const t of UNIT_TYPES) {
    const li = document.createElement('li');
    li.innerHTML =
      `<strong>${t.icon} ${t.name}</strong> (${t.cost} ⬢): ${t.hp} LP, ` +
      `${t.damage} Schaden alle ${fmt(t.attackInterval)} s, Tempo ×${fmt(t.speed)} – ${t.desc}`;
    list.appendChild(li);
  }
}

document.getElementById('setup-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  config = {
    ...DEFAULT_CONFIG,
    resources: Number(document.getElementById('opt-resources').value),
    edgeTime: Number(document.getElementById('opt-tempo').value),
    respawnTime: Number(document.getElementById('opt-respawn').value),
    graveyardCaptureTime: Number(document.getElementById('opt-capture').value),
    towersPerFaction: towersToggle.checked ? TOWERS_ON_COUNT : 0,
    // Einheitenwerte aus dem Erweitert-Bereich (zentral via resolveUnitTypes gelesen).
    unitStats: readUnitStats(),
  };
  // Feinwerte aus dem Erweitert-Bereich übernehmen (bossHp, Boss- und Turmwerte).
  for (const section of CONFIG_SECTIONS) {
    for (const field of section.fields) config[field.key] = readNumberField(field, `adv-${field.key}`, DEFAULT_CONFIG[field.key]);
  }
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
    budget: config.resources,
    config,
    panel: panelEl,
    canvas,
    renderer,
    onConfirm: (units) => {
      plans[faction] = units;
      planner = null;
      view.planning = null;
      if (faction === 'blue') {
        if (mode === 'cpu') {
          plans.red = aiPlan(config, map, 'red');
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
  plans.blue = aiPlan(config, map, 'blue', () => 0.3);
  plans.red = aiPlan(config, map, 'red', () => 0.8);
  startSim();
} else if (params.get('test') === 'plan') {
  startPlanning('blue');
}

requestAnimationFrame(frame);
