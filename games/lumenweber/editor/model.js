// Der Entwurf, an dem im Editor gearbeitet wird – und die Werkzeuge, mit denen
// man ihn ändert.
//
// DOM-frei. Ein Entwurf ist dasselbe Textraster, in dem auch die eingebauten
// Level geschrieben sind (`levels.js`): ein Array gleich langer Zeilen. Damit
// gibt es kein zweites Levelformat, das mit dem ersten auseinanderlaufen kann –
// `parseLevel` verdaut den Entwurf unverändert.
//
// Bearbeitet wird mit einem **Pinsel**, nicht mit Ziehen und Ablegen: Man wählt
// ein Werkzeug und tippt eine Zelle an. Das ist die einzige Geste, die auf
// einem Telefon zuverlässig funktioniert – und dieselbe, mit der man das Spiel
// ohnehin bedient.

import { MIN_SIZE, MAX_SIZE } from '../level.js';

export { MIN_SIZE, MAX_SIZE };

/**
 * Die Werkzeugleiste.
 *
 * `chars` ist ein **Zyklus**: Tippt man mit demselben Werkzeug noch einmal auf
 * dieselbe Zelle, rückt es eine Stufe weiter – die Quelle dreht sich, der
 * Spiegel kippt. So bleibt die Leiste kurz genug für einen Daumen, ohne dass
 * Varianten fehlen. Ein Werkzeug mit nur einem Zeichen hat keinen Zyklus.
 */
export const TOOLS = [
  { id: 'empty', label: 'Leer', glyph: '·', chars: ['.'], hint: 'Räumt die Zelle.' },
  { id: 'wall', label: 'Blocker', glyph: '█', chars: ['#'], hint: 'Verschluckt das Licht.' },
  { id: 'source', label: 'Quelle', glyph: '▶', chars: ['>', 'v', '<', '^'], hint: 'Nochmal tippen dreht die Strahlrichtung.' },
  { id: 'target', label: 'Knoten', glyph: '◉', chars: ['o', 'A', 'C', 'W'], hint: 'Nochmal tippen wechselt die verlangte Farbe: alle → Bernstein → Cyan → Weiß.' },
  { id: 'mirror', label: 'Spiegel', glyph: '╱', chars: ['/', '\\'], hint: 'Drehbar. Nochmal tippen kippt die Startstellung.' },
  { id: 'mirrorFixed', label: 'Spiegel fest', glyph: '╱', chars: ['1', '2'], hint: 'Verschraubt – wirkt mit, lässt sich im Spiel nicht drehen.' },
  { id: 'prism', label: 'Prisma', glyph: '◆', chars: ['p', 'q'], hint: 'Drehbar. Trennt Bernstein von Cyan.' },
  { id: 'prismFixed', label: 'Prisma fest', glyph: '◆', chars: ['3', '4'], hint: 'Verschraubtes Prisma.' },
  { id: 'socket', label: 'Fassung', glyph: '◇', chars: ['_'], hint: 'Nimmt im Spiel ein Prisma aus dem Vorrat auf.' },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id) ?? TOOLS[0];

/** Welches Werkzeug hat dieses Zeichen gesetzt? `null` für unbekannte Zeichen. */
export function toolForChar(ch) {
  return TOOLS.find((t) => t.chars.includes(ch)) ?? null;
}

const line = (n, ch = '.') => ch.repeat(n);

/**
 * Ein frischer Entwurf – und zwar ein **gültiges, ungelöstes** Level.
 *
 * Quelle links, ein drehbarer Spiegel auf ihrer Bahn, ein Knoten darüber. Der
 * Spiegel steht auf `\` und wirft das Licht nach unten, am Knoten vorbei; ein
 * Tipp kippt ihn auf `/` und löst das Level.
 *
 * Der Aufwand lohnt sich, weil die Alternative schlecht ist: Ein leeres Brett
 * begrüßt den Autor mit „keine Lichtquelle“, „kein Knoten“, „kein bewegliches
 * Bauteil“, bevor er irgendetwas getan hat – und ein Brett mit Quelle und
 * Knoten auf einer Linie wäre auf Anhieb schon gelöst. So steht stattdessen von
 * der ersten Sekunde an ein Level da, das sich anspielen lässt, und der Autor
 * sieht am lebenden Beispiel, woraus eines besteht.
 */
export function createDraft(width = 7, height = 7) {
  const w = clampSize(width);
  const h = clampSize(height);
  const row = Math.floor(h / 2);
  const col = Math.floor(w / 2);
  let rows = Array.from({ length: h }, () => line(w));
  rows = setChar(rows, 0, row, '>');
  rows = setChar(rows, col, row, '\\');
  rows = setChar(rows, col, 0, 'o');
  return { name: 'Neues Level', rows, prisms: 0 };
}

export const clampSize = (n) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n) || MIN_SIZE));

/** Zeichen an (x,y) – oder `null` außerhalb. */
export function charAt(rows, x, y) {
  if (y < 0 || y >= rows.length) return null;
  const row = rows[y];
  return x < 0 || x >= row.length ? null : row[x];
}

/** Neues Raster mit geändertem Zeichen. Entwürfe werden nie an Ort verändert. */
export function setChar(rows, x, y, ch) {
  if (charAt(rows, x, y) === null) return rows;
  const next = rows.slice();
  next[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  return next;
}

/**
 * Ein Pinselstrich.
 *
 * Trägt die Zelle bereits ein Zeichen dieses Werkzeugs, rückt der Zyklus eine
 * Stufe weiter; sonst wird das erste Zeichen gesetzt. Ein zweiter Tipp mit dem
 * Leer-Werkzeug auf eine leere Zelle ändert nichts – das gibt der Oberfläche
 * ein sauberes „nichts passiert“ zurück.
 *
 * @returns {{rows: string[], changed: boolean, char: string}}
 */
export function paint(rows, x, y, tool) {
  const current = charAt(rows, x, y);
  if (current === null) return { rows, changed: false, char: '' };
  const cycle = tool.chars;
  const at = cycle.indexOf(current);
  const next = at === -1 ? cycle[0] : cycle[(at + 1) % cycle.length];
  if (next === current) return { rows, changed: false, char: current };
  return { rows: setChar(rows, x, y, next), changed: true, char: next };
}

/**
 * Raster auf eine neue Größe bringen.
 *
 * Beschnitten wird rechts und unten, ergänzt wird mit leeren Zellen. Damit
 * bleibt beim Vergrößern und anschließenden Verkleinern alles an seinem Platz –
 * wer sich vertippt hat, verliert nur, was wirklich außerhalb lag.
 */
export function resizeRows(rows, width, height) {
  const w = clampSize(width);
  const h = clampSize(height);
  return Array.from({ length: h }, (_, y) => {
    const row = rows[y] ?? '';
    return row.length >= w ? row.slice(0, w) : row + line(w - row.length);
  });
}

/** Wie viele Zellen gingen bei dieser Verkleinerung verloren? */
export function lostOnResize(rows, width, height) {
  let lost = 0;
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if ((x >= width || y >= height) && rows[y][x] !== '.') lost += 1;
    }
  }
  return lost;
}

/** Zählt Bauteile im Raster – ohne zu parsen, für die laufende Anzeige. */
export function countChars(rows) {
  const counts = {};
  for (const row of rows) for (const ch of row) counts[ch] = (counts[ch] ?? 0) + 1;
  return counts;
}

/**
 * Größe des Suchraums, direkt aus dem Raster.
 *
 * Jeder drehbare Spiegel und jedes drehbare Prisma verdoppelt ihn, jede Fassung
 * verdreifacht ihn. Das ist die Zahl, an der die Par-Bestimmung hängt – nicht
 * die Brettgröße. Die Oberfläche zeigt sie deshalb dauerhaft an.
 */
export function searchSpaceOf(rows) {
  const counts = countChars(rows);
  const turnable = (counts['/'] ?? 0) + (counts['\\'] ?? 0) + (counts.p ?? 0) + (counts.q ?? 0);
  const sockets = counts._ ?? 0;
  return { states: 2 ** turnable * 3 ** sockets, controls: turnable + sockets, sockets };
}

/** Ein Entwurf in der Form, die `parseLevel` erwartet. */
export const toLevelDef = (draft, id) => ({
  id,
  name: draft.name,
  rows: draft.rows,
  prisms: draft.prisms,
  par: draft.par ?? null,
});
