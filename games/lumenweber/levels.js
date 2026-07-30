// Levelsammlung.
//
// Textformat (siehe `level.js`):
//
//   .  leer          #  Blocker        o  Zielpunkt
//   >  < ^ v  Lichtquelle mit Strahlrichtung
//   /  \  drehbarer Spiegel            1  2  fester Spiegel („/“ bzw. „\“)
//
// `par` ist die vom Solver bestimmte Mindestzahl an Drehungen. Sie wird von
// `npm run check:lumen` gegengeprüft – ein falscher Wert ist ein Testfehler.

import { parseLevel } from './level.js';

export const levelDefs = [
  {
    id: 'l01',
    name: 'Erstes Licht',
    hint: 'Tippe den Spiegel an. Er kippt zwischen / und \\ – der Lichtfaden folgt sofort.',
    par: 1,
    rows: [
      '..o..',
      '.....',
      '>.\\..',
      '.....',
      '.....',
    ],
  },
  {
    id: 'l02',
    name: 'Doppelknoten',
    hint: 'Das Licht endet nicht am ersten Ziel – es läuft weiter. Ein Faden, zwei Punkte.',
    par: 2,
    rows: [
      '.o./.',
      '...o.',
      '>..\\.',
      '.....',
      '.....',
    ],
  },
  {
    id: 'l03',
    name: 'Schattenwurf',
    hint: 'Blocker verschlucken den Faden. Führe ihn außen herum.',
    par: 2,
    rows: [
      '..#...',
      '......',
      '>./...',
      '......',
      '../..o',
      '......',
    ],
  },
  {
    id: 'l04',
    name: 'Festgeschraubt',
    hint: 'Verschraubte Spiegel lassen sich nicht drehen. Plane mit ihnen statt gegen sie.',
    par: 2,
    rows: [
      '.\\o.2.',
      '......',
      '>...\\.',
      '......',
      '.o....',
      '......',
    ],
  },
  {
    id: 'l05',
    name: 'Serpentine',
    hint: 'Vier Kurven, drei Ziele. Denke den ganzen Weg, bevor du drehst.',
    par: 3,
    rows: [
      '.......',
      '.\\.o./.',
      '.......',
      '>....\\.',
      '.o.....',
      '.\\.o...',
      '.......',
    ],
  },
];

export const levels = levelDefs.map(parseLevel);

export const levelById = new Map(levels.map((l) => [l.id, l]));
