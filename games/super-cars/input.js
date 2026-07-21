// Eingaben: Tastatur (Desktop) und Touch-Buttons (Smartphone, Hochformat).
// Liefert pro Frame { throttle, brake, steer } plus Flanken-Events für Feuern/Waffenwechsel.

export function createInput() {
  const held = new Set();
  const touch = { left: false, right: false, gas: false, brake: false };
  let firePressed = false;
  let togglePressed = false;

  const keyMap = {
    ArrowUp: 'gas', KeyW: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };

  window.addEventListener('keydown', (e) => {
    if (keyMap[e.code]) { held.add(keyMap[e.code]); e.preventDefault(); }
    if (e.code === 'Space') { firePressed = true; e.preventDefault(); }
    if (e.code === 'KeyQ') { togglePressed = true; }
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) held.delete(keyMap[e.code]);
  });
  window.addEventListener('blur', () => held.clear());

  // Touch-Buttons: pointerdown/-up pro Element, Multi-Touch-fähig
  function bindHold(id, prop) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); touch[prop] = true; el.classList.add('active'); };
    const up = (e) => { e.preventDefault(); touch[prop] = false; el.classList.remove('active'); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindHold('btn-left', 'left');
  bindHold('btn-right', 'right');
  bindHold('btn-gas', 'gas');
  bindHold('btn-brake', 'brake');

  const fireBtn = document.getElementById('btn-fire');
  if (fireBtn) {
    fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); firePressed = true; });
    fireBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const weaponBtn = document.getElementById('btn-weapon');
  if (weaponBtn) {
    weaponBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); togglePressed = true; });
    weaponBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  let steerSmooth = 0;

  return {
    read(dt) {
      const left = held.has('left') || touch.left;
      const right = held.has('right') || touch.right;
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      // weiches Ein-/Auslenken für digitale Eingaben
      const rate = target === 0 ? 10 : 6;
      steerSmooth += (target - steerSmooth) * Math.min(1, rate * dt);
      if (Math.abs(steerSmooth) < 0.02 && target === 0) steerSmooth = 0;

      const fire = firePressed;
      const toggle = togglePressed;
      firePressed = false;
      togglePressed = false;

      return {
        throttle: held.has('gas') || touch.gas ? 1 : 0,
        brake: held.has('brake') || touch.brake ? 1 : 0,
        steer: steerSmooth,
        fire,
        toggle,
      };
    },
  };
}
