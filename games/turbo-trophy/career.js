// Meisterschaft: Konto, Tuning-Stufen, Ausrüstung, KI-Schwierigkeit.
// Reine Datenlogik ohne DOM.

import { DEFAULT_DIFFICULTY } from './ai.js';
import { ITEMS, itemFor, normalizeAmmo, startingAmmo } from './items.js';

export const MAX_LEVEL = 4;
export const UPGRADE_COSTS = [600, 900, 1300, 1800];

// Preisgeld und Meisterschaftspunkte nach Zielposition (Index 0 = Sieg).
export const PRIZES = [2000, 1200, 800, 300];
export const POINTS = [9, 6, 4, 2];

// Nur die ersten drei qualifizieren sich für den nächsten Lauf.
export const QUALIFY_PLACES = 3;

export function createCareer(difficulty = DEFAULT_DIFFICULTY) {
  return {
    difficulty,
    money: 1000,
    engine: 0,
    handling: 0,
    armor: 0,
    hp: 100,
    // Ausrüstungsbestand nach Item-ID – siehe items.js.
    ammo: startingAmmo(),
    points: 0,
    stage: 0,
  };
}

export const upgradeCost = (level) => (level >= MAX_LEVEL ? null : UPGRADE_COSTS[level]);

export const repairCost = (career) => Math.round((100 - career.hp) * 4);

/** Preisgeld steigt mit jedem Lauf – späte Rennen zahlen deutlich besser. */
export const prizeFor = (place, stage) => Math.round((PRIZES[place] * (1 + stage * 0.3)) / 10) * 10;

export function buyRepair(career) {
  const cost = repairCost(career);
  if (cost <= 0 || career.money < cost) return false;
  career.money -= cost;
  career.hp = 100;
  return true;
}

export function buyUpgrade(career, key) {
  const cost = upgradeCost(career[key]);
  if (cost === null || career.money < cost) return false;
  career.money -= cost;
  career[key]++;
  return true;
}

/** Ein Ausrüstungsstück kaufen. `id` ist eine Item-ID aus `items.js`. */
export function buyItem(career, id) {
  const item = itemFor(id);
  if (!item) return false;
  const have = career.ammo[id] ?? 0;
  if (have >= item.max || career.money < item.cost) return false;
  career.money -= item.cost;
  career.ammo[id] = have + 1;
  return true;
}

/** Kann dieses Item gerade gekauft werden? Für die Shop-Darstellung. */
export const canBuy = (career, id) => {
  const item = itemFor(id);
  return Boolean(item) && (career.ammo[id] ?? 0) < item.max && career.money >= item.cost;
};

/** Rennergebnis in die Karriere übernehmen: Geld, Punkte, Restzustand. */
export function applyResult(career, { place, car }) {
  const prize = prizeFor(place, career.stage);
  career.money += prize;
  career.points += POINTS[place];
  career.hp = Math.max(6, Math.round(car.hp));
  // Verbrauchte Ausrüstung wird nicht nachgefüllt – nachkaufen kostet.
  career.ammo = normalizeAmmo(car.ammo);
  return prize;
}

export { ITEMS };
