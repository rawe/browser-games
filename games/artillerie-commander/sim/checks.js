import assert from 'node:assert/strict';
import {
  WORLD, WEAPONS, terrainFor, surfaceAt, crater, makePlayers, placePlayers,
  predictImpact, damageAt, chooseAiShot, tankAt, boundaryHit, previewPath,
} from '../game.js';

const a = terrainFor(42), b = terrainFor(42);
assert.deepEqual(a, b, 'Gelände muss für denselben Seed reproduzierbar sein');
assert.equal(a.length, WORLD.width);
assert.ok([...a].every((y) => y > WORLD.hud && y <= WORLD.height));
const before = surfaceAt(a, 400); crater(a, 400, before, 30); assert.ok(surfaceAt(a, 400) > before, 'Krater entfernt Gelände');
crater(a, 400, surfaceAt(a, 400), 30, true); assert.ok(surfaceAt(a, 400) < WORLD.height, 'Erdformer erzeugt Gelände');
const players = makePlayers(4, 2); placePlayers(players, b); assert.equal(players.filter((p) => p.human).length, 2);
assert.ok(players.every((p) => p.y === surfaceAt(b, p.x) - 9));
const shot = predictImpact(players[0], b, 0); assert.ok(Number.isFinite(shot.x) && Number.isFinite(shot.y));
const victim = players[1]; const oldHp = victim.hp; damageAt(players, victim.x, victim.y, WEAPONS[1], players[0]); assert.ok(victim.hp < oldHp);
chooseAiShot(players[2], players, b, 12); assert.ok(players[2].angle >= 5 && players[2].angle <= 85); assert.ok(players[2].power >= 100 && players[2].power <= 900);
assert.equal(new Set(WEAPONS.map((w) => w.id)).size, WEAPONS.length, 'Waffen-IDs sind eindeutig');
assert.equal(tankAt(players, players[1].x, players[1].y, players[0]), players[1], 'Panzer besitzt eine Trefferfläche oberhalb des Bodens');
assert.equal(tankAt(players, players[0].x, players[0].y, players[0], 0.05), null, 'Schütze wird beim Verlassen des Laufs kurz ignoriert');
assert.equal(boundaryHit({ x: -1, y: 200, vx: -20, vy: 10 }, 'open').action, 'leave');
assert.equal(boundaryHit({ x: 961, y: 200, vx: 20, vy: 10 }, 'solid').action, 'explode');
const reflected = { x: -1, y: 200, vx: -20, vy: 10 };
assert.equal(boundaryHit(reflected, 'mirror').action, 'bounce'); assert.equal(reflected.vx, 20, 'Spiegelwand kehrt die horizontale Geschwindigkeit um');
const guide = previewPath(players[0], b, 12, 'solid'); assert.ok(guide.length > 4 && guide.length <= 87, 'Zielhilfe zeigt nur einen begrenzten Flugabschnitt');
console.log('✓ Artillerie Commander: Terrain, Hitboxen, Wände, Ballistik, Zielhilfe und KI geprüft');
