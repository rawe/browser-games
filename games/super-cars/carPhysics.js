// Arcade-Fahrphysik im Stil von Super Sprint / Super Cars. DOM-frei.

// Fahrzeugwerte aus Ausbaustufen ableiten (Motor/Handling aus dem Shop).
export function carSpec(motorLevel, handlingLevel) {
  return {
    vmax: 30 + motorLevel * 3.5,        // m/s
    accel: 15 + motorLevel * 2.2,       // m/s²
    brake: 34,
    turnRate: 2.35 + handlingLevel * 0.22, // rad/s bei voller Wirkung
    gripSpeed: 14,                      // ab hier volle Lenkwirkung
  };
}

export function createCarState(x, z, heading) {
  return { x, z, heading, v: 0 };
}

// input: { throttle 0..1, brake 0..1, steer -1..1 } · surface: 'road' | 'grass'
export function stepCar(car, input, spec, surface, dt) {
  const offRoad = surface === 'grass';
  const vmax = offRoad ? spec.vmax * 0.42 : spec.vmax;
  const accel = offRoad ? spec.accel * 0.55 : spec.accel;

  const drag = car.v * (offRoad ? 0.9 : 0.35);
  let a = input.throttle * accel - drag - input.brake * spec.brake;
  car.v += a * dt;
  if (car.v > vmax) car.v += (vmax - car.v) * Math.min(1, dt * 3); // sanft kappen
  if (car.v < 0) car.v = 0;

  // Lenkwirkung wächst mit der Geschwindigkeit bis gripSpeed, fällt bei hohem Tempo leicht ab
  const speedFactor = Math.min(1, car.v / spec.gripSpeed) * (1 - 0.18 * Math.min(1, car.v / spec.vmax));
  car.heading += input.steer * spec.turnRate * speedFactor * dt;

  car.x += Math.cos(car.heading) * car.v * dt;
  car.z += Math.sin(car.heading) * car.v * dt;
}

export function forwardX(car) { return Math.cos(car.heading); }
export function forwardZ(car) { return Math.sin(car.heading); }
