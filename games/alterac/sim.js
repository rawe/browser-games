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
//
// Begegnungskämpfe: Treffen sich verfeindete Gruppen auf demselben Wegstück
// (entgegenkommend, oder eine Gruppe läuft in einen dort laufenden Kampf
// hinein), stoppen sie am exakten Treffpunkt und kämpfen dort im offenen
// Feld – ohne Boss und ohne Verteidigungsbonus. Die Sieger setzen danach
// ihre unterbrochene Bewegung samt Befehlskette unverändert fort. Regeln und
// Deadlock-Betrachtung: siehe README.md in diesem Verzeichnis.

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
  // Aktive Begegnungskämpfe auf Wegstücken: { a, b, frac, tickAt } mit a/b als
  // kanonisch sortiertem Knotenpaar und frac als Treffpunkt-Position von a aus.
  const edgeCombats = [];
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
        state: 'atNode', // 'atNode' | 'moving' | 'edgeFight' | 'defending' | 'dead'
        node: map.start[faction],
        arrivedAt: 0,
        fighting: false,
        entrenched: false,
        edgeFrom: null,
        edgeTo: null,
        edgeFrac: 0, // im Begegnungskampf: zurückgelegter Anteil des Wegstücks
        edgeCombat: null, // Referenz auf den aktiven Wegstück-Kampf
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

  // --- Begegnungskämpfe auf Wegstücken --------------------------------------

  // Bewegung einer Gruppe in kanonischer Kantensicht: Position als lineare
  // Funktion der Zeit, gemessen vom lexikografisch kleineren Endknoten `a`.
  function edgeMotion(g) {
    const [a, b] = [g.edgeFrom, g.edgeTo].sort();
    const dir = g.edgeFrom === a ? 1 : -1;
    return { a, b, dir, pos0: dir === 1 ? 0 : 1, depart: g.departT, arrive: g.arriveT };
  }

  // Zeitpunkt und Ort, an dem sich zwei entgegenkommende Gruppen auf derselben
  // Kante treffen – oder null (andere Kante, gleiche Richtung, oder das Treffen
  // fiele auf einen Endknoten: dann übernimmt der normale Knotenkampf).
  function meetTime(g1, g2) {
    const m1 = edgeMotion(g1);
    const m2 = edgeMotion(g2);
    if (m1.a !== m2.a || m1.b !== m2.b || m1.dir === m2.dir) return null;
    const t = (m1.depart + m2.depart + m1.dir * (m2.pos0 - m1.pos0) * edgeTime) / 2;
    if (t < Math.max(m1.depart, m2.depart) - EPS) return null;
    if (t > Math.min(m1.arrive, m2.arrive) - EPS) return null;
    const frac = m1.pos0 + (m1.dir * (t - m1.depart)) / edgeTime;
    if (frac < EPS || frac > 1 - EPS) return null;
    return { t, frac };
  }

  // Zeitpunkt, zu dem eine bewegte Gruppe einen aktiven Kampf auf ihrer Kante
  // erreicht – oder null. Ein Zeitpunkt in der Vergangenheit bedeutet: schon
  // vorbeigezogen, bevor der Kampf entstand (Aufrufer filtern das aus).
  function reachTime(g, c) {
    const m = edgeMotion(g);
    if (m.a !== c.a || m.b !== c.b) return null;
    const t = m.depart + ((c.frac - m.pos0) / m.dir) * edgeTime;
    if (t < m.depart - EPS || t > m.arrive - EPS) return null;
    return t;
  }

  function joinEdgeCombat(g, c) {
    const m = edgeMotion(g);
    g.state = 'edgeFight';
    g.fighting = true;
    g.edgeFrac = (c.frac - m.pos0) * m.dir;
    g.edgeCombat = c;
  }

  function startEdgeCombat(g1, g2, frac, t) {
    const m = edgeMotion(g1);
    const c = { a: m.a, b: m.b, frac, tickAt: t + tickInterval };
    edgeCombats.push(c);
    joinEdgeCombat(g1, c);
    joinEdgeCombat(g2, c);
    addLog(
      `${FACTIONS.blue.name} und ${FACTIONS.red.name} treffen zwischen ` +
        `${nodeName(c.a)} und ${nodeName(c.b)} aufeinander!`
    );
  }

  // Begegnungen zum Zeitpunkt t auflösen: erst laufen bewegte Gruppen in
  // bestehende Kämpfe hinein, dann treffen entgegenkommende Gegner aufeinander.
  // Wiederholt bis zum Fixpunkt, weil ein neuer Kampf weitere gleichzeitige
  // Beitritte auslösen kann (z. B. mehrere Paare am selben Treffpunkt).
  function processEncounters(t) {
    for (let changed = true; changed; ) {
      changed = false;
      for (const c of edgeCombats) {
        for (const g of groups) {
          if (g.state !== 'moving') continue;
          const r = reachTime(g, c);
          if (r != null && Math.abs(r - t) <= EPS) {
            joinEdgeCombat(g, c);
            addLog(
              `${FACTIONS[g.faction].name}-Trupp (${g.size}) greift in den Kampf zwischen ` +
                `${nodeName(c.a)} und ${nodeName(c.b)} ein.`
            );
            changed = true;
          }
        }
      }
      const moving = groups.filter((g) => g.state === 'moving');
      for (let i = 0; i < moving.length; i++) {
        for (let j = i + 1; j < moving.length; j++) {
          const g1 = moving[i];
          const g2 = moving[j];
          if (g1.faction === g2.faction) continue;
          if (g1.state !== 'moving' || g2.state !== 'moving') continue;
          const m = meetTime(g1, g2);
          if (!m || Math.abs(m.t - t) > EPS) continue;
          const key = edgeMotion(g1);
          const existing = edgeCombats.find(
            (c) => c.a === key.a && c.b === key.b && Math.abs(c.frac - m.frac) < 1e-4
          );
          if (existing) {
            joinEdgeCombat(g1, existing);
            joinEdgeCombat(g2, existing);
          } else {
            startEdgeCombat(g1, g2, m.frac, t);
          }
          changed = true;
        }
      }
    }
  }

  // Frühestes zukünftiges Begegnungsereignis (für die Ereignisplanung).
  function earliestEncounterTime() {
    let t = Infinity;
    const moving = groups.filter((g) => g.state === 'moving');
    for (const c of edgeCombats) {
      for (const g of moving) {
        const r = reachTime(g, c);
        if (r != null && r >= time - EPS) t = Math.min(t, Math.max(r, time));
      }
    }
    for (let i = 0; i < moving.length; i++) {
      for (let j = i + 1; j < moving.length; j++) {
        if (moving[i].faction === moving[j].faction) continue;
        const m = meetTime(moving[i], moving[j]);
        if (m && m.t >= time - EPS) t = Math.min(t, Math.max(m.t, time));
      }
    }
    return t;
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
    // Auf einem Wegstück Gefallene zählen zum näher gelegenen Endknoten.
    g.deathNode = g.node ?? (g.edgeFrac <= 0.5 ? g.edgeFrom : g.edgeTo);
    g.node = null;
    g.edgeFrom = null;
    g.edgeTo = null;
    g.edgeCombat = null;
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

  // Schadensintervall eines Wegstück-Kampfs: offenes Feld – kein Boss, kein
  // Verteidigungsbonus, ansonsten identisch zum Knotenkampf (gleichzeitiger
  // Schlagabtausch gegen den Hitpoint-Stand zu Intervallbeginn).
  function edgeDamageTick(c, t) {
    const here = groups.filter((g) => g.edgeCombat === c && g.state === 'edgeFight');
    const hits = [];
    for (const fac of ['blue', 'red']) {
      const targets = here
        .filter((g) => g.faction !== fac)
        .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1))
        .map((g) => ({ kind: 'group', g, hp: g.hp, defending: false }));
      const units = here.filter((g) => g.faction === fac).reduce((s, g) => s + g.size, 0);
      hits.push(...allocateDamage(units, 0, targets));
    }
    for (const { target, damage } of hits) target.g.hp = Math.max(0, target.g.hp - damage);
    for (const g of here) {
      if (g.hp <= EPS) {
        addLog(
          `${FACTIONS[g.faction].name}-Trupp (${g.size}) fällt zwischen ` +
            `${nodeName(c.a)} und ${nodeName(c.b)}.`
        );
        die(g, t);
      }
    }
  }

  // Wegstück-Kämpfe prüfen: Ist eine Seite vollständig gefallen, endet der
  // Kampf und die Überlebenden setzen ihre unterbrochene Bewegung fort –
  // ab dem Treffpunkt, mit unveränderter Richtung und Befehlskette.
  function updateEdgeCombats(t) {
    for (let i = edgeCombats.length - 1; i >= 0; i--) {
      const c = edgeCombats[i];
      const here = groups.filter((g) => g.edgeCombat === c && g.state === 'edgeFight');
      const present = { blue: false, red: false };
      for (const g of here) present[g.faction] = true;
      if (present.blue && present.red) continue;
      edgeCombats.splice(i, 1);
      for (const g of here) {
        g.state = 'moving';
        g.fighting = false;
        g.edgeCombat = null;
        g.departT = t - g.edgeFrac * edgeTime;
        g.arriveT = t + (1 - g.edgeFrac) * edgeTime;
      }
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
    processEncounters(t);
    const defeated = [];
    for (const [nodeId, tickAt] of [...combatTicks.entries()].sort()) {
      if (tickAt <= t + EPS) {
        damageTick(nodeId, t, defeated);
        combatTicks.set(nodeId, t + tickInterval);
      }
    }
    for (const c of edgeCombats) {
      if (c.tickAt <= t + EPS) {
        edgeDamageTick(c, t);
        c.tickAt = t + tickInterval;
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
    updateEdgeCombats(t);
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
    for (const c of edgeCombats) t = Math.min(t, c.tickAt);
    t = Math.min(t, earliestEncounterTime());
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
