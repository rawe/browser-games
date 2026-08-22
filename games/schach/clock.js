// Schachuhr. Optional – ohne Bedenkzeit läuft sie gar nicht erst an.
//
// Gerechnet wird nicht in Ticks, sondern aus der Uhrzeit: Ein Handy, das den
// Bildschirm abschaltet, hält `requestAnimationFrame` an – ein Zähler würde
// dann stehenbleiben und der Spieler bekäme Zeit geschenkt.

import { WHITE, BLACK } from './engine/board.js';

/** Auswählbare Bedenkzeiten. `inc` ist der Zuschlag pro Zug (Fischer-Modus). */
export const TIME_CONTROLS = [
  { id: 'aus', name: 'Ohne Uhr', minutes: 0, inc: 0 },
  { id: 'blitz', name: '5 Minuten', minutes: 5, inc: 0 },
  { id: 'blitz-inc', name: '3 Min + 2 Sek', minutes: 3, inc: 2 },
  { id: 'schnell', name: '10 Min + 5 Sek', minutes: 10, inc: 5 },
];

export const controlById = (id) => TIME_CONTROLS.find((c) => c.id === id) ?? TIME_CONTROLS[0];

/**
 * @param {object} control ein Eintrag aus `TIME_CONTROLS`
 */
export function createClock(control) {
  const budget = control.minutes * 60_000;
  return {
    control,
    enabled: budget > 0,
    /** Verbleibende Zeit je Farbe in Millisekunden. */
    left: [budget, budget],
    /** Wer läuft gerade, und seit wann? */
    running: -1,
    since: 0,
  };
}

/** Uhr der Farbe `color` starten und die der Gegenseite anhalten. */
export function startSide(clock, color, now = Date.now()) {
  if (!clock.enabled) return;
  stop(clock, now);
  clock.running = color;
  clock.since = now;
}

/** Beide Uhren anhalten und die verbrauchte Zeit verbuchen. */
export function stop(clock, now = Date.now()) {
  if (!clock.enabled || clock.running < 0) return;
  clock.left[clock.running] = Math.max(0, clock.left[clock.running] - (now - clock.since));
  clock.running = -1;
}

/**
 * Zug fertig: Zeit verbuchen, Zuschlag gutschreiben, Gegner starten.
 * @returns {boolean} `false`, wenn dabei die Zeit abgelaufen ist
 */
export function completeMove(clock, color, now = Date.now()) {
  if (!clock.enabled) return true;
  stop(clock, now);
  if (clock.left[color] <= 0) return false;
  clock.left[color] += clock.control.inc * 1000;
  startSide(clock, color === WHITE ? BLACK : WHITE, now);
  return true;
}

/** Verbleibende Zeit einer Farbe, laufende Uhr eingerechnet. */
export function remaining(clock, color, now = Date.now()) {
  if (!clock.enabled) return Infinity;
  const spent = clock.running === color ? now - clock.since : 0;
  return Math.max(0, clock.left[color] - spent);
}

/** Wessen Zeit ist abgelaufen? `-1`, solange beide Zeit haben. */
export function flagged(clock, now = Date.now()) {
  if (!clock.enabled) return -1;
  for (const color of [WHITE, BLACK]) if (remaining(clock, color, now) <= 0) return color;
  return -1;
}

/** `4:07` – und unter zehn Sekunden auf Zehntel genau. */
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '–';
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  if (total < 10_000) return `${seconds}.${Math.floor((total % 1000) / 100)}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
