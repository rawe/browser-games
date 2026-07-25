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
// Vorratslager: Zwei markierte Wegpunkte (`supply` in map.js) liefern ihrem
// Besitzer Nachschub. Sie werden wie Friedhöfe eingenommen – mit dem
// Unterschied, dass nur einnimmt, wer das Lager ausdrücklich als Ziel geplant
// hat (der Pfad endet dort); ein Durchmarsch stört die Einnahme des Gegners,
// treibt aber keine eigene voran. Denn anders als Friedhöfe liegen Lager auf
// Hauptwegen. Ein gehaltenes Lager liefert einen Vorratspunkt je
// `supplyTickTime`; erreicht der Vorrat `allySupplyCost`, wird er verbraucht und
// der mächtige Verbündete der Fraktion erscheint an ihrem Boss-Wegpunkt, um von
// dort selbstständig zum gegnerischen Boss zu marschieren – einmal je Fraktion
// und Partie, ohne Respawn. Der Vorrat läuft stetig auf und wird nur bei
// Besitzwechseln verbucht; der Zeitpunkt des Schwellenübertritts ist daraus
// exakt berechenbar und wird als reguläres Ereignis eingeplant. Regeln und
// Begründungen: siehe design-vorratslager.md.
//
// Respawn-Wellen: Der Respawn läuft auf einem globalen Takt statt pro Einheit.
// `respawnTime` ist das Intervall zwischen zwei Wellen (an Spielbeginn
// verankerte Vielfache); jede Gefallene wartet bis zur nächsten Welle und
// kehrt dann gemeinsam mit allen anderen wartenden Gefallenen zurück. So
// ballen sich Respawns automatisch zu Wellen.

import { FACTIONS, enemyOf, shortestPath, nearestGraveyard, towerNodes } from './map.js';
import { resolveUnitTypeMap, resolveAllyType } from './config.js';

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
    supplyEnabled = false,
    supplyCaptureTime,
    supplyTickTime,
    allySupplyCost,
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
  // Vorratslager (siehe design-vorratslager.md): Jede Fraktion hat genau ein
  // fest zugeordnetes Lager an einem markierten Wegpunkt. Es wechselt nie den
  // Besitzer; der Gegner kann es nur lahmlegen. Zustand je Lager:
  //   inaktiv      – noch nicht in Betrieb genommen (Ausgangslage)
  //   aktiv        – liefert Nachschub, auch ohne eigene Einheit vor Ort
  //   blockiert    – eine gegnerische Einheit besetzt es ausdrücklich; die
  //                  Lieferung stockt, die Inbetriebnahme bleibt aber erhalten
  // Ist das System abgeschaltet, bleibt die Lagerliste leer und keine der
  // Vorratsfunktionen hat eine Wirkung.
  const supplyCampIds = supplyEnabled ? (map.supplyCampIds ?? []) : [];
  const supplyOwner = supplyEnabled ? (map.supplyCamps ?? {}) : {}; // nodeId → Fraktion (fest)
  const supplyActive = {};
  const supplyBlocked = {};
  for (const id of supplyCampIds) {
    supplyActive[id] = false;
    supplyBlocked[id] = false;
  }
  // Laufende Inbetriebnahmen: { faction, startedAt } je Lager.
  const supplyCaptures = {};
  // Vorrat je Fraktion: `supply` ist der zum Zeitpunkt `supplySince` verbuchte
  // Stand, der Rest läuft stetig mit der aktuellen Rate auf (siehe supplyNow).
  const supply = { blue: 0, red: 0 };
  const supplySince = { blue: 0, red: 0 };
  const allySummoned = { blue: false, red: false };
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
  // Nach derselben Regel gilt ein **Vorratslager** als Ziel, wenn der Pfad dort
  // endet (`supplyTarget`) – bei beiden Haltungen, denn ein Lager wird sowohl
  // im Vorbeigehen genommen („Angriff", danach greift der Boss-Fallback) als
  // auch gehalten („Halten"). Weil die Lager auf Hauptwegen liegen, ist diese
  // Ausdrücklichkeit entscheidend: Sonst bliebe jede durchmarschierende Einheit
  // dort hängen.
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
    const supplyTarget = lastNode && supplyCampIds.includes(lastNode) ? lastNode : null;
    return { orders, towerTarget, supplyTarget };
  }

  // Eine einsatzbereite Gruppe bauen. Wird beim Aufbau der Startaufstellung für
  // jede geplante Einheit aufgerufen – und während der Schlacht ein weiteres Mal
  // für den mächtigen Verbündeten, der nicht aus einem Plan stammt.
  function makeGroup({ faction, def, id, ordinal, actions, ally = false, noRespawn = false }) {
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
    return {
      id,
      // 1-basierte Nummer der Einheit in der Plan-Reihenfolge ihrer Fraktion –
      // als römische Ziffer auf dem Token und in der Planungsliste dargestellt.
      // Der Verbündete stammt aus keinem Plan und trägt daher keine Ziffer.
      ordinal,
      // Mächtiger Verbündeter statt angeworbener Einheit: eigene Darstellung,
      // kein Respawn (siehe `noRespawn`).
      ally,
      noRespawn,
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
      supplyTarget: first.supplyTarget, // Knoten des Ziel-Vorratslagers (oder null)
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
    };
  }

  // --- Gruppen aus den Plänen bauen: jede Einheit ist eine eigene Gruppe ---
  for (const faction of ['blue', 'red']) {
    plans[faction].forEach((u, i) => {
      groups.push(
        makeGroup({
          faction,
          def: unitTypes[u.type],
          id: `${faction === 'blue' ? 'S' : 'F'}${i + 1}`,
          ordinal: i + 1,
          // Plan normalisieren: Legacy (path/stance) → Ein-Auftrag-Kette.
          actions: u.actions ?? [
            { path: u.path ?? [], stance: u.stance ?? 'attack', trigger: null },
          ],
        })
      );
    });
  }

  // --- Auftragskette: Slot-Wechsel & Auslöser ------------------------------

  // Ausführungs-Slot einer Gruppe auf einen gebauten Auftrag setzen.
  function applySlot(g, built) {
    g.orders = built.orders;
    g.orderIndex = 0;
    g.towerTarget = built.towerTarget;
    g.supplyTarget = built.supplyTarget;
  }

  // Ist der aktuelle Auftrag abgearbeitet? Pfad vollständig abgelaufen, kein
  // lebender Ziel-Turm und kein noch fremdes Ziel-Vorratslager mehr. (Der Marsch
  // zum Boss ist kein eigener Auftrag, sondern der Fallback – er zählt nicht als
  // „noch offener" Auftrag.)
  function actionExhausted(g) {
    if (g.orderIndex < g.orders.length) return false;
    if (g.towerTarget && towers[g.towerTarget]?.alive) return false;
    if (!supplyDone(g)) return false;
    return true;
  }

  // Ist der Lager-Auftrag einer Einheit erledigt? Das eigene Lager gilt als
  // erledigt, sobald es in Betrieb ist – die Einheit wird dann wieder frei.
  // Ein gegnerisches Lager wird dagegen nie „erledigt": Wer es besetzt, hält die
  // Stellung und legt es damit dauerhaft lahm, bis er fällt oder umgeplant wird.
  function supplyDone(g) {
    if (!g.supplyTarget) return true;
    if (supplyOwner[g.supplyTarget] !== g.faction) return false;
    return supplyActive[g.supplyTarget];
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
    // angegriffen; ist am Pfadende ein noch fremdes Vorratslager, wird es
    // eingenommen; sonst automatisch weiter zum gegnerischen Endboss.
    if (g.towerTarget && towers[g.towerTarget]?.alive) {
      return { type: 'tower', node: g.towerTarget };
    }
    if (!supplyDone(g)) {
      return { type: 'supply', node: g.supplyTarget };
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

  // --- Vorratslager: Einnahme, Nachschub und der mächtige Verbündete ---------
  // Ablauf und Begründung stehen in design-vorratslager.md. Die Einnahme folgt
  // exakt der Friedhofsregel (Alleinsein, ununterbrochene Präsenz, Abbruch setzt
  // auf 0 zurück) mit einem entscheidenden Unterschied: Ein Lager liegt auf einem
  // Hauptweg, deshalb nimmt es nur ein, wer es ausdrücklich als Ziel geplant hat
  // (`supplyTarget` – der Pfad endet dort). Ein bloßer Durchmarsch stört zwar die
  // Einnahme des Gegners, treibt aber keine eigene voran.

  // Lager, die einer Fraktion gerade tatsächlich Nachschub liefern: in Betrieb
  // genommen und nicht vom Gegner besetzt.
  const deliveringCamps = (faction) =>
    supplyCampIds.filter(
      (id) => supplyOwner[id] === faction && supplyActive[id] && !supplyBlocked[id]
    );

  // Nachschubrate einer Fraktion in Vorrat je Sekunde: ein lieferndes Lager
  // bringt einen Vorratspunkt je `supplyTickTime`.
  const supplyRate = (faction) => deliveringCamps(faction).length / supplyTickTime;

  // Aufgelaufenen Vorrat bis zum Zeitpunkt t verbuchen. Muss vor jeder Änderung
  // der Rate (also vor jedem Besitzwechsel) aufgerufen werden, damit die neue
  // Rate nicht rückwirkend gilt.
  function settleSupply(t) {
    for (const faction of ['blue', 'red']) {
      supply[faction] += (t - supplySince[faction]) * supplyRate(faction);
      supplySince[faction] = t;
    }
  }

  // Aktueller Vorratsstand inklusive des seit der letzten Verbuchung
  // aufgelaufenen Anteils – für Anzeige und Auswertung.
  const supplyNow = (faction) =>
    supply[faction] + (time - supplySince[faction]) * supplyRate(faction);

  // Zeitpunkt, zu dem eine Fraktion die Schwelle erreicht (Infinity, wenn sie
  // kein Lager hält oder ihr Verbündeter schon erschienen ist). Weil die Rate
  // zwischen zwei Besitzwechseln konstant ist, ist dieser Zeitpunkt exakt
  // berechenbar und wird als reguläres Ereignis eingeplant – der Vorratsfluss
  // hängt dadurch nicht davon ab, wann anderswo auf der Karte etwas passiert.
  function allyDueAt(faction) {
    if (allySummoned[faction]) return Infinity;
    const rate = supplyRate(faction);
    if (rate <= 0) return Infinity;
    return supplySince[faction] + (allySupplyCost - supply[faction]) / rate;
  }

  // Fällige Inbetriebnahmen abschließen: Das Lager liefert ab sofort dauerhaft,
  // auch wenn die Einheit weiterzieht. Wartende Einheiten werden frei und setzen
  // im selben Batch ihre Befehle fort.
  function completeSupplyCaptures(t) {
    for (const campId of supplyCampIds) {
      const cap = supplyCaptures[campId];
      if (!cap || cap.startedAt + supplyCaptureTime > t + EPS) continue;
      // Vor der Ratenänderung abrechnen – die neue Rate gilt erst ab jetzt.
      settleSupply(t);
      delete supplyCaptures[campId];
      supplyActive[campId] = true;
      addLog(`${FACTIONS[cap.faction].name} nimmt das Vorratslager ${nodeName(campId)} in Betrieb!`);
      addEvent({ type: 'supplyCaptured', faction: cap.faction, where: { node: campId } });
      for (const g of groups) {
        if (g.state === 'capturing' && g.node === campId) g.state = 'atNode';
      }
    }
  }

  // Zustand aller Lager aktualisieren: laufende Inbetriebnahme und Blockade.
  // Eine Inbetriebnahme verlangt – wie die Friedhofseinnahme – ununterbrochene
  // Präsenz der Besitzerfraktion allein vor Ort, zusätzlich muss das Lager
  // ausdrücklich als Ziel geplant sein. Eine Blockade dagegen entsteht nur durch
  // eine gegnerische Einheit, die das Lager ausdrücklich besetzt: Wer bloß
  // durchmarschiert, legt es nicht lahm – sonst wäre es dauernd gestört, denn
  // der Anmarschweg des Gegners führt ohnehin daran vorbei.
  function updateSupplyCamps(t) {
    for (const campId of supplyCampIds) {
      const owner = supplyOwner[campId];
      const foe = enemyOf(owner);
      const present = { blue: false, red: false };
      let claimant = false; // eigene Einheit will das Lager ausdrücklich in Betrieb nehmen
      let besieger = false; // gegnerische Einheit besetzt es ausdrücklich
      for (const g of combatants(campId)) {
        present[g.faction] = true;
        if (g.supplyTarget !== campId) continue;
        if (g.faction === owner) claimant = true;
        else besieger = true;
      }

      // --- Blockade (nur im Betrieb relevant) ---
      const blocked = besieger;
      if (blocked !== supplyBlocked[campId]) {
        settleSupply(t); // Ratenwechsel: vorher abrechnen
        supplyBlocked[campId] = blocked;
        if (supplyActive[campId]) {
          addLog(
            blocked
              ? `${FACTIONS[foe].name} besetzt das Vorratslager ${nodeName(campId)} – der Nachschub stockt.`
              : `Das Vorratslager ${nodeName(campId)} liefert wieder.`
          );
          addEvent({
            type: blocked ? 'supplyBlocked' : 'supplyResumed',
            faction: owner,
            where: { node: campId },
          });
        }
      }

      // --- Inbetriebnahme ---
      if (supplyActive[campId]) continue;
      const alone = present[owner] && !present[foe];
      const cap = supplyCaptures[campId] ?? null;
      if (!alone || !claimant) {
        if (cap) {
          delete supplyCaptures[campId];
          addLog(
            `Die Inbetriebnahme des Vorratslagers ${nodeName(campId)} wird unterbrochen – der Fortschritt verfällt.`
          );
        }
        continue;
      }
      if (!cap) {
        supplyCaptures[campId] = { faction: owner, startedAt: t };
        addLog(`${FACTIONS[owner].name} beginnt die Inbetriebnahme des Vorratslagers ${nodeName(campId)}.`);
        addEvent({ type: 'supplyCaptureStart', faction: owner, where: { node: campId } });
      }
    }
  }

  // Den mächtigen Verbündeten einer Fraktion herbeirufen: Er erscheint am
  // eigenen Boss-Wegpunkt und marschiert über den regulären Fallback (leerer
  // Pfad, Haltung „Angriff") selbstständig zum gegnerischen Boss.
  function summonAlly(faction, t) {
    allySummoned[faction] = true;
    const def = resolveAllyType(config, faction);
    const g = makeGroup({
      faction,
      def,
      id: `${faction === 'blue' ? 'S' : 'F'}A`,
      ordinal: null,
      actions: [{ path: [], stance: 'attack', trigger: null }],
      ally: true,
      noRespawn: true,
    });
    groups.push(g);
    addLog(`${def.name} erhebt sich für ${FACTIONS[faction].name}!`);
    addEvent({ type: 'allySummoned', faction, where: { node: g.node } });
    continueOrders(g, t);
  }

  // Vorrat abrechnen und – bei erreichter Schwelle – den Verbündeten rufen.
  function checkAllySummon(t) {
    if (!supplyCampIds.length) return;
    settleSupply(t);
    for (const faction of ['blue', 'red']) {
      if (allySummoned[faction] || supply[faction] < allySupplyCost - EPS) continue;
      supply[faction] -= allySupplyCost;
      summonAlly(faction, t);
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
        if (obj.type === 'supply') {
          // Am Ziel-Vorratslager angekommen. Beim eigenen Lager wartet die
          // Einheit, bis es in Betrieb ist, und wird danach wieder frei; am
          // gegnerischen hält sie die Stellung und legt es damit lahm. Beides
          // verwaltet updateSupplyCamps.
          g.state = 'capturing';
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
      // Die Fraktion entscheidet dabei gleich lange Wege über ihre Flanke.
      const path = shortestPath(map, g.node, obj.node, g.faction);
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
    // Der mächtige Verbündete kehrt nicht zurück: Er fällt endgültig, egal wie
    // viele Friedhöfe seine Fraktion hält.
    if (g.noRespawn) {
      g.state = 'gone';
      g.respawnAt = Infinity;
      g.graveyardNode = null;
      addLog(`${g.def.name} ist gefallen und kehrt nicht zurück.`);
    }
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
    completeSupplyCaptures(t);
    // Vorratsschwelle vor den Angriffen prüfen: Ein hier erscheinender
    // Verbündeter startet noch im selben Zeitpunkt seinen Marsch (er steht am
    // eigenen Boss und kämpft in diesem Batch ohnehin nicht).
    checkAllySummon(t);
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
    updateSupplyCamps(t);
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
    for (const campId of supplyCampIds) {
      const cap = supplyCaptures[campId];
      if (cap) t = Math.min(t, cap.startedAt + supplyCaptureTime);
    }
    // Genau ein Zeitpunkt je Fraktion: der Moment, in dem ihr Vorrat die
    // Schwelle erreicht. Ohne gehaltenes Lager (oder nach dem Erscheinen des
    // Verbündeten) ist er Infinity – die Patt-Erkennung bleibt damit intakt.
    t = Math.min(t, allyDueAt('blue'), allyDueAt('red'));
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
  updateSupplyCamps(0);

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
    // Aktueller Vorratszustand für Renderer/UI: Lagerliste, Besitz, laufende
    // Einnahmen, Vorratsstand je Fraktion, Schwelle und ob der Verbündete einer
    // Fraktion bereits erschienen ist.
    supplyState: {
      camps: supplyCampIds, // Kennungen in fester Reihenfolge
      owner: supplyOwner, // feste Zuordnung nodeId → Fraktion
      active: supplyActive, // in Betrieb genommen?
      blocked: supplyBlocked, // vom Gegner besetzt und dadurch stillgelegt?
      captures: supplyCaptures, // laufende Inbetriebnahme { faction, startedAt }
      cost: allySupplyCost,
      allySummoned,
      captureTime: supplyCaptureTime,
      // Stetig aufgelaufener Stand – nicht der zuletzt verbuchte Wert.
      get supply() {
        return { blue: supplyNow('blue'), red: supplyNow('red') };
      },
    },
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
