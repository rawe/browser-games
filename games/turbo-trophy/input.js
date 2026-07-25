// Eingabe: Tastatur und Touch-Buttons auf einen gemeinsamen Steuerzustand
// abbilden. Raketen sind Einzelauslöser und laufen über `onFire`.

const HOLD_KEYS = {
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'gas', w: 'gas',
  arrowdown: 'brake', s: 'brake',
};

export function createInput({ onFire, onActivate, isRacing }) {
  const controls = { left: false, right: false, gas: false, brake: false };
  const el = (id) => document.getElementById(id);

  function bindHold(button, key) {
    const press = (e) => {
      e.preventDefault();
      onActivate();
      button.classList.add('on');
      controls[key] = true;
    };
    const release = (e) => {
      if (e) e.preventDefault();
      button.classList.remove('on');
      controls[key] = false;
    };
    button.addEventListener('touchstart', press, { passive: false });
    button.addEventListener('touchend', release);
    button.addEventListener('touchcancel', release);
    button.addEventListener('mousedown', press);
    button.addEventListener('mouseup', release);
    button.addEventListener('mouseleave', release);
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
  bindHold(el('btn-gas'), 'gas');
  bindTap(el('btn-fire-front'), false);
  bindTap(el('btn-fire-rear'), true);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (HOLD_KEYS[key]) {
      controls[HOLD_KEYS[key]] = true;
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
    if (HOLD_KEYS[key]) controls[HOLD_KEYS[key]] = false;
  });

  // Während des Rennens kein Wischen/Überscrollen – die Overlays bleiben scrollbar.
  document.addEventListener('touchmove', (e) => {
    if (isRacing()) e.preventDefault();
  }, { passive: false });

  return {
    controls,
    /** Beim Verlassen des Rennens hängende Tasten zurücksetzen. */
    reset() {
      for (const key of Object.keys(controls)) controls[key] = false;
      for (const id of ['btn-left', 'btn-right', 'btn-gas']) el(id).classList.remove('on');
    },
  };
}
