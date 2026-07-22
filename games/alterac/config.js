// Konfigurierbare MVP-Werte für den Alterac Combat Simulator.
// Alle Kampf-, Einheiten- und Zeitwerte sind hier zentral definiert.

// ---------------------------------------------------------------- Einheitentypen
// Datengetriebene Definitionen: Neue Typen (oder später Spezialfähigkeiten)
// werden hier ergänzt – Simulation, Planung und Rendering lesen ausschließlich
// diese Werte und enthalten keine typspezifischen Sonderfälle.
//   cost           Ressourcenkosten beim Anwerben
//   hp             maximale Hitpoints
//   damage         Schaden pro Angriff
//   attackInterval Sekunden zwischen zwei Angriffen
//   speed          Bewegungstempo (1 = Basistempo, Reisezeit = edgeTime / speed)
//   radius         Token-Größe auf der Karte (nur Darstellung)
export const UNIT_TYPES = [
  {
    key: 'light',
    name: 'Leicht',
    short: 'L',
    icon: '🗡',
    cost: 1,
    hp: 8,
    damage: 3,
    attackInterval: 1,
    speed: 1.3,
    radius: 10,
    desc: 'Schnell und günstig – ideal zum Abfangen und für Umgehungswege.',
  },
  {
    key: 'medium',
    name: 'Mittel',
    short: 'M',
    icon: '⚔',
    cost: 2,
    hp: 18,
    damage: 7,
    attackInterval: 1,
    speed: 1,
    radius: 12.5,
    desc: 'Ausgewogener Allrounder für Front und Flanke.',
  },
  {
    key: 'heavy',
    name: 'Schwer',
    short: 'S',
    icon: '🛡',
    cost: 3,
    hp: 34,
    damage: 16,
    attackInterval: 1.6,
    speed: 0.75,
    radius: 15,
    desc: 'Langsam, aber zäh und mit wuchtigen Schlägen.',
  },
];

export const UNIT_TYPE_BY_KEY = Object.fromEntries(UNIT_TYPES.map((t) => [t.key, t]));

// ---------------------------------------------------------------- Spieloptionen
export const RESOURCE_OPTIONS = [
  { label: 'Scharmützel (8 Punkte)', value: 8 },
  { label: 'Feldschlacht (12 Punkte)', value: 12 },
  { label: 'Großoffensive (18 Punkte)', value: 18 },
  { label: 'Totaler Krieg (24 Punkte)', value: 24 },
];

export const TEMPO_OPTIONS = [
  { label: 'Schnell', edgeTime: 1.1 },
  { label: 'Normal', edgeTime: 1.7 },
  { label: 'Gemütlich', edgeTime: 2.4 },
];

export const RESPAWN_OPTIONS = [
  { label: 'Kurz (4 s)', value: 4 },
  { label: 'Mittel (7 s)', value: 7 },
  { label: 'Lang (11 s)', value: 11 },
];

export const BOSS_OPTIONS = [
  { label: 'Schwach (60 LP)', value: 60 },
  { label: 'Normal (100 LP)', value: 100 },
  { label: 'Stark (150 LP)', value: 150 },
];

export const GRAVEYARD_CAPTURE_OPTIONS = [
  { label: 'Schnell (6 s)', value: 6 },
  { label: 'Standard (10 s)', value: 10 },
  { label: 'Zäh (15 s)', value: 15 },
];

export const DEFAULT_CONFIG = {
  resources: 12, // Ressourcenpunkte pro Spieler zum Anwerben von Einheiten
  edgeTime: 1.7, // Basis-Reisezeit pro Wegstück in Sekunden (bei speed = 1)
  respawnTime: 7, // Sekunden bis zum Respawn am Friedhof
  graveyardCaptureTime: 10, // Sekunden ununterbrochener Präsenz bis zur Einnahme eines Friedhofs
  entrenchedFactor: 0.6, // Anteil des Schadens, den eingegrabene Verteidiger erleiden
  bossHp: 100, // maximale Hitpoints des Endbosses
  bossDamage: 12, // Schaden des Endbosses pro Angriff
  bossAttackInterval: 1, // Sekunden zwischen zwei Boss-Angriffen
  maxTime: 300, // Sicherheitslimit der Simulation in Sekunden
};

// Maximale Länge eines geplanten Pfads (Anzahl Wegpunkte).
export const MAX_PATH_LENGTH = 14;
