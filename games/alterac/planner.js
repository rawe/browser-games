// Planungsphase: Armee aus dem Ressourcenbudget zusammenstellen und für jede
// Einheit eine Auftragskette festlegen. Ein Auftrag ist ein Pfad über
// benachbarte Wegpunkte plus Haltung (Angriff oder Halten); optional startet er
// erst „Dann" (nach dem vorigen Auftrag) oder „Sobald" ein globales Event
// eintritt (Unterbrechung). Baut das Bedienpanel auf und verarbeitet Karten-Taps.

import { FACTIONS, towerNodes, enemyOf } from './map.js';
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

// Kreis-Ziffern für die Auftragsnummer (1-basiert).
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];
const circled = (n) => CIRCLED[n - 1] ?? `(${n})`;

// Kurzbeschreibung eines einzelnen Auftrags für Chip und Auftragsliste. `towers`
// ist die aktive Turmzuordnung { nodeId: faction }; endet der Angriffspfad auf
// einem gegnerischen Turm, wird das ausdrückliche Turm-Ziel benannt.
export function actionSummary(action, nodes, towers = {}, faction = null) {
  const path = action.path ?? [];
  const names = path.map((id) => nodes[id].name);
  const endId = path.length ? path[path.length - 1] : null;
  const endTowerFaction = endId ? towers[endId] : undefined;
  if (action.stance === 'defend') {
    if (endTowerFaction && faction && endTowerFaction === faction) {
      return `🛡 verteidigt Turm ${names[names.length - 1]}`;
    }
    return `🛡 hält ${names.length ? names[names.length - 1] : 'die Basis'}`;
  }
  if (endTowerFaction && faction && endTowerFaction !== faction) {
    return `⚔ ${names.join(' → ')} · greift Turm an`;
  }
  return names.length ? `⚔ ${names.join(' → ')}` : '⚔ direkt zum Boss';
}

const fmt = (n) => String(n).replace('.', ',');

export function createPlanner({ map, faction, budget, config, panel, canvas, renderer, onConfirm }) {
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
    'Einheiten anwerben, dann den Pfad des gewählten Auftrags Wegpunkt für Wegpunkt antippen ' +
    '(nur benachbarte Punkte). Mit „➕ Auftrag" hängst du weitere Aufträge an – so greift eine Einheit ' +
    'z. B. erst Turm A, dann Turm B an. Ein Zusatz-Auftrag startet „Dann" (nach dem vorigen) oder „Sobald" ' +
    'ein globales Event eintritt (z. B. „Boss-Schild des Gegners fällt") – dann unterbricht er, was die ' +
    'Einheit gerade tut. Ohne weiteren Auftrag zieht „Angriff" danach zum Boss, „Halten" bewacht das ' +
    'Pfadende. Türme werden nur angegriffen, wenn ein Angriffs-Auftrag ausdrücklich auf einem ' +
    'gegnerischen Turm endet.';

  panel.innerHTML = `
    <div class="map-settings">
      <button class="btn ghost map-toggle active" id="btn-targets" type="button" aria-pressed="true">
        <span class="map-toggle-dot" aria-hidden="true"></span>
        🎯 Ziele der übrigen Trupps auf der Karte zeigen
      </button>
    </div>
    <div class="panel-head">
      <span class="plan-title" style="--fac:${fac.color}">${fac.name} · ${fac.player} plant</span>
      <button class="btn ghost help-toggle" id="btn-help" type="button"
        title="Hilfe anzeigen" aria-expanded="false" aria-controls="help-text">?</button>
    </div>
    <p class="help-text" id="help-text" hidden>${DEFAULT_HINT}</p>
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
    <div class="chips" id="chips"></div>
    <div class="editor" id="editor" hidden></div>
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

  const chipsEl = panel.querySelector('#chips');
  const editorEl = panel.querySelector('#editor');
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

  // --- Chips (Einheitenliste, kompakt) -------------------------------------
  function unitSummary(u) {
    const first = actionSummary(u.actions[0], map.nodes, towers, faction);
    const extra = u.actions.length - 1;
    return extra > 0 ? `${first} · +${extra} Auftrag${extra > 1 ? 'e' : ''}` : first;
  }

  function buildChips() {
    chipsEl.innerHTML = '';
    state.units.forEach((u, i) => {
      const def = byKey[u.type];
      const chip = document.createElement('button');
      chip.className = 'chip';
      if (i === state.selected) chip.classList.add('selected');
      chip.style.setProperty('--fac', fac.color);
      chip.innerHTML =
        `<span class="chip-num">${toRoman(i + 1)}</span>` +
        `<strong>${def.icon} ${def.name}</strong>` +
        `<span class="chip-plan">${unitSummary(u)}</span>`;
      chip.addEventListener('click', () => {
        state.selected = i;
        state.selectedAction = u.actions.length - 1;
        state.pickTower = false;
        refresh();
      });
      chipsEl.appendChild(chip);
    });
  }

  // --- Editor (Auftragskette der gewählten Einheit) ------------------------
  function buildEditor() {
    const u = selectedUnit();
    editorEl.hidden = !u;
    editorEl.innerHTML = '';
    if (!u) return;

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
        `<span class="action-sum">${actionSummary(a, map.nodes, towers, faction)}</span>` +
        (idx > 0 ? `<button class="mini del" data-delact="${idx}" title="Auftrag entfernen">✕</button>` : '');
      item.appendChild(line);

      // Steuerung nur für den aktiven Auftrag.
      if (idx === state.selectedAction) item.appendChild(buildActionControls(u, a, idx));
      list.appendChild(item);
    });
    editorEl.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'editor-footer';
    if (u.actions.length < MAX_ACTIONS) {
      footer.innerHTML += `<button class="btn ghost add-action" id="btn-add-action" type="button">➕ Auftrag</button>`;
    }
    footer.innerHTML += `<button class="btn ghost" id="btn-remove-unit" type="button" title="Einheit entlassen">🗑 Einheit</button>`;
    editorEl.appendChild(footer);
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

  // Editor-Interaktionen (Delegation, da der Editor je refresh neu gebaut wird).
  editorEl.addEventListener('click', (ev) => {
    const u = selectedUnit();
    if (!u) return;
    const t = ev.target;
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

  editorEl.addEventListener('change', (ev) => {
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
    buildChips();
    buildEditor();
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
    onConfirm(
      state.units.map((u) => ({
        type: u.type,
        actions: u.actions.map((a) => ({
          path: [...a.path],
          stance: a.stance,
          trigger: a.trigger ? JSON.parse(JSON.stringify(a.trigger)) : null,
        })),
      }))
    );
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
  }

  refresh();
  return { state, destroy };
}
