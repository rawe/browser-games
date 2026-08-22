// Was den Seitenneuladen überlebt: Einstellungen und die laufende Partie.
//
// Alles liegt in `localStorage` und damit nur auf diesem Gerät – das Spiel
// kommt ohne Server aus. Jeder Zugriff ist gekapselt, weil `localStorage` in
// privaten Fenstern und bei blockierten Cookies wirft; ein Spiel darf daran
// nicht scheitern.

const SETTINGS_KEY = 'schach.einstellungen.v1';
const GAME_KEY = 'schach.partie.v1';

export const DEFAULTS = {
  sound: true,
  /** Zeigt die möglichen Zielfelder der gewählten Figur an. */
  hints: true,
  /** Dreht das Brett im Zweispielermodus zur Seite, die am Zug ist. */
  autoFlip: true,
  level: 'klub',
  timeControl: 'aus',
  /** Farbe des Menschen gegen den Computer: 'weiss', 'schwarz' oder 'zufall'. */
  side: 'weiss',
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

export const loadSettings = () => ({ ...DEFAULTS, ...(read(SETTINGS_KEY) ?? {}) });
export const saveSettings = (settings) => write(SETTINGS_KEY, settings);

export const loadGame = () => read(GAME_KEY);
export const saveGame = (snapshot) => write(GAME_KEY, snapshot);
export const clearGame = () => {
  try { localStorage.removeItem(GAME_KEY); } catch { /* siehe oben */ }
};
