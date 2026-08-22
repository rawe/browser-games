// Bildschirme und Kurzmeldungen.
//
// Es liegt immer höchstens ein Bildschirm über dem Brett. Die Verwaltung an
// einer Stelle zu bündeln erspart es, an zwölf Stellen daran zu denken, den
// vorigen wieder auszublenden – und hält den Weg zurück ins Spiel eindeutig.

/**
 * @param {Record<string, HTMLElement>} elements
 * @param {string|null} initial  Bildschirm, der im HTML schon offen steht –
 *        das Titelbild ist ohne `hidden` ausgezeichnet, damit beim Laden kein
 *        leeres Brett aufblitzt.
 */
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

    /** Kurze Meldung am unteren Rand – verschwindet von selbst. */
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
 * Eine Reihe von Auswahlknöpfen bauen.
 *
 * Bewusst `role="radio"` statt echter Eingabefelder: Die Knöpfe sollen wie die
 * übrigen Schaltflächen des Spiels aussehen, müssen aber für Vorleseprogramme
 * als Auswahl erkennbar bleiben.
 *
 * @param {HTMLElement} container
 * @param {{id: string, name: string}[]} options
 * @param {string} selected
 * @param {(id: string) => void} onPick
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
      for (const sibling of container.children) sibling.setAttribute('aria-checked', 'false');
      button.setAttribute('aria-checked', 'true');
      onPick(option.id);
    });
    return button;
  }));
}
