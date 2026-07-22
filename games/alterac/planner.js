// Planungsphase: Armee aus dem Ressourcenbudget zusammenstellen und für jede
// Einheit einen eigenen Plan festlegen – ein konkreter Pfad über benachbarte
// Wegpunkte plus Haltung (Angriff oder Halten). Baut das Bedienpanel auf und
// verarbeitet Karten-Taps.

import { FACTIONS } from './map.js';
import { UNIT_TYPES, UNIT_TYPE_BY_KEY, MAX_PATH_LENGTH } from './config.js';

// Kurzbeschreibung des Plans einer Einheit für die Einheitenleiste.
export function planSummary(unit, nodes) {
  const names = unit.path.map((id) => nodes[id].name);
  if (unit.stance === 'defend') {
    return `🛡 hält ${names.length ? names[names.length - 1] : 'die Basis'}`;
  }
  return names.length ? `⚔ ${names.join(' → ')}` : '⚔ direkt zum Boss';
}

const fmt = (n) => String(n).replace('.', ',');

export function createPlanner({ map, faction, budget, panel, canvas, renderer, onConfirm }) {
  const state = {
    faction,
    budget,
    units: [], // { type, path: [nodeId…], stance: 'attack' | 'defend' }
    selected: -1,
  };
  const fac = FACTIONS[faction];
  const start = map.start[faction];

  const spent = () => state.units.reduce((s, u) => s + UNIT_TYPE_BY_KEY[u.type].cost, 0);

  panel.innerHTML = `
    <div class="panel-head">
      <span class="plan-title" style="--fac:${fac.color}">${fac.name} · ${fac.player} plant</span>
      <button class="btn primary" id="btn-confirm" style="--fac:${fac.color};--fac-dark:${fac.dark}">Bestätigen ✓</button>
    </div>
    <div class="recruit-row">
      <span class="budget" id="budget"></span>
      ${UNIT_TYPES.map(
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
  `;

  const chipsEl = panel.querySelector('#chips');
  const hintEl = panel.querySelector('#hint');
  const budgetEl = panel.querySelector('#budget');
  const stanceButtons = [...panel.querySelectorAll('.mode')];
  const recruitButtons = [...panel.querySelectorAll('.recruit')];

  const DEFAULT_HINT =
    'Einheiten anwerben, dann den Pfad der gewählten Einheit Wegpunkt für Wegpunkt antippen ' +
    '(nur benachbarte Punkte). Friedhöfe sind Sackgassen: Hin- und Rückweg einplanen – dort ' +
    'beginnt die Einnahme automatisch. „Halten" bewacht das Pfadende, „Angriff" zieht danach zum Boss.';

  let hintTimer = 0;
  function flashHint(text) {
    hintEl.textContent = text;
    hintEl.classList.add('warn');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.classList.remove('warn');
      hintEl.textContent = DEFAULT_HINT;
    }, 2600);
  }

  function refresh() {
    const used = spent();
    budgetEl.textContent = `${used}/${state.budget} ⬢`;
    for (const b of recruitButtons) {
      b.disabled = UNIT_TYPE_BY_KEY[b.dataset.type].cost > state.budget - used;
    }
    const sel = state.units[state.selected] ?? null;
    for (const b of stanceButtons) {
      b.classList.toggle('active', sel != null && b.dataset.stance === sel.stance);
      b.disabled = sel == null;
    }
    chipsEl.innerHTML = '';
    state.units.forEach((u, i) => {
      const def = UNIT_TYPE_BY_KEY[u.type];
      const chip = document.createElement('button');
      chip.className = 'chip';
      if (i === state.selected) chip.classList.add('selected');
      chip.style.setProperty('--fac', fac.color);
      chip.innerHTML = `<strong>${def.icon} ${def.name}</strong><span>${planSummary(u, map.nodes)}</span>`;
      chip.addEventListener('click', () => {
        state.selected = i;
        refresh();
      });
      chipsEl.appendChild(chip);
    });
  }

  for (const b of recruitButtons) {
    b.addEventListener('click', () => {
      const def = UNIT_TYPE_BY_KEY[b.dataset.type];
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

  panel.querySelector('#btn-confirm').addEventListener('click', () => {
    if (!state.units.length) {
      flashHint('Mindestens eine Einheit anwerben, bevor es losgeht.');
      return;
    }
    destroy();
    onConfirm(state.units.map((u) => ({ type: u.type, path: [...u.path], stance: u.stance })));
  });

  function destroy() {
    canvas.removeEventListener('click', onCanvasClick);
  }

  hintEl.textContent = DEFAULT_HINT;
  refresh();
  return { state, destroy };
}
