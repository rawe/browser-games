import Matter from 'matter-js';

const { Bodies, Body, Composite } = Matter;

function bodyFor(definition) {
  const center = centerAt(definition, definition.restAngle);
  const body = Bodies.rectangle(center.x, center.y, definition.length, definition.width, {
    isStatic: true,
    angle: definition.restAngle,
    chamfer: { radius: definition.width / 2 },
    friction: 0.12,
    restitution: 0.15,
    label: definition.id,
  });
  body.plugin.pinball = { type: 'flipper', id: definition.id, side: definition.side };
  return body;
}

function centerAt(definition, angle) {
  return {
    x: definition.pivotX + Math.cos(angle) * definition.length * 0.5,
    y: definition.pivotY + Math.sin(angle) * definition.length * 0.5,
  };
}

export function createFlippers(world, definitions) {
  const controls = { left: false, right: false };
  const flippers = definitions.map((definition) => ({
    definition,
    body: bodyFor(definition),
    angle: definition.restAngle,
  }));
  Composite.add(world, flippers.map((flipper) => flipper.body));

  function update(dt) {
    for (const flipper of flippers) {
      const { definition, body } = flipper;
      const target = controls[definition.side] ? definition.activeAngle : definition.restAngle;
      const speed = controls[definition.side] ? 13.5 : 8.5;
      const delta = Math.max(-speed * dt, Math.min(speed * dt, target - flipper.angle));
      flipper.angle += delta;
      const center = centerAt(definition, flipper.angle);
      // updateVelocity sorgt dafür, dass die kinematische Schlagbewegung ihren
      // Impuls an die dynamische Kugel weitergibt.
      Body.setPosition(body, center, true);
      Body.setAngle(body, flipper.angle, true);
    }
  }

  return {
    controls,
    list: flippers,
    set(side, active) { if (side in controls) controls[side] = Boolean(active); },
    releaseAll() { controls.left = false; controls.right = false; },
    update,
  };
}
