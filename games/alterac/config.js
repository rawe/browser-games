// Konfigurierbare MVP-Werte für den Alterac Combat Simulator.

export const UNIT_MIN = 1;
export const UNIT_MAX = 10;

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
  { label: 'Schwach (3)', value: 3 },
  { label: 'Normal (5)', value: 5 },
  { label: 'Stark (8)', value: 8 },
];

export const DEFAULT_CONFIG = {
  units: 5,
  edgeTime: 1.7, // Reisezeit pro Wegstück in Sekunden
  respawnTime: 7, // Sekunden bis zum Respawn am Friedhof
  bossStrength: 5, // effektive Stärke des Endbosses (ohne weiteren Bonus)
  maxTime: 300, // Sicherheitslimit der Simulation in Sekunden
};

// Maximale Länge einer Angriffssequenz in der Planung.
export const MAX_ATTACK_TARGETS = 6;
