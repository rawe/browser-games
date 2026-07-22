// Simulationskern – DOM-frei und deterministisch.
//
// Zeitmodell: kontinuierliche Zeit mit exakten Ereigniszeitpunkten (Ankünfte,
// Respawns, Angriffe). Alle Ereignisse desselben Zeitpunkts werden gemeinsam
// verarbeitet, damit gleichzeitige Ankünfte und Schläge korrekt behandelt
// werden.
//
// Kampfsystem: Jede Einheit ist eine eigenständige Gruppe mit den Werten ihres
// Typs (Hitpoints, Schaden pro Angriff, Angriffsintervall, Tempo) aus den
// zentralen UNIT_TYPES-Definitionen – die Logik hier kennt keine Typnamen.
// Jede kämpfende Einheit schlägt in ihrem eigenen Intervall zu und trifft das
// schwächste gegnerische Ziel an ihrem Ort (der Boss zuletzt). Eingegrabene
// Verteidiger erleiden nur den `entrenchedFactor`-Anteil des Schadens.
// Erreicht eine Einheit oder der Boss 0 Hitpoints, fällt sie. Überlebende
// behalten ihre aktuellen Hitpoints, Respawns kehren mit vollen zurück.
//
// Begegnungskämpfe: Treffen sich verfeindete Einheiten auf demselben Wegstück
// (entgegenkommend, per Aufholen bei unterschiedlichem Tempo, oder eine
// Einheit läuft in einen dort laufenden Kampf hinein), stoppen sie am exakten
// Treffpunkt und kämpfen dort im offenen Feld – ohne Boss und ohne
// Verteidigungsbonus. Die Sieger setzen danach ihre unterbrochene Bewegung
// samt Befehlskette unverändert fort. Regeln und Deadlock-Betrachtung: siehe
// README.md in diesem Verzeichnis.

import { FACTIONS, enemyOf, shortestPath, nearestGraveyard } from './map.js';
import { UNIT_TYPE_BY_KEY } from './config.js';

const EPS = 1e-6;

// plans: { blue: units[], red: units[] } mit units[i] =
//   { type: unitTypeKey, path: [nodeId…], stance: 'attack' | 'defend' }
// `path` ist eine Folge benachbarter Wegpunkte ab dem eigenen Startpunkt und
// wird exakt abgelaufen. Danach greift die Einheit automatisch den
// gegnerischen Boss an ('attack') oder hält den letzten Wegpunkt ('defend');
// ein leerer Pfad bedeutet Direktmarsch zum Boss bzw. Verteidigung der Basis.
export function createSim({ map, config, plans }) {
  const {
    edgeTime,
    respawnTime,
    entrenchedFactor,
    bossHp,
    bossDamage,
    bossAttackInterval,
    maxTime,
  } = config;
  const groups = [];
  const log = [];
  // Typisierte Ereignisse für den Renderer (Effekte); `where` ist entweder
  // { node } oder { edge: { a, b, frac } }.
  const events = [];
  const bossAlive = { blue: true, red: true };
  const boss = {
    blue: { hp: bossHp, maxHp: bossHp },
    red: { hp: bossHp, maxHp: bossHp },
  };
  // Angriffstimer der Bosse (Infinity = kein Kampf am Boss-Knoten).
  const bossAttackAt = { blue: Infinity, red: Infinity };
  // Knoten mit aktuell laufendem Kampf (für Log und Effekte).
  const nodeCombats = new Set();
  // Aktive Begegnungskämpfe auf Wegstücken: { a, b, frac } mit a/b als
  // kanonisch sortiertem Knotenpaar und frac als Treffpunkt-Position von a aus.
  const edgeCombats = [];
  let time = 0;
  let result = null;

  const nodeName = (id) => map.nodes[id].name;
  const addLog = (text) => log.push({ t: time, text });
  const addEvent = (e) => events.push({ t: time, ...e });
  const groupLabel = (g) => `${FACTIONS[g.faction].name}-Trupp (${g.def.name})`;

  // --- Gruppen aus den Plänen bauen: jede Einheit ist eine eigene Gruppe ---
  for (const faction of ['blue', 'red']) {
    plans[faction].forEach((u, i) => {
      const def = UNIT_TYPE_BY_KEY[u.type];
      let orders = u.path.map((node) => ({ type: 'attack', node }));
      if (u.stance === 'defend') {
        if (orders.length) orders[orders.length - 1] = { type: 'defend', node: u.path[u.path.length - 1] };
        else orders = [{ type: 'defend', node: map.start[faction] }];
      }
      groups.push({
        id: `${faction === 'blue' ? 'S' : 'F'}${i + 1}`,
        faction,
        def,
        maxHp: def.hp,
        hp: def.hp,
        damage: def.damage,
        attackInterval: def.attackInterval,
        edgeTime: edgeTime / (def.speed ?? 1), // Reisezeit pro Wegstück
        orders,
        orderIndex: 0,
        state: 'atNode', // 'atNode' | 'moving' | 'edgeFight' | 'defending' | 'dead'
        node: map.start[faction],
        fighting: false,
        entrenched: false,
        nextAttackAt: Infinity,
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
    });
  }

  function currentObjective(g) {
    if (g.orderIndex < g.orders.length) return g.orders[g.orderIndex];
    // Pfad abgearbeitet → automatisch weiter zum gegnerischen Endboss.
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
  // `rate` ist die (vorzeichenbehaftete) Geschwindigkeit in Kantenanteilen pro
  // Sekunde – Einheitentypen können unterschiedlich schnell sein.
  function edgeMotion(g) {
    const [a, b] = [g.edgeFrom, g.edgeTo].sort();
    const dir = g.edgeFrom === a ? 1 : -1;
    return {
      a,
      b,
      dir,
      pos0: dir === 1 ? 0 : 1,
      rate: dir / (g.arriveT - g.departT),
      depart: g.departT,
      arrive: g.arriveT,
    };
  }

  // Zeitpunkt und Ort, an dem sich zwei verfeindete Gruppen auf derselben
  // Kante treffen – entgegenkommend oder als Aufholen bei unterschiedlichem
  // Tempo. null bei anderer Kante, gleicher Geschwindigkeit in gleicher
  // Richtung, oder wenn das Treffen auf einen Endknoten fiele (dann übernimmt
  // der normale Knotenkampf).
  function meetTime(g1, g2) {
    const m1 = edgeMotion(g1);
    const m2 = edgeMotion(g2);
    if (m1.a !== m2.a || m1.b !== m2.b) return null;
    const dr = m1.rate - m2.rate;
    if (Math.abs(dr) < EPS) return null;
    const t = (m2.pos0 - m1.pos0 + m1.rate * m1.depart - m2.rate * m2.depart) / dr;
    if (t < Math.max(m1.depart, m2.depart) - EPS) return null;
    if (t > Math.min(m1.arrive, m2.arrive) - EPS) return null;
    const frac = m1.pos0 + m1.rate * (t - m1.depart);
    if (frac < EPS || frac > 1 - EPS) return null;
    return { t, frac };
  }

  // Zeitpunkt, zu dem eine bewegte Gruppe einen aktiven Kampf auf ihrer Kante
  // erreicht – oder null. Ein Zeitpunkt in der Vergangenheit bedeutet: schon
  // vorbeigezogen, bevor der Kampf entstand (Aufrufer filtern das aus).
  function reachTime(g, c) {
    const m = edgeMotion(g);
    if (m.a !== c.a || m.b !== c.b) return null;
    const t = m.depart + (c.frac - m.pos0) / m.rate;
    if (t < m.depart - EPS || t > m.arrive - EPS) return null;
    return t;
  }

  function joinEdgeCombat(g, c, t) {
    const m = edgeMotion(g);
    g.state = 'edgeFight';
    g.fighting = true;
    g.edgeFrac = (c.frac - m.pos0) * m.dir;
    g.edgeCombat = c;
    g.nextAttackAt = t + g.attackInterval;
  }

  function startEdgeCombat(g1, g2, frac, t) {
    const m = edgeMotion(g1);
    const c = { a: m.a, b: m.b, frac };
    edgeCombats.push(c);
    joinEdgeCombat(g1, c, t);
    joinEdgeCombat(g2, c, t);
    addLog(
      `${FACTIONS.blue.name} und ${FACTIONS.red.name} treffen zwischen ` +
        `${nodeName(c.a)} und ${nodeName(c.b)} aufeinander!`
    );
    addEvent({ type: 'combatStart', where: { edge: { a: c.a, b: c.b, frac } } });
  }

  // Begegnungen zum Zeitpunkt t auflösen: erst laufen bewegte Gruppen in
  // bestehende Kämpfe hinein, dann treffen verfeindete Gruppen aufeinander.
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
            joinEdgeCombat(g, c, t);
            addLog(
              `${groupLabel(g)} greift in den Kampf zwischen ` +
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
            joinEdgeCombat(g1, existing, t);
            joinEdgeCombat(g2, existing, t);
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
          continue; // Wegpunkt war frei → passieren, Pfad fortsetzen
        }
        return; // steht am gegnerischen Boss – der Kampf wird separat aufgelöst
      }
      // Benachbarte Pfad-Wegpunkte ergeben hier genau die geplante Kante;
      // die Wegsuche greift nur als Rückfalllösung (Respawn, Marsch zum Boss).
      const path = shortestPath(map, g.node, obj.node);
      if (!path || path.length < 2) return;
      g.state = 'moving';
      g.edgeFrom = g.node;
      g.edgeTo = path[1];
      g.departT = t;
      g.arriveT = t + g.edgeTime;
      g.node = null;
      return;
    }
  }

  function die(g, t) {
    g.state = 'dead';
    g.fighting = false;
    g.entrenched = false;
    g.nextAttackAt = Infinity;
    // Auf einem Wegstück Gefallene zählen zum näher gelegenen Endknoten.
    g.deathNode = g.node ?? (g.edgeFrac <= 0.5 ? g.edgeFrom : g.edgeTo);
    g.node = null;
    g.edgeFrom = null;
    g.edgeTo = null;
    g.edgeCombat = null;
    g.graveyardNode = nearestGraveyard(map, g.faction, g.deathNode);
    g.respawnAt = t + respawnTime;
    addEvent({
      type: 'death',
      faction: g.faction,
      where: { node: g.deathNode },
      graveyard: g.graveyardNode,
    });
  }

  // Alle zum Zeitpunkt t fälligen Angriffe ausführen. Jeder Angreifer trifft
  // das schwächste noch stehende gegnerische Ziel an seinem Ort (Knoten oder
  // Wegstück-Kampf); der Boss ist stets das letzte Ziel. Gefallene werden erst
  // nach allen Angriffen des Zeitpunkts entfernt, damit gleichzeitige Schläge
  // beider Seiten fair verrechnet werden.
  function processAttacks(t, defeated) {
    const attacks = [];
    for (const fac of ['blue', 'red']) {
      if (bossAlive[fac] && bossAttackAt[fac] <= t + EPS) attacks.push({ kind: 'boss', faction: fac });
    }
    for (const g of groups) {
      if (g.fighting && g.nextAttackAt <= t + EPS) attacks.push({ kind: 'group', g });
    }
    if (!attacks.length) return;
    // Feste, reproduzierbare Reihenfolge: Bosse zuerst, dann Gruppen nach Kennung.
    attacks.sort((x, y) => {
      const kx = x.kind === 'boss' ? `0${x.faction}` : `1${x.g.id.padStart(4, '0')}`;
      const ky = y.kind === 'boss' ? `0${y.faction}` : `1${y.g.id.padStart(4, '0')}`;
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });

    for (const atk of attacks) {
      let faction;
      let damage;
      let where;
      let targetGroups;
      let bossTargetFaction = null;
      if (atk.kind === 'boss') {
        faction = atk.faction;
        damage = bossDamage;
        bossAttackAt[faction] = t + bossAttackInterval;
        const nodeId = map.bosses[faction];
        targetGroups = combatants(nodeId).filter((g) => g.faction !== faction);
        where = { node: nodeId };
      } else {
        const g = atk.g;
        faction = g.faction;
        damage = g.damage;
        g.nextAttackAt = t + g.attackInterval;
        const enemy = enemyOf(faction);
        if (g.state === 'edgeFight') {
          const c = g.edgeCombat;
          targetGroups = groups.filter(
            (o) => o.edgeCombat === c && o.state === 'edgeFight' && o.faction === enemy
          );
          where = { edge: { a: c.a, b: c.b, frac: c.frac } };
        } else {
          targetGroups = combatants(g.node).filter((o) => o.faction === enemy);
          const n = map.nodes[g.node];
          if (n.type === 'boss' && n.faction === enemy && bossAlive[enemy]) {
            bossTargetFaction = enemy;
          }
          where = { node: g.node };
        }
      }
      const alive = targetGroups
        .filter((o) => o.hp > EPS)
        .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1));
      const target = alive[0] ?? null;
      if (target) {
        // Verteidigungsbonus: eingegrabene Verteidiger erleiden weniger Schaden.
        const dealt =
          target.state === 'defending' && target.entrenched ? damage * entrenchedFactor : damage;
        target.hp = Math.max(0, target.hp - dealt);
        addEvent({ type: 'damage', amount: dealt, boss: false, faction: target.faction, where });
      } else if (bossTargetFaction) {
        boss[bossTargetFaction].hp = Math.max(0, boss[bossTargetFaction].hp - damage);
        addEvent({ type: 'damage', amount: damage, boss: true, faction: bossTargetFaction, where });
      }
    }

    for (const g of groups) {
      if (g.hp <= EPS && g.state !== 'dead') {
        if (g.state === 'edgeFight') {
          addLog(
            `${groupLabel(g)} fällt zwischen ${nodeName(g.edgeCombat.a)} und ` +
              `${nodeName(g.edgeCombat.b)}.`
          );
        } else {
          addLog(`${groupLabel(g)} fällt bei ${nodeName(g.node)}.`);
        }
        die(g, t);
      }
    }
    for (const fac of ['blue', 'red']) {
      if (bossAlive[fac] && boss[fac].hp <= EPS) {
        bossAlive[fac] = false;
        defeated.push(fac);
        addLog(`${nodeName(map.bosses[fac])} ist gefallen!`);
        addEvent({ type: 'bossDown', faction: fac, where: { node: map.bosses[fac] } });
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
        g.nextAttackAt = Infinity;
        g.departT = t - g.edgeFrac * g.edgeTime;
        g.arriveT = g.departT + g.edgeTime;
      }
    }
  }

  // Kampfzustand aller Knoten aktualisieren: neue Kämpfe beginnen (jede neu
  // eingreifende Einheit erhält ihren eigenen Angriffstimer), beendete Kämpfe
  // geben die Überlebenden (mit ihren restlichen Hitpoints) wieder frei.
  function updateCombatState(t) {
    for (const n of map.nodeList) {
      const here = combatants(n.id);
      if (contested(n.id)) {
        if (!nodeCombats.has(n.id)) {
          nodeCombats.add(n.id);
          addLog(`Kampf um ${n.name} entbrennt.`);
          addEvent({ type: 'combatStart', where: { node: n.id } });
        }
        for (const g of here) {
          if (!g.fighting) {
            g.fighting = true;
            g.nextAttackAt = t + g.attackInterval;
          }
        }
        if (n.type === 'boss' && bossAlive[n.faction] && bossAttackAt[n.faction] === Infinity) {
          bossAttackAt[n.faction] = t + bossAttackInterval;
        }
      } else {
        nodeCombats.delete(n.id);
        for (const g of here) {
          if (g.fighting) {
            g.fighting = false;
            g.nextAttackAt = Infinity;
          }
        }
        if (n.type === 'boss') bossAttackAt[n.faction] = Infinity;
      }
    }
  }

  function processBatch(t) {
    for (const g of groups) {
      if (g.state === 'moving' && g.arriveT <= t + EPS) {
        g.node = g.edgeTo;
        g.state = 'atNode';
        g.edgeFrom = null;
        g.edgeTo = null;
      } else if (g.state === 'dead' && g.respawnAt <= t + EPS) {
        g.node = g.graveyardNode;
        g.state = 'atNode';
        g.respawnAt = Infinity;
        g.hp = g.maxHp; // Respawn stellt die vollen Hitpoints wieder her.
        addLog(`${groupLabel(g)} kehrt am ${nodeName(g.node)} zurück.`);
        addEvent({ type: 'respawn', faction: g.faction, where: { node: g.node } });
      }
    }
    processEncounters(t);
    const defeated = [];
    processAttacks(t, defeated);
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
      t = Math.min(t, g.nextAttackAt);
    }
    for (const fac of ['blue', 'red']) t = Math.min(t, bossAttackAt[fac]);
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
    events,
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
