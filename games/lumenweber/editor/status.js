// Aus Prüfergebnissen wird Text.
//
// Fast DOM-frei: liefert Zeichenketten und Tonlagen, kein Markup. Steht
// getrennt, weil hier die heikelste Aussage des Editors formuliert wird –
// nämlich, was über ein Level eigentlich bekannt ist. Es darf nirgends mehr
// behauptet werden, als jemand tatsächlich gezeigt hat.
//
// Und gezeigt hat es, wer es gespielt hat. Der **Bestwert** ist keine vom
// Rechner bestimmte Untergrenze, sondern der kürzeste Weg, den bisher jemand
// gegangen ist. Er ist eine Bestleistung, kein Beweis – die Texte hier sagen
// das auch so.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const turns = (n) => plural(n, 'Zug', 'Züge');

/**
 * Der Knopf in der Kopfzeile: eine Zeile, die den Stand des Levels zeigt.
 *
 * @returns {{text: string, tone: 'bad'|'warn'|'good'|'dim'}}
 */
export function statusChip({ errors, warnings, best }) {
  if (errors.length > 0) {
    return { text: `✕ ${plural(errors.length, 'Fehler', 'Fehler')}`, tone: 'bad' };
  }
  if (Number.isInteger(best)) return { text: `✓ ${best} ${best === 1 ? 'Zug' : 'Züge'}`, tone: 'good' };
  if (warnings.length > 0) {
    return { text: `⚠ ${plural(warnings.length, 'Hinweis', 'Hinweise')}`, tone: 'warn' };
  }
  return { text: '○ ungetestet', tone: 'dim' };
}

/**
 * Der Prüfbericht als Liste von Zeilen.
 *
 * @returns {{tone: string, text: string}[]}
 */
export function checkReport({ errors, warnings, space, best }) {
  const lines = [];
  for (const e of errors) lines.push({ tone: 'bad', text: e.text });
  for (const w of warnings) lines.push({ tone: 'warn', text: w.text });

  if (errors.length === 0 && warnings.length === 0) {
    lines.push({ tone: 'good', text: 'Aufbau in Ordnung: Quelle, Knoten und bewegliche Bauteile sind da.' });
  }

  lines.push({
    tone: 'info',
    text: `${plural(space.controls, 'bewegliches Bauteil', 'bewegliche Bauteile')} · ${space.states.toLocaleString('de-DE')} mögliche Stellungen`,
  });

  if (errors.length > 0) return lines;

  // Der Kern der Sache: Ob das Level lösbar ist, weiß nur, wer es gelöst hat.
  lines.push(Number.isInteger(best)
    ? {
      tone: 'good',
      text: `Gelöst in ${turns(best)}. Das ist der Bestwert, an dem sich alle messen – auch du selbst, wenn du es noch einmal kürzer schaffst.`,
    }
    : {
      tone: 'warn',
      text: 'Noch niemand hat es gelöst. Spiel es einmal selbst durch – erst dann steht fest, dass es überhaupt geht, und der Bestwert bekommt seinen ersten Eintrag.',
    });

  return lines;
}
