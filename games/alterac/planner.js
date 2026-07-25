// Planungsphase: Armee aus dem Ressourcenbudget zusammenstellen und für jede
// Einheit eine Auftragskette festlegen. Ein Auftrag ist ein Pfad über
// benachbarte Wegpunkte plus Haltung (Angriff oder Halten); optional startet er
// erst „Dann" (nach dem vorigen Auftrag) oder „Sobald" ein globales Event
// eintritt (Unterbrechung). Baut das Bedienpanel auf und verarbeitet Karten-Taps.

import { FACTIONS, towerNodes, enemyOf } from './map.js';
import { spriteCell } from './sprites.js';
import {
  resolveUnitTypes,
  resolveUnitTypeMap,
  MAX_PATH_LENGTH,
  MAX_ACTIONS,
  EVENT_CONDITIONS,
  EVENT_CONDITION_BY_TYPE,
  describeCondition,
  toRoman,
} from './config.js';
import {
  planStore,
  encodePlan,
  decodePlan,
  validatePlan,
  describeMeta,
  MAX_NAME_LENGTH,
} from './plans.js';

// Kreis-Ziffern für die Auftragsnummer (1-basiert).
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];
const circled = (n) => CIRCLED[n - 1] ?? `(${n})`;

// Kurzbeschreibung eines einzelnen Auftrags für Chip und Auftragsliste. `towers`
// ist die aktive Turmzuordnung { nodeId: faction }; endet der Angriffspfad auf
// einem gegnerischen Turm, wird das ausdrückliche Turm-Ziel benannt.
// `supplyCamps` ist die feste Lagerzuordnung { nodeId: faction }: Endet ein Pfad
// dort, löst das die Vorratsregel aus und wird deshalb ebenso ausdrücklich
// benannt – am eigenen Lager als Inbetriebnahme, am gegnerischen als Blockade,
// denn übernehmen lässt es sich nie. Beide Zusatzangaben sind optional, damit
// bestehende Aufrufe unverändert weiterlaufen.
export function actionSummary(action, nodes, towers = {}, faction = null, supplyCamps = {}) {
  const path = action.path ?? [];
  const names = path.map((id) => nodes[id].name);
  const endId = path.length ? path[path.length - 1] : null;
  const endTowerFaction = endId ? towers[endId] : undefined;
  const endName = names.length ? names[names.length - 1] : null;
  // Lager-Ziel: `long` benennt das Lager (dort steht kein Pfad daneben), `short`
  // hängt hinter der Wegliste, die auf den Lagernamen ohnehin schon endet.
  const campOwner = endId ? (supplyCamps[endId] ?? null) : null;
  let camp = null;
  if (campOwner && faction) {
    camp =
      campOwner === faction
        ? { long: `nimmt Vorratslager ${endName} in Betrieb`, short: 'nimmt Vorratslager in Betrieb' }
        : { long: `besetzt Vorratslager ${endName}`, short: 'besetzt Vorratslager' };
  } else if (campOwner) {
    camp = { long: `am Vorratslager ${endName}`, short: 'Ziel: Vorratslager' };
  }
  if (action.stance === 'defend') {
    if (endTowerFaction && faction && endTowerFaction === faction) {
      return `🛡 verteidigt Turm ${endName}`;
    }
    if (camp) return `🛡 ${camp.long}`;
    return `🛡 hält ${endName ?? 'die Basis'}`;
  }
  if (endTowerFaction && faction && endTowerFaction !== faction) {
    return `⚔ ${names.join(' → ')} · greift Turm an`;
  }
  if (camp) return `⚔ ${names.join(' → ')} · ${camp.short}`;
  return names.length ? `⚔ ${names.join(' → ')}` : '⚔ direkt zum Boss';
}

const fmt = (n) => String(n).replace('.', ',');

// Zeichen, die in gespeicherten Plannamen vorkommen dürfen, sicher für innerHTML.
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createPlanner({
  map,
  faction,
  budget,
  config,
  panel,
  canvas,
  renderer,
  onConfirm,
  // Teilen-Code aus der Adresszeile (?plan=…), einmalig beim Öffnen übernommen.
  initialCode = null,
}) {
  const state = {
    faction,
    budget,
    // units[i] = { type, actions: [{ path:[nodeId…], stance, trigger }] }
    // trigger: null | { kind:'then' } | { kind:'when', cond:{ type, node? } }
    units: [],
    selected: -1,
    selectedAction: 0, // aktiver Auftrag der gewählten Einheit (Ziel der Karten-Taps)
    pickTower: false, // true: nächster Karten-Tap wählt den Ziel-Turm einer „Sobald"-Bedingung
    // Karteneinstellung: Ziel-Marker der übrigen Trupps auf der Karte zeigen.
    showTargets: true,
  };
  const fac = FACTIONS[faction];
  const enemyFaction = enemyOf(faction);
  const start = map.start[faction];
  // Aktive Turmzuordnung { nodeId: faction } für Zusammenfassungen und Turm-Wahl.
  const towers = towerNodes(map, config?.towersPerFaction ?? 0);
  const isEnemyTower = (id) => towers[id] === enemyFaction;
  const hasEnemyTowers = Object.values(towers).some((f) => f === enemyFaction);
  // Feste Lagerzuordnung { nodeId: faction } dieser Partie – leer, wenn das
  // System abgeschaltet ist. Ein Lager wechselt nie den Besitzer, deshalb stehen
  // eigenes und gegnerisches Lager schon zur Planungszeit fest.
  const supplyCamps = config?.supplyEnabled ? (map.supplyCamps ?? {}) : {};
  const campOf = (f) => Object.keys(supplyCamps).find((id) => supplyCamps[id] === f) ?? null;
  const ownCamp = campOf(faction);
  const enemyCamp = campOf(enemyFaction);
  // Effektive Einheitenwerte dieser Partie (Datei-Defaults ggf. überschrieben).
  const unitTypes = resolveUnitTypes(config);
  const byKey = resolveUnitTypeMap(config);

  const spent = () => state.units.reduce((s, u) => s + byKey[u.type].cost, 0);
  const selectedUnit = () => state.units[state.selected] ?? null;
  const selectedActionObj = () => {
    const u = selectedUnit();
    return u ? u.actions[state.selectedAction] ?? null : null;
  };

  // Ist ein Auftrag eine Reaktion („Sobald")? Der erste Auftrag nie.
  const isReaction = (action, idx) => idx > 0 && action.trigger?.kind === 'when';

  // Endknoten aller Aufträge vor `idx` (bzw. Startpunkt) – Ankerpunkt, ab dem der
  // Pfad des Auftrags `idx` aufgebaut wird.
  function anchorNode(unit, idx) {
    let node = start;
    for (let k = 0; k < idx; k++) {
      const p = unit.actions[k].path;
      if (p.length) node = p[p.length - 1];
    }
    return node;
  }
  // Aktuelles Pfadende eines Auftrags (letzter eigener Wegpunkt oder Anker).
  function actionEnd(unit, idx) {
    const p = unit.actions[idx].path;
    return p.length ? p[p.length - 1] : anchorNode(unit, idx);
  }

  const DEFAULT_HINT =
    'Über 💾 lassen sich Aufmärsche speichern, wieder laden und als Link teilen – der zuletzt ' +
    'gespielte steht dort immer bereit. ' +
    'Einheiten anwerben, dann den Pfad des gewählten Auftrags Wegpunkt für Wegpunkt antippen ' +
    '(nur benachbarte Punkte). Mit „➕ Auftrag" hängst du weitere Aufträge an – so greift eine Einheit ' +
    'z. B. erst Turm A, dann Turm B an. Ein Zusatz-Auftrag startet „Dann" (nach dem vorigen) oder „Sobald" ' +
    'ein globales Event eintritt (z. B. „Boss-Schild des Gegners fällt") – dann unterbricht er, was die ' +
    'Einheit gerade tut. Ohne weiteren Auftrag zieht „Angriff" danach zum Boss, „Halten" bewacht das ' +
    'Pfadende. Türme werden nur angegriffen, wenn ein Angriffs-Auftrag ausdrücklich auf einem ' +
    'gegnerischen Turm endet.';

  // Zusatzhinweis nur, wenn die Partie Vorratslager hat. Die Namen kommen aus der
  // Karte, damit der Text bei geänderten Standorten nicht nachgezogen werden muss.
  const SUPPLY_HINT = ownCamp
    ? ` Genauso beim eigenen Vorratslager (${map.nodes[ownCamp].name}): In Betrieb nimmt es nur, ` +
      'wessen Auftrag ausdrücklich dort endet – ein Durchmarsch reicht nicht. Danach liefert es ' +
      'dauerhaft Nachschub für den mächtigen Verbündeten, auch ohne Wache.' +
      (enemyCamp
        ? ` Das gegnerische Lager (${map.nodes[enemyCamp].name}) lässt sich nie übernehmen, nur ` +
          'blockieren: solange eine eigene Einheit ausdrücklich dort steht.'
        : '')
    : '';

  panel.innerHTML = `
    <div class="map-settings">
      <button class="btn ghost map-toggle active" id="btn-targets" type="button" aria-pressed="true">
        <span class="map-toggle-dot" aria-hidden="true"></span>
        🎯 Ziele der übrigen Trupps auf der Karte zeigen
      </button>
    </div>
    <div class="panel-head">
      <span class="plan-title" style="--fac:${fac.color}">${fac.name} · ${fac.player} plant</span>
      <div class="panel-tools">
        <button class="btn ghost help-toggle" id="btn-store" type="button"
          title="Pläne speichern, laden und teilen" aria-expanded="false" aria-controls="plan-store">💾</button>
        <button class="btn ghost help-toggle" id="btn-help" type="button"
          title="Hilfe anzeigen" aria-expanded="false" aria-controls="help-text">?</button>
      </div>
    </div>
    <p class="help-text" id="help-text" hidden>${DEFAULT_HINT}${SUPPLY_HINT}</p>
    <div class="recruit-row">
      <span class="budget" id="budget"></span>
      ${unitTypes
        .map(
          (t) => `
        <button class="btn recruit" data-type="${t.key}"
          title="${t.desc} ${t.hp} LP · ${t.damage} Schaden alle ${fmt(t.attackInterval)} s · Tempo ×${fmt(t.speed)}">
          ${t.icon} ${t.name} <small>· ${t.cost}</small>
        </button>`
        )
        .join('')}
    </div>
    <div class="roster" id="roster"></div>
    <p class="hint" id="hint"></p>
    <div class="confirm-zone">
      <div class="confirm-ask" id="confirm-ask" hidden>
        <p class="confirm-ask-msg" id="confirm-ask-msg"></p>
        <div class="confirm-ask-actions">
          <button class="btn ghost" id="btn-confirm-cancel" type="button">Zurück</button>
          <button class="btn primary" id="btn-confirm-go" type="button"
            style="--fac:${fac.color};--fac-dark:${fac.dark}">Trotzdem starten ✓</button>
        </div>
      </div>
      <button class="btn primary confirm-main" id="btn-confirm" type="button"
        style="--fac:${fac.color};--fac-dark:${fac.dark}">Schlacht starten ✓</button>
    </div>
  `;

  const rosterEl = panel.querySelector('#roster');
  const hintEl = panel.querySelector('#hint');
  const budgetEl = panel.querySelector('#budget');
  const recruitButtons = [...panel.querySelectorAll('.recruit')];
  const helpText = panel.querySelector('#help-text');
  const helpToggle = panel.querySelector('#btn-help');
  const confirmAsk = panel.querySelector('#confirm-ask');
  const confirmAskMsg = panel.querySelector('#confirm-ask-msg');

  let hintTimer = 0;
  function flashHint(text) {
    hintEl.textContent = text;
    hintEl.classList.add('warn');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.classList.remove('warn');
      hintEl.textContent = '';
    }, 2600);
  }

  function closeConfirmAsk() {
    confirmAsk.hidden = true;
  }

  helpToggle.addEventListener('click', () => {
    const show = helpText.hidden;
    helpText.hidden = !show;
    helpToggle.classList.toggle('active', show);
    helpToggle.setAttribute('aria-expanded', String(show));
  });

  const targetsToggle = panel.querySelector('#btn-targets');
  targetsToggle.addEventListener('click', () => {
    state.showTargets = !state.showTargets;
    targetsToggle.classList.toggle('active', state.showTargets);
    targetsToggle.setAttribute('aria-pressed', String(state.showTargets));
  });

  // --- Plan-Bibliothek (speichern, laden, teilen) --------------------------
  // Sie liegt als eigener Layer über der Planung statt als Abschnitt im Panel:
  // Panel und Karte teilen sich eine Bildschirmhöhe, und eine gefüllte Liste
  // hatte dort keinen Platz, ohne die Einheitenliste zu verdrängen. Im Layer
  // bekommt die Liste den ganzen Raum und scrollt für sich.
  //
  // Gezeigt werden NUR Pläne der gerade planenden Fraktion – aus zwei Gründen.
  // Erstens ist ein Aufmarsch der anderen Fraktion hier gar nicht spielbar:
  // Seine Pfade beginnen an der gegnerischen Basis. Zweitens sitzen im Hotseat
  // beide Spieler am selben Gerät, und der zuletzt gespielte Aufmarsch des
  // Gegners liegt im selben Speicher – eine gemischte Liste wäre ein Blick in
  // die geheime Planung der Gegenseite.
  const storeToggle = panel.querySelector('#btn-store');
  const overlayEl = document.getElementById('plan-overlay');
  const cardEl = document.getElementById('plan-card');
  // Einstufiges Rückgängig: Laden ersetzt die ganze Aufstellung, deshalb bleibt
  // die vorherige bis zur nächsten Aktion greifbar.
  let undoUnits = null;

  cardEl.innerHTML = `
    <div class="plan-card-head">
      <h2>💾 Aufmärsche</h2>
      <button class="btn ghost plan-close" id="btn-plan-close" type="button" aria-label="Schließen">✕</button>
    </div>
    <p class="plan-sub">Ein Aufmarsch gehört zu genau einer Fraktion – hier stehen die
      der <strong style="color:${fac.color}">${fac.name}</strong>.</p>
    ${
      planStore.available
        ? `<div class="plan-row">
      <input class="plan-input" id="plan-name" type="text" maxlength="${MAX_NAME_LENGTH}"
        autocomplete="off" placeholder="Name des Aufmarschs">
      <button class="btn ghost plan-act" id="btn-plan-save" type="button">💾 Speichern</button>
    </div>
    <div class="plan-list" id="plan-list"></div>`
        : ''
    }
    <div class="plan-share">
      <div class="plan-row">
        <input class="plan-input" id="plan-code" type="text" spellcheck="false"
          autocomplete="off" placeholder="Teilen-Link oder Code einfügen">
        <button class="btn ghost plan-act" id="btn-plan-apply" type="button">Laden</button>
      </div>
      <button class="btn ghost plan-act plan-share-btn" id="btn-plan-share" type="button">
        🔗 Eigenen Aufmarsch als Link kopieren
      </button>
    </div>
    <p class="plan-note" id="plan-note"></p>
  `;

  const planListEl = cardEl.querySelector('#plan-list');
  const planNameEl = cardEl.querySelector('#plan-name');
  const planCodeEl = cardEl.querySelector('#plan-code');
  const planNoteEl = cardEl.querySelector('#plan-note');

  // Meldezeile im Layer – für alles, was den Layer offen lässt.
  function setNote(text, { warn = false } = {}) {
    planNoteEl.className = 'plan-note' + (warn ? ' warn' : '');
    planNoteEl.textContent = text;
  }

  // Meldezeile im Panel – für alles, was bei geschlossenem Layer passiert
  // (Laden schließt ihn, ein Link löst ihn gleich beim Öffnen ein).
  function setPanelNote(text, { undo = false, warn = false } = {}) {
    clearTimeout(hintTimer);
    hintEl.classList.toggle('warn', warn);
    hintEl.innerHTML =
      esc(text) +
      (undo ? ' <button class="btn ghost plan-undo" id="btn-plan-undo" type="button">↩ Zurück</button>' : '');
  }

  // Meldung dorthin, wo der Spieler gerade hinsieht.
  function noteHere(text, warn = false) {
    if (overlayEl.hidden) setPanelNote(text, { warn });
    else setNote(text, { warn });
  }

  function openStore(show) {
    overlayEl.hidden = !show;
    storeToggle.classList.toggle('active', show);
    storeToggle.setAttribute('aria-expanded', String(show));
    if (show) {
      setNote('');
      // Der Hinweis auf die Bibliothek hat sich erledigt, sobald sie offen war.
      if (!hintEl.classList.contains('warn')) hintEl.textContent = '';
    }
  }

  storeToggle.addEventListener('click', () => openStore(overlayEl.hidden));

  function onKeyDown(ev) {
    if (ev.key === 'Escape' && !overlayEl.hidden) openStore(false);
  }
  document.addEventListener('keydown', onKeyDown);

  // Einträge der eigenen Fraktion: der zuletzt gespielte Aufmarsch zuerst
  // (er entsteht ohne Zutun), darunter die benannten Einträge.
  function storeEntries() {
    const entries = [];
    const last = planStore.last(faction);
    if (last) entries.push({ id: 'last', name: 'Zuletzt gespielt', ...last, faction, fixed: true });
    for (const s of planStore.list()) if (s.faction === faction) entries.push(s);
    return entries;
  }

  function renderStore() {
    if (!planListEl) return;
    const entries = storeEntries();
    if (!entries.length) {
      planListEl.innerHTML = '<p class="plan-empty">Noch nichts gespeichert.</p>';
      return;
    }
    planListEl.innerHTML = entries
      .map(
        (e) => `
      <div class="plan-slot">
        <button class="plan-slot-main" type="button" data-load="${e.id}">
          <span class="plan-slot-name">${esc(e.name)}</span>
          <span class="plan-slot-meta">${e.units.length} Einheiten · ${describeMeta(e.meta)}</span>
        </button>
        ${
          e.fixed
            ? '<span class="plan-slot-spacer" aria-hidden="true"></span>'
            : `<button class="mini del" data-drop="${e.id}" title="Eintrag löschen">✕</button>`
        }
      </div>`
      )
      .join('');
  }

  // Geladene Plandaten übernehmen: gegen diese Partie prüfen und erst dann
  // einsetzen. Was wegfällt, steht in der Meldezeile. Ein Plan der anderen
  // Fraktion wird abgelehnt – seine Pfade beginnen an der gegnerischen Basis
  // und zielen auf die dortigen Türme; er ist hier schlicht nicht spielbar.
  function applyUnits(units, sourceFaction, label) {
    if (sourceFaction && sourceFaction !== faction) {
      noteHere(`Dieser Aufmarsch gehört zu ${FACTIONS[sourceFaction].name} und ist nur dort spielbar.`, true);
      return;
    }
    const { units: clean, issues } = validatePlan(units, { map, config, faction });
    if (!clean.length) {
      noteHere('Von diesem Plan bleibt hier nichts übrig – Budget oder Karte passen nicht.', true);
      return;
    }
    undoUnits = state.units;
    state.units = clean;
    state.selected = clean.length - 1;
    state.selectedAction = clean[clean.length - 1].actions.length - 1;
    state.pickTower = false;
    refresh();
    // Geladen wird, um weiterzuplanen: Layer zu, Meldung ans Panel.
    openStore(false);
    setPanelNote([label, ...issues].join(' '), { undo: true });
  }

  function shareLink() {
    const code = encodePlan(state.units, { map, faction });
    if (!code) {
      setNote('Dieser Aufmarsch lässt sich nicht als Code darstellen.', { warn: true });
      return;
    }
    const url = `${location.href.split('#')[0].split('?')[0]}?plan=${code}`;
    planCodeEl.value = url;
    // Ohne sicheren Kontext (z. B. per file:// geöffnet) gibt es keine
    // Zwischenablage-API – dann bleibt der Link markiert im Feld stehen.
    const manual = () => {
      planCodeEl.focus();
      planCodeEl.select();
      setNote('Link steht im Feld – bitte von Hand kopieren.');
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => setNote('Link kopiert – er enthält den kompletten Aufmarsch.'), manual);
    } else {
      manual();
    }
  }

  overlayEl.addEventListener('click', (ev) => {
    const t = ev.target;
    // Klick neben die Karte (auf den abgedunkelten Hintergrund) schließt.
    if (t === overlayEl || t.closest('#btn-plan-close')) {
      openStore(false);
      return;
    }
    const load = t.closest('[data-load]');
    if (load) {
      const entry = storeEntries().find((e) => e.id === load.dataset.load);
      if (entry) applyUnits(entry.units, entry.faction, `„${entry.name}" geladen.`);
      return;
    }
    const drop = t.closest('[data-drop]');
    if (drop) {
      planStore.remove(drop.dataset.drop);
      renderStore();
      setNote('Eintrag gelöscht.');
      return;
    }
    if (t.closest('#btn-plan-save')) {
      if (!state.units.length) {
        setNote('Erst eine Aufstellung planen, dann speichern.', { warn: true });
        return;
      }
      const res = planStore.save({ name: planNameEl.value.trim(), faction, units: state.units, config });
      if (!res.ok) {
        setNote(res.error, { warn: true });
        return;
      }
      planNameEl.value = '';
      renderStore();
      setNote(`„${res.entry.name}" gespeichert.`);
      return;
    }
    if (t.closest('#btn-plan-apply')) {
      const res = decodePlan(planCodeEl.value, { map });
      if (!res.ok) {
        setNote(res.error, { warn: true });
        return;
      }
      applyUnits(res.units, res.faction, 'Aufmarsch aus dem Code übernommen.');
      return;
    }
    if (t.closest('#btn-plan-share')) {
      if (!state.units.length) {
        setNote('Erst eine Aufstellung planen, dann teilen.', { warn: true });
        return;
      }
      shareLink();
      return;
    }
  });

  // „↩ Zurück" steht in der Panel-Meldung, nicht im Layer – der ist beim Laden
  // bereits zu.
  hintEl.addEventListener('click', (ev) => {
    if (!ev.target.closest('#btn-plan-undo') || !undoUnits) return;
    state.units = undoUnits;
    undoUnits = null;
    state.selected = state.units.length - 1;
    state.selectedAction = 0;
    state.pickTower = false;
    refresh();
    setPanelNote('Zurückgenommen.');
  });

  if (!planStore.available) {
    setNote('Dieser Browser speichert nichts (privater Modus?) – Teilen-Links funktionieren trotzdem.');
  }

  // --- Chips (Einheitenliste, kompakt) -------------------------------------
  function unitSummary(u) {
    const first = actionSummary(u.actions[0], map.nodes, towers, faction, supplyCamps);
    const extra = u.actions.length - 1;
    return extra > 0 ? `${first} · +${extra} Auftrag${extra > 1 ? 'e' : ''}` : first;
  }

  // Einheitenliste (Roster): je Einheit ein kompakter Chip; die gewählte Einheit
  // klappt ihren Auftrags-Editor direkt darunter auf (Akkordeon). Alles lebt in
  // einem einzigen, höhenbegrenzten Scrollbereich – so bleibt die Karte immer
  // anklickbar, egal wie lang die Liste wird.
  function buildRoster() {
    rosterEl.innerHTML = '';
    state.units.forEach((u, i) => {
      const def = byKey[u.type];
      const selected = i === state.selected;
      const item = document.createElement('div');
      item.className = 'unit' + (selected ? ' selected' : '');

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (selected ? ' selected' : '');
      chip.dataset.selectUnit = i;
      chip.style.setProperty('--fac', fac.color);
      // Porträt aus demselben Atlas wie das Token auf der Karte – die Liste
      // zeigt so dasselbe Gesicht wie das Schlachtfeld. Fehlt die Zelle,
      // bleibt es beim Sinnbild aus der Typdefinition.
      const cell = spriteCell(faction, def.key);
      const pic = cell
        ? `<span class="chip-pic" style="--col:${cell.col};--row:${cell.row};--fac-dark:${fac.dark}"></span>`
        : '';
      chip.innerHTML =
        `<span class="chip-num">${toRoman(i + 1)}</span>` +
        pic +
        `<strong>${cell ? '' : `${def.icon} `}${def.name}</strong>` +
        `<span class="chip-plan">${unitSummary(u)}</span>`;
      item.appendChild(chip);

      if (selected) item.appendChild(buildEditor(u));
      rosterEl.appendChild(item);
    });
  }

  // --- Editor (Auftragskette der gewählten Einheit) ------------------------
  // Baut den Editor-Block der Einheit `u` und gibt ihn als DOM-Knoten zurück
  // (wird vom Roster direkt unter dem gewählten Chip eingehängt).
  function buildEditor(u) {
    const editor = document.createElement('div');
    editor.className = 'editor';

    const list = document.createElement('div');
    list.className = 'action-list';
    u.actions.forEach((a, idx) => {
      const item = document.createElement('div');
      item.className = 'action-item';
      if (idx === state.selectedAction) item.classList.add('selected');

      // Kopfzeile: Nummer, Auslöser-Kennzeichnung, Zusammenfassung, Löschen.
      const line = document.createElement('div');
      line.className = 'action-line';
      line.dataset.selectAct = idx;
      let trigTag = '';
      if (idx > 0) {
        trigTag =
          a.trigger?.kind === 'when'
            ? `<span class="action-trig when">Sobald ${describeCondition(a.trigger.cond, map.nodes)}</span>`
            : `<span class="action-trig then">Dann</span>`;
      }
      line.innerHTML =
        `<span class="action-num">${circled(idx + 1)}</span>` +
        trigTag +
        `<span class="action-sum">${actionSummary(a, map.nodes, towers, faction, supplyCamps)}</span>` +
        (idx > 0 ? `<button class="mini del" data-delact="${idx}" title="Auftrag entfernen">✕</button>` : '');
      item.appendChild(line);

      // Steuerung nur für den aktiven Auftrag.
      if (idx === state.selectedAction) item.appendChild(buildActionControls(u, a, idx));
      list.appendChild(item);
    });
    editor.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'editor-footer';
    if (u.actions.length < MAX_ACTIONS) {
      footer.innerHTML += `<button class="btn ghost add-action" id="btn-add-action" type="button">➕ Auftrag</button>`;
    }
    footer.innerHTML += `<button class="btn ghost" id="btn-remove-unit" type="button" title="Einheit entlassen">🗑 Einheit</button>`;
    editor.appendChild(footer);
    return editor;
  }

  function buildActionControls(u, a, idx) {
    const box = document.createElement('div');
    box.className = 'action-edit';

    // Haltung + Wegpunkt-Rücknahme.
    const stanceRow = document.createElement('div');
    stanceRow.className = 'stance-row';
    stanceRow.innerHTML =
      `<button class="btn mode" data-stance="attack">⚔ Angriff</button>` +
      `<button class="btn mode" data-stance="defend">🛡 Halten</button>` +
      `<button class="btn ghost" data-undo title="Letzten Wegpunkt entfernen">↩</button>`;
    for (const b of stanceRow.querySelectorAll('[data-stance]')) {
      b.classList.toggle('active', b.dataset.stance === a.stance);
    }
    box.appendChild(stanceRow);

    // Auslöser (nur ab dem zweiten Auftrag).
    if (idx > 0) {
      const trigRow = document.createElement('div');
      trigRow.className = 'trigger-row';
      const isWhen = a.trigger?.kind === 'when';
      trigRow.innerHTML =
        `<span class="trigger-label">Start:</span>` +
        `<button class="btn mode trig" data-trig="then">Dann</button>` +
        `<button class="btn mode trig" data-trig="when">Sobald …</button>`;
      trigRow.querySelector('[data-trig="then"]').classList.toggle('active', !isWhen);
      trigRow.querySelector('[data-trig="when"]').classList.toggle('active', isWhen);
      box.appendChild(trigRow);

      if (isWhen) {
        const cond = a.trigger.cond ?? {};
        const condRow = document.createElement('div');
        condRow.className = 'cond-row';
        const options = EVENT_CONDITIONS.filter((c) => !c.needsTower || hasEnemyTowers)
          .map(
            (c) => `<option value="${c.type}" ${c.type === cond.type ? 'selected' : ''}>${c.label}</option>`
          )
          .join('');
        condRow.innerHTML = `<select class="cond-select" data-cond>${options}</select>`;
        const def = EVENT_CONDITION_BY_TYPE[cond.type];
        if (def?.needsTower) {
          const picked = cond.node ? `Turm ${map.nodes[cond.node].name} ✓` : 'Turm antippen';
          condRow.innerHTML +=
            `<button class="btn ghost tower-pick ${state.pickTower ? 'active' : ''}" data-pick>${picked}</button>`;
        }
        box.appendChild(condRow);
      }
    }
    return box;
  }

  // Roster-Interaktionen (Delegation, da Liste und Editor je refresh neu gebaut
  // werden). Zuerst die Einheitenauswahl – sie greift unabhängig davon, welche
  // Einheit gerade gewählt ist.
  rosterEl.addEventListener('click', (ev) => {
    const t = ev.target;
    const pickUnit = t.closest('[data-select-unit]');
    if (pickUnit) {
      const i = Number(pickUnit.dataset.selectUnit);
      state.selected = i;
      state.selectedAction = state.units[i].actions.length - 1;
      state.pickTower = false;
      refresh();
      return;
    }
    const u = selectedUnit();
    if (!u) return;
    if (t.closest('#btn-add-action')) {
      if (u.actions.length >= MAX_ACTIONS) return;
      u.actions.push({ path: [], stance: 'attack', trigger: { kind: 'then' } });
      state.selectedAction = u.actions.length - 1;
      state.pickTower = false;
      refresh();
      return;
    }
    if (t.closest('#btn-remove-unit')) {
      state.units.splice(state.selected, 1);
      state.selected = Math.min(state.selected, state.units.length - 1);
      state.selectedAction = 0;
      state.pickTower = false;
      refresh();
      return;
    }
    const del = t.closest('[data-delact]');
    if (del) {
      const idx = Number(del.dataset.delact);
      u.actions.splice(idx, 1);
      state.selectedAction = Math.min(state.selectedAction, u.actions.length - 1);
      state.pickTower = false;
      refresh();
      return;
    }
    const selLine = t.closest('[data-select-act]');
    if (selLine && !t.closest('[data-delact]')) {
      state.selectedAction = Number(selLine.dataset.selectAct);
      state.pickTower = false;
      refresh();
      return;
    }
    const stance = t.closest('[data-stance]');
    if (stance) {
      const a = selectedActionObj();
      if (a) a.stance = stance.dataset.stance;
      refresh();
      return;
    }
    const undo = t.closest('[data-undo]');
    if (undo) {
      const a = selectedActionObj();
      if (a) a.path.pop();
      refresh();
      return;
    }
    const trig = t.closest('[data-trig]');
    if (trig) {
      const a = selectedActionObj();
      if (a) {
        if (trig.dataset.trig === 'then') {
          a.trigger = { kind: 'then' };
          state.pickTower = false;
        } else {
          const first = EVENT_CONDITIONS[0];
          a.trigger = { kind: 'when', cond: { type: first.type } };
          state.pickTower = !!first.needsTower;
        }
      }
      refresh();
      return;
    }
    const pick = t.closest('[data-pick]');
    if (pick) {
      state.pickTower = !state.pickTower;
      refresh();
      return;
    }
  });

  rosterEl.addEventListener('change', (ev) => {
    const sel = ev.target.closest('[data-cond]');
    if (!sel) return;
    const a = selectedActionObj();
    if (!a || a.trigger?.kind !== 'when') return;
    const def = EVENT_CONDITION_BY_TYPE[sel.value];
    a.trigger.cond = { type: sel.value };
    state.pickTower = !!def?.needsTower; // Turm-Bedingung: gleich zum Antippen auffordern
    refresh();
  });

  function refresh() {
    closeConfirmAsk();
    const used = spent();
    budgetEl.textContent = `${used}/${state.budget} ⬢`;
    for (const b of recruitButtons) {
      b.disabled = byKey[b.dataset.type].cost > state.budget - used;
    }
    if (state.selected >= state.units.length) state.selected = state.units.length - 1;
    buildRoster();
  }

  for (const b of recruitButtons) {
    b.addEventListener('click', () => {
      const def = byKey[b.dataset.type];
      if (spent() + def.cost > state.budget) {
        flashHint('Nicht genug Ressourcen für diese Einheit.');
        return;
      }
      state.units.push({ type: def.key, actions: [{ path: [], stance: 'attack', trigger: null }] });
      state.selected = state.units.length - 1;
      state.selectedAction = 0;
      state.pickTower = false;
      refresh();
    });
  }

  function onCanvasClick(ev) {
    const nodeId = renderer.hitNode(ev.clientX, ev.clientY);
    if (!nodeId) return;
    const unit = selectedUnit();
    if (!unit) {
      flashHint('Zuerst eine Einheit anwerben.');
      return;
    }
    const action = selectedActionObj();
    if (!action) return;

    // Turm-Wahl für eine „Sobald"-Bedingung.
    if (state.pickTower) {
      if (!isEnemyTower(nodeId)) {
        flashHint('Bitte einen gegnerischen Turm antippen.');
        return;
      }
      if (action.trigger?.kind === 'when') {
        action.trigger.cond = { type: 'towerDown', node: nodeId };
      }
      state.pickTower = false;
      refresh();
      return;
    }

    const end = actionEnd(unit, state.selectedAction);
    if (nodeId === end) {
      // Erneutes Antippen des Pfadendes nimmt den letzten Schritt zurück
      // (nur eigene Wegpunkte des Auftrags, nicht den Anker).
      if (action.path.length) action.path.pop();
      refresh();
      return;
    }
    if (!map.adjacency[end].includes(nodeId)) {
      flashHint('Nur direkt verbundene Wegpunkte wählbar – Pfad Schritt für Schritt aufbauen.');
      return;
    }
    if (action.path.length >= MAX_PATH_LENGTH) {
      flashHint(`Maximal ${MAX_PATH_LENGTH} Wegpunkte pro Auftrag.`);
      return;
    }
    action.path.push(nodeId);
    refresh();
  }
  canvas.addEventListener('click', onCanvasClick);

  // Reaktions-Aufträge ohne gewähltes Turm-Ziel sind unvollständig – der Spieler
  // muss die Bedingung vervollständigen, bevor die Schlacht startet.
  function incompleteReaction() {
    for (const u of state.units) {
      for (let idx = 0; idx < u.actions.length; idx++) {
        const a = u.actions[idx];
        if (!isReaction(a, idx)) continue;
        const cond = a.trigger.cond;
        if (!cond?.type) return true;
        if (EVENT_CONDITION_BY_TYPE[cond.type]?.needsTower && !cond.node) return true;
      }
    }
    return false;
  }

  function commit() {
    destroy();
    // Nur die reinen Plandaten übergeben (tiefe Kopie der Aufträge).
    const units = state.units.map((u) => ({
      type: u.type,
      actions: u.actions.map((a) => ({
        path: [...a.path],
        stance: a.stance,
        trigger: a.trigger ? JSON.parse(JSON.stringify(a.trigger)) : null,
      })),
    }));
    // Der zuletzt gespielte Aufmarsch wird immer gemerkt – eine Revanche soll
    // nie bei null anfangen, auch wenn niemand ans Speichern gedacht hat.
    planStore.rememberLast(faction, units, config);
    onConfirm(units);
  }

  panel.querySelector('#btn-confirm').addEventListener('click', () => {
    if (!state.units.length) {
      flashHint('Mindestens eine Einheit anwerben, bevor es losgeht.');
      return;
    }
    if (incompleteReaction()) {
      flashHint('Ein „Sobald"-Auftrag hat noch keinen Ziel-Turm – bitte den Turm antippen.');
      return;
    }
    const left = state.budget - spent();
    if (left > 0) {
      confirmAskMsg.textContent = `Noch ${left} ⬢ ungenutzt – du könntest weitere Einheiten anwerben. Trotzdem starten?`;
      confirmAsk.hidden = false;
      return;
    }
    commit();
  });

  panel.querySelector('#btn-confirm-cancel').addEventListener('click', closeConfirmAsk);
  panel.querySelector('#btn-confirm-go').addEventListener('click', commit);

  function destroy() {
    canvas.removeEventListener('click', onCanvasClick);
    document.removeEventListener('keydown', onKeyDown);
    // Der Layer lebt außerhalb des Panels und würde sonst über der nächsten
    // Phase stehen bleiben.
    overlayEl.hidden = true;
    cardEl.innerHTML = '';
  }

  refresh();
  renderStore();

  // Ein Plan aus der Adresszeile wird sofort eingelöst – die Aufstellung steht
  // dann schon da. Nur wenn der Code nicht taugt, öffnet sich die Bibliothek:
  // dort lässt sich ein anderer einfügen.
  if (initialCode) {
    const res = decodePlan(initialCode, { map });
    if (res.ok) {
      applyUnits(res.units, res.faction, 'Aufmarsch aus dem Link übernommen.');
    } else {
      openStore(true);
      setNote(res.error, { warn: true });
    }
  } else if (planStore.last(faction)) {
    hintEl.textContent = 'Gespeicherte Aufmärsche liegen bereit – 💾 öffnet sie.';
  }

  return { state, destroy };
}
