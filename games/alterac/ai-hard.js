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
//     erleidet nur den `entrenchedFactor`-Anteil) auf dem Zugang, über den der
//     Gegner wirklich kommt, ist damit die billigste Lebensversicherung des
//     eigenen Fürsten. **Wo er wirklich kommt, verrät seine eigene Wegwahl:**
//     Er hält sich an dieselbe Flankenregel wie wir („im Zweifel rechts",
//     `pathLess` in map.js), sein Anmarschweg ist deshalb das Spiegelbild des
//     eigenen. Die Zahl der vordefinierten Routen taugt dafür nicht – sie
//     beschreibt das gedachte Wegenetz, nicht den Weg, den die Wegsuche wählt.
//  2b. **Beides gilt nur, solange der Schild etwas taugt.** Ist er im Setup
//     schwach eingestellt (oder gibt es gar keine Türme), lohnt weder der Umweg
//     über die Türme noch ihre Bewachung: dann stürmt die Gruppe direkt den Boss
//     und die Wachen halten den eigenen Boss-Wegpunkt, wo der Fürst mitkämpft.
//     Entschieden wird das über einen Zeitvergleich, nicht über feste Schwellen.
//  3. **Konzentration schlägt Zersplitterung.** Die Angriffsgruppe bleibt
//     zusammen und nimmt die Türme nacheinander (Auftragskette „Dann"). Zuerst
//     fällt der **Nebenzugang** (der Turm mit den wenigsten Routen): Am
//     Hauptzugang beginnen alle Routen des Gegners, dort marschiert ihm seine
//     ausrückende Armee zu Hilfe und gekämpft wird direkt neben seinem Friedhof.
//     Dass am Nebenzugang seine Wache steht (Leitgedanke 2 gilt für ihn
//     genauso), ist einkalkuliert: Eine einzelne eingegrabene Wache kostet die
//     geschlossene Gruppe weniger als der Anmarsch der ganzen feindlichen Armee.
//  4. **„Sobald der Boss-Schild fällt" ist der einzige verlässliche Taktgeber.**
//     Beide Seiten räumen die Türme in ähnlicher Zeit – fällt der Schild des
//     Gegners, ist der eigene gerade ebenfalls weg. Die Wache hat dann keinen
//     Turm mehr zu halten und zieht sich auf den eigenen Boss-Wegpunkt zurück,
//     wo der Fürst mitkämpft, sie sich erneut eingräbt und ihr Friedhof
//     nebenan liegt – während jeder gefallene Angreifer den ganzen Weg
//     zurücklaufen muss. Nachstoßen war die teurere Variante (siehe Messwerte
//     im Wachen-Abschnitt).
//  5. **Das eigene Vorratslager ist ein zweiter Weg zur Stärke – aber nur mit
//     Überschuss.** Der mächtige Verbündete kostet einmalig eine Einheit für
//     Anmarsch und Inbetriebnahme; er lohnt, solange er noch im Zeitrahmen der
//     Partie wirkt UND die Angriffsgruppe auch ohne den Läufer stärker bleibt
//     als die Verteidigung an ihrem ersten Ziel. Das gegnerische Lager zu
//     besetzen lohnt dagegen nicht: Es verzögert seinen Verbündeten nur, kostet
//     aber eine Einheit für die ganze Partie.
//
// Bewusst NICHT umgesetzt: ein eigener Friedhofsläufer. Eine Einheit, die einen
// neutralen Friedhof einnimmt, steht dafür die volle Einnahmedauer still und
// fehlt der Angriffsgruppe genau dort, wo die Partie entschieden wird – im
// Turnier verlor diese Variante deutlich gegen die konzentrierte Aufstellung.

import { resolveUnitTypes, resolveUnitTypeMap, resolveAllyType, MAX_ACTIONS } from './config.js';
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
  // dort erwartet man die Wache des Gegners und dort marschiert ihm seine
  // ausrückende Armee zu Hilfe.
  const trafficOn = (rs, node) => rs.filter((r) => r.path.includes(node)).length;

  // Wo kommt der Gegner tatsächlich an? Er hält sich an dieselbe Flankenregel
  // wie wir („im Zweifel rechts halten", siehe `pathLess` in map.js), sein
  // Anmarschweg ist deshalb exakt das Spiegelbild des eigenen und damit
  // vorhersagbar. Die Zahl der vordefinierten Routen taugt als Ersatz NICHT: Sie
  // beschreibt das gedachte Wegenetz, nicht den Weg, den die Wegsuche wirklich
  // wählt. Wer seine Wache danach stellt, steht am meistbeschriebenen Tor,
  // während der Gegner geschlossen über die andere Flanke einläuft – beide
  // Armeen rennen aneinander vorbei und beide Fürsten fallen.
  const enemyApproach = shortestPath(map, map.start[enemy], ownBoss, enemy) ?? [];
  const approachStep = new Map(enemyApproach.map((id, i) => [id, i]));
  // Rang eines Wegpunkts auf diesem Anmarschweg: klein = der Gegner kommt früh
  // vorbei, groß = er liegt gar nicht auf seinem Weg (bewusst endlich gehalten,
  // damit der Vergleich zweier abseitiger Posten nicht in NaN läuft).
  const approachRank = (node) => approachStep.get(node) ?? enemyApproach.length + 1;

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
  // Routen führen. Der Hauptzugang ist teurer: Weil alle Routen des Gegners an
  // seinem eigenen Tor beginnen, marschiert ihm dort die gesamte ausrückende
  // Armee in den Rücken – gekämpft wird dann direkt neben seinem Friedhof. Am
  // Nebenzugang trifft die Gruppe nur seine Wache (die nach Leitgedanke 2 genau
  // dort steht), bricht durch, schwächt den Fürsten sofort (Turm-Debuff) und
  // nimmt den Hauptturm danach von innen. Bei Gleichstand entscheidet die
  // kürzere Anmarschzeit.
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

  // --- Wachen: Stellung halten, beim Fall der Schilde den Fürsten decken -----
  // Wachposten sind die eigenen Türme (sie tragen den Boss-Schild), zuerst der,
  // an dem der Gegner tatsächlich vorbeikommt (`approachRank`) – eine Wache
  // abseits seines Anmarschwegs bewacht nur sich selbst. Erst danach entscheidet
  // die Routenfrequenz, falls mehrere oder gar kein Posten auf seinem Weg
  // liegen. Taugt der Schild nichts – weil es keine Türme gibt oder er im Setup
  // schwach eingestellt ist, dieselbe Abwägung wie beim Angriff –, ist ein Turm
  // nicht mehr wert als der Boden, auf dem er steht: dann halten die Wachen den
  // eigenen Boss-Wegpunkt, wo der Fürst samt Flächenschlag mitkämpft. Mehr
  // Wachen als Posten stellen sich zusammen.
  const holdTowers = ownTowers.length > 0 && towersFirst;
  const defendNodes = (holdTowers ? [...ownTowers] : [ownBoss]).sort(
    (a, b) =>
      approachRank(a) - approachRank(b) ||
      trafficOn(enemyRoutes, b) - trafficOn(enemyRoutes, a) ||
      stepsBetween(start, a) - stepsBetween(start, b) ||
      nodeFlank(a, b)
  );
  guards.forEach((idx, k) => {
    const node = defendNodes[k % defendNodes.length];
    const actions = [{ path: legFrom(start, node), stance: 'defend', trigger: null }];
    if (shieldExists) {
      // „Sobald der Boss-Schild des Gegners fällt" ist der einzige verlässliche
      // Taktgeber – und in diesem Moment steht der eigene Fürst am Abgrund:
      // Beide Seiten räumen die Türme in ähnlicher Zeit, der eigene Schild ist
      // also gerade ebenfalls weg. Die Wache hat dann keinen Turm mehr zu
      // halten und zieht sich auf den eigenen Boss-Wegpunkt zurück, statt
      // vorzustoßen. Dort kämpft der Fürst mit, die Wache gräbt sich erneut ein,
      // und ihr Friedhof liegt direkt nebenan – während jeder gefallene
      // Angreifer den ganzen Weg zurücklaufen muss. Das Nachstoßen war die
      // teurere Variante: Im Spiegelduell fielen dabei beide Fürsten nach 42 s,
      // mit dem Rückzug hält die Verteidigung 153 s.
      actions.push({
        path: [ownBoss],
        stance: 'defend',
        trigger: { kind: 'when', cond: { type: 'enemyShieldDown' } },
      });
    }
    units[idx].actions = actions;
  });

  // --- Angriffsgruppe: Auftragskette aus den Turmzielen ----------------------
  // Abschnittsliste ab einem beliebigen Ausgangspunkt – für die Gruppe ab dem
  // eigenen Start, für den Lagerläufer ab dem Lager, an dem er hängen bleibt.
  function legsFrom(origin) {
    const out = [];
    let from = origin;
    for (const tower of towersFirst ? targets : []) {
      // Anmarsch zum ersten Ziel über eine vorgesehene Route (sie beschreibt den
      // gedachten Zugang), Verlegungen danach auf kürzestem Weg. Jeder Abschnitt
      // endet exakt auf dem Turm – nur dann gilt er als ausdrücklicher
      // Turmangriff. Führen mehrere Routen zum Ziel, entscheidet auch hier die
      // Flanke – die Reihenfolge der Routenliste ist je Fraktion frei gewählt
      // und damit kein spiegelsymmetrisches Kriterium.
      const route =
        from === start
          ? [...routes]
              .filter((r) => r.path.includes(tower))
              .sort(
                (a, b) =>
                  a.path.indexOf(tower) - b.path.indexOf(tower) || pathFlank(a.path, b.path)
              )[0] ?? null
          : null;
      out.push(route ? route.path.slice(0, route.path.indexOf(tower) + 1) : legFrom(from, tower));
      from = tower;
    }
    if (!out.length) {
      // Kein Turmziel (Türme abgeschaltet oder schwacher Schild): geschlossen auf
      // der kürzesten Standardroute zum Boss. Turm-Wegpunkte auf dem Weg werden
      // dabei nur passiert – aktiv wird ein Turm nur bei ausdrücklichem Ziel.
      // Bei gleich langen Routen entscheidet die Flanke, nicht der Routenname:
      // Die Namen sind je Fraktion frei vergeben („Eisiger Grat" gegen
      // „Schmugglerpfad") und ihre alphabetische Ordnung hat mit der Karte nichts
      // zu tun – danach zu sortieren schickte die beiden Fraktionen auf
      // unterschiedliche, nicht spiegelbildliche Bahnen.
      const route =
        origin === start
          ? [...routes].sort((a, b) => a.path.length - b.path.length || pathFlank(a.path, b.path))[0]
          : null;
      out.push(route ? [...route.path] : legFrom(origin, enemyBoss));
    }
    return out;
  }

  const legs = legsFrom(start);
  for (const idx of assault) {
    units[idx].actions = legs.map((path, k) => ({
      path: [...path],
      stance: 'attack',
      trigger: k === 0 ? null : { kind: 'then' },
    }));
  }

  // --- Vorratslager: lohnt der Abstecher? ------------------------------------
  // Jede Fraktion hat genau EIN fest zugeordnetes Lager (`map.supplyCampOf`).
  // Es startet inaktiv; eine eigene Einheit muss es ausdrücklich als Pfadziel
  // haben (der Pfad endet dort) und `supplyCaptureTime` Sekunden daran arbeiten.
  // Aufhalten kann sie dabei nur ein Gegner, der das Lager seinerseits
  // ausdrücklich besetzt – Durchmarsch stört nicht. Der Fortschritt verfällt
  // dabei nie, er ruht: Fällt der Läufer, setzt der nächste dort fort, wo er
  // aufgehört hat. Danach liefert das Lager dauerhaft: nach `allySupplyCost ×
  // supplyTickTime` Sekunden erscheint der mächtige Verbündete am eigenen
  // Fürsten und marschiert selbstständig los. Der Abstecher kostet also
  // einmalig Zeit, nicht dauerhaft eine Einheit.
  //
  // Zwei Fragen, beide als Zeit- bzw. Kampfwertvergleich statt als feste
  // Schwelle – im selben Lanchester-Maß, das schon die Aufstellung entscheidet:
  //   1. Bringt der Verbündete überhaupt noch etwas? Er wirkt erst, wenn er vor
  //      dem gegnerischen Fürsten steht; liegt dieser Zeitpunkt jenseits des
  //      Zeitrahmens der Partie (`maxTime` – der einzige Anhaltspunkt für ihre
  //      Dauer, den die Regeln hergeben), ist der Umweg verloren.
  //   2. Kann die Angriffsgruppe den Läufer entbehren? Leitgedanke 3 gilt
  //      weiter: Konzentration schlägt Zersplitterung. Sie muss auch OHNE ihn
  //      noch mehr Kampfwert mitbringen als die Verteidigung, die an ihrem
  //      ersten Ziel wartet – der Gegner spielt dieselbe Doktrin, seine Wachen
  //      stehen also eingegraben (`entrenchedFactor` senkt den erlittenen
  //      Schaden, ihr Kampfwert steigt entsprechend) auf ihren Posten, dazu
  //      kommt das Ziel selbst: der Turm oder, bei direktem Sturm, der Fürst
  //      samt Gegenschlag.
  // Im Turnier bestätigt: Wo die Gruppe knapp ist (12 Ressourcen und weniger),
  // kostet der Läufer deutlich mehr Siege, als der Verbündete einbringt; wo sie
  // Überschuss hat, ist er gegen die leichte Stufe neutral und gegen einen
  // ebenbürtigen Gegner ein Vorteil (8:4 Siege im direkten Doktrinvergleich).
  const supplyOn = (config.supplyEnabled ?? false) && (config.supplyTickTime ?? 0) > 0;
  const ownCamp = supplyOn ? (map.supplyCampOf?.[faction] ?? null) : null;
  const enemyCamp = supplyOn ? (map.supplyCampOf?.[enemy] ?? null) : null;
  if (ownCamp || enemyCamp) {
    const ally = resolveAllyType(config, faction);
    const horizon = config.maxTime ?? 0;
    const setupTime = config.supplyCaptureTime ?? 0;
    // Vorratszeit von der Inbetriebnahme bis zur Schwelle (Rate: 1 je Takt).
    const fillTime = (config.allySupplyCost ?? 0) * (config.supplyTickTime ?? 0);
    // Reisezeit über die kürzeste Strecke – in Sekunden statt in Wegstücken.
    const travelTime = (from, to, speed) =>
      stepsBetween(from, to) * ((config.edgeTime ?? 0) / (speed || 1));
    // Tempo der schnellsten anwerbbaren Einheit: So früh KANN der Gegner an
    // einem Ort sein. Seine Aufstellung kennen wir nicht, seine Möglichkeiten
    // schon – und für eine Blockade genügt ihm eine einzige schnelle Einheit.
    const topSpeed = Math.max(...unitTypes.map((t) => t.speed || 1));
    // Kampfwert, den die Angriffsgruppe an ihrem ersten Ziel brechen muss.
    const staticPower = (hp, damage, interval) => hp * (damage / (interval || 1));
    const perPost = defendNodes.length ? Math.ceil(guards.length / defendNodes.length) : 0;
    const guardPower = guards.length
      ? powerOf(defOf(guards[0])) / (config.entrenchedFactor || 1)
      : 0;
    const frontPower =
      perPost * guardPower +
      (towersFirst && targets.length
        ? staticPower(config.towerHp, config.towerDamage, config.towerAttackInterval)
        : staticPower(config.bossHp, config.bossDamage, config.bossAttackInterval));
    const assaultPower = assault.reduce((sum, i) => sum + powerOf(defOf(i)), 0);
    // Kandidaten für Sonderaufträge: die schnellste Einheit der Angriffsgruppe
    // zuerst – sie ist am frühesten am Ziel und (bei gleichem Tempo entscheidet
    // der kleinere Kampfwert) am billigsten abkömmlich. Wer nicht einmal für
    // eine Wache reicht, hat erst recht keine Einheit für einen Sonderauftrag
    // übrig; die Gruppe fällt außerdem nie unter MIN_ASSAULT.
    const spare = [...assault].sort(
      (x, y) =>
        (defOf(y).speed || 1) - (defOf(x).speed || 1) ||
        powerOf(defOf(x)) - powerOf(defOf(y)) ||
        x - y
    );
    // Verbleibender Kampfwert der Gruppe – jeder vergebene Sonderauftrag
    // schmälert ihn, der nächste wird also strenger geprüft.
    let groupPower = assaultPower;
    const takeSpare = () => {
      if (!guards.length || spare.length - 1 < MIN_ASSAULT) return null;
      const idx = spare[0];
      // Ohne diese Einheit muss die Gruppe die Verteidigung am ersten Ziel
      // immer noch überwiegen – sonst bleibt sie zusammen.
      if (groupPower - powerOf(defOf(idx)) <= frontPower + EPS) return null;
      groupPower -= powerOf(defOf(idx));
      return spare.shift();
    };
    const returnSpare = (idx) => {
      groupPower += powerOf(defOf(idx));
      spare.unshift(idx);
    };

    // 1. Das eigene Lager in Betrieb nehmen.
    if (ownCamp) {
      const idx = takeSpare();
      if (idx != null) {
        const speed = defOf(idx).speed || 1;
        const reach = travelTime(start, ownCamp, speed);
        // Ab diesem Moment steht der Verbündete vor dem gegnerischen Fürsten.
        const allyReady =
          reach + setupTime + fillTime + travelTime(ownBoss, enemyBoss, ally.speed);
        if (powerOf(ally) * (horizon - allyReady) > EPS) {
          // Bleiben oder weiterziehen? Der Nachschub braucht `fillTime`
          // Sekunden LIEFERZEIT; eine gegnerische Einheit, die sich ans Lager
          // stellt, hält die Uhr so lange an, wie sie dort steht (der Vorrat
          // bleibt erhalten, er wächst nur nicht). Ist sie schneller
          // da, als der Vorrat voll wird, ist die Lieferung ohne Wache nur
          // geliehen: Dann bleibt die Einheit in Haltung „Halten" stehen
          // (eingegraben hält sie am längsten) und zieht sich später wie jede
          // Wache auf den eigenen Fürsten zurück. Sonst hängt hinter dem Lager
          // die reguläre Auftragskette – sobald es liefert, gilt der Auftrag
          // als erledigt und die Einheit wird von selbst wieder frei.
          const hold =
            travelTime(map.start[enemy], ownCamp, topSpeed) < reach + setupTime + fillTime;
          const rest = hold
            ? shieldExists
              ? [
                  {
                    path: [ownBoss],
                    stance: 'defend',
                    trigger: { kind: 'when', cond: { type: 'enemyShieldDown' } },
                  },
                ]
              : []
            : legsFrom(ownCamp).map((path) => ({
                path: [...path],
                stance: 'attack',
                trigger: { kind: 'then' },
              }));
          units[idx].actions = [
            { path: legFrom(start, ownCamp), stance: hold ? 'defend' : 'attack', trigger: null },
            ...rest,
          ].slice(0, MAX_ACTIONS);
        } else {
          returnSpare(idx); // Umweg lohnt nicht – die Einheit bleibt in der Gruppe.
        }
      }
    }

    // 2. Das gegnerische Lager besetzen und damit lahmlegen? Wer das tut, hält
    // die Stellung bis zum Ende der Partie – sein Auftrag gilt dort nie als
    // erledigt –, teilt an der Front also nie wieder Schaden aus. Und er nimmt
    // dem Gegner den Verbündeten nicht einmal: Eine einmal erfolgte
    // Inbetriebnahme geht nie verloren, fällt der Besetzer, liefert das Lager
    // sofort weiter. Gewonnen ist also nur die Zeit, die ein einzelner Trupp
    // tief im gegnerischen Vorfeld durchhält – gegen die Wachen, die der Gegner
    // nach derselben Doktrin daheim stehen hat. Bezahlt wird
    // dagegen mit der ganzen restlichen Partie. Genau das misst der Vergleich,
    // und bei den Standardwerten fällt er klar negativ aus: Im direkten
    // Doktrinvergleich verlor die Variante mit Blockade 0:2 gegen dieselbe KI
    // ohne sie.
    if (enemyCamp) {
      const idx = takeSpare();
      if (idx != null) {
        const def = defOf(idx);
        const reach = travelTime(start, enemyCamp, def.speed || 1);
        const foeDps = guards.reduce(
          (sum, i) => sum + defOf(i).damage / defOf(i).attackInterval,
          0
        );
        // So lange hält der eingegrabene Besetzer den Posten – und nur so lange
        // stockt der gegnerische Nachschub.
        const stand =
          foeDps > 0 ? def.hp / (config.entrenchedFactor || 1) / foeDps : horizon - reach;
        const gain = powerOf(ally) * Math.max(0, Math.min(stand, horizon - reach));
        const cost = powerOf(def) * Math.max(0, horizon - reach);
        if (gain > cost + EPS) {
          // Haltung „Halten": Eingegraben hält der Posten am längsten.
          units[idx].actions = [
            { path: legFrom(start, enemyCamp), stance: 'defend', trigger: null },
          ];
        } else {
          returnSpare(idx); // Blockade lohnt nicht – die Einheit bleibt in der Gruppe.
        }
      }
    }
  }

  return units;
}
