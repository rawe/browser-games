// Strahlverfolgung – das Herz von Lumenweber.
//
// Komplett DOM-frei und ohne Seiteneffekte: rein aus Level + Spiegelstellungen
// wird der gesamte Lichtverlauf berechnet. Genau dieselbe Funktion benutzen der
// Renderer im Browser, der Solver und die Tests unter `sim/`.

import { DIRS, REFLECT, cellAt } from './level.js';

/** Mittelpunkt einer Zelle in Rasterkoordinaten (1 Einheit = 1 Zelle). */
const center = (x, y) => ({ x: x + 0.5, y: y + 0.5 });

/** Punkt auf der Kante zwischen Zelle (x,y) und der Nachbarzelle in `dir`. */
function edgePoint(x, y, dir) {
  const { dx, dy } = DIRS[dir];
  return { x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5 };
}

/**
 * Verfolgt das Licht durch das Raster.
 *
 * @param {object} level          geparstes Level
 * @param {string[]} orientations Ausrichtung je Spiegel (Index = mirror.index)
 * @returns {{
 *   paths: {x:number,y:number}[][],   Polylinien für den Renderer
 *   litTargets: Set<string>,          getroffene Ziele als "x,y"
 *   litMirrors: Set<number>,          Spiegel, durch die Licht läuft
 *   visits: Map<string, number>,      Durchläufe je Zelle (für das Glühen)
 *   length: number,                   Gesamtlänge in Zellen
 *   solved: boolean,
 *   endings: string[],                warum jeder Strahl endet
 * }}
 */
export function traceBeam(level, orientations) {
  const paths = [];
  const litTargets = new Set();
  const litMirrors = new Set();
  const visits = new Map();
  const endings = [];
  let length = 0;

  const bump = (x, y) => {
    const key = `${x},${y}`;
    visits.set(key, (visits.get(key) ?? 0) + 1);
  };

  for (const source of level.sources) {
    // (x,y,dir) als Zustand. Weil ein Spiegel eine umkehrbare Abbildung ist
    // und die Quelle einfallendes Licht verschluckt, kann sich ein Zustand
    // eigentlich nie wiederholen – die Prüfung ist die Absicherung, die auch
    // eine spätere Erweiterung (Teleporter, Strahlteiler) nicht hängen lässt.
    // `sim/checks.js` weist die Schleifenfreiheit an einem dichten Spiegelfeld
    // ausdrücklich nach.
    const seen = new Set();
    let { x, y } = source;
    let dir = source.dir;
    const points = [center(x, y)];
    bump(x, y);
    let ending = 'outside';

    for (;;) {
      const state = `${x},${y},${dir}`;
      if (seen.has(state)) { ending = 'loop'; break; }
      seen.add(state);

      const { dx, dy } = DIRS[dir];
      const nx = x + dx;
      const ny = y + dy;
      const next = cellAt(level, nx, ny);

      if (!next) {                       // Feldrand: Strahl endet auf der Kante
        points.push(edgePoint(x, y, dir));
        ending = 'outside';
        break;
      }
      if (next.type === 'wall' || next.type === 'source') {
        points.push(edgePoint(x, y, dir));
        ending = next.type === 'wall' ? 'wall' : 'source';
        break;
      }

      x = nx;
      y = ny;
      bump(x, y);

      if (next.type === 'target') litTargets.add(`${x},${y}`);

      if (next.type === 'mirror') {
        litMirrors.add(next.index);
        points.push(center(x, y));       // Knick nur an Spiegeln
        dir = REFLECT[orientations[next.index]][dir];
      }
    }

    if (ending === 'loop') points.push(center(x, y));
    for (let i = 1; i < points.length; i += 1) {
      length += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    }
    paths.push(points);
    endings.push(ending);
  }

  return {
    paths,
    litTargets,
    litMirrors,
    visits,
    length,
    endings,
    solved: level.targets.every((t) => litTargets.has(`${t.x},${t.y}`)),
  };
}

/** Kurzform: Sind mit dieser Spiegelstellung alle Ziele getroffen? */
export function isSolved(level, orientations) {
  return traceBeam(level, orientations).solved;
}

/** Anzahl getroffener Ziele – für die HUD-Anzeige „2/3“. */
export function litCount(level, trace) {
  return level.targets.filter((t) => trace.litTargets.has(`${t.x},${t.y}`)).length;
}
