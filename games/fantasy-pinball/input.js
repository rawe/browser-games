// Unsichtbare Zweihand-Steuerung: jeder Pointer gehört bis zum Loslassen der
// Hälfte, auf der er begann. Damit funktionieren beide Daumen gleichzeitig.

const KEY_SIDE = Object.freeze({
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
});

export function createInput(surface, handlers) {
  const pointers = new Map();
  const keys = new Set();

  function sideIsActive(side) {
    if ([...pointers.values()].includes(side)) return true;
    for (const code of keys) if (KEY_SIDE[code] === side) return true;
    return false;
  }

  function sync() {
    handlers.onFlipper('left', sideIsActive('left'));
    handlers.onFlipper('right', sideIsActive('right'));
  }

  function pointerDown(event) {
    if (event.target.closest?.('a, button')) return;
    const rect = surface.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    pointers.set(event.pointerId, side);
    surface.setPointerCapture?.(event.pointerId);
    handlers.onInteraction?.();
    sync();
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    sync();
    event.preventDefault();
  }

  function keyDown(event) {
    if (KEY_SIDE[event.code]) {
      keys.add(event.code);
      handlers.onInteraction?.();
      sync();
      event.preventDefault();
    }
    if (event.code === 'KeyR' && !event.repeat) {
      handlers.onRestart?.();
      event.preventDefault();
    }
  }

  function keyUp(event) {
    if (!KEY_SIDE[event.code]) return;
    keys.delete(event.code);
    sync();
    event.preventDefault();
  }

  function releaseAll() {
    pointers.clear();
    keys.clear();
    sync();
  }

  surface.addEventListener('pointerdown', pointerDown);
  surface.addEventListener('pointerup', pointerUp);
  surface.addEventListener('pointercancel', pointerUp);
  surface.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', releaseAll);

  return {
    releaseAll,
    // Anschluss für eine spätere Sensor-Pipeline. Die Berechtigungsabfrage und
    // Tilt-Regeln gehören bewusst nicht in diesen ersten Prototyp.
    feedMotion({ x = 0, y = 0 }) { handlers.onNudge?.(x, y); },
  };
}
