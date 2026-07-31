// Lehrkarten: wie eine neue Mechanik erklärt wird.
//
// Zu jeder Karte gehört eine kleine Zeichnung. Sie steht hier als SVG und nicht
// als Bilddatei, weil sie dieselben Farben braucht wie das Brett – und weil ein
// neues Spielprinzip später nur einen weiteren Eintrag kosten soll.
//
// Der Text selbst steht am Level (`teach: { id, title, body }`); hier ist nur
// das Bild. `sim/checks.js` erzwingt, dass jede Mechanik genau einmal bei ihrem
// ersten Auftreten erklärt wird.

const AMBER = '#ffb343';
const CYAN = '#4de6ff';
const WHITE = '#eaf4ff';
const DIM = '#8fa3c8';

const frame = (body) => `<svg viewBox="0 0 200 96" role="img" class="teach-art" aria-hidden="true">${body}</svg>`;

/** Ein Lichtstrahl mit Hof – zweimal gezeichnet, damit er glüht. */
const beam = (x1, y1, x2, y2, color) => `
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="7" opacity="0.22" stroke-linecap="round"/>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;

/** Der Glaskeil, auf der Diagonalen liegend. */
const prism = (cx, cy) => `
  <defs><linearGradient id="pg${cx}${cy}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${CYAN}"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="${AMBER}"/>
  </linearGradient></defs>
  <path d="M${cx - 15} ${cy} L${cx} ${cy - 8} L${cx + 15} ${cy} L${cx} ${cy + 8} Z"
    fill="url(#pg${cx}${cy})" stroke="rgba(255,255,255,0.85)" stroke-width="1"/>`;

/**
 * Die leere Fassung – vier Eckwinkel und der gestrichelte Umriss dessen, was
 * hineingehört. Genau so sieht sie auch auf dem Brett aus.
 */
const socket = (cx, cy) => {
  const r = 19;
  const arm = 7;
  const brackets = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
    `M${cx + sx * r} ${cy + sy * (r - arm)} L${cx + sx * r} ${cy + sy * r} L${cx + sx * (r - arm)} ${cy + sy * r}`).join(' ');
  return `
  <path d="${brackets}" fill="none" stroke="${DIM}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M${cx - 15} ${cy} L${cx} ${cy - 8} L${cx + 15} ${cy} L${cx} ${cy + 8} Z"
    fill="none" stroke="${DIM}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.75"/>`;
};

/** Ein Knoten in der Form, die seine Wunschfarbe hat. */
function node(cx, cy, want, r = 11) {
  const color = { any: '#ffc76a', amber: AMBER, cyan: CYAN, white: WHITE }[want];
  const corners = { any: 0, amber: 3, cyan: 4, white: 8 }[want];
  let shape;
  if (corners === 0) {
    shape = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2.4"/>`;
  } else {
    const pts = Array.from({ length: corners }, (_, k) => {
      const a = -Math.PI / 2 + ((k + 0.5) / corners) * Math.PI * 2;
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    shape = `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="2.4"/>`;
  }
  const twin = want === 'white'
    ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="none" stroke="${color}" stroke-width="1.3"/>` : '';
  return `${shape}${twin}<circle cx="${cx}" cy="${cy}" r="${r * 0.34}" fill="${color}"/>`;
}

export const TEACH_ART = {
  // Weißes Licht läuft in das Prisma und kommt zweifarbig wieder heraus.
  prisma: frame(`
    ${beam(10, 64, 86, 64, WHITE)}
    ${beam(100, 64, 190, 64, AMBER)}
    ${beam(93, 57, 93, 8, CYAN)}
    ${prism(93, 64)}
    <circle cx="10" cy="64" r="5" fill="#ffd9a0"/>
  `),

  // Jede Farbe hat ihren eigenen Knoten – und jeder Knoten seine eigene Form.
  farbe: frame(`
    ${node(30, 48, 'any')}${node(85, 48, 'amber')}${node(140, 48, 'cyan')}
    <text x="30" y="82" fill="${DIM}" font-size="11" text-anchor="middle">jedes</text>
    <text x="85" y="82" fill="${AMBER}" font-size="11" text-anchor="middle">Bernstein</text>
    <text x="140" y="82" fill="${CYAN}" font-size="11" text-anchor="middle">Cyan</text>
    ${node(180, 48, 'white')}
    <text x="180" y="82" fill="${WHITE}" font-size="11" text-anchor="middle">weiß</text>
  `),

  // Aus dem Vorrat in eine von mehreren Fassungen – die Wahl gehört zum Rätsel.
  fassung: frame(`
    <text x="100" y="14" fill="${DIM}" font-size="11" text-anchor="middle">welche Fassung?</text>
    ${prism(40, 34)}
    <path d="M40 46 L40 60 M34 54 L40 61 L46 54" fill="none" stroke="${DIM}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
    ${socket(40, 76)}
    ${socket(105, 76)}
    ${socket(170, 76)}
  `),
};

export const teachArt = (id) => TEACH_ART[id] ?? '';
