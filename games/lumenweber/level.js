// Datenmodell eines Lumenweber-Levels: Zelltypen, Richtungen, Spiegel-Physik
// und das Textformat, in dem Level geschrieben werden.
//
// Dieses Modul ist bewusst DOM-frei – es wird sowohl vom Spiel im Browser als
// auch von der Headless-Simulation unter `sim/` benutzt.

/** Die vier Laufrichtungen des Strahls. y zeigt nach unten (Bildschirmraster). */
export const DIRS = {
  R: { dx: 1, dy: 0 },
  L: { dx: -1, dy: 0 },
  U: { dx: 0, dy: -1 },
  D: { dx: 0, dy: 1 },
};

export const DIR_KEYS = ['R', 'L', 'U', 'D'];

/**
 * Umlenkung an einem Spiegel, nach den Regeln echter Optik: Ein `/` wirft einen
 * nach rechts laufenden Strahl nach oben, ein `\` nach unten.
 *
 * Der Spielentwurf hatte die beiden Tabellen vertauscht (dort ging der Strahl
 * am `/` nach unten). Das Verhalten ist dasselbe, nur die Beschriftung der
 * Glyphe wäre verdreht – und ein sichtbarer `/`-Spiegel, der nach unten
 * ablenkt, sieht auf dem Schirm schlicht falsch aus. Deshalb hier die
 * physikalische Variante.
 */
export const REFLECT = {
  '/': { R: 'U', U: 'R', L: 'D', D: 'L' },
  '\\': { R: 'D', D: 'R', L: 'U', U: 'L' },
};

/** Der andere Zustand eines drehbaren Spiegels. */
export const flipOrient = (orient) => (orient === '/' ? '\\' : '/');

/**
 * Zeichenlegende des Textformats.
 *
 *   .  leer                     #  Blocker
 *   o  Zielpunkt                >  < ^ v  Lichtquelle mit Richtung
 *   /  drehbarer Spiegel „/“    \  drehbarer Spiegel „\“
 *   1  fester Spiegel „/“       2  fester Spiegel „\“
 *
 * Feste Spiegel sind Ziffern, weil sie „festgeschraubt“ sind: Sie lenken das
 * Licht mit, lassen sich aber nicht antippen.
 */
export const SYMBOLS = {
  '.': { type: 'empty' },
  ' ': { type: 'empty' },
  '#': { type: 'wall' },
  o: { type: 'target' },
  '>': { type: 'source', dir: 'R' },
  '<': { type: 'source', dir: 'L' },
  '^': { type: 'source', dir: 'U' },
  v: { type: 'source', dir: 'D' },
  '/': { type: 'mirror', orient: '/', locked: false },
  '\\': { type: 'mirror', orient: '\\', locked: false },
  1: { type: 'mirror', orient: '/', locked: true },
  2: { type: 'mirror', orient: '\\', locked: true },
};

/** Umkehrung der Legende – für die ASCII-Ausgabe der Simulation. */
export function symbolFor(cell) {
  switch (cell.type) {
    case 'wall': return '#';
    case 'target': return 'o';
    case 'source': return { R: '>', L: '<', U: '^', D: 'v' }[cell.dir];
    case 'mirror':
      if (cell.locked) return cell.orient === '/' ? '1' : '2';
      return cell.orient;
    default: return '.';
  }
}

/**
 * Baut aus der Kurzschreibweise ein vollständiges Level-Objekt.
 *
 * Die Struktur (Rechteckigkeit, bekannte Zeichen) wird immer geprüft. Die
 * Spielbarkeit (Quelle, Ziel, drehbarer Spiegel) nur mit `validate` – so lassen
 * sich in den Tests auch bewusst unvollständige Raster bauen.
 *
 * @param {object} def  { id, name, hint, rows: string[] , par? }
 * @param {{validate?: boolean}} [options]
 */
export function parseLevel(def, { validate = true } = {}) {
  const rows = def.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Level ${def.id}: keine Zeilen`);
  }
  const height = rows.length;
  const width = rows[0].length;

  const cells = [];
  const mirrors = [];
  const sources = [];
  const targets = [];

  for (let y = 0; y < height; y += 1) {
    const line = rows[y];
    if (line.length !== width) {
      throw new Error(`Level ${def.id}: Zeile ${y} ist ${line.length} statt ${width} Zeichen lang`);
    }
    for (let x = 0; x < width; x += 1) {
      const ch = line[x];
      const proto = SYMBOLS[ch];
      if (!proto) throw new Error(`Level ${def.id}: unbekanntes Zeichen "${ch}" bei (${x},${y})`);
      const cell = { ...proto, x, y };
      if (cell.type === 'mirror') {
        cell.index = mirrors.length;
        mirrors.push({ x, y, index: cell.index, start: cell.orient, locked: cell.locked });
      }
      if (cell.type === 'source') sources.push({ x, y, dir: cell.dir });
      if (cell.type === 'target') targets.push({ x, y, index: targets.length });
      cells.push(cell);
    }
  }

  const level = {
    id: def.id,
    name: def.name,
    hint: def.hint ?? '',
    width,
    height,
    cells,
    mirrors,
    sources,
    targets,
    rotatable: mirrors.filter((m) => !m.locked).map((m) => m.index),
    par: def.par ?? null,
    rows: [...rows],
  };
  if (validate) validateLevel(level);
  return level;
}

/** Zelle an (x,y) oder `null` außerhalb des Rasters. */
export function cellAt(level, x, y) {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return null;
  return level.cells[y * level.width + x];
}

/** Startausrichtung aller Spiegel als Array (Index = mirror.index). */
export function startOrientations(level) {
  return level.mirrors.map((m) => m.start);
}

/** Wirft, wenn ein Level strukturell nicht spielbar ist. */
export function validateLevel(level) {
  const err = (msg) => { throw new Error(`Level ${level.id}: ${msg}`); };
  if (level.sources.length === 0) err('keine Lichtquelle');
  if (level.targets.length === 0) err('kein Zielpunkt');
  if (level.rotatable.length === 0) err('kein drehbarer Spiegel – nichts zu tun');
  if (level.width < 3 || level.height < 3) err('Raster kleiner als 3×3');
  for (const s of level.sources) {
    const { dx, dy } = DIRS[s.dir];
    if (!cellAt(level, s.x + dx, s.y + dy)) err(`Lichtquelle bei (${s.x},${s.y}) strahlt sofort aus dem Feld`);
  }
  return level;
}
