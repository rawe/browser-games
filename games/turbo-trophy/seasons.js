// Saisonmodell: welcher Kalender in welcher Saison gefahren wird und wie stark
// die Meisterschaft mit jeder Saison anzieht. Reine Daten und Rechnungen,
// weder DOM noch Spielzustand.
//
// Grundgedanke
// ------------
// Eine gewonnene Saison ist kein Abspann, sondern eine Beförderung: Wagen,
// Ausrüstung und Konto bleiben, die Meisterschaft wird härter. Damit das
// mitgenommene Auto nicht sofort langweilig wird, hebt jede Saison zugleich die
// Ausbaugrenze der Werkstatt (`tuningCap`) – es gibt also weiter etwas zu
// kaufen, während die Gegner nachziehen.
//
// Nach den benannten Saisons geht es endlos weiter: die „Offene Meisterschaft"
// stellt ihren Kalender aus dem Streckenpool zusammen und dreht dabei durch,
// damit sich die Strecken nicht wiederholen. Die Gegnerstärke ist dort am
// Anschlag – ab hier zählt, wie viele Titel man am Stück holt.

import { tracks, trackFor } from './tracks.js';

/** Benannte Saisons. Danach übernimmt die offene Meisterschaft. */
const NAMED = [
  {
    id: 'rookie',
    name: 'ROOKIE-CUP',
    hint: 'Fünf Klassiker – der Einstieg in die Trophy',
    trackIds: ['gruenring', 'hafen-gp', 'serpentin', 'finale', 'achterkreuz'],
  },
  {
    id: 'profi',
    name: 'PROFI-SERIE',
    hint: 'Sechs Läufe, drei neue Kurse – die Gegner haben aufgerüstet',
    trackIds: ['stadtkurs', 'kanalrunde', 'serpentin', 'viadukt', 'achterkreuz', 'vulkanring'],
  },
  {
    id: 'masters',
    name: 'MASTERS-TROPHY',
    hint: 'Sieben Läufe über die anspruchsvollsten Strecken des Pools',
    trackIds: ['stadtkurs', 'kanalrunde', 'serpentin', 'viadukt', 'finale', 'achterkreuz', 'vulkanring'],
  },
];

/** Länge eines Kalenders der offenen Meisterschaft. */
const OPEN_RACES = 6;

/** Ab hier ziehen die Gegner nicht weiter an – der Anschlag der Schwierigkeit. */
export const PEAK_SEASON = 4;

/** Höchste Ausbaustufe, die die Werkstatt je freigibt. */
export const MAX_TUNING_CAP = 8;

/** Ausbaugrenze in der ersten Saison – die bisherige Obergrenze. */
export const BASE_TUNING_CAP = 4;

const byDifficulty = (ids) => ids
  .map(trackFor)
  .filter(Boolean)
  .sort((a, b) => a.aiBonus - b.aiBonus);

/**
 * Kalender einer offenen Meisterschaft. Der Einstiegspunkt wandert mit der
 * Saisonnummer durch den Pool, damit aufeinanderfolgende Saisons nicht
 * dieselben Strecken bringen. Bewusst ohne Zufall: gleiche Saisonnummer,
 * gleicher Kalender – das lässt sich prüfen und erklären.
 */
function openSeason(index) {
  const offset = ((index - NAMED.length) * 3) % tracks.length;
  const ids = [];
  for (let i = 0; i < Math.min(OPEN_RACES, tracks.length); i++) {
    ids.push(tracks[(offset + i) % tracks.length].id);
  }
  return {
    id: `open-${index}`,
    name: `OFFENE MEISTERSCHAFT ${index - NAMED.length + 1}`,
    hint: 'Freier Kalender, Gegner am Anschlag – wie viele Titel hältst du durch?',
    trackIds: ids,
  };
}

/** Saison zu einer Saisonnummer (0 = erste Saison). Immer definiert. */
export function seasonAt(index) {
  const i = Math.max(0, Math.round(index) || 0);
  const def = NAMED[i] ?? openSeason(i);
  return { ...def, index: i, named: i < NAMED.length };
}

/**
 * Saisons, die beim Spielstart zur Wahl stehen: die benannten plus der
 * Einstieg in die offene Meisterschaft. Weiter hinten unterscheiden sich die
 * offenen Saisons nur noch im Kalender – als Einstieg wäre das keine Wahl,
 * sondern eine Liste.
 */
export const startChoices = () =>
  Array.from({ length: NAMED.length + 1 }, (_, i) => seasonAt(i));

/** Die Strecken der Saison in Fahrreihenfolge – aufsteigend nach Gegnertempo. */
export const calendarFor = (index) => byDifficulty(seasonAt(index).trackIds);

/** Zahl der Rennen in dieser Saison. */
export const racesIn = (index) => calendarFor(index).length;

/** Strecke eines Laufs. Rundet über den Kalender, falls `stage` übersteht. */
export function trackAt(index, stage) {
  const calendar = calendarFor(index);
  return calendar[Math.max(0, Math.min(calendar.length - 1, stage))];
}

/* ---------- Wie stark die Saison anzieht ---------- */

/**
 * Zusätzliches Grundtempo der Gegner – oberhalb von `PEAK_SEASON` konstant.
 * Der Wert ist an der Simulation ausgerichtet: Er hält einen starken Fahrer
 * mit mitgenommenem Tuning ungefähr auf der Siegquote der ersten Saison
 * (`npm run sim:turbo -- --check`, Block „Saisonstaffelung").
 */
export const seasonAiBonus = (index = 0) => Math.min(PEAK_SEASON, Math.max(0, index)) * 0.45;

/**
 * Faktor auf die Kurvendisziplin der Gegner (`curveBrake` in `ai.js`) – der
 * wirksamste Hebel der KI: Ein niedrigerer Wert heißt, mehr Tempo mit in die
 * Kurve zu nehmen. Mehr Höchstgeschwindigkeit allein bringt in späten Saisons
 * wenig, weil die Gegner sie auf kurvigen Strecken ohnehin nie erreichen.
 */
export const seasonCurveFactor = (index = 0) =>
  1 - Math.min(PEAK_SEASON, Math.max(0, index)) * 0.05;

/**
 * Preisgeldfaktor. Bewusst flacher als die Preise der späten Ausbaustufen:
 * Wer alles will – volle Ausbaustufe *und* jedes Rennen ein volles Arsenal –
 * soll dafür mehrere Rennen sparen müssen.
 */
export const prizeFactor = (index = 0) => 1 + Math.max(0, index) * 0.3;

/** Ausbaugrenze der Werkstatt – jede Saison gibt eine Stufe mehr frei. */
export const tuningCap = (index = 0) =>
  Math.min(MAX_TUNING_CAP, BASE_TUNING_CAP + Math.max(0, index));

/**
 * Ausrüstungsstand der Gegner. Er hängt am Gesamtfortschritt, nicht nur am
 * Lauf – sonst stünde der Spieler in Saison 3 mit vollem Arsenal wieder
 * Anfängern gegenüber.
 */
export const rivalTier = (index = 0, stage = 0) => Math.max(0, stage) + Math.max(0, index) * 2;

/** Meisterprämie für einen Titel – Startkapital der nächsten Saison. */
export const championBonus = (index = 0) => 2500 + Math.max(0, index) * 1500;

export { NAMED as NAMED_SEASONS };
