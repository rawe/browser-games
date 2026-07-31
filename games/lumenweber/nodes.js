// Knotenkunde: Form, Farbe und Klartext zu jeder Wunschfarbe.
//
// Brett, Erklärkarte, Regelseite und Legende greifen alle hierauf zu – damit es
// im ganzen Spiel bei einer einzigen Aussage bleibt:
//
//   Die Farbe am Knoten ist die Farbe, die durch ihn hindurchpasst.
//   Kein Farbton heißt: keine Forderung.
//
// Welches Licht durch welchen Knoten passt, steht hier bewusst *nicht* als
// abgeschriebene Tabelle. Es kommt aus `accepts()` selbst. Eine Legende, die
// von der Spielregel abweicht, richtet mehr Schaden an als gar keine – und sie
// weicht ab, sobald jemand die Regel ändert und die Tabelle vergisst.
//
// DOM-frei; die Darstellung liegt in `legend.js` und `teach.js`.

import { AMBER, CYAN, WHITE, accepts } from './optics.js';
import { TARGET_CSS, LIGHT_CSS } from './gfx/palette.js';

/** Alle Knotenarten in der Reihenfolge, in der sie im Spiel auftauchen. */
export const WANTS = ['any', 'amber', 'cyan', 'white'];

/**
 * Eckenzahl der Knotenform, 0 heißt Kreis.
 *
 * Muss zu `wantFacets()` im Shader und zu `TARGET_CORNERS` in der 2D-Ebene
 * passen – die Form ist Auskunft, nicht Zierde.
 */
export const NODE_CORNERS = { any: 0, amber: 3, cyan: 4, white: 8 };

export const NODE_NAME = {
  any: 'Jedes Licht',
  amber: 'Bernsteinknoten',
  cyan: 'Cyanknoten',
  white: 'Weißknoten',
};

export const NODE_RULE = {
  any: 'Farblos – er nimmt jedes Licht an.',
  amber: 'Nur reines Bernstein. Weißes Licht ist ihm zu grell.',
  cyan: 'Nur reines Cyan. Weißes Licht ist ihm zu grell.',
  white: 'Nur Bernstein und Cyan gemeinsam – hinter dem Prisma wieder vereint.',
};

/** Die drei Lichtsorten, die auf einen Knoten treffen können. */
export const LIGHTS = [
  { colors: AMBER, name: 'Bernstein' },
  { colors: CYAN, name: 'Cyan' },
  { colors: WHITE, name: 'Weiß' },
];

/** Farbe einer Lichtsorte – derselbe Ton wie der Faden auf dem Brett. */
export const lightCss = (colors) => LIGHT_CSS[colors];

/** Farbe eines Knotens – derselbe Ton wie sein Ring auf dem Brett. */
export const nodeCss = (want) => TARGET_CSS[want];

/** Passt dieses Licht durch diesen Knoten? Direkt aus der Spielregel. */
export const passes = (want, colors) => accepts(want, colors);

/**
 * Die Zeichnung eines Knotens: Umriss, beim Weißknoten ein zweiter Reif, Kern.
 *
 * Liefert nur den Inhalt, kein `<svg>` – so kann die Erklärkarte den Knoten in
 * ihre eigene Bildfläche setzen und die Legende ihn einzeln rahmen.
 */
export function nodeShape(cx, cy, want, r, color = nodeCss(want)) {
  const corners = NODE_CORNERS[want];
  const w = (r * 0.22).toFixed(2);
  let outline;
  if (corners === 0) {
    outline = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  } else {
    const pts = Array.from({ length: corners }, (_, k) => {
      // Halbe Segmentbreite versetzt: oben liegt eine Fläche, keine Spitze –
      // genauso rechnen es Shader und 2D-Ebene.
      const a = -Math.PI / 2 + ((k + 0.5) / corners) * Math.PI * 2;
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    outline = `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  }
  // Der Weißknoten trägt einen zweiten, engeren Reif: Er will beide Farben.
  const twin = want === 'white'
    ? `<circle cx="${cx}" cy="${cy}" r="${(r * 0.6).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(r * 0.12).toFixed(2)}"/>`
    : '';
  return `${outline}${twin}<circle cx="${cx}" cy="${cy}" r="${(r * 0.34).toFixed(1)}" fill="${color}"/>`;
}

/** Ein Knoten als eigenständiges Bild – für Legende und Regelseite. */
export function nodeIcon(want, size = 30) {
  const c = size / 2;
  return `<svg class="node-icon" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"`
    + ` role="img" aria-label="${NODE_NAME[want]}">${nodeShape(c, c, want, size * 0.36)}</svg>`;
}
