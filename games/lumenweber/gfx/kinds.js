// Bildelemente des Sprite-Shaders.
//
// Jede Art ist ein gedrehter Einheitsquad; der Fragment-Shader entscheidet
// anhand dieser Nummer, welche Form er hineinrechnet. Die Konstanten liegen
// hier und nicht im Shader-Text, damit JavaScript und GLSL sie sich teilen und
// nicht auseinanderlaufen können.
//
// Alles unterhalb von `TARGET_GLOW` wird deckend gezeichnet (Alpha-Mischung),
// alles ab dort additiv obendrauf – Licht addiert sich, Materie nicht. Eine
// neue Materie-Art gehört deshalb **vor** `TARGET_GLOW`, eine neue Lichtart
// dahinter. Der Shader liest die Grenze aus diesen Zahlen; sie verschiebt sich
// also von selbst mit.

export const KIND = {
  WALL: 0,
  TARGET: 1,
  MIRROR: 2,
  PRISM: 3,
  SOCKET: 4,
  SOURCE: 5,
  CURSOR: 6,
  BEZEL: 7,

  TARGET_GLOW: 8,
  MIRROR_GLINT: 9,
  PRISM_GLINT: 10,
  SOURCE_CORONA: 11,
  RING: 12,
  SPARK: 13,
  HALO: 14,
};
