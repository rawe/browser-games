// „Magenta Flügel“ – Gegnerfahrzeug nach Modellblatt 02.
// Typmerkmale: freistehender, fast fahrzeugbreiter Heckflügel auf zwei
// massiven Trägern, schlanke breite Rückleuchten-Querbalken im dunklen
// Heckband, zwei zentrale Auspufföffnungen, kräftige Diffusorfinnen und
// eine kürzere, steiler abfallende Front mit schmalen, angewinkelten DRLs.
// Rollen der Halbprofile (z >= 0): 0 untere Seitenkante (hebt sich über den
// Radhäusern), 1 Seitenmitte, 2 Schulterlinie, 3 äußere Deckkante/Haunch,
// 4 Mitte oben (Hauben-/Deckvertiefung zwischen den Schultern).
import { facetBuilder, loftStations } from './facetKit.js';
import { underbody, capStation, wheelWells } from './sharedParts.js';

// x | untere Kante | Seitenmitte | Schulter | Deckkante | Mitte
// Front deutlich steiler als beim Roten Keil: die Nase fällt zwischen
// x=1.80 und x=2.30 schnell auf 0.38 ab (Roter Keil: 0.46).
const STATIONS = [
  { x: 2.30, pts: [[0.18, 0.52], [0.26, 0.58], [0.34, 0.62], [0.37, 0.50], [0.38, 0]] },
  { x: 2.10, pts: [[0.17, 0.68], [0.30, 0.74], [0.44, 0.80], [0.48, 0.62], [0.50, 0]] },
  { x: 1.80, pts: [[0.19, 0.84], [0.40, 0.90], [0.56, 0.94], [0.60, 0.74], [0.58, 0]] },
  { x: 1.58, pts: [[0.66, 1.00], [0.72, 1.03], [0.78, 1.04], [0.68, 0.78], [0.60, 0]] },
  { x: 1.08, pts: [[0.66, 0.98], [0.72, 1.01], [0.78, 1.02], [0.72, 0.72], [0.64, 0]] },
  { x: 0.90, pts: [[0.20, 0.92], [0.44, 0.97], [0.72, 1.00], [0.75, 0.70], [0.72, 0]] },
  { x: 0.50, pts: [[0.18, 0.94], [0.46, 0.99], [0.74, 1.02], [0.80, 0.66], [0.82, 0]] },
  { x: 0.00, pts: [[0.17, 0.98], [0.48, 1.02], [0.72, 1.05], [0.82, 0.63], [0.82, 0]] },
  { x: -0.88, pts: [[0.20, 1.02], [0.52, 1.07], [0.78, 1.09], [0.85, 0.65], [0.82, 0]] },
  { x: -1.08, pts: [[0.74, 1.09], [0.82, 1.10], [0.90, 1.10], [0.88, 0.68], [0.80, 0]] },
  { x: -1.62, pts: [[0.74, 1.07], [0.82, 1.09], [0.88, 1.09], [0.82, 0.80], [0.76, 0]] },
  { x: -1.80, pts: [[0.24, 1.04], [0.52, 1.07], [0.76, 1.08], [0.78, 0.80], [0.75, 0]] },
  { x: -2.12, pts: [[0.22, 1.00], [0.50, 1.04], [0.73, 1.06], [0.75, 0.83], [0.72, 0]] },
  { x: -2.30, pts: [[0.24, 0.94], [0.48, 0.98], [0.70, 1.01], [0.73, 0.84], [0.71, 0]] },
];

const WHEELS = [
  { x: 1.33, span: 0.45, rimY: 0.66, innerZ: 0.76, outerZ: 1.03 },
  { x: -1.35, span: 0.47, rimY: 0.74, innerZ: 0.78, outerZ: 1.09 },
];

// Vertiefte Motorabdeckung: die dunkle Fläche folgt dem geneigten
// Deckband (Rolle 3 → Rolle 4) und schwebt knapp über dem Lack.
const DECK_XS = [-1.02, -1.35, -1.62, -1.90, -2.10];
const DECK_ZE = 0.58; // äußere Kante der dunklen Fläche
const DECK_LIFT = 0.02;

/** Lineare Interpolation einer Profilrolle ([y, z]) bei beliebigem x. */
function roleAt(x, role) {
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i]; const b = STATIONS[i + 1];
    if (x <= a.x && x >= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return [
        a.pts[role][0] + t * (b.pts[role][0] - a.pts[role][0]),
        a.pts[role][1] + t * (b.pts[role][1] - a.pts[role][1]),
      ];
    }
  }
  const s = STATIONS[STATIONS.length - 1];
  return [s.pts[role][0], s.pts[role][1]];
}

/** Höhe der Decksfläche (Band Rolle 3→4) bei x und z >= 0. */
function deckSurfY(x, z) {
  const [y3, z3] = roleAt(x, 3);
  const [y4] = roleAt(x, 4);
  return y4 + (Math.min(z, z3) / z3) * (y3 - y4) + DECK_LIFT;
}

/**
 * Gescherte Platte in X-Richtung: y-Kanten dürfen sich zwischen x0 und x1
 * ändern (für die geneigte Flügelklinge). yA/yB = [unten, oben] bei x0/x1.
 * Windung wie bei facetBuilder.box (x0 < x1, z0 < z1).
 */
function slabX(g, x0, x1, yA, yB, z0, z1, shade = 2) {
  const p000 = [x0, yA[0], z0]; const p001 = [x0, yA[0], z1];
  const p010 = [x0, yA[1], z0]; const p011 = [x0, yA[1], z1];
  const p100 = [x1, yB[0], z0]; const p101 = [x1, yB[0], z1];
  const p110 = [x1, yB[1], z0]; const p111 = [x1, yB[1], z1];
  g.quad(p100, p110, p111, p101, shade); // vorn
  g.quad(p000, p001, p011, p010, shade - 1); // hinten
  g.quad(p010, p011, p111, p110, shade + 1); // oben
  g.quad(p000, p100, p101, p001, shade - 2); // unten
  g.quad(p001, p101, p111, p011, shade); // links
  g.quad(p000, p010, p110, p100, shade - 1); // rechts
}

/**
 * Angewinkelter Lichtbalken quer zur Fahrtrichtung: y-Kanten ändern sich
 * zwischen z0 und z1 (z0 < z1). yA/yB = [unten, oben] bei z0/z1.
 */
function slantedBar(g, x0, x1, z0, z1, yA, yB, shade = 2) {
  const p000 = [x0, yA[0], z0]; const p001 = [x0, yB[0], z1];
  const p010 = [x0, yA[1], z0]; const p011 = [x0, yB[1], z1];
  const p100 = [x1, yA[0], z0]; const p101 = [x1, yB[0], z1];
  const p110 = [x1, yA[1], z0]; const p111 = [x1, yB[1], z1];
  g.quad(p100, p110, p111, p101, shade); // vorn (+X)
  g.quad(p000, p001, p011, p010, shade - 1); // hinten
  g.quad(p010, p011, p111, p110, shade + 1); // oben
  g.quad(p000, p100, p101, p001, shade - 2); // unten
  g.quad(p001, p101, p111, p011, shade); // Ende bei z1
  g.quad(p000, p010, p110, p100, shade - 1); // Ende bei z0
}

function buildPaint() {
  const g = facetBuilder({ facets: true, jitter: 0.02 });
  loftStations(g, STATIONS, 4, {
    0: { shade: (s) => [1, 2, 1, 2, 1, 2, 2, 1, 2, 2, 1, 1, 2][s] ?? 1 },
    1: { shade: (s) => [2, 3, 2, 3, 2, 3, 3, 2, 3, 3, 2, 2, 3][s] ?? 2 },
    2: { shade: (s) => [3, 4, 3, 4, 3, 4, 3, 4, 4, 3, 3, 4, 3][s] ?? 3 },
    3: { shade: (s) => [4, 3, 4, 3, 4, 3, 3, 3, 4, 3, 3, 4, 3][s] ?? 3 },
  });
  g.mirrorZ();
  capStation(g, STATIONS[0], 0.27, 1, 3);
  capStation(g, STATIONS[STATIONS.length - 1], 0.45, -1, 2);
  underbody(g, STATIONS);
  // Außenspiegel an den A-Säulen
  g.box(0.34, 0.96, 0.64, 0.09, 0.05, 0.15, 3);
  g.box(0.34, 0.96, -0.64, 0.09, 0.05, 0.15, 2);
  return g;
}

function buildCarbon() {
  const g = facetBuilder();
  g.box(2.20, 0.13, 0, 0.32, 0.07, 1.58, 2); // Frontsplitter unter der kurzen Nase
  g.box(2.26, 0.26, 0, 0.10, 0.16, 1.20, 1); // großer dunkler Frontschürzen-Einlass
  for (const z of [-0.35, 0, 0.35]) {
    g.box(2.31, 0.26, z, 0.06, 0.14, 0.05, 2); // vertikale Streben im Einlass
  }
  g.box(0.015, 0.15, 1.00, 1.60, 0.09, 0.09, 2); // Schweller links
  g.box(0.015, 0.15, -1.00, 1.60, 0.09, 0.09, 1); // Schweller rechts
  g.box(-0.70, 0.76, 1.06, 0.36, 0.36, 0.08, 1); // Seiteneinlass vor dem Hinterrad
  g.box(-0.70, 0.76, -1.06, 0.36, 0.36, 0.08, 0);
  // Glattes, dunkles Motordeck zwischen den Haunches: folgt dem geneigten
  // Deckband, dadurch bleibt es überall knapp über dem Lack sichtbar.
  for (let i = 0; i < DECK_XS.length - 1; i++) {
    const x0 = DECK_XS[i]; const x1 = DECK_XS[i + 1];
    const e0 = deckSurfY(x0, DECK_ZE); const c0 = deckSurfY(x0, 0);
    const e1 = deckSurfY(x1, DECK_ZE); const c1 = deckSurfY(x1, 0);
    g.quad([x0, e0, DECK_ZE], [x0, c0, 0], [x1, c1, 0], [x1, e1, DECK_ZE], 0);
    g.quad([x0, c0, 0], [x0, e0, -DECK_ZE], [x1, e1, -DECK_ZE], [x1, c1, 0], 0);
  }
  // … mit drei schlanken Querstreben (keine Lamellen wie beim Roten Keil),
  // die der Neigung des Decks folgen.
  const zb = 0.46; const bh = 0.05;
  for (const xc of [-1.30, -1.60, -1.90]) {
    const x0 = xc - 0.035; const x1 = xc + 0.035;
    const yC = deckSurfY(xc, 0) + 0.01; const yE = deckSurfY(xc, zb) + 0.01;
    slantedBar(g, x0, x1, 0, zb, [yC, yC + bh], [yE, yE + bh], 2);
    slantedBar(g, x0, x1, -zb, 0, [yE, yE + bh], [yC, yC + bh], 1);
  }
  g.box(-2.31, 0.57, 0, 0.07, 0.30, 1.70, 1); // dunkles Heckband
  g.box(-2.33, 0.34, 0.11, 0.08, 0.14, 0.16, 2); // Auspuff links der Mitte
  g.box(-2.33, 0.34, -0.11, 0.08, 0.14, 0.16, 2); // Auspuff rechts der Mitte
  // Diffusor mit sechs kräftigen Finnen
  g.box(-2.20, 0.16, 0, 0.32, 0.14, 1.66, 1);
  for (const z of [-0.68, -0.41, -0.14, 0.14, 0.41, 0.68]) {
    g.box(-2.25, 0.27, z, 0.22, 0.09, 0.05, 2);
  }
  // Freistehender Heckflügel: zwei massive Träger …
  g.box(-2.02, 1.05, 0.58, 0.30, 0.68, 0.11, 1);
  g.box(-2.02, 1.05, -0.58, 0.30, 0.68, 0.11, 1);
  // … darauf die fast fahrzeugbreite, nach hinten ansteigende Klinge …
  slabX(g, -2.30, -1.90, [1.42, 1.47], [1.34, 1.40], -1.00, 1.00, 2);
  // … mit kleinen Endplatten an den Spitzen.
  g.box(-2.10, 1.40, 0.985, 0.44, 0.15, 0.035, 2);
  g.box(-2.10, 1.40, -0.985, 0.44, 0.15, 0.035, 1);
  wheelWells(g, WHEELS);
  return g;
}

function buildGlass() {
  const g = facetBuilder({ facets: true, jitter: 0.012 });
  const base = [[0.58, 0.80, 0.60], [-0.08, 0.80, 0.63], [-1.00, 0.82, 0.58]];
  const roofF = [0.02, 1.31, 0.47];
  const roofR = [-0.52, 1.33, 0.45];
  // Windschutzscheibe
  g.quad(base[0], [base[0][0], base[0][1], -base[0][2]], [roofF[0], roofF[1], -roofF[2]], roofF, 4, true);
  // Dachglas
  g.quad(roofF, [roofF[0], roofF[1], -roofF[2]], [roofR[0], roofR[1], -roofR[2]], roofR, 3);
  // Heckscheibe hinunter aufs Motordeck
  g.quad(roofR, [roofR[0], roofR[1], -roofR[2]], [base[2][0], base[2][1], -base[2][2]], base[2], 2, true);
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
  g.setColor([1.0, 0.97, 0.86]); // schmale, angewinkelte DRLs (außen höher)
  slantedBar(g, 2.26, 2.32, 0.20, 0.58, [0.36, 0.41], [0.44, 0.49]);
  slantedBar(g, 2.26, 2.32, -0.58, -0.20, [0.44, 0.49], [0.36, 0.41]);
  g.setColor([1.0, 0.05, 0.03]); // zwei breite, dünne Rückleuchten-Querbalken
  g.box(-2.34, 0.63, 0.46, 0.04, 0.06, 0.72);
  g.box(-2.34, 0.63, -0.46, 0.04, 0.06, 0.72);
  return g;
}

export function buildMagentaFluegel() {
  return {
    paint: buildPaint().build(),
    carbon: buildCarbon().build(),
    glass: buildGlass().build(),
    lights: buildLights().build(),
  };
}
