// Bildschirme und Kurzmeldungen.
//
// Es liegt immer höchstens ein Bildschirm über dem Spiel. Die Verwaltung an
// einer Stelle zu bündeln hält den Weg zurück ins Spiel eindeutig.

export function createScreens(elements, initial = null) {
  let current = initial;
  let toastTimer = 0;

  const show = (name) => {
    if (current && elements[current]) elements[current].hidden = true;
    current = name;
    if (name && elements[name]) elements[name].hidden = false;
  };

  return {
    get current() { return current; },
    show,
    close: () => show(null),
    isOpen: () => current !== null,

    toast(text, ms = 2200) {
      const node = elements.toast;
      if (!node) return;
      node.textContent = text;
      node.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { node.hidden = true; }, ms);
    },
  };
}

/**
 * Eine Reihe von Auswahlknöpfen – als `role="radio"`, damit Vorleseprogramme
 * sie als Auswahl erkennen.
 */
export function buildChoices(container, options, selected, onPick) {
  container.replaceChildren(...options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = option.name;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(option.id === selected));
    button.addEventListener('click', () => {
      for (const other of container.children) other.setAttribute('aria-checked', 'false');
      button.setAttribute('aria-checked', 'true');
      onPick(option.id);
    });
    return button;
  }));
}
