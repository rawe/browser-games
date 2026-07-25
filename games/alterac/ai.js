// Computergegner: wählt anhand der eingestellten Stärke den passenden Planer.
// Die Stärke steht als `config.aiLevel` in den Partie-Einstellungen (im Setup
// wählbar, sobald gegen den Computer gespielt wird).
//
// Ein Planer bekommt `(config, map, faction, rng)` und liefert die Pläne im
// selben Format wie die Planungsphase des Spielers:
//   { type, actions: [{ path, stance, trigger }, …] }  – oder das Altformat
//   { type, path, stance }, das die Simulation transparent normalisiert.

import { planEasy } from './ai-easy.js';
import { planHard } from './ai-hard.js';

// Auswahlliste für das Setup (datengetrieben – neue Stufen nur hier ergänzen).
export const AI_LEVELS = [
  {
    key: 'easy',
    label: 'Leicht',
    desc: 'Zufällig gemischte Armee, grobe Marschbefehle, keine Abstimmung zwischen den Trupps.',
    plan: planEasy,
  },
  {
    key: 'hard',
    label: 'Schwer',
    desc:
      'Wirbt die kampfstärkste Armee an, hält mit einer eingegrabenen Wache den eigenen ' +
      'Boss-Schild und räumt die gegnerischen Türme konzentriert nacheinander, bevor er den Boss ' +
      'stürmt. Taugt der Schild wenig, geht er stattdessen sofort auf den Fürsten los.',
    plan: planHard,
  },
];

export const DEFAULT_AI_LEVEL = AI_LEVELS[0].key;

const BY_KEY = Object.fromEntries(AI_LEVELS.map((l) => [l.key, l]));

export function aiPlan(config, map, faction, rng = Math.random, level = config?.aiLevel) {
  const entry = BY_KEY[level] ?? BY_KEY[DEFAULT_AI_LEVEL];
  return entry.plan(config, map, faction, rng);
}
