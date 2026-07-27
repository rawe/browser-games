// Headless-Simulation eines Turbo-Trophy-Rennens.
//
// Nutzt exakt dieselbe Rennlogik wie das Spiel (`race.js` + `ai.js`), aber ohne
// Canvas, DOM oder Audio. Damit lassen sich KI-Änderungen in Sekunden über
// hunderte Rennen prüfen, statt jedes Mal im Browser zu fahren.
//
// Der Spielerwagen wird von einem *Referenzfahrer* gesteuert: derselbe
// KI-Code, aber mit einem festen Profil. So bleibt der Maßstab gleich, wenn
// sich die Gegnerstärke ändert – der Platz des Referenzfahrers zeigt dann,
// wie stark die Gegner wirklich sind.

import { tracks } from '../tracks.js';
import { createCareer } from '../career.js';
import { createRace, playerCar, standings, stepRace, useItem } from '../race.js';
import { createAiState, driveAi, profileFor } from '../ai.js';
import { normalizeAmmo } from '../items.js';
import { gapAlong, offsetPoint, posAt } from '../trackGeometry.js';

const REFERENCE_PROFILE = profileFor('mittel');

// Ab so vielen Ticks hinter einem langsameren Auto gilt ein Bot als „klebt fest“.
const CONVOY_TICKS = 120;
const MAX_TICKS = 60 * 60 * 6; // 6 Minuten Notbremse
// Seitliche Bewegung, ab der ein Richtungswechsel als Schlangenlinie zählt.
const ZIGZAG_MIN = 4;

/**
 * Karriere-Stand, den ein Spieler zu diesem Zeitpunkt der Meisterschaft
 * plausibel hätte – sonst führe der Referenzfahrer im Finale noch ein
 * unaufgerüstetes Auto.
 */
const careerFor = (stage, difficulty) => ({
  ...createCareer(difficulty),
  stage,
  engine: stage,
  handling: stage,
  armor: Math.max(0, stage - 1),
  // Arsenal, wie es ein Spieler zu diesem Zeitpunkt plausibel gekauft hätte.
  ammo: normalizeAmmo({
    front: 2 + stage,
    rear: 1 + Math.floor(stage / 2),
    homing: Math.max(0, stage - 1),
    turbo: Math.max(0, stage - 1),
    oil: Math.max(0, stage - 1),
  }),
});

/** Ein Rennen simulieren und Kennzahlen zurückgeben. */
export function simulateRace({
  stage = 0,
  difficulty = 'mittel',
  seed = 1,
  career: careerPatch = {},
  maxTicks = MAX_TICKS,
  driver = 'reference', // 'reference' = Vergleichsfahrer, 'parked' = stehendes Hindernis
} = {}) {
  const career = { ...careerFor(stage, difficulty), ...careerPatch, difficulty };
  const trackDef = tracks[stage];
  const race = createRace(trackDef, career, { seed });

  const me = playerCar(race);
  me.ai = createAiState(race.rng, me.lat); // Referenzfahrer bekommt KI-Zustand

  const bots = race.cars.filter((c) => !c.isPlayer);
  const samples = new Map(race.cars.map((c) => [c, {
    speedSum: 0, offroad: 0, convoy: 0, zigzag: 0, run: 0,
    lastOffset: c.ai?.offset ?? 0, lastDelta: 0, finishTick: -1,
  }]));

  const IDLE = { left: false, right: false, gas: false, brake: false };
  let ticks = 0;
  let maxBlocked = 0;
  while (!race.over && ticks < maxTicks) {
    let controls = IDLE;
    if (driver === 'reference') {
      const ctrl = driveAi(race, me, REFERENCE_PROFILE);
      controls = {
        left: ctrl.steer < -0.12,
        right: ctrl.steer > 0.12,
        gas: ctrl.gas,
        brake: ctrl.brake,
      };
    }
    stepRace(race, controls);
    ticks++;
    for (const car of bots) maxBlocked = Math.max(maxBlocked, car.ai.blockedTicks);

    if (race.countdown > 0) continue;
    for (const car of race.cars) {
      const s = samples.get(car);
      s.speedSum += car.speed;
      if (car.offroad) s.offroad++;
      if (car.finished && s.finishTick < 0) s.finishTick = ticks;
      if (!car.ai) continue;
      if (car.ai.blockedTicks > CONVOY_TICKS) s.convoy++;
      // Schlangenlinien = Richtungswechsel der Seitenbewegung, die weiter als
      // ZIGZAG_MIN gingen. Ein sauberer Überholbogen zählt damit nicht,
      // ein Hin-und-Her-Pendeln schon.
      const delta = car.ai.offset - s.lastOffset;
      if (Math.abs(delta) > 0.02) {
        const dir = Math.sign(delta);
        if (s.lastDelta !== 0 && dir !== s.lastDelta) {
          if (s.run > ZIGZAG_MIN) s.zigzag++;
          s.run = 0;
        }
        s.run += Math.abs(delta);
        s.lastDelta = dir;
      }
      s.lastOffset = car.ai.offset;
    }
  }

  const racing = Math.max(1, ticks);
  const order = standings(race);
  const cars = order.map((car) => {
    const s = samples.get(car);
    return {
      name: car.name,
      isPlayer: car.isPlayer,
      place: order.indexOf(car) + 1,
      finished: car.finished,
      finishTick: s.finishTick,
      laps: car.lap,
      avgSpeed: s.speedSum / racing,
      offroadShare: s.offroad / racing,
      hp: Math.round(car.hp),
    };
  });

  const share = (key) => bots.reduce((sum, c) => sum + samples.get(c)[key], 0) / (bots.length * racing);

  return {
    track: trackDef.name,
    stage,
    difficulty,
    seed,
    ticks,
    seconds: ticks / 60,
    cars,
    playerPlace: cars.find((c) => c.isPlayer).place,
    playerFinished: cars.find((c) => c.isPlayer).finished,
    botAvgSpeed: bots.reduce((sum, c) => sum + samples.get(c).speedSum, 0) / (bots.length * racing),
    botFinishSeconds: bots.filter((c) => c.finished).map((c) => samples.get(c).finishTick / 60),
    overtakes: race.stats.overtakes,
    aiOvertakes: race.stats.aiOvertakes,
    contacts: race.stats.contacts,
    aiContacts: race.stats.aiContacts,
    // Streckenelemente (Issue #26)
    jumps: race.stats.jumps,
    oilHits: race.stats.oilHits,
    gateStops: race.stats.gateStops,
    gateSwitches: race.stats.gateSwitches,
    bridgeTicks: race.stats.bridgeTicks,
    airTicks: race.stats.airTicks,
    crossLevelPasses: race.stats.crossLevelPasses,
    // Arsenal (Issue #27)
    homingHits: race.stats.homingHits,
    turboUses: race.stats.turboUses,
    turboRams: race.stats.turboRams,
    oilDrops: race.stats.oilDrops,
    maxBlocked,
    botLaps: bots.map((c) => c.lap),
    convoyShare: share('convoy'),
    offroadShare: share('offroad'),
    zigzag: share('zigzag') * 60, // Richtungswechsel der Seitenbewegung pro Sekunde
  };
}

/**
 * Gezieltes Überhol-Szenario: ein bewusst langsames Auto fährt vor einem
 * schnellen auf der Ideallinie. Prüft die Kernforderung aus Issue #24 –
 * der schnellere Bot darf nicht hinter dem langsameren kleben bleiben.
 *
 * `slowFactor` ist der Tempoanteil des Bremsklotzes, `blockers` die Anzahl
 * langsamer Autos hintereinander (Kolonnen-Test).
 */
export function simulateOvertake({
  stage = 0,
  difficulty = 'mittel',
  seed = 1,
  slowFactor = 0.72,
  blockers = 1,
  ticks = 60 * 25,
} = {}) {
  const race = createRace(tracks[stage], careerFor(stage, difficulty), { seed });
  const bots = race.cars.filter((c) => !c.isPlayer);
  const chaser = bots[0];
  const slow = bots.slice(1, 1 + blockers);

  // Spieler aus dem Weg räumen, damit nur die KI untereinander zählt.
  const me = playerCar(race);
  me.finished = true;
  me.x = -5000;
  me.y = -5000;
  me.s = 0;

  // Aufstellung: Bremsklötze mit Vorsprung, alle auf der Ideallinie.
  race.countdown = 0;
  const place = (car, s, speed) => {
    const p = posAt(race.track, s);
    Object.assign(car, { x: p.x, y: p.y, angle: p.angle, seg: p.seg, s, lat: 0, speed });
    car.ai.offset = 0;
  };
  place(chaser, 200, chaser.maxSpeed * 0.9);
  slow.forEach((car, i) => {
    car.maxSpeed = chaser.maxSpeed * slowFactor;
    place(car, 200 + 70 + i * 60, car.maxSpeed);
  });
  for (const car of bots.slice(1 + blockers)) { car.finished = true; car.x = -5000; car.y = -5000; }

  const ahead = (car) => gapAlong(race.track, car.s, chaser.s) > 30;
  let firstAt = -1;
  let allAt = -1;
  for (let t = 0; t < ticks; t++) {
    stepRace(race, { left: false, right: false, gas: false, brake: false });
    if (firstAt < 0 && slow.some(ahead)) firstAt = t;
    if (slow.every(ahead)) { allAt = t; break; }
  }

  return {
    track: race.track.def.name,
    difficulty,
    seed,
    blockers,
    passedFirst: firstAt >= 0,
    passed: allAt >= 0,
    firstSeconds: firstAt >= 0 ? firstAt / 60 : Infinity,
    seconds: allAt >= 0 ? allAt / 60 : Infinity,
    contacts: race.stats.contacts,
    offroad: bots.some((c) => c.offroad),
  };
}

/** Alle Fahrzeuge entwaffnen – im Szenario soll nur das Gemessene wirken. */
function disarm(race) {
  for (const car of race.cars) car.ammo = normalizeAmmo({});
}

/** Nicht beteiligte Fahrzeuge aus dem Weg räumen. */
function park(cars) {
  for (const car of cars) {
    car.finished = true;
    car.x = -5000;
    car.y = -5000;
    car.s = 0;
  }
}

/**
 * Gezieltes Szenario für die Turbo-Ramme (Issue #27): ein Fahrzeug nimmt mit
 * aktivem Turbo die Sprungschanze; im Moment des Abhebens wird das Opfer genau
 * auf den vorausberechneten Landepunkt gesetzt. Geprüft wird die Wirkung der
 * Landung, nicht wie oft sie im Rennen vorkommt – dafür ist der Fall zu selten.
 *
 * `error` verschiebt das Opfer gegen den Landepunkt, um zu sehen, wie genau
 * man treffen muss.
 */
export function simulateTurboRam({ stage = 0, seed = 1, error = 0, ticks = 60 * 12 } = {}) {
  const race = createRace(tracks[stage], careerFor(stage, 'mittel'), { seed });
  const ramp = race.track.elements.find((el) => el.type === 'ramp');
  if (!ramp) return { possible: false };

  const bots = race.cars.filter((c) => !c.isPlayer);
  const jumper = bots[0];
  const victim = bots[1];
  park([playerCar(race), ...bots.slice(2)]);
  disarm(race);

  race.countdown = 0;
  const place = (car, s, speed) => {
    const p = posAt(race.track, s);
    Object.assign(car, { x: p.x, y: p.y, angle: p.angle, seg: p.seg, s, lat: 0, speed });
    car.ai.offset = 0;
  };
  place(jumper, ramp.s - 120, jumper.maxSpeed);
  jumper.turbo = 300;
  jumper.turboMax = 300;
  // Das Opfer wartet erst einmal weit hinten, bis der Sprung beginnt.
  place(victim, ramp.s + 900, 0);
  victim.maxSpeed = 0.01;

  const hpBefore = victim.hp;
  let placed = false;
  let airTicks = 0;
  for (let t = 0; t < ticks; t++) {
    stepRace(race, { left: false, right: false, gas: false, brake: false });
    // Während des Flugs den Landepunkt jeden Tick nachführen – das Fahrzeug
    // beschleunigt in der Luft weiter, eine einmalige Vorhersage beim Abheben
    // liegt darum daneben. Im letzten Flugtick trifft die Schätzung exakt.
    if (jumper.air > 0) {
      if (!placed) airTicks = jumper.air;
      placed = true;
      // Auf den Seitenversatz des Springers setzen, nicht auf die Ideallinie –
      // sonst geht der Sprung seitlich daneben.
      const q = offsetPoint(race.track, jumper.s + jumper.air * jumper.speed + error, jumper.lat);
      Object.assign(victim, { x: q.x, y: q.y, angle: q.angle, seg: q.seg, speed: 0 });
    }
    if (race.stats.turboRams > 0) break;
  }
  return {
    possible: true,
    error,
    jumped: placed,
    airTicks,
    rammed: race.stats.turboRams > 0,
    victimDamage: Math.round(hpBefore - victim.hp),
    attackerDamage: Math.round(100 - jumper.hp),
  };
}

/**
 * Gezieltes Szenario für die Zielsuchrakete (Issue #27): das Ziel steht
 * seitlich versetzt, also nicht in Schussrichtung. Eine gerade Rakete verfehlt
 * dort, eine zielsuchende muss treffen. `homing = false` liefert den
 * Vergleichswert für dieselbe Aufstellung.
 */
export function simulateHoming({ stage = 0, seed = 1, offset = 34, gap = 200, homing = true, ticks = 140 } = {}) {
  const race = createRace(tracks[stage], careerFor(stage, 'mittel'), { seed });
  const bots = race.cars.filter((c) => !c.isPlayer);
  const shooter = bots[0];
  const target = bots[1];
  park([playerCar(race), ...bots.slice(2)]);
  disarm(race);

  race.countdown = 0;
  const start = race.track.total * 0.5;
  const put = (car, s, lat) => {
    const p = offsetPoint(race.track, s, lat);
    Object.assign(car, { x: p.x, y: p.y, angle: p.angle, seg: p.seg, s, lat, speed: 0 });
    car.ai.offset = lat;
    car.maxSpeed = 0.01; // praktisch stehend, damit nur der Flug zählt
  };
  put(shooter, start, 0);
  put(target, start + gap, offset);

  const kind = homing ? 'homing' : 'front';
  shooter.ammo[kind] = 1;
  const hpBefore = target.hp;
  const fired = useItem(race, shooter, kind);
  const hadTarget = race.missiles[0]?.target === target;
  for (let t = 0; t < ticks && race.missiles.length; t++) {
    stepRace(race, { left: false, right: false, gas: false, brake: false });
  }
  return {
    homing, offset, gap, fired, hadTarget,
    hit: target.hp < hpBefore,
    damage: Math.round(hpBefore - target.hp),
  };
}

/** Mehrere Seeds über eine Strecke mitteln. */
export function simulateSeries({ stage = 0, difficulty = 'mittel', seeds = 5, firstSeed = 1, ...rest } = {}) {
  const runs = [];
  for (let i = 0; i < seeds; i++) {
    runs.push(simulateRace({ stage, difficulty, seed: firstSeed + i * 977, ...rest }));
  }
  const mean = (fn) => runs.reduce((sum, r) => sum + fn(r), 0) / runs.length;
  return {
    stage,
    difficulty,
    track: runs[0].track,
    runs,
    playerPlace: mean((r) => r.playerPlace),
    playerWins: runs.filter((r) => r.playerPlace === 1).length / runs.length,
    seconds: mean((r) => r.seconds),
    botAvgSpeed: mean((r) => r.botAvgSpeed),
    aiOvertakes: mean((r) => r.aiOvertakes),
    overtakes: mean((r) => r.overtakes),
    contacts: mean((r) => r.contacts),
    aiContacts: mean((r) => r.aiContacts),
    maxBlocked: Math.max(...runs.map((r) => r.maxBlocked)),
    minBotLaps: Math.min(...runs.flatMap((r) => r.botLaps)),
    convoyShare: mean((r) => r.convoyShare),
    offroadShare: mean((r) => r.offroadShare),
    zigzag: mean((r) => r.zigzag),
    unfinished: runs.filter((r) => r.cars.some((c) => !c.finished)).length,
    jumps: mean((r) => r.jumps),
    oilHits: mean((r) => r.oilHits),
    gateStops: mean((r) => r.gateStops),
    gateSwitches: mean((r) => r.gateSwitches),
    bridgeTicks: mean((r) => r.bridgeTicks),
    airTicks: mean((r) => r.airTicks),
    crossLevelPasses: mean((r) => r.crossLevelPasses),
    homingHits: mean((r) => r.homingHits),
    turboUses: mean((r) => r.turboUses),
    turboRams: mean((r) => r.turboRams),
    oilDrops: mean((r) => r.oilDrops),
  };
}
