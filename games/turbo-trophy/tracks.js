// Streckendaten – reine Daten, keine Logik.
// `points` ist ein geschlossener Polygonzug, der beim Aufbau geglättet wird
// (siehe trackGeometry.js). `aiBonus` hebt das Tempo der Gegner pro Strecke an.
//
// `elements` ist optional und beschreibt Streckenelemente (Sprungschanzen,
// Öllachen, Schranken, Brücken) – Aufbau und Felder siehe elements.js.
// Strecken ohne `elements` funktionieren unverändert weiter.
//   at  Position als Anteil 0…1 der Rundenlänge
//   lat Seitenversatz zur Ideallinie (0 = Mitte, ±50 = Fahrbahnrand)
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
    // Einstieg: eine Schanze auf der Geraden, eine Lache zum Ausweichen.
    elements: [
      { type: 'ramp', at: 0.18, lat: 0, width: 56, length: 42, power: 1 },
      { type: 'oil', at: 0.62, lat: 20, radius: 26 },
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
    // Hafenbetrieb: eine Schranke sperrt zeitweise die halbe Durchfahrt.
    elements: [
      { type: 'oil', at: 0.28, lat: -18, radius: 28 },
      { type: 'gate', at: 0.55, lat: 26, width: 48, openTicks: 420, closedTicks: 210, warnTicks: 90 },
      { type: 'ramp', at: 0.82, lat: 0, width: 56, length: 40, power: 1 },
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
    elements: [
      { type: 'ramp', at: 0.12, lat: 0, width: 58, length: 44, power: 1.2 },
      { type: 'oil', at: 0.44, lat: 22, radius: 26 },
      { type: 'oil', at: 0.47, lat: -24, radius: 24 },
      { type: 'ramp', at: 0.74, lat: -6, width: 54, length: 40, power: 1 },
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
    elements: [
      { type: 'ramp', at: 0.09, lat: 0, width: 58, length: 44, power: 1.3 },
      { type: 'gate', at: 0.33, lat: -26, width: 48, openTicks: 360, closedTicks: 210, warnTicks: 90 },
      { type: 'oil', at: 0.58, lat: 16, radius: 30 },
      { type: 'gate', at: 0.78, lat: 26, width: 46, openTicks: 330, closedTicks: 180, warnTicks: 75, offsetTicks: 180 },
    ],
  },
  {
    id: 'achterkreuz',
    name: 'ACHTERKREUZ',
    laps: 3,
    aiBonus: 1.4,
    // Liegende Acht: die Strecke kreuzt sich selbst bei 22,3 % und 72,3 %
    // der Runde. Die Brücke hebt den zweiten Durchgang auf die obere Ebene,
    // der erste läuft als Tunnel darunter hindurch.
    points: [
      [870, 500], [848, 747], [783, 879], [685, 833], [564, 632], [436, 368],
      [315, 167], [217, 121], [152, 253], [130, 500], [152, 747], [217, 879],
      [315, 833], [436, 632], [564, 368], [685, 167], [783, 121], [848, 253],
    ],
    elements: [
      { type: 'ramp', at: 0.06, lat: 0, width: 58, length: 44, power: 1.3 },
      { type: 'bridge', at: 0.705, length: 200, level: 1 },
      { type: 'oil', at: 0.42, lat: -20, radius: 28 },
      { type: 'gate', at: 0.9, lat: 26, width: 46, openTicks: 390, closedTicks: 195, warnTicks: 90 },
    ],
  },
];
