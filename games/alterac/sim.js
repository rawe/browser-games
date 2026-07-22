// Simulationskern – DOM-frei und deterministisch.
//
// Zeitmodell: kontinuierliche Zeit mit exakten Ereigniszeitpunkten (Ankünfte,
// Respawns). Alle Ereignisse desselben Zeitpunkts werden gemeinsam verarbeitet,
// damit gleichzeitige Ankünfte korrekt behandelt werden (kein Verteidigungs-
// bonus, gleichzeitiger Boss-Sieg = Unentschieden).

import { FACTIONS, enemyOf, shortestPath, nearestGraveyard } from './map.js';

const EPS = 1e-6;

// plans: { blue: orders[], red: orders[] } mit orders[i] =
//   null                                    → Auto-Angriff auf den gegnerischen Boss
//   { type: 'attack', targets: [nodeId…] }  → Angriffssequenz
//   { type: 'defend', target: nodeId }      → Verteidigung
//   { type: 'follow', target: unitIndex }   → dauerhafte Fusion
export function createSim({ map, config, plans }) {
  const { edgeTime, respawnTime, bossStrength, maxTime } = config;
  const groups = [];
  const log = [];
  const tieKeys = new Map();
  const bossAlive = { blue: true, red: true };
  let time = 0;
  let result = null;

  const fmt = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
  const nodeName = (id) => map.nodes[id].name;
  const addLog = (text) => log.push({ t: time, text });

  // --- Gruppen aus den Plänen bauen: Folgen-Befehle werden sofort fusioniert ---
  for (const faction of ['blue', 'red']) {
    const orders = plans[faction];
    const rootOf = (i) => {
      let j = i;
      const seen = new Set([i]);
      for (;;) {
        const o = orders[j];
        if (!o || o.type !== 'follow') return j;
        if (seen.has(o.target)) return j; // Zyklus: Einheit agiert als eigene Gruppe
        seen.add(o.target);
        j = o.target;
      }
    };
    const byRoot = new Map();
    for (let i = 0; i < orders.length; i++) {
      const r = rootOf(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(i);
    }
    for (const [root, members] of [...byRoot.entries()].sort((a, b) => a[0] - b[0])) {
      const o = orders[root];
      let seq = [];
      if (o && o.type === 'attack') seq = o.targets.map((node) => ({ type: 'attack', node }));
      if (o && o.type === 'defend') seq = [{ type: 'defend', node: o.target }];
      groups.push({
        id: `${faction === 'blue' ? 'S' : 'F'}${root + 1}`,
        faction,
        members: members.map((m) => m + 1),
        size: members.length,
        orders: seq,
        orderIndex: 0,
        state: 'atNode', // 'atNode' | 'moving' | 'defending' | 'dead'
        node: map.start[faction],
        arrivedAt: 0,
        fighting: false,
        entrenched: false,
        edgeFrom: null,
        edgeTo: null,
        departT: 0,
        arriveT: 0,
        respawnAt: Infinity,
        graveyardNode: null,
        deathNode: null,
      });
    }
  }

  function currentObjective(g) {
    if (g.orderIndex < g.orders.length) return g.orders[g.orderIndex];
    // Sequenz abgeschlossen → automatisch weiter zum gegnerischen Endboss.
    return { type: 'attack', node: map.bosses[enemyOf(g.faction)] };
  }

  function enemiesPresent(nodeId, faction) {
    const node = map.nodes[nodeId];
    if (node.type === 'boss' && node.faction !== faction && bossAlive[node.faction]) return true;
    return groups.some(
      (g) => g.node === nodeId && g.faction !== faction && (g.state === 'atNode' || g.state === 'defending')
    );
  }

  // Setzt die Befehle einer frei stehenden Gruppe fort (weiterziehen oder Stellung halten).
  function continueOrders(g, t) {
    for (;;) {
      const obj = currentObjective(g);
      if (g.node === obj.node) {
        if (obj.type === 'defend') {
          g.state = 'defending';
          // Bonus nur, wenn beim Eintreffen kein Gegner (auch nicht gleichzeitig) da ist.
          g.entrenched = !enemiesPresent(g.node, g.faction);
          return;
        }
        if (g.orderIndex < g.orders.length) {
          g.orderIndex += 1;
          continue; // Ziel war frei → Punkt passieren, Sequenz fortsetzen
        }
        return; // steht am gegnerischen Boss – der Kampf wird separat aufgelöst
      }
      const path = shortestPath(map, g.node, obj.node);
      if (!path || path.length < 2) return;
      g.state = 'moving';
      g.edgeFrom = g.node;
      g.edgeTo = path[1];
      g.departT = t;
      g.arriveT = t + edgeTime;
      g.node = null;
      return;
    }
  }

  function die(g, t) {
    g.state = 'dead';
    g.fighting = false;
    g.entrenched = false;
    g.deathNode = g.node;
    g.node = null;
    g.graveyardNode = nearestGraveyard(map, g.faction, g.deathNode);
    g.respawnAt = t + respawnTime;
  }

  // Kampfauflösung an einem Punkt: Stärken vergleichen, Verlierer fallen komplett.
  function resolveNode(nodeId, t, defeated) {
    const node = map.nodes[nodeId];
    const here = groups.filter(
      (g) => g.node === nodeId && (g.state === 'atNode' || g.state === 'defending')
    );
    const str = { blue: 0, red: 0 };
    const present = { blue: false, red: false };
    for (const g of here) {
      present[g.faction] = true;
      str[g.faction] += g.size * (g.state === 'defending' && g.entrenched ? 1.5 : 1);
    }
    if (node.type === 'boss' && bossAlive[node.faction]) {
      present[node.faction] = true;
      str[node.faction] += bossStrength; // Bossstärke ist bereits effektiv (kein ×1,5)
    }
    if (!present.blue || !present.red) {
      for (const g of here) g.fighting = false;
      tieKeys.delete(nodeId);
      return;
    }
    const winner = str.blue > str.red + EPS ? 'blue' : str.red > str.blue + EPS ? 'red' : null;
    if (!winner) {
      // Unentschieden: alle Beteiligten bleiben gebunden, bis Verstärkung eintrifft.
      const key = here.map((g) => `${g.id}:${g.size}:${g.entrenched}`).sort().join('|');
      if (tieKeys.get(nodeId) !== key) {
        tieKeys.set(nodeId, key);
        addLog(`${nodeName(nodeId)}: ${fmt(str.blue)} gegen ${fmt(str.red)} – Kampf gebunden.`);
      }
      for (const g of here) g.fighting = true;
      return;
    }
    tieKeys.delete(nodeId);
    const loser = enemyOf(winner);
    addLog(
      `Kampf um ${nodeName(nodeId)}: ${FACTIONS.blue.name} ${fmt(str.blue)} gegen ` +
        `${FACTIONS.red.name} ${fmt(str.red)} – ${FACTIONS[winner].name} siegt.`
    );
    for (const g of here) {
      if (g.faction === loser) {
        die(g, t);
      } else {
        g.fighting = false;
        if (g.state === 'defending') g.entrenched = true; // Punkt gehalten → Stellung gefestigt
      }
    }
    if (node.type === 'boss' && node.faction === loser) {
      bossAlive[loser] = false;
      defeated.push(loser);
      addLog(`${node.name} ist gefallen!`);
    }
  }

  function processBatch(t) {
    const affected = new Set();
    for (const g of groups) {
      if (g.state === 'moving' && g.arriveT <= t + EPS) {
        g.node = g.edgeTo;
        g.state = 'atNode';
        g.arrivedAt = t;
        g.edgeFrom = null;
        g.edgeTo = null;
        affected.add(g.node);
      } else if (g.state === 'dead' && g.respawnAt <= t + EPS) {
        g.node = g.graveyardNode;
        g.state = 'atNode';
        g.arrivedAt = t;
        g.respawnAt = Infinity;
        affected.add(g.node);
        addLog(`${FACTIONS[g.faction].name}-Trupp (${g.size}) kehrt am ${nodeName(g.node)} zurück.`);
      }
    }
    const defeated = [];
    for (const nodeId of [...affected].sort()) resolveNode(nodeId, t, defeated);
    if (defeated.length) {
      if (defeated.length === 2) {
        result = { winner: 'draw', reason: 'Beide Anführer fielen im selben Moment.' };
      } else {
        const winner = enemyOf(defeated[0]);
        result = { winner, reason: `${map.nodes[map.bosses[defeated[0]]].name} wurde besiegt.` };
      }
      return;
    }
    for (const g of groups) {
      if (g.state === 'atNode' && !g.fighting) continueOrders(g, t);
    }
  }

  function nextEventTime() {
    let t = Infinity;
    for (const g of groups) {
      if (g.state === 'moving') t = Math.min(t, g.arriveT);
      else if (g.state === 'dead') t = Math.min(t, g.respawnAt);
    }
    return t;
  }

  function endWithDraw(reason) {
    result = { winner: 'draw', reason };
    addLog(reason);
  }

  function advance(dt) {
    if (result) return;
    const target = time + dt;
    for (;;) {
      if (result) break;
      const te = nextEventTime();
      if (te === Infinity) {
        endWithDraw('Patt – keine Einheit ist mehr in Bewegung.');
        break;
      }
      if (te > target + EPS) {
        time = target;
        break;
      }
      time = te;
      processBatch(te);
      if (!result && time >= maxTime) endWithDraw('Zeitlimit erreicht – unentschieden.');
    }
    if (!result && time >= maxTime) endWithDraw('Zeitlimit erreicht – unentschieden.');
  }

  // Startaufstellung: alle Gruppen setzen ihre Befehle ab Sekunde 0 um.
  for (const g of groups) continueOrders(g, 0);

  return {
    groups,
    log,
    bossAlive,
    config,
    advance,
    get time() {
      return time;
    },
    get result() {
      return result;
    },
  };
}
