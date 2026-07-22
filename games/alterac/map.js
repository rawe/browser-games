// Kartendefinition: konfigurierbares Wegpunkt-Netzwerk des Alteractals.
// NODES, EDGES, GRAVEYARDS, ROUTES und GUARD_POSTS sind die zentralen
// Konfigurationsdaten – neue Wegpunkte, Verbindungen, Friedhöfe oder
// Routenvorschläge werden nur hier ergänzt.
// Die Karte ist vertikal aufgebaut (Norden oben, Süden unten), damit sie
// auf Mobilgeräten per Scrollen gut nutzbar ist.

export const FACTIONS = {
  blue: { key: 'blue', name: 'Sturmlanze', color: '#5b9cff', dark: '#2c5aa8', player: 'Spieler 1' },
  red: { key: 'red', name: 'Frostwolf', color: '#ff6b5e', dark: '#a63a31', player: 'Spieler 2' },
};

export function enemyOf(faction) {
  return faction === 'blue' ? 'red' : 'blue';
}

// Knotentypen: 'combat' (Kampfpunkt), 'graveyard' (Friedhof), 'boss' (Endboss).
// Jeder Boss ist über mindestens zwei getrennte Zugänge erreichbar:
// Nordtor + Eisiger Grat (rot), Südtor + Schmugglerpfad (blau).
// Friedhöfe sind immer Sackgassen mit genau einer Verbindung und liegen nie
// auf einem Hauptweg zur gegnerischen Basis – wer sie will, muss den Abstecher
// (Hin- und Rückweg) explizit in den Pfad einer Einheit einplanen.
// Türme werden direkt am Wegpunkt markiert: `tower: 'red' | 'blue'` legt fest,
// dass an diesem bestehenden Knoten ein Turm der genannten Fraktion steht. Wie
// viele der markierten Kandidaten je Fraktion aktiv sind, steuert
// `towersPerFaction` in config.js (Reihenfolge = Reihenfolge dieser Liste).
const NODES = [
  { id: 'rboss', type: 'boss', faction: 'red', x: 240, y: 78, name: 'Kriegsherr Eiszahn', labelDy: 46 },
  { id: 'rgy', type: 'graveyard', x: 96, y: 150, name: 'Nordfriedhof', labelDy: 30 },
  { id: 'rgate', type: 'combat', tower: 'red', x: 240, y: 214, name: 'Nordtor', labelDx: 52, labelDy: 4 },
  { id: 'reast', type: 'combat', tower: 'red', x: 404, y: 178, name: 'Eisiger Grat', labelDx: 12, labelDy: 26 },
  { id: 'wn', type: 'combat', x: 112, y: 356, name: 'Eisfelsklamm', labelDy: 32 },
  { id: 'en', type: 'combat', x: 368, y: 356, name: 'Steinbruch', labelDy: 32 },
  { id: 'gyw', type: 'graveyard', x: 48, y: 452, name: 'Klammfriedhof', labelDy: 32 },
  { id: 'mid', type: 'combat', x: 240, y: 488, name: 'Feldmitte', labelDx: 56, labelDy: 4 },
  { id: 'gye', type: 'graveyard', x: 432, y: 524, name: 'Hangfriedhof', labelDy: 32 },
  { id: 'gym', type: 'graveyard', x: 240, y: 554, name: 'Talfriedhof', labelDy: 32 },
  { id: 'ws', type: 'combat', x: 112, y: 620, name: 'Wolfsschlucht', labelDy: 32 },
  { id: 'es', type: 'combat', x: 368, y: 620, name: 'Kiefernhang', labelDy: 32 },
  { id: 'sgate', type: 'combat', tower: 'blue', x: 240, y: 760, name: 'Südtor', labelDx: 48, labelDy: 4 },
  { id: 'swest', type: 'combat', tower: 'blue', x: 84, y: 788, name: 'Schmugglerpfad', labelDy: 30 },
  { id: 'bgy', type: 'graveyard', x: 384, y: 830, name: 'Südfriedhof', labelDy: 30 },
  { id: 'bboss', type: 'boss', faction: 'blue', x: 240, y: 896, name: 'General Steinbrecher', labelDy: 46 },
];

// Verbindungen. `bend` krümmt den Weg optisch (und die Einheiten folgen der Kurve).
const EDGES = [
  { a: 'rboss', b: 'rgate', bend: 0 },
  { a: 'rboss', b: 'reast', bend: 14 }, // Umgehung des Nordtors
  { a: 'reast', b: 'en', bend: -14 },
  { a: 'rgate', b: 'rgy', bend: 10 },
  { a: 'rgate', b: 'wn', bend: 16 },
  { a: 'rgate', b: 'en', bend: -16 },
  { a: 'wn', b: 'en', bend: -16 }, // nördliche Querverbindung
  { a: 'wn', b: 'mid', bend: 8 },
  { a: 'en', b: 'mid', bend: -8 },
  { a: 'wn', b: 'ws', bend: 26 },
  { a: 'en', b: 'es', bend: -26 },
  { a: 'mid', b: 'ws', bend: 8 },
  { a: 'mid', b: 'es', bend: -8 },
  { a: 'ws', b: 'es', bend: 16 }, // südliche Querverbindung
  { a: 'ws', b: 'swest', bend: 10 }, // Umgehung des Südtors
  { a: 'swest', b: 'bboss', bend: -12 },
  { a: 'ws', b: 'sgate', bend: 16 },
  { a: 'es', b: 'sgate', bend: -16 },
  { a: 'sgate', b: 'bgy', bend: -10 },
  { a: 'sgate', b: 'bboss', bend: 0 },
  { a: 'wn', b: 'gyw', bend: -10 }, // Sackgasse zum Klammfriedhof
  { a: 'mid', b: 'gym', bend: 0 }, // Sackgasse zum Talfriedhof
  { a: 'es', b: 'gye', bend: 12 }, // Sackgasse zum Hangfriedhof
];

// Zentrale Friedhofskonfiguration: `owner` ist der Startbesitzer (null =
// neutral), `home` markiert den basisnahen Heimatfriedhof einer Fraktion.
// Schutzregel (ausgewertet in sim.js): Der Heimatfriedhof ist nur einnehmbar,
// solange seine Fraktion keinen anderen Friedhof mehr kontrolliert – sobald
// sie wieder mindestens einen anderen hält, ist er erneut geschützt.
// Die Einnahmedauer steht zentral in config.js (graveyardCaptureTime).
export const GRAVEYARDS = {
  rgy: { owner: 'red', home: 'red' },
  bgy: { owner: 'blue', home: 'blue' },
  gyw: { owner: null, home: null },
  gym: { owner: null, home: null },
  gye: { owner: null, home: null },
};

// Vorgeschlagene Routen (vollständige Pfade aus benachbarten Wegpunkten vom
// eigenen Start bis zum gegnerischen Boss). Werden vom Computergegner genutzt
// und können als Vorlagen für weitere UI-Features dienen.
export const ROUTES = {
  red: [
    { name: 'Westflanke', path: ['rgate', 'wn', 'ws', 'sgate', 'bboss'] },
    { name: 'Ostflanke', path: ['rgate', 'en', 'es', 'sgate', 'bboss'] },
    { name: 'Feldmitte', path: ['rgate', 'en', 'mid', 'ws', 'sgate', 'bboss'] },
    { name: 'Schmugglerpfad', path: ['rgate', 'wn', 'ws', 'swest', 'bboss'] },
  ],
  blue: [
    { name: 'Westflanke', path: ['sgate', 'ws', 'wn', 'rgate', 'rboss'] },
    { name: 'Ostflanke', path: ['sgate', 'es', 'en', 'rgate', 'rboss'] },
    { name: 'Feldmitte', path: ['sgate', 'ws', 'mid', 'en', 'rgate', 'rboss'] },
    { name: 'Eisiger Grat', path: ['sgate', 'es', 'en', 'reast', 'rboss'] },
  ],
};

// Verteidigungsposten je Fraktion: die Zugänge zum eigenen Boss (alle direkt
// benachbart zum Startpunkt, damit Wachen sie ohne Umweg beziehen können).
export const GUARD_POSTS = {
  red: ['rgate', 'reast'],
  blue: ['sgate', 'swest'],
};

// Aktive Turm-Wegpunkte als { nodeId: faction }: die ersten `towersPerFaction`
// je Fraktion aus den in `NODES` markierten Turm-Kandidaten (map.towerSites).
// Beide Fraktionen erhalten dieselbe (verfügbarkeitsbegrenzte) Anzahl.
export function towerNodes(map, towersPerFaction) {
  const count = Math.min(
    towersPerFaction,
    map.towerSites.red.length,
    map.towerSites.blue.length
  );
  const out = {};
  for (const faction of ['blue', 'red']) {
    for (const id of map.towerSites[faction].slice(0, count)) out[id] = faction;
  }
  return out;
}

export function createMap() {
  const nodes = {};
  for (const n of NODES) nodes[n.id] = { ...n };

  const edges = EDGES.map((e) => ({ ...e }));
  const adjacency = {};
  for (const n of NODES) adjacency[n.id] = [];
  for (const e of edges) {
    adjacency[e.a].push(e.b);
    adjacency[e.b].push(e.a);
  }
  // Deterministische Reihenfolge für die Wegsuche.
  for (const id of Object.keys(adjacency)) adjacency[id].sort();

  const graveyards = {};
  for (const [id, meta] of Object.entries(GRAVEYARDS)) graveyards[id] = { ...meta };

  // Turm-Kandidaten je Fraktion direkt aus den `tower`-Markierungen der
  // Wegpunkte ableiten (Reihenfolge = NODES-Reihenfolge). So steht der
  // Standort eines Turms unmittelbar in der Knotenkonfiguration.
  const towerSites = { blue: [], red: [] };
  for (const n of NODES) {
    if (n.tower) towerSites[n.tower].push(n.id);
  }

  return {
    width: 480,
    height: 960,
    nodes,
    nodeList: NODES.map((n) => nodes[n.id]),
    edges,
    adjacency,
    bosses: { blue: 'bboss', red: 'rboss' },
    // Alle Einheiten einer Fraktion starten am eigenen Boss-Punkt.
    start: { blue: 'bboss', red: 'rboss' },
    // Statische Friedhofskonfiguration (Startbesitz, Heimatfriedhöfe);
    // der aktuelle Besitzstand während einer Schlacht lebt in sim.js.
    graveyards,
    graveyardIds: Object.keys(graveyards).sort(),
    // Markierte Turm-Standorte je Fraktion (aus den `tower`-Markierungen der
    // Wegpunkte); wie viele davon aktiv sind, entscheidet config.towersPerFaction.
    towerSites,
    edgeBetween(a, b) {
      return edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)) ?? null;
    },
  };
}

// Punkt auf der (leicht gebogenen) Verbindung, t von 0 (bei `from`) bis 1 (bei `to`).
export function edgePoint(map, from, to, t) {
  const e = map.edgeBetween(from, to);
  const a = map.nodes[e.a];
  const b = map.nodes[e.b];
  const f = e.a === from ? t : 1 - t;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * e.bend;
  const cy = my + (dx / len) * e.bend;
  const u = 1 - f;
  return {
    x: u * u * a.x + 2 * u * f * cx + f * f * b.x,
    y: u * u * a.y + 2 * u * f * cy + f * f * b.y,
  };
}

function pathLess(a, b) {
  return a.join('/') < b.join('/');
}

// Kürzester Weg (wenigste Wegstücke) – wird nur noch als Rückfalllösung
// genutzt: für den automatischen Marsch zum Boss nach abgearbeitetem Pfad und
// für den Rückweg nach einem Respawn. Geplante Pfade folgen dagegen exakt den
// vom Spieler gewählten Wegpunkten. Bei gleicher Länge gewinnt deterministisch
// der lexikografisch kleinere Pfad – so bleibt die Simulation reproduzierbar.
// Friedhöfe werden nie durchquert, nur als Ziel (Respawn) betreten.
export function shortestPath(map, from, to) {
  if (from === to) return [from];
  const best = new Map([[from, [from]]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const curPath = best.get(cur);
    for (const nb of map.adjacency[cur]) {
      if (map.nodes[nb].type === 'graveyard' && nb !== to) continue;
      const cand = [...curPath, nb];
      const ex = best.get(nb);
      if (!ex || cand.length < ex.length || (cand.length === ex.length && pathLess(cand, ex))) {
        best.set(nb, cand);
        queue.push(nb);
      }
    }
  }
  return best.get(to) ?? null;
}

// Nächstgelegener Friedhof aus einer Menge (nach Wegstrecke vom Ort der
// Niederlage). `ownedIds` sind die aktuell kontrollierten Friedhöfe der
// Fraktion – ist die Menge leer, gibt es keinen Respawnpunkt (null).
export function nearestGraveyard(map, ownedIds, from) {
  let bestId = null;
  let bestDist = Infinity;
  for (const gy of [...ownedIds].sort()) {
    const path = shortestPath(map, from, gy);
    const dist = path ? path.length : Infinity;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = gy;
    }
  }
  return bestId;
}
