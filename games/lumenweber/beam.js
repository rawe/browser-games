// Strahlverfolgung – das Herz von Lumenweber.
//
// Komplett DOM-frei und ohne Seiteneffekte: rein aus Level + Reglerstellung
// wird der gesamte Lichtverlauf berechnet. Genau dieselbe Funktion benutzen der
// Renderer im Browser, der Solver und die Tests unter `sim/`.
//
// Das Verfahren ist kein Spaziergang mehr, sondern ein **Fixpunkt**: Seit es
// Prismen gibt, kann sich ein Strahl teilen und wieder vereinigen, also ist der
// Lichtweg ein Graph und kein Pfad. Der Zustand ist
//
//     (Zelle, Laufrichtung)  →  Farbmaske
//
// und Farbmasken wachsen nur (Vereinigung zweier Strahlen = ODER der Masken).
// Damit ist die Rechnung monoton über einem endlichen Verband und terminiert
// garantiert nach höchstens `Breite · Höhe · 4 · 2` Schritten – ganz gleich,
// wie viele Prismen im Feld stehen und ob sich das Licht im Kreis dreht.
//
// Der Fixpunkt ist zugleich die *kleinste* Lösung: Ein Ring, der sich nur
// selbst speist, bleibt dunkel. Licht entsteht ausschließlich an der Quelle.

import { cellAt, cellState } from './level.js';
import { DIRS, DIR_KEYS, DIR_INDEX, WHITE, interact, isCorner, endingOf, accepts } from './optics.js';

/** Mittelpunkt einer Zelle in Rasterkoordinaten (1 Einheit = 1 Zelle). */
const center = (x, y) => ({ x: x + 0.5, y: y + 0.5 });

/** Punkt auf der Kante zwischen Zelle (x,y) und der Nachbarzelle in `dir`. */
function edgePoint(x, y, dir) {
  const { dx, dy } = DIRS[dir];
  return { x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5 };
}

/**
 * Schritt 1: Wo überall liegt welches Licht?
 *
 * Das Ergebnis ist ein flaches Feld über `(Zelle, Richtung)` mit der Farbmaske
 * als Wert – vier Bytes je Zelle. Arbeitsliste statt Rekursion: Ein Zustand
 * wird nur dann neu eingereiht, wenn seine Maske tatsächlich wächst. Deshalb
 * endet die Schleife, auch wenn das Licht im Kreis läuft.
 */
export function reachable(level, config) {
  const { width, height } = level;
  const reach = new Int8Array(width * height * 4);
  const queue = [];

  const feed = (x, y, dir, colors) => {
    const at = (y * width + x) * 4 + DIR_INDEX[dir];
    const next = reach[at] | colors;
    if (next === reach[at]) return;
    reach[at] = next;
    queue.push(at);
  };

  for (const source of level.sources) feed(source.x, source.y, source.dir, WHITE);

  while (queue.length > 0) {
    const at = queue.pop();
    const colors = reach[at];
    const dir = DIR_KEYS[at & 3];
    const cellIndex = at >> 2;
    const { dx, dy } = DIRS[dir];
    const next = cellAt(level, (cellIndex % width) + dx, Math.floor(cellIndex / width) + dy);
    if (!next) continue;
    for (const out of interact(next.type, cellState(level, config, next), dir, colors)) {
      feed(next.x, next.y, out.dir, out.colors);
    }
  }

  return reach;
}

/** Farbmaske an einer Stelle des Zustandsfelds. */
const at = (level, reach, x, y, dir) => reach[(y * level.width + x) * 4 + DIR_INDEX[dir]];

/**
 * Schritt 2: Aus dem Zustandsfeld die Polylinien für den Renderer ziehen.
 *
 * Jede Polylinie ist einfarbig – die Farbe kann sich nur an einem Bauteil
 * ändern, und dort endet die Linie ohnehin. Ein Zustand wird höchstens einmal
 * gezeichnet; trifft ein Ast auf einen schon gezeichneten Zustand, ist er von
 * dort an deckungsgleich und endet als `merge`. Das begrenzt zugleich die Zahl
 * der Linien – ganz ohne Sonderfall für Ringe.
 */
function drawPaths(level, config, reach) {
  const paths = [];
  const endings = [];
  const splits = [];
  const drawn = new Uint8Array(reach.length);
  const starts = level.sources.map((s) => ({ x: s.x, y: s.y, dir: s.dir, from: center(s.x, s.y) }));

  const claim = (x, y, dir) => {
    const i = (y * level.width + x) * 4 + DIR_INDEX[dir];
    if (drawn[i]) return false;
    drawn[i] = 1;
    return true;
  };
  const taken = (x, y, dir) => drawn[(y * level.width + x) * 4 + DIR_INDEX[dir]] === 1;

  while (starts.length > 0) {
    const start = starts.pop();
    if (!claim(start.x, start.y, start.dir)) continue;

    let { x, y, dir } = start;
    let colors = at(level, reach, x, y, dir);
    if (colors === 0) continue;

    const points = [start.from];
    let ending = 'outside';

    for (;;) {
      const { dx, dy } = DIRS[dir];
      const next = cellAt(level, x + dx, y + dy);

      if (!next) {                      // Feldrand: Strahl endet auf der Kante
        points.push(edgePoint(x, y, dir));
        break;
      }

      const outs = interact(next.type, cellState(level, config, next), dir, colors);
      if (outs.length === 0) {          // Blocker oder Quelle: vor der Zelle enden
        points.push(edgePoint(x, y, dir));
        ending = endingOf(next.type);
        break;
      }

      x = next.x;
      y = next.y;

      // Ein Bauteil, das Licht aufteilt oder umfärbt, beendet die Linie und
      // setzt sie als eigene Äste fort. Ein Spiegel knickt sie nur ab.
      const straight = outs.length === 1
        && at(level, reach, x, y, outs[0].dir) === colors
        && !taken(x, y, outs[0].dir);

      if (straight) {
        if (isCorner(next.type)) points.push(center(x, y));
        claim(x, y, outs[0].dir);
        dir = outs[0].dir;
        continue;
      }

      if (outs.length > 1) splits.push({ x, y });
      points.push(center(x, y));
      ending = outs.every((o) => taken(x, y, o.dir)) ? 'merge' : 'split';
      for (const out of outs) {
        if (taken(x, y, out.dir)) continue;
        starts.push({ x, y, dir: out.dir, from: center(x, y) });
      }
      break;
    }

    paths.push({ points, colors });
    endings.push(ending);
  }

  return { paths, endings, splits };
}

/**
 * Verfolgt das Licht durch das Raster.
 *
 * @param {object} level    geparstes Level
 * @param {number[]} config Reglerstellung (Index = control, Wert = Zustands-Index)
 * @returns {{
 *   paths: {points: {x:number,y:number}[], colors: number}[],  einfarbige Polylinien
 *   litTargets: Map<string, number>,   erhellte Ziele "x,y" → Farbe, die sie erhellt
 *   litDevices: Set<number>,           Bauteile, durch die Licht läuft
 *   crossings: {x:number,y:number}[],  Zellen, in denen sich Fäden kreuzen
 *   splits: {x:number,y:number}[],     Prismen, an denen sich Licht teilt
 *   length: number,                    Gesamtlänge in Zellen
 *   solved: boolean,
 *   endings: string[],                 warum jede Linie endet
 * }}
 */
export function traceBeam(level, config) {
  const reach = reachable(level, config);
  const { paths, endings, splits } = drawPaths(level, config, reach);

  const litTargets = new Map();
  const litDevices = new Set();
  const crossings = [];

  for (const cell of level.cells) {
    const base = (cell.y * level.width + cell.x) * 4;
    const horizontal = reach[base] | reach[base + 1];
    const vertical = reach[base + 2] | reach[base + 3];
    if ((horizontal | vertical) === 0) continue;
    if (cell.device !== -1) { litDevices.add(cell.device); continue; }
    if (horizontal && vertical) crossings.push({ x: cell.x, y: cell.y });
    if (cell.type !== 'target') continue;
    let accepted = 0;
    for (let d = 0; d < 4; d += 1) {
      if (reach[base + d] !== 0 && accepts(cell.want, reach[base + d])) accepted |= reach[base + d];
    }
    if (accepted !== 0) litTargets.set(`${cell.x},${cell.y}`, accepted);
  }

  let length = 0;
  for (const path of paths) {
    for (let i = 1; i < path.points.length; i += 1) {
      length += Math.abs(path.points[i].x - path.points[i - 1].x)
        + Math.abs(path.points[i].y - path.points[i - 1].y);
    }
  }

  return {
    paths,
    litTargets,
    litDevices,
    crossings,
    splits,
    length,
    endings,
    solved: level.targets.every((t) => litTargets.has(`${t.x},${t.y}`)),
  };
}

/**
 * Kurzform: Sind mit dieser Reglerstellung alle Ziele getroffen?
 *
 * Der Solver ruft das millionenfach auf – deshalb wird hier nur das
 * Zustandsfeld gerechnet, ohne Polylinien, Maps und Mengen.
 */
export function isSolved(level, config) {
  const reach = reachable(level, config);
  for (const target of level.targets) {
    const base = (target.y * level.width + target.x) * 4;
    let lit = false;
    for (let d = 0; d < 4 && !lit; d += 1) {
      if (reach[base + d] !== 0 && accepts(target.want, reach[base + d])) lit = true;
    }
    if (!lit) return false;
  }
  return true;
}

/** Anzahl erhellter Ziele – für die HUD-Anzeige „2/3“. */
export function litCount(level, trace) {
  return level.targets.filter((t) => trace.litTargets.has(`${t.x},${t.y}`)).length;
}
