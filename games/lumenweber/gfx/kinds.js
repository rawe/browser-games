// Bildelemente des Sprite-Shaders.
//
// Jede Art ist ein gedrehter Einheitsquad; der Fragment-Shader entscheidet
// anhand dieser Nummer, welche Form er hineinrechnet. Die Konstanten liegen
// hier und nicht im Shader-Text, damit JavaScript und GLSL sie sich teilen und
// nicht auseinanderlaufen können.
//
// Die ersten sechs Arten werden deckend gezeichnet (Alpha-Mischung), die
// übrigen additiv obendrauf – Licht addiert sich, Materie nicht.

export const KIND = {
  WALL: 0,
  TARGET: 1,
  MIRROR: 2,
  SOURCE: 3,
  CURSOR: 4,
  BEZEL: 5,

  TARGET_GLOW: 6,
  MIRROR_GLINT: 7,
  SOURCE_CORONA: 8,
  RING: 9,
  SPARK: 10,
  HALO: 11,
};
