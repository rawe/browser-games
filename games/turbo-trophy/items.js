// Ausrüstung: ein gemeinsames Item-System für Waffen und Spezialausrüstung.
//
// Alles Kaufbare steht hier als Datensatz. Shop, HUD, Touch-Buttons,
// Tastenbelegung und die Startausstattung leiten sich daraus ab – ein neues
// Item (Mine, Schild, EMP, Reparaturkit) braucht darum in der Regel nur einen
// Eintrag in dieser Liste plus seine Wirkung in `weapons.js` bzw. `race.js`.
//
// Bestand
// -------
// Fahrzeug und Karriere führen den Bestand als `ammo`-Objekt mit den Item-IDs
// als Schlüssel: `{ front: 2, rear: 1, homing: 0, turbo: 0, oil: 0 }`.

/**
 * cost   Preis im Shop
 * max    Höchstbestand
 * start  Startausstattung einer neuen Karriere
 * key    Tastaturkürzel (Kleinbuchstabe oder ' ' für die Leertaste)
 * aiUse  Grundwahrscheinlichkeit je Tick, dass die KI es einsetzt
 *        (wird mit dem Waffenfaktor der Schwierigkeitsstufe multipliziert)
 */
export const ITEMS = [
  {
    id: 'front',
    name: 'Front-Rakete',
    icon: '▲',
    label: 'RAKETE',
    hint: 'Feuert geradeaus nach vorn',
    cost: 250,
    max: 8,
    start: 2,
    key: ' ',
    keyName: 'Leertaste',
    aiUse: 0.02,
  },
  {
    id: 'rear',
    name: 'Heck-Rakete',
    icon: '▼',
    label: 'RAKETE',
    hint: 'Feuert nach hinten gegen Verfolger',
    cost: 170,
    max: 8,
    start: 1,
    key: 'x',
    keyName: 'X',
    aiUse: 0.012,
  },
  {
    id: 'homing',
    name: 'Zielsuchrakete',
    icon: '◎',
    label: 'ZIELSUCH',
    hint: 'Verfolgt den Vordermann und trifft deutlich härter',
    cost: 620,
    max: 5,
    start: 0,
    key: 'c',
    keyName: 'C',
    aiUse: 0.016,
  },
  {
    id: 'turbo',
    name: 'Turbo',
    icon: '⚡',
    label: 'TURBO',
    hint: 'Kurzer Schub – und weite Sprünge über Schanzen',
    cost: 380,
    max: 6,
    start: 0,
    key: 'v',
    keyName: 'V',
    aiUse: 0.02,
  },
  {
    id: 'oil',
    name: 'Öllache',
    icon: '\u{1F6E2}',
    label: 'ÖL',
    hint: 'Legt eine Lache ab – Verfolger verlieren die Haftung',
    cost: 300,
    max: 6,
    start: 0,
    key: 'b',
    keyName: 'B',
    aiUse: 0.02,
  },
];

export const ITEM_IDS = ITEMS.map((item) => item.id);

export const itemFor = (id) => ITEMS.find((item) => item.id === id);

/** Startbestand einer neuen Karriere. */
export const startingAmmo = () =>
  Object.fromEntries(ITEMS.map((item) => [item.id, item.start]));

/** Bestand ergänzen/säubern – fehlende IDs auf 0, unbekannte fliegen raus. */
export const normalizeAmmo = (ammo = {}) =>
  Object.fromEntries(ITEMS.map((item) => [item.id, Math.max(0, Math.min(item.max, ammo[item.id] ?? 0))]));

/* ---------- Kennwerte der Wirkung ---------- */

/** Raketen: Schaden und Flugverhalten je Art. */
export const MISSILE = {
  front: { damage: 42, speed: 8.5, life: 75 },
  rear: { damage: 42, speed: 8.5, life: 75 },
  // Zielsuchend: etwas langsamer, dafür kurvenfähig und deutlich härter.
  homing: { damage: 64, speed: 7.4, life: 130, turn: 0.075, range: 520 },
};

export const TURBO = {
  ticks: 105,      // Dauer eines Schubs
  speed: 1.34,     // Faktor auf die Höchstgeschwindigkeit
  accel: 1.9,      // Faktor auf die Beschleunigung
  jump: 1.7,       // Faktor auf die Sprungdauer über einer Schanze
  ramDamage: 58,   // Schaden am überfahrenen Fahrzeug
  ramSelf: 10,     // Rückschlag für den Angreifer
};

/** Abgelegte Öllache: begrenzte Lebensdauer und Auslösungen. */
export const OIL_DROP = {
  radius: 26,
  life: 60 * 22,   // Ticks, bis sie versickert
  uses: 3,         // so viele Fahrzeuge bringt sie ins Schleudern
  grace: 45,       // so lange ist der eigene Wagen dagegen immun
  behind: 26,      // Ablageabstand hinter dem Fahrzeug
};
