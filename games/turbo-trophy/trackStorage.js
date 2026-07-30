// Gespeicherte Streckenelemente: kapselt den Speicher pro Strecken-ID.
// Der abgesicherte Zugriff selbst steht in `storage.js`.

import { ELEMENT_TYPES, normalizeElement } from './elements.js';
import { readRaw, removeKey, store, writeRaw } from './storage.js';

const PREFIX = 'turbo-trophy:elements:';

const key = (trackId) => `${PREFIX}${trackId}`;

/**
 * Ein Element auf seine reinen Definitionswerte reduzieren – ohne die im
 * Editor angehängten Weltkoordinaten (`s`, `x`, `y`, `angle`, `seg`).
 * Liefert `null` bei unbekanntem Typ.
 */
export function toDef(raw) {
  const el = normalizeElement(raw);
  if (!el) return null;
  const out = { type: el.type, at: Math.round(el.at * 10000) / 10000 };
  for (const field of Object.keys(ELEMENT_TYPES[el.type].defaults)) {
    if (field !== 'at') out[field] = el[field];
  }
  return out;
}

/**
 * Text zu einer Liste geprüfter Definitionen. Wirft mit deutschem Klartext,
 * wenn das JSON kaputt ist oder ein Element nicht zu deuten ist.
 * Akzeptiert sowohl eine nackte Liste als auch `{ "elements": [...] }`.
 */
export function parseElements(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.elements;
  if (!Array.isArray(list)) throw new Error('Erwartet wird eine Liste von Elementen.');
  return list.map((raw, i) => {
    const def = toDef(raw);
    if (!def) throw new Error(`Element ${i + 1}: unbekannter Typ „${raw?.type ?? '?'}".`);
    return def;
  });
}

/** Gespeicherte Elemente einer Strecke – `null`, wenn nichts (Brauchbares) da ist. */
export function loadElements(trackId) {
  const raw = readRaw(key(trackId));
  if (raw == null) return null;
  try {
    return parseElements(raw);
  } catch {
    // Defekter Eintrag: lieber den Auslieferungszustand als ein kaputtes Spiel.
    return null;
  }
}

/** Elemente einer Strecke ablegen. `false`, wenn der Speicher nicht mitspielt. */
export function saveElements(trackId, elements) {
  if (!store) return false;
  const defs = (elements ?? []).map(toDef).filter(Boolean);
  return writeRaw(key(trackId), JSON.stringify(defs));
}

/** Bearbeitung verwerfen – danach gilt wieder der Auslieferungszustand. */
export const clearElements = (trackId) => removeKey(key(trackId));

/** Elemente für ein Rennen: gespeicherte Bearbeitung, sonst die Streckendaten. */
export function elementsFor(trackDef) {
  return loadElements(trackDef.id) ?? trackDef.elements ?? [];
}

/**
 * Lesbares JSON zum Kopieren. Ohne `elements` wird der gespeicherte Stand
 * ausgegeben, mit `elements` der übergebene (im Editor: der Arbeitsstand).
 */
export function exportJson(trackId, elements = null) {
  const defs = (elements ?? loadElements(trackId) ?? []).map(toDef).filter(Boolean);
  return JSON.stringify(defs, null, 2);
}

/**
 * JSON übernehmen und speichern. `check` ist eine optionale zusätzliche
 * Prüfung (im Editor die Platzierungsprüfung); liefert sie einen Grund, wird
 * nichts gespeichert.
 *
 * @returns {{ ok: boolean, error?: string, elements?: object[] }}
 */
export function importJson(trackId, text, check = null) {
  let list;
  try {
    list = parseElements(text);
  } catch (err) {
    const detail = err instanceof SyntaxError ? `Ungültiges JSON: ${err.message}` : err.message;
    return { ok: false, error: detail };
  }
  const reason = check?.(list);
  if (reason) return { ok: false, error: reason };
  if (!saveElements(trackId, list)) {
    return { ok: false, error: 'Speichern nicht möglich – der Browser lässt keinen Speicher zu.' };
  }
  return { ok: true, elements: list };
}
