// „Roter Keil“ – das Spieler-/Heldenfahrzeug nach Modellblatt 01.
// Flügellos, fünf Motorlamellen, quadratische Rückleuchten, breites Heck.
// Rollen der Halbprofile (z >= 0): 0 untere Seitenkante (hebt sich über den
// Radhäusern), 1 Seitenmitte, 2 Schulterlinie, 3 äußere Deckkante/Haunch,
// 4 Mitte oben (Hauben-/Deckvertiefung zwischen den Schultern).
import { facetBuilder, loftStations } from './facetKit.js';
import { underbody, capStation, wheelWells } from './sharedParts.js';

// x | untere Kante | Seitenmitte | Schulter | Deckkante | Mitte
const STATIONS = [
  { x: 2.30, pts: [[0.18, 0.55], [0.28, 0.60], [0.40, 0.64], [0.44, 0.52], [0.46, 0]] },
  { x: 2.05, pts: [[0.17, 0.70], [0.32, 0.76], [0.46, 0.81], [0.50, 0.64], [0.53, 0]] },
  { x: 1.76, pts: [[0.19, 0.84], [0.40, 0.90], [0.54, 0.94], [0.57, 0.74], [0.55, 0]] },
  { x: 1.58, pts: [[0.62, 0.98], [0.67, 1.00], [0.72, 1.01], [0.66, 0.78], [0.58, 0]] },
  { x: 1.08, pts: [[0.62, 0.96], [0.67, 0.98], [0.73, 0.99], [0.70, 0.72], [0.62, 0]] },
  { x: 0.90, pts: [[0.20, 0.92], [0.44, 0.97], [0.71, 1.00], [0.73, 0.70], [0.70, 0]] },
  { x: 0.55, pts: [[0.18, 0.94], [0.46, 0.99], [0.72, 1.02], [0.78, 0.66], [0.80, 0]] },
  { x: 0.00, pts: [[0.17, 0.98], [0.48, 1.02], [0.70, 1.04], [0.80, 0.63], [0.80, 0]] },
  { x: -0.88, pts: [[0.20, 1.02], [0.52, 1.06], [0.76, 1.08], [0.83, 0.65], [0.80, 0]] },
  { x: -1.08, pts: [[0.66, 1.08], [0.72, 1.10], [0.82, 1.10], [0.86, 0.68], [0.80, 0]] },
  { x: -1.62, pts: [[0.66, 1.06], [0.72, 1.08], [0.80, 1.09], [0.80, 0.80], [0.76, 0]] },
  { x: -1.80, pts: [[0.24, 1.03], [0.52, 1.06], [0.74, 1.07], [0.76, 0.82], [0.74, 0]] },
  { x: -2.12, pts: [[0.22, 0.99], [0.50, 1.03], [0.72, 1.05], [0.74, 0.85], [0.72, 0]] },
  { x: -2.30, pts: [[0.24, 0.92], [0.48, 0.97], [0.68, 1.00], [0.72, 0.82], [0.70, 0]] },
];

const WHEELS = [
  { x: 1.33, span: 0.43, rimY: 0.64, innerZ: 0.76, outerZ: 1.00 },
  { x: -1.35, span: 0.45, rimY: 0.68, innerZ: 0.78, outerZ: 1.10 },
];

// Vertiefte Motorabdeckung zwischen den Heckschultern.
const DECK_X0 = -1.05; const DECK_Y0 = 0.795;
const DECK_X1 = -2.12; const DECK_Y1 = 0.725;
const deckY = (x) => DECK_Y0 + ((x - DECK_X0) / (DECK_X1 - DECK_X0)) * (DECK_Y1 - DECK_Y0);

function buildPaint() {
  const g = facetBuilder();
  loftStations(g, STATIONS, 4, {
    0: { shade: (s) => [1, 2, 1, 2, 1, 2, 2, 1, 2, 2, 1, 1, 2][s] ?? 1 },
    1: { shade: (s) => [2, 3, 2, 3, 2, 3, 3, 2, 3, 3, 2, 2, 3][s] ?? 2 },
    2: { shade: (s) => [3, 4, 3, 4, 3, 4, 3, 4, 4, 3, 3, 4, 3][s] ?? 3 },
    3: { shade: (s) => [3, 4, 4, 3, 4, 3, 3, 3, 4, 3, 3, 4, 3][s] ?? 3 },
  });
  g.mirrorZ();
  capStation(g, STATIONS[0], 0.30, 1, 3);
  capStation(g, STATIONS[STATIONS.length - 1], 0.45, -1, 2);
  underbody(g, STATIONS);
  return g;
}

function buildCarbon() {
  const g = facetBuilder();
  g.box(2.18, 0.14, 0, 0.36, 0.08, 1.50, 2); // Frontsplitter (ragt knapp über die Nase)
  g.box(2.27, 0.24, 0, 0.08, 0.08, 1.10, 1); // Frontschürzen-Einlass
  g.box(0.015, 0.15, 1.00, 1.60, 0.09, 0.09, 2); // Schweller links
  g.box(0.015, 0.15, -1.00, 1.60, 0.09, 0.09, 1); // Schweller rechts
  // Vertiefte Motorabdeckung: geneigte Platte zwischen den Haunches …
  const zd = 0.55;
  g.quad(
    [DECK_X0, DECK_Y0 + 0.015, zd], [DECK_X0, DECK_Y0 + 0.015, -zd],
    [DECK_X1, DECK_Y1 + 0.015, -zd], [DECK_X1, DECK_Y1 + 0.015, zd], 0,
  );
  // … mit fünf breiten Lamellen quer darüber.
  for (let i = 0; i < 5; i++) {
    const x = -1.18 - i * 0.19;
    g.box(x, deckY(x) + 0.03, 0, 0.10, 0.05, 1.00, 2);
  }
  g.box(-2.315, 0.54, 0, 0.06, 0.24, 1.50, 1); // schwarzes Heckband
  // Diffusor mit Finnen
  g.box(-2.19, 0.16, 0, 0.30, 0.13, 1.62, 1);
  for (const z of [-0.55, -0.19, 0.19, 0.55]) {
    g.box(-2.24, 0.245, z, 0.20, 0.06, 0.05, 2);
  }
  wheelWells(g, WHEELS);
  return g;
}

function buildGlass() {
  const g = facetBuilder();
  const base = [[0.55, 0.80, 0.60], [-0.10, 0.80, 0.63], [-1.02, 0.82, 0.58]];
  const roofF = [-0.02, 1.31, 0.48];
  const roofR = [-0.55, 1.33, 0.46];
  // Windschutzscheibe
  g.quad([0.55, 0.80, 0.60], [0.55, 0.80, -0.60], [roofF[0], roofF[1], -roofF[2]], roofF, 4, true);
  // Dachglas
  g.quad(roofF, [roofF[0], roofF[1], -roofF[2]], [roofR[0], roofR[1], -roofR[2]], roofR, 3);
  // Heckscheibe hinunter aufs Motordeck
  g.quad(roofR, [roofR[0], roofR[1], -roofR[2]], [-1.02, 0.82, -0.58], [-1.02, 0.82, 0.58], 2, true);
  // Seitenscheiben links (+Z), von vorn nach hinten
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
  g.setColor([1.0, 0.97, 0.86]); // Frontlichter: warmes Weiß
  g.box(2.285, 0.35, 0.40, 0.06, 0.09, 0.34);
  g.box(2.285, 0.35, -0.40, 0.06, 0.09, 0.34);
  g.setColor([1.0, 0.05, 0.03]); // quadratisch-trapezförmige Rückleuchten
  g.box(-2.325, 0.55, 0.60, 0.05, 0.18, 0.34);
  g.box(-2.325, 0.55, -0.60, 0.05, 0.18, 0.34);
  return g;
}

export function buildRoterKeil() {
  return {
    paint: buildPaint().build(),
    carbon: buildCarbon().build(),
    glass: buildGlass().build(),
    lights: buildLights().build(),
  };
}
