// HUD: Position, Runde, Karosseriezustand, Ausrüstungsbestand, Turbo und die
// großen Mitteltexte (Countdown, „LOS!“, „ZERSTÖRT!“).
//
// Der Bestand steht auf den Ausrüstungsknöpfen selbst – doppelte Anzeigen
// bringen auf einem Handybildschirm nichts. Die Knöpfe baut `input.js` aus
// `ITEMS`, hier werden sie nur beschriftet und bei leerem Bestand gesperrt.

import { ITEMS } from './items.js';
import { playerCar, standings } from './race.js';

const HEALTH_GRADIENTS = [
  [50, 'linear-gradient(90deg,#5be07a,#b9e05b)'],
  [25, 'linear-gradient(90deg,#ffd23f,#ffb03a)'],
  [-1, 'linear-gradient(90deg,#ff4f7b,#ff5a2e)'],
];

export function createHud() {
  const el = (id) => document.getElementById(id);
  const posEl = el('hud-pos');
  const lapEl = el('hud-lap');
  const healthEl = el('hud-health-fill');
  const messageEl = el('message');
  const submessageEl = el('submessage');
  const gasEl = el('hud-gas');
  const turboEl = el('hud-turbo');
  const turboFillEl = el('hud-turbo-fill');

  // Die Item-Knöpfe entstehen erst zur Laufzeit – darum bei Bedarf suchen.
  const nodes = {};
  const findNode = (id) => (nodes[id] ||= document.getElementById(id));

  let flashText = '';
  let flashUntil = 0;
  const cache = {};

  const set = (node, key, value) => {
    if (cache[key] === value) return;
    cache[key] = value;
    node.textContent = value;
  };

  function setMessage(main, sub) {
    set(messageEl, 'message', main);
    set(submessageEl, 'submessage', sub);
  }

  /** Restbestand aller Items auf die Knöpfe schreiben. */
  function setAmmo(ammo = {}) {
    for (const item of ITEMS) {
      const count = Math.max(0, ammo[item.id] ?? 0);
      const countEl = findNode(`ammo-${item.id}`);
      if (countEl) set(countEl, `ammo-${item.id}`, String(count));
      const button = findNode(`btn-item-${item.id}`);
      if (button) button.disabled = count <= 0;
    }
  }

  /** Turbo: Anzeige nur während des Schubs, Balken zeigt die Restdauer. */
  function setTurbo(car) {
    const left = Math.max(0, car.turbo ?? 0);
    const pct = left > 0 ? Math.round((left / Math.max(1, car.turboMax || 1)) * 100) : 0;
    turboEl.classList.toggle('hidden', left <= 0);
    if (cache.turbo === pct) return;
    cache.turbo = pct;
    turboFillEl.style.width = `${pct}%`;
  }

  return {
    /** Kurzer Mitteltext, der nach `ms` von selbst verschwindet. */
    flash(text, ms) {
      flashText = text;
      flashUntil = performance.now() + ms;
    },

    clear() {
      setMessage('', '');
      flashUntil = 0;
      gasEl.classList.add('hidden');
      turboEl.classList.add('hidden');
      cache.turbo = undefined;
    },

    /** Dauergas-Anzeige – wird von der Eingabe umgeschaltet, nicht pro Frame. */
    setThrottleLatched(latched) {
      gasEl.classList.toggle('hidden', !latched);
    },

    update(race) {
      const me = playerCar(race);
      const place = standings(race).indexOf(me) + 1;
      set(posEl, 'pos', `${place}/${race.cars.length}`);
      set(lapEl, 'lap', `${Math.max(1, Math.min(me.lap, race.track.def.laps))}/${race.track.def.laps}`);
      setAmmo(me.ammo);
      setTurbo(me);

      const hp = Math.max(0, me.hp);
      if (cache.hp !== hp) {
        cache.hp = hp;
        healthEl.style.width = `${hp}%`;
        healthEl.style.background = HEALTH_GRADIENTS.find(([min]) => hp > min)[1];
      }

      if (me.respawn > 0) setMessage('ZERSTÖRT!', 'Neustart...');
      else if (race.countdown > 0) {
        setMessage(String(Math.ceil(race.countdown / 60)), `${race.track.def.name} • ${race.track.def.laps} RUNDEN`);
      } else if (performance.now() < flashUntil) setMessage(flashText, '');
      else setMessage('', '');
    },

    /** Bestandsanzeige außerhalb des Rennens (Menü/Shop). */
    showCareerAmmo(career) {
      setAmmo(career.ammo);
    },
  };
}
