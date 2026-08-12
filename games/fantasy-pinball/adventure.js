// Schmale Brücke für spätere Campaign-/Quest-Systeme. Sie kennt weder Matter
// noch Canvas: Spielereignisse hinein, deklarative Tischbefehle hinaus.

export const ADVENTURE_EXTENSION_POINTS = Object.freeze({
  campaign: ['tutorial', 'chapter-start', 'chapter-complete', 'direct-start'],
  quests: ['target-sequence', 'reach-area', 'defeat-enemy', 'optional-timer'],
  boardCommands: ['activate', 'deactivate', 'remove', 'patch', 'animate'],
  npc: ['show', 'hide', 'react', 'speak'],
  unlocks: ['extra-ball-challenge', 'permanent-mechanic'],
});

export function createAdventureBridge() {
  const state = {
    chapterId: 'prototype',
    scoringScope: 'full-run',
    demoQuestComplete: false,
    unlockedMechanics: new Set(),
  };

  return {
    state,
    handle(event) {
      if (event.type !== 'targetHit'
        || event.elementId !== 'rune-target'
        || state.demoQuestComplete) return [];
      state.demoQuestComplete = true;
      return [
        { type: 'activate', elementId: 'arcane-bumper', animate: true },
        {
          type: 'emit',
          event: {
            type: 'boardChanged',
            elementId: 'arcane-bumper',
            points: 750,
            message: 'Runenmagie: Arkan-Bumper erweckt!',
          },
        },
      ];
    },
    reset() {
      state.chapterId = 'prototype';
      state.scoringScope = 'full-run';
      state.demoQuestComplete = false;
      state.unlockedMechanics.clear();
    },
  };
}
