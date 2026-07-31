// Textdarstellung eines Levels samt Lichtverlauf.
//
// Damit lässt sich ein Level ohne Browser, Canvas und Grafik beurteilen – die
// Simulation zeigt genau das, was der Spieler später sieht, nur in Zeichen.
// Auch die Farbe des Lichts: Bernstein und Cyan bekommen eigene Linien.

import { cellAt, cellState, prismsLeft } from '../level.js';
import { AMBER, CYAN, WHITE } from '../optics.js';

const GLYPH = {
  wall: '█',
  sourceR: '▶', sourceL: '◀', sourceU: '▲', sourceD: '▼',
  target: {
    any: ['○', '◉'],
    amber: ['a', 'Ⓐ'],
    cyan: ['c', 'Ⓒ'],
    white: ['w', 'Ⓦ'],
  },
  mirror: { free: { '/': '/', '\\': '\\' }, locked: { '/': '╱', '\\': '╲' } },
  prism: { free: { '/': '⟋', '\\': '⟍' }, locked: { '/': '⧸', '\\': '⧹' } },
  socket: '◌',
  empty: '·',
  cross: '┼',
  beam: {
    [WHITE]: { H: '─', V: '│' },
    [AMBER]: { H: '═', V: '║' },
    [CYAN]: { H: '┈', V: '┊' },
  },
};

export const ASCII_LEGEND = [
  '▶◀▲▼ Quelle   █ Blocker   · leer   ◌ leere Fassung',
  '/ \\ Spiegel   ╱ ╲ fest    ⟋ ⟍ Prisma   ⧸ ⧹ fest',
  '○◉ Knoten     aⒶ Bernstein  cⒸ Cyan   wⓌ Weiß',
  '─│ weißes Licht   ═║ Bernstein   ┈┊ Cyan   ┼ Kreuzung',
].join('\n');

/**
 * Aus den Polylinien ableiten, welche Zelle waagerecht bzw. senkrecht
 * durchlaufen wird – und in welcher Farbe.
 */
function beamAxes(trace) {
  const axes = new Map();
  const mark = (x, y, axis, colors) => {
    const key = `${x},${y}`;
    const cur = axes.get(key) ?? { H: 0, V: 0 };
    cur[axis] |= colors;
    axes.set(key, cur);
  };
  for (const { points, colors } of trace.paths) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const axis = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? 'H' : 'V';
      const steps = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2);
      for (let s = 0; s <= steps; s += 1) {
        const t = steps === 0 ? 0 : s / steps;
        mark(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t), axis, colors);
      }
    }
  }
  return axes;
}

/** Linienzeichen für eine leere Zelle, durch die Licht läuft. */
function beamGlyph(axis) {
  if (!axis) return null;
  if (axis.H && axis.V) return GLYPH.cross;
  const dir = axis.H ? 'H' : 'V';
  const colors = axis.H || axis.V;
  return (GLYPH.beam[colors] ?? GLYPH.beam[WHITE])[dir];
}

/** Rendert Level + Lichtverlauf als mehrzeiligen String. */
export function renderAscii(level, config, trace) {
  const axes = beamAxes(trace);
  const lines = [];
  for (let y = 0; y < level.height; y += 1) {
    let line = '';
    for (let x = 0; x < level.width; x += 1) {
      const cell = cellAt(level, x, y);
      const state = cellState(level, config, cell);
      switch (cell.type) {
        case 'wall': line += GLYPH.wall; break;
        case 'source': line += GLYPH[`source${cell.dir}`]; break;
        case 'target':
          line += GLYPH.target[cell.want][trace.litTargets.has(`${x},${y}`) ? 1 : 0];
          break;
        case 'mirror':
          line += GLYPH.mirror[cell.locked ? 'locked' : 'free'][state];
          break;
        case 'prism':
          line += GLYPH.prism[cell.locked ? 'locked' : 'free'][state];
          break;
        case 'socket':
          line += state === null ? GLYPH.socket : GLYPH.prism.free[state];
          break;
        default:
          line += beamGlyph(axes.get(`${x},${y}`)) ?? GLYPH.empty;
      }
      line += ' ';
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/** Zustandsbild einer Sitzung: Raster, Züge, Zielzähler, Prismenvorrat. */
export function renderSession(session) {
  const { level, config } = session;
  const head = `${level.id} · ${level.name}  (${level.width}×${level.height})`;
  const parts = [
    `Züge ${session.moves}${level.par != null ? ` / Par ${level.par}` : ''}`,
    `Ziele ${session.lit}/${level.targets.length}`,
  ];
  if (level.prisms > 0) parts.push(`Prismen ${prismsLeft(level, config)}/${level.prisms}`);
  parts.push(session.solved ? 'GELÖST' : 'offen');
  return `${head}\n${renderAscii(level, config, session.trace)}\n${parts.join('  ·  ')}`;
}
