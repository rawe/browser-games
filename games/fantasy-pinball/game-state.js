export const GAME_STATUS = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  DRAINING: 'draining',
  GAME_OVER: 'game-over',
});

export function createGameState(totalBalls = 3) {
  const state = {
    totalBalls,
    ball: 1,
    status: GAME_STATUS.READY,
    respawnAt: 0,
  };

  return {
    state,
    start() {
      state.ball = 1;
      state.status = GAME_STATUS.PLAYING;
      state.respawnAt = 0;
    },
    drain(now, delayMs = 900) {
      if (state.status !== GAME_STATUS.PLAYING) return false;
      if (state.ball >= state.totalBalls) {
        state.status = GAME_STATUS.GAME_OVER;
      } else {
        state.status = GAME_STATUS.DRAINING;
        state.respawnAt = now + delayMs;
      }
      return true;
    },
    update(now) {
      if (state.status !== GAME_STATUS.DRAINING || now < state.respawnAt) return false;
      state.ball += 1;
      state.status = GAME_STATUS.PLAYING;
      state.respawnAt = 0;
      return true;
    },
    reset() {
      state.ball = 1;
      state.status = GAME_STATUS.READY;
      state.respawnAt = 0;
    },
  };
}
