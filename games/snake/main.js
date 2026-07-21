import { createGame } from './game.js';
import { bindInput } from './input.js';
import { render } from './render.js';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');
const ctx = canvas.getContext('2d');

const game = createGame({ cols: 24, rows: 24 });
bindInput(game);

const TICK_MS = 110;
let last = 0;

function loop(time) {
  if (time - last >= TICK_MS) {
    last = time;
    game.tick();
    scoreEl.textContent = game.state.score;
  }
  render(ctx, canvas, game.state);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
