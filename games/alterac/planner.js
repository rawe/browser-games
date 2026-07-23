// Planungsphase: Armee aus dem Ressourcenbudget zusammenstellen und für jede
// Einheit einen eigenen Plan festlegen – ein konkreter Pfad über benachbarte
// Wegpunkte plus Haltung (Angriff oder Halten). Baut das Bedienpanel auf und
// verarbeitet Karten-Taps.

import { FACTIONS, towerNodes } from './map.js';
import { resolveUnitTypes, resolveUnitTypeMap, MAX_PATH_LENGTH, toRoman } from './config.js';

// Kurzbeschreibung des Plans einer Einheit für die Einheitenleiste. `towers`
// ist die aktive Turmzuordnung { nodeId: faction }; endet der Pfad auf einem
// Turm, wird das ausdrückliche Turm-Ziel benannt.
export function planSummary(unit, nodes, towers = {}, faction = null) {
  const names = unit.path.map((id) => nodes[id].name);
  const endId = unit.path.length ? unit.path[unit.path.length - 1] : null;
  const endTowerFaction = endId ? towers[endId] : undefined;
  if (unit.stance === 'defend') {
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
    units: [], // { type, path: [nodeId…], stance: 'attack' | 'defend' }
    selected: -1,
    // Karteneinstellung: Ziel-Marker der übrigen Trupps auf der Karte zeigen
    // (nur das Ziel, nicht den ganzen Pfad). Vom Renderer (drawPlanning) gelesen.
    showTargets: true,
  };
  const fac = FACTIONS[faction];
  const start = map.start[faction];
  // Aktive Turmzuordnung { nodeId: faction } für die Plan-Zusammenfassungen.
  const towers = towerNodes(map, config?.towersPerFaction ?? 0);
  // Effektive Einheitenwerte dieser Partie (Datei-Defaults ggf. überschrieben).
  const unitTypes = resolveUnitTypes(config);
  const byKey = resolveUnitTypeMap(config);

  const spent = () => state.units.reduce((s, u) => s + byKey[u.type].cost, 0);

  const DEFAULT_HINT =
    'Einheiten anwerben, dann den Pfad der gewählten Einheit Wegpunkt für Wegpunkt antippen ' +
    '(nur benachbarte Punkte). Jede Einheit trägt eine römische Ziffer – dieselbe Kennung erscheint ' +
    'später auf ihrem Token in der Schlacht. Friedhöfe sind Sackgassen: Hin- und Rückweg einplanen – dort ' +
    'beginnt die Einnahme automatisch. „Halten" bewacht das Pfadende, „Angriff" zieht danach zum Boss. ' +
    'Türme (an den Toren) werden nur angegriffen, wenn der Pfad ausdrücklich auf einem gegnerischen ' +
    'Turm endet; ein eigener Turm lässt sich mit „Halten" verteidigen. Der Schalter oben zeigt die Ziele ' +
    'der übrigen Trupps direkt auf der Karte (Fraktionsfarbe = Angriff, Gold = Halten).';

  panel.innerHTML = `
    <div class="panel-head">
      <span class="plan-title" style="--fac:${fac.color}">${fac.name} · ${fac.player} plant</span>
      <button class="btn ghost help-toggle" id="btn-help" type="button"
        title="Hilfe anzeigen" aria-expanded="false" aria-controls="help-text">?</button>
    </div>
    <p class="help-text" id="help-text" hidden>${DEFAULT_HINT}</p>
    <div class="map-settings">
      <button class="btn ghost map-toggle active" id="btn-targets" type="button" aria-pressed="true">
        <span class="map-toggle-dot" aria-hidden="true"></span>
        🎯 Ziele der übrigen Trupps zeigen
      </button>
    </div>
    <div class="recruit-row">
      <span class="budget" id="budget"></span>
      ${unitTypes.map(
        (t) => `
        <button class="btn recruit" data-type="${t.key}"
          title="${t.desc} ${t.hp} LP · ${t.damage} Schaden alle ${fmt(t.attackInterval)} s · Tempo ×${fmt(t.speed)}">
          ${t.icon} ${t.name} <small>· ${t.cost}</small>
        </button>`
      ).join('')}
    </div>
    <div class="chips" id="chips"></div>
    <div class="mode-row">
      <button class="btn mode" data-stance="attack">⚔ Angriff</button>
      <button class="btn mode" data-stance="defend">🛡 Halten</button>
      <button class="btn ghost" id="btn-undo" title="Letzten Wegpunkt entfernen">↩</button>
      <button class="btn ghost" id="btn-remove" title="Einheit entlassen">🗑</button>
    </div>
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
  const hintEl = panel.querySelector('#hint');
  const budgetEl = panel.querySelector('#budget');
  const stanceButtons = [...panel.querySelectorAll('.mode')];
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

  // Rückfrage zum Bestätigen zurücknehmen, sobald die Armee wieder verändert wird.
  function closeConfirmAsk() {
    confirmAsk.hidden = true;
  }

  helpToggle.addEventListener('click', () => {
    const show = helpText.hidden;
    helpText.hidden = !show;
    helpToggle.classList.toggle('active', show);
    helpToggle.setAttribute('aria-expanded', String(show));
  });

  // Karteneinstellung: Ziel-Marker der übrigen Trupps ein-/ausblenden. Der
  // Renderer liest `state.showTargets` jeden Frame – kein refresh() nötig.
  const targetsToggle = panel.querySelector('#btn-targets');
  targetsToggle.addEventListener('click', () => {
    state.showTargets = !state.showTargets;
    targetsToggle.classList.toggle('active', state.showTargets);
    targetsToggle.setAttribute('aria-pressed', String(state.showTargets));
  });

  function refresh() {
    closeConfirmAsk();
    const used = spent();
    budgetEl.textContent = `${used}/${state.budget} ⬢`;
    for (const b of recruitButtons) {
      b.disabled = byKey[b.dataset.type].cost > state.budget - used;
    }
    const sel = state.units[state.selected] ?? null;
    for (const b of stanceButtons) {
      b.classList.toggle('active', sel != null && b.dataset.stance === sel.stance);
      b.disabled = sel == null;
    }
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
        `<span class="chip-plan">${planSummary(u, map.nodes, towers, faction)}</span>`;
      chip.addEventListener('click', () => {
        state.selected = i;
        refresh();
      });
      chipsEl.appendChild(chip);
    });
  }

  for (const b of recruitButtons) {
    b.addEventListener('click', () => {
      const def = byKey[b.dataset.type];
      if (spent() + def.cost > state.budget) {
        flashHint('Nicht genug Ressourcen für diese Einheit.');
        return;
      }
      state.units.push({ type: def.key, path: [], stance: 'attack' });
      state.selected = state.units.length - 1;
      refresh();
    });
  }

  for (const b of stanceButtons) {
    b.addEventListener('click', () => {
      const sel = state.units[state.selected];
      if (!sel) return;
      sel.stance = b.dataset.stance;
      refresh();
    });
  }

  panel.querySelector('#btn-undo').addEventListener('click', () => {
    const sel = state.units[state.selected];
    if (sel) sel.path.pop();
    refresh();
  });

  panel.querySelector('#btn-remove').addEventListener('click', () => {
    if (state.selected < 0) return;
    state.units.splice(state.selected, 1);
    state.selected = Math.min(state.selected, state.units.length - 1);
    refresh();
  });

  function onCanvasClick(ev) {
    const nodeId = renderer.hitNode(ev.clientX, ev.clientY);
    if (!nodeId) return;
    const sel = state.units[state.selected];
    if (!sel) {
      flashHint('Zuerst eine Einheit anwerben.');
      return;
    }
    const end = sel.path.length ? sel.path[sel.path.length - 1] : start;
    if (nodeId === end) {
      // Erneutes Antippen des Pfadendes nimmt den letzten Schritt zurück.
      sel.path.pop();
      refresh();
      return;
    }
    if (!map.adjacency[end].includes(nodeId)) {
      flashHint('Nur direkt verbundene Wegpunkte wählbar – Pfad Schritt für Schritt aufbauen.');
      return;
    }
    if (sel.path.length >= MAX_PATH_LENGTH) {
      flashHint(`Maximal ${MAX_PATH_LENGTH} Wegpunkte pro Pfad.`);
      return;
    }
    sel.path.push(nodeId);
    refresh();
  }
  canvas.addEventListener('click', onCanvasClick);

  function commit() {
    destroy();
    onConfirm(state.units.map((u) => ({ type: u.type, path: [...u.path], stance: u.stance })));
  }

  panel.querySelector('#btn-confirm').addEventListener('click', () => {
    if (!state.units.length) {
      flashHint('Mindestens eine Einheit anwerben, bevor es losgeht.');
      return;
    }
    const left = state.budget - spent();
    if (left > 0) {
      // Ungenutztes Budget: bewusste Rückfrage, damit nicht versehentlich gestartet wird.
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
