// Die Bibliothek als Bildschirm.
//
// Die Anforderung dahinter: Der Bestand darf mit wachsender Zahl nicht
// unübersichtlich werden. Dagegen stehen drei Dinge – zuletzt Geändertes steht
// oben, ein Suchfeld filtert nach Namen, und jede Karte trägt ihren Zustand
// (Par geprüft / selbst gelöst / ungeprüft) sichtbar am Rand statt in einem
// Menü. Was ein Level ist, muss man lesen können, ohne es zu öffnen.

import { turns } from './status.js';

const $ = (id) => document.getElementById(id);

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const sizeOf = (entry) => `${entry.rows[0]?.length ?? 0}×${entry.rows.length}`;

/** Ab so vielen Leveln lohnt ein Suchfeld. */
const SEARCH_FROM = 6;

/**
 * Der Bestwert als Abzeichen.
 *
 * Ein Level ohne Bestwert hat noch niemand gelöst – es ist deshalb nicht nur
 * „ungespielt“, sondern von unbekannter Lösbarkeit. Das Abzeichen sagt das,
 * statt es hinter einem neutralen Strich zu verstecken.
 */
function badge(entry) {
  return Number.isInteger(entry.best)
    ? { text: `✓ ${turns(entry.best)}`, tone: 'good' }
    : { text: '○ ungetestet', tone: 'dim' };
}

const record = (entry) => (Number.isInteger(entry.best)
  ? `Bestwert ${turns(entry.best)}`
  : 'noch nie gelöst');

export function createLibraryScreen({ host, library, onNew, onEdit, onPlay, onShare, onImport }) {
  const el = {
    screen: $('screen-studio'),
    list: $('studio-list'),
    empty: $('studio-empty'),
    search: $('studio-search'),
    sub: $('studio-sub'),
  };

  /**
   * ID der Karte, deren Löschen gerade rückgefragt wird.
   *
   * Bewusst die **ID** und nicht das Element: `render()` tauscht über
   * `replaceChildren` sämtliche Karten aus. Ein gemerktes Element hängt danach
   * nicht mehr im Dokument, und jede weitere Rückfrage schriebe unsichtbar ins
   * Leere – das Löschen war ab dem ersten Fehlgriff dauerhaft unbenutzbar. Über
   * die ID überlebt der Zustand jedes Neuzeichnen.
   */
  let confirming = null;

  function render() {
    const all = library.countLevels();

    // Verschwindet das Suchfeld, muss auch der Filter gehen – sonst blieben
    // Level ausgeblendet, und das Feld zum Aufheben wäre nicht mehr da.
    const searchable = all >= SEARCH_FROM;
    if (!searchable) el.search.value = '';
    el.search.hidden = !searchable;

    const query = el.search.value.trim();
    const shown = library.searchLevels(query);

    el.sub.textContent = all === 0
      ? 'Selbstgebaut, nur auf diesem Gerät.'
      : `${all} ${all === 1 ? 'Level' : 'Level'} auf diesem Gerät${query ? ` · ${shown.length} passend` : ''}.`;

    // Zwei verschiedene Leeren: gar nichts gebaut, oder nichts gefunden.
    el.empty.hidden = shown.length > 0;
    el.empty.innerHTML = all === 0
      ? 'Noch nichts gebaut. <b>+ Neu</b> legt ein leeres Brett an.'
      : `Kein Level heißt „${escape(query)}“.`;

    el.list.replaceChildren(...shown.map(card));
  }

  /**
   * Eine Karte – im Normalzustand oder mit Löschen-Rückfrage.
   *
   * Die Rückfrage steckt an Ort und Stelle statt in `confirm()` des Browsers:
   * Das reißt auf dem Handy den ganzen Bildschirm auf und lässt sich in einer
   * Vollbild-Web-App schlecht treffen.
   */
  function card(entry) {
    const li = document.createElement('li');
    li.className = 'studio-card';
    const mark = badge(entry);
    const asking = confirming === entry.id;

    li.innerHTML = `
      <div class="studio-head">
        <span class="studio-name">${escape(entry.name)}</span>
        <span class="studio-badge" data-tone="${mark.tone}">${mark.text}</span>
      </div>
      <div class="studio-meta">${sizeOf(entry)} · ${escape(record(entry))}</div>
      <div class="studio-actions">${asking ? `
        <span class="studio-confirm">„${escape(entry.name)}“ wirklich löschen?</span>
        <button class="pill pill--sm pill--warn" type="button" data-do="delete-yes">Ja, löschen</button>
        <button class="pill pill--sm" type="button" data-do="delete-no">Abbrechen</button>` : `
        <button class="pill pill--sm" type="button" data-do="play">▶ Spielen</button>
        <button class="pill pill--sm" type="button" data-do="edit">✎ Bearbeiten</button>
        <button class="pill pill--sm" type="button" data-do="share">⤴ Teilen</button>
        <button class="pill pill--sm pill--warn" type="button" data-do="delete" aria-label="Löschen">✕</button>`}
      </div>`;

    li.addEventListener('click', (event) => {
      const what = event.target.closest('[data-do]')?.dataset.do;
      if (!what) return;
      if (what === 'play') onPlay(entry);
      if (what === 'edit') onEdit(entry);
      if (what === 'share') onShare(entry);
      if (what === 'delete') { confirming = entry.id; render(); }
      if (what === 'delete-no') { confirming = null; render(); }
      if (what === 'delete-yes') {
        // Löschen kann scheitern – privates Fenster, voller Speicher. Dann darf
        // hier nicht „gelöscht“ stehen, während die Karte weiter da ist.
        const ok = library.deleteLevel(entry.id);
        host.toast(ok
          ? `„${entry.name}“ gelöscht.`
          : 'Konnte nicht löschen – der Speicher des Browsers ist voll oder gesperrt.',
        ok ? 2400 : 5200);
        confirming = null;
        render();
      }
    });
    return li;
  }

  el.search.addEventListener('input', render);
  $('btn-studio-new').addEventListener('click', onNew);
  $('btn-studio-import').addEventListener('click', onImport);
  $('btn-studio-close').addEventListener('click', () => host.leaveStudio());

  return {
    open() {
      confirming = null;
      el.search.value = '';
      render();
      host.showOverlay(el.screen);
    },
    render,
    /** Die Bibliothek ist der Rückweg aus Teilen und Code. */
    screen: el.screen,
  };
}
