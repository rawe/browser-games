// Optik: Farbmodell und die Wechselwirkung zwischen Licht und Bauteil.
//
// Hier – und nur hier – steht, was ein Bauteil mit einfallendem Licht macht.
// `beam.js` kennt kein einziges Bauteil beim Namen, es fragt nur `interact()`.
// Ein neues Spielprinzip ist deshalb ein Eintrag in `DEVICES`, kein Eingriff in
// die Strahlverfolgung.
//
// DOM-frei, seiteneffektfrei, ohne Kenntnis von Level oder Sitzung.

/**
 * Licht ist eine Menge aus zwei Grundfarben, gespeichert als Bitmaske.
 * Weiß ist keine dritte Farbe, sondern die Vereinigung der beiden anderen –
 * genau deshalb ist das Zusammenführen zweier Strahlen ein simples ODER.
 */
export const AMBER = 1;
export const CYAN = 2;
export const WHITE = AMBER | CYAN;

/** Namen für Ausgaben und Fehlermeldungen. */
export const COLOR_NAMES = { 1: 'Bernstein', 2: 'Cyan', 3: 'Weiß' };

/** Die vier Laufrichtungen des Strahls. y zeigt nach unten (Bildschirmraster). */
export const DIRS = {
  R: { dx: 1, dy: 0 },
  L: { dx: -1, dy: 0 },
  U: { dx: 0, dy: -1 },
  D: { dx: 0, dy: 1 },
};

export const DIR_KEYS = ['R', 'L', 'U', 'D'];

/** Platz einer Richtung im Zustandsfeld der Strahlverfolgung. */
export const DIR_INDEX = { R: 0, L: 1, U: 2, D: 3 };

/** Gegenrichtung – gebraucht für Kantenpunkte und die Umkehrbarkeitsprüfung. */
export const OPPOSITE = { R: 'L', L: 'R', U: 'D', D: 'U' };

/**
 * Umlenkung an einer Diagonalen, nach den Regeln echter Optik: Ein `/` wirft
 * einen nach rechts laufenden Strahl nach oben, ein `\` nach unten.
 *
 * Spiegel *und* Prisma benutzen dieselbe Tabelle – ein Prisma ist für Cyan
 * schlicht ein Spiegel.
 */
export const REFLECT = {
  '/': { R: 'U', U: 'R', L: 'D', D: 'L' },
  '\\': { R: 'D', D: 'R', L: 'U', U: 'L' },
};

/** Die andere Ausrichtung einer Diagonalen. */
export const flipOrient = (orient) => (orient === '/' ? '\\' : '/');

/** Kein Ausgang – das Licht endet hier. */
const ABSORB = [];

/**
 * Bauteilverhalten.
 *
 * `interact(state, dir, colors)` bekommt den aktuellen Zustand des Bauteils,
 * die Laufrichtung des einfallenden Lichts und dessen Farbmaske und liefert die
 * ausgehenden Strahlen als `[{ dir, colors }]`. Eine leere Liste heißt: Das
 * Licht endet hier.
 *
 * `ending` benennt den Abbruchgrund für die Diagnose, falls nichts austritt.
 * `corner` sagt, ob der Renderer an dieser Stelle einen Knick zeichnen muss.
 */
export const DEVICES = {
  /** Spiegel: lenkt jedes Licht um 90° um, ohne es zu verändern. */
  mirror: {
    corner: true,
    interact: (state, dir, colors) => [{ dir: REFLECT[state][dir], colors }],
  },

  /**
   * Prisma: trennt die Grundfarben.
   *
   *   Bernstein läuft geradeaus  – das Prisma ist für ihn ein Fenster.
   *   Cyan wird um 90° umgelenkt – das Prisma ist für ihn ein Spiegel.
   *
   * Weißes Licht spaltet sich damit in zwei Strahlen. Und weil die Regel
   * umkehrbar ist, führt dasselbe Prisma zwei passend einfallende Farbstrahlen
   * wieder zu weißem Licht zusammen: Beide verlassen es in derselben Richtung,
   * und `beam.js` vereinigt die Farbmasken.
   */
  prism: {
    corner: true,
    interact: (state, dir, colors) => {
      const out = [];
      if (colors & AMBER) out.push({ dir, colors: AMBER });
      if (colors & CYAN) out.push({ dir: REFLECT[state][dir], colors: CYAN });
      return out;
    },
  },

  /**
   * Fassung: eine Halterung, in die der Spieler ein Prisma setzen kann. Leer
   * (`state === null`) ist sie für das Licht nicht vorhanden; besetzt verhält
   * sie sich exakt wie ein Prisma.
   */
  socket: {
    corner: true,
    interact: (state, dir, colors) => (
      state === null ? [{ dir, colors }] : DEVICES.prism.interact(state, dir, colors)
    ),
  },

  /** Blocker: verschluckt alles. */
  wall: { ending: 'wall', interact: () => ABSORB },

  /** Die Quelle verschluckt einfallendes Licht – sonst liefe der Faden in sie zurück. */
  source: { ending: 'source', interact: () => ABSORB },

  /** Zielknoten leuchten auf und lassen das Licht ungehindert weiterlaufen. */
  target: { interact: (state, dir, colors) => [{ dir, colors }] },

  /** Leere Zelle. */
  empty: { interact: (state, dir, colors) => [{ dir, colors }] },
};

/**
 * Was macht dieses Bauteil mit dem Licht?
 *
 * @param {string} kind    Bauteilart, Schlüssel in `DEVICES`
 * @param {*} state        Zustand des Bauteils (`/`, `\`, `null`, …)
 * @param {string} dir     Laufrichtung des einfallenden Lichts
 * @param {number} colors  Farbmaske des einfallenden Lichts
 * @returns {{dir: string, colors: number}[]}
 */
export function interact(kind, state, dir, colors) {
  const device = DEVICES[kind];
  if (!device) throw new Error(`Unbekanntes Bauteil: ${kind}`);
  return device.interact(state, dir, colors);
}

/** Zeichnet der Renderer an diesem Bauteil einen Knick? */
export const isCorner = (kind) => DEVICES[kind]?.corner === true;

/** Abbruchgrund, wenn ein Bauteil das Licht schluckt. */
export const endingOf = (kind) => DEVICES[kind]?.ending ?? 'absorbed';

/**
 * Nimmt ein Zielknoten dieses Licht an?
 *
 * `any` leuchtet in jedem Licht. Ein farbiger Knoten will genau seine Farbe –
 * ein Bernsteinknoten bleibt im weißen Licht dunkel, weil dort noch Cyan
 * mitläuft. Erst das Prisma trennt sauber genug.
 */
export function accepts(want, colors) {
  if (colors === 0) return false;
  if (want === 'any') return true;
  if (want === 'amber') return colors === AMBER;
  if (want === 'cyan') return colors === CYAN;
  if (want === 'white') return colors === WHITE;
  throw new Error(`Unbekannte Zielfarbe: ${want}`);
}
