// Der Editor: Brett bemalen, testen, sichern.
//
// Dieses Modul wird erst geladen, wenn jemand „Eigene Level“ antippt – Vite
// trennt es dafür in ein eigenes Bündel. Wer nur die Kampagne spielt, lädt es
// nie.
//
// ── Warum hier nichts gerechnet wird ────────────────────────────────────────
// Die eingebauten Level haben ein `par`, das ein vollständiger Löser bestimmt
// (`sim/solver.js`, geprüft von `npm run check:lumen`). Selbstgebaute haben das
// nicht – sie haben einen **Bestwert**: die kürzeste Zugzahl, die bisher jemand
// geschafft hat. Den ersten Eintrag liefert der Ersteller im Probelauf.
//
// Das ist ehrlicher und billiger zugleich. Ehrlicher, weil ein Bestwert genau
// das behauptet, was jemand vorgemacht hat, statt ein Minimum zu versprechen.
// Billiger, weil die vollständige Suche mit **jedem** beweglichen Bauteil
// doppelt so teuer wird: Ein Brett mit zwanzig Spiegeln hat über eine Million
// Stellungen, und die durchzurechnen dauert auf einem Telefon spürbar lange.
// Der Probelauf kostet nichts und beweist obendrein, dass das Level lösbar ist.
//
// ── Warum kein zweiter Renderer ─────────────────────────────────────────────
// Gemalt wird auf demselben Brett, auf dem später gespielt wird: `setLevel`,
// `setSession`, fertig. Der Autor sieht beim Bauen den echten Lichtfaden, in
// echter Darstellung, mit echten Farben – und nicht eine Vorschau, die dem
// Ergebnis nur ähnelt.
//
// ── Warum Pinsel und nicht Ziehen ───────────────────────────────────────────
// Ein Tipp auf eine Zelle ist die einzige Geste, die auf einem Telefon
// zuverlässig sitzt – und dieselbe, mit der man das Spiel bedient. Varianten
// (Strahlrichtung der Quelle, Knotenfarbe, Ausrichtung eines Spiegels) hängen
// am zweiten Tipp auf dieselbe Zelle, damit die Werkzeugleiste kurz bleibt.

import { createSession } from '../game.js';
import { parseLevel } from '../level.js';
import {
  TOOLS, toolById, createDraft, paint, resizeRows, lostOnResize,
  searchSpaceOf, toLevelDef, clampSize, countChars, MIN_SIZE, MAX_SIZE,
} from './model.js';
import { inspect } from './validate.js';
import { statusChip, checkReport } from './status.js';
import * as library from './library.js';
import { createLibraryScreen } from './library-ui.js';
import { createShareScreens } from './share-ui.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{
 *   renderer: object,
 *   relayout: () => void,
 *   toast: (text: string, ms?: number) => void,
 *   showOverlay: (node: Element|null) => void,
 *   setMode: (mode: 'play'|'editor') => void,
 *   playDraft: (level: object, meta: object) => void,
 *   playShared: (draft: object) => void,
 *   leaveStudio: () => void,
 *   leaveShared: () => void,
 *   clearShareFragment: () => void,
 * }} host
 */
export function createStudio(host) {
  const el = {
    name: $('editor-name'),
    status: $('editor-status'),
    toolRow: $('tool-row'),
    boardBtn: $('btn-board'),
    boardSize: $('board-size'),
    boardPanel: $('editor-board'),
    boardW: $('board-w'),
    boardH: $('board-h'),
    boardP: $('board-p'),
    boardPrismRow: $('board-prisms-row'),
    boardNote: $('board-note'),
    check: $('screen-check'),
    checkBody: $('check-body'),
  };

  /** Der laufende Entwurf. */
  let draft = null;
  /** Bibliothekseintrag, zu dem der Entwurf gehört – `null` bei ungesichertem Neubau. */
  let entryId = null;
  /** Kürzester bisher gegangener Weg. `null`, solange es niemand gelöst hat. */
  let best = null;
  let toolId = 'mirror';
  let report = { level: null, errors: [], warnings: [], ok: false };
  let dirty = false;

  /* ---------- Entwurf → Brett ---------- */

  /**
   * Entwurf neu parsen und aufs Brett bringen.
   *
   * Der Renderer bekommt das Level **ohne Einweb-Animation** – die gehört zum
   * Levelstart, nicht zu jedem Pinselstrich. Ein ungültiger Entwurf (etwa ganz
   * ohne Quelle) lässt sich trotzdem zeichnen: `parseLevel` mit
   * `validate: false` baut das Raster, die Meldungen stehen daneben.
   */
  function refreshBoard() {
    report = inspect(draft, entryId ?? 'entwurf');
    if (report.level) {
      host.renderer.setLevel(report.level, { animate: false });
      host.renderer.setSession(createSession(report.level));
    }
    host.relayout();
  }

  /* ---------- Anzeige ---------- */

  function paintStatus() {
    const chip = statusChip({ errors: report.errors, warnings: report.warnings, best });
    el.status.textContent = chip.text;
    el.status.dataset.tone = chip.tone;
    if (!el.check.hidden) paintCheck();
  }

  function paintCheck() {
    const lines = checkReport({
      errors: report.errors,
      warnings: report.warnings,
      space: searchSpaceOf(draft.rows),
      best,
    });
    el.checkBody.replaceChildren(...lines.map((line) => {
      const p = document.createElement('p');
      p.className = 'check-line';
      p.dataset.tone = line.tone;
      p.textContent = line.text;
      return p;
    }));
  }

  function paintBoardPanel() {
    const w = draft.rows[0]?.length ?? MIN_SIZE;
    const h = draft.rows.length;
    el.boardW.textContent = String(w);
    el.boardH.textContent = String(h);
    el.boardSize.textContent = `${w}×${h}`;
    el.boardP.textContent = String(draft.prisms);
    const sockets = countChars(draft.rows)._ ?? 0;
    el.boardPrismRow.hidden = sockets === 0;
    const space = searchSpaceOf(draft.rows);
    const parts = [`${space.states.toLocaleString('de-DE')} mögliche Stellungen`];
    if (sockets > 0) parts.unshift(`${sockets} Fassungen`);
    // `tight` sagt, dass eine Zelle unter die Fingergrenze gerutscht ist
    // (`MIN_TOUCH_CELL` in `layout.js`). Auf einem Telefon passiert das bei den
    // größten Brettern – der Autor sieht es an seinem eigenen Schirm, aber sein
    // Publikum spielt vielleicht auf einem kleineren.
    if (host.renderer.layout?.tight) {
      parts.push('bei dieser Größe werden die Zellen für Finger knapp');
    }
    el.boardNote.textContent = parts.join(' · ');
    el.boardNote.dataset.tone = host.renderer.layout?.tight ? 'warn' : '';
  }

  function paintTools() {
    for (const btn of el.toolRow.children) {
      const on = btn.dataset.tool === toolId;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
    }
  }

  const repaint = () => { refreshBoard(); paintBoardPanel(); paintStatus(); };

  /* ---------- Werkzeugleiste ---------- */

  el.toolRow.replaceChildren(...TOOLS.map((tool) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool';
    btn.dataset.tool = tool.id;
    btn.setAttribute('role', 'radio');
    btn.title = `${tool.label} – ${tool.hint}`;
    btn.innerHTML = `<span class="tool-glyph" data-kind="${tool.id}">${tool.glyph}</span><span class="tool-label">${tool.label}</span>`;
    btn.addEventListener('click', () => {
      toolId = tool.id;
      paintTools();
      host.toast(`${tool.label}: ${tool.hint}`, 2600);
    });
    return btn;
  }));

  /* ---------- Pinselstrich ---------- */

  /**
   * Jede Änderung am Raster macht den Bestwert wertlos.
   *
   * Er gehört zu genau diesem Brett. Wer eine Zelle verschiebt, hat ein anderes
   * Level – die alte Zugzahl wäre ab da eine Behauptung über etwas, das es
   * nicht mehr gibt.
   */
  function invalidateRecord() {
    if (best === null) return;
    best = null;
    host.toast('Das Brett hat sich geändert – der Bestwert gilt nicht mehr.', 3200);
  }

  function tap(x, y) {
    const tool = toolById(toolId);
    const next = paint(draft.rows, x, y, tool);
    if (!next.changed) return;
    draft.rows = next.rows;
    invalidateRecord();
    // Eine Fassung ohne Vorrat ist immer ein Fehler – ein erstes Prisma dazu ist
    // offensichtlich gemeint und erspart einen Umweg in die Bretteinstellungen.
    const sockets = countChars(draft.rows)._ ?? 0;
    if (sockets === 0) draft.prisms = 0;
    else if (draft.prisms === 0) draft.prisms = 1;
    else if (draft.prisms >= sockets) draft.prisms = Math.max(1, sockets - 1);
    dirty = true;
    repaint();
    // Erst nach `setLevel` – das räumt die Wellen des Renderers ab.
    host.renderer.tapAt(x, y);
  }

  /* ---------- Brettmaße ---------- */

  function changeSize(what) {
    const w = draft.rows[0]?.length ?? MIN_SIZE;
    const h = draft.rows.length;
    const sockets = countChars(draft.rows)._ ?? 0;

    if (what === 'p+' || what === 'p-') {
      // Der Vorrat ändert das Raster nicht, wohl aber die Aufgabe – der
      // Bestwert ist danach genauso hinfällig wie nach einem Pinselstrich.
      const next = what === 'p+'
        ? Math.min(Math.max(1, sockets - 1), draft.prisms + 1)
        : Math.max(sockets > 0 ? 1 : 0, draft.prisms - 1);
      if (next === draft.prisms) return;
      draft.prisms = next;
      invalidateRecord();
    } else {
      const nextW = clampSize(w + (what === 'w+' ? 1 : what === 'w-' ? -1 : 0));
      const nextH = clampSize(h + (what === 'h+' ? 1 : what === 'h-' ? -1 : 0));
      if (nextW === w && nextH === h) {
        host.toast(`Zwischen ${MIN_SIZE}×${MIN_SIZE} und ${MAX_SIZE}×${MAX_SIZE} – größer wären die Zellen auf dem Handy zu klein.`, 3400);
        return;
      }
      const lost = lostOnResize(draft.rows, nextW, nextH);
      if (lost > 0) host.toast(`${lost} belegte Zellen fallen weg.`, 2600);
      draft.rows = resizeRows(draft.rows, nextW, nextH);
      invalidateRecord();
    }
    dirty = true;
    repaint();
  }

  /* ---------- Sichern ---------- */

  function save({ quiet = false } = {}) {
    const name = el.name.value.trim() || 'Ohne Namen';
    draft.name = name;
    const previous = entryId ? library.getLevel(entryId) : null;
    const { ok, entry } = library.saveLevel({
      id: entryId,
      name,
      rows: draft.rows,
      prisms: draft.prisms,
      best,
      created: previous?.created ?? Date.now(),
    });
    if (!ok) {
      host.toast('Konnte nicht speichern – der Speicher des Browsers ist voll oder gesperrt.', 5200);
      return null;
    }
    entryId = entry.id;
    dirty = false;
    if (!quiet) {
      host.toast(best === null
        ? `„${entry.name}“ gesichert. Spiel es einmal durch, damit ein Bestwert entsteht.`
        : `„${entry.name}“ gesichert.`, 3200);
    }
    libraryScreen.render();
    return entry;
  }

  /* ---------- Probelauf ---------- */

  /**
   * Aus dem Bauen ins Spielen – und zurück.
   *
   * Das ist der meistbegangene Weg im ganzen Editor und läuft deshalb über
   * keinerlei Umweg: Der Entwurf bleibt im Speicher stehen, es wird nichts neu
   * geladen und kein Bildschirm dazwischengeschoben. Zugleich ist der Probelauf
   * die einzige Stelle, an der ein Bestwert entstehen kann.
   */
  function test() {
    if (!report.ok) {
      openCheck();
      host.toast('So lässt sich das noch nicht spielen.', 3000);
      return;
    }
    const level = parseLevel(toLevelDef(draft, entryId ?? 'entwurf'), { validate: false });
    hideEditor();
    host.playDraft(level, { id: entryId, best, fromEditor: true });
  }

  /** Zurück ins Bauen – nach dem Probelauf oder aus der Bibliothek heraus. */
  function resume() {
    showEditor();
    repaint();
  }

  /* ---------- Bildschirme ---------- */

  // Welche Leisten sichtbar sind, entscheidet `showOverlay` im Rahmen anhand
  // der Betriebsart – hier wird nur umgeschaltet, nicht am DOM gezerrt.
  function showEditor() {
    host.setMode('editor');
    paintTools();
  }

  function hideEditor() {
    el.boardPanel.hidden = true;
    el.boardBtn.setAttribute('aria-expanded', 'false');
  }

  function openCheck() {
    paintCheck();
    host.showOverlay(el.check);
  }

  /** Editor mit einem Entwurf öffnen. */
  function edit(entry) {
    draft = { name: entry.name, rows: entry.rows.slice(), prisms: entry.prisms ?? 0 };
    entryId = entry.id ?? null;
    best = Number.isInteger(entry.best) ? entry.best : null;
    dirty = false;
    el.name.value = entry.name;
    showEditor();
    repaint();
  }

  const newLevel = () => edit({ ...createDraft(), id: null, best: null });

  /* ---------- Nebenbildschirme ---------- */

  const share = createShareScreens({ host, library, openLevel: (entry) => edit(entry) });

  const libraryScreen = createLibraryScreen({
    host,
    library,
    onNew: newLevel,
    onEdit: edit,
    onPlay: (entry) => {
      const level = parseLevel(toLevelDef(entry, entry.id), { validate: false });
      hideEditor();
      host.playDraft(level, { id: entry.id, best: entry.best ?? null });
    },
    onShare: (entry) => share.openShare(entry),
    onImport: () => share.openImport(),
  });

  /* ---------- Verdrahtung ---------- */

  el.name.addEventListener('input', () => { dirty = true; });
  el.name.addEventListener('change', () => { draft.name = el.name.value.trim() || 'Ohne Namen'; });

  el.status.addEventListener('click', openCheck);
  $('btn-check-close').addEventListener('click', () => host.showOverlay(null));
  $('btn-check-test').addEventListener('click', test);

  el.boardBtn.addEventListener('click', () => {
    const open = el.boardPanel.hidden;
    el.boardPanel.hidden = !open;
    el.boardBtn.setAttribute('aria-expanded', String(open));
    host.relayout();
  });
  el.boardPanel.addEventListener('click', (event) => {
    const what = event.target.closest('[data-size]')?.dataset.size;
    if (what) changeSize(what);
  });

  $('btn-editor-test').addEventListener('click', test);
  $('btn-editor-save').addEventListener('click', () => save());
  $('btn-editor-close').addEventListener('click', () => {
    if (dirty) save({ quiet: true });
    hideEditor();
    libraryScreen.open();
  });

  return {
    /** Bibliothek öffnen – der Einstieg vom Titelbild. */
    openLibrary() {
      hideEditor();
      libraryScreen.open();
    },

    /** Nach dem Probelauf zurück ins Bauen. */
    resume,

    /** Ein geteiltes Level anbieten. */
    offerShared: share.offerShared,

    /** Das geteilte Level in die eigene Bibliothek holen. */
    keepShared: share.keepShared,

    /** Ein Pinselstrich vom Brett. */
    tap,

    /** Das Raster, das gerade auf dem Brett liegt – die Eingabe rechnet daran. */
    get level() { return report.level; },

    /** Bestwert eines gesicherten Levels. */
    bestOf: library.bestOf,

    /**
     * Ein gelöster Durchgang an einem Level aus der Bibliothek.
     *
     * @returns {number|null} der Bestwert *davor* – für „neuer Bestwert“.
     */
    recordSolve(id, moves) {
      const before = library.recordStudioSolve(id, moves);
      libraryScreen.render();
      return before;
    },

    /**
     * Der Ersteller hat seinen eigenen Entwurf im Probelauf gelöst.
     *
     * Das ist der Nachweis, dass das Level lösbar ist, und zugleich der erste
     * Bestwert. Gesichert wird sofort mit – sonst wäre der Beleg beim nächsten
     * Handgriff wieder weg.
     *
     * @returns {number|null} der Bestwert vor diesem Durchgang
     */
    noteSolved(moves) {
      const before = best;
      if (before !== null && moves >= before) return before;
      best = moves;
      if (entryId) library.recordStudioSolve(entryId, moves);
      else save({ quiet: true });
      libraryScreen.render();
      paintStatus();
      return before;
    },

    /** Bestwert, den ein geteiltes Level mitgebracht hat. */
    noteSharedSolved: share.noteSolved,

    dispose() { /* nichts zu räumen */ },
  };
}
