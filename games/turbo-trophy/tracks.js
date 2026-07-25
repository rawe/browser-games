// Streckendaten – reine Daten, keine Logik.
// `points` ist ein geschlossener Polygonzug, der beim Aufbau geglättet wird
// (siehe trackGeometry.js). `aiBonus` hebt das Tempo der Gegner pro Strecke an.
export const tracks = [
  {
    id: 'gruenring',
    name: 'GRÜNRING',
    laps: 3,
    aiBonus: 0,
    points: [
      [150, 250], [450, 140], [850, 220], [870, 450], [650, 520], [640, 660],
      [860, 730], [830, 880], [500, 905], [160, 830], [135, 560],
    ],
  },
  {
    id: 'hafen-gp',
    name: 'HAFEN-GP',
    laps: 3,
    aiBonus: 0.45,
    points: [
      [140, 160], [860, 140], [880, 305], [300, 330], [295, 470], [870, 470],
      [880, 635], [300, 655], [295, 800], [860, 820], [845, 925], [150, 905],
    ],
  },
  {
    id: 'serpentin',
    name: 'SERPENTIN',
    laps: 4,
    aiBonus: 0.95,
    points: [
      [150, 150], [500, 120], [870, 180], [830, 400], [560, 430], [540, 560],
      [860, 600], [880, 850], [560, 905], [300, 860], [140, 650], [300, 500], [160, 350],
    ],
  },
  {
    id: 'finale',
    name: 'FINALE',
    laps: 4,
    aiBonus: 1.4,
    points: [
      [120, 120], [880, 120], [880, 360], [520, 360], [520, 240], [250, 240],
      [250, 520], [880, 520], [880, 880], [610, 880], [610, 700], [410, 700],
      [410, 880], [120, 880],
    ],
  },
];
