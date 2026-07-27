// Eingabe: Tastatur und Touch-Buttons auf einen gemeinsamen Steuerzustand
// abbilden. Raketen sind Einzelauslöser und laufen über `onFire`.
//
// Gas ist ein Sonderfall: Der Touch-Button arbeitet als Dauergas-Schalter
// (Zustandsmaschine in `throttle.js`), damit man beim Auslösen einer Rakete
// nicht vom Gas muss. Die Tastatur bleibt beim klassischen Halten.

import { createThrottle } from './throttle.js';

const HOLD_KEYS = {
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'gas', w: 'gas',
  arrowdown: 'brake', s: 'brake',
};

export function createInput({ onFire, onActivate, isRacing, onLatch }) {
  const controls = { left: false, right: false, gas: false, brake: false };
  const keyGas = { down: false };
  const throttle = createThrottle();
  const el = (id) => document.getElementById(id);

  const gasBtn = el('btn-gas');
  const gasState = el('gas-state');
  const now = () => performance.now();

  let lastLatched = false;

  /** Gas aus Tastatur und Dauergas-Schalter zusammenführen und anzeigen. */
  function sync() {
    controls.gas = keyGas.down || throttle.active;
    gasBtn.classList.toggle('on', throttle.held);
    gasBtn.classList.toggle('latched', throttle.latched);
    gasState.textContent = throttle.latched ? 'DAUERGAS AN' : 'TIPPEN = DAUERGAS';
    if (throttle.latched !== lastLatched) {
      lastLatched = throttle.latched;
      onLatch?.(throttle.latched);
    }
  }

  /** Bremse betätigt – beendet zugleich das Dauergas. */
  function setBrake(on) {
    controls.brake = on;
    if (on) throttle.brake();
    sync();
  }

  function bindHold(button, key) {
    const press = (e) => {
      e.preventDefault();
      onActivate();
      button.classList.add('on');
      if (key === 'brake') setBrake(true);
      else controls[key] = true;
    };
    const release = (e) => {
      if (e) e.preventDefault();
      button.classList.remove('on');
      if (key === 'brake') setBrake(false);
      else controls[key] = false;
    };
    button.addEventListener('touchstart', press, { passive: false });
    button.addEventListener('touchend', release);
    button.addEventListener('touchcancel', release);
    button.addEventListener('mousedown', press);
    button.addEventListener('mouseup', release);
    button.addEventListener('mouseleave', release);
  }

  /** Gas-Button: Tippen schaltet Dauergas um, Halten gibt Gas wie gehabt. */
  function bindGas(button) {
    const press = (e) => {
      e.preventDefault();
      onActivate();
      throttle.press(now());
      sync();
    };
    const release = (e) => {
      if (e) e.preventDefault();
      throttle.release(now());
      sync();
    };
    const cancel = () => {
      throttle.cancel();
      sync();
    };
    button.addEventListener('touchstart', press, { passive: false });
    button.addEventListener('touchend', release);
    button.addEventListener('touchcancel', cancel);
    button.addEventListener('mousedown', press);
    button.addEventListener('mouseup', release);
    // Rutscht die Maus vom Button, endet nur der Druck – ein aktives
    // Dauergas soll davon nicht abfallen.
    button.addEventListener('mouseleave', cancel);
  }

  function bindTap(button, rear) {
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      onActivate();
      button.classList.add('on');
      onFire(rear);
    }, { passive: false });
    button.addEventListener('touchend', (e) => {
      e.preventDefault();
      button.classList.remove('on');
    });
    button.addEventListener('mousedown', () => {
      onActivate();
      onFire(rear);
    });
  }

  bindHold(el('btn-left'), 'left');
  bindHold(el('btn-right'), 'right');
  bindHold(el('btn-brake'), 'brake');
  bindGas(gasBtn);
  bindTap(el('btn-fire-front'), false);
  bindTap(el('btn-fire-rear'), true);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const hold = HOLD_KEYS[key];
    if (hold) {
      if (hold === 'gas') keyGas.down = true;
      else if (hold === 'brake') setBrake(true);
      else controls[hold] = true;
      sync();
      return;
    }
    if (key === ' ') {
      if (isRacing()) e.preventDefault(); // sonst scrollt das Overlay
      onFire(false);
    } else if (key === 'x' || key === 'shift') {
      onFire(true);
    }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const hold = HOLD_KEYS[key];
    if (!hold) return;
    if (hold === 'gas') keyGas.down = false;
    else if (hold === 'brake') setBrake(false);
    else controls[hold] = false;
    sync();
  });

  // Während des Rennens kein Wischen/Überscrollen – die Overlays bleiben scrollbar.
  document.addEventListener('touchmove', (e) => {
    if (isRacing()) e.preventDefault();
  }, { passive: false });

  sync();

  return {
    controls,
    /** Beim Verlassen des Rennens hängende Tasten und das Dauergas zurücksetzen. */
    reset() {
      for (const key of Object.keys(controls)) controls[key] = false;
      keyGas.down = false;
      throttle.reset();
      for (const id of ['btn-left', 'btn-right', 'btn-brake']) el(id).classList.remove('on');
      sync();
    },
  };
}
