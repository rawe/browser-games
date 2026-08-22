// Der Rechenknecht. Läuft in einem Web Worker, damit die Suche das Brett nicht
// einfriert: Auf dem Handy dauert eine Suche auf der höchsten Stufe zwei
// Sekunden – ohne eigenen Faden ruckelte in dieser Zeit jede Animation, und
// ein Tipp auf „Zurück“ käme erst danach an.

import { parseFen } from '../engine/board.js';
import { search } from './search.js';
import { toUci } from '../engine/notation.js';

self.onmessage = (event) => {
  const { id, fen, options } = event.data ?? {};
  try {
    const result = search(parseFen(fen), {
      ...options,
      onProgress: (info) => {
        // Zwischenstände melden: Die Oberfläche kann Tiefe und Bewertung schon
        // zeigen, während weiter gerechnet wird.
        self.postMessage({ id, kind: 'progress', depth: info.depth, score: info.score });
      },
    });
    self.postMessage({
      id,
      kind: 'done',
      uci: result.move ? toUci(result.move) : null,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
    });
  } catch (error) {
    self.postMessage({ id, kind: 'error', message: String(error?.message ?? error) });
  }
};
