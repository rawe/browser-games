// Meisterschaft: Konto, Tuning-Stufen, Ausrüstung, KI-Schwierigkeit.
// Reine Datenlogik ohne DOM.
//
// Eine Karriere läuft über mehrere Saisons (siehe `seasons.js`). `stage` ist
// der Lauf *innerhalb* der laufenden Saison, `season` die Saisonnummer. Beim
// Saisonwechsel bleibt alles Erspielte erhalten – Wagen, Arsenal, Konto – und
// nur der Kalender und die Gegner ziehen an.

import { DEFAULT_DIFFICULTY } from './ai.js';
import { itemFor, normalizeAmmo, startingAmmo } from './items.js';
import { championBonus, prizeFactor, racesIn, tuningCap } from './seasons.js';

/**
 * Ausbaukosten je Stufe. Die ersten vier Stufen sind die der ersten Saison,
 * die weiteren werden mit jeder Saison freigeschaltet (`tuningCap` in
 * `seasons.js`) und kosten deutlich mehr – sonst wäre die Meisterprämie sofort
 * verbaut. Die Liste muss mindestens so lang sein wie `MAX_TUNING_CAP`;
 * `sim/checks.js` prüft das.
 */
export const UPGRADE_COSTS = [600, 900, 1300, 1800, 2600, 3600, 5000, 7000];

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
    // Laufende Saison (0 = erste) und was aus früheren Saisons übrig bleibt.
    season: 0,
    titles: 0,
    totalPoints: 0,
  };
}

/** Offene Ausbaugrenze in der laufenden Saison. */
export const maxLevel = (career) => tuningCap(career?.season ?? 0);

export const upgradeCost = (career, level) =>
  (level >= maxLevel(career) ? null : UPGRADE_COSTS[Math.min(level, UPGRADE_COSTS.length - 1)]);

export const repairCost = (career) => Math.round((100 - career.hp) * 4);

/**
 * Preisgeld: steigt mit jedem Lauf und noch einmal mit jeder Saison – späte
 * Rennen zahlen deutlich besser, weil dort auch alles teurer ist.
 */
export const prizeFor = (place, stage, season = 0) =>
  Math.round((PRIZES[place] * (1 + stage * 0.3) * prizeFactor(season)) / 10) * 10;

/* ---------- Wirkung der Ausbaustufen ---------- */
//
// Bis Stufe 4 gelten unverändert die Werte der ersten Saison. Die in späteren
// Saisons freigeschalteten Stufen bringen bewusst weniger: ein Wagen, der mit
// jeder Stufe gleich viel zulegt, hätte in Saison 3 nichts mehr gegen sich –
// und die Panzerung wäre irgendwann bei „kein Schaden mehr".

/** Stufen, die es schon in der ersten Saison gab. */
const BASE_STEPS = 4;

/** Zuwachs oberhalb der Grundstufen – gedrosselt, damit er nicht davonläuft. */
const beyond = (level) => Math.max(0, level - BASE_STEPS);

/** Höchstgeschwindigkeit des Spielerwagens nach Motorstufe. */
export const playerTopSpeed = (engine) =>
  4.0 + Math.min(BASE_STEPS, engine) * 0.45 + beyond(engine) * 0.2;

/** Beschleunigung des Spielerwagens nach Motorstufe. */
export const playerAccel = (engine) =>
  0.085 + Math.min(BASE_STEPS, engine) * 0.012 + beyond(engine) * 0.006;

/** Lenkrate des Spielerwagens nach Handling-Stufe. */
export const playerTurnRate = (handling) =>
  0.052 + Math.min(BASE_STEPS, handling) * 0.011 + beyond(handling) * 0.005;

/** Anteil des Schadens, der die Panzerung übersteht – nie null. */
export const armorFactor = (armor) =>
  (1 - Math.min(BASE_STEPS, armor) * 0.13) * 0.88 ** beyond(armor);

export function buyRepair(career) {
  const cost = repairCost(career);
  if (cost <= 0 || career.money < cost) return false;
  career.money -= cost;
  career.hp = 100;
  return true;
}

export function buyUpgrade(career, key) {
  const cost = upgradeCost(career, career[key]);
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
  const prize = prizeFor(place, career.stage, career.season);
  career.money += prize;
  career.points += POINTS[place];
  career.totalPoints = (career.totalPoints ?? 0) + POINTS[place];
  career.hp = Math.max(6, Math.round(car.hp));
  // Verbrauchte Ausrüstung wird nicht nachgefüllt – nachkaufen kostet.
  career.ammo = normalizeAmmo(car.ammo);
  return prize;
}

/** War das der letzte Lauf der laufenden Saison? */
export const isFinalStage = (career) => career.stage >= racesIn(career.season) - 1;

/**
 * Saisontitel eintragen und in die nächste Saison wechseln. Alles Erspielte
 * bleibt: Tuning, Arsenal, Konto. Zurückgesetzt wird nur, was zur Saison
 * gehört – Kalenderstand und Meisterschaftspunkte. Dazu gibt es die
 * Meisterprämie als Startkapital.
 *
 * @returns {{ season: number, bonus: number }} Stand nach dem Wechsel.
 */
export function nextSeason(career) {
  const bonus = championBonus(career.season);
  career.titles = (career.titles ?? 0) + 1;
  career.money += bonus;
  career.season = (career.season ?? 0) + 1;
  career.stage = 0;
  career.points = 0;
  return { season: career.season, bonus };
}
