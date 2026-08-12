import Matter from 'matter-js';
import { createFlippers } from './flippers.js';

const { Bodies, Body, Composite, Engine, Events } = Matter;
const MAX_BALL_SPEED = 31;
const NO_EVENTS = Object.freeze([]);

function segmentBody(element) {
  const dx = element.bx - element.ax;
  const dy = element.by - element.ay;
  return Bodies.rectangle(
    (element.ax + element.bx) / 2,
    (element.ay + element.by) / 2,
    Math.hypot(dx, dy),
    element.thickness,
    {
      isStatic: true,
      angle: Math.atan2(dy, dx),
      friction: element.role === 'ramp' ? 0.01 : 0.08,
      restitution: element.role === 'ramp' ? 0.45 : 0.34,
      chamfer: { radius: Math.min(element.thickness / 2, 8) },
      label: element.id,
    },
  );
}

function elementBody(element) {
  let body = null;
  if (element.type === 'segment') body = segmentBody(element);
  if (element.type === 'bumper' || element.type === 'post') {
    body = Bodies.circle(element.x, element.y, element.radius, {
      isStatic: true,
      restitution: element.type === 'bumper' ? 0.95 : 0.55,
      friction: 0.02,
      label: element.id,
    });
  }
  if (element.type === 'target' || element.type === 'gate') {
    body = Bodies.rectangle(element.x, element.y, element.width, element.height, {
      isStatic: true,
      angle: element.angle ?? 0,
      restitution: 0.42,
      friction: 0.04,
      chamfer: { radius: Math.min(element.width, element.height) * 0.25 },
      label: element.id,
    });
  }
  if (element.type === 'drain') {
    body = Bodies.rectangle(element.x, element.y, element.width, element.height, {
      isStatic: true,
      isSensor: true,
      label: element.id,
    });
  }
  if (!body) return null;
  body.plugin.pinball = {
    type: element.type,
    id: element.id,
    points: element.points,
    kick: element.kick,
  };
  if (!element.active) body.collisionFilter.mask = 0;
  return body;
}

export function createPhysics(board) {
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1;
  engine.gravity.scale = 0.00135;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  engine.constraintIterations = 4;

  const bodyByElement = new Map();
  const events = [];
  const hitAt = new Map();
  let ball = null;

  function addElement(element) {
    const body = elementBody(element);
    if (!body) return;
    bodyByElement.set(element.id, body);
    Composite.add(engine.world, body);
  }

  board.list().forEach(addElement);
  const flippers = createFlippers(engine.world, board.flippers);

  function spawnBall() {
    if (ball) Composite.remove(engine.world, ball);
    const definition = board.ball;
    ball = Bodies.circle(definition.spawnX, definition.spawnY, definition.radius, {
      restitution: 0.48,
      friction: 0.015,
      frictionAir: 0.00075,
      density: 0.0032,
      slop: 0.02,
      label: 'ball',
    });
    ball.plugin.pinball = { type: 'ball', id: 'ball' };
    Composite.add(engine.world, ball);
    Body.setVelocity(ball, definition.launchVelocity);
    events.push({ type: 'ballLaunched' });
    return ball;
  }

  function removeBall() {
    if (!ball) return;
    Composite.remove(engine.world, ball);
    ball = null;
  }

  function pinballData(pair) {
    const a = pair.bodyA.plugin.pinball;
    const b = pair.bodyB.plugin.pinball;
    if (a?.type === 'ball') return { ballBody: pair.bodyA, elementBody: pair.bodyB, element: b };
    if (b?.type === 'ball') return { ballBody: pair.bodyB, elementBody: pair.bodyA, element: a };
    return null;
  }

  Events.on(engine, 'collisionStart', (collision) => {
    const now = engine.timing.timestamp;
    for (const pair of collision.pairs) {
      const hit = pinballData(pair);
      if (!hit?.element) continue;
      const element = hit.element;
      if (element.type === 'drain') {
        events.push({ type: 'ballDrained' });
        continue;
      }
      if (!['bumper', 'target', 'gate'].includes(element.type)) continue;
      if (now - (hitAt.get(element.id) ?? -Infinity) < 110) continue;
      hitAt.set(element.id, now);

      if (element.type === 'bumper') {
        const dx = hit.ballBody.position.x - hit.elementBody.position.x;
        const dy = hit.ballBody.position.y - hit.elementBody.position.y;
        const length = Math.hypot(dx, dy) || 1;
        Body.setVelocity(hit.ballBody, {
          x: hit.ballBody.velocity.x + dx / length * element.kick,
          y: hit.ballBody.velocity.y + dy / length * element.kick,
        });
        events.push({ type: 'bumperHit', elementId: element.id, points: element.points });
      } else if (element.type === 'target') {
        events.push({ type: 'targetHit', elementId: element.id, points: element.points });
      } else {
        events.push({ type: 'rampEntered', elementId: element.id, points: element.points });
      }
    }
  });

  const unsubscribe = board.subscribe((change) => {
    if (change.type === 'added') addElement(change.element);
    if (change.type === 'removed') {
      const body = bodyByElement.get(change.element.id);
      if (body) Composite.remove(engine.world, body);
      bodyByElement.delete(change.element.id);
    }
    if (change.type === 'activated' || change.type === 'deactivated') {
      const body = bodyByElement.get(change.element.id);
      if (body) body.collisionFilter.mask = change.element.active ? 0xFFFFFFFF : 0;
    }
    if (change.type === 'reset') {
      for (const body of bodyByElement.values()) Composite.remove(engine.world, body);
      bodyByElement.clear();
      hitAt.clear();
      change.elements.forEach(addElement);
    }
  });

  function step(dtMs) {
    flippers.update(dtMs / 1000);
    Engine.update(engine, dtMs);
    if (!ball) return;
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    if (speed > MAX_BALL_SPEED) {
      Body.setVelocity(ball, {
        x: ball.velocity.x / speed * MAX_BALL_SPEED,
        y: ball.velocity.y / speed * MAX_BALL_SPEED,
      });
    }
    // Falls ein Browser-Tab beim Drain pausiert, bleibt keine verlorene Kugel
    // ewig außerhalb des Sensorkolliders.
    if (ball.position.y > 1010) events.push({ type: 'ballDrained' });
  }

  return {
    engine,
    flippers,
    bodyByElement,
    get ball() { return ball; },
    spawnBall,
    removeBall,
    step,
    drainEvents() { return events.length ? events.splice(0, events.length) : NO_EVENTS; },
    nudge(x, y = 0) {
      if (!ball) return;
      Body.applyForce(ball, ball.position, { x: x * 0.00035, y: y * 0.0002 });
    },
    dispose() { unsubscribe(); Composite.clear(engine.world, false); Engine.clear(engine); },
  };
}

export { MAX_BALL_SPEED };
