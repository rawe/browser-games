// KI der Computergegner: datengetriebene Schwierigkeitsprofile plus
// Fahr-, Ausweich- und Überholentscheidung. DOM-frei und deterministisch –
// jeder Zufall läuft über `race.rng`, damit die Headless-Simulation
// reproduzierbar bleibt.

import { gapAlong, offsetPoint, posAt, ROAD_WIDTH } from './trackGeometry.js';
import { elementsAhead, gateDetour, gateState } from './elements.js';
import { fire } from './weapons.js';

/**
 * Schwierigkeitsprofile. Alle KI-Eigenschaften hängen an diesen Werten –
 * neue Stufen brauchen keinen zusätzlichen Code.
 *
 * speed      Faktor auf die Grundgeschwindigkeit der Gegner
 * accel/turn Beschleunigung und Lenkrate
 * curveBrake Kurvendisziplin (größer = mehr Tempoverlust in Kurven)
 * spread     Streuung der Fahrerstärken untereinander
 * lineError  Breite der Pendelbewegung um die Ideallinie (Fahrpräzision)
 * reaction   Ticks zwischen zwei Überholentscheidungen (Reaktionszeit)
 * mistake    Wahrscheinlichkeit pro Tick für einen Fahrfehler
 * aggression Überholbereitschaft: Temposchwelle und Kurventoleranz
 * weapon     Faktor auf die Feuerwahrscheinlichkeit
 * rubberband Stärke des Gummibandeffekts zum Spieler
 */
export const DIFFICULTIES = [
  {
    id: 'leicht',
    name: 'LEICHT',
    hint: 'Langsamer, fehleranfällig – zum Reinkommen',
    speed: 0.9,
    accel: 0.072,
    turn: 0.072,
    curveBrake: 1.2,
    spread: 0.055,
    lineError: 9,
    reaction: 34,
    mistake: 0.0055,
    aggression: 0.4,
    weapon: 0.5,
    rubberband: 0.5,
  },
  {
    id: 'mittel',
    name: 'MITTEL',
    hint: 'Ausgeglichene Gegner auf Augenhöhe',
    speed: 1.06,
    accel: 0.092,
    turn: 0.079,
    curveBrake: 0.98,
    spread: 0.045,
    lineError: 4,
    reaction: 18,
    mistake: 0.0022,
    aggression: 0.75,
    weapon: 1,
    rubberband: 1,
  },
  {
    id: 'schwer',
    name: 'SCHWER',
    hint: 'Schnell, präzise und aggressiv beim Überholen',
    speed: 1.13,
    accel: 0.108,
    turn: 0.085,
    curveBrake: 0.88,
    spread: 0.03,
    lineError: 1.5,
    reaction: 9,
    mistake: 0.0006,
    aggression: 1.15,
    weapon: 1.5,
    rubberband: 1.35,
  },
];

export const DEFAULT_DIFFICULTY = 'mittel';

export const profileFor = (id) =>
  DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY);

/**
 * Fahrmodell-Konstanten, die für alle Stufen gelten. Bewusst als Objekt: die
 * Headless-Simulation kann sie für Parameter-Sweeps überschreiben, ohne dass
 * dafür Code angefasst werden muss.
 */
export const TUNING = {
  maxOffset: ROAD_WIDTH / 2 - 16, // seitlicher Spielraum, ohne ins Gras zu kommen
  passWidth: 27,        // Seitenversatz für einen Überholvorgang
  detectRange: 150,     // Sichtweite nach vorn (Bogenlänge)
  blockRange: 62,       // ab hier gilt ein Vordermann als echtes Hindernis
  sideTolerance: 30,    // seitlicher Abstand, ab dem man aneinander vorbeikommt
  overtakeTicks: 220,   // Zeitfenster für einen Überholversuch
  offsetRate: 0.4,      // maximale Änderung des Seitenversatzes pro Tick
  passRate: 2.5,        // Faktor darauf während eines Überholvorgangs
  creepSpeed: 0.3,      // Mindesttempo (Anteil der Höchstgeschwindigkeit) im Stau
  lineGain: 16,         // wie stark die Ideallinie in die Kurveninnenseite zieht
  lineMax: 20,          // Grenze dafür
  brakeBase: 40,        // Bremsfenster: Grundweite …
  brakeSpeed: 46,       // … und Zuwachs pro Tempoeinheit
  lookBase: 55,         // Zielpunkt: Grundabstand …
  lookSpeed: 8,         // … Zuwachs pro Tempoeinheit …
  lookCurve: 40,        // … und Verkürzung in Kurven
  lookMin: 46,
  // Vorausschau auf Streckenelemente. Muss deutlich weiter reichen als die
  // Sicht auf andere Fahrzeuge: Bei `offsetRate` 0,4 je Tick dauert ein
  // Spurwechsel über die halbe Fahrbahn rund 1,8 s – wer erst 250 Einheiten
  // vorher anfängt, steht bei Renntempo schon an der Schranke.
  hazardBase: 95,
  hazardSpeed: 100,
  gateRate: 2.2,    // Faktor auf die Nachführrate, während eine Sperre umfahren wird
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Folgetempo mit Kriechgrenze: Wer hinter einem stehenden Auto klebt, rollt
 * weiter langsam an, statt auf Null zu regeln – nur so kommt er wieder heraus.
 */
const follow = (car, speed) => Math.max(speed, car.maxSpeed * TUNING.creepSpeed);

/** KI-Zustand eines Autos – wird beim Anlegen des Rennens gesetzt. */
export function createAiState(rng, startOffset) {
  return {
    offset: startOffset,
    wobbleT: rng() * Math.PI * 2,
    wobbleSpeed: 0.006 + rng() * 0.006,
    decideIn: Math.floor(rng() * 20),
    overtakeTicks: 0,
    overtakeLat: 0,
    blockedTicks: 0,
    mistakeTicks: 0,
    mistakeSteer: 0,
  };
}

/**
 * Vorzeichenbehaftete Richtungsänderung der Strecke zwischen zwei Punkten vor
 * dem Auto. Anders als ein Vergleich mit der eigenen Blickrichtung ist das ein
 * reiner Streckenwert – dadurch bleibt die Kurvenbremse stabil, auch wenn das
 * Auto gerade quer steht oder überholt.
 */
function trackCurve(track, s, from, to) {
  const a = posAt(track, s + from).angle;
  const b = posAt(track, s + to).angle;
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Nächstes Fahrzeug vor `car` innerhalb der Sichtweite. */
function scanAhead(race, car) {
  const track = race.track;
  let blocker = null;
  const neighbours = [];
  for (const other of race.cars) {
    if (other === car || other.respawn > 0) continue;
    const gap = gapAlong(track, car.s, other.s);
    if (gap <= 0 || gap > TUNING.detectRange) continue;
    neighbours.push({ car: other, gap, lat: other.lat });
    if (Math.abs(other.lat - car.lat) > TUNING.sideTolerance) continue;
    if (!blocker || gap < blocker.gap) blocker = { car: other, gap, lat: other.lat };
  }
  return { blocker, neighbours };
}

/** Ist die Spur bei `lat` im Bereich vor dem Auto frei? */
function laneFree(neighbours, lat) {
  return !neighbours.some((n) => Math.abs(n.lat - lat) < TUNING.sideTolerance - 6);
}

/**
 * Überholentscheidung. Wird nur alle `reaction` Ticks getroffen – das ist die
 * Reaktionszeit und verhindert zugleich nervöses Hin- und Herspringen.
 */
function decideOvertake(race, car, want, blocker, neighbours, curve, prof) {
  const ai = car.ai;

  // Ein (fast) stehendes Fahrzeug ist ein Hindernis und kein Vordermann –
  // dahinter zu warten hieße, für immer stehen zu bleiben.
  const stalled = blocker.car.speed < Math.max(0.6, want * 0.25);

  // Deutlich langsamerer Vordermann? Je aggressiver, desto kleiner die Schwelle.
  const deficit = want - blocker.car.speed;
  const needed = 0.5 - prof.aggression * 0.28;
  const desperate = stalled || ai.blockedTicks > 150; // hängt schon zu lange fest
  if (deficit < needed && !desperate) return;

  // In engen Kurven ist Überholen zu gefährlich – um ein Hindernis herum
  // muss es trotzdem gehen.
  const curveLimit = 0.34 + prof.aggression * 0.2 + (desperate ? 0.12 : 0);
  if (curve > curveLimit && !stalled) return;

  // Näher liegende Seite zuerst prüfen: Wer schon außen fährt, bleibt außen,
  // statt für den nächsten Vordermann quer über die Strecke zu ziehen.
  const cost = (side) => Math.abs(blocker.lat + side * TUNING.passWidth - car.lat);
  for (const side of cost(1) <= cost(-1) ? [1, -1] : [-1, 1]) {
    const target = blocker.lat + side * TUNING.passWidth;
    if (Math.abs(target) > TUNING.maxOffset) continue;
    if (!laneFree(neighbours, target)) continue;
    // Zögern nach Stufe – vor einem Hindernis wird nicht gezögert.
    if (!stalled && race.rng() > 0.35 + prof.aggression * 0.5) return;
    ai.overtakeTicks = TUNING.overtakeTicks;
    ai.overtakeLat = target;
    return;
  }
}

/**
 * Reaktion auf Streckenelemente: Öllachen umfahren, vor einer geschlossenen
 * Schranke rechtzeitig auf die freie Seite ziehen und notfalls anhalten,
 * Sprungschanzen dagegen mitnehmen.
 *
 * Liefert den angepassten Seitenversatz, das angepasste Wunschtempo und
 * `dodging` – dann wird der Seitenversatz schneller nachgeführt, weil die
 * Sperre nicht wartet. Bewusst als eigene Funktion: `driveAi` bleibt so
 * lesbar, und neue Elementtypen brauchen nur hier einen Zweig.
 */
function avoidHazards(race, car, targetOffset, want, prof) {
  const track = race.track;
  const elements = track.elements;
  let dodging = false;
  if (!elements?.length) return { targetOffset, want, dodging };

  const range = TUNING.hazardBase + car.speed * TUNING.hazardSpeed;
  for (const { el, gap } of elementsAhead(track, elements, car.s, range)) {
    if (el.type === 'oil') {
      // Nur ausweichen, wenn die Lache wirklich auf der geplanten Linie liegt.
      if (Math.abs(el.lat - targetOffset) > el.radius + 14) continue;
      const side = el.lat >= 0 ? -1 : 1;
      const dodge = el.lat + side * (el.radius + 18);
      targetOffset = Math.abs(dodge) <= TUNING.maxOffset
        ? dodge
        : clamp(-el.lat, -TUNING.maxOffset, TUNING.maxOffset);
      // Ganz dicht davor lieber etwas vom Gas – sonst rutscht man mit
      // Höchsttempo hinein, wenn das Ausweichen nicht mehr reicht.
      if (gap < 45) want = Math.min(want, car.maxSpeed * 0.82);
    } else if (el.type === 'gate') {
      // Zustand zum voraussichtlichen Ankunftszeitpunkt prüfen, nicht jetzt –
      // sonst fährt der Bot in eine Schranke, die gerade noch offen ist.
      const eta = Math.round(gap / Math.max(0.6, car.speed));
      const soon = gateState(el, race.time + eta);
      const now = gateState(el, race.time);
      if (!soon.closed && !now.warning) continue;

      const detour = gateDetour(el);
      if (detour === null) {
        // Vollsperre: davor anhalten, bis sie wieder öffnet.
        if (gap < 60) want = 0;
        continue;
      }
      if (Math.abs(targetOffset - el.lat) <= el.width / 2) targetOffset = detour;
      dodging = true;
      // Reicht der Weg nicht mehr, um seitlich herauszukommen: bremsen.
      const need = Math.abs(detour - car.ai.offset);
      if (gap < need * 1.7 + 30) want = Math.min(want, car.maxSpeed * 0.5);
      if (gap < 24 && Math.abs(car.lat - el.lat) <= el.width / 2) want = 0;
    } else if (el.type === 'ramp' && gap < 130) {
      // Schanzen werden mitgenommen, wenn sie ohnehin fast auf der Linie
      // liegen – je aggressiver die Stufe, desto weiter der Griff.
      const reach = el.width / 2 + 10 + prof.aggression * 14;
      if (Math.abs(el.lat - targetOffset) < reach) targetOffset = el.lat;
    }
  }
  return { targetOffset, want, dodging };
}

/**
 * KI-Steuerung für ein Auto. Liefert `{ steer, gas, brake }` wie die
 * Spielereingabe und pflegt nebenbei den KI-Zustand.
 *
 * `profile` lässt sich überschreiben – die Headless-Simulation steuert damit
 * den Spielerwagen mit einem festen Referenzfahrer, unabhängig von der
 * eingestellten Gegnerstärke.
 */
export function driveAi(race, car, profile) {
  const track = race.track;
  const prof = profile ?? race.profile;
  const ai = car.ai;

  // Bremsfenster wächst mit dem Tempo: schnelle Autos sehen die Kurve früher.
  const brakeWindow = TUNING.brakeBase + car.speed * TUNING.brakeSpeed;
  const bend = trackCurve(track, car.s, 12, brakeWindow);
  const curve = Math.abs(bend);
  let want = car.maxSpeed * Math.max(0.42, 1 - curve * prof.curveBrake);

  const { blocker, neighbours } = scanAhead(race, car);

  if (ai.decideIn > 0) ai.decideIn--;
  if (ai.overtakeTicks > 0) ai.overtakeTicks--;

  if (blocker && blocker.gap < TUNING.blockRange && blocker.car.speed < want - 0.15) {
    ai.blockedTicks++;
  } else if (ai.blockedTicks > 0) {
    ai.blockedTicks -= 2;
  }

  if (blocker && ai.overtakeTicks === 0 && ai.decideIn === 0) {
    ai.decideIn = prof.reaction;
    decideOvertake(race, car, want, blocker, neighbours, curve, prof);
  }

  // Überholvorgang beenden, sobald der Gegner hinter uns liegt oder die
  // Situation zu eng wird.
  if (ai.overtakeTicks > 0) {
    const stillAhead = blocker && blocker.gap < TUNING.detectRange;
    if (!stillAhead || curve > 0.62) ai.overtakeTicks = Math.min(ai.overtakeTicks, 26);
    else if (!laneFree(neighbours, ai.overtakeLat)) {
      // Jemand hat die Überholspur belegt: abbrechen und gleich neu entscheiden.
      ai.overtakeTicks = 0;
      ai.decideIn = 0;
    }
  }

  // Ideallinie: in Kurven zur Innenseite ziehen, dazu ein leichtes Pendeln,
  // dessen Breite die Fahrpräzision der Stufe abbildet.
  ai.wobbleT += ai.wobbleSpeed;
  const racingLine = clamp(bend * TUNING.lineGain, -TUNING.lineMax, TUNING.lineMax);
  let targetOffset = racingLine + Math.sin(ai.wobbleT) * prof.lineError;
  if (ai.overtakeTicks > 0) {
    targetOffset = clamp(ai.overtakeLat, -TUNING.maxOffset, TUNING.maxOffset);
    ai.blockedTicks = Math.max(0, ai.blockedTicks - 1);
    want *= 1.05; // Windschatten-Bonus, damit der Zug auch durchgeht
  } else if (blocker && blocker.gap < TUNING.blockRange) {
    // Kein Überholen möglich: Abstand halten statt dauernd aufzufahren –
    // je dichter dran, desto stärker die Gaswegnahme. Die Kriechgrenze sorgt
    // dafür, dass hinter einem stehenden Auto niemand endgültig festfriert.
    const closeness = 1 - clamp(blocker.gap / TUNING.blockRange, 0, 1);
    want = Math.min(want, follow(car, blocker.car.speed * (1.02 - closeness * 0.22)));
    // Zur Seite ausweichen – das öffnet die nächste Lücke.
    const side = blocker.lat >= 0 ? -1 : 1;
    const evade = blocker.car.speed < 0.6 ? TUNING.passWidth : 13;
    targetOffset = clamp(blocker.lat + side * evade, -TUNING.maxOffset, TUNING.maxOffset);
  }

  // Auffahrschutz, gemessen an der tatsächlichen Position: Wer überholt, darf
  // dichter heran – sonst käme er nie neben den Vordermann; erst kurz vor
  // Kontakt wird auch dort vom Gas gegangen.
  const critical = ai.overtakeTicks > 0 ? 27 : 42;
  const inTheWay = neighbours.find((n) => n.gap < critical && Math.abs(n.lat - car.lat) < 22);
  if (inTheWay) want = Math.min(want, follow(car, inTheWay.car.speed * 0.95));

  let dodging = false;
  ({ targetOffset, want, dodging } = avoidHazards(race, car, targetOffset, want, prof));

  // Fahrfehler: kurzer Lenkstoß plus Gaswegnahme, Häufigkeit nach Stufe.
  if (ai.mistakeTicks > 0) {
    ai.mistakeTicks--;
    targetOffset += ai.mistakeSteer * 22;
    want *= 0.9;
  } else if (race.rng() < prof.mistake && race.countdown === 0) {
    ai.mistakeTicks = 24 + Math.floor(race.rng() * 26);
    ai.mistakeSteer = race.rng() < 0.5 ? -1 : 1;
  }

  // Sanft nachführen – harte Sprünge gäben Schlangenlinien. Beim Überholen
  // darf es zügiger gehen, sonst kommt das Auto nicht rechtzeitig vorbei.
  const rate = TUNING.offsetRate
    * (ai.overtakeTicks > 0 ? TUNING.passRate : dodging ? TUNING.gateRate : 1);
  ai.offset += clamp(targetOffset - ai.offset, -rate, rate);

  // Zielpunkt: in Kurven näher heran, sonst würde das Auto die Kurve schneiden.
  const look = Math.max(TUNING.lookMin,
    TUNING.lookBase + car.speed * TUNING.lookSpeed - curve * TUNING.lookCurve);
  const aim = offsetPoint(track, car.s + look, ai.offset);
  let delta = Math.atan2(aim.y - car.y, aim.x - car.x) - car.angle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const steer = clamp(delta * 3.2, -1, 1);

  // Gummiband: abgehängte Gegner holen leicht auf, führende lassen locker.
  const me = race.cars.find((c) => c.isPlayer);
  if (me && prof.rubberband > 0) {
    const gap = me.progress - car.progress;
    if (gap > 700) car.speed *= 1 + 0.002 * prof.rubberband;
    else if (gap < -900) car.speed *= 1 - 0.002 * prof.rubberband;
  }

  aiWeapons(race, car, prof);

  return { steer, gas: car.speed < want, brake: car.speed > want + 0.7 };
}

/** Raketeneinsatz: nach vorn auf Vordermänner, nach hinten gegen Verfolger. */
function aiWeapons(race, car, prof) {
  if (car.fireCooldown !== 0 || car.finished || race.countdown > 0) return;
  for (const other of race.cars) {
    if (other === car || other.respawn > 0) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 60 || dist >= 300) continue;
    let rel = Math.atan2(dy, dx) - car.angle;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (Math.abs(rel) < 0.22 && car.ammoFront > 0 && race.rng() < 0.02 * prof.weapon) {
      fire(race, car, false);
      car.fireCooldown = 140;
      return;
    }
    if (Math.abs(Math.abs(rel) - Math.PI) < 0.22 && car.ammoRear > 0 && race.rng() < 0.012 * prof.weapon) {
      fire(race, car, true);
      car.fireCooldown = 140;
      return;
    }
  }
}
