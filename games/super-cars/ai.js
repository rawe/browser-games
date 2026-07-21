// KI-Fahrer: folgt der Ideallinie (Mittellinie mit Vorausschau) und bremst vor Kurven. DOM-frei.
import { maxCurvatureAhead } from './trackGeometry.js';

export function createAiDriver(skill) {
  return {
    skill,                 // 0..1 – skaliert Tempo und Präzision
    fireCooldown: 2 + Math.random() * 3,
    wobblePhase: Math.random() * 10,
    lineOffset: (Math.random() - 0.5) * 3.2, // eigene Linie statt Perlenkette
  };
}

// Liefert ein Eingabe-Objekt wie vom Spieler-Input: { throttle, brake, steer, wantFire }
export function aiControl(driver, car, spec, track, progressIndex, dt, rubberband) {
  const { samples, count } = track;

  // Zielpunkt: Vorausschau wächst mit Tempo
  const lookahead = 7 + car.v * 0.45;
  let idx = progressIndex;
  let acc = 0;
  while (acc < lookahead) {
    const next = (idx + 1) % count;
    acc += ((samples[next].s - samples[idx].s) + track.length) % track.length;
    idx = next;
  }
  const target = samples[idx];

  // leichte Linienvariation, damit die Fahrer nicht wie an der Schnur fahren
  driver.wobblePhase += dt * 0.6;
  const wobble = Math.sin(driver.wobblePhase) * (1 - driver.skill) * 2.2 + (driver.lineOffset ?? 0);
  const tx = target.x + target.nx * wobble;
  const tz = target.z + target.nz * wobble;

  let desired = Math.atan2(tz - car.z, tx - car.x);
  let dAng = desired - car.heading;
  while (dAng > Math.PI) dAng -= 2 * Math.PI;
  while (dAng < -Math.PI) dAng += 2 * Math.PI;
  const steer = Math.max(-1, Math.min(1, dAng * 2.5));

  // Kurventempo: v² · κ begrenzen
  const curv = Math.max(0.004, maxCurvatureAhead(track, progressIndex, 16 + car.v * 0.9));
  const latGrip = 26 + driver.skill * 14;
  let vTarget = Math.min(spec.vmax, Math.sqrt(latGrip / curv));
  vTarget *= (0.82 + driver.skill * 0.18) * rubberband;

  let throttle = 0;
  let brake = 0;
  if (car.v < vTarget - 0.5) throttle = 1;
  else if (car.v > vTarget + 1.5) brake = 0.8;

  driver.fireCooldown -= dt;
  const wantFire = driver.fireCooldown <= 0;
  if (wantFire) driver.fireCooldown = 4 + Math.random() * 5;

  return { throttle, brake, steer, wantFire };
}

// Prüft, ob ein Ziel grob vor (dir=1) bzw. hinter (dir=-1) dem Wagen liegt.
export function targetInCone(car, other, dir, maxDist) {
  const dx = other.x - car.x;
  const dz = other.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist > maxDist || dist < 1) return false;
  const fx = Math.cos(car.heading) * dir;
  const fz = Math.sin(car.heading) * dir;
  const dot = (dx * fx + dz * fz) / dist;
  return dot > 0.85;
}
