// Computergegner „Schwer": spielt die Mechaniken gezielt aus, statt nur
// Marschbefehle zu verteilen. Vollständig datengetrieben – alles Kartenwissen
// stammt aus `map` (Wegenetz, Turm-Standorte, Friedhöfe, Routen) und `config`
// (Einheitenwerte, Turm-/Boss-Werte); es gibt keine fest verdrahteten Knoten-,
// Typ- oder Fraktionsnamen. Der Plan ist deterministisch (kein Zufall): gleiche
// Einstellungen ergeben denselben Aufmarsch.
//
// Taktische Leitgedanken (aus den Regeln abgeleitet und im Turnier gegen
// Varianten seiner selbst sowie gegen die leichte Stufe geprüft):
//  1. **Türme sind das eigentliche Ziel.** Solange EIN gegnerischer Turm steht,
//     blockt der Boss-Schild fast allen Schaden – ein Sturm auf den Boss ist
//     davor verschwendet. Die Angriffsgruppe räumt deshalb erst die Türme.
//  2. **Eine Wache hält den eigenen Schild.** Ein Turm ist unverwundbar, solange
//     eine eigene Einheit auf seinem Wegpunkt steht, und der eigene Boss bleibt
//     geschützt, solange EIN eigener Turm steht. Eine eingegrabene Wache (sie
//     erleidet nur den `entrenchedFactor`-Anteil) auf dem meistbenutzten Zugang
//     ist damit die billigste Lebensversicherung des eigenen Fürsten.
//  2b. **Beides gilt nur, solange der Schild etwas taugt.** Ist er im Setup
//     schwach eingestellt (oder gibt es gar keine Türme), lohnt weder der Umweg
//     über die Türme noch ihre Bewachung: dann stürmt die Gruppe direkt den Boss
//     und die Wachen halten den eigenen Boss-Wegpunkt, wo der Fürst mitkämpft.
//     Entschieden wird das über einen Zeitvergleich, nicht über feste Schwellen.
//  3. **Konzentration schlägt Zersplitterung.** Die Angriffsgruppe bleibt
//     zusammen und nimmt die Türme nacheinander (Auftragskette „Dann"). Zuerst
//     fällt der **Nebenzugang** (der Turm mit den wenigsten Routen): dort steht
//     selten eine Wache und dem Gegner marschiert nicht die eigene ausrückende
//     Armee zu Hilfe – am Hauptzugang beginnen alle seine Routen. Danach nimmt
//     die Gruppe den Hauptturm.
//  4. **„Sobald der Boss-Schild fällt" ist der einzige verlässliche Taktgeber.**
//     Genau in diesem Moment lohnt der Sturm auf den Boss – die Wachen lösen
//     sich per Reaktions-Auftrag von ihrem Turm und stoßen nach.
//
// Bewusst NICHT umgesetzt: ein eigener Friedhofsläufer. Eine Einheit, die einen
// neutralen Friedhof einnimmt, steht dafür die volle Einnahmedauer still und
// fehlt der Angriffsgruppe genau dort, wo die Partie entschieden wird – im
// Turnier verlor diese Variante deutlich gegen die konzentrierte Aufstellung.

import { resolveUnitTypes, resolveUnitTypeMap, MAX_ACTIONS } from './config.js';
import { ROUTES, enemyOf, towerNodes, shortestPath } from './map.js';

// Rollenverteilung – bewusst rein verhältnisbezogen (keine festen Stückzahlen
// für bestimmte Karten oder Budgets).
const UNITS_PER_GUARD = 4; // je angefangene 4 Einheiten eine Wache (bis die Wachposten ausgehen)
const MIN_ASSAULT = 2; // so viele Einheiten bleiben mindestens in der Angriffsgruppe

// Wie viel länger darf der Umweg über die Türme dauern als der direkte Sturm auf
// den Boss, damit er sich trotzdem lohnt? Der Umweg zahlt sich über die reine
// Zeitrechnung hinaus aus – jeder zerstörte Turm schwächt den gegnerischen
// Fürsten dauerhaft (towerDamageReduction), und am ungeschützten Boss kostet der
// Kampf deutlich weniger Verluste. Der Faktor 2 ist im Turnier kalibriert: mit
// ihm trifft die Abschätzung über alle gemessenen Schild-Stufen (0 – 95 %) und
// Budgets die jeweils bessere Doktrin.
const TOWER_DETOUR_TOLERANCE = 2;

// Kampfwert einer Einheit nach Lanchester: Lebenspunkte × Schaden pro Sekunde.
// Beide Faktoren zählen gleichrangig – eine zähe Einheit hält länger durch und
// teilt dadurch über die Zeit mehr aus.
const powerOf = (t) => t.hp * (t.damage / t.attackInterval);

const EPS = 1e-9;

// Kürzester Weg wie `shortestPath`, aber zusätzlich um gesperrte Knoten herum
// (etwa die Bosse, die eine Verlegung zwischen zwei Türmen nicht durchqueren
// soll – dort begänne sofort ein aussichtsloser Boss-Kampf). Friedhöfe werden
// wie in der Wegsuche der Karte nie durchquert, nur als Ziel betreten.
// Deterministisch und spiegelsymmetrisch: Bei gleicher Länge entscheidet – exakt
// wie in `shortestPath` – die Flanke der Fraktion, nicht die Knoten-Kennung.
// Ein textlicher Vergleich würde beide Fraktionen durch denselben Korridor
// schicken und damit eine Seite bevorzugen. Die Rückgabe enthält den Startknoten.
function pathAvoiding(map, from, to, faction, blocked = new Set()) {
  if (from === to) return [from];
  const flank = faction === 'blue' ? 1 : -1;
  const better = (cand, ex) => {
    if (!ex || cand.length < ex.length) return true;
    if (cand.length > ex.length) return false;
    for (let i = 0; i < cand.length; i++) {
      const dx = map.nodes[cand[i]].x - map.nodes[ex[i]].x;
      if (dx !== 0) return flank > 0 ? dx > 0 : dx < 0;
    }
    return false;
  };
  const best = new Map([[from, [from]]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const curPath = best.get(cur);
    for (const nb of map.adjacency[cur]) {
      if (nb !== to && (blocked.has(nb) || map.nodes[nb].type === 'graveyard')) continue;
      const cand = [...curPath, nb];
      if (better(cand, best.get(nb))) {
        best.set(nb, cand);
        queue.push(nb);
      }
    }
  }
  // Ohne Umweg-Lösung lieber den direkten Weg als gar keinen Befehl.
  return best.get(to) ?? shortestPath(map, from, to, faction) ?? [from];
}

// Beste Armee für ein Budget: exakte dynamische Programmierung über die
// Ressourcenpunkte, die die Summe der Kampfwerte maximiert. Bei gleichem
// Kampfwert gewinnt die Aufstellung mit mehr Einheiten (mehr gleichzeitige
// Angreifer, mehr Ziele für den Gegner) – das Ergebnis ist damit eindeutig.
function bestArmy(unitTypes, budget) {
  const best = [{ power: 0, units: [] }];
  for (let b = 1; b <= budget; b++) {
    let cur = best[b - 1] ?? null; // Punkt notfalls verfallen lassen
    for (const t of unitTypes) {
      const prev = t.cost <= b ? best[b - t.cost] : null;
      if (!prev) continue;
      const cand = { power: prev.power + powerOf(t), units: [...prev.units, t.key] };
      const better =
        !cur ||
        cand.power > cur.power + EPS ||
        (Math.abs(cand.power - cur.power) <= EPS && cand.units.length > cur.units.length);
      if (better) cur = cand;
    }
    best[b] = cur;
  }
  return best[budget]?.units ?? [];
}

export function planHard(config, map, faction) {
  // Effektive Einheitenwerte dieser Partie (Datei-Defaults ggf. überschrieben).
  const unitTypes = resolveUnitTypes(config);
  const byKey = resolveUnitTypeMap(config);
  const enemy = enemyOf(faction);
  const start = map.start[faction];
  const enemyBoss = map.bosses[enemy];
  const ownBoss = map.bosses[faction];

  // Aktive Türme dieser Partie (0 = Türme abgeschaltet) in Kartenreihenfolge.
  const towers = towerNodes(map, config.towersPerFaction ?? 0);
  const ownTowers = (map.towerSites?.[faction] ?? []).filter((id) => towers[id] === faction);
  const enemyTowers = (map.towerSites?.[enemy] ?? []).filter((id) => towers[id] === enemy);
  // Ohne gegnerische Türme gibt es keinen Boss-Schild – die Bedingung „Schild
  // gefallen" wäre ab Sekunde 0 wahr und würde jede Reaktion sofort auslösen.
  const shieldExists = enemyTowers.length > 0;

  const routes = ROUTES[faction] ?? [];
  const enemyRoutes = ROUTES[enemy] ?? [];
  const noWalk = new Set([enemyBoss, ownBoss]); // Bosse nie als Durchgangsknoten nutzen
  const stepsBetween = (a, b) => {
    const p = shortestPath(map, a, b);
    return p ? p.length - 1 : Infinity;
  };
  // Wegpunkte ab einem Startknoten (ohne ihn selbst – dort steht die Einheit schon).
  const legFrom = (from, to) => pathAvoiding(map, from, to, faction, noWalk).slice(1);
  // Spiegelsymmetrischer Tiebreak für sonst gleichwertige Alternativen: Es
  // gewinnt die auf der eigenen Flanke – Ost für die Südfraktion, West für die
  // Nordfraktion. Ein Vergleich von Knoten-Kennungen oder Routennamen wäre
  // asymmetrisch: Er ließe beide Fraktionen dieselbe absolute Flanke wählen,
  // sodass ein Korridor zur Hauptachse und der andere zum toten Winkel würde.
  const flankOf = faction === 'blue' ? 1 : -1;
  const nodeFlank = (a, b) => flankOf * (map.nodes[b].x - map.nodes[a].x);
  const pathFlank = (pa, pb) => {
    for (let i = 0; i < pa.length && i < pb.length; i++) {
      const d = nodeFlank(pa[i], pb[i]);
      if (d !== 0) return d;
    }
    return pa.length - pb.length;
  };
  // Wie stark wird ein Wegpunkt frequentiert? Gemessen an der Zahl der
  // Standardrouten, die über ihn führen: der meistbenutzte ist der Hauptzugang –
  // den bewacht man selbst am ehesten und dort erwartet man auch den Gegner.
  const trafficOn = (rs, node) => rs.filter((r) => r.path.includes(node)).length;

  // --- Armee zusammenstellen ------------------------------------------------
  // Angeworben wird die kampfwertstärkste Aufstellung, die das Budget hergibt.
  // (Eine bewusst beigemischte schnelle Einheit „für Tempo" hat sich im Turnier
  // nicht bewährt: sie erreicht den Turm vor der Gruppe und fällt einzeln.)
  const units = bestArmy(unitTypes, config.resources).map((key) => ({ type: key, actions: [] }));
  if (!units.length) return units;

  // --- Rollen verteilen -----------------------------------------------------
  // Wachen: die zähesten Einheiten (halten eingegraben am längsten durch).
  // Alle übrigen bilden die Angriffsgruppe.
  const defOf = (i) => byKey[units[i].type];
  const byToughness = units
    .map((u, i) => i)
    .sort((x, y) => defOf(y).hp - defOf(x).hp || powerOf(defOf(y)) - powerOf(defOf(x)) || x - y);

  const guardCount = Math.min(
    Math.floor(units.length / UNITS_PER_GUARD),
    Math.max(0, units.length - MIN_ASSAULT)
  );
  const guards = byToughness.slice(0, guardCount);
  const assault = units.map((u, i) => i).filter((i) => !guards.includes(i));

  // --- Angriffsziele: Türme der Reihe nach, danach automatisch zum Boss -------
  // Zielreihenfolge: der Nebenzugang zuerst – der Turm, über den die wenigsten
  // Routen führen. Der Hauptzugang ist doppelt teuer: dort steht die Wache des
  // Gegners, und weil alle seine Routen an seinem eigenen Tor beginnen, marschiert
  // ihm dort auch noch die gesamte ausrückende Armee in den Rücken – gekämpft
  // wird dann direkt neben seinem Friedhof. Der stille Nebenzugang fällt schnell,
  // schwächt den Fürsten sofort (Turm-Debuff) und die Gruppe nimmt den Hauptturm
  // danach von innen. Bei Gleichstand entscheidet die kürzere Anmarschzeit.
  // Die KI hält sich an dieselbe Auftragsgrenze wie der Spieler (MAX_ACTIONS);
  // bei mehr Türmen als Aufträgen bleiben die hinteren Ziele dem Boss-Fallback
  // überlassen.
  const targets = [...enemyTowers]
    .sort(
      (a, b) =>
        trafficOn(routes, a) - trafficOn(routes, b) ||
        stepsBetween(start, a) - stepsBetween(start, b) ||
        nodeFlank(a, b)
    )
    .slice(0, MAX_ACTIONS);

  // Doktrin: erst die Türme oder direkt auf den Boss? Normalerweise ist der
  // Umweg zwingend, weil der Boss-Schild fast allen Schaden blockt – ist er im
  // Setup aber schwach eingestellt, ist der direkte Sturm schneller. Verglichen
  // werden zwei grobe Zeitabschätzungen der Angriffsgruppe:
  //   Sturm:  Boss-LP / (Gruppenschaden pro Sekunde × durchgelassener Anteil)
  //   Türme:  Turm-LP je Turm + Umwegstrecke + Boss-LP bei vollem Schaden
  // (Beides ohne Gegenwehr gerechnet – als Vergleich zweier Wege genügt das;
  // die Unwucht fängt TOWER_DETOUR_TOLERANCE ab.)
  const assaultDps = assault.reduce((sum, i) => sum + defOf(i).damage / defOf(i).attackInterval, 0);
  const slowest = Math.min(...assault.map((i) => defOf(i).speed || 1));
  const edgeTravel = (config.edgeTime ?? 0) / (slowest || 1);
  const shield = shieldExists ? (config.bossTowerShield ?? 0) : 0;
  let chainSteps = 0;
  let waypoint = start;
  for (const tower of targets) {
    chainSteps += stepsBetween(waypoint, tower);
    waypoint = tower;
  }
  chainSteps += stepsBetween(waypoint, enemyBoss);
  const detour = Math.max(0, chainSteps - stepsBetween(start, enemyBoss)) * edgeTravel;
  const towerTime =
    assaultDps > 0
      ? targets.length * (config.towerHp / assaultDps) + detour + config.bossHp / assaultDps
      : Infinity;
  const rushTime =
    assaultDps > 0 && shield < 1 ? config.bossHp / (assaultDps * (1 - shield)) : Infinity;
  const towersFirst = towerTime <= TOWER_DETOUR_TOLERANCE * rushTime;

  // --- Wachen: Stellung halten, beim Fall des gegnerischen Schilds nachstoßen -
  // Wachposten sind die eigenen Türme (sie tragen den Boss-Schild), der von den
  // gegnerischen Routen meistbenutzte zuerst. Taugt der Schild nichts – weil es
  // keine Türme gibt oder er im Setup schwach eingestellt ist, dieselbe
  // Abwägung wie beim Angriff –, ist ein Turm nicht mehr wert als der Boden, auf
  // dem er steht: dann halten die Wachen den eigenen Boss-Wegpunkt, wo der Fürst
  // samt Flächenschlag mitkämpft. Mehr Wachen als Posten stellen sich zusammen.
  const holdTowers = ownTowers.length > 0 && towersFirst;
  const defendNodes = (holdTowers ? [...ownTowers] : [ownBoss]).sort(
    (a, b) =>
      trafficOn(enemyRoutes, b) - trafficOn(enemyRoutes, a) ||
      stepsBetween(start, a) - stepsBetween(start, b) ||
      nodeFlank(a, b)
  );
  guards.forEach((idx, k) => {
    const node = defendNodes[k % defendNodes.length];
    const actions = [{ path: legFrom(start, node), stance: 'defend', trigger: null }];
    if (shieldExists) {
      // Der Schild des Gegners ist gefallen: jetzt zählt nur noch Tempo am Boss.
      // (Leerer Pfad + Haltung „Angriff" = Marsch auf den gegnerischen Boss.)
      actions.push({
        path: [],
        stance: 'attack',
        trigger: { kind: 'when', cond: { type: 'enemyShieldDown' } },
      });
    }
    units[idx].actions = actions;
  });

  // --- Angriffsgruppe: Auftragskette aus den Turmzielen ----------------------
  const legs = [];
  let from = start;
  for (const tower of towersFirst ? targets : []) {
    // Anmarsch zum ersten Ziel über eine vorgesehene Route (sie beschreibt den
    // gedachten Zugang), Verlegungen danach auf kürzestem Weg. Jeder Abschnitt
    // endet exakt auf dem Turm – nur dann gilt er als ausdrücklicher Turmangriff.
    // Führen mehrere Routen zum Ziel, entscheidet auch hier die Flanke – die
    // Reihenfolge der Routenliste ist je Fraktion frei gewählt und damit kein
    // spiegelsymmetrisches Kriterium.
    const route =
      from === start
        ? [...routes]
            .filter((r) => r.path.includes(tower))
            .sort(
              (a, b) =>
                a.path.indexOf(tower) - b.path.indexOf(tower) || pathFlank(a.path, b.path)
            )[0] ?? null
        : null;
    legs.push(route ? route.path.slice(0, route.path.indexOf(tower) + 1) : legFrom(from, tower));
    from = tower;
  }
  if (!legs.length) {
    // Kein Turmziel (Türme abgeschaltet oder schwacher Schild): geschlossen auf
    // der kürzesten Standardroute zum Boss. Turm-Wegpunkte auf dem Weg werden
    // dabei nur passiert – aktiv wird ein Turm nur bei ausdrücklichem Ziel.
    // Bei gleich langen Routen entscheidet die Flanke, nicht der Routenname:
    // Die Namen sind je Fraktion frei vergeben („Eisiger Grat" gegen
    // „Schmugglerpfad") und ihre alphabetische Ordnung hat mit der Karte nichts
    // zu tun – danach zu sortieren schickte die beiden Fraktionen auf
    // unterschiedliche, nicht spiegelbildliche Bahnen.
    const route = [...routes].sort(
      (a, b) => a.path.length - b.path.length || pathFlank(a.path, b.path)
    )[0];
    legs.push(route ? [...route.path] : legFrom(start, enemyBoss));
  }
  for (const idx of assault) {
    units[idx].actions = legs.map((path, k) => ({
      path: [...path],
      stance: 'attack',
      trigger: k === 0 ? null : { kind: 'then' },
    }));
  }

  return units;
}
