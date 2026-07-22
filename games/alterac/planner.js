// Planungsphase: Befehlsvergabe pro Einheit (Angriff / Verteidigung / Folgen).
// Baut das Bedienpanel auf und verarbeitet Karten-Taps.

import { FACTIONS, enemyOf } from './map.js';
import { MAX_ATTACK_TARGETS } from './config.js';

export function orderSummary(order, nodes) {
  if (!order) return '⚔ Auto: zum Boss';
  if (order.type === 'attack') {
    return `⚔ ${order.targets.map((t) => nodes[t].name).join(' → ')}`;
  }
  if (order.type === 'defend') return `🛡 ${nodes[order.target].name}`;
  return `⇢ folgt #${order.target + 1}`;
}

// Verhindert Folgen-Zyklen (A folgt B folgt A).
function wouldCycle(orders, follower, target) {
  let j = target;
  const seen = new Set();
  while (orders[j] && orders[j].type === 'follow') {
    if (j === follower || seen.has(j)) return true;
    seen.add(j);
    j = orders[j].target;
  }
  return j === follower;
}

export function createPlanner({ map, faction, unitCount, panel, canvas, renderer, onConfirm }) {
  const state = {
    faction,
    unitCount,
    orders: new Array(unitCount).fill(null),
    selected: 0,
    mode: 'attack',
  };
  const fac = FACTIONS[faction];

  panel.innerHTML = `
    <div class="panel-head">
      <span class="plan-title" style="--fac:${fac.color}">${fac.name} · ${fac.player} plant</span>
      <button class="btn primary" id="btn-confirm" style="--fac:${fac.color};--fac-dark:${fac.dark}">Bestätigen ✓</button>
    </div>
    <div class="chips" id="chips"></div>
    <div class="mode-row">
      <button class="btn mode" data-mode="attack">⚔ Angriff</button>
      <button class="btn mode" data-mode="defend">🛡 Verteidigen</button>
      <button class="btn mode" data-mode="follow">⇢ Folgen</button>
      <button class="btn ghost" id="btn-undo" title="Letztes Ziel entfernen">↩</button>
      <button class="btn ghost" id="btn-clear" title="Befehl löschen">✕</button>
    </div>
    <p class="hint" id="hint"></p>
  `;

  const chipsEl = panel.querySelector('#chips');
  const hintEl = panel.querySelector('#hint');
  const modeButtons = [...panel.querySelectorAll('.mode')];

  const HINTS = {
    attack:
      'Kampfpunkte antippen, um die Angriffsroute festzulegen. Danach zieht die Einheit automatisch zum gegnerischen Boss.',
    defend: 'Einen Kampfpunkt oder den eigenen Boss antippen – die Einheit hält dort Stellung (×1,5, wenn sie zuerst da ist).',
    follow: 'Eine andere Einheit in der Leiste antippen – beide fusionieren dauerhaft zu einer Gruppe.',
  };

  let hintTimer = 0;
  function flashHint(text) {
    hintEl.textContent = text;
    hintEl.classList.add('warn');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.classList.remove('warn');
      hintEl.textContent = HINTS[state.mode];
    }, 2200);
  }

  function refresh() {
    chipsEl.innerHTML = '';
    for (let i = 0; i < unitCount; i++) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      if (i === state.selected) chip.classList.add('selected');
      if (state.mode === 'follow' && i !== state.selected) chip.classList.add('pickable');
      chip.style.setProperty('--fac', fac.color);
      chip.innerHTML = `<strong>#${i + 1}</strong><span>${orderSummary(state.orders[i], map.nodes)}</span>`;
      chip.addEventListener('click', () => {
        if (state.mode === 'follow' && i !== state.selected) {
          if (wouldCycle(state.orders, state.selected, i)) {
            flashHint('Nicht möglich – das ergäbe einen Kreis aus Folgen-Befehlen.');
            return;
          }
          state.orders[state.selected] = { type: 'follow', target: i };
          state.mode = 'attack';
        } else {
          state.selected = i;
        }
        syncModes();
        refresh();
      });
      chipsEl.appendChild(chip);
    }
  }

  function syncModes() {
    for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === state.mode);
    hintEl.classList.remove('warn');
    hintEl.textContent = HINTS[state.mode];
  }

  for (const b of modeButtons) {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      syncModes();
      refresh();
    });
  }

  panel.querySelector('#btn-undo').addEventListener('click', () => {
    const o = state.orders[state.selected];
    if (o && o.type === 'attack' && o.targets.length > 1) o.targets.pop();
    else state.orders[state.selected] = null;
    refresh();
  });
  panel.querySelector('#btn-clear').addEventListener('click', () => {
    state.orders[state.selected] = null;
    refresh();
  });

  function onCanvasClick(ev) {
    const nodeId = renderer.hitNode(ev.clientX, ev.clientY);
    if (!nodeId) return;
    const node = map.nodes[nodeId];
    if (state.mode === 'attack') {
      if (node.type !== 'combat') {
        flashHint(
          node.type === 'graveyard'
            ? 'Friedhöfe sind keine gültigen Ziele.'
            : 'Der Boss wird nach der Sequenz automatisch angegriffen.'
        );
        return;
      }
      let o = state.orders[state.selected];
      if (!o || o.type !== 'attack') {
        o = { type: 'attack', targets: [] };
        state.orders[state.selected] = o;
      }
      if (o.targets.length >= MAX_ATTACK_TARGETS) {
        flashHint(`Maximal ${MAX_ATTACK_TARGETS} Ziele pro Sequenz.`);
        return;
      }
      if (o.targets[o.targets.length - 1] === nodeId) return;
      o.targets.push(nodeId);
    } else if (state.mode === 'defend') {
      const ownBoss = map.bosses[state.faction];
      if (node.type === 'combat' || nodeId === ownBoss) {
        state.orders[state.selected] = { type: 'defend', target: nodeId };
      } else if (nodeId === map.bosses[enemyOf(state.faction)]) {
        flashHint('Der gegnerische Boss lässt sich nicht verteidigen.');
        return;
      } else {
        flashHint('Friedhöfe sind keine gültigen Ziele.');
        return;
      }
    } else {
      flashHint('Zum Folgen eine Einheit in der Leiste antippen.');
      return;
    }
    refresh();
  }
  canvas.addEventListener('click', onCanvasClick);

  panel.querySelector('#btn-confirm').addEventListener('click', () => {
    destroy();
    onConfirm(state.orders);
  });

  function destroy() {
    canvas.removeEventListener('click', onCanvasClick);
  }

  syncModes();
  refresh();
  return { state, destroy };
}
