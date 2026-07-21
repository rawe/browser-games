// Streckendaten – reine Daten, keine Logik.
// Neue Strecke = neuer Eintrag: geschlossener Polygonzug (Kontrollpunkte in Metern),
// wird zur Laufzeit per Catmull-Rom-Spline geglättet (siehe trackGeometry.js).
export const tracks = [
  {
    id: 'kiesgrube',
    name: 'Kiesgrube',
    laps: 4,
    width: 10,
    points: [
      [-30, -40], [10, -45], [35, -30], [40, 0], [30, 25], [35, 45],
      [15, 55], [-15, 50], [-35, 55], [-45, 30], [-40, 5], [-45, -20],
    ],
    env: { sky: 0x2a2438, fog: 0x2a2438, grass: 0x2e5b36, horizon: 0xff8a50 },
  },
  {
    id: 'stadtkurs',
    name: 'Stadtkurs',
    laps: 4,
    width: 9,
    points: [
      [0, -60], [40, -55], [50, -30], [30, -15], [10, -25], [-5, -10],
      [15, 5], [45, 10], [55, 35], [35, 55], [0, 50], [-30, 58],
      [-50, 40], [-45, 15], [-25, 5], [-45, -10], [-50, -35], [-30, -55],
    ],
    env: { sky: 0x141a2e, fog: 0x141a2e, grass: 0x27502f, horizon: 0x5a7bff },
  },
  {
    id: 'bergpass',
    name: 'Bergpass',
    laps: 5,
    width: 9,
    points: [
      [0, -70], [35, -65], [55, -45], [45, -20], [60, 0], [50, 25],
      [60, 50], [35, 65], [5, 55], [-20, 65], [-45, 55], [-55, 30],
      [-40, 10], [-55, -10], [-45, -35], [-50, -55], [-28, -66],
    ],
    env: { sky: 0x1b2431, fog: 0x1b2431, grass: 0x33573a, horizon: 0x9fb4c8 },
  },
];
