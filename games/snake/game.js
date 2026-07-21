// Reine Spiellogik – kein DOM, dadurch leicht testbar.
export function createGame({ cols, rows }) {
  const state = {
    cols,
    rows,
    snake: [],
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    food: null,
    score: 0,
    gameOver: false,
  };

  function reset() {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    state.snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    state.direction = { x: 1, y: 0 };
    state.nextDirection = { x: 1, y: 0 };
    state.score = 0;
    state.gameOver = false;
    spawnFood();
  }

  function spawnFood() {
    do {
      state.food = {
        x: Math.floor(Math.random() * cols),
        y: Math.floor(Math.random() * rows),
      };
    } while (state.snake.some((s) => s.x === state.food.x && s.y === state.food.y));
  }

  function setDirection(dir) {
    // Kein direktes Umkehren in den eigenen Körper.
    if (dir.x === -state.direction.x && dir.y === -state.direction.y) return;
    state.nextDirection = dir;
  }

  function tick() {
    if (state.gameOver) return;
    state.direction = state.nextDirection;

    const head = {
      x: (state.snake[0].x + state.direction.x + cols) % cols,
      y: (state.snake[0].y + state.direction.y + rows) % rows,
    };

    if (state.snake.some((s) => s.x === head.x && s.y === head.y)) {
      state.gameOver = true;
      return;
    }

    state.snake.unshift(head);

    if (head.x === state.food.x && head.y === state.food.y) {
      state.score += 10;
      spawnFood();
    } else {
      state.snake.pop();
    }
  }

  reset();
  return { state, tick, setDirection, reset };
}
