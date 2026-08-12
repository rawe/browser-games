// Laufzeit-Registry der Tischelemente. Definition, Lebenszyklus und sichtbare
// Animation sind unabhängig von Physik und Canvas.

const APPEAR_MS = 520;

function cloneElement(element) {
  return {
    ...element,
    active: element.active !== false,
    presentation: { scale: element.active === false ? 0 : 1, glow: 0 },
    animation: null,
  };
}

export function createBoard(definition) {
  const elements = new Map(definition.elements.map((element) => [element.id, cloneElement(element)]));
  const listeners = new Set();

  const notify = (change) => listeners.forEach((listener) => listener(change));

  function add(element, options = {}) {
    if (!element?.id || elements.has(element.id)) return false;
    const runtime = cloneElement({ ...element, active: options.active ?? element.active });
    elements.set(runtime.id, runtime);
    notify({ type: 'added', element: runtime });
    if (runtime.active && options.animate) animate(runtime.id, 'appear');
    return true;
  }

  function remove(id) {
    const element = elements.get(id);
    if (!element) return false;
    elements.delete(id);
    notify({ type: 'removed', element });
    return true;
  }

  function activate(id, options = {}) {
    const element = elements.get(id);
    if (!element || element.active) return false;
    element.active = true;
    notify({ type: 'activated', element });
    if (options.animate) animate(id, 'appear', options.now);
    else element.presentation.scale = 1;
    return true;
  }

  function deactivate(id) {
    const element = elements.get(id);
    if (!element || !element.active) return false;
    element.active = false;
    element.animation = null;
    element.presentation.scale = 0;
    notify({ type: 'deactivated', element });
    return true;
  }

  function patch(id, changes) {
    const element = elements.get(id);
    if (!element) return false;
    Object.assign(element, changes);
    notify({ type: 'patched', element, changes });
    return true;
  }

  function animate(id, kind, now = 0) {
    const element = elements.get(id);
    if (!element) return false;
    element.animation = { kind, start: now, duration: APPEAR_MS };
    if (kind === 'appear') element.presentation.scale = 0.06;
    notify({ type: 'animation-started', element, kind });
    return true;
  }

  function update(now) {
    for (const element of elements.values()) {
      const animation = element.animation;
      if (!animation) {
        element.presentation.glow *= 0.9;
        continue;
      }
      const t = Math.min(1, Math.max(0, (now - animation.start) / animation.duration));
      if (animation.kind === 'appear') {
        const overshoot = 1 + Math.sin(t * Math.PI) * 0.22;
        element.presentation.scale = Math.max(0.06, t * overshoot);
        element.presentation.glow = 1 - t * 0.35;
      }
      if (t >= 1) {
        element.presentation.scale = 1;
        element.animation = null;
        notify({ type: 'animation-finished', element });
      }
    }
  }

  function reset() {
    const fresh = definition.elements.map(cloneElement);
    elements.clear();
    fresh.forEach((element) => elements.set(element.id, element));
    notify({ type: 'reset', elements: fresh });
  }

  return {
    elements,
    flippers: definition.flippers,
    ball: definition.ball,
    add,
    remove,
    activate,
    deactivate,
    patch,
    animate,
    update,
    reset,
    get: (id) => elements.get(id),
    list: () => [...elements.values()],
    active: () => [...elements.values()].filter((element) => element.active),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const BOARD_ANIMATION_MS = APPEAR_MS;
