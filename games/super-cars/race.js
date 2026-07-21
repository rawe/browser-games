// Rennlogik: Fahrzeuge, Runden, Positionen, Schaden, Kollisionen, Raketen. DOM-frei.
import { buildTrack, closestSampleIndex, lateralOffset } from './trackGeometry.js';
import { carSpec, createCarState, stepCar } from './carPhysics.js';
import { createAiDriver, aiControl, targetInCone } from './ai.js';
import { fireRocket, updateRockets } from './weapons.js';

export const OPPONENT_INFO = [
  { name: 'Kobra', color: 0x3d7bff },
  { name: 'Viper', color: 0x35d07f },
  { name: 'Geier', color: 0xb45cff },
  { name: 'Blitz', color: 0xff8a2a },
  { name: 'Wolf', color: 0x2ad4c8 },
  { name: 'Puma', color: 0xe8e8ee },
  { name: 'Falke', color: 0xff5ca8 },
];

const ROCKET_DAMAGE = 42;
const RESPAWN_TIME = 3.2;
const RESPAWN_HEALTH = 30;

export function createRace(trackDef, career, stage) {
  const track = buildTrack(trackDef);
  const cars = [];

  const gridPos = (i) => {
    // Startaufstellung: Zweierreihen kurz vor der Ziellinie
    const back = 6 + Math.floor(i / 2) * 6.5;
    let idx = track.count - 1;
    while (track.length - track.samples[idx].s < back && idx > 0) idx--;
    const s = track.samples[idx];
    const side = (i % 2 === 0 ? 1 : -1) * 2.0;
    return {
      x: s.x + s.nx * side,
      z: s.z + s.nz * side,
      heading: Math.atan2(s.tz, s.tx),
      idx,
      startS: -(track.length - s.s),
    };
  };

  // Spieler (Startplatz hinten, wie im Original verdient man sich nach vorn)
  const pg = gridPos(OPPONENT_INFO.length);
  cars.push({
    id: 0,
    isPlayer: true,
    name: 'Du',
    color: 0xff4b3a,
    driver: createAiDriver(0.9), // nur im Demo-/Autopilot-Modus aktiv
    state: createCarState(pg.x, pg.z, pg.heading),
    spec: carSpec(career.upgrades.motor, career.upgrades.handling),
    armor: career.upgrades.panzerung,
    health: career.health,
    ammoF: career.ammoF,
    ammoR: career.ammoR,
    weapon: career.ammoF > 0 ? 'front' : 'rear',
    sampleIdx: pg.idx,
    totalS: pg.startS,
    prevS: track.samples[pg.idx].s,
    destroyed: false,
    respawnT: 0,
    finished: false,
    finishTime: 0,
    fireCooldown: 0,
  });

  for (let i = 0; i < OPPONENT_INFO.length; i++) {
    const g = gridPos(i);
    const skill = 0.5 + (i / OPPONENT_INFO.length) * 0.3 + stage * 0.06;
    cars.push({
      id: i + 1,
      isPlayer: false,
      name: OPPONENT_INFO[i].name,
      color: OPPONENT_INFO[i].color,
      driver: createAiDriver(Math.min(0.98, skill)),
      state: createCarState(g.x, g.z, g.heading),
      spec: carSpec(Math.min(4, stage + (i % 3)), Math.min(4, stage + ((i + 1) % 3))),
      armor: Math.min(3, Math.floor(stage / 2)),
      health: 100,
      ammoF: 1 + stage,
      ammoR: stage > 0 ? 1 + Math.floor(stage / 2) : 0,
      weapon: 'front',
      sampleIdx: g.idx,
      totalS: g.startS,
      prevS: track.samples[g.idx].s,
      destroyed: false,
      respawnT: 0,
      finished: false,
      finishTime: 0,
      fireCooldown: 0,
    });
  }

  return {
    track,
    cars,
    rockets: [],
    events: [],
    autopilot: false,
    time: 0,
    countdown: 3.6,
    state: 'countdown', // countdown | running | finished
    finishDelay: 1.2,
    results: null,
    stage,
  };
}

// KI-Ausweichen: blockierenden Wagen voraus umfahren statt aufzufahren
function avoidTraffic(car, cars, input) {
  const fx = Math.cos(car.state.heading);
  const fz = Math.sin(car.state.heading);
  for (const o of cars) {
    if (o === car || o.destroyed) continue;
    const dx = o.state.x - car.state.x;
    const dz = o.state.z - car.state.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 8 || dist < 0.01) continue;
    const ahead = (dx * fx + dz * fz) / dist;
    if (ahead < 0.75) continue;
    const cross = fx * dz - fz * dx; // Seite des Hindernisses
    input.steer = Math.max(-1, Math.min(1, input.steer - Math.sign(cross || 1) * 0.55));
    if (dist < 4.5 && car.state.v > o.state.v - 1) {
      input.throttle = Math.min(input.throttle, 0.35);
    }
  }
}

function applyDamage(race, car, amount, x, z) {
  if (car.destroyed) return;
  const reduced = amount * (1 - 0.16 * car.armor);
  car.health -= reduced;
  if (car.health <= 0) {
    car.health = 0;
    car.destroyed = true;
    car.respawnT = RESPAWN_TIME;
    car.state.v = 0;
    race.events.push({ type: 'explosion', x: car.state.x, z: car.state.z, carId: car.id });
  } else {
    race.events.push({ type: 'damage', x, z, carId: car.id });
  }
}

export function playerCar(race) { return race.cars[0]; }

export function tryFire(race, car) {
  if (car.destroyed || race.state !== 'running' || car.fireCooldown > 0) return false;
  const dir = car.weapon === 'front' ? 1 : -1;
  if (dir === 1 && car.ammoF <= 0) return false;
  if (dir === -1 && car.ammoR <= 0) return false;
  if (dir === 1) car.ammoF--; else car.ammoR--;
  car.fireCooldown = 0.55;
  fireRocket(race.rockets, car, dir);
  race.events.push({ type: 'fire', x: car.state.x, z: car.state.z, carId: car.id });
  return true;
}

export function updateRace(race, playerInput, dt) {
  const { track, cars } = race;
  race.time += dt;

  race.countdown -= dt;
  if (race.state === 'countdown' && race.countdown <= 0) {
    race.state = 'running';
    race.events.push({ type: 'go' });
  }
  const running = race.state !== 'countdown';

  const isOffTrack = (x, z) => {
    const i = closestSampleIndex(track, x, z);
    return Math.abs(lateralOffset(track, i, x, z)) > track.halfWidth + track.shoulder;
  };

  for (const car of cars) {
    // Respawn zerstörter Wagen auf der Mittellinie
    if (car.destroyed) {
      car.respawnT -= dt;
      if (car.respawnT <= 0) {
        const s = track.samples[car.sampleIdx];
        car.state.x = s.x;
        car.state.z = s.z;
        car.state.heading = Math.atan2(s.tz, s.tx);
        car.state.v = 0;
        car.health = RESPAWN_HEALTH;
        car.destroyed = false;
        race.events.push({ type: 'respawn', carId: car.id });
      }
      continue;
    }

    car.fireCooldown = Math.max(0, car.fireCooldown - dt);

    // Eingaben bestimmen
    let input;
    if (car.isPlayer && !race.autopilot) {
      input = running && !car.finished
        ? playerInput
        : { throttle: car.finished ? 0.25 : 0, brake: 0, steer: 0 };
    } else if (car.isPlayer) {
      if (running && !car.finished) {
        input = aiControl(car.driver, car.state, car.spec, track, car.sampleIdx, dt, 1);
        avoidTraffic(car, cars, input);
      } else {
        input = { throttle: 0, brake: 0, steer: 0 };
      }
    } else if (!running) {
      input = { throttle: 0, brake: 0, steer: 0 };
    } else {
      // Rubberband hält das Feld beisammen
      const gap = car.totalS - race.cars[0].totalS;
      const rubber = gap < -35 ? 1.07 : gap > 45 ? 0.93 : 1;
      const ctrl = aiControl(car.driver, car.state, car.spec, track, car.sampleIdx, dt, rubber);
      avoidTraffic(car, cars, ctrl);
      input = ctrl;
      if (ctrl.wantFire && !car.finished) {
        const aheadTarget = cars.some((o) => o !== car && !o.destroyed && targetInCone(car.state, o.state, 1, 30));
        const behindTarget = cars.some((o) => o !== car && !o.destroyed && targetInCone(car.state, o.state, -1, 16));
        if (aheadTarget && car.ammoF > 0) { car.weapon = 'front'; tryFire(race, car); }
        else if (behindTarget && car.ammoR > 0) { car.weapon = 'rear'; tryFire(race, car); }
      }
    }

    // Untergrund + Physikschritt
    car.sampleIdx = closestSampleIndex(track, car.state.x, car.state.z, car.sampleIdx);
    let lat = lateralOffset(track, car.sampleIdx, car.state.x, car.state.z);
    const surface = Math.abs(lat) <= track.halfWidth + 0.6 ? 'road' : 'grass';
    stepCar(car.state, input, car.spec, surface, dt);

    // Bande: zurückschieben, Tempo + Schaden je nach Aufprall
    car.sampleIdx = closestSampleIndex(track, car.state.x, car.state.z, car.sampleIdx);
    lat = lateralOffset(track, car.sampleIdx, car.state.x, car.state.z);
    const wall = track.halfWidth + track.shoulder;
    if (Math.abs(lat) > wall) {
      const s = track.samples[car.sampleIdx];
      const clamped = Math.sign(lat) * (wall - 0.15);
      car.state.x = s.x + s.nx * clamped;
      car.state.z = s.z + s.nz * clamped;
      // an der Bande entlanggleiten: Ausrichtung auf die Streckentangente,
      // nur der Quer-Anteil des Aufpralls kostet Tempo und Schaden
      const dirSign = Math.cos(car.state.heading) * s.tx + Math.sin(car.state.heading) * s.tz >= 0 ? 1 : -1;
      const wallAngle = Math.atan2(s.tz * dirSign, s.tx * dirSign);
      let dAng = wallAngle - car.state.heading;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      const lateralImpact = Math.abs(Math.sin(dAng)) * car.state.v;
      car.state.heading = wallAngle;
      car.state.v *= Math.max(0.35, 1 - Math.abs(Math.sin(dAng)) * 0.9);
      if (lateralImpact > 8) {
        applyDamage(race, car, (lateralImpact - 8) * 0.9, car.state.x, car.state.z);
        race.events.push({ type: 'wallHit', x: car.state.x, z: car.state.z, carId: car.id });
      }
    }

    // Rundenfortschritt (kontinuierliche Bogenlänge, wickelfest)
    const sNow = track.samples[car.sampleIdx].s;
    let ds = sNow - car.prevS;
    if (ds < -track.length / 2) ds += track.length;
    if (ds > track.length / 2) ds -= track.length;
    car.prevS = sNow;
    const before = Math.floor(car.totalS / track.length);
    car.totalS += ds;
    const after = Math.floor(car.totalS / track.length);
    if (after > before && after > 0) {
      race.events.push({ type: 'lap', carId: car.id, lap: after });
    }
    if (!car.finished && car.totalS >= track.laps * track.length) {
      car.finished = true;
      car.finishTime = race.time;
      race.events.push({ type: 'carFinished', carId: car.id });
    }
  }

  // Fahrzeug-Kollisionen: auseinanderschieben, bei hartem Rempler Schaden
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (a.destroyed || b.destroyed) continue;
      const dx = b.state.x - a.state.x;
      const dz = b.state.z - a.state.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.7 && d > 0.001) {
        const push = (2.7 - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        a.state.x -= ux * push;
        a.state.z -= uz * push;
        b.state.x += ux * push;
        b.state.z += uz * push;
        // Impuls statt Dauerbremse: nur die Annäherungsgeschwindigkeit wird abgebaut,
        // der Vordermann bekommt einen Schubs – Dauerkontakt kostet kein Tempo
        const closing =
          (Math.cos(a.state.heading) * a.state.v - Math.cos(b.state.heading) * b.state.v) * ux +
          (Math.sin(a.state.heading) * a.state.v - Math.sin(b.state.heading) * b.state.v) * uz;
        if (closing > 0) {
          a.state.v = Math.max(0, a.state.v - closing * 0.55);
          b.state.v += closing * 0.3;
          if (closing > 9) {
            applyDamage(race, a, closing * 0.35, a.state.x, a.state.z);
            applyDamage(race, b, closing * 0.35, b.state.x, b.state.z);
          }
        }
      }
    }
  }

  // Raketen
  updateRockets(race.rockets, cars, isOffTrack, dt, race.events);
  for (let i = race.events.length - 1; i >= 0; i--) {
    const ev = race.events[i];
    if (ev.type === 'rocketHit') {
      const victim = cars.find((c) => c.id === ev.victim);
      if (victim) {
        victim.state.v *= 0.35;
        applyDamage(race, victim, ROCKET_DAMAGE, ev.x, ev.z);
      }
    }
  }

  // Rangliste
  const ranked = [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.totalS - a.totalS;
  });
  ranked.forEach((c, i) => { c.position = i + 1; });

  // Rennen endet kurz nachdem der Spieler im Ziel ist
  if (race.cars[0].finished && race.state === 'running') {
    race.finishDelay -= dt;
    if (race.finishDelay <= 0) {
      race.state = 'finished';
      race.results = ranked.map((c) => ({
        id: c.id, name: c.name, color: c.color, isPlayer: c.isPlayer, position: c.position,
      }));
    }
  }
}
