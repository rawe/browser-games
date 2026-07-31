// Datenmodell eines Lumenweber-Levels: Zellen, Bauteile, Regler und das
// Textformat, in dem Level geschrieben werden.
//
// Die Optik selbst steht in `optics.js` – hier geht es nur um Aufbau und
// Zustandsraum. Beides ist DOM-frei und wird sowohl vom Spiel im Browser als
// auch von der Simulation unter `sim/` benutzt.

import { DIRS, interact } from './optics.js';

/**
 * Zeichenlegende des Textformats.
 *
 *   .      leer                        #  Blocker
 *   > < ^ v  Lichtquelle mit Richtung
 *   o      Knoten für jedes Licht      A  Bernsteinknoten
 *   C      Cyanknoten                  W  Weißknoten
 *   / \    drehbarer Spiegel           1  2  fester Spiegel („/“ bzw. „\“)
 *   p q    drehbares Prisma            3  4  festes Prisma
 *   _      leere Fassung für ein Prisma aus dem Vorrat
 *
 * Festgeschraubte Bauteile sind Ziffern: Sie wirken mit, lassen sich aber nicht
 * antippen.
 */
export const SYMBOLS = {
  '.': { type: 'empty' },
  ' ': { type: 'empty' },
  '#': { type: 'wall' },
  o: { type: 'target', want: 'any' },
  A: { type: 'target', want: 'amber' },
  C: { type: 'target', want: 'cyan' },
  W: { type: 'target', want: 'white' },
  '>': { type: 'source', dir: 'R' },
  '<': { type: 'source', dir: 'L' },
  '^': { type: 'source', dir: 'U' },
  v: { type: 'source', dir: 'D' },
  '/': { type: 'mirror', orient: '/', locked: false },
  '\\': { type: 'mirror', orient: '\\', locked: false },
  1: { type: 'mirror', orient: '/', locked: true },
  2: { type: 'mirror', orient: '\\', locked: true },
  p: { type: 'prism', orient: '/', locked: false },
  q: { type: 'prism', orient: '\\', locked: false },
  3: { type: 'prism', orient: '/', locked: true },
  4: { type: 'prism', orient: '\\', locked: true },
  _: { type: 'socket' },
};

/** Zustandsräume der Bauteile. Ein Regler zykliert genau diese Liste durch. */
const STATES = {
  diagonal: ['/', '\\'],
  socket: [null, '/', '\\'],
};

/** Umkehrung der Legende – für die ASCII-Ausgabe der Simulation. */
export function symbolFor(cell, state) {
  switch (cell.type) {
    case 'wall': return '#';
    case 'target': return { any: 'o', amber: 'A', cyan: 'C', white: 'W' }[cell.want];
    case 'source': return { R: '>', L: '<', U: '^', D: 'v' }[cell.dir];
    case 'mirror': return cell.locked ? (state === '/' ? '1' : '2') : state;
    case 'prism': return cell.locked ? (state === '/' ? '3' : '4') : (state === '/' ? 'p' : 'q');
    case 'socket': return state === null ? '_' : (state === '/' ? 'p' : 'q');
    default: return '.';
  }
}

/**
 * Baut aus der Kurzschreibweise ein vollständiges Level-Objekt.
 *
 * Die Struktur (Rechteckigkeit, bekannte Zeichen) wird immer geprüft. Die
 * Spielbarkeit nur mit `validate` – so lassen sich in den Tests auch bewusst
 * unvollständige Raster bauen.
 *
 * @param {object} def  { id, name, hint, teach, prisms, par, rows: string[] }
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
  const devices = [];
  const controls = [];
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
      const cell = { ...proto, x, y, device: -1 };

      if (cell.type === 'mirror' || cell.type === 'prism' || cell.type === 'socket') {
        const states = cell.type === 'socket' ? STATES.socket : STATES.diagonal;
        // Festgeschraubt heißt: ein einziger Zustand, also kein Regler.
        const fixed = cell.locked === true;
        const device = {
          index: devices.length,
          kind: cell.type,
          x,
          y,
          locked: fixed,
          states: fixed ? [cell.orient] : states,
          start: fixed || cell.type === 'socket' ? 0 : states.indexOf(cell.orient),
          control: -1,
        };
        if (!fixed) {
          device.control = controls.length;
          controls.push(device);
        }
        cell.device = device.index;
        devices.push(device);
      }

      if (cell.type === 'source') sources.push({ x, y, dir: cell.dir });
      if (cell.type === 'target') targets.push({ x, y, want: cell.want, index: targets.length });
      cells.push(cell);
    }
  }

  const sockets = devices.filter((d) => d.kind === 'socket');
  const level = {
    id: def.id,
    name: def.name,
    hint: def.hint ?? '',
    teach: def.teach ?? null,
    width,
    height,
    cells,
    devices,
    controls,
    sockets,
    sources,
    targets,
    /** Wie viele Prismen liegen im Vorrat? Nur Fassungen können sie aufnehmen. */
    prisms: def.prisms ?? 0,
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

/** Startstellung aller Regler als Array von Zustands-Indizes. */
export function startConfig(level) {
  return level.controls.map((c) => c.start);
}

/** Aktueller Zustand eines Bauteils unter dieser Reglerstellung. */
export function deviceState(level, config, device) {
  return device.control === -1 ? device.states[device.start] : device.states[config[device.control]];
}

/** Zustand des Bauteils auf einer Zelle – oder `undefined`, wenn dort keines liegt. */
export function cellState(level, config, cell) {
  return cell.device === -1 ? undefined : deviceState(level, config, level.devices[cell.device]);
}

/** Wie viele Prismen aus dem Vorrat stecken gerade in Fassungen? */
export function placedPrisms(level, config) {
  let n = 0;
  for (const socket of level.sockets) {
    if (deviceState(level, config, socket) !== null) n += 1;
  }
  return n;
}

/** Wie viele Prismen liegen noch im Vorrat? */
export const prismsLeft = (level, config) => level.prisms - placedPrisms(level, config);

/**
 * Zugkosten von einer Reglerstellung zur anderen.
 *
 * Jeder Regler zykliert seine Zustände in einer festen Reihenfolge – ein
 * Spiegel mit zwei, eine Fassung mit drei. Weil die Regler voneinander
 * unabhängig sind, ist die Zugreihenfolge egal und die Mindestzahl an Zügen
 * schlicht die Summe der zyklischen Abstände. Genau das macht die vollständige
 * Suche in `sim/solver.js` ohne Pfadsuche möglich.
 */
export function configCost(level, from, to) {
  let cost = 0;
  for (let i = 0; i < level.controls.length; i += 1) {
    const k = level.controls[i].states.length;
    cost += (to[i] - from[i] + k) % k;
  }
  return cost;
}

/**
 * Ist diese Reglerstellung überhaupt erreichbar?
 *
 * Es können nie mehr Prismen in Fassungen stecken, als im Vorrat liegen.
 */
export const configAllowed = (level, config) => placedPrisms(level, config) <= level.prisms;

/**
 * Kleinstes und größtes Raster.
 *
 * Die Obergrenze ist keine Rechengrenze, sondern eine **Fingergrenze**.
 * Gemessen im Editor auf einem 360 px breiten Telefon: Nach Abzug der Leisten
 * bleiben 344 px Breite, und die Zellgröße ist `min(Breite/Spalten,
 * Höhe/Zeilen)` – hochkant fesselt also immer die Breite.
 *
 *   9×9    38,2 px      11×11  31,3 px
 *   10×10  34,4 px      12×12  28,7 px
 *
 * Bei zehn Spalten liegt die Zelle mit 34,4 px gerade noch über
 * `MIN_TOUCH_CELL` (34 px in `layout.js`), bei elf darunter. Damit ist jedes
 * baubare Level auf einem Telefon hochkant sicher zu treffen – ohne dass sich
 * jemand auf eine Warnung verlassen muss.
 *
 * Die Grenze begrenzt zugleich, was ein geteilter Link an Speicher anfordern
 * kann: `beam.js` legt pro Level `Breite · Höhe · 4` Bytes an.
 */
export const MIN_SIZE = 3;
export const MAX_SIZE = 10;

/**
 * Alles, was an einem Level nicht stimmt – als Liste statt als Ausnahme.
 *
 * Zwei Härtegrade, und der Unterschied ist eine Design-Entscheidung, keine
 * technische: Ein `error` macht das Level unspielbar. Eine `warning` macht es
 * langweilig. Die eingebauten Level müssen beides erfüllen (`validateLevel`
 * wirft auf beides), selbstgebaute nur die Fehler – wer jede Fassung besetzen
 * lassen will, darf das, es ist dann eben kein Rätsel mehr.
 */
export function levelIssues(level) {
  const issues = [];
  const error = (text) => issues.push({ level: 'error', text });
  const warn = (text) => issues.push({ level: 'warning', text });
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  if (level.sources.length === 0) error('Keine Lichtquelle – ohne sie bleibt das Brett dunkel.');
  if (level.targets.length === 0) error('Kein Knoten – es gibt nichts zu erhellen.');
  if (level.controls.length === 0) error('Kein bewegliches Bauteil – es gibt nichts zu tun.');
  if (level.width < MIN_SIZE || level.height < MIN_SIZE) {
    error(`Raster kleiner als ${MIN_SIZE}×${MIN_SIZE}.`);
  }
  if (level.width > MAX_SIZE || level.height > MAX_SIZE) {
    error(`Raster größer als ${MAX_SIZE}×${MAX_SIZE} – die Zellen wären auf dem Handy zu klein.`);
  }
  for (const s of level.sources) {
    const { dx, dy } = DIRS[s.dir];
    if (!cellAt(level, s.x + dx, s.y + dy)) {
      error(`Die Lichtquelle bei (${s.x + 1},${s.y + 1}) strahlt sofort aus dem Feld.`);
    }
  }
  if (level.sockets.length > 0 && level.prisms < 1) {
    error(`${n(level.sockets.length, 'Fassung', 'Fassungen')}, aber kein Prisma im Vorrat.`);
  }
  if (level.prisms > 0 && level.sockets.length === 0) {
    error(`${n(level.prisms, 'Prisma', 'Prismen')} im Vorrat, aber keine Fassung, die eines aufnimmt.`);
  }
  // Die Rätselfrage „welche Fassung besetze ich?“ stellt sich erst ab **zwei**
  // Fassungen. Bei genau einer bleibt die Wahl „leer, / oder \“ – da gibt es
  // sehr wohl etwas zu entscheiden, und eine Warnung wäre nicht nur falsch,
  // sondern unentrinnbar: Ein Prisma ist bei einer Fassung das Minimum.
  if (level.sockets.length > 1 && level.prisms >= level.sockets.length) {
    warn(`${n(level.prisms, 'Prisma', 'Prismen')} auf ${n(level.sockets.length, 'Fassung', 'Fassungen')} – ohne freie Fassung gibt es nichts zu entscheiden.`);
  }
  // Die Optik muss jedes vorkommende Bauteil kennen.
  for (const cell of level.cells) {
    try { interact(cell.type, '/', 'R', 3); }
    catch { error(`Unbekanntes Bauteil „${cell.type}“ bei (${cell.x + 1},${cell.y + 1}).`); }
  }
  return issues;
}

/**
 * Wirft, wenn ein Level strukturell nicht spielbar ist.
 *
 * Für die eingebauten Level ist auch eine Warnung ein Fehler: Was in die
 * Kampagne kommt, soll nicht nur laufen, sondern ein Rätsel sein.
 */
export function validateLevel(level) {
  const issues = levelIssues(level);
  if (issues.length > 0) throw new Error(`Level ${level.id}: ${issues[0].text}`);
  return level;
}
