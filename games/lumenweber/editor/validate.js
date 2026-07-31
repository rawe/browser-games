// Prüfkette für selbstgebaute Level.
//
// DOM-frei. Zwei Stufen, beide kosten so gut wie nichts und laufen deshalb bei
// jedem Pinselstrich mit:
//
//   1. Struktur      `parseLevel` + `levelIssues`
//   2. Startzustand  steht das Level schon gelöst da?
//
// Eine dritte Stufe gibt es **nicht**. Ob ein Level lösbar ist und wie kurz der
// kürzeste Weg ist, beantwortet hier kein Löser, sondern der Ersteller: Er
// spielt sein Level im Probelauf durch. Das ist der Nachweis der Lösbarkeit und
// zugleich der erste **Bestwert** – siehe `library.js`.

import { parseLevel, levelIssues, startConfig } from '../level.js';
import { isSolved } from '../beam.js';
import { toLevelDef } from './model.js';

/** Fehler, die `parseLevel` selbst wirft (unbekanntes Zeichen, krumme Zeilen). */
function parseIssue(error) {
  const text = String(error?.message ?? error);
  // `parseLevel` stellt „Level <id>: “ voran – im Editor kennt der Autor sein
  // Level, die Wiederholung stört nur.
  return { level: 'error', text: text.replace(/^Level [^:]+: /, '') };
}

/**
 * Struktur und Startzustand eines Entwurfs.
 *
 * @returns {{
 *   level: object|null,   geparstes Level, `null` bei Strukturfehlern
 *   errors: {level:string,text:string}[],
 *   warnings: {level:string,text:string}[],
 *   ok: boolean,          spielbar? (Warnungen zählen nicht dagegen)
 * }}
 */
export function inspect(draft, id = 'entwurf') {
  let level = null;
  try {
    level = parseLevel(toLevelDef(draft, id), { validate: false });
  } catch (error) {
    return { level: null, errors: [parseIssue(error)], warnings: [], ok: false };
  }

  const issues = levelIssues(level);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  // Erst prüfen, wenn das Level überhaupt steht: `isSolved` auf einem Level
  // ohne Quelle oder ohne Knoten beantwortet eine Frage, die niemand gestellt
  // hat (ohne Knoten ist „alle Knoten leuchten“ trivial wahr).
  if (errors.length === 0 && isSolved(level, startConfig(level))) {
    errors.push({
      level: 'error',
      text: 'Das Level ist im Startzustand bereits gelöst – es gibt nichts zu tun.',
    });
  }

  return { level, errors, warnings, ok: errors.length === 0 };
}
