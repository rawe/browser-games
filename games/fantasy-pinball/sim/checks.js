import assert from 'node:assert/strict';
import { createAdventureBridge } from '../adventure.js';
import { createBoard, BOARD_ANIMATION_MS } from '../board.js';
import { BOARD_DEFINITION, validateBoardDefinition } from '../board-definition.js';
import { createGameState, GAME_STATUS } from '../game-state.js';
import { createPinballGame } from '../game.js';
import { createScoring } from '../scoring.js';

const validation = validateBoardDefinition();
assert.equal(validation.valid, true, 'Alle Board-IDs sind eindeutig und ein Drain existiert');
assert.ok(BOARD_DEFINITION.elements.filter((element) => element.type === 'bumper').length >= 4);
assert.ok(BOARD_DEFINITION.elements.some((element) => element.role === 'ramp'), 'Ein alternativer Rampenweg ist definiert');

const board = createBoard(BOARD_DEFINITION);
assert.equal(board.get('arcane-bumper').active, false, 'Der Demo-Bumper beginnt inaktiv');
assert.equal(board.activate('arcane-bumper', { animate: true, now: 100 }), true);
board.update(100 + BOARD_ANIMATION_MS / 2);
assert.ok(board.get('arcane-bumper').presentation.scale > 0.4, 'Aktivierung animiert die Darstellung');
board.update(100 + BOARD_ANIMATION_MS);
assert.equal(board.get('arcane-bumper').presentation.scale, 1);

const adventure = createAdventureBridge();
assert.deepEqual(adventure.handle({ type: 'targetHit', elementId: 'shield-target' }), []);
const commands = adventure.handle({ type: 'targetHit', elementId: 'rune-target' });
assert.equal(commands[0].type, 'activate');
assert.equal(commands[0].elementId, 'arcane-bumper');
assert.deepEqual(adventure.handle({ type: 'targetHit', elementId: 'rune-target' }), [], 'Demo-Umbau löst nur einmal aus');

const scoring = createScoring();
assert.equal(scoring.apply({ type: 'bumperHit' }), 100);
assert.equal(scoring.apply({ type: 'targetHit', points: 375 }), 375);
assert.equal(scoring.state.score, 475);
scoring.reset();
assert.equal(scoring.state.score, 0);

const balls = createGameState(3);
balls.start();
assert.equal(balls.drain(1000, 500), true);
assert.equal(balls.state.status, GAME_STATUS.DRAINING);
assert.equal(balls.update(1499), false);
assert.equal(balls.update(1500), true);
assert.equal(balls.state.ball, 2);
balls.drain(2000, 0);
balls.update(2000);
balls.drain(3000, 0);
assert.equal(balls.state.status, GAME_STATUS.GAME_OVER);

const game = createPinballGame();
game.start();
const startY = game.physics.ball.position.y;
game.setFlipper('left', true);
game.setFlipper('right', true);
for (let i = 0; i < 36; i += 1) game.step(1000 / 240);
assert.ok(game.physics.ball.position.y < startY, 'Der automatische Abschuss bewegt die Kugel nach oben');
assert.ok(game.physics.flippers.list[0].angle < BOARD_DEFINITION.flippers[0].restAngle);
assert.ok(game.physics.flippers.list[1].angle > BOARD_DEFINITION.flippers[1].restAngle);
assert.ok(Number.isFinite(game.physics.ball.position.x) && Number.isFinite(game.physics.ball.velocity.y));

const arcaneBody = game.physics.bodyByElement.get('arcane-bumper');
assert.equal(arcaneBody.collisionFilter.mask, 0, 'Inaktive Laufzeitelemente kollidieren nicht');
game.dispatch({ type: 'targetHit', elementId: 'rune-target', points: 300 }, 1000);
assert.notEqual(arcaneBody.collisionFilter.mask, 0, 'Aktivierte Laufzeitelemente werden physisch wirksam');
assert.equal(game.board.get('arcane-bumper').active, true, 'Quest-Ereignis aktiviert den Demo-Bumper im Gesamtsystem');
assert.equal(game.scoring.state.score, 1050, 'Target und Tischumbau werden beide gewertet');
game.dispose();

console.log('✓ Fantasy Pinball: Board-Lebenszyklus, Quest-Brücke, Score, Kugeln und Physik geprüft');
