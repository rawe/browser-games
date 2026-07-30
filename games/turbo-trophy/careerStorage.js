// Karrierestand sichern und laden – damit eine über mehrere Saisons laufende
// Meisterschaft einen Browserneustart übersteht.
//
// Gespeichert wird nach jedem Rennen und jedem Kauf. Ein gespeicherter Stand
// ist immer nur ein *Angebot*: Was nicht zu den heutigen Daten passt (alte
// Item-IDs, Stufen über der Ausbaugrenze, ein Kalender, der kürzer geworden
// ist), wird beim Laden zurechtgerückt statt abgelehnt – ein alter Spielstand
// soll ein Spiel nie unmöglich machen.

import { createCareer, maxLevel } from './career.js';
import { DIFFICULTIES } from './ai.js';
import { normalizeAmmo } from './items.js';
import { racesIn } from './seasons.js';
import { readJson, removeKey, writeJson } from './storage.js';

const KEY = 'turbo-trophy:career';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Einen geladenen Stand auf gültige Werte bringen. */
function sanitize(raw) {
  const base = createCareer();
  const difficulty = DIFFICULTIES.some((d) => d.id === raw?.difficulty)
    ? raw.difficulty : base.difficulty;
  const career = {
    ...base,
    difficulty,
    season: Math.max(0, Math.round(num(raw?.season))),
    money: Math.max(0, Math.round(num(raw?.money, base.money))),
    hp: clamp(Math.round(num(raw?.hp, 100)), 1, 100),
    points: Math.max(0, Math.round(num(raw?.points))),
    totalPoints: Math.max(0, Math.round(num(raw?.totalPoints))),
    titles: Math.max(0, Math.round(num(raw?.titles))),
    ammo: normalizeAmmo(raw?.ammo ?? {}),
  };
  // Der Lauf muss im Kalender der Saison liegen – Kalender können sich mit
  // einer neuen Spielversion ändern.
  career.stage = clamp(Math.round(num(raw?.stage)), 0, racesIn(career.season) - 1);
  const cap = maxLevel(career);
  for (const key of ['engine', 'handling', 'armor']) {
    career[key] = clamp(Math.round(num(raw?.[key])), 0, cap);
  }
  return career;
}

/** Gespeicherter Stand – `null`, wenn keiner da oder er unbrauchbar ist. */
export function loadCareer() {
  const raw = readJson(KEY);
  if (!raw || typeof raw !== 'object') return null;
  try {
    return sanitize(raw);
  } catch {
    return null;
  }
}

/** Stand sichern. `false`, wenn der Browser keinen Speicher zulässt. */
export const saveCareer = (career) => writeJson(KEY, career);

/** Stand verwerfen – der nächste Start beginnt wieder bei null. */
export const clearCareer = () => removeKey(KEY);
