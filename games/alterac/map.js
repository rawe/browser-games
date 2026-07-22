// Kartendefinition: festes Wegpunkt-Netzwerk des Alteractals.
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
const NODES = [
  { id: 'rboss', type: 'boss', faction: 'red', x: 240, y: 78, name: 'Kriegsherr Eiszahn', labelDy: 46 },
  { id: 'rgy', type: 'graveyard', faction: 'red', x: 96, y: 150, name: 'Nordfriedhof', labelDy: 30 },
  { id: 'rgate', type: 'combat', x: 240, y: 214, name: 'Nordtor', labelDx: 52, labelDy: 4 },
  { id: 'wn', type: 'combat', x: 112, y: 356, name: 'Eisfelsklamm', labelDy: 32 },
  { id: 'en', type: 'combat', x: 368, y: 356, name: 'Steinbruch', labelDy: 32 },
  { id: 'mid', type: 'combat', x: 240, y: 488, name: 'Feldmitte', labelDx: 56, labelDy: 4 },
  { id: 'ws', type: 'combat', x: 112, y: 620, name: 'Wolfsschlucht', labelDy: 32 },
  { id: 'es', type: 'combat', x: 368, y: 620, name: 'Kiefernhang', labelDy: 32 },
  { id: 'sgate', type: 'combat', x: 240, y: 760, name: 'Südtor', labelDx: 48, labelDy: 4 },
  { id: 'bgy', type: 'graveyard', faction: 'blue', x: 384, y: 830, name: 'Südfriedhof', labelDy: 30 },
  { id: 'bboss', type: 'boss', faction: 'blue', x: 240, y: 896, name: 'General Steinbrecher', labelDy: -40 },
];

// Verbindungen. `bend` krümmt den Weg optisch (und die Einheiten folgen der Kurve).
const EDGES = [
  { a: 'rboss', b: 'rgate', bend: 0 },
  { a: 'rgate', b: 'rgy', bend: 10 },
  { a: 'rgate', b: 'wn', bend: 16 },
  { a: 'rgate', b: 'en', bend: -16 },
  { a: 'wn', b: 'mid', bend: 8 },
  { a: 'en', b: 'mid', bend: -8 },
  { a: 'wn', b: 'ws', bend: 26 },
  { a: 'en', b: 'es', bend: -26 },
  { a: 'mid', b: 'ws', bend: 8 },
  { a: 'mid', b: 'es', bend: -8 },
  { a: 'ws', b: 'sgate', bend: 16 },
  { a: 'es', b: 'sgate', bend: -16 },
  { a: 'sgate', b: 'bgy', bend: -10 },
  { a: 'sgate', b: 'bboss', bend: 0 },
];

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
    graveyards: { blue: ['bgy'], red: ['rgy'] },
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

// Kürzester Weg (wenigste Wegstücke). Bei gleicher Länge gewinnt deterministisch
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

// Nächstgelegener eigener Friedhof (nach Wegstrecke vom Ort der Niederlage).
export function nearestGraveyard(map, faction, from) {
  const own = map.graveyards[faction];
  let bestId = own[0];
  let bestDist = Infinity;
  for (const gy of [...own].sort()) {
    const path = shortestPath(map, from, gy);
    const dist = path ? path.length : Infinity;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = gy;
    }
  }
  return bestId;
}
