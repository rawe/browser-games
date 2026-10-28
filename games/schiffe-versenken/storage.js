// Was den Seitenneuladen überlebt: Einstellungen und die laufende Partie.
//
// Alles liegt in `localStorage` und damit nur auf diesem Gerät. Jeder Zugriff
// ist gekapselt, weil `localStorage` in privaten Fenstern werfen kann – ein
// Spiel darf daran nicht scheitern.

import { DEFAULT_RULES } from './logic/rules.js';

const SETTINGS_KEY = 'schiffe.einstellungen.v1';
const MATCH_KEY = 'schiffe.partie.v1';

export const DEFAULTS = {
  sound: true,
  names: ['Spieler 1', 'Spieler 2'],
  level: 'mittel',
  rules: { ...DEFAULT_RULES },
};

const read = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Voller oder gesperrter Speicher: dann eben nur für diese Sitzung.
  }
};

export function loadSettings() {
  const stored = read(SETTINGS_KEY) ?? {};
  return { ...DEFAULTS, ...stored, rules: { ...DEFAULTS.rules, ...(stored.rules ?? {}) } };
}
export const saveSettings = (settings) => write(SETTINGS_KEY, settings);

export const loadMatch = () => read(MATCH_KEY);
export const saveMatch = (match) => write(MATCH_KEY, match);
export const clearMatch = () => {
  try { localStorage.removeItem(MATCH_KEY); } catch { /* siehe oben */ }
};
