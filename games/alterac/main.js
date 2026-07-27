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
import { bossCell } from './sprites.js';
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
// Geteilter Aufmarsch aus der Adresszeile (?plan=…). Er gilt für die erste
// Planung dieser Sitzung und wird dabei verbraucht – danach plant jeder wieder
// von Hand oder aus der Bibliothek.
let pendingPlanCode = null;

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
// UNIT_STAT_FIELDS (schreibt nach config.unitStats), dazu je eine Gruppe pro
// Sektion aus CONFIG_SECTIONS (schreiben direkt in config[key]). Prozent-Felder
// zeigen im Menü ganze Prozent, intern bleibt der Anteil (0–1) erhalten.
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
  // Danach die übrigen Gruppen aus CONFIG_SECTIONS (Zeiten, Türme, Vorratslager,
  // Verbündeter, Boss) – rein datengetrieben: Eine neue Sektion dort erscheint
  // hier ohne Zutun, samt Gate.
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
  // Feinwerte aller Sektionen aus dem Erweitert-Bereich übernehmen.
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
  const initialCode = pendingPlanCode;
  pendingPlanCode = null;
  planner = createPlanner({
    map,
    faction,
    budget: config.resources,
    config,
    panel: panelEl,
    canvas,
    renderer,
    initialCode,
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

// ------------------------------------------------------------------ Boss-HUD
// Beide Fürsten bleiben die ganze Schlacht über sichtbar – das ist der Kern:
// Der Kartenausschnitt zeigt auf einem Telefon nie beide Festungen gleichzeitig,
// und wer gerade einen Turmkampf in der Mitte verfolgt, verlöre den Stand der
// Schlacht sonst genau dann aus dem Blick, wenn er zählt.
//
// Deshalb sitzt das HUD im Panel und nicht über der Karte: Dort verdeckt es zu
// keinem Zeitpunkt Gelände, und das Karten-Scrollen berührt es nicht.
//
// Die Porträts sind dieselben, die vorher als Medaillon neben der Festung
// standen. Dort waren sie nur zu sehen, wo der Boss ohnehin steht – der
// Renderer zeichnet sie darum nicht mehr, die Grafik kommt hier als
// CSS-Hintergrund aus demselben Atlas wie im Ergebnis-Overlay.
//
// Eine Zeile trägt alles, was zu einer Fraktion zu wissen ist: Lebenspunkte des
// Fürsten, sein Schild und ihr Vorrat samt mächtigem Verbündeten. Der Vorrat
// stand vorher als eigener Block darunter – zwei Kästen mit denselben zwei
// Fraktionen untereinander, jeder mit eigener Überschriftszeile. Zusammengelegt
// kostet er nur noch eine Messwert-Zeile.
//
// Beide Messwert-Zeilen hängen an ihrem Teilsystem: Ohne Türme gibt es keine
// Schildzeile, ohne Vorratslager keine Vorratszeile. Sind beide aus, bleibt die
// Fraktionszeile bei Porträt, Name und Lebensbalken.

// Anteil 0–1, zu dem der Schutzschild einer Fraktion noch trägt.
//
// `sim.bossShield` taugt dafür nicht: Es ist ein Schalter (voller Schutz,
// solange irgendein eigener Turm steht – null, sobald der letzte fällt) und
// ergäbe einen Balken, der bis zuletzt voll steht und dann springt. Der Schild
// lebt aber von den Lebenspunkten der Türme, also speist ihn genau die: Der
// Balken sinkt, während am Turm gekämpft wird, und erreicht 0 in dem Moment,
// in dem der Schild tatsächlich bricht.
function shieldStrength(faction) {
  let hp = 0;
  let maxHp = 0;
  for (const tw of Object.values(sim.towers)) {
    if (tw.faction !== faction) continue;
    hp += tw.hp;
    maxHp += tw.maxHp;
  }
  return maxHp > 0 ? hp / maxHp : 0;
}

const standingTowers = (faction) =>
  Object.values(sim.towers).filter((tw) => tw.faction === faction && tw.alive).length;

// Der Schildbalken erscheint nur, wenn er auch etwas bedeutet: Ohne Türme gibt
// es keinen Schild, und ein auf 0 gestellter `bossTowerShield` lässt die Türme
// zwar stehen, blockt aber nichts – ein Balken dafür wäre eine Lüge.
const shieldRelevant = () =>
  (config.towersPerFaction ?? 0) > 0 && (config.bossTowerShield ?? 0) > 0;

// Das fest zugeordnete Lager einer Fraktion aus dem Simulationszustand ablesen.
// Jede Fraktion hat genau eines, der Besitz wechselt nie – der Gegner kann es
// nur blockieren.
const ownCampOf = (st, faction) =>
  (st?.camps ?? []).find((id) => st.owner?.[id] === faction) ?? null;

// Die Vorratszeile erscheint nur, wenn die Partie überhaupt Lager hat. Ist das
// System im Setup abgeschaltet, bleibt `camps` leer und die Zeile entfällt –
// dieselbe Regel wie beim Schild, nur für das andere Teilsystem.
const supplyRelevant = () => (sim.supplyState?.camps ?? []).length > 0;

// Reihenfolge rot über blau – wie auf der Karte, wo der Frostwolf im Norden
// und die Sturmlanze im Süden steht.
const BOSS_ORDER = ['red', 'blue'];

function bossBoardMarkup() {
  const shield = shieldRelevant();
  const supply = supplyRelevant();
  // Eine Zeile ohne beide Teilsysteme braucht den Messwert-Block gar nicht –
  // dann besteht sie nur aus Porträt, Name und Lebensbalken.
  const meter = (kind, f, icon) => `
    <div class="boss-meter ${kind}" data-${kind}="${f}">
      <span class="boss-meter-icon" data-${kind}-icon="${f}">${icon}</span>
      <div class="boss-meter-bar"><i data-${kind}-bar="${f}"></i></div>
      <span class="boss-meter-text" data-${kind}-text="${f}"></span>
    </div>`;
  const rows = BOSS_ORDER.map((f) => {
    const fac = FACTIONS[f];
    const cell = bossCell(f);
    // Fehlt der Bossatlas, entfällt allein das Bild – Name, Lebenspunkte,
    // Schild und Vorrat trägt die Zeile auch ohne Gesicht.
    const pic = cell
      ? `<span class="boss-portrait boss-pic" style="--col:${cell.col}"></span>`
      : '';
    const meters =
      shield || supply
        ? `<div class="boss-meters">
             ${shield ? meter('shield', f, '🛡') : ''}
             ${supply ? meter('supply', f, '⬢') : ''}
           </div>`
        : '';
    return `
      <div class="boss-row" data-boss-row="${f}" style="--fac:${fac.color};--fac-dark:${fac.dark}">
        ${pic}
        <div class="boss-head">
          <span class="boss-name">${fac.name}</span>
          <span class="boss-hp" data-boss-hp="${f}"></span>
        </div>
        <div class="boss-bar"><i data-boss-bar="${f}"></i></div>
        ${meters}
      </div>`;
  }).join('');
  return `<div class="boss-board" id="boss-board" role="group"
    aria-label="Stand beider Fürsten: Lebenspunkte, Schild und Vorrat">${rows}</div>`;
}

// Referenzen je Fraktion, damit die Render-Schleife nicht bei jedem Bild neu im
// DOM sucht. Fehlende Teilsysteme liefern hier schlicht `null`.
let bossRows = [];

function collectBossRows() {
  const q = (sel) => panelEl.querySelector(sel);
  bossRows = BOSS_ORDER.map((faction) => ({
    faction,
    row: q(`[data-boss-row="${faction}"]`),
    hp: q(`[data-boss-hp="${faction}"]`),
    bar: q(`[data-boss-bar="${faction}"]`),
    shield: q(`[data-shield="${faction}"]`),
    shieldIcon: q(`[data-shield-icon="${faction}"]`),
    shieldBar: q(`[data-shield-bar="${faction}"]`),
    shieldText: q(`[data-shield-text="${faction}"]`),
    supply: q(`[data-supply="${faction}"]`),
    supplyIcon: q(`[data-supply-icon="${faction}"]`),
    supplyBar: q(`[data-supply-bar="${faction}"]`),
    supplyText: q(`[data-supply-text="${faction}"]`),
    campId: ownCampOf(sim.supplyState, faction),
  })).filter((r) => r.row);
}

// Schwelle, ab der der Schild als „bricht gleich" gilt und sein Pulsen
// deutlicher wird. Ein Viertel Rest-Turmleben ist nah genug am Bruch, dass die
// Warnung noch etwas nützt, und weit genug entfernt, dass sie nicht dauerhaft
// blinkt.
const SHIELD_WEAK = 0.25;

// Zustände des Vorratslagers als Symbol. Der Zustand steckt im Symbol und in
// der Farbe, der Fortschritt im Balken und im Text – so trägt die Zeile beides,
// ohne dass der Lagername sie noch einmal so lang macht. Er ist ohnehin fest:
// Jede Fraktion hat genau ein Lager. Eine Blockade zählt erst im Betrieb; ein
// noch nicht in Betrieb genommenes Lager bleibt „inaktiv", ganz gleich wer
// davorsteht.
const SUPPLY_ICONS = { idle: '⬡', running: '⬢', blocked: '⚠' };

const campStateKey = (st, campId) =>
  !st.active?.[campId] ? 'idle' : st.blocked?.[campId] ? 'blocked' : 'running';

// Eine Messwert-Zeile (Schild oder Vorrat) auf einen Stand bringen. Das läuft
// in der Render-Schleife, deshalb wird jeder Wert vor dem Schreiben verglichen:
// Der Zähler im Text läuft innerhalb desselben Zustands weiter („4 / 10" →
// „5 / 10"), die Klasse wechselt dagegen selten.
function setMeter(row, kind, { fill, state, icon, text }) {
  const bar = row[`${kind}Bar`];
  const width = `${(Math.max(0, Math.min(1, fill)) * 100).toFixed(1)}%`;
  if (bar.style.width !== width) bar.style.width = width;
  const textEl = row[`${kind}Text`];
  if (textEl.textContent !== text) textEl.textContent = text;
  const iconEl = row[`${kind}Icon`];
  if (iconEl.textContent !== icon) iconEl.textContent = icon;
  const el = row[kind];
  if (el.dataset.state === state) return;
  el.dataset.state = state;
  el.className = `boss-meter ${kind} ${state}`;
}

function updateBossBoard() {
  if (!bossRows.length) return;
  const st = sim.supplyState;
  for (const r of bossRows) {
    const state = sim.boss[r.faction];
    const alive = sim.bossAlive[r.faction];
    const hp = Math.max(0, Math.round(state.hp));
    const text = `${hp} / ${Math.round(state.maxHp)}`;
    if (r.hp.textContent !== text) r.hp.textContent = text;
    const frac = state.maxHp > 0 ? Math.max(0, state.hp / state.maxHp) : 0;
    const width = `${(frac * 100).toFixed(1)}%`;
    if (r.bar.style.width !== width) r.bar.style.width = width;
    // Farbstufen wie beim Lebensbalken auf der Karte (`drawHpBar` in render.js),
    // damit Karte und HUD denselben Zustand gleich einfärben.
    const level = frac > 0.5 ? 'high' : frac > 0.25 ? 'mid' : 'low';
    if (r.bar.dataset.level !== level) r.bar.dataset.level = level;
    r.row.classList.toggle('fallen', !alive);

    if (r.shield) {
      // Der Schild verschwindet mit dem Boss – ein gefallener Fürst hat keinen
      // Zustand mehr, den es zu überwachen lohnte.
      const strength = alive ? shieldStrength(r.faction) : 0;
      const standing = alive ? standingTowers(r.faction) : 0;
      setMeter(r, 'shield', {
        fill: strength,
        state: standing === 0 ? 'broken' : strength <= SHIELD_WEAK ? 'weak' : 'holding',
        icon: '🛡',
        text:
          standing === 0
            ? 'Schild gefallen'
            : `${standing} ${standing === 1 ? 'Turm' : 'Türme'}`,
      });
    }

    if (r.supply) {
      const summoned = st.allySummoned?.[r.faction];
      if (summoned) {
        // Nach der Beschwörung steht in der Zeile der Verbündete statt des
        // Vorrats – ob er noch lebt, verrät die Karte, nicht diese Anzeige.
        const ally = resolveAllyType(config, r.faction);
        setMeter(r, 'supply', {
          fill: 1,
          state: 'summoned',
          icon: ally.icon,
          text: ally.name,
        });
      } else {
        const key = r.campId ? campStateKey(st, r.campId) : 'idle';
        const have = Math.floor(st.supply[r.faction] ?? 0);
        setMeter(r, 'supply', {
          fill: st.cost > 0 ? have / st.cost : 0,
          // Ein ruhendes Lager sammelt nichts – dann sagt der Zustand mehr als
          // eine Null vor der Schwelle.
          state: key,
          icon: SUPPLY_ICONS[key],
          text: key === 'idle' ? 'Lager inaktiv' : `${have} / ${st.cost}`,
        });
      }
    }
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
    ${bossBoardMarkup()}
    <div class="ticker" id="ticker"><p class="muted">Die Schlacht beginnt …</p></div>
  `;
  collectBossRows();
  updateBossBoard();
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
  updateBossBoard();
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
  // Beim Sieg blickt der eigene Boss aus dem Overlay – derselbe Kopf, der auf
  // der Karte die Festung bewacht hat. Fehlt der Bossatlas, bleibt es beim
  // Pokal. Ein Unentschieden hat keinen Sieger und damit kein Gesicht.
  let head = '<div class="overlay-emoji">🏆</div>';
  if (r.winner === 'draw') {
    head = '<div class="overlay-emoji">🤝</div>';
    title = 'Unentschieden';
  } else {
    const fac = FACTIONS[r.winner];
    const cell = bossCell(r.winner);
    if (cell) {
      head = `<div class="boss-portrait overlay-boss" style="--col:${cell.col};--fac:${fac.color};--fac-dark:${fac.dark}"></div>`;
    }
    title = `${fac.name} siegt!`;
  }
  overlayCard.innerHTML = `
    ${head}
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

// ------------------------------------------- Rückkehr aus dem Hintergrund
// Der Kartenhintergrund – gemaltes Tal *und* Wege – liegt als eigene, **einmal**
// gerasterte Offscreen-Leinwand im Renderer und wird danach je Bild nur noch
// kopiert (`paintBackground`/`drawImage(bg, …)` in `render.js`).
//
// Mobile Browser dürfen die Zeichenfläche einer solchen Leinwand verwerfen,
// während die App im Hintergrund liegt: Speicherdruck, Neustart des
// GPU-Prozesses, Rückkehr aus dem bfcache. Die sichtbare Leinwand heilt sich
// selbst, weil sie jedes Bild neu entsteht – die kopierte heilt nie. Sie bleibt
// für den Rest der Sitzung leer, und die Karte zeigt Knoten und Token auf
// schwarzem Grund, ohne Gelände und ohne Wege (gemeldet für Firefox auf
// Android, Issue #34).
//
// Es gibt keine Zusage eines Browsers, dass eine einmal gemalte Leinwand
// gemalt bleibt. Also wird sie neu gerastert, sobald die Seite wieder sichtbar
// ist – erst im nächsten Bild, damit die Seite wieder vollständig lebt und
// nicht in eine Fläche gemalt wird, die gerade verworfen wird.
//
// Der Preis ist einmaliges Terrain-Rastern je Rückkehr. Sonst folgenlos:
// `resize()` fasst weder Spielzustand noch Layout an – die Anzeigegröße der
// Leinwand steht im CSS –, sondern nur ihre Auflösung und den Inhalt der
// Hintergrundebene.
function repaintAfterRestore() {
  if (view.phase === 'setup') return;
  requestAnimationFrame(() => renderer.resize());
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') repaintAfterRestore();
});

// `pageshow` deckt die Verlaufsnavigation ab (zurück/vorwärts aus dem
// bfcache) – dabei feuert `visibilitychange` nicht zwingend.
window.addEventListener('pageshow', repaintAfterRestore);

// Testeinstieg für Entwicklung: ?test=sim startet direkt eine CPU-Schlacht.
// Mit `&ai=<stufe>` bzw. `&ai=<blau>,<rot>` lassen sich die KI-Stufen der beiden
// Seiten gezielt gegeneinander antreten lassen (z. B. ?test=sim&ai=hard,easy).
const params = new URLSearchParams(location.search);
// Geteilter Aufmarsch (?plan=…): Er wird erst in der Planungsphase eingelöst –
// die Partie-Einstellungen wählt weiterhin das Setup, ein Link überschreibt sie
// nie. Passt der Plan nicht zu den gewählten Einstellungen, kürzt ihn der Planer
// beim Übernehmen und sagt es.
pendingPlanCode = params.get('plan');
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
