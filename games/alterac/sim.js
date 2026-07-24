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
// Zusätzlich führt jeder Boss in eigenem Takt (`bossAoeInterval`) einen
// Flächen-Gegenschlag, der ALLE gerade an ihm angreifenden Einheiten gleichzeitig
// trifft (`bossAoeDamage`, gesenkt um denselben Turm-Debuff wie der Einzelangriff)
// – so wird ein unkoordinierter Massensturm auf den Boss riskant.
// Boss-Schutz: Solange mindestens ein eigener Turm steht, blockt der Boss den
// prozentualen Anteil `bossTowerShield` des Schadens (er erleidet nur
// `1 − bossTowerShield`). Sind alle Türme gefallen – oder gibt es keine
// (towersPerFaction=0) –, fällt der Schild auf 0 % und der Boss ist normal
// angreifbar. So lässt er sich nicht direkt niederrennen, aber der Schutz ist
// prozentual justierbar statt absolut.
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
//
// Friedhofssystem: Der Besitzstand aller Friedhöfe (Startwerte aus der
// zentralen Kartenkonfiguration) lebt hier. Erreicht eine Einheit einen
// fremden Friedhof, wartet sie dort und die Einnahme beginnt automatisch,
// sobald ihre Fraktion allein vor Ort ist und die Schutzregel es erlaubt.
// Die Einnahme dauert `graveyardCaptureTime` Sekunden ununterbrochener
// Präsenz; mehrere eigene Einheiten verkürzen nichts, jeder Kampf setzt den
// Fortschritt vollständig auf 0 zurück. Nach der Einnahme gehört der Friedhof
// sofort der neuen Fraktion und ist unmittelbar Respawnpunkt. Besiegte
// Einheiten respawnen am nächstgelegenen aktuell kontrollierten eigenen
// Friedhof – bestimmt erst im Moment des Respawns; ohne eigenen Friedhof ist
// kein Respawn mehr möglich (Zustand 'gone').
//
// Respawn-Wellen: Der Respawn läuft auf einem globalen Takt statt pro Einheit.
// `respawnTime` ist das Intervall zwischen zwei Wellen (an Spielbeginn
// verankerte Vielfache); jede Gefallene wartet bis zur nächsten Welle und
// kehrt dann gemeinsam mit allen anderen wartenden Gefallenen zurück. So
// ballen sich Respawns automatisch zu Wellen.

import { FACTIONS, enemyOf, shortestPath, nearestGraveyard, towerNodes } from './map.js';
import { resolveUnitTypeMap } from './config.js';

const EPS = 1e-6;

// plans: { blue: units[], red: units[] } mit units[i] entweder
//   – neu:    { type, actions: [{ path, stance, trigger }, …] }
//   – legacy: { type, path: [nodeId…], stance: 'attack' | 'defend' }
// Legacy-Pläne werden zu einer Ein-Auftrag-Kette normalisiert.
//
// Auftragskette: Jede Einheit arbeitet eine geordnete Liste von Aufträgen ab.
// Ein Auftrag ist ein Pfad benachbarter Wegpunkte plus Haltung – wie das frühere
// Einzelmodell. `trigger`:
//   – null / { kind: 'then' }  → sequenziell: der Auftrag startet, sobald der
//     vorige fertig ist (Pfad abgelaufen und Ziel-Turm zerstört). Der erste
//     Auftrag ist immer sequenziell und startet ab Sekunde 0.
//   – { kind: 'when', cond }   → Reaktion: sobald `cond` wahr wird, wirft die
//     Einheit ihren aktuellen Auftrag weg und wechselt zu diesem (Unterbrechung).
//     Feuert genau einmal. Reaktionen sind nicht Teil der Sequenz; danach greift
//     der reguläre Fallback des Reaktions-Auftrags (Angriff → Boss, Halten →
//     stehen bleiben). Eine Einheit reagiert nur auf Events, für die sie einen
//     „Sobald"-Auftrag besitzt (explizites Zuhören).
// Nach der abgearbeiteten sequenziellen Kette greift der Fallback: bei Haltung
// „Angriff" Marsch auf den gegnerischen Boss, bei „Halten" Stellung halten.
// Determinismus/Regeln: siehe design-aktionen-events.md.
export function createSim({ map, config, plans }) {
  const {
    edgeTime,
    respawnTime,
    graveyardCaptureTime,
    entrenchedFactor,
    bossHp,
    bossDamage,
    bossAttackInterval,
    bossAoeDamage,
    bossAoeInterval,
    maxTime,
    towersPerFaction,
    towerHp,
    towerDamage,
    towerAttackInterval,
    towerDamageReduction,
    bossDamageFloor,
    bossTowerShield = 0,
  } = config;
  // Effektive Einheitenwerte dieser Partie (Datei-Defaults ggf. überschrieben).
  const unitTypes = resolveUnitTypeMap(config);
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
  // Takt des Flächen-Gegenschlags je Boss (Infinity = kein Kampf am Boss-Knoten).
  // Läuft unabhängig vom Einzelangriff und trifft alle Angreifer gleichzeitig.
  const bossAoeAt = { blue: Infinity, red: Infinity };
  // Türme: ortsfeste Kampfeinheiten an markierten Wegpunkten. Sie bewegen sich
  // nicht, regenerieren nicht und respawnen nicht. `engaged` ist true, solange
  // ein Turmkampf läuft (eine gegnerische Einheit greift den Turm ausdrücklich
  // an); `attackAt` ist der nächste Angriffszeitpunkt (Infinity = ruhend).
  const towers = {};
  for (const [nodeId, faction] of Object.entries(towerNodes(map, towersPerFaction ?? 0))) {
    towers[nodeId] = {
      node: nodeId,
      faction,
      maxHp: towerHp,
      hp: towerHp,
      damage: towerDamage,
      attackInterval: towerAttackInterval,
      alive: true,
      engaged: false,
      attackAt: Infinity,
    };
  }
  const towerIds = Object.keys(towers);
  // Anzahl je Fraktion bereits zerstörter Türme – reduziert dauerhaft den
  // Angriffsschaden des zugehörigen Fürsten (Berechnung stets aus dem Basiswert).
  const destroyedTowers = { blue: 0, red: 0 };
  // Gesamtzahl der Türme je Fraktion (für den Boss-Schutz durch stehende Türme).
  const towerCount = { blue: 0, red: 0 };
  for (const nodeId of Object.keys(towers)) towerCount[towers[nodeId].faction] += 1;
  // Knoten mit aktuell laufendem Kampf (für Log und Effekte).
  const nodeCombats = new Set();
  // Aktive Begegnungskämpfe auf Wegstücken: { a, b, frac } mit a/b als
  // kanonisch sortiertem Knotenpaar und frac als Treffpunkt-Position von a aus.
  const edgeCombats = [];
  // Aktueller Friedhofsbesitz (Startwerte aus der Kartenkonfiguration) und
  // laufende Einnahmen: gyOwner[id] = 'blue' | 'red' | null,
  // captures[id] = { faction, startedAt } solange eine Einnahme läuft.
  const gyOwner = {};
  for (const id of map.graveyardIds) gyOwner[id] = map.graveyards[id].owner;
  const captures = {};
  let time = 0;
  let result = null;

  const nodeName = (id) => map.nodes[id].name;
  const addLog = (text) => log.push({ t: time, text });
  const addEvent = (e) => events.push({ t: time, ...e });
  const groupLabel = (g) => `${FACTIONS[g.faction].name}-Trupp (${g.def.name})`;

  // Einen einzelnen Auftrag (Pfad + Haltung) in seine Ausführungsdaten
  // übersetzen: die Befehlsliste `orders` und – bei einem Angriffspfad, der auf
  // einem gegnerischen Turm endet – das ausdrückliche `towerTarget`. Ein bloßes
  // Durchqueren eines Turmknotens als Zwischenwegpunkt aktiviert den Turm nicht.
  function buildAction(faction, action) {
    const path = action.path ?? [];
    let orders = path.map((node) => ({ type: 'attack', node }));
    if (action.stance === 'defend') {
      if (orders.length) orders[orders.length - 1] = { type: 'defend', node: path[path.length - 1] };
      else orders = [{ type: 'defend', node: map.start[faction] }];
    }
    const lastNode = path.length ? path[path.length - 1] : null;
    const towerTarget =
      action.stance === 'attack' && lastNode && towers[lastNode] && towers[lastNode].faction !== faction
        ? lastNode
        : null;
    return { orders, towerTarget };
  }

  // --- Gruppen aus den Plänen bauen: jede Einheit ist eine eigene Gruppe ---
  for (const faction of ['blue', 'red']) {
    plans[faction].forEach((u, i) => {
      const def = unitTypes[u.type];
      // Plan normalisieren: Legacy (path/stance) → Ein-Auftrag-Kette.
      const actions = u.actions ?? [{ path: u.path ?? [], stance: u.stance ?? 'attack', trigger: null }];
      // Sequenzielle Aufträge (Rückgrat) und Reaktionen trennen. Der erste
      // Auftrag ist stets sequenziell; alle weiteren mit trigger.kind === 'when'
      // sind Reaktionen, der Rest gehört zur Sequenz.
      const seq = [];
      const reactions = [];
      actions.forEach((a, idx) => {
        const trig = a.trigger ?? (idx === 0 ? null : { kind: 'then' });
        if (idx !== 0 && trig && trig.kind === 'when' && trig.cond) {
          reactions.push({ cond: trig.cond, built: buildAction(faction, a), fired: false });
        } else {
          seq.push(buildAction(faction, a));
        }
      });
      if (!seq.length) seq.push(buildAction(faction, { path: [], stance: 'attack' }));
      const first = seq[0];
      groups.push({
        id: `${faction === 'blue' ? 'S' : 'F'}${i + 1}`,
        // 1-basierte Nummer der Einheit in der Plan-Reihenfolge ihrer Fraktion –
        // als römische Ziffer auf dem Token und in der Planungsliste dargestellt.
        ordinal: i + 1,
        faction,
        def,
        maxHp: def.hp,
        hp: def.hp,
        damage: def.damage,
        attackInterval: def.attackInterval,
        edgeTime: edgeTime / (def.speed ?? 1), // Reisezeit pro Wegstück
        // Auftragskette: `seq` ist das sequenzielle Rückgrat, `reactions` die
        // „Sobald"-Aufträge. Der aktive Auftrag lebt im Ausführungs-Slot
        // (orders/orderIndex/towerTarget); `seqIndex` zeigt auf den aktiven
        // sequenziellen Auftrag, `inReaction` markiert eine laufende Reaktion.
        seq,
        seqIndex: 0,
        reactions,
        inReaction: false,
        pendingReaction: null, // gelatchte Reaktion, wird am nächsten freien Knoten angewandt
        orders: first.orders,
        orderIndex: 0,
        // 'atNode' | 'moving' | 'edgeFight' | 'defending' | 'capturing' |
        // 'dead' | 'gone' (endgültig gefallen – kein Friedhof für den Respawn)
        state: 'atNode',
        node: map.start[faction],
        towerTarget: first.towerTarget, // Knoten des gegnerischen Ziel-Turms (oder null)
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

  // --- Auftragskette: Slot-Wechsel & Auslöser ------------------------------

  // Ausführungs-Slot einer Gruppe auf einen gebauten Auftrag setzen.
  function applySlot(g, built) {
    g.orders = built.orders;
    g.orderIndex = 0;
    g.towerTarget = built.towerTarget;
  }

  // Ist der aktuelle Auftrag abgearbeitet? Pfad vollständig abgelaufen und kein
  // lebender Ziel-Turm mehr. (Der Marsch zum Boss ist kein eigener Auftrag,
  // sondern der Fallback – er zählt nicht als „noch offener" Auftrag.)
  function actionExhausted(g) {
    return g.orderIndex >= g.orders.length && !(g.towerTarget && towers[g.towerTarget]?.alive);
  }

  // Nächsten sequenziellen Auftrag laden. Rückgabe true, wenn ein neuer Auftrag
  // aktiv wurde (neu auszuwerten), false, wenn keiner mehr folgt (→ Boss-Fallback).
  // Während einer laufenden Reaktion wird die Sequenz nicht fortgesetzt: die
  // Reaktion ist final, danach greift ihr eigener Fallback.
  function loadNextAction(g) {
    if (g.inReaction) return false;
    g.seqIndex += 1;
    if (g.seqIndex < g.seq.length) {
      applySlot(g, g.seq[g.seqIndex]);
      return true;
    }
    return false;
  }

  // Eine Reaktion (Unterbrechung) übernehmen: aktuellen Auftrag verwerfen und
  // den Reaktions-Auftrag in den Slot laden.
  function enterReaction(g, reaction) {
    g.inReaction = true;
    applySlot(g, reaction.built);
  }

  // Aktueller Wahrheitswert einer Event-Bedingung aus Sicht der Gruppe `g`.
  // Rein lesend über den Sim-Zustand → deterministisch, ändert sich nur an
  // bestehenden Ereigniszeitpunkten (Turmzerstörung).
  function condHolds(cond, g) {
    if (!cond) return false;
    if (cond.type === 'enemyShieldDown') {
      const e = enemyOf(g.faction);
      return towerCount[e] - destroyedTowers[e] <= 0;
    }
    if (cond.type === 'towerDown') {
      const tw = towers[cond.node];
      return tw ? !tw.alive : false;
    }
    return false;
  }

  const condText = (cond) =>
    cond?.type === 'enemyShieldDown'
      ? 'Boss-Schild des Gegners gefallen'
      : cond?.type === 'towerDown'
        ? `Turm ${nodeName(cond.node)} gefallen`
        : 'Ereignis eingetreten';

  // Reaktionen prüfen: Für jede Gruppe die erste noch nicht gefeuerte Reaktion
  // finden, deren Bedingung jetzt wahr ist, und sie latchen (`pendingReaction`).
  // Angewandt wird sie erst, sobald die Einheit frei an einem Knoten steht
  // (continueOrders) – nie mitten auf einer Kante oder im Nahkampf.
  function checkReactions(t) {
    for (const g of groups) {
      if (g.state === 'dead' || g.state === 'gone' || g.pendingReaction) continue;
      for (const r of g.reactions) {
        if (r.fired || !condHolds(r.cond, g)) continue;
        r.fired = true;
        g.pendingReaction = r;
        addLog(`${groupLabel(g)} reagiert – ${condText(r.cond)}.`);
        break;
      }
    }
  }

  function currentObjective(g) {
    if (g.orderIndex < g.orders.length) return g.orders[g.orderIndex];
    // Pfad abgearbeitet: steht ein lebender Ziel-Turm am Pfadende, wird dieser
    // angegriffen; sonst automatisch weiter zum gegnerischen Endboss.
    if (g.towerTarget && towers[g.towerTarget]?.alive) {
      return { type: 'tower', node: g.towerTarget };
    }
    return { type: 'attack', node: map.bosses[enemyOf(g.faction)] };
  }

  // Turmknoten, den eine Einheit gerade ausdrücklich angreift: Sie steht an
  // ihrem geplanten Ziel-Turm (Pfadende), der noch lebt. Zwischenwegpunkte auf
  // demselben Turm zählen nicht (der Pfad muss dort enden).
  function objectiveTower(g) {
    if (!g.towerTarget || g.node !== g.towerTarget) return null;
    if (g.orderIndex < g.orders.length - 1) return null;
    return towers[g.towerTarget]?.alive ? g.towerTarget : null;
  }

  // Turm-Debuff-Faktor eines Fürsten: je zerstörtem eigenen Turm um
  // `towerDamageReduction` gesenkt, nie unter `bossDamageFloor`. Gilt einheitlich
  // für Einzelangriff UND Flächen-Gegenschlag.
  function bossDamageFactor(faction) {
    return Math.max(bossDamageFloor, 1 - towerDamageReduction * destroyedTowers[faction]);
  }

  // Aktueller Angriffsschaden eines Fürsten (Einzelangriff), um den Turm-Debuff gesenkt.
  function bossDamageOf(faction) {
    return bossDamage * bossDamageFactor(faction);
  }

  // Boss-Schutz durch eigene Türme: Anteil des Schadens, den der Boss aktuell
  // erleidet. Solange mindestens ein eigener Turm steht, blockt der Schild den
  // (prozentualen, konfigurierbaren) Anteil `bossTowerShield` – der Boss erleidet
  // dann nur `1 − bossTowerShield`. Sind alle Türme gefallen (oder gibt es keine),
  // fällt der Schild weg und der Boss erleidet vollen Schaden.
  function bossVulnerability(faction) {
    const surviving = towerCount[faction] - destroyedTowers[faction];
    if (surviving <= 0) return 1;
    return 1 - bossTowerShield;
  }

  function combatants(nodeId) {
    return groups.filter(
      (g) =>
        g.node === nodeId &&
        (g.state === 'atNode' || g.state === 'defending' || g.state === 'capturing')
    );
  }

  // --- Friedhöfe: Besitz, Schutzregel und Einnahme ---------------------------

  const ownedGraveyards = (faction) => map.graveyardIds.filter((id) => gyOwner[id] === faction);

  // Schutzregel: Der Heimatfriedhof einer Fraktion ist nicht einnehmbar,
  // solange sie ihn selbst hält UND noch mindestens einen anderen Friedhof
  // kontrolliert. Hält ihn bereits der Gegner, ist die Rückeroberung durch
  // die Heimatfraktion jederzeit erlaubt.
  function captureAllowed(gyId) {
    const owner = gyOwner[gyId];
    if (owner == null) return true;
    if (map.graveyards[gyId].home !== owner) return true;
    return ownedGraveyards(owner).every((id) => id === gyId);
  }

  // Fällige Einnahmen abschließen: Der Friedhof wechselt sofort den Besitzer
  // und ist unmittelbar als Respawnpunkt aktiv; wartende Einheiten setzen
  // danach ihre Befehle fort.
  function completeCaptures(t) {
    for (const gyId of map.graveyardIds) {
      const cap = captures[gyId];
      if (!cap || cap.startedAt + graveyardCaptureTime > t + EPS) continue;
      delete captures[gyId];
      gyOwner[gyId] = cap.faction;
      addLog(`${FACTIONS[cap.faction].name} nimmt ${nodeName(gyId)} ein!`);
      addEvent({ type: 'graveyardCaptured', faction: cap.faction, where: { node: gyId } });
      for (const g of groups) {
        if (g.state === 'capturing' && g.node === gyId) g.state = 'atNode';
      }
    }
  }

  // Einnahme-Zustand aller Friedhöfe aktualisieren: Eine Einnahme läuft nur,
  // solange genau eine Fraktion (nicht der Besitzer) allein vor Ort ist und
  // die Schutzregel es erlaubt. Jede Unterbrechung – Kampf, Verlust der
  // Präsenz oder wieder greifender Schutz – setzt den Fortschritt auf 0;
  // mehrere eigene Einheiten verkürzen die Dauer nicht.
  function updateGraveyards(t) {
    for (const gyId of map.graveyardIds) {
      const present = { blue: false, red: false };
      for (const g of combatants(gyId)) present[g.faction] = true;
      const fac = present.blue !== present.red ? (present.blue ? 'blue' : 'red') : null;
      const cap = captures[gyId] ?? null;
      if (!fac || fac === gyOwner[gyId] || !captureAllowed(gyId)) {
        if (cap) {
          delete captures[gyId];
          addLog(`Die Einnahme von ${nodeName(gyId)} wird unterbrochen – der Fortschritt verfällt.`);
        }
        continue;
      }
      if (!cap || cap.faction !== fac) {
        captures[gyId] = { faction: fac, startedAt: t };
        addLog(`${FACTIONS[fac].name} beginnt die Einnahme von ${nodeName(gyId)}.`);
        addEvent({ type: 'captureStart', faction: fac, where: { node: gyId } });
      }
    }
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
    // Gelatchte Reaktion jetzt anwenden – die Einheit steht frei an einem Knoten
    // (Ankunft oder Kampfende). Die Unterbrechung wirft den laufenden Auftrag weg.
    if (g.pendingReaction) {
      enterReaction(g, g.pendingReaction);
      g.pendingReaction = null;
    }
    // An einem fremden Friedhof bleibt die Einheit stehen, bis ihre Fraktion
    // ihn eingenommen hat (die Einnahme selbst verwaltet updateGraveyards –
    // inklusive Wartezeit, falls die Schutzregel sie noch blockiert).
    if (map.nodes[g.node].type === 'graveyard' && gyOwner[g.node] !== g.faction) {
      g.state = 'capturing';
      return;
    }
    for (;;) {
      // Ist der aktive Auftrag fertig, den nächsten sequenziellen laden (sofern
      // vorhanden). Ohne weiteren Auftrag bleibt es beim Boss-Fallback unten.
      while (actionExhausted(g) && loadNextAction(g)) {
        /* nächsten Auftrag im nächsten Schleifendurchlauf auswerten */
      }
      const obj = currentObjective(g);
      if (g.node === obj.node) {
        if (obj.type === 'defend') {
          g.state = 'defending';
          // Bonus nur, wenn beim Eintreffen kein Gegner (auch nicht gleichzeitig) da ist.
          g.entrenched = !enemiesPresent(g.node, g.faction);
          return;
        }
        if (obj.type === 'tower') {
          // Am gegnerischen Ziel-Turm angekommen: Stellung halten und ihn
          // angreifen. Kampfbeginn und Angriffstimer verwaltet
          // updateCombatState/processAttacks (erst Verteidiger, dann der Turm).
          g.state = 'atNode';
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

  // Globale Respawn-Wellen: Statt individuell nach eigener Respawnzeit kehren
  // alle Gefallenen gemeinsam an den festen Taktpunkten des globalen Respawn-
  // Intervalls zurück (Vielfache von `respawnTime`, verankert an Spielbeginn).
  // Eine gefallene Einheit wartet also bis zur nächsten Welle – so entstehen
  // automatisch geballte Respawns statt eines stetigen Einzeltropfens.
  function nextRespawnWave(t) {
    return (Math.floor(t / respawnTime) + 1) * respawnTime;
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
    // Nur Anzeige/Effekt – der verbindliche Respawnpunkt wird erst im Moment
    // des Respawns aus dem dann aktuellen Besitzstand bestimmt.
    g.graveyardNode = nearestGraveyard(map, ownedGraveyards(g.faction), g.deathNode);
    // Respawn erst mit der nächsten globalen Welle (nicht t + respawnTime).
    g.respawnAt = nextRespawnWave(t);
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
      if (bossAlive[fac] && bossAoeAt[fac] <= t + EPS) attacks.push({ kind: 'bossAoe', faction: fac });
    }
    for (const g of groups) {
      if (g.fighting && g.nextAttackAt <= t + EPS) attacks.push({ kind: 'group', g });
    }
    for (const nodeId of towerIds) {
      const tw = towers[nodeId];
      if (tw.alive && tw.engaged && tw.attackAt <= t + EPS) attacks.push({ kind: 'tower', tw });
    }
    if (!attacks.length) return;
    // Feste, reproduzierbare Reihenfolge: Bosse zuerst, dann Gruppen nach
    // Kennung, dann Türme nach Knoten.
    const attackKey = (a) =>
      a.kind === 'boss'
        ? `0${a.faction}a`
        : a.kind === 'bossAoe'
          ? `0${a.faction}b`
          : a.kind === 'tower'
            ? `2${a.tw.node}`
            : `1${a.g.id.padStart(4, '0')}`;
    attacks.sort((x, y) => {
      const kx = attackKey(x);
      const ky = attackKey(y);
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });

    for (const atk of attacks) {
      // Flächen-Gegenschlag: trifft ALLE gerade angreifenden Gegner am Boss-Knoten
      // gleichzeitig (nicht nur den Schwächsten). Angreifer sind nie eingegraben,
      // daher stets voller Schaden – gesenkt nur um den Turm-Debuff des Fürsten.
      if (atk.kind === 'bossAoe') {
        const faction = atk.faction;
        bossAoeAt[faction] = t + bossAoeInterval;
        const dmg = bossAoeDamage * bossDamageFactor(faction);
        if (dmg <= EPS) continue;
        const nodeId = map.bosses[faction];
        const where = { node: nodeId };
        const targets = combatants(nodeId).filter((o) => o.faction !== faction && o.hp > EPS);
        if (!targets.length) continue;
        addEvent({ type: 'bossAoe', faction, where });
        for (const target of targets) {
          target.hp = Math.max(0, target.hp - dmg);
          addEvent({ type: 'damage', amount: dmg, boss: false, faction: target.faction, where });
        }
        continue;
      }
      let faction;
      let damage;
      let where;
      let targetGroups;
      let bossTargetFaction = null;
      let towerTargetNode = null;
      if (atk.kind === 'boss') {
        faction = atk.faction;
        damage = bossDamageOf(faction); // je zerstörtem eigenen Turm dauerhaft geschwächt
        bossAttackAt[faction] = t + bossAttackInterval;
        const nodeId = map.bosses[faction];
        targetGroups = combatants(nodeId).filter((g) => g.faction !== faction);
        where = { node: nodeId };
      } else if (atk.kind === 'tower') {
        // Der Turm greift während des gesamten Kampfes mit seinen normalen Werten
        // das schwächste gegnerische Ziel an seinem Knoten an.
        const tw = atk.tw;
        faction = tw.faction;
        damage = tw.damage;
        tw.attackAt = t + tw.attackInterval;
        const enemy = enemyOf(faction);
        targetGroups = combatants(tw.node).filter((o) => o.faction === enemy);
        where = { node: tw.node };
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
          // Der eigene Ziel-Turm wird erst getroffen, wenn keine gegnerische
          // Einheit mehr am Knoten steht (siehe Priorität unten) – so bleibt der
          // Turm unverwundbar, solange Verteidiger leben.
          const towerHere = towers[g.node];
          if (towerHere && towerHere.alive && towerHere.faction === enemy && objectiveTower(g) === g.node) {
            towerTargetNode = g.node;
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
        // Boss-Schutz durch stehende Türme: der erlittene Schaden wird gesenkt;
        // bei vollem Schutz (Turm steht) kommt nichts durch – dann signalisiert ein
        // eigenes Ereignis den abgewehrten Treffer statt einer irreführenden Zahl.
        const dealt = damage * bossVulnerability(bossTargetFaction);
        if (dealt > EPS) {
          boss[bossTargetFaction].hp = Math.max(0, boss[bossTargetFaction].hp - dealt);
          addEvent({ type: 'damage', amount: dealt, boss: true, faction: bossTargetFaction, where });
        } else {
          addEvent({ type: 'bossShielded', faction: bossTargetFaction, where });
        }
      } else if (towerTargetNode) {
        // Alle Verteidiger gefallen → der Turm erleidet vollen Schaden (kein
        // Verteidigungsbonus, keine zusätzliche Reduktion).
        const tw = towers[towerTargetNode];
        tw.hp = Math.max(0, tw.hp - damage);
        addEvent({ type: 'damage', amount: damage, boss: false, tower: true, faction: tw.faction, where });
      }
    }

    for (const g of groups) {
      if (g.hp <= EPS && g.state !== 'dead' && g.state !== 'gone') {
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
    // Zerstörte Türme: dauerhaft aus dem Spiel; der zugehörige Fürst verliert
    // dauerhaft Angriffsschaden (in bossDamageOf über destroyedTowers verrechnet).
    for (const nodeId of towerIds) {
      const tw = towers[nodeId];
      if (tw.alive && tw.hp <= EPS) {
        tw.alive = false;
        tw.engaged = false;
        tw.attackAt = Infinity;
        destroyedTowers[tw.faction] += 1;
        addLog(`Turm ${nodeName(nodeId)} (${FACTIONS[tw.faction].name}) ist zerstört!`);
        addEvent({ type: 'towerDown', faction: tw.faction, where: { node: nodeId } });
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
      const tw = towers[n.id];
      // Ein Turm erwacht nur bei ausdrücklichem Angriff: gegnerische Einheiten
      // am Turmknoten, deren geplantes Pfadende dieser Turm ist. Reines
      // Durchqueren aktiviert ihn nicht.
      const towerAttackers =
        tw && tw.alive ? here.filter((g) => g.faction !== tw.faction && objectiveTower(g) === n.id) : [];
      const towerEngaged = towerAttackers.length > 0;
      const isContested = contested(n.id);
      if (isContested || towerEngaged) {
        if (!nodeCombats.has(n.id)) {
          nodeCombats.add(n.id);
          if (isContested) addLog(`Kampf um ${n.name} entbrennt.`);
          addEvent({ type: 'combatStart', where: { node: n.id } });
        }
        // Bei einem Kampf um den Knoten schlagen alle Anwesenden zu; bei einem
        // reinen Turmangriff nur die ausdrücklichen Turm-Angreifer.
        for (const g of here) {
          const involved = isContested || towerAttackers.includes(g);
          if (involved && !g.fighting) {
            g.fighting = true;
            g.nextAttackAt = t + g.attackInterval;
          } else if (!involved && g.fighting) {
            g.fighting = false;
            g.nextAttackAt = Infinity;
          }
        }
        if (n.type === 'boss' && bossAlive[n.faction] && bossAttackAt[n.faction] === Infinity) {
          bossAttackAt[n.faction] = t + bossAttackInterval;
        }
        if (n.type === 'boss' && bossAlive[n.faction] && bossAoeAt[n.faction] === Infinity) {
          bossAoeAt[n.faction] = t + bossAoeInterval;
        }
        if (tw && tw.alive) {
          if (towerEngaged && !tw.engaged) {
            tw.engaged = true;
            tw.attackAt = t + tw.attackInterval;
            addLog(`Der Turm ${n.name} (${FACTIONS[tw.faction].name}) wird angegriffen.`);
            addEvent({ type: 'towerFight', faction: tw.faction, where: { node: n.id } });
          } else if (!towerEngaged && tw.engaged) {
            tw.engaged = false;
            tw.attackAt = Infinity;
          }
        }
      } else {
        nodeCombats.delete(n.id);
        for (const g of here) {
          if (g.fighting) {
            g.fighting = false;
            g.nextAttackAt = Infinity;
          }
        }
        if (n.type === 'boss') {
          bossAttackAt[n.faction] = Infinity;
          bossAoeAt[n.faction] = Infinity;
        }
        if (tw && tw.alive && tw.engaged) {
          tw.engaged = false;
          tw.attackAt = Infinity;
        }
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
        // Respawnpunkt erst jetzt bestimmen: nächstgelegener aktuell
        // kontrollierter eigener Friedhof. Ohne Friedhof kein Respawn mehr.
        const gy = nearestGraveyard(map, ownedGraveyards(g.faction), g.deathNode);
        if (gy == null) {
          g.state = 'gone';
          g.respawnAt = Infinity;
          g.graveyardNode = null;
          addLog(`${groupLabel(g)} kann nicht zurückkehren – kein Friedhof unter eigener Kontrolle.`);
        } else {
          g.node = gy;
          g.graveyardNode = gy;
          g.state = 'atNode';
          g.respawnAt = Infinity;
          g.hp = g.maxHp; // Respawn stellt die vollen Hitpoints wieder her.
          addLog(`${groupLabel(g)} kehrt am ${nodeName(g.node)} zurück.`);
          addEvent({ type: 'respawn', faction: g.faction, where: { node: g.node } });
        }
      } else if (g.state === 'dead') {
        // Anzeige aktuell halten: Der Geist wartet am derzeit nächstgelegenen
        // eigenen Friedhof (verbindlich wird die Wahl erst beim Respawn).
        g.graveyardNode = nearestGraveyard(map, ownedGraveyards(g.faction), g.deathNode);
      }
    }
    processEncounters(t);
    completeCaptures(t);
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
    // Reaktionen prüfen (nach dem aufgelösten Weltzustand dieses Zeitpunkts) und
    // wartende Einheiten aus ihrer Stellung/Einnahme wecken, damit die
    // Unterbrechung greifen kann. Nur freie (nicht kämpfende) Einheiten.
    checkReactions(t);
    for (const g of groups) {
      if (g.pendingReaction && !g.fighting && (g.state === 'defending' || g.state === 'capturing')) {
        g.state = 'atNode';
        g.entrenched = false;
      }
    }
    for (const g of groups) {
      if (g.state === 'atNode' && !g.fighting) continueOrders(g, t);
    }
    updateGraveyards(t);
  }

  function nextEventTime() {
    let t = Infinity;
    for (const g of groups) {
      if (g.state === 'moving') t = Math.min(t, g.arriveT);
      else if (g.state === 'dead') t = Math.min(t, g.respawnAt);
      t = Math.min(t, g.nextAttackAt);
    }
    for (const fac of ['blue', 'red']) t = Math.min(t, bossAttackAt[fac], bossAoeAt[fac]);
    for (const nodeId of towerIds) {
      const tw = towers[nodeId];
      if (tw.alive && tw.engaged) t = Math.min(t, tw.attackAt);
    }
    for (const gyId of map.graveyardIds) {
      const cap = captures[gyId];
      if (cap) t = Math.min(t, cap.startedAt + graveyardCaptureTime);
    }
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
  updateGraveyards(0);

  return {
    groups,
    log,
    events,
    bossAlive,
    boss,
    // Aktueller Turmzustand für Renderer/UI (Fraktion, Hitpoints, Kampf, Zerstörung)
    // sowie die Zahl bereits zerstörter Türme je Fraktion (für den Fürsten-Debuff).
    towers,
    destroyedTowers,
    // Aktueller Boss-Schutz je Fraktion als geblockter Anteil (0 = ungeschützt,
    // 1 = unverwundbar), für die Schild-Darstellung am Boss.
    get bossShield() {
      return { blue: 1 - bossVulnerability('blue'), red: 1 - bossVulnerability('red') };
    },
    // Aktueller Friedhofszustand für Renderer/UI (Besitz + laufende Einnahmen).
    graveyards: { owner: gyOwner, captures },
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
