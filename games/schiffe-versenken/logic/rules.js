// Spielfeld, Flotten und Regelvarianten – reine Daten, kein DOM.

export const SIZE = 10;
export const CELLS = SIZE * SIZE;

export const COLS = 'ABCDEFGHIJ';

/** Feldname wie auf dem Papierblock: „A1“ oben links, „J10“ unten rechts. */
export const cellName = (idx) => `${COLS[idx % SIZE]}${Math.floor(idx / SIZE) + 1}`;

export const xOf = (idx) => idx % SIZE;
export const yOf = (idx) => Math.floor(idx / SIZE);
export const at = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? -1 : y * SIZE + x);

/** Die vier Nachbarn über die Kanten. */
export function orthogonal(idx) {
  const x = xOf(idx);
  const y = yOf(idx);
  return [at(x, y - 1), at(x + 1, y), at(x, y + 1), at(x - 1, y)].filter((n) => n >= 0);
}

/** Alle acht Nachbarn – der Abstand, den Schiffe ohne Berührung halten. */
export function surrounding(idx) {
  const x = xOf(idx);
  const y = yOf(idx);
  const out = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx || dy) {
        const n = at(x + dx, y + dy);
        if (n >= 0) out.push(n);
      }
    }
  }
  return out;
}

/**
 * Schiffstypen. `kind` bestimmt nur das Aussehen; Länge und Name gelten für
 * die Regeln.
 */
export const SHIP_TYPES = {
  schlachtschiff: { name: 'Schlachtschiff', length: 5 },
  kreuzer: { name: 'Kreuzer', length: 4 },
  zerstoerer: { name: 'Zerstörer', length: 3 },
  uboot: { name: 'U-Boot', length: 3 },
  schnellboot: { name: 'Schnellboot', length: 2 },
};

/**
 * Zwei Flotten zur Wahl. Die kleine ist die bekannte Brettspiel-Aufstellung
 * und in zehn Minuten durchgespielt; die große ist die Papierblock-Variante
 * aus der Schule mit zehn Schiffen.
 */
export const FLEETS = {
  klassisch: {
    name: 'Klassisch',
    note: '5 Schiffe – schnelle Partie',
    ships: ['schlachtschiff', 'kreuzer', 'zerstoerer', 'uboot', 'schnellboot'],
  },
  gross: {
    name: 'Große Flotte',
    note: '10 Schiffe – wie auf dem Karopapier',
    ships: [
      'schlachtschiff',
      'kreuzer', 'kreuzer',
      'zerstoerer', 'zerstoerer', 'uboot',
      'schnellboot', 'schnellboot', 'schnellboot', 'schnellboot',
    ],
  },
};

export const DEFAULT_RULES = {
  fleet: 'klassisch',
  /** Schiffe dürfen sich nicht berühren, auch nicht über Eck. */
  spacing: true,
  /** Wer trifft, darf gleich noch einmal schießen. */
  bonusShot: true,
};

/** Die Schiffe einer Flotte mit stabilen Kennungen, noch ohne Position. */
export function fleetPieces(fleetId) {
  const fleet = FLEETS[fleetId] ?? FLEETS.klassisch;
  return fleet.ships.map((type, i) => ({
    id: `${type}-${i}`,
    type,
    name: SHIP_TYPES[type].name,
    length: SHIP_TYPES[type].length,
  }));
}
