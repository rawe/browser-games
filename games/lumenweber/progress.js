// Fortschritt im localStorage.
//
// Bewusst fehlertolerant: Ein privater Modus oder ein voller Speicher darf das
// Spiel nicht lahmlegen – dann wird eben nichts gemerkt.

const KEY = 'lumenweber:progress:v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* egal */ }
}

export function loadProgress() {
  const data = read();
  return typeof data === 'object' && data ? data : {};
}

/** Bestes Ergebnis eines Levels merken (mehr Sterne / weniger Züge gewinnen). */
export function recordSolve(id, { stars, moves }) {
  const data = loadProgress();
  const prev = data[id];
  if (!prev || stars > prev.stars || (stars === prev.stars && moves < prev.moves)) {
    data[id] = { stars, moves };
    write(data);
  }
  return data;
}

/** Ein Level ist offen, wenn es das erste ist oder das vorige gelöst wurde. */
export function isUnlocked(levels, index, progress) {
  if (index === 0) return true;
  return Boolean(progress[levels[index - 1].id]);
}

/** Index des ersten noch ungelösten, aber offenen Levels. */
export function nextOpenIndex(levels, progress) {
  const first = levels.findIndex((l) => !progress[l.id]);
  return first === -1 ? levels.length - 1 : first;
}

export function totalStars(levels, progress) {
  return levels.reduce((sum, l) => sum + (progress[l.id]?.stars ?? 0), 0);
}

/** Wurde schon einmal gespielt? Steuert, ob die Regeln automatisch aufgehen. */
export function hasSeenRules() {
  try { return localStorage.getItem(`${KEY}:rules`) === '1'; } catch { return false; }
}

export function markRulesSeen() {
  try { localStorage.setItem(`${KEY}:rules`, '1'); } catch { /* egal */ }
}

/**
 * Lehrkarten: Jede neue Mechanik wird genau einmal erklärt.
 *
 * Eigener Schlüssel je Karte, damit eine neue Mechanik später dazukommen kann,
 * ohne den Fortschritt anzufassen – dieselbe Trennung wie beim Regelbildschirm.
 */
export function hasSeenTeach(id) {
  try { return localStorage.getItem(`${KEY}:teach:${id}`) === '1'; } catch { return false; }
}

export function markTeachSeen(id) {
  try { localStorage.setItem(`${KEY}:teach:${id}`, '1'); } catch { /* egal */ }
}

/* ---------- Selbstgebaute Level ---------- */
//
// Eigener Schlüssel, eigener Namensraum. Der Fortschritt der Kampagne ist nach
// `level.id` abgelegt – hieße ein selbstgebautes Level „l07“, überschriebe es
// den Stand des siebten eingebauten Levels. Zwei Schlösser dagegen: ein zweiter
// Speicherschlüssel und IDs, die mit „u“ beginnen (`STUDIO_PREFIX`).
//
// Geteilte Level schreiben hier gar nichts, solange sie niemand übernimmt.

const STUDIO_KEY = 'lumenweber:studio:v1';

/** Präfix aller selbstgebauten Level-IDs. Eingebaute heißen `l01`…`l30`. */
export const STUDIO_PREFIX = 'u';

/** Gehört diese ID einem selbstgebauten Level? */
export const isStudioId = (id) => typeof id === 'string' && id.startsWith(STUDIO_PREFIX);

export function readStudio() {
  try {
    const raw = localStorage.getItem(STUDIO_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && Array.isArray(data.levels) ? data : { levels: [] };
  } catch {
    return { levels: [] };
  }
}

/** @returns {boolean} false, wenn der Speicher voll oder gesperrt ist. */
export function writeStudio(data) {
  try {
    localStorage.setItem(STUDIO_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
