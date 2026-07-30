// Gemeinsamer, abgesicherter Zugriff auf `localStorage`.
//
// Grundsatz: Der Speicher darf das Spiel nie zu Fall bringen. Im privaten Modus
// wirft bereits der Zugriff auf `localStorage`, gespeichertes JSON kann veraltet
// oder von Hand verbogen sein. Alle Zugriffe liefern darum im Zweifel
// „nichts gespeichert" – dann gilt der Auslieferungszustand.

/**
 * Einmalig prüfen, ob ein benutzbarer Speicher da ist. Ein Schreibversuch ist
 * nötig, weil manche Browser `localStorage` zwar anbieten, aber jedes
 * `setItem` ablehnen.
 */
export const store = (() => {
  try {
    const s = globalThis.localStorage;
    const probe = 'turbo-trophy:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
})();

/** Rohtext lesen – `null`, wenn nichts da ist oder der Speicher zickt. */
export function readRaw(key) {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Text ablegen. `false`, wenn der Speicher nicht mitspielt. */
export function writeRaw(key, text) {
  if (!store) return false;
  try {
    store.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

/** Eintrag entfernen. Fehler sind hier bedeutungslos. */
export function removeKey(key) {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nichts zu tun */
  }
}

/** JSON lesen – `null` bei fehlendem oder kaputtem Eintrag. */
export function readJson(key) {
  const raw = readRaw(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** JSON ablegen. `false`, wenn der Speicher nicht mitspielt. */
export const writeJson = (key, value) => writeRaw(key, JSON.stringify(value));
