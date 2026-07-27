// Raketen abfeuern – eigenes Modul, damit die KI feuern kann, ohne dass
// Rennlogik und KI sich gegenseitig importieren müssen.

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
