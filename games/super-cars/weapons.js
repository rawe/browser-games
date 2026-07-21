// Raketen: Flugbahn, leichte Zielsuche, Treffer-Erkennung. DOM-frei.

const ROCKET_LIFE = 2.6;
const HOMING_RATE = 2.0; // rad/s Kurskorrektur Richtung Ziel

export function fireRocket(rockets, car, dir /* 1 = vorne, -1 = hinten */) {
  const heading = dir === 1 ? car.state.heading : car.state.heading + Math.PI;
  const speed = dir === 1 ? 44 + car.state.v * 0.5 : 36;
  rockets.push({
    x: car.state.x + Math.cos(heading) * 2.2,
    z: car.state.z + Math.sin(heading) * 2.2,
    heading,
    v: speed,
    life: ROCKET_LIFE,
    owner: car.id,
  });
}

// Aktualisiert alle Raketen; liefert Treffer als Events zurück.
export function updateRockets(rockets, cars, isOffTrack, dt, events) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.life -= dt;

    // leichte Zielsuche auf den nächsten Wagen im Kegel voraus
    let best = null;
    let bestD = 22;
    for (const c of cars) {
      if (c.id === r.owner || c.destroyed) continue;
      const dx = c.state.x - r.x;
      const dz = c.state.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        const dot = (dx * Math.cos(r.heading) + dz * Math.sin(r.heading)) / (d || 1);
        if (dot > 0.6) { best = c; bestD = d; }
      }
    }
    if (best) {
      const desired = Math.atan2(best.state.z - r.z, best.state.x - r.x);
      let dAng = desired - r.heading;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      r.heading += Math.max(-HOMING_RATE * dt, Math.min(HOMING_RATE * dt, dAng));
    }

    r.x += Math.cos(r.heading) * r.v * dt;
    r.z += Math.sin(r.heading) * r.v * dt;

    let hit = null;
    for (const c of cars) {
      if (c.id === r.owner || c.destroyed) continue;
      if (Math.hypot(c.state.x - r.x, c.state.z - r.z) < 1.7) { hit = c; break; }
    }

    if (hit) {
      events.push({ type: 'rocketHit', x: r.x, z: r.z, victim: hit.id, owner: r.owner });
      rockets.splice(i, 1);
    } else if (r.life <= 0 || isOffTrack(r.x, r.z)) {
      events.push({ type: 'rocketFizzle', x: r.x, z: r.z });
      rockets.splice(i, 1);
    }
  }
}
