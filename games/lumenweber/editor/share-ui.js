// Teilen und Übernehmen.
//
// Ein geteiltes Level darf am Bestand des Empfängers nichts kaputtmachen. Das
// steckt hier in drei Regeln:
//
//   1. Öffnen schreibt nichts. Das Level wird gespielt, nicht gespeichert.
//   2. Übernehmen legt immer einen **neuen** Eintrag mit frischer ID an – es
//      überschreibt nie ein vorhandenes Level, auch nicht bei gleichem Namen.
//   3. Der Fortschritt der Kampagne wird gar nicht berührt; er liegt in einem
//      anderen Speicherschlüssel, den dieser Weg nie anfasst.

import { encodeLevel, decodeLevel, shareUrl, SHARE_KEY } from './share.js';
import { inspect } from './validate.js';
import { turns } from './status.js';

const $ = (id) => document.getElementById(id);

/** Kopieren, mit Rückfall auf „markiert – jetzt selbst kopieren“. */
async function copy(text, node) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Kein Clipboard-Recht (unsicherer Kontext, alter Browser): Wenigstens
    // markieren, damit ein Handgriff genügt.
    node?.focus();
    node?.select?.();
    return false;
  }
}

export function createShareScreens({ host, library, openLevel }) {
  const el = {
    share: $('screen-share'),
    shareUrl: $('share-url'),
    shareSub: $('share-sub'),
    imports: $('screen-import'),
    importBox: $('import-box'),
    importError: $('import-error'),
    shared: $('screen-shared'),
    sharedName: $('shared-name'),
    sharedDetail: $('shared-detail'),
  };

  let sharing = null;
  let incoming = null;

  function openShare(entry) {
    sharing = entry;
    el.shareUrl.value = shareUrl(entry);
    // Ein Level, das noch nie jemand gelöst hat, zu verschicken ist fast immer
    // ein Versehen – der Hinweis steht deshalb dort, wo er noch etwas ändert.
    const untested = !Number.isInteger(entry.best);
    el.shareSub.dataset.tone = untested ? 'warn' : '';
    el.shareSub.textContent = untested
      ? 'Achtung: Dieses Level hat noch niemand gelöst. Ob es überhaupt geht, weiß bisher keiner – spiel es besser erst selbst durch.'
      : `Dein Bestwert: ${turns(entry.best)}. Er geht im Link mit und ist die Aufgabe an den Empfänger.`;
    host.showOverlay(el.share);
  }

  function openImport() {
    el.importBox.value = '';
    el.importError.hidden = true;
    host.showOverlay(el.imports);
  }

  /**
   * Ein Level aus einem Link oder Code anbieten.
   *
   * Der Empfänger entscheidet: spielen, übernehmen oder verwerfen. Nichts davon
   * passiert von selbst – ein geöffneter Link darf keine stille Nebenwirkung
   * auf einem fremden Gerät haben.
   */
  function offerShared(draft) {
    incoming = draft;
    el.sharedName.textContent = draft.name;
    const size = `${draft.rows[0]?.length ?? 0}×${draft.rows.length}`;
    el.sharedDetail.textContent = Number.isInteger(draft.best)
      ? `${size} · Bestwert ${turns(draft.best)}. Schaffst du es kürzer?`
      : `${size} · noch ohne Bestwert – gelöst hat es bisher niemand.`;
    host.showOverlay(el.shared);
  }

  /**
   * Der Empfänger hat das geteilte Level gelöst.
   *
   * War er besser als der mitgeschickte Bestwert, zieht der Wert mit um, falls
   * er das Level anschließend übernimmt. Gespeichert wird dabei nichts – ein
   * geteiltes Level bleibt so lange spurlos, bis jemand es behält.
   *
   * @returns {number|null} der Bestwert vor diesem Durchgang
   */
  function noteSolved(moves) {
    if (!incoming) return null;
    const before = Number.isInteger(incoming.best) ? incoming.best : null;
    if (before === null || moves < before) incoming.best = moves;
    return before;
  }

  /**
   * Text aus dem Einfügefeld zu einem Entwurf machen. Wirft mit Klartext.
   *
   * Dieselbe Prüfung wie beim Öffnen eines Links: erst Form und Größe
   * (`decodeLevel`), dann Spielbarkeit (`inspect`). Ein eingefügter Code darf
   * nicht durchrutschen, wo dieselben Daten in einer Adresse abgewiesen würden.
   */
  function parseInput(text) {
    const trimmed = String(text).trim();
    if (!trimmed) throw new Error('Da steht nichts.');
    // Sowohl die ganze Adresse als auch nur der Code sollen funktionieren –
    // welchen der beiden jemand aus einer Nachricht kopiert, ist Zufall.
    const at = trimmed.indexOf(`${SHARE_KEY}=`);
    const draft = decodeLevel(at === -1 ? trimmed : trimmed.slice(at + SHARE_KEY.length + 1));
    const check = inspect(draft, 'geteilt');
    if (!check.ok) throw new Error(`Dieses Level ist nicht spielbar: ${check.errors[0].text}`);
    return draft;
  }

  $('btn-share-copy').addEventListener('click', async () => {
    const ok = await copy(el.shareUrl.value, el.shareUrl);
    host.toast(ok ? 'Link kopiert.' : 'Der Link ist markiert – jetzt kopieren.', 2800);
  });

  $('btn-share-copy-code').addEventListener('click', async () => {
    const ok = await copy(encodeLevel(sharing), el.shareUrl);
    host.toast(ok ? 'Code kopiert.' : 'Kopieren ging nicht – nimm den Link.', 2800);
  });

  $('btn-share-close').addEventListener('click', () => host.showOverlay(null));

  $('btn-import-open').addEventListener('click', () => {
    try {
      offerShared(parseInput(el.importBox.value));
    } catch (error) {
      el.importError.textContent = String(error.message ?? error);
      el.importError.hidden = false;
    }
  });
  $('btn-import-close').addEventListener('click', () => host.showOverlay(null));

  /**
   * Übernehmen: neuer Eintrag, frische ID, nichts überschrieben.
   *
   * Erreichbar von zwei Stellen – aus dem Angebot beim Öffnen des Links und
   * vom Siegbildschirm, wenn jemand es erst spielen und dann behalten will.
   */
  function keepShared() {
    if (!incoming) return;
    const { ok, entry } = library.importLevel(incoming);
    if (!ok) { host.toast('Konnte nicht speichern – der Speicher ist voll oder gesperrt.', 5200); return; }
    host.toast(`„${entry.name}“ liegt jetzt in deiner Bibliothek.`, 3200);
    incoming = null;
    host.clearShareFragment?.();
    openLevel(entry);
  }

  $('btn-shared-play').addEventListener('click', () => host.playShared(incoming));
  $('btn-shared-skip').addEventListener('click', () => host.leaveShared());
  $('btn-shared-keep').addEventListener('click', keepShared);

  return { openShare, openImport, offerShared, keepShared, noteSolved, parseInput };
}
