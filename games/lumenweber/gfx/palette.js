// Farben des Spiels – einmal, für beide Renderer.
//
// WebGL2 braucht Zahlentripel für die Shader, die 2D-Rückfallebene braucht
// CSS-Farben. Beides kommt aus derselben Quelle, damit ein Prisma auf einem
// alten Gerät nicht plötzlich anders aussieht als auf einem neuen.
//
// Bernstein und Cyan sind bewusst nicht nur im Farbton, sondern auch in der
// Helligkeit weit auseinander – und die Knoten bekommen zusätzlich verschiedene
// Formen. Wer Farben schlecht unterscheidet, liest das Brett trotzdem.

import { AMBER, CYAN, WHITE } from '../optics.js';

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * Farbe des Lichtfadens je Farbmaske.
 *
 * `warm` liegt dicht am Kern, `cool` bildet den weiten Hof. Der Kern selbst
 * bleibt fast weiß – erst dadurch liest sich der Faden als Licht und nicht als
 * bunter Strich.
 */
export const BEAM_TINT = {
  [WHITE]: { warm: [0.55, 0.82, 1.00], cool: [0.18, 0.44, 1.00] },
  [AMBER]: { warm: [1.00, 0.74, 0.34], cool: [1.00, 0.38, 0.06] },
  [CYAN]: { warm: [0.38, 0.95, 1.00], cool: [0.05, 0.52, 1.00] },
};

export const beamTint = (colors) => BEAM_TINT[colors] ?? BEAM_TINT[WHITE];

/** Dieselben Fäden als CSS-Farben für die 2D-Rückfallebene. */
export const BEAM_CSS = {
  [WHITE]: { core: '#e8f6ff', glow: '#4aa8ff' },
  [AMBER]: { core: '#fff0d2', glow: '#ff8c1a' },
  [CYAN]: { core: '#dcfbff', glow: '#12b8ff' },
};

export const beamCss = (colors) => BEAM_CSS[colors] ?? BEAM_CSS[WHITE];

/**
 * Welche Farbe ein Knoten verlangt – als Zahl, damit der Shader danach
 * verzweigen kann. Die Form ändert sich mit: verschiedene Zahl an Facetten.
 */
export const WANT_CODE = { any: 0, amber: 1, cyan: 2, white: 3 };

/**
 * Farbe eines Knotens – und damit die Auskunft, welches Licht er verlangt.
 *
 * Im ganzen Spiel gilt eine einzige Regel: **Die Farbe am Knoten ist die Farbe,
 * die durch ihn hindurchpasst.** Deshalb ist der »egal«-Knoten farblos. Er war
 * einmal goldgelb – und log damit, denn Gold heißt hier überall Bernstein
 * (Quelle, Faden, der gerade Anteil hinter dem Prisma). Wer ihn sah, las
 * „will Bernstein", während er in Wahrheit jedes Licht annimmt. Stummes Grau
 * sagt korrekt: keine Forderung.
 *
 * Der Weißknoten bleibt hell – hell heißt „will alles gleichzeitig", stumpfes
 * Grau heißt „will nichts Bestimmtes". Die Formen (Kreis · Dreieck · Quadrat ·
 * Achteck mit zweitem Reif) tragen dieselbe Auskunft ein zweites Mal, für alle,
 * die Farben schlecht unterscheiden.
 */
export const TARGET_TINT = {
  any: [0.54, 0.60, 0.74],
  amber: [1.00, 0.68, 0.22],
  cyan: [0.34, 0.92, 1.00],
  white: [0.95, 0.98, 1.00],
};

export const TARGET_CSS = Object.fromEntries(
  Object.entries(TARGET_TINT).map(([k, v]) => [k, hex(v)]),
);

/**
 * Wie stark ein Knoten seine Wunschfarbe schon zeigt, *bevor* Licht ihn trifft.
 *
 * Vorher waren ungetroffene Knoten einheitlich blaugrau – die Farbe erschien
 * erst beim Treffer, also genau dann, wenn man sie nicht mehr braucht. Beim
 * Lösen blieb nur die Eckenzahl, und die liest sich bei kleiner Zelle schlecht.
 * Der gedämpfte Farbton nennt die Bedingung von Anfang an; der Sprung auf die
 * volle Farbe (plus Hof, dickerer Ring, größerer Kern) bleibt trotzdem deutlich.
 *
 * Der Sockel hält den Farbton auch bei dunklen Farben über der Brettfarbe.
 */
export const TARGET_DIM_MUL = 0.55;
export const TARGET_DIM_ADD = [0.03, 0.05, 0.10];

const dimmed = (c) => c.map((v, i) => v * TARGET_DIM_MUL + TARGET_DIM_ADD[i]);

/** Ringfarbe eines wartenden Knotens – derselbe Farbton, nur leiser. */
export const TARGET_DIM_TINT = Object.fromEntries(
  Object.entries(TARGET_TINT).map(([k, v]) => [k, dimmed(v)]),
);

export const TARGET_DIM_CSS = Object.fromEntries(
  Object.entries(TARGET_DIM_TINT).map(([k, v]) => [k, hex(v)]),
);

/** Die beiden Grundfarben, wie sie im Prisma auseinanderlaufen. */
export const PRISM_AMBER = [1.00, 0.70, 0.26];
export const PRISM_CYAN = [0.30, 0.90, 1.00];

/**
 * Die drei Lichtsorten als CSS-Farbe, nach Farbmaske abgelegt.
 *
 * Gebraucht von Legende und Regeltexten: Wenn dort „Bernstein“ steht, soll es
 * denselben Ton tragen wie der Faden auf dem Brett.
 */
export const LIGHT_CSS = {
  [AMBER]: hex(PRISM_AMBER),
  [CYAN]: hex(PRISM_CYAN),
  [WHITE]: '#eaf4ff',
};
