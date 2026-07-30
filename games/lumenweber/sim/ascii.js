// Textdarstellung eines Levels samt Lichtverlauf.
//
// Damit lässt sich ein Level ohne Browser, Canvas und Grafik beurteilen – die
// Simulation zeigt genau das, was der Spieler später sieht, nur in Zeichen.

import { cellAt } from '../level.js';

const GLYPH = {
  wall: '█',
  sourceR: '▶', sourceL: '◀', sourceU: '▲', sourceD: '▼',
  targetOn: '◉', targetOff: '○',
  mirrorFree: { '/': '/', '\\': '\\' },
  mirrorLocked: { '/': '╱', '\\': '╲' },
  empty: '·',
  beamH: '─', beamV: '│', beamX: '┼',
};

/**
 * Aus den Polylinien des Strahls ableiten, welche Zelle waagerecht bzw.
 * senkrecht durchlaufen wird – nur so lässt sich der Verlauf zeichnen.
 */
function beamAxes(trace) {
  const axes = new Map();
  const mark = (x, y, axis) => {
    const key = `${x},${y}`;
    const cur = axes.get(key);
    axes.set(key, cur && cur !== axis ? 'X' : axis);
  };
  for (const points of trace.paths) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const axis = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? 'H' : 'V';
      const steps = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2);
      for (let s = 0; s <= steps; s += 1) {
        const t = steps === 0 ? 0 : s / steps;
        const x = Math.floor(a.x + (b.x - a.x) * t);
        const y = Math.floor(a.y + (b.y - a.y) * t);
        mark(x, y, axis);
      }
    }
  }
  return axes;
}

/** Rendert Level + Lichtverlauf als mehrzeiligen String. */
export function renderAscii(level, trace) {
  const axes = beamAxes(trace);
  const lines = [];
  for (let y = 0; y < level.height; y += 1) {
    let line = '';
    for (let x = 0; x < level.width; x += 1) {
      const cell = cellAt(level, x, y);
      const axis = axes.get(`${x},${y}`);
      switch (cell.type) {
        case 'wall': line += GLYPH.wall; break;
        case 'source': line += GLYPH[`source${cell.dir}`]; break;
        case 'target':
          line += trace.litTargets.has(`${x},${y}`) ? GLYPH.targetOn : GLYPH.targetOff;
          break;
        case 'mirror': {
          const orient = trace.orientations?.[cell.index] ?? cell.orient;
          line += (cell.locked ? GLYPH.mirrorLocked : GLYPH.mirrorFree)[orient];
          break;
        }
        default:
          if (axis === 'H') line += GLYPH.beamH;
          else if (axis === 'V') line += GLYPH.beamV;
          else if (axis === 'X') line += GLYPH.beamX;
          else line += GLYPH.empty;
      }
      line += ' ';
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/** Zustandsbild einer Sitzung: Raster, Züge, Zielzähler. */
export function renderSession(session) {
  const { level } = session;
  const trace = { ...session.trace, orientations: session.orientations };
  const head = `${level.id} · ${level.name}  (${level.width}×${level.height})`;
  const foot = `Züge ${session.moves}${level.par != null ? ` / Par ${level.par}` : ''}`
    + `  ·  Ziele ${session.lit}/${level.targets.length}`
    + `  ·  ${session.solved ? 'GELÖST' : 'offen'}`;
  return `${head}\n${renderAscii(level, trace)}\n${foot}`;
}
