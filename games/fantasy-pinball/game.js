import { createAdventureBridge } from './adventure.js';
import { createBoard } from './board.js';
import { BOARD_DEFINITION } from './board-definition.js';
import { createGameState, GAME_STATUS } from './game-state.js';
import { createPhysics } from './physics.js';
import { createScoring } from './scoring.js';

const NO_EVENTS = Object.freeze([]);

export function createPinballGame(definition = BOARD_DEFINITION) {
  const board = createBoard(definition);
  const physics = createPhysics(board);
  const gameState = createGameState(3);
  const scoring = createScoring();
  const adventure = createAdventureBridge();
  const events = [];

  function emit(event) {
    scoring.apply(event);
    events.push(event);
  }

  function applyCommand(command, now) {
    if (command.type === 'activate') {
      board.activate(command.elementId, { animate: command.animate, now });
    } else if (command.type === 'deactivate') {
      board.deactivate(command.elementId);
    } else if (command.type === 'remove') {
      board.remove(command.elementId);
    } else if (command.type === 'patch') {
      board.patch(command.elementId, command.changes);
    } else if (command.type === 'emit') {
      emit(command.event);
    }
  }

  function handlePhysicsEvent(event, now) {
    if (event.type === 'ballDrained') {
      if (!gameState.drain(now)) return;
      physics.removeBall();
      emit(event);
      return;
    }
    emit(event);
    for (const command of adventure.handle(event)) applyCommand(command, now);
  }

  function start() {
    events.length = 0;
    physics.drainEvents();
    scoring.reset();
    adventure.reset();
    board.reset();
    gameState.start();
    physics.spawnBall();
    emit({ type: 'gameStarted' });
  }

  function update(now) {
    board.update(now);
    for (const event of physics.drainEvents()) handlePhysicsEvent(event, now);
    if (gameState.update(now)) physics.spawnBall();
  }

  function step(dtMs) {
    if (gameState.state.status === GAME_STATUS.PLAYING) physics.step(dtMs);
  }

  return {
    board,
    physics,
    gameState,
    scoring,
    adventure,
    start,
    step,
    update,
    dispatch(event, now = 0) { handlePhysicsEvent(event, now); },
    setFlipper(side, active) { physics.flippers.set(side, active); },
    nudge(x, y) { physics.nudge(x, y); },
    drainEvents() { return events.length ? events.splice(0, events.length) : NO_EVENTS; },
    dispose() { physics.dispose(); },
  };
}
