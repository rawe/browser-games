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
import { createRace, playerCar, standings, stepRace } from '../race.js';
import { createAiState, driveAi, profileFor } from '../ai.js';
import { gapAlong, posAt } from '../trackGeometry.js';

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
  ammoFront: 2 + stage,
  ammoRear: 1 + Math.floor(stage / 2),
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
  };
}
