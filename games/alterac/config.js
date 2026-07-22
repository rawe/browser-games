// Konfigurierbare MVP-Werte für den Alterac Combat Simulator.
// Alle Kampfwerte (Hitpoints, Schaden, Respawn, Boss) sind hier zentral definiert.

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
  { label: 'Schwach (60 LP)', value: 60 },
  { label: 'Normal (100 LP)', value: 100 },
  { label: 'Stark (150 LP)', value: 150 },
];

export const DEFAULT_CONFIG = {
  units: 5,
  edgeTime: 1.7, // Reisezeit pro Wegstück in Sekunden
  respawnTime: 7, // Sekunden bis zum Respawn am Friedhof
  unitHp: 10, // maximale Hitpoints je Basiseinheit
  unitDamage: 3, // Schaden pro Sekunde je Basiseinheit
  unitDamageVsDefender: 2, // Schaden je Basiseinheit gegen eingegrabene Verteidiger
  bossHp: 100, // maximale Hitpoints des Endbosses
  bossDamage: 12, // Schaden pro Sekunde des Endbosses
  tickInterval: 1, // Sekunden zwischen zwei Schadensintervallen
  maxTime: 300, // Sicherheitslimit der Simulation in Sekunden
};

// Maximale Länge einer Angriffssequenz in der Planung.
export const MAX_ATTACK_TARGETS = 6;
