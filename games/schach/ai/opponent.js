// Der Computergegner, wie ihn die Oberfläche sieht.
//
// Zwischen Brett und Suche liegen zwei Dinge, die nichts mit Schach zu tun
// haben: der Web Worker (siehe `worker.js`) und eine Mindestbedenkzeit. Ohne
// die antwortet die Engine in der Eröffnung in zwei Millisekunden – das wirkt
// weniger stark als hektisch, und man sieht seinen eigenen Zug nicht mehr.
//
// Lässt sich kein Worker starten – alter Browser, strenge Einbettung –, wird
// im Hauptfaden gerechnet. Dann ruckelt es kurz, aber gespielt wird trotzdem.

import { parseFen } from '../engine/board.js';
import { search } from './search.js';
import { toUci } from '../engine/notation.js';

/**
 * Die Spielstärken. `random` streut die Wurzelbewertung: Auf „Anfänger“ lässt
 * der Gegner dadurch sichtbar etwas liegen, ohne dass ihm dafür absichtliche
 * Fehler einprogrammiert werden müssten.
 */
export const LEVELS = [
  { id: 'anfaenger', name: 'Anfänger', note: 'Sieht einen Zug voraus und übersieht gern etwas.',
    depth: 2, timeMs: 400, random: 110, minThinkMs: 300 },
  { id: 'klub', name: 'Klubspieler', note: 'Rechnet ein paar Züge und straft grobe Fehler ab.',
    depth: 4, timeMs: 900, random: 25, minThinkMs: 350 },
  { id: 'meister', name: 'Meister', note: 'Denkt bis zu zwei Sekunden nach und verzeiht wenig.',
    depth: 8, timeMs: 2000, random: 0, minThinkMs: 250 },
];

export const levelById = (id) => LEVELS.find((level) => level.id === id) ?? LEVELS[1];

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createOpponent() {
  let worker = null;
  let nextId = 1;
  let pending = null;

  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const message = event.data ?? {};
      if (!pending || message.id !== pending.id) return;
      if (message.kind === 'progress') { pending.onProgress?.(message); return; }
      const settle = pending;
      pending = null;
      if (message.kind === 'error') settle.reject(new Error(message.message));
      else settle.resolve(message);
    };
    worker.onerror = () => {
      // Ein gestorbener Worker darf die Partie nicht mitnehmen: ab hier wird
      // im Hauptfaden weitergerechnet.
      const settle = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      settle?.reject(new Error('Worker beendet'));
    };
  } catch {
    worker = null;
  }

  /** Einen Zug im Hauptfaden suchen – der Notweg ohne Worker. */
  const searchHere = (fen, options) => {
    const result = search(parseFen(fen), options);
    return {
      uci: result.move ? toUci(result.move) : null,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
    };
  };

  return {
    get inWorker() { return !!worker; },

    /**
     * Zug suchen lassen.
     *
     * @param {string} fen
     * @param {object} level  ein Eintrag aus `LEVELS`
     * @param {(info: object) => void} [onProgress]
     * @returns {Promise<{uci: string|null, score: number, depth: number}>}
     */
    async think(fen, level, onProgress) {
      const options = { depth: level.depth, timeMs: level.timeMs, random: level.random };
      const started = Date.now();

      let result;
      if (worker) {
        const id = nextId++;
        try {
          result = await new Promise((resolve, reject) => {
            pending = { id, resolve, reject, onProgress };
            worker.postMessage({ id, fen, options });
          });
        } catch {
          result = searchHere(fen, options);
        }
      } else {
        result = searchHere(fen, options);
      }

      const rest = level.minThinkMs - (Date.now() - started);
      if (rest > 0) await wait(rest);
      return result;
    },

    /** Laufende Suche vergessen – etwa nach „Zurück“ oder „Neue Partie“. */
    cancel() {
      if (!pending) return;
      const settle = pending;
      pending = null;
      settle.reject(new Error('abgebrochen'));
      // Der Worker rechnet zu Ende und wird beim nächsten Auftrag über die
      // Auftragsnummer ohnehin ignoriert – ihn abzuschießen kostet mehr, als
      // die verlorene Rechenzeit wert ist.
    },

    destroy() { worker?.terminate(); worker = null; },
  };
}
