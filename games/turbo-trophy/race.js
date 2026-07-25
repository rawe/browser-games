// Rennsimulation: Fahrphysik, KI, Raketen, Kollisionen, Rundenzählung.
// Läuft in festen 60-Hz-Schritten und kennt weder DOM noch Audio – hörbare
// Ereignisse landen in `race.events` und werden außerhalb übersetzt.

import { buildTrack, posAt, project, ROAD_WIDTH, WORLD } from './trackGeometry.js';

export const PLAYER_COLOR = '#ff4f7b';

const RIVALS = [
  { name: 'BLAU', color: '#54d6ff' },
  { name: 'GELB', color: '#ffd23f' },
  { name: 'LILA', color: '#9d6bff' },
];

const COUNTDOWN_TICKS = 210;   // 3,5 Sekunden Ampelphase
const FINISH_DELAY = 110;      // Nachlauf, nachdem der Spieler das Ziel passiert hat
const RESPAWN_TICKS = 160;
const INVULN_TICKS = 130;
const CAR_RADIUS = 13;
const MISSILE_HIT_RADIUS = 20;

export function createRace(trackDef, career) {
  const track = buildTrack(trackDef);
  const cars = [];

  // Startaufstellung: versetzt hintereinander, links/rechts der Ideallinie.
  const makeCar = (gridIndex, props) => {
    const s = track.total - (46 + gridIndex * 52);
    const p = posAt(track, s);
    const side = (gridIndex % 2 === 0 ? 1 : -1) * 21;
    return {
      x: p.x - Math.sin(p.angle) * side,
      y: p.y + Math.cos(p.angle) * side,
      angle: p.angle,
      seg: p.seg,
      s,
      speed: 0,
      lap: 0,
      progress: 0,
      hp: 100,
      isPlayer: false,
      finished: false,
      finishOrder: -1,
      respawn: 0,
      invuln: 0,
      fireCooldown: 0,
      ammoFront: 2,
      ammoRear: 1,
      engine: 0,
      handling: 0,
      armor: 0,
      skill: 1,
      ...props,
    };
  };

  RIVALS.forEach((rival, i) => {
    cars.push(makeCar(i, {
      name: rival.name,
      color: rival.color,
      skill: 0.93 + i * 0.05,
      ammoFront: 1 + career.stage,
      ammoRear: 1,
      armor: Math.min(3, career.stage),
    }));
  });

  cars.push(makeCar(RIVALS.length, {
    name: 'DU',
    color: PLAYER_COLOR,
    isPlayer: true,
    hp: career.hp,
    ammoFront: career.ammoFront,
    ammoRear: career.ammoRear,
    engine: career.engine,
    handling: career.handling,
    armor: career.armor,
  }));

  return {
    track,
    cars,
    missiles: [],
    particles: [],
    events: [],
    time: 0,
    countdown: COUNTDOWN_TICKS,
    finishedCount: 0,
    endTimer: -1,
    over: false,
    aiBase: 3.55 + trackDef.aiBonus,
  };
}

export const playerCar = (race) => race.cars.find((c) => c.isPlayer);

/** Aktuelle Reihenfolge: Zielankunft schlägt Streckenfortschritt. */
export function standings(race) {
  return race.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}

const maxSpeedOf = (race, car) => (car.isPlayer ? 4.0 + car.engine * 0.45 : race.aiBase * car.skill);
const turnRateOf = (car) => (car.isPlayer ? 0.052 + car.handling * 0.011 : 0.078);
const accelOf = (car) => (car.isPlayer ? 0.085 + car.engine * 0.012 : 0.09);

function explode(race, x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.8 + Math.random() * 3.4;
    race.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 22 + Math.random() * 26,
      max: 48,
      color: Math.random() < 0.5 ? '#ffb03a' : (Math.random() < 0.5 ? '#ff5a2e' : '#ffe27a'),
      size: 3 + Math.random() * 5,
    });
  }
}

function damage(race, car, amount, fromMissile) {
  if (car.invuln > 0 || car.respawn > 0) return;
  car.hp -= amount * (1 - car.armor * 0.13);
  if (car.hp <= 0) {
    car.hp = 0;
    car.respawn = RESPAWN_TICKS;
    car.speed = 0;
    explode(race, car.x, car.y, 26);
    race.events.push({ type: 'boom' });
  } else if (fromMissile) {
    explode(race, car.x, car.y, 12);
    race.events.push({ type: 'boom' });
  }
}

export function fire(race, car, rear) {
  if (car.respawn > 0 || race.countdown > 0) return false;
  const key = rear ? 'ammoRear' : 'ammoFront';
  if (car[key] <= 0) return false;
  car[key]--;

  const angle = rear ? car.angle + Math.PI : car.angle;
  race.missiles.push({
    x: car.x + Math.cos(angle) * 20,
    y: car.y + Math.sin(angle) * 20,
    angle,
    speed: 8.5 + Math.max(0, car.speed),
    life: 75,
    owner: car,
    grace: 12, // kurz nach dem Start immun gegen den eigenen Schützen
  });
  race.events.push({ type: 'fire' });
  return true;
}

/** KI-Steuerung: Ideallinie verfolgen, vor Kurven bremsen, gelegentlich feuern. */
function driveAi(race, car) {
  const track = race.track;
  const look = 110 + car.speed * 26;
  const target = posAt(track, car.s + look);
  let delta = Math.atan2(target.y - car.y, target.x - car.x) - car.angle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const steer = Math.max(-1, Math.min(1, delta * 3.2));

  const far = posAt(track, car.s + look + 130);
  let curve = Math.atan2(far.y - car.y, far.x - car.x) - car.angle;
  curve = Math.abs(Math.atan2(Math.sin(curve), Math.cos(curve)));
  const want = maxSpeedOf(race, car) * Math.max(0.4, 1 - curve * 0.9);

  // Gummiband: abgehängte Gegner holen leicht auf, führende lassen locker.
  const me = playerCar(race);
  if (me) {
    const gap = me.progress - car.progress;
    if (gap > 700) car.speed *= 1.002;
    else if (gap < -900) car.speed *= 0.998;
  }

  if (car.fireCooldown === 0 && !car.finished && race.countdown === 0) {
    for (const other of race.cars) {
      if (other === car || other.respawn > 0) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 60 || dist >= 300) continue;
      let rel = Math.atan2(dy, dx) - car.angle;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) < 0.22 && car.ammoFront > 0 && Math.random() < 0.02) {
        fire(race, car, false);
        car.fireCooldown = 140;
        break;
      }
      if (Math.abs(Math.abs(rel) - Math.PI) < 0.22 && car.ammoRear > 0 && Math.random() < 0.012) {
        fire(race, car, true);
        car.fireCooldown = 140;
        break;
      }
    }
  }

  return { steer, gas: car.speed < want, brake: car.speed > want + 0.7 };
}

function stepCar(race, car, controls) {
  const track = race.track;

  if (car.respawn > 0) {
    car.respawn--;
    if (car.respawn === 0) {
      const p = posAt(track, car.s);
      car.x = p.x;
      car.y = p.y;
      car.angle = p.angle;
      car.seg = p.seg;
      car.speed = 0;
      car.hp = 55;
      car.invuln = INVULN_TICKS;
    }
    return;
  }
  if (car.invuln > 0) car.invuln--;
  if (car.fireCooldown > 0) car.fireCooldown--;

  let steer = 0;
  let gas = false;
  let brake = false;
  if (car.isPlayer && !car.finished) {
    steer = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
    gas = controls.gas;
    brake = controls.brake;
  } else if (!car.isPlayer) {
    ({ steer, gas, brake } = driveAi(race, car));
  }
  if (race.countdown > 0) gas = false;

  const vmax = maxSpeedOf(race, car);
  if (gas) car.speed += accelOf(car) * Math.max(0.15, 1 - car.speed / vmax);
  else car.speed *= 0.979;
  if (brake) car.speed *= 0.93;
  if (car.speed < 0.02) car.speed = 0;
  if (car.speed > vmax * 1.15) car.speed = vmax * 1.15;

  // Lenkeinschlag greift erst mit etwas Tempo.
  car.angle += turnRateOf(car) * steer * Math.min(1, car.speed / 1.4);
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;

  const pr = project(track, car.x, car.y, car.seg);
  car.seg = pr.i;
  if (pr.dist > ROAD_WIDTH / 2 - 6) car.speed *= 0.955; // Gras bremst
  const limit = ROAD_WIDTH / 2 + 26;
  if (pr.dist > limit) {
    car.x = pr.px + ((car.x - pr.px) / pr.dist) * limit;
    car.y = pr.py + ((car.y - pr.py) / pr.dist) * limit;
    car.speed *= 0.88; // Bande
  }

  // Rundenzählung: ein Sprung über die halbe Streckenlänge ist der Zielstrich.
  const half = track.total / 2;
  const delta = pr.s - car.s;
  if (delta < -half) car.lap++;
  else if (delta > half) car.lap--;
  car.s = pr.s;
  car.progress = car.lap * track.total + car.s;

  if (!car.finished && car.lap >= track.def.laps + 1) {
    car.finished = true;
    car.finishOrder = race.finishedCount++;
    if (car.isPlayer && race.endTimer < 0) race.endTimer = FINISH_DELAY;
  }

  if (car.hp < 35 && car.hp > 0 && race.time % 6 === 0) {
    race.particles.push({
      x: car.x - Math.cos(car.angle) * 14,
      y: car.y - Math.sin(car.angle) * 14,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6 - 0.3,
      life: 30,
      max: 30,
      color: 'rgba(120,120,120,0.7)',
      size: 5 + Math.random() * 4,
    });
  }
}

function stepCollisions(race) {
  for (let i = 0; i < race.cars.length; i++) {
    for (let j = i + 1; j < race.cars.length; j++) {
      const a = race.cars[i];
      const b = race.cars[j];
      if (a.respawn > 0 || b.respawn > 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist >= CAR_RADIUS * 2) continue;
      const push = (CAR_RADIUS * 2 - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const rel = Math.abs(a.speed - b.speed);
      if (rel > 1.4) {
        damage(race, a, rel * 1.1, false);
        damage(race, b, rel * 1.1, false);
      }
      a.speed *= 0.965;
      b.speed *= 0.965;
    }
  }
}

function stepMissiles(race) {
  for (let i = race.missiles.length - 1; i >= 0; i--) {
    const m = race.missiles[i];
    m.x += Math.cos(m.angle) * m.speed;
    m.y += Math.sin(m.angle) * m.speed;
    m.life--;
    if (m.grace > 0) m.grace--;
    if (race.time % 2 === 0) {
      race.particles.push({
        x: m.x, y: m.y, vx: 0, vy: 0, life: 10, max: 10,
        color: 'rgba(255,190,80,.8)', size: 3,
      });
    }
    let hit = false;
    for (const car of race.cars) {
      if (car.respawn > 0 || (car === m.owner && m.grace > 0)) continue;
      if (Math.hypot(car.x - m.x, car.y - m.y) < MISSILE_HIT_RADIUS) {
        damage(race, car, 42, true);
        hit = true;
        break;
      }
    }
    const offMap = m.x < 0 || m.y < 0 || m.x > WORLD || m.y > WORLD;
    if (hit || m.life <= 0 || offMap) race.missiles.splice(i, 1);
  }
}

function stepParticles(race) {
  for (let i = race.particles.length - 1; i >= 0; i--) {
    const p = race.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.life--;
    if (p.life <= 0) race.particles.splice(i, 1);
  }
}

/** Ein Simulationsschritt (1/60 s). `controls` = { left, right, gas, brake }. */
export function stepRace(race, controls) {
  race.time++;

  if (race.countdown > 0) {
    race.countdown--;
    if (race.countdown === 0) race.events.push({ type: 'go' });
    else if (race.countdown % 60 === 59) race.events.push({ type: 'beep' });
  }

  for (const car of race.cars) stepCar(race, car, controls);
  stepCollisions(race);
  stepMissiles(race);
  stepParticles(race);

  if (race.endTimer > 0) {
    race.endTimer--;
    if (race.endTimer === 0) race.over = true;
  }
}
