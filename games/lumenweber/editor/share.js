// Ein Level in einen Link und wieder heraus.
//
// DOM-frei, ohne Server: Die Leveldaten stecken vollständig im Fragment der
// Adresse. Das Fragment (`#…`) und nicht die Abfrage (`?…`), aus drei Gründen –
// es wird nicht zum Server geschickt, es lässt sich ohne Neuladen umschreiben,
// und `?level=<zahl>` ist bereits für den Sprung in ein eingebautes Level
// vergeben (siehe `main.js`).
//
// ── Größe ───────────────────────────────────────────────────────────────────
// Gemessen an base64url über kompaktem JSON: ein typisches 7×7 ergibt eine
// Adresse von rund 215 Zeichen, das größtmögliche Level – 10×10, jede Zelle
// belegt, Name ausgereizt – 494. Das liegt weit unter allem, was Browser, Mail
// oder Messenger einschränken. Eine Kompression (`CompressionStream`) würde ein
// paar hundert Zeichen sparen und dafür den ganzen Pfad asynchron machen – der
// Preis lohnt sich nicht.
//
// ── Fremder Text ────────────────────────────────────────────────────────────
// Ein Link ist Eingabe von außen. `decodeLevel` glaubt deshalb nichts, was
// darin steht: Jede Größe, jede Zahl und jeder Typ wird geprüft, **bevor**
// `parseLevel` etwas anlegt – sonst könnte ein Link mit `r: [10000 Zeilen]`
// hundert Megabyte anfordern (`beam.js` legt Breite · Höhe · 4 Bytes an).

import { MAX_SIZE, MIN_SIZE } from '../level.js';

/** Schlüssel im Fragment. Bewusst nicht `level` – das heißt in `?level=` etwas anderes. */
export const SHARE_KEY = 'geteilt';

/** Formatstand. Ein Link aus einer künftigen Fassung wird abgelehnt, nicht geraten. */
const VERSION = 1;

/** Absolute Obergrenze der kodierten Zeichenkette, bevor irgendetwas passiert. */
const MAX_ENCODED = 4096;

/** Längster Levelname. Lang genug für einen Titel, kurz genug für eine Kopfzeile. */
export const MAX_NAME = 60;

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  // Leerzeichen und Umbrüche **vor** der Auffüllrechnung entfernen: `atob`
  // überliest sie zwar, aber sie zählen in `length` mit, und dann stimmt die
  // Zahl der „=“ nicht mehr. Genau so zerbrach ein Code, den ein Mailprogramm
  // umgebrochen hatte – je nach Zahl der Umbrüche mal ja, mal nein.
  const padded = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
};

/**
 * Level → kodierte Zeichenkette.
 *
 * Kurze Schlüssel, weil jedes Zeichen in der Adresse landet. `b` ist der
 * **Bestwert**: die kürzeste Zugzahl, mit der das Level bisher gelöst wurde.
 * Er reist mit, weil er die Aufgabe an den Empfänger ist – „ich habe es in
 * sieben geschafft“. Ein Beweis für ein Minimum ist er nicht und behauptet es
 * nirgends zu sein; wer kürzer durchkommt, setzt ihn herunter.
 */
export function encodeLevel({ name, rows, prisms = 0, best = null }) {
  const payload = {
    v: VERSION,
    n: String(name ?? '').slice(0, MAX_NAME),
    r: rows,
    p: prisms,
    b: Number.isInteger(best) ? best : null,
  };
  return toBase64Url(utf8.encode(JSON.stringify(payload)));
}

/** Wirft mit einer Meldung, die man einem Menschen zeigen kann. */
const reject = (why) => { throw new Error(`Dieser Link enthält kein gültiges Level: ${why}`); };

/**
 * Kodierte Zeichenkette → Entwurf.
 *
 * Prüft ausschließlich Form und Größe. Ob das Level *spielbar* ist, entscheidet
 * danach `inspect()` – ein Link darf durchaus ein kaputtes Level enthalten,
 * er darf nur nichts anrichten.
 */
export function decodeLevel(text) {
  if (typeof text !== 'string' || text.length === 0) reject('er ist leer.');
  if (text.length > MAX_ENCODED) reject('er ist unsinnig lang.');

  let data;
  try {
    data = JSON.parse(utf8Decode.decode(fromBase64Url(text)));
  } catch {
    reject('er lässt sich nicht entziffern.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) reject('er hat die falsche Form.');
  if (data.v !== VERSION) reject(`er stammt aus einer anderen Fassung des Spiels (${data.v}).`);

  const rows = data.r;
  if (!Array.isArray(rows)) reject('das Raster fehlt.');
  if (rows.length < MIN_SIZE || rows.length > MAX_SIZE) {
    reject(`das Raster hat ${rows.length} Zeilen, erlaubt sind ${MIN_SIZE} bis ${MAX_SIZE}.`);
  }
  for (const row of rows) {
    if (typeof row !== 'string') reject('eine Zeile ist kein Text.');
    if (row.length < MIN_SIZE || row.length > MAX_SIZE) {
      reject(`eine Zeile ist ${row.length} Zeichen lang, erlaubt sind ${MIN_SIZE} bis ${MAX_SIZE}.`);
    }
  }

  const prisms = data.p;
  if (!Number.isInteger(prisms) || prisms < 0 || prisms > MAX_SIZE * MAX_SIZE) {
    reject('der Prismenvorrat ist keine sinnvolle Zahl.');
  }
  const best = data.b;
  if (best !== null && best !== undefined && (!Number.isInteger(best) || best < 0 || best > 100000)) {
    reject('der Bestwert ist keine sinnvolle Zahl.');
  }

  return {
    name: typeof data.n === 'string' && data.n.trim() ? data.n.slice(0, MAX_NAME) : 'Geteiltes Level',
    rows,
    prisms,
    best: Number.isInteger(best) ? best : null,
  };
}

/** Kodiertes Level aus einem Fragment ziehen – `null`, wenn keines drinsteht. */
export function readShareFragment(hash = location.hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const found = new URLSearchParams(raw).get(SHARE_KEY);
  return found || null;
}

/**
 * Vollständige Adresse zum Weitergeben.
 *
 * Die Abfrage der eigenen Adresse wird **verworfen**. Wer selbst über
 * `?level=3` ins Spiel gekommen ist, hätte sonst einen Link erzeugt, der beim
 * Empfänger stumm das eingebaute Level 3 startet statt das geteilte anzubieten.
 */
export function shareUrl(draft, base = location.href) {
  const url = new URL(base);
  url.search = '';
  url.hash = `${SHARE_KEY}=${encodeLevel(draft)}`;
  return url.toString();
}
