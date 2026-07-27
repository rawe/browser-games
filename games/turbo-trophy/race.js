// Rennsimulation: Fahrphysik, Raketen, Kollisionen, Rundenzählung.
// Läuft in festen 60-Hz-Schritten und kennt weder DOM noch Audio – hörbare
// Ereignisse landen in `race.events` und werden außerhalb übersetzt.
// Die Gegnersteuerung liegt in `ai.js`, das Abfeuern in `weapons.js`.

import { buildTrack, gapAlong, posAt, project, ROAD_WIDTH, WORLD } from './trackGeometry.js';
import { createAiState, driveAi, profileFor } from './ai.js';
import {
  buildElements, gateBlocks, gateState, inOil, levelAt, onRamp,
  GROUND, JUMP_TICKS,
} from './elements.js';
import { createRng } from './rng.js';
import { fire } from './weapons.js';

export { fire };

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

const RAMP_MIN_SPEED = 1.5; // darunter rumpelt man nur über die Schanze
const OIL_TICKS = 34;       // wie lange ein Fahrzeug nach der Lache schleudert
const GATE_STOP_RANGE = 18; // Bogenlänge, in der eine Schranke wirklich sperrt

/**
 * Legt ein Rennen an. `options.seed` macht den Lauf reproduzierbar
 * (Standard: zufällig) – die Headless-Simulation nutzt das.
 */
export function createRace(trackDef, career, options = {}) {
  const track = buildTrack(trackDef);
  // Streckenelemente hängen am aufgebauten Track, nicht an der Geometrie –
  // so bleibt `trackGeometry.js` frei von Spiellogik.
  track.elements = buildElements(track, trackDef.elements ?? []);
  const profile = profileFor(career.difficulty);
  const rng = createRng(options.seed ?? Math.floor(Math.random() * 0xffffffff));
  const cars = [];
  const aiBase = (3.55 + trackDef.aiBonus) * profile.speed;

  // Startaufstellung: versetzt hintereinander, links/rechts der Ideallinie.
  const makeCar = (gridIndex, props) => {
    const s = track.total - (46 + gridIndex * 52);
    const p = posAt(track, s);
    const side = (gridIndex % 2 === 0 ? 1 : -1) * 21;
    const car = {
      x: p.x - Math.sin(p.angle) * side,
      y: p.y + Math.cos(p.angle) * side,
      angle: p.angle,
      seg: p.seg,
      s,
      lat: side,
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
      level: GROUND, // Höhenebene: 0 = Fahrbahn, 1 = Brücke
      air: 0,        // Restticks in der Luft (Sprungschanze)
      airMax: 0,     // Ausgangswert dazu – für Flughöhe und Darstellung
      oil: 0,        // Restticks im Schleudern
      spin: 0,       // Driftrichtung während des Schleuderns
      ...props,
    };
    car.maxSpeed = car.isPlayer ? 4.0 + car.engine * 0.45 : aiBase * car.skill;
    car.ai = car.isPlayer ? null : createAiState(rng, side);
    return car;
  };

  RIVALS.forEach((rival, i) => {
    // Unterschiedlich starke Gegner sorgen für echte Positionskämpfe;
    // die Streuung hängt an der Schwierigkeitsstufe.
    const rank = i - (RIVALS.length - 1) / 2;
    cars.push(makeCar(i, {
      name: rival.name,
      color: rival.color,
      skill: 1 + rank * profile.spread,
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
    difficulty: profile.id,
    profile,
    rng,
    aiBase,
    stats: {
      contacts: 0, aiContacts: 0, overtakes: 0, aiOvertakes: 0,
      // Streckenelemente (Issue #26) – Grundlage der Akzeptanzprüfung.
      jumps: 0,          // Sprünge über Schanzen
      oilHits: 0,        // Fahrzeuge, die ins Schleudern geraten sind
      gateStops: 0,      // Ticks, in denen eine Schranke ein Fahrzeug aufhält
      gateSwitches: 0,   // Zustandswechsel aller Schranken im Rennen
      bridgeTicks: 0,    // Ticks, die Fahrzeuge auf der oberen Ebene verbringen
      airTicks: 0,       // Ticks in der Luft
      crossLevelPasses: 0, // Begegnungen, die nur dank Höhentrennung folgenlos blieben
    },
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

const turnRateOf = (race, car) => (car.isPlayer ? 0.052 + car.handling * 0.011 : race.profile.turn);
const accelOf = (race, car) => (car.isPlayer ? 0.085 + car.engine * 0.012 : race.profile.accel);

function explode(race, x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = race.rng() * Math.PI * 2;
    const sp = 0.8 + race.rng() * 3.4;
    race.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 22 + race.rng() * 26,
      max: 48,
      color: race.rng() < 0.5 ? '#ffb03a' : (race.rng() < 0.5 ? '#ff5a2e' : '#ffe27a'),
      size: 3 + race.rng() * 5,
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

/**
 * Wirkung der Streckenelemente auf ein Fahrzeug. Wird mitten in `stepCar`
 * aufgerufen, direkt nach der Bewegung und vor deren Auswertung.
 *
 * `prevX`/`prevY`/`prevS` sind Position und Bogenlänge vor diesem Tick –
 * eine geschlossene Schranke setzt darauf zurück. Rückgabewert ist die
 * gültige Projektion (neu berechnet, falls zurückgesetzt wurde).
 */
function stepElements(race, car, prevX, prevY, prevS, pr) {
  const track = race.track;
  const elements = track.elements;

  if (car.air > 0) {
    car.air--;
    if (car.air === 0) {
      car.speed *= 0.94; // Landung kostet etwas Tempo
      race.events.push({ type: 'land' });
    }
  }

  if (!elements?.length) return pr;

  car.level = levelAt(track, elements, pr.s);

  for (const el of elements) {
    switch (el.type) {
      case 'ramp':
        // Abheben nur mit Schwung – langsam drüberrollen tut nichts.
        if (car.air === 0 && car.speed >= RAMP_MIN_SPEED && onRamp(track, el, pr.s, pr.lat)) {
          car.airMax = Math.round(JUMP_TICKS * el.power * Math.min(1.4, car.speed / 3));
          car.air = car.airMax;
          car.speed *= 1.04;
          race.stats.jumps++;
          race.events.push({ type: 'jump' });
        }
        break;

      case 'oil':
        // In der Luft übersprungen – deshalb sind Schanze und Lache
        // zusammen ein taktisches Mittel.
        if (car.air === 0 && car.oil === 0 && inOil(el, car.x, car.y)) {
          car.oil = OIL_TICKS;
          car.spin = (race.rng() < 0.5 ? -1 : 1) * (0.22 + race.rng() * 0.16);
          race.stats.oilHits++;
          race.events.push({ type: 'skid' });
        }
        break;

      case 'gate': {
        if (car.air > 0) break; // über die Schranke hinweg
        const state = gateState(el, race.time);
        if (!state.closed || !gateBlocks(el, pr.lat)) break;
        const before = gapAlong(track, el.s, prevS);
        const after = gapAlong(track, el.s, pr.s);
        // Sperrt, wenn die Schranke in diesem Tick überfahren würde oder das
        // Fahrzeug direkt darunter steht.
        if (!(before < 0 && after >= 0) && Math.abs(after) > GATE_STOP_RANGE) break;
        if (car.speed > 1.8) damage(race, car, 3, false);
        race.stats.gateStops++;
        car.x = prevX;
        car.y = prevY;
        car.speed *= 0.18;
        return project(track, car.x, car.y, car.seg);
      }

      default:
        break;
    }
  }
  return pr;
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
      car.lat = 0;
      car.speed = 0;
      car.hp = 55;
      car.invuln = INVULN_TICKS;
      car.air = 0;
      car.oil = 0;
      car.level = levelAt(track, track.elements, car.s);
      if (car.ai) {
        car.ai.offset = 0;
        car.ai.overtakeTicks = 0;
        car.ai.blockedTicks = 0;
      }
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

  // Öllache: die Lenkung greift kaum noch und das Fahrzeug driftet in eine
  // feste Richtung weg – daraus entsteht das Schleudern.
  if (car.oil > 0) {
    car.oil--;
    steer = steer * 0.3 + car.spin;
    car.speed *= 0.988;
  }

  const prevX = car.x;
  const prevY = car.y;
  const prevS = car.s;

  const vmax = car.maxSpeed;
  if (gas) car.speed += accelOf(race, car) * Math.max(0.15, 1 - car.speed / vmax);
  else car.speed *= 0.979;
  if (brake) car.speed *= 0.93;
  if (car.speed < 0.02) car.speed = 0;
  if (car.speed > vmax * 1.15) car.speed = vmax * 1.15;

  // Lenkeinschlag greift erst mit etwas Tempo.
  car.angle += turnRateOf(race, car) * steer * Math.min(1, car.speed / 1.4);
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;

  let pr = project(track, car.x, car.y, car.seg);
  // Streckenelemente greifen vor der Auswertung: eine geschlossene Schranke
  // kann die Bewegung dieses Ticks zurücknehmen und liefert dann eine neue
  // Projektion, mit der alles Weitere rechnet.
  pr = stepElements(race, car, prevX, prevY, prevS, pr);
  car.seg = pr.i;
  car.lat = pr.lat;
  // In der Luft zählen weder Gras noch Bande – man fliegt darüber hinweg.
  car.offroad = car.air === 0 && pr.dist > ROAD_WIDTH / 2 - 6;
  if (car.offroad) car.speed *= 0.955; // Gras bremst
  const limit = ROAD_WIDTH / 2 + (car.air > 0 ? 60 : 26);
  if (pr.dist > limit) {
    car.x = pr.px + ((car.x - pr.px) / pr.dist) * limit;
    car.y = pr.py + ((car.y - pr.py) / pr.dist) * limit;
    if (car.air === 0) car.speed *= 0.88; // Bande
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
      vx: (race.rng() - 0.5) * 0.6,
      vy: (race.rng() - 0.5) * 0.6 - 0.3,
      life: 30,
      max: 30,
      color: 'rgba(120,120,120,0.7)',
      size: 5 + race.rng() * 4,
    });
  }
}

function stepCollisions(race) {
  for (let i = 0; i < race.cars.length; i++) {
    for (let j = i + 1; j < race.cars.length; j++) {
      const a = race.cars[i];
      const b = race.cars[j];
      if (a.respawn > 0 || b.respawn > 0) continue;
      // Verschiedene Höhenebenen berühren sich nicht – das ist der Sinn von
      // Brücke und Tunnel. Wer springt, fliegt ebenfalls über alles hinweg.
      if (a.level !== b.level || a.air > 0 || b.air > 0) {
        // Mitzählen, wenn sie sich ohne Trennung berührt hätten – das belegt,
        // dass die Höhenebenen tatsächlich etwas verhindern.
        if (Math.hypot(b.x - a.x, b.y - a.y) < CAR_RADIUS * 2) race.stats.crossLevelPasses++;
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist >= CAR_RADIUS * 2) continue;
      race.stats.contacts++;
      if (!a.isPlayer && !b.isPlayer) race.stats.aiContacts++;
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
      if (car.level !== m.level || car.air > 0) continue; // andere Ebene, kein Treffer
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

/**
 * Kennzahlen der Streckenelemente fortschreiben – nur für die Simulation,
 * das Spiel selbst braucht sie nicht.
 */
function trackElementStats(race) {
  const elements = race.track.elements;
  if (!elements?.length) return;
  for (const car of race.cars) {
    if (car.respawn > 0) continue;
    if (car.level !== GROUND) race.stats.bridgeTicks++;
    if (car.air > 0) race.stats.airTicks++;
  }
  for (const el of elements) {
    if (el.type !== 'gate') continue;
    const { closed } = gateState(el, race.time);
    if (el.wasClosed !== undefined && el.wasClosed !== closed) race.stats.gateSwitches++;
    el.wasClosed = closed;
  }
}

/**
 * Positionswechsel zählen: Für jedes Fahrzeugpaar prüfen, ob sich die
 * Reihenfolge seit dem letzten Tick gedreht hat. Liefert die Kennzahl, an der
 * sich in der Simulation ablesen lässt, ob überhaupt überholt wird.
 */
function trackOvertakes(race) {
  const cars = race.cars;
  const prev = race.lastProgress;
  if (prev) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const before = prev[i] - prev[j];
        const now = cars[i].progress - cars[j].progress;
        if (before < 0 !== now < 0 && Math.abs(now) > 1) {
          race.stats.overtakes++;
          if (!cars[i].isPlayer && !cars[j].isPlayer) race.stats.aiOvertakes++;
        }
      }
    }
  } else {
    race.lastProgress = [];
  }
  for (let i = 0; i < cars.length; i++) race.lastProgress[i] = cars[i].progress;
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
  trackElementStats(race);
  if (race.countdown === 0) trackOvertakes(race);

  if (race.endTimer > 0) {
    race.endTimer--;
    if (race.endTimer === 0) race.over = true;
  }
}
