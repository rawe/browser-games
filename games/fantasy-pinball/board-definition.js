// Reine Tischbeschreibung in festen Weltkoordinaten. Physik und Renderer lesen
// dieselben Daten; spätere Kapitel können Elemente über ihre IDs verändern.

export const TABLE = Object.freeze({ width: 540, height: 960 });

const segment = (id, ax, ay, bx, by, thickness = 22, role = 'wall') => ({
  id, type: 'segment', ax, ay, bx, by, thickness, role,
});

export const BOARD_DEFINITION = Object.freeze({
  elements: [
    segment('wall-left', 30, 75, 30, 720),
    segment('wall-left-arch', 30, 75, 155, 28),
    segment('wall-top', 155, 28, 390, 28),
    segment('wall-right-arch', 390, 28, 510, 82),
    segment('wall-right', 510, 82, 510, 900),
    segment('guide-left', 30, 720, 118, 884, 24),
    segment('guide-left-apron', 118, 884, 220, 852, 20),
    segment('guide-right', 430, 720, 425, 884, 24),
    segment('guide-right-apron', 425, 884, 320, 852, 20),

    // Automatischer Abschusskanal. Oben ist er offen und lenkt die Kugel ins Feld.
    segment('launcher-divider', 446, 350, 446, 875, 16, 'launcher'),
    segment('launcher-deflector', 446, 150, 500, 92, 18, 'launcher'),

    // Deutlich sichtbarer alternativer Ballweg: eine schmale Runenrampe.
    segment('ramp-rail-left', 308, 685, 342, 485, 13, 'ramp'),
    segment('ramp-rail-right', 382, 690, 416, 468, 13, 'ramp'),
    {
      id: 'moon-ramp-gate', type: 'gate', x: 376, y: 500,
      width: 68, height: 12, angle: -0.16, role: 'ramp', points: 500,
    },

    { id: 'sun-bumper', type: 'bumper', x: 174, y: 236, radius: 31, kick: 8.5, points: 100 },
    { id: 'moon-bumper', type: 'bumper', x: 330, y: 222, radius: 30, kick: 8.2, points: 100 },
    { id: 'star-bumper', type: 'bumper', x: 260, y: 365, radius: 34, kick: 9, points: 150 },

    { id: 'rune-target', type: 'target', x: 103, y: 455, width: 18, height: 72, angle: -0.16, points: 300, accent: true },
    { id: 'shield-target', type: 'target', x: 423, y: 410, width: 18, height: 66, angle: 0.13, points: 250 },
    { id: 'gem-target-a', type: 'target', x: 190, y: 525, width: 48, height: 14, angle: 0.22, points: 200 },
    { id: 'gem-target-b', type: 'target', x: 273, y: 545, width: 48, height: 14, angle: 0, points: 200 },

    { id: 'post-left', type: 'post', x: 132, y: 690, radius: 15 },
    { id: 'post-right', type: 'post', x: 410, y: 700, radius: 15 },

    // Laufzeit-Demo: wird durch das Runen-Target animiert eingeblendet.
    {
      id: 'arcane-bumper', type: 'bumper', x: 145, y: 590, radius: 29,
      kick: 9.5, points: 250, active: false, dynamic: true,
    },

    // Noch unsichtbarer, physikfreier Anker für spätere Kampagnenfiguren.
    { id: 'npc-dais-west', type: 'npc-slot', x: 82, y: 330, active: false },
    { id: 'drain', type: 'drain', x: 270, y: 938, width: 470, height: 24 },
  ],
  flippers: [
    {
      id: 'flipper-left', side: 'left', pivotX: 166, pivotY: 820,
      length: 112, width: 24, restAngle: 0.43, activeAngle: -0.48,
    },
    {
      id: 'flipper-right', side: 'right', pivotX: 374, pivotY: 820,
      length: 112, width: 24, restAngle: Math.PI - 0.43, activeAngle: Math.PI + 0.48,
    },
  ],
  ball: { radius: 11, spawnX: 478, spawnY: 825, launchVelocity: { x: -0.6, y: -25 } },
});

export function validateBoardDefinition(definition = BOARD_DEFINITION) {
  const ids = [
    ...definition.elements.map((element) => element.id),
    ...definition.flippers.map((flipper) => flipper.id),
  ];
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  return {
    valid: duplicates.length === 0 && definition.elements.some((e) => e.type === 'drain'),
    duplicates: [...new Set(duplicates)],
  };
}
