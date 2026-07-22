// Simulationskern – DOM-frei und deterministisch.
//
// Zeitmodell: kontinuierliche Zeit mit exakten Ereigniszeitpunkten (Ankünfte,
// Respawns, Schadensintervalle). Alle Ereignisse desselben Zeitpunkts werden
// gemeinsam verarbeitet, damit gleichzeitige Ankünfte korrekt behandelt werden.
//
// Kampfsystem: Jede Basiseinheit hat `unitHp` Hitpoints und verursacht
// `unitDamage` Schaden pro Sekunde (`unitDamageVsDefender` gegen eingegrabene
// Verteidiger). Fusionierte Gruppen addieren Hitpoints und Schaden. Schaden
// wird in festen Intervallen (`tickInterval`) gleichzeitig ausgetauscht;
// erreicht eine Gruppe oder der Boss 0 Hitpoints, fällt sie. Überlebende
// behalten ihre aktuellen Hitpoints, Respawns kehren mit vollen zurück.

import { FACTIONS, enemyOf, shortestPath, nearestGraveyard } from './map.js';

const EPS = 1e-6;

// plans: { blue: orders[], red: orders[] } mit orders[i] =
//   null                                    → Auto-Angriff auf den gegnerischen Boss
//   { type: 'attack', targets: [nodeId…] }  → Angriffssequenz
//   { type: 'defend', target: nodeId }      → Verteidigung
//   { type: 'follow', target: unitIndex }   → dauerhafte Fusion
export function createSim({ map, config, plans }) {
  const {
    edgeTime,
    respawnTime,
    unitHp,
    unitDamage,
    unitDamageVsDefender,
    bossHp,
    bossDamage,
    tickInterval,
    maxTime,
  } = config;
  const groups = [];
  const log = [];
  const bossAlive = { blue: true, red: true };
  const boss = {
    blue: { hp: bossHp, maxHp: bossHp },
    red: { hp: bossHp, maxHp: bossHp },
  };
  // Kampfpunkt → Zeitpunkt des nächsten Schadensintervalls.
  const combatTicks = new Map();
  let time = 0;
  let result = null;

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
        maxHp: members.length * unitHp,
        hp: members.length * unitHp,
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

  function combatants(nodeId) {
    return groups.filter(
      (g) => g.node === nodeId && (g.state === 'atNode' || g.state === 'defending')
    );
  }

  function enemiesPresent(nodeId, faction) {
    const node = map.nodes[nodeId];
    if (node.type === 'boss' && node.faction !== faction && bossAlive[node.faction]) return true;
    return combatants(nodeId).some((g) => g.faction !== faction);
  }

  function contested(nodeId) {
    const node = map.nodes[nodeId];
    const present = { blue: false, red: false };
    for (const g of combatants(nodeId)) present[g.faction] = true;
    if (node.type === 'boss' && bossAlive[node.faction]) present[node.faction] = true;
    return present.blue && present.red;
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

  // Verteilt den Schaden einer Seite auf die gegnerischen Ziele (schwächstes
  // zuerst, Boss zuletzt). `units` ist die Zahl angreifender Basiseinheiten,
  // `flat` fester Zusatzschaden (Boss). Gerechnet wird gegen den Hitpoint-Stand
  // zu Intervallbeginn, damit beide Seiten gleichzeitig austeilen.
  function allocateDamage(units, flat, targets) {
    const hits = [];
    let u = units;
    let f = flat;
    for (const tg of targets) {
      if (u <= EPS && f <= EPS) break;
      let need = tg.hp;
      let dealt = 0;
      if (f > EPS) {
        const d = Math.min(f, need);
        f -= d;
        need -= d;
        dealt += d;
      }
      if (need > EPS && u > EPS) {
        // Verteidigungsbonus: eingegrabene Verteidiger erleiden weniger Schaden.
        const rate = tg.defending ? unitDamageVsDefender : unitDamage;
        const spent = Math.min(u, need / rate);
        u -= spent;
        dealt += spent * rate;
      }
      if (dealt > 0) hits.push({ target: tg, damage: dealt });
    }
    return hits;
  }

  // Ein Schadensintervall an einem umkämpften Punkt: beide Seiten tauschen
  // gleichzeitig Schaden aus, danach fallen Gruppen und Bosse mit 0 Hitpoints.
  function damageTick(nodeId, t, defeated) {
    const node = map.nodes[nodeId];
    const here = combatants(nodeId);
    const bossFaction = node.type === 'boss' && bossAlive[node.faction] ? node.faction : null;
    const sides = {};
    for (const fac of ['blue', 'red']) {
      const enemy = enemyOf(fac);
      const targets = here
        .filter((g) => g.faction === enemy)
        .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1))
        .map((g) => ({
          kind: 'group',
          g,
          hp: g.hp,
          defending: g.state === 'defending' && g.entrenched,
        }));
      if (bossFaction === enemy) {
        targets.push({ kind: 'boss', faction: enemy, hp: boss[enemy].hp, defending: false });
      }
      sides[fac] = {
        units: here.filter((g) => g.faction === fac).reduce((s, g) => s + g.size, 0),
        flat: bossFaction === fac ? bossDamage : 0,
        targets,
      };
    }
    if (!sides.blue.targets.length || !sides.red.targets.length) return;

    const hits = [
      ...allocateDamage(sides.blue.units, sides.blue.flat, sides.blue.targets),
      ...allocateDamage(sides.red.units, sides.red.flat, sides.red.targets),
    ];
    for (const { target, damage } of hits) {
      if (target.kind === 'group') target.g.hp = Math.max(0, target.g.hp - damage);
      else boss[target.faction].hp = Math.max(0, boss[target.faction].hp - damage);
    }
    for (const g of here) {
      if (g.hp <= EPS) {
        addLog(`${FACTIONS[g.faction].name}-Trupp (${g.size}) fällt bei ${nodeName(nodeId)}.`);
        die(g, t);
      }
    }
    if (bossFaction && boss[bossFaction].hp <= EPS) {
      bossAlive[bossFaction] = false;
      defeated.push(bossFaction);
      addLog(`${node.name} ist gefallen!`);
    }
  }

  // Kampfzustand aller Punkte aktualisieren: neue Kämpfe beginnen, beendete
  // Kämpfe geben die Überlebenden (mit ihren restlichen Hitpoints) wieder frei.
  function updateCombatState(t) {
    for (const n of map.nodeList) {
      const here = combatants(n.id);
      if (contested(n.id)) {
        if (!combatTicks.has(n.id)) {
          combatTicks.set(n.id, t + tickInterval);
          addLog(`Kampf um ${n.name} entbrennt.`);
        }
        for (const g of here) g.fighting = true;
      } else {
        combatTicks.delete(n.id);
        for (const g of here) g.fighting = false;
      }
    }
  }

  function processBatch(t) {
    for (const g of groups) {
      if (g.state === 'moving' && g.arriveT <= t + EPS) {
        g.node = g.edgeTo;
        g.state = 'atNode';
        g.arrivedAt = t;
        g.edgeFrom = null;
        g.edgeTo = null;
      } else if (g.state === 'dead' && g.respawnAt <= t + EPS) {
        g.node = g.graveyardNode;
        g.state = 'atNode';
        g.arrivedAt = t;
        g.respawnAt = Infinity;
        g.hp = g.maxHp; // Respawn stellt die vollen Hitpoints wieder her.
        addLog(`${FACTIONS[g.faction].name}-Trupp (${g.size}) kehrt am ${nodeName(g.node)} zurück.`);
      }
    }
    const defeated = [];
    for (const [nodeId, tickAt] of [...combatTicks.entries()].sort()) {
      if (tickAt <= t + EPS) {
        damageTick(nodeId, t, defeated);
        combatTicks.set(nodeId, t + tickInterval);
      }
    }
    if (defeated.length) {
      if (defeated.length === 2) {
        result = { winner: 'draw', reason: 'Beide Anführer fielen im selben Moment.' };
      } else {
        const winner = enemyOf(defeated[0]);
        result = { winner, reason: `${map.nodes[map.bosses[defeated[0]]].name} wurde besiegt.` };
      }
      return;
    }
    updateCombatState(t);
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
    for (const tickAt of combatTicks.values()) t = Math.min(t, tickAt);
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
  updateCombatState(0);

  return {
    groups,
    log,
    bossAlive,
    boss,
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
