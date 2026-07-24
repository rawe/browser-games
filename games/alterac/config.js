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
//
// Die hier hinterlegten Zahlenwerte (cost, hp, damage, attackInterval, speed)
// sind Datei-Defaults. Sie lassen sich im Setup je Partie überschreiben
// (`config.unitStats`); der EINZIGE Abrufpunkt der effektiven Werte ist
// `resolveUnitTypes(config)` bzw. `resolveUnitTypeMap(config)` weiter unten –
// egal ob Datei-Default oder überschrieben. Identitätsfelder (name, short,
// icon, radius, desc) bleiben fest.
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

// Im Setup feinjustierbare Zahlenwerte jedes Einheitentyps. Aufbau wie die
// Felder in CONFIG_SECTIONS (min/max/step/kind/unit) – die UI (main.js) baut
// daraus je Typ eine Gruppe von Zahlenfeldern, klemmt jeden Wert auf [min,max]
// und schreibt das Ergebnis nach `config.unitStats[typKey][statKey]`.
export const UNIT_STAT_FIELDS = [
  { key: 'cost', label: 'Kosten', min: 1, max: 8, step: 1, kind: 'int', unit: '⬢' },
  { key: 'hp', label: 'Lebenspunkte', min: 1, max: 120, step: 1, kind: 'int', unit: 'LP' },
  { key: 'damage', label: 'Schaden', min: 1, max: 60, step: 1, kind: 'int' },
  { key: 'attackInterval', label: 'Angriffsintervall', min: 0.2, max: 5, step: 0.1, kind: 'float', unit: 's' },
  { key: 'speed', label: 'Tempo', min: 0.3, max: 3, step: 0.05, kind: 'float', unit: '×' },
];

// Default-Overrides je Typ: die reinen Zahlenwerte aus den Basis-Definitionen.
// Landen in DEFAULT_CONFIG.unitStats und werden im Setup ggf. überschrieben.
export const DEFAULT_UNIT_STATS = Object.fromEntries(
  UNIT_TYPES.map((t) => [t.key, Object.fromEntries(UNIT_STAT_FIELDS.map((f) => [f.key, t[f.key]]))])
);

// ---------------------------------------------------------------- Spieloptionen
export const RESOURCE_OPTIONS = [
  { label: 'Scharmützel (8 Punkte)', value: 8 },
  { label: 'Feldschlacht (12 Punkte)', value: 12 },
  { label: 'Großoffensive (18 Punkte)', value: 18 },
  { label: 'Totaler Krieg (24 Punkte)', value: 24 },
];

export const DEFAULT_CONFIG = {
  // Überschreibbare Zahlenwerte der Einheitentypen (siehe UNIT_STAT_FIELDS).
  // Fehlt der Schlüssel (oder ein einzelner Wert), greift der Basis-Default aus
  // UNIT_TYPES – der Zusammenbau passiert zentral in resolveUnitTypes().
  unitStats: DEFAULT_UNIT_STATS,
  resources: 12, // Ressourcenpunkte pro Spieler zum Anwerben von Einheiten
  // Basis-Reisezeit pro Wegstück in Sekunden (bei speed = 1). Fester Default,
  // nicht im Setup wählbar – hier anpassen, um das globale Marschtempo zu ändern.
  edgeTime: 1.7,
  respawnTime: 7, // Intervall der globalen Respawn-Wellen in Sekunden (Gefallene kehren gebündelt am nächsten Taktpunkt zurück)
  graveyardCaptureTime: 10, // Sekunden ununterbrochener Präsenz bis zur Einnahme eines Friedhofs
  entrenchedFactor: 0.6, // Anteil des Schadens, den eingegrabene Verteidiger erleiden
  bossHp: 100, // maximale Hitpoints des Endbosses
  bossDamage: 12, // Basis-Schaden des Endbosses pro Angriff (Grundwert für die Turm-Reduktion)
  bossAttackInterval: 1, // Sekunden zwischen zwei Boss-Angriffen
  // Flächen-Gegenschlag des Fürsten: trifft in eigenem Takt ALLE gerade an ihm
  // angreifenden Einheiten gleichzeitig – so wird ein unkoordinierter Massensturm
  // riskant, weil der ausgeteilte Gesamtschaden mit der Zahl der Angreifer wächst.
  // Unterliegt demselben Turm-Debuff wie der Einzelangriff (siehe bossDamageOf in
  // sim.js), gedeckelt durch bossDamageFloor. AoE-Schaden 0 schaltet ihn ab.
  bossAoeDamage: 6, // Schaden pro Flächenschlag an jede angreifende Einheit (0 = aus)
  bossAoeInterval: 3, // Sekunden zwischen zwei Flächenschlägen
  maxTime: 300, // Sicherheitslimit der Simulation in Sekunden

  // ------------------------------------------------------------------ Türme
  // Türme sind ortsfeste Kampfeinheiten an markierten Wegpunkten (die `tower`-
  // Markierung der Knoten in map.js legt Standort und Fraktion fest). Sie
  // bewegen sich nicht, regenerieren nicht und respawnen nicht.
  // Ein Turmkampf beginnt nur, wenn eine Einheit den gegnerischen Turm
  // ausdrücklich als Angriffsziel plant (Pfadende + Haltung „Angriff").
  towersPerFaction: 2, // Anzahl aktiver Türme je Fraktion (aus den markierten Kandidaten der Karte)
  towerHp: 40, // maximale Hitpoints eines Turms
  towerDamage: 10, // Schaden pro Turm-Angriff
  towerAttackInterval: 1.2, // Sekunden zwischen zwei Turm-Angriffen
  // Jeder zerstörte Turm senkt den Angriffsschaden des zugehörigen Fürsten
  // dauerhaft – stets berechnet auf den Basis-Schaden (bossDamage), nicht auf
  // den bereits reduzierten Wert.
  towerDamageReduction: 0.25, // Anteil des Basis-Schadens, um den der Fürst je zerstörtem Turm sinkt
  bossDamageFloor: 0.5, // Mindestanteil des Basis-Schadens, den der Fürst niemals unterschreitet
  // Boss-Schutz durch eigene Türme: Solange eine Fraktion noch mindestens einen
  // Turm besitzt, blockt ihr Boss den Anteil `bossTowerShield` des Schadens (er
  // erleidet also nur `1 − bossTowerShield`). Der Schild ist prozentual und
  // konfigurierbar – nicht absolut: beim Standard 0.8 kommen noch 20 % durch.
  // Sind ALLE Türme gefallen (oder gibt es keine, towersPerFaction=0), fällt der
  // Schild auf 0 % und der Boss erleidet vollen Schaden.
  bossTowerShield: 0.8,
};

// ------------------------------------------------------- Erweitertes Konfig-Menü
// Datengetriebener Deskriptor der Feineinstellungen im aufklappbaren Erweitert-
// Bereich der Start-UI. Die UI (main.js) baut daraus die Zahlenfelder, liest sie
// beim Absenden aus und klemmt jeden Wert auf [min, max] – Sim, Planer und KI
// lesen weiterhin ausschließlich die fertigen `config`-Werte.
//   key   Schlüssel in DEFAULT_CONFIG / config
//   min/max/step  Grenzen und Schrittweite der Pfeiltasten (in Anzeige-Einheiten)
//   unit  optionale Einheit hinter dem Label (z. B. „s", „%")
//   kind  'int'     ganzzahliger Wert
//         'float'   Dezimalwert (Sekunden)
//         'percent' im Menü als Prozent (min/max/step in %), intern als Anteil 0–1
// `gate: 'towers'` markiert Gruppen, die nur bei aktiven Türmen wirken; die UI
// graut sie aus, solange der Türme-Schalter aus ist.
export const CONFIG_SECTIONS = [
  {
    key: 'times',
    label: 'Zeiten',
    fields: [
      { key: 'respawnTime', label: 'Respawn-Intervall', min: 2, max: 20, step: 1, kind: 'int', unit: 's' },
      { key: 'graveyardCaptureTime', label: 'Einnahmedauer', min: 3, max: 30, step: 1, kind: 'int', unit: 's' },
    ],
  },
  {
    key: 'towers',
    label: 'Türme',
    gate: 'towers',
    fields: [
      { key: 'towerHp', label: 'Turm-LP', min: 5, max: 200, step: 5, kind: 'int' },
      { key: 'towerDamage', label: 'Turm-Schaden', min: 1, max: 60, step: 1, kind: 'int' },
      { key: 'towerAttackInterval', label: 'Turm-Angriffsintervall', min: 0.2, max: 5, step: 0.1, kind: 'float', unit: 's' },
      { key: 'towerDamageReduction', label: 'Debuff je Turm', min: 0, max: 50, step: 5, kind: 'percent', unit: '%' },
      { key: 'bossDamageFloor', label: 'Boss-Mindestschaden', min: 0, max: 100, step: 5, kind: 'percent', unit: '%' },
      { key: 'bossTowerShield', label: 'Boss-Schutz (Türme stehen)', min: 0, max: 100, step: 5, kind: 'percent', unit: '%' },
    ],
  },
  {
    key: 'boss',
    label: 'Boss',
    fields: [
      { key: 'bossHp', label: 'Boss-LP', min: 20, max: 400, step: 10, kind: 'int' },
      { key: 'bossDamage', label: 'Boss-Schaden', min: 1, max: 60, step: 1, kind: 'int' },
      { key: 'bossAttackInterval', label: 'Boss-Angriffsintervall', min: 0.2, max: 5, step: 0.1, kind: 'float', unit: 's' },
      { key: 'bossAoeDamage', label: 'Boss-Flächenschaden', min: 0, max: 60, step: 1, kind: 'int' },
      { key: 'bossAoeInterval', label: 'Boss-Flächenintervall', min: 0.2, max: 8, step: 0.1, kind: 'float', unit: 's' },
    ],
  },
];

// Turmzahl je Fraktion, wenn der Türme-Schalter aktiv ist (aus = 0).
export const TOWERS_ON_COUNT = DEFAULT_CONFIG.towersPerFaction;

// Maximale Länge eines geplanten Pfads (Anzahl Wegpunkte).
export const MAX_PATH_LENGTH = 14;

// Ganzzahl (ab 1) als römische Ziffer. Dient der eindeutigen Kennzeichnung
// jeder angeworbenen Einheit – in der Einheitenliste und auf ihrem Karten-Token
// während der Simulation. Fällt bei ungültigen Werten auf die Dezimalzahl zurück.
export function toRoman(n) {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v < 1) return String(n);
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = v;
  for (const [val, sym] of table) while (rest >= val) { out += sym; rest -= val; }
  return out;
}

// ------------------------------------------------- Zentraler Einheiten-Zugriff
// EINZIGER Abrufpunkt der effektiven Einheitenwerte: verbindet die festen
// Basis-Definitionen (name, short, icon, radius, desc) mit den – ggf. im Setup
// überschriebenen – Zahlenwerten aus `config.unitStats`. Fehlt der config-Wert,
// bleibt der Datei-Default aus UNIT_TYPES erhalten. Sim, Planer, KI und
// Rendering holen ihre Werte ausschließlich hierüber, egal ob Datei oder
// Override. `config` darf fehlen (dann reine Datei-Defaults).
export function resolveUnitTypes(config) {
  const overrides = config?.unitStats ?? {};
  return UNIT_TYPES.map((t) => ({ ...t, ...(overrides[t.key] ?? {}) }));
}

export function resolveUnitTypeMap(config) {
  return Object.fromEntries(resolveUnitTypes(config).map((t) => [t.key, t]));
}
