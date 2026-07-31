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

  /** Karte, deren Löschen gerade rückgefragt wird – höchstens eine gleichzeitig. */
  let confirming = null;

  function render() {
    // Beim Neuzeichnen verschwinden alle Karten. Bliebe `confirming` auf einer
    // davon stehen, zeigte die nächste Rückfrage ins Leere – sie schriebe in
    // ein Element, das gar nicht mehr im Dokument hängt.
    confirming = null;
    const query = el.search.value;
    const all = library.countLevels();
    const shown = library.searchLevels(query);

    el.sub.textContent = all === 0
      ? 'Selbstgebaut, nur auf diesem Gerät.'
      : `${all} ${all === 1 ? 'Level' : 'Level'} auf diesem Gerät${query.trim() ? ` · ${shown.length} passend` : ''}.`;
    el.empty.hidden = all !== 0;
    el.search.hidden = all < 6;      // Suchen lohnt erst, wenn es etwas zu suchen gibt

    el.list.replaceChildren(...shown.map(card));
  }

  function card(entry) {
    const li = document.createElement('li');
    li.className = 'studio-card';
    const mark = badge(entry);

    li.innerHTML = `
      <div class="studio-head">
        <span class="studio-name">${escape(entry.name)}</span>
        <span class="studio-badge" data-tone="${mark.tone}">${mark.text}</span>
      </div>
      <div class="studio-meta">${sizeOf(entry)} · ${escape(record(entry))}</div>
      <div class="studio-actions">
        <button class="pill pill--sm" type="button" data-do="play">▶ Spielen</button>
        <button class="pill pill--sm" type="button" data-do="edit">✎ Bearbeiten</button>
        <button class="pill pill--sm" type="button" data-do="share">⤴ Teilen</button>
        <button class="pill pill--sm pill--warn" type="button" data-do="delete" aria-label="Löschen">✕</button>
      </div>`;

    li.addEventListener('click', (event) => {
      const what = event.target.closest('[data-do]')?.dataset.do;
      if (!what) return;
      if (what === 'play') onPlay(entry);
      if (what === 'edit') onEdit(entry);
      if (what === 'share') onShare(entry);
      if (what === 'delete') askDelete(li, entry);
      if (what === 'delete-yes') {
        library.deleteLevel(entry.id);
        host.toast(`„${entry.name}“ gelöscht.`, 2400);
        render();
      }
      if (what === 'delete-no') render();
    });
    return li;
  }

  /**
   * Löschen fragt zurück – aber an Ort und Stelle.
   *
   * `confirm()` des Browsers wäre kürzer, reißt aber auf dem Handy den ganzen
   * Bildschirm auf und lässt sich in einer Vollbild-Web-App schlecht treffen.
   */
  function askDelete(li, entry) {
    if (confirming && confirming !== li) render();
    confirming = li;
    li.querySelector('.studio-actions').innerHTML = `
      <span class="studio-confirm">„${escape(entry.name)}“ wirklich löschen?</span>
      <button class="pill pill--sm pill--warn" type="button" data-do="delete-yes">Ja, löschen</button>
      <button class="pill pill--sm" type="button" data-do="delete-no">Abbrechen</button>`;
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
  };
}
