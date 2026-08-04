// „Cyan Puls“ – Rivalenfahrzeug nach Modellblatt 03.
// Kein freistehender Flügel, kurzer integrierter Ducktail, dunkle Flying
// Buttresses zwischen Seitenfenster und Motordeck, rechteckige cyanweiße
// Lichtsignatur vorn und hinten, ruhige klare Flächen.
// Rollen der Halbprofile (z >= 0): 0 untere Seitenkante (hebt sich über den
// Radhäusern), 1 Seitenmitte, 2 Schulterlinie, 3 äußere Deckkante/Haunch,
// 4 Mitte oben (Hauben-/Deckvertiefung; zieht am Heck zum Ducktail hoch).
import { facetBuilder, loftStations } from './facetKit.js';
import { underbody, capStation, wheelWells } from './sharedParts.js';

// x | untere Kante | Seitenmitte | Schulter | Deckkante | Mitte
const STATIONS = [
  { x: 2.30, pts: [[0.20, 0.60], [0.30, 0.66], [0.42, 0.70], [0.46, 0.56], [0.48, 0]] },
  { x: 2.05, pts: [[0.18, 0.74], [0.32, 0.80], [0.47, 0.84], [0.51, 0.66], [0.53, 0]] },
  { x: 1.76, pts: [[0.19, 0.86], [0.40, 0.92], [0.55, 0.95], [0.58, 0.74], [0.56, 0]] },
  { x: 1.58, pts: [[0.62, 0.98], [0.67, 1.00], [0.72, 1.01], [0.66, 0.78], [0.58, 0]] },
  { x: 1.08, pts: [[0.62, 0.96], [0.67, 0.98], [0.73, 0.99], [0.70, 0.72], [0.62, 0]] },
  { x: 0.90, pts: [[0.20, 0.93], [0.44, 0.97], [0.70, 1.00], [0.72, 0.70], [0.68, 0]] },
  { x: 0.55, pts: [[0.18, 0.95], [0.46, 1.00], [0.71, 1.02], [0.76, 0.66], [0.78, 0]] },
  { x: 0.00, pts: [[0.17, 0.98], [0.48, 1.02], [0.70, 1.04], [0.79, 0.63], [0.79, 0]] },
  { x: -0.88, pts: [[0.20, 1.02], [0.52, 1.06], [0.75, 1.08], [0.81, 0.64], [0.78, 0]] },
  { x: -1.08, pts: [[0.66, 1.07], [0.72, 1.09], [0.80, 1.09], [0.82, 0.66], [0.78, 0]] },
  { x: -1.62, pts: [[0.66, 1.05], [0.72, 1.07], [0.79, 1.08], [0.78, 0.76], [0.73, 0]] },
  { x: -1.80, pts: [[0.24, 1.02], [0.52, 1.05], [0.74, 1.06], [0.76, 0.78], [0.73, 0]] },
  { x: -2.12, pts: [[0.22, 0.98], [0.50, 1.02], [0.72, 1.04], [0.80, 0.84], [0.78, 0]] },
  { x: -2.30, pts: [[0.26, 0.90], [0.48, 0.96], [0.66, 1.00], [0.85, 0.80], [0.84, 0]] },
];

const WHEELS = [
  { x: 1.33, span: 0.43, rimY: 0.64, innerZ: 0.76, outerZ: 1.00 },
  { x: -1.35, span: 0.45, rimY: 0.68, innerZ: 0.78, outerZ: 1.10 },
];

// Vertiefte Motorabdeckung; endet vor dem ansteigenden Ducktail.
const DECK_X0 = -1.02; const DECK_Y0 = 0.775;
const DECK_X1 = -1.86; const DECK_Y1 = 0.732;
const deckY = (x) => DECK_Y0 + ((x - DECK_X0) / (DECK_X1 - DECK_X0)) * (DECK_Y1 - DECK_Y0);

function buildPaint() {
  const g = facetBuilder();
  // Ruhige Flächen: konstante Bandschattierungen, kaum Diagonal-Flips.
  loftStations(g, STATIONS, 4, {
    0: { shade: 2, flip: () => false },
    1: { shade: 3, flip: () => false },
    2: { shade: (s) => (s === 3 || s === 4 || s === 9 ? 4 : 3), flip: (s) => s === 6 },
    3: { shade: (s) => (s >= 11 ? 4 : 3), flip: (s) => s === 12 },
  });
  g.mirrorZ();
  capStation(g, STATIONS[0], 0.32, 1, 3);
  capStation(g, STATIONS[STATIONS.length - 1], 0.55, -1, 3);
  underbody(g, STATIONS);
  return g;
}

// Schmale Flying-Buttress-Blenden: dünne, flach abfallende Streben von der
// Seitenfenster-Hinterkante aufs Motordeck, direkt außen an der Heckscheibe
// (z 0,41–0,51). Die cyanfarbene Haunch-Schulter bleibt außen sichtbar.
const BT_TIF = [-0.55, 1.28, 0.41]; // Oberkante vorn, innen
const BT_TOF = [-0.55, 1.26, 0.51]; // Oberkante vorn, außen
const BT_TIR = [-1.55, 0.82, 0.41]; // Oberkante hinten, innen
const BT_TOR = [-1.55, 0.80, 0.51]; // Oberkante hinten, außen
const BT_BIF = [-0.55, 1.22, 0.41]; // Unterkante vorn, innen
const BT_BOF = [-0.55, 1.20, 0.51]; // Unterkante vorn, außen
const BT_BIR = [-1.55, 0.76, 0.41]; // Unterkante hinten, innen
const BT_BOR = [-1.55, 0.74, 0.51]; // Unterkante hinten, außen

function addButtresses(g) {
  // Linke Blende (+Z)
  g.quad(BT_TIF, BT_TIR, BT_TOR, BT_TOF, 2);  // Deckfläche
  g.quad(BT_TOF, BT_TOR, BT_BOR, BT_BOF, 1);  // Außenflanke (schmal)
  g.quad(BT_TIF, BT_BIF, BT_BIR, BT_TIR, 1);  // Innenflanke (zum Heckfenster)
  g.quad(BT_BIF, BT_BOF, BT_BOR, BT_BIR, 0);  // Unterseite
  g.quad(BT_TIF, BT_TOF, BT_BOF, BT_BIF, 1);  // vordere Kappe
  g.quad(BT_TIR, BT_BIR, BT_BOR, BT_TOR, 1);  // hintere Kappe
  // Rechte Blende: gespiegelt mit umgekehrter Windung
  const m = ([x, y, z]) => [x, y, -z];
  g.quad(m(BT_TIF), m(BT_TOF), m(BT_TOR), m(BT_TIR), 2);
  g.quad(m(BT_TOF), m(BT_BOF), m(BT_BOR), m(BT_TOR), 1);
  g.quad(m(BT_TIF), m(BT_TIR), m(BT_BIR), m(BT_BIF), 1);
  g.quad(m(BT_BIF), m(BT_BIR), m(BT_BOR), m(BT_BOF), 0);
  g.quad(m(BT_TIF), m(BT_BIF), m(BT_BOF), m(BT_TOF), 1);
  g.quad(m(BT_TIR), m(BT_TOR), m(BT_BOR), m(BT_BIR), 1);
}

function buildCarbon() {
  const g = facetBuilder();
  g.box(2.19, 0.14, 0, 0.34, 0.08, 1.55, 2); // Frontsplitter
  g.box(2.285, 0.38, 0, 0.07, 0.16, 1.28, 1); // dunkles Frontband (trägt die Lichter)
  // Schweller unter der Karosseriekante (ragen seitlich nicht hinaus)
  g.box(0.06, 0.15, 0.92, 1.10, 0.09, 0.09, 2); // Schweller links
  g.box(0.06, 0.15, -0.92, 1.10, 0.09, 0.09, 1); // Schweller rechts
  // Vertiefte Motorabdeckung: schmale geneigte Platte zwischen den Buttresses …
  const zd = 0.40;
  g.quad(
    [DECK_X0, DECK_Y0 + 0.015, zd], [DECK_X0, DECK_Y0 + 0.015, -zd],
    [DECK_X1, DECK_Y1 + 0.015, -zd], [DECK_X1, DECK_Y1 + 0.015, zd], 0,
  );
  // … mit fünf Lamellen quer darüber; die Haunches außen bleiben cyan.
  for (let i = 0; i < 5; i++) {
    const x = -1.10 - i * 0.17;
    g.box(x, deckY(x) + 0.03, 0, 0.10, 0.05, 0.76, 2);
  }
  addButtresses(g);
  g.box(-2.33, 0.55, 0, 0.06, 0.20, 1.40, 1); // dunkles Heckband (nur Lichtzone)
  // Diffusor mit Finnen und zentralem rechteckigem Auspuff
  g.box(-2.19, 0.16, 0, 0.30, 0.13, 1.62, 1);
  for (const z of [-0.55, -0.19, 0.19, 0.55]) {
    g.box(-2.24, 0.245, z, 0.20, 0.06, 0.05, 2);
  }
  g.box(-2.30, 0.295, 0, 0.10, 0.15, 0.34, 2); // Auspuff-Rahmen
  g.box(-2.32, 0.295, 0, 0.05, 0.10, 0.26, 0); // dunkle Auspuff-Öffnung
  wheelWells(g, WHEELS);
  return g;
}

function buildGlass() {
  const g = facetBuilder();
  const base = [[0.55, 0.80, 0.58], [-0.10, 0.80, 0.61], [-0.58, 0.81, 0.55]];
  const roofF = [-0.02, 1.30, 0.46];
  const roofR = [-0.55, 1.32, 0.44];
  // Windschutzscheibe
  g.quad([0.55, 0.80, 0.58], [0.55, 0.80, -0.58], [roofF[0], roofF[1], -roofF[2]], roofF, 4, true);
  // Dachglas
  g.quad(roofF, [roofF[0], roofF[1], -roofF[2]], [roofR[0], roofR[1], -roofR[2]], roofR, 3);
  // Schmales Heckfenster zwischen den Buttresses hinunter aufs Motordeck
  g.quad(roofR, [roofR[0], roofR[1], -roofR[2]], [-1.02, 0.80, -0.40], [-1.02, 0.80, 0.40], 2, true);
  // Seitenscheiben links (+Z); Hinterkante endet an der Buttress
  g.triangle(base[0], roofF, base[1], 1);
  g.quad(base[1], roofF, roofR, base[2], 2, true);
  // rechts (-Z), gespiegelte Windung
  const m = ([x, y, z]) => [x, y, -z];
  g.triangle(m(base[0]), m(base[1]), m(roofF), 1);
  g.quad(m(base[1]), m(base[2]), m(roofR), m(roofF), 2, true);
  return g;
}

function buildLights() {
  const g = facetBuilder();
  g.setColor([0.75, 1.0, 0.95]); // cyanweiße Signatur vorn und hinten
  // Front: zwei klare Rechtecke im dunklen Frontband
  g.box(2.31, 0.38, 0.42, 0.05, 0.09, 0.38);
  g.box(2.31, 0.38, -0.42, 0.05, 0.09, 0.38);
  // Heck: zwei Rechtecke im dunklen Heckband
  g.box(-2.345, 0.55, 0.48, 0.04, 0.12, 0.40);
  g.box(-2.345, 0.55, -0.48, 0.04, 0.12, 0.40);
  return g;
}

export function buildCyanPuls() {
  return {
    paint: buildPaint().build(),
    carbon: buildCarbon().build(),
    glass: buildGlass().build(),
    lights: buildLights().build(),
  };
}
