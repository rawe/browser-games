// Meisterschaft: Konto, Tuning-Stufen, Munition, KI-Schwierigkeit.
// Reine Datenlogik ohne DOM.

import { DEFAULT_DIFFICULTY } from './ai.js';

export const MAX_LEVEL = 4;
export const MAX_AMMO = 8;
export const UPGRADE_COSTS = [600, 900, 1300, 1800];
export const AMMO_COSTS = { front: 250, rear: 170 };

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
    ammoFront: 2,
    ammoRear: 1,
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

export function buyAmmo(career, slot) {
  const key = slot === 'rear' ? 'ammoRear' : 'ammoFront';
  const cost = AMMO_COSTS[slot];
  if (career[key] >= MAX_AMMO || career.money < cost) return false;
  career.money -= cost;
  career[key]++;
  return true;
}

/** Rennergebnis in die Karriere übernehmen: Geld, Punkte, Restzustand. */
export function applyResult(career, { place, car }) {
  const prize = prizeFor(place, career.stage);
  career.money += prize;
  career.points += POINTS[place];
  career.hp = Math.max(6, Math.round(car.hp));
  career.ammoFront = car.ammoFront;
  career.ammoRear = car.ammoRear;
  return prize;
}
