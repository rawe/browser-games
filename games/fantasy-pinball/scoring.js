const DEFAULT_POINTS = Object.freeze({
  bumperHit: 100,
  targetHit: 200,
  rampEntered: 500,
  boardChanged: 750,
});

export function createScoring() {
  const state = { score: 0, lastDelta: 0, lastReason: '' };

  return {
    state,
    apply(event) {
      const delta = Number.isFinite(event.points)
        ? event.points
        : (DEFAULT_POINTS[event.type] ?? 0);
      if (delta <= 0) return 0;
      state.score += delta;
      state.lastDelta = delta;
      state.lastReason = event.type;
      return delta;
    },
    reset() {
      state.score = 0;
      state.lastDelta = 0;
      state.lastReason = '';
    },
  };
}

export { DEFAULT_POINTS };
