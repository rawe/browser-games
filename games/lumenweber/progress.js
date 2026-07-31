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
