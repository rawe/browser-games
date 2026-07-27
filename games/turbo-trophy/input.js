// Eingabe: Tastatur und Touch-Buttons auf einen gemeinsamen Steuerzustand
// abbilden. Ausrüstung sind Einzelauslöser und laufen über `onUse(id)`.
//
// Die Ausrüstungsknöpfe und ihre Tastenkürzel entstehen aus `ITEMS`
// (items.js) – ein weiteres Item braucht hier keine Zeile Code.
//
// Gas ist ein Sonderfall: Der Touch-Button arbeitet als Dauergas-Schalter
// (Zustandsmaschine in `throttle.js`), damit man beim Auslösen einer Rakete
// nicht vom Gas muss. Die Tastatur bleibt beim klassischen Halten.

import { ITEMS } from './items.js';
import { createThrottle } from './throttle.js';

const HOLD_KEYS = {
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'gas', w: 'gas',
  arrowdown: 'brake', s: 'brake',
};

/** Tastenkürzel → Item-ID, aus der Item-Liste aufgebaut. */
const ITEM_KEYS = Object.fromEntries(
  ITEMS.filter((item) => item.key).map((item) => [item.key.toLowerCase(), item.id]),
);
// Rückwärtskompatibel: Shift löst weiterhin die Heck-Rakete aus.
ITEM_KEYS.shift ??= 'rear';

export function createInput({ onUse, onActivate, isRacing, onLatch }) {
  const controls = { left: false, right: false, gas: false, brake: false };
  const keyGas = { down: false };
  const throttle = createThrottle();
  const el = (id) => document.getElementById(id);

  const gasBtn = el('btn-gas');
  const gasState = el('gas-state');
  const itemBtns = [];
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

  function bindTap(button, id) {
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      onActivate();
      button.classList.add('on');
      onUse?.(id);
    }, { passive: false });
    button.addEventListener('touchend', (e) => {
      e.preventDefault();
      button.classList.remove('on');
    });
    button.addEventListener('touchcancel', () => button.classList.remove('on'));
    button.addEventListener('mousedown', () => {
      onActivate();
      onUse?.(id);
    });
  }

  /**
   * Einen Knopf je Item bauen: Symbol, Kurzbezeichnung und Restbestand.
   * Den Bestand schreibt das HUD in `#ammo-<id>`, es schaltet die Knöpfe bei
   * leerem Bestand auch auf `disabled`.
   */
  function buildItemButtons(host) {
    for (const item of ITEMS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tc-btn item';
      button.id = `btn-item-${item.id}`;
      button.dataset.item = item.id;
      button.setAttribute('aria-label', `${item.name} einsetzen`);
      button.innerHTML = `
        <span class="item-top">
          <span class="item-icon">${item.icon}</span>
          <span class="item-count" id="ammo-${item.id}">0</span>
        </span>
        <span class="item-label">${item.label}</span>`;
      host.append(button);
      bindTap(button, item.id);
      itemBtns.push(button);
    }
  }

  bindHold(el('btn-left'), 'left');
  bindHold(el('btn-right'), 'right');
  bindHold(el('btn-brake'), 'brake');
  bindGas(gasBtn);
  buildItemButtons(el('tc-items'));

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
    const item = ITEM_KEYS[key];
    if (item) {
      if (key === ' ' && isRacing()) e.preventDefault(); // sonst scrollt das Overlay
      onUse?.(item);
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
      for (const button of itemBtns) button.classList.remove('on');
      sync();
    },
  };
}
