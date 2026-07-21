const KEY_MAP = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

export function bindInput(game) {
  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      if (game.state.gameOver) game.reset();
      return;
    }
    const dir = KEY_MAP[event.key];
    if (dir) {
      event.preventDefault();
      game.setDirection(dir);
    }
  });
}
