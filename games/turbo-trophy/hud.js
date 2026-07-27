// HUD: Position, Runde, Karosseriezustand, Munition und die großen
// Mitteltexte (Countdown, „LOS!“, „ZERSTÖRT!“).

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
  const ammoEls = { front: el('ammo-front'), rear: el('ammo-rear') };

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
      set(ammoEls.front, 'ammoFront', String(me.ammoFront));
      set(ammoEls.rear, 'ammoRear', String(me.ammoRear));

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

    /** Munitionsanzeige außerhalb des Rennens (Menü/Shop). */
    showCareerAmmo(career) {
      set(ammoEls.front, 'ammoFront', String(career.ammoFront));
      set(ammoEls.rear, 'ammoRear', String(career.ammoRear));
    },
  };
}
