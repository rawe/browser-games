// Schlachtbericht: aus dem rohen Simulationszustand eine fertig aufbereitete,
// DOM-freie Auswertung. `result.js` malt sie nur noch hin.
//
// Warum überhaupt ein eigenes Modul: Der Ergebnisbildschirm ist die einzige
// Stelle, an der ein Spieler erfährt, was sein Plan getaugt hat – er greift
// während der Schlacht nie ein. Jede Zahl hier soll deshalb eine Frage der
// *nächsten* Planung beantworten, nicht bloß eine Trophäe sein:
//
//   „War meine Armee richtig zusammengestellt?"  → Schaden je Ressourcenpunkt
//   „Waren meine Ziele richtig?"                 → Turm-, Schild- und Lagerbilanz
//   „Hat jede Einheit überhaupt etwas getan?"    → Zeitbudget je Einheit
//
// Die Rohzahlen sammelt `sim.js` (siehe „Schlachtbilanz" dort), zusammengefasst
// und in Verhältnisse gesetzt wird hier. Trennung mit Absicht: Die Simulation
// zählt, der Bericht wertet, die UI zeigt.

import { FACTIONS, enemyOf } from './map.js';
import { toRoman } from './config.js';

// Die vier Eimer des Zeitbudgets in Anzeigereihenfolge. Sie erzählen von links
// nach rechts den Weg einer Einheit durch die Schlacht: hin, kämpfen, stehen,
// gefallen.
export const TIME_BUCKETS = [
  { key: 'march', label: 'Marsch', icon: '🥾' },
  { key: 'fight', label: 'Kampf', icon: '⚔' },
  { key: 'hold', label: 'Stellung', icon: '🛡' },
  { key: 'down', label: 'Gefallen', icon: '💀' },
];

const sum = (list, pick) => list.reduce((a, x) => a + pick(x), 0);

// Spielzeit als m:ss – gemeinsamer Formatierer für Schlachtuhr und Bericht.
export function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Eine Einheit für den Bericht aufbereiten. `duration` ist die Schlachtdauer –
// daran wird das Zeitbudget gemessen, nicht an der Lebenszeit der Einheit:
// Der mächtige Verbündete erscheint mitten in der Schlacht, und genau das soll
// sein kürzerer Balken auch zeigen.
function unitReport(g, duration) {
  const s = g.stats;
  const dealt = s.dealtUnits + s.dealtBoss + s.dealtTower;
  const cost = g.def.cost ?? 0;
  return {
    id: g.id,
    faction: g.faction,
    // Der Verbündete stammt aus keinem Plan und trägt darum keine Ziffer.
    roman: g.ordinal ? toRoman(g.ordinal) : null,
    ally: g.ally,
    typeKey: g.def.key,
    name: g.def.name,
    icon: g.def.icon,
    cost,
    // „Steht noch": Wer auf den Respawn wartet, ist zum Schlachtende gefallen.
    standing: g.state !== 'dead' && g.state !== 'gone',
    gone: g.state === 'gone',
    hp: Math.max(0, g.hp),
    maxHp: g.maxHp,
    kills: s.kills,
    deaths: s.deaths,
    dealt,
    dealtUnits: s.dealtUnits,
    dealtBoss: s.dealtBoss,
    dealtTower: s.dealtTower,
    blockedBoss: s.blockedBoss,
    taken: s.taken,
    // Was ein Ressourcenpunkt gebracht hat – die Zahl für die Frage, ob sich
    // der schwere Ritter gelohnt hat. Ohne Kosten (Verbündeter) sinnlos.
    perCost: cost > 0 ? dealt / cost : null,
    // Anteile am Schlachtverlauf.
    share: Object.fromEntries(
      TIME_BUCKETS.map((b) => [b.key, duration > 0 ? s.time[b.key] / duration : 0])
    ),
    // Was auf 1 fehlt, ist die Zeit VOR ihrem Erscheinen – nur beim mächtigen
    // Verbündeten von null verschieden. Sie steht als eigener Anteil hier,
    // damit die Anzeige sie an den Anfang des Balkens setzen kann: ans Ende
    // gerückt sähe sie aus, als hätte er die Schlacht überlebt.
    absent:
      duration > 0
        ? Math.max(0, 1 - TIME_BUCKETS.reduce((a, b) => a + s.time[b.key], 0) / duration)
        : 0,
    seconds: { ...s.time },
    // Eine Einheit, die nie zugeschlagen hat, ist der häufigste Planungsfehler –
    // der Bericht benennt ihn ausdrücklich, statt ihn in einer Null zu verstecken.
    idle: s.time.fight <= 0,
  };
}

function factionReport(sim, map, config, faction, duration) {
  const enemy = enemyOf(faction);
  const units = sim.groups
    .filter((g) => g.faction === faction)
    .map((g) => unitReport(g, duration))
    // Plan-Reihenfolge; der Verbündete hängt hinten an (er hat keine Ziffer).
    .sort((a, b) => Number(a.ally) - Number(b.ally));
  const towers = Object.values(sim.towers);
  const own = towers.filter((tw) => tw.faction === faction);
  const enemyTowers = towers.filter((tw) => tw.faction === enemy);
  const st = sim.supplyState;
  const gyIds = map.graveyardIds;
  const boss = sim.boss[faction];
  const dealtBoss = sum(units, (u) => u.dealtBoss);
  const blockedBoss = sum(units, (u) => u.blockedBoss);
  return {
    faction,
    name: FACTIONS[faction].name,
    color: FACTIONS[faction].color,
    dark: FACTIONS[faction].dark,
    boss: {
      hp: Math.max(0, boss.hp),
      maxHp: boss.maxHp,
      frac: boss.maxHp > 0 ? Math.max(0, boss.hp / boss.maxHp) : 0,
      alive: sim.bossAlive[faction],
    },
    units,
    // Verluste zählen Tode, nicht Einheiten: Wer dreimal fiel und dreimal
    // zurückkam, hat dreimal Zeit und Stellung gekostet.
    losses: sum(units, (u) => u.deaths),
    standing: units.filter((u) => u.standing).length,
    kills: sum(units, (u) => u.kills),
    dealt: sum(units, (u) => u.dealt),
    dealtBoss,
    blockedBoss,
    // Anteil des am gegnerischen Fürsten gelandeten Schadens, den sein Schild
    // geschluckt hat – die Zahl, die den Umweg über die Türme begründet.
    shieldShare: dealtBoss + blockedBoss > 0 ? blockedBoss / (dealtBoss + blockedBoss) : null,
    towersOwn: { standing: own.filter((tw) => tw.alive).length, total: own.length },
    // Zerstört hat diese Fraktion die Türme der anderen.
    towersFelled: {
      count: enemyTowers.filter((tw) => !tw.alive).length,
      total: enemyTowers.length,
    },
    graveyards: {
      count: gyIds.filter((id) => sim.graveyards.owner[id] === faction).length,
      total: gyIds.length,
    },
    supply: {
      have: Math.floor(st.supply[faction] ?? 0),
      cost: st.cost,
      allySummoned: !!st.allySummoned?.[faction],
      // Der Verbündete steht als eigene Einheit in der Liste – lebt er noch?
      allyStanding: units.some((u) => u.ally && u.standing),
    },
  };
}

// Vollständiger Bericht einer beendeten Schlacht.
//
// `viewFaction` ist die Seite, aus deren Sicht formuliert wird – im Spiel gegen
// den Computer die des Spielers. Im Hotseat gibt es sie nicht (beide Seiten
// sind Spieler), dann bleibt der Bericht unparteiisch bei den Fraktionsnamen.
export function buildReport({ sim, map, config, viewFaction = null }) {
  const duration = sim.time;
  const res = sim.result ?? { winner: 'draw', reason: '' };
  const factions = {
    blue: factionReport(sim, map, config, 'blue', duration),
    red: factionReport(sim, map, config, 'red', duration),
  };
  return {
    duration,
    winner: res.winner,
    reason: res.reason,
    viewFaction,
    outcome:
      res.winner === 'draw'
        ? 'draw'
        : !viewFaction
          ? 'decided'
          : res.winner === viewFaction
            ? 'win'
            : 'loss',
    // Reihenfolge der Fraktionsblöcke: die eigene zuerst, sonst rot über blau
    // wie im Boss-HUD und auf der Karte.
    order: viewFaction ? [viewFaction, enemyOf(viewFaction)] : ['red', 'blue'],
    factions,
    // Welche Teilsysteme diese Partie überhaupt hatte – der Bericht zeigt keine
    // Zeile für etwas, das abgeschaltet war (dieselbe Regel wie im Boss-HUD).
    has: {
      towers: (config.towersPerFaction ?? 0) > 0,
      shield: (config.towersPerFaction ?? 0) > 0 && (config.bossTowerShield ?? 0) > 0,
      supply: (sim.supplyState?.camps ?? []).length > 0,
    },
  };
}
