// Ausrüstung auslösen – eigenes Modul, damit die KI dieselben Wege benutzt wie
// der Spieler, ohne dass Rennlogik und KI sich gegenseitig importieren müssen.
//
// `useItem` ist der einzige Einstieg: Bestand prüfen, abbuchen, Wirkung
// auslösen. Ein neues Item braucht hier einen Eintrag in `EFFECTS`.

import { gapAlong } from './trackGeometry.js';
import { dropOil } from './elements.js';
import { MISSILE, OIL_DROP, TURBO } from './items.js';

/** Nächstes Fahrzeug vor `car` – Ziel einer Zielsuchrakete. */
function targetAhead(race, car) {
  let best = null;
  for (const other of race.cars) {
    if (other === car || other.respawn > 0 || other.finished) continue;
    if (other.level !== car.level) continue; // andere Höhenebene, nicht erreichbar
    const gap = gapAlong(race.track, car.s, other.s);
    if (gap <= 0 || gap > MISSILE.homing.range) continue;
    if (!best || gap < best.gap) best = { car: other, gap };
  }
  return best?.car ?? null;
}

function launch(race, car, kind) {
  const spec = MISSILE[kind];
  const angle = kind === 'rear' ? car.angle + Math.PI : car.angle;
  race.missiles.push({
    x: car.x + Math.cos(angle) * 20,
    y: car.y + Math.sin(angle) * 20,
    angle,
    speed: spec.speed + Math.max(0, car.speed),
    life: spec.life,
    owner: car,
    kind,
    damage: spec.damage,
    target: kind === 'homing' ? targetAhead(race, car) : null,
    level: car.level ?? 0, // trifft nur Fahrzeuge auf derselben Höhenebene
    grace: 12,             // kurz nach dem Start immun gegen den eigenen Schützen
  });
  race.events.push({ type: kind === 'homing' ? 'homing' : 'fire' });
  return true;
}

/**
 * Wirkung je Item. Rückgabe `false` heißt „ging nicht" – dann wird auch
 * nichts vom Bestand abgezogen.
 */
const EFFECTS = {
  front: (race, car) => launch(race, car, 'front'),
  rear: (race, car) => launch(race, car, 'rear'),
  homing: (race, car) => launch(race, car, 'homing'),

  turbo(race, car) {
    if (car.turbo > 0) return false; // kein Stapeln
    car.turboMax = TURBO.ticks;
    car.turbo = TURBO.ticks;
    race.stats.turboUses++;
    race.events.push({ type: 'turbo' });
    return true;
  },

  oil(race, car) {
    // Hinter dem Fahrzeug ablegen, sonst führe man selbst hinein.
    const x = car.x - Math.cos(car.angle) * OIL_DROP.behind;
    const y = car.y - Math.sin(car.angle) * OIL_DROP.behind;
    const el = dropOil(race.track, x, y, car.seg, car, race.time);
    if (!el) return false;
    race.track.elements.push(el);
    race.stats.oilDrops++;
    race.events.push({ type: 'drop' });
    return true;
  },
};

/**
 * Ein Ausrüstungsstück einsetzen. `id` ist eine Item-ID aus `items.js`.
 * Liefert `true`, wenn es tatsächlich ausgelöst wurde.
 */
export function useItem(race, car, id) {
  if (car.respawn > 0 || race.countdown > 0 || car.finished) return false;
  const effect = EFFECTS[id];
  if (!effect) return false;
  if ((car.ammo?.[id] ?? 0) <= 0) return false;
  if (!effect(race, car)) return false;
  car.ammo[id]--;
  return true;
}
