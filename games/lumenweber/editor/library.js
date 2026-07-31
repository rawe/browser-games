// Die eigene Levelbibliothek im localStorage.
//
// DOM-frei. Liegt in einem **eigenen Speicherschlüssel** und benutzt einen
// eigenen Namensraum für IDs (`progress.js`): Der Fortschritt der Kampagne ist
// nach `level.id` abgelegt, ein selbstgebautes Level namens „l07“ würde sonst
// den Stand des siebten eingebauten Levels überschreiben. Beides bleibt hier
// strikt getrennt – die 30 eingebauten Level und ihre Sterne kann der Editor
// gar nicht erreichen.
//
// ── Der Bestwert ────────────────────────────────────────────────────────────
// Selbstgebaute Level haben kein `par`. Sie haben einen **Bestwert**: die
// kleinste Zugzahl, mit der das Level bisher gelöst wurde. Den ersten Eintrag
// liefert der Ersteller in seinem Probelauf – das ist zugleich der Nachweis,
// dass das Level überhaupt lösbar ist. Wer ihn unterbietet, setzt ihn herunter,
// und beim Teilen geht er mit.

import { readStudio, writeStudio, STUDIO_PREFIX } from '../progress.js';
import { MAX_NAME } from './share.js';

/** Zähler gegen Kollisionen, wenn zwei Level in derselben Millisekunde entstehen. */
let counter = 0;

export function newId() {
  counter += 1;
  const stamp = Date.now().toString(36);
  const salt = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `${STUDIO_PREFIX}${stamp}${salt}${counter.toString(36)}`;
}

/** Auf das reduzieren, was gespeichert wird – und jedes Feld auf eine sichere Form bringen. */
function normalize(entry) {
  return {
    id: entry.id,
    name: String(entry.name ?? '').slice(0, MAX_NAME) || 'Ohne Namen',
    rows: entry.rows.map(String),
    prisms: Number.isInteger(entry.prisms) ? entry.prisms : 0,
    best: Number.isInteger(entry.best) && entry.best >= 0 ? entry.best : null,
    created: entry.created ?? Date.now(),
    updated: Date.now(),
  };
}

/** Alle Level, zuletzt geändertes zuerst. */
export function listLevels() {
  return readStudio().levels.slice().sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}

export const getLevel = (id) => readStudio().levels.find((l) => l.id === id) ?? null;

export const countLevels = () => readStudio().levels.length;

/**
 * Anlegen oder überschreiben.
 *
 * @returns {{ok: boolean, entry: object}} `ok: false` heißt: Speicher voll oder
 *   gesperrt (privates Fenster). Der Entwurf ist dann **nicht** gesichert, und
 *   die Oberfläche muss das sagen statt so zu tun, als sei alles gut.
 */
export function saveLevel(entry) {
  const data = readStudio();
  const next = normalize({ ...entry, id: entry.id ?? newId() });
  const at = data.levels.findIndex((l) => l.id === next.id);
  if (at === -1) data.levels.push(next);
  else data.levels[at] = { ...data.levels[at], ...next };
  return { ok: writeStudio(data), entry: next };
}

// Umbenannt wird im Editor über das Namensfeld – ein eigener Weg dafür wäre
// eine zweite Stelle, an der derselbe Name entsteht.

export function deleteLevel(id) {
  const data = readStudio();
  const before = data.levels.length;
  data.levels = data.levels.filter((l) => l.id !== id);
  if (data.levels.length === before) return false;
  return writeStudio(data);
}

/**
 * Ein Level übernehmen – aus einem Link oder als Kopie eines eigenen.
 *
 * Bekommt immer eine **frische ID**: Ein geteiltes Level darf niemals ein
 * vorhandenes überschreiben, auch dann nicht, wenn beide vom selben Entwurf
 * abstammen. Der Name wird bei Bedarf durchnummeriert, damit die Bibliothek
 * nicht dreimal „Weberknoten“ zeigt.
 *
 * Der Bestwert kommt aus dem Link – wer beim Probespielen schon besser war,
 * bringt seinen eigenen mit (`best` im übergebenen Entwurf ist dann kleiner).
 */
export function importLevel(draft) {
  return saveLevel({
    id: newId(),
    name: uniqueName(draft.name),
    rows: draft.rows,
    prisms: draft.prisms,
    best: Number.isInteger(draft.best) ? draft.best : null,
    created: Date.now(),
  });
}

function uniqueName(wanted) {
  const taken = new Set(readStudio().levels.map((l) => l.name));
  const base = String(wanted ?? '').slice(0, MAX_NAME) || 'Ohne Namen';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

/**
 * Ein gelöster Durchgang. Nur ein **kürzerer** Weg ändert etwas.
 *
 * @returns {number|null} der Bestwert *vor* diesem Durchgang – der
 *   Siegbildschirm braucht ihn, um „neuer Bestwert“ sagen zu können.
 */
export function recordStudioSolve(id, moves) {
  const data = readStudio();
  const entry = data.levels.find((l) => l.id === id);
  if (!entry) return null;
  const before = Number.isInteger(entry.best) ? entry.best : null;
  if (before === null || moves < before) {
    entry.best = moves;
    entry.updated = Date.now();
    writeStudio(data);
  }
  return before;
}

/**
 * Suche über Namen.
 *
 * Die Bibliothek soll auch bei fünfzig Leveln übersichtlich bleiben; sortiert
 * ist ohnehin nach zuletzt geändert, und mehr als „tipp den Namen an“ braucht
 * es dafür nicht.
 */
export function searchLevels(query) {
  const needle = String(query ?? '').trim().toLowerCase();
  const all = listLevels();
  if (!needle) return all;
  return all.filter((l) => l.name.toLowerCase().includes(needle));
}
