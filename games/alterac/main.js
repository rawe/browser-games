// Einstiegspunkt: Bildschirm-Ablauf (Setup → Planung → Simulation → Ergebnis),
// Render-Schleife und Simulationssteuerung.

import { createMap, FACTIONS } from './map.js';
import {
  DEFAULT_CONFIG,
  UNIT_TYPES,
  UNIT_STAT_FIELDS,
  RESOURCE_OPTIONS,
  CONFIG_SECTIONS,
  TOWERS_ON_COUNT,
  resolveAllyType,
} from './config.js';
import { createSim } from './sim.js';
import { createRenderer } from './render.js';
import { createPlanner } from './planner.js';
import { aiPlan, AI_LEVELS, DEFAULT_AI_LEVEL } from './ai.js';
import { lockZoomGestures } from './gestures.js';

// Pinch-/Doppeltipp-Zoom auf Mobilgeräten (v. a. iOS) sperren – gilt für alle
// Bildschirme (Setup, Planung, Simulation). Scrollen bleibt erhalten.
lockZoomGestures();

const map = createMap();
const canvas = document.getElementById('map');
const renderer = createRenderer(canvas, map);

const setupEl = document.getElementById('screen-setup');
const gameEl = document.getElementById('screen-game');
const mapWrapEl = document.getElementById('map-wrap');
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
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (o.value === selectedValue) opt.selected = true;
    el.appendChild(opt);
  }
}

fillSelect(document.getElementById('opt-resources'), RESOURCE_OPTIONS, DEFAULT_CONFIG.resources);

// ------------------------------------------------------- Stärke des Computergegners
// Die Auswahl kommt datengetrieben aus AI_LEVELS (ai.js) und ist nur im Modus
// „Gegen den Computer" sichtbar – im Hotseat gibt es keinen Computergegner.
// Gewählt wird bei jedem Spielstart neu; das Ergebnis landet als `aiLevel` in
// der Partie-Konfiguration, aus der `aiPlan` seinen Planer wählt.
const modeSelect = document.getElementById('opt-mode');
const aiLevelRow = document.getElementById('row-ai-level');
const aiLevelSelect = document.getElementById('opt-ai-level');
const aiLevelDesc = document.getElementById('ai-level-desc');

fillSelect(
  aiLevelSelect,
  AI_LEVELS.map((l) => ({ value: l.key, label: l.label })),
  DEFAULT_AI_LEVEL
);

function applyModeGate() {
  aiLevelRow.hidden = modeSelect.value !== 'cpu';
  aiLevelDesc.textContent = AI_LEVELS.find((l) => l.key === aiLevelSelect.value)?.desc ?? '';
}

modeSelect.addEventListener('change', applyModeGate);
aiLevelSelect.addEventListener('change', applyModeGate);
applyModeGate();

// ---------------------------------------------- Erweiterte Einstellungen (Zahlenfelder)
// Die Felder werden datengetrieben erzeugt: je Einheitentyp eine Gruppe aus
// UNIT_STAT_FIELDS (schreibt nach config.unitStats), dazu die Boss-/Turm-Gruppen
// aus CONFIG_SECTIONS (schreiben direkt in config[key]). Prozent-Felder zeigen
// im Menü ganze Prozent, intern bleibt der Anteil (0–1) erhalten.
const advancedGroups = document.getElementById('advanced-groups');

// Setup-Schalter, die ein ganzes Teilsystem abschalten (Türme, Vorratslager …).
// Datengetrieben aus den `gate`-Kennungen von CONFIG_SECTIONS: zu jedem Gate
// gehört ein Schalter mit der id `opt-<gate>`; ein neues Gate braucht also nur
// den Eintrag in config.js und einen Schalter im Formular – hier ist nichts
// nachzuziehen. Fehlt der Schalter, gilt das Teilsystem als eingeschaltet.
const GATES = [...new Set(CONFIG_SECTIONS.map((s) => s.gate).filter(Boolean))];
const gateToggles = Object.fromEntries(
  GATES.map((gate) => [gate, document.getElementById(`opt-${gate}`)])
);
const gateOn = (gate) => gateToggles[gate]?.checked ?? true;

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

// Feld-Gruppen eines abgeschalteten Teilsystems ausgrauen und deaktivieren.
function applyGates() {
  for (const gate of GATES) {
    const on = gateOn(gate);
    for (const group of advancedGroups.querySelectorAll(`.advanced-group[data-gate="${gate}"]`)) {
      group.classList.toggle('disabled', !on);
      for (const input of group.querySelectorAll('input')) input.disabled = !on;
    }
  }
}

buildAdvanced();
applyGates();
for (const toggle of Object.values(gateToggles)) toggle?.addEventListener('change', applyGates);

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
    towersPerFaction: gateOn('towers') ? TOWERS_ON_COUNT : 0,
    // Vorratslager samt mächtigem Verbündeten (aus = System komplett inaktiv).
    supplyEnabled: gateOn('supply'),
    // Stärke des Computergegners dieser Partie (nur im CPU-Modus wirksam).
    aiLevel: aiLevelSelect.value,
    // Einheitenwerte aus dem Erweitert-Bereich (zentral via resolveUnitTypes gelesen).
    unitStats: readUnitStats(),
  };
  // Feinwerte aus dem Erweitert-Bereich übernehmen (bossHp, Boss- und Turmwerte).
  for (const section of CONFIG_SECTIONS) {
    for (const field of section.fields) config[field.key] = readNumberField(field, `adv-${field.key}`, DEFAULT_CONFIG[field.key]);
  }
  view.config = config;
  mode = modeSelect.value;
  plans = { blue: null, red: null };
  startPlanning('blue');
});

// ------------------------------------------------------------------ Phasenwechsel
function showScreen(phase) {
  setupEl.hidden = phase === 'setup' ? false : true;
  gameEl.hidden = phase === 'setup';
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
  // Im Kartenbereich zur eigenen Basis scrollen (blau unten, rot oben).
  requestAnimationFrame(() => {
    mapWrapEl.scrollTop = faction === 'blue' ? mapWrapEl.scrollHeight : 0;
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
    mapWrapEl.scrollTop = (mapWrapEl.scrollHeight - mapWrapEl.clientHeight) / 2;
  });
}

// Vorratsanzeige der Schlacht: je Fraktion Stand, Schwelle und ein schmaler
// Balken. Das Markup entsteht nur, wenn die Partie überhaupt Lager hat – ist das
// System abgeschaltet, bleibt `camps` leer und der ganze Block entfällt. Die UI
// wertet nichts aus, sie zeigt nur `sim.supplyState`.
function supplyBoardMarkup() {
  const camps = sim.supplyState?.camps ?? [];
  if (!camps.length) return '';
  const rows = ['blue', 'red']
    .map((f) => {
      const fac = FACTIONS[f];
      return `
      <div class="supply-row" data-supply-row="${f}" style="--fac:${fac.color};--fac-dark:${fac.dark}">
        <span class="supply-fac">${fac.name}</span>
        <span class="supply-value" data-supply-value="${f}"></span>
        <div class="supply-bar"><i data-supply-bar="${f}"></i></div>
      </div>`;
    })
    .join('');
  return `<div class="supply-board" id="supply-board" role="group" aria-label="Vorrat je Fraktion">${rows}</div>`;
}

// Referenzen der Vorratszeilen (je Fraktion), damit die Render-Schleife nicht
// bei jedem Bild neu im DOM suchen muss. Leer, wenn es keine Lager gibt.
let supplyRows = [];

function collectSupplyRows() {
  supplyRows = ['blue', 'red']
    .map((faction) => ({
      faction,
      row: panelEl.querySelector(`[data-supply-row="${faction}"]`),
      value: panelEl.querySelector(`[data-supply-value="${faction}"]`),
      bar: panelEl.querySelector(`[data-supply-bar="${faction}"]`),
    }))
    .filter((r) => r.row);
}

function updateSupplyBoard() {
  if (!supplyRows.length) return;
  const st = sim.supplyState;
  const cost = st.cost;
  for (const { faction, row, value, bar } of supplyRows) {
    const summoned = st.allySummoned?.[faction];
    // Nach der Beschwörung steht in der Zeile der Verbündete statt des Vorrats –
    // ob er noch lebt, verrät die Karte, nicht diese Anzeige.
    let text;
    if (summoned) {
      const ally = resolveAllyType(config, faction);
      text = `${ally.icon} ${ally.name} · erschienen`;
    } else {
      text = `⬢ ${Math.floor(st.supply[faction] ?? 0)} / ${cost}`;
    }
    if (value.textContent !== text) value.textContent = text;
    const fill = summoned ? 1 : Math.min(1, (st.supply[faction] ?? 0) / cost);
    const width = `${(fill * 100).toFixed(1)}%`;
    if (bar.style.width !== width) bar.style.width = width;
    row.classList.toggle('summoned', !!summoned);
  }
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
    ${supplyBoardMarkup()}
    <div class="ticker" id="ticker"><p class="muted">Die Schlacht beginnt …</p></div>
  `;
  collectSupplyRows();
  updateSupplyBoard();
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
  updateSupplyBoard();
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
// Mit `&ai=<stufe>` bzw. `&ai=<blau>,<rot>` lassen sich die KI-Stufen der beiden
// Seiten gezielt gegeneinander antreten lassen (z. B. ?test=sim&ai=hard,easy).
const params = new URLSearchParams(location.search);
if (params.get('test') === 'sim') {
  mode = 'cpu';
  const [blueLevel, redLevel = blueLevel] = (params.get('ai') ?? DEFAULT_AI_LEVEL).split(',');
  plans.blue = aiPlan(config, map, 'blue', () => 0.3, blueLevel);
  plans.red = aiPlan(config, map, 'red', () => 0.8, redLevel);
  startSim();
} else if (params.get('test') === 'plan') {
  startPlanning('blue');
}

requestAnimationFrame(frame);
