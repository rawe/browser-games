import { createAudio } from './audio.js';
import { GAME_STATUS } from './game-state.js';
import { createPinballGame } from './game.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';

const app = document.getElementById('app');
const canvas = document.getElementById('game');
const scoreNode = document.getElementById('score');
const ballNode = document.getElementById('ball-count');
const messageNode = document.getElementById('message');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const startButton = document.getElementById('start-button');

const game = createPinballGame();
const audio = createAudio();
const renderer = createRenderer(canvas, game.board, game.physics);
let running = false;
let messageUntil = 0;
let lastScore = -1;
let lastBall = -1;

function showOverlay(title, text, buttonLabel) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startButton.textContent = buttonLabel;
  overlay.classList.add('visible');
  input.releaseAll();
}

function hideOverlay() {
  overlay.classList.remove('visible');
}

function startGame(options = {}) {
  if (!options.silent) audio.unlock();
  game.start();
  running = true;
  messageNode.textContent = 'Triff die violette Rune.';
  messageUntil = performance.now() + 3500;
  hideOverlay();
}

const input = createInput(app, {
  onFlipper(side, active) {
    game.setFlipper(side, active);
    if (active && running) audio.flipper();
  },
  onInteraction() { audio.unlock(); },
  onRestart() { startGame(); },
  onNudge(x, y) { game.nudge(x, y); },
});

startButton.addEventListener('click', startGame);
window.addEventListener('resize', renderer.resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.releaseAll();
});

if (new URLSearchParams(location.search).has('demo')) startGame({ silent: true });

function handleEvent(event, now) {
  audio.handle(event);
  renderer.pulse(event.elementId, now);
  if (event.type === 'boardChanged') {
    messageNode.textContent = event.message;
    messageUntil = now + 3000;
  }
  if (event.type === 'ballDrained' && game.gameState.state.status !== GAME_STATUS.GAME_OVER) {
    messageNode.textContent = 'Die nächste Kugel wird beschworen …';
    messageUntil = now + 1000;
  }
  if (event.type === 'ballDrained' && game.gameState.state.status === GAME_STATUS.GAME_OVER) {
    running = false;
    showOverlay('Durchgang beendet', `Dein Ergebnis: ${game.scoring.state.score.toLocaleString('de-DE')} Punkte.`, 'Noch einmal');
  }
}

const STEP_MS = 1000 / 240;
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(50, now - lastTime);
  lastTime = now;
  if (running) {
    accumulator += elapsed;
    while (accumulator >= STEP_MS) {
      game.step(STEP_MS);
      accumulator -= STEP_MS;
    }
    game.update(now);
    for (const event of game.drainEvents()) handleEvent(event, now);
  }

  if (lastScore !== game.scoring.state.score) {
    lastScore = game.scoring.state.score;
    scoreNode.textContent = lastScore.toLocaleString('de-DE');
  }
  if (lastBall !== game.gameState.state.ball) {
    lastBall = game.gameState.state.ball;
    ballNode.textContent = `${lastBall}/${game.gameState.state.totalBalls}`;
  }
  if (messageUntil && now > messageUntil) {
    messageNode.textContent = '';
    messageUntil = 0;
  }
  renderer.frame(now);
}

requestAnimationFrame(frame);
