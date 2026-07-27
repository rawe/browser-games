// Streckeneditor: Elemente auf einer Strecke platzieren, einstellen, speichern
// und Probe fahren.
//
// Palette und Eigenschaften-Formular entstehen vollständig aus `ELEMENT_TYPES`
// – ein neuer Elementtyp braucht hier keine einzige Zeile Code. Geometrie und
// Prüfung liegen in `elements.js`, das Zeichnen in `render.js`, das Ablegen in
// `trackStorage.js`. Dieses Modul verbindet nur Zeigereingabe, Formular und
// Vorschau.

import {
  ELEMENT_ORDER, ELEMENT_TYPES,
  elementPoint, gateState, normalizeElement, placementAt, validatePlacement,
} from './elements.js';
import { ROAD_WIDTH, WORLD, buildTrack, posAt } from './trackGeometry.js';
import { bakeTrack, drawElement } from './render.js';
import {
  clearElements, elementsFor, exportJson, importJson, saveElements, toDef,
} from './trackStorage.js';

/* ---------- Hilfen ---------- */

const PICK_RADIUS = 26;   // Fangradius in Bildschirmpixeln – daumentauglich
const FONT = '"Courier New", Courier, monospace';

/** Reicht das Element ab seiner Position nach vorn (Brücken)? */
const isSpan = (el) => (el.level ?? 0) > 0 && el.length > 0;

/** Ändert der Typ seinen Zustand über die Zeit? Erkannt an Feldern in Ticks. */
const isDynamic = (type) => ELEMENT_TYPES[type].fields.some(([k]) => k.endsWith('Ticks'));

/** Typ mit Auf-/Zu-Takt – bekommt zusätzlich eine laufende Taktanzeige. */
function hasCycle(type) {
  const keys = ELEMENT_TYPES[type].fields.map(([k]) => k);
  return keys.includes('openTicks') && keys.includes('closedTicks');
}

/** Weltkoordinaten eines Elements nachziehen, nachdem sich `at`/`lat` änderte. */
function resolve(track, el) {
  el.at = ((el.at % 1) + 1) % 1;
  el.s = el.at * track.total;
  const p = elementPoint(track, el);
  el.x = p.x;
  el.y = p.y;
  el.angle = p.angle;
  el.seg = p.seg;
  return el;
}

/** Griffpunkt: bei Abschnitten die Mitte der Spannweite, sonst die Position. */
function handlePoint(track, el) {
  const s = el.s + (isSpan(el) ? el.length / 2 : 0);
  return elementPoint(track, { s, lat: el.lat ?? 0 });
}

/** Anzeigewert eines Feldes – Ticks zusätzlich in Sekunden. */
function formatValue(key, value) {
  if (key === 'at') return `${(value * 100).toFixed(1)} %`;
  if (key.endsWith('Ticks')) return `${value} (${(value / 60).toFixed(1)} s)`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- Editor ---------- */

/**
 * @param {object}   opts
 * @param {Element}  opts.host    Container, in den der Editor sein Markup baut.
 * @param {object[]} opts.tracks  Streckendefinitionen aus `tracks.js`.
 * @param {Function} opts.onExit  Zurück zum Titelbildschirm.
 * @param {Function} opts.onTest  Testfahrt starten, bekommt den Streckenindex.
 */
export function createEditor({ host, tracks, onExit, onTest }) {
  let trackIndex = 0;
  let trackDef = tracks[0];
  let track = buildTrack(trackDef);
  let baked = null;
  let elements = [];
  let selected = null;
  let armed = null;          // gewählter Typ aus der Palette
  let ghost = null;          // { el, reason } – Vorschau vor dem Setzen
  let dragging = null;       // Element, das gerade gezogen wird
  let placing = false;       // Finger/Maus zieht gerade eine Neuplatzierung
  let dirty = false;
  let time = 0;              // Ticks für die laufende Vorschau
  let scale = 1;             // Bildschirmpixel je Welteinheit
  let size = 320;            // Kantenlänge des Vorschau-Canvas in CSS-Pixeln
  let visible = false;
  let raf = 0;

  host.innerHTML = `
    <div class="ed-top">
      <button class="buy" id="ed-exit">&#8592; TITEL</button>
      <span class="ed-brand">STRECKEN&shy;EDITOR</span>
      <button class="buy" id="ed-save">SPEICHERN</button>
    </div>
    <div class="segmented ed-tracks" id="ed-tracks"></div>
    <div class="ed-stage"><canvas id="ed-canvas"></canvas></div>
    <p class="ed-status" id="ed-status"></p>
    <div class="ed-panels">
      <div class="panel">
        <h3>ELEMENT SETZEN</h3>
        <div class="ed-palette" id="ed-palette"></div>
        <p class="seg-hint" id="ed-hint"></p>
      </div>
      <div class="panel" id="ed-props"></div>
      <div class="panel">
        <h3>STRECKE</h3>
        <div class="ed-actions">
          <button class="buy" id="ed-test">&#9654; TESTFAHRT</button>
          <button class="buy" id="ed-reset">ZURÜCKSETZEN</button>
          <button class="buy" id="ed-json-toggle">JSON</button>
        </div>
        <p class="seg-hint">Gespeicherte Elemente benutzt das Rennen dieser Strecke automatisch.
          Zurücksetzen stellt den Auslieferungszustand wieder her.</p>
      </div>
      <div class="panel hidden" id="ed-json">
        <h3>EXPORT &amp; IMPORT</h3>
        <textarea id="ed-json-text" spellcheck="false" rows="8"></textarea>
        <div class="ed-actions">
          <button class="buy" id="ed-copy">KOPIEREN</button>
          <button class="buy" id="ed-import">ÜBERNEHMEN</button>
        </div>
        <p class="seg-hint">Text markieren und kopieren – oder eigenes JSON einfügen und übernehmen.</p>
      </div>
    </div>`;

  const $ = (id) => host.querySelector(`#${id}`);
  const canvas = $('ed-canvas');
  const ctx = canvas.getContext('2d');
  const statusEl = $('ed-status');
  const jsonPanel = $('ed-json');
  const jsonText = $('ed-json-text');

  const status = (text, tone = 'info') => {
    statusEl.textContent = text;
    statusEl.className = `ed-status ${tone}`;
  };

  /* ---------- Streckenwechsel ---------- */

  function loadTrack(index) {
    trackIndex = index;
    trackDef = tracks[index];
    track = buildTrack(trackDef);
    baked = bakeTrack(track);
    elements = elementsFor(trackDef)
      .map((raw) => normalizeElement(raw))
      .filter(Boolean)
      .map((el) => resolve(track, el));
    selected = null;
    armed = null;
    ghost = null;
    dirty = false;
    time = 0;
    renderTracks();
    renderPanels();
    status(`${trackDef.name}: ${elements.length} Element(e) geladen.`);
  }

  /* ---------- Prüfung ---------- */

  /** Alle Elemente gegeneinander prüfen – vor jedem Speichern. */
  function checkAll(list = elements) {
    const resolved = list.map((raw) => resolve(track, normalizeElement(raw)));
    for (const el of resolved) {
      const reason = validatePlacement(track, resolved, el, el);
      if (reason) return `${ELEMENT_TYPES[el.type].name}: ${reason}`;
    }
    return null;
  }

  function persist() {
    const reason = checkAll();
    if (reason) {
      status(reason, 'bad');
      return false;
    }
    if (!saveElements(trackDef.id, elements)) {
      status('Speichern nicht möglich – der Browser lässt keinen Speicher zu.', 'bad');
      return false;
    }
    dirty = false;
    return true;
  }

  /* ---------- Zeigereingabe ---------- */

  const toWorld = (e) => {
    const box = canvas.getBoundingClientRect();
    return { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
  };

  /** Weltpunkt auf die Strecke projizieren – ohne Vorwissen über das Segment. */
  function projectGlobal(x, y) {
    let best = null;
    for (let hint = 0; hint < track.n; hint += 8) {
      const p = placementAt(track, x, y, hint);
      if (!best || p.dist < best.dist) best = p;
    }
    return best;
  }

  /** Element unter dem Finger – nächster Griffpunkt im Fangradius. */
  function pick(w) {
    let best = null;
    let bestDist = PICK_RADIUS / scale;
    for (const el of elements) {
      const p = handlePoint(track, el);
      const dist = Math.hypot(p.x - w.x, p.y - w.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  }

  /** Rohdefinition für eine Position – `lat` nur bei Typen, die es kennen. */
  function candidateAt(type, place, base = null) {
    const defaults = ELEMENT_TYPES[type].defaults;
    const length = base?.length ?? defaults.length ?? 0;
    const spanOffset = (defaults.level ?? 0) > 0 ? length / 2 / track.total : 0;
    const raw = { ...(base ? toDef(base) : { type }), at: place.at - spanOffset };
    if ('lat' in defaults) raw.lat = place.lat;
    return normalizeElement(raw);
  }

  function updateGhost(w) {
    const place = projectGlobal(w.x, w.y);
    if (place.dist > ROAD_WIDTH) {
      ghost = null;
      status('Bitte auf die Fahrbahn zeigen.', 'bad');
      draw();
      return;
    }
    const el = resolve(track, candidateAt(armed, place));
    ghost = { el, reason: validatePlacement(track, elements, el) };
    status(ghost.reason ?? `${ELEMENT_TYPES[armed].name} hier setzen – loslassen bestätigt.`,
      ghost.reason ? 'bad' : 'ok');
    draw();
  }

  function commitGhost() {
    if (!ghost) return;
    if (ghost.reason) {
      status(ghost.reason, 'bad');
      return;
    }
    elements.push(ghost.el);
    selected = ghost.el;
    ghost = null;
    armed = null;
    dirty = true;
    renderPanels();
    status(`${ELEMENT_TYPES[selected.type].name} gesetzt – jetzt einstellen oder verschieben.`, 'ok');
    draw();
  }

  /** Gewähltes Element entlang der Strecke und quer dazu verschieben. */
  function moveTo(el, w) {
    const hint = handlePoint(track, el).seg;
    const place = placementAt(track, w.x, w.y, hint);
    const next = candidateAt(el.type, place, el);
    const reason = validatePlacement(track, elements, next, el);
    if (reason) {
      status(reason, 'bad');
      return;
    }
    Object.assign(el, next);
    resolve(track, el);
    dirty = true;
    status('Verschoben.', 'ok');
    updateReadouts();
    draw();
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const w = toWorld(e);
    canvas.setPointerCapture(e.pointerId);
    if (armed) {
      placing = true;
      updateGhost(w);
      return;
    }
    const hit = pick(w);
    if (hit !== selected) {
      selected = hit;
      renderPanels();
    }
    dragging = hit;
    status(hit ? `${ELEMENT_TYPES[hit.type].name} gewählt – ziehen verschiebt.` : 'Nichts getroffen.');
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    const w = toWorld(e);
    if (dragging) moveTo(dragging, w);
    else if (armed) updateGhost(w);
  });

  const endPointer = (e) => {
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (placing) {
      placing = false;
      commitGhost();
    }
    dragging = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (!placing && ghost) {
      ghost = null;
      draw();
    }
  });

  /* ---------- Oberfläche ---------- */

  function renderTracks() {
    $('ed-tracks').innerHTML = tracks.map((t, i) =>
      `<button class="seg${i === trackIndex ? ' on' : ''}" data-track="${i}">${esc(t.name)}</button>`).join('');
    host.querySelectorAll('[data-track]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.track);
        if (index === trackIndex) return;
        if (dirty && !confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
        loadTrack(index);
        draw();
      });
    });
  }

  function renderPalette() {
    $('ed-palette').innerHTML = ELEMENT_ORDER.map((type) => {
      const spec = ELEMENT_TYPES[type];
      return `<button class="seg ed-type${type === armed ? ' on' : ''}" data-type="${type}">
        <span class="ed-icon">${spec.icon}</span>${esc(spec.name)}</button>`;
    }).join('');
    host.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        armed = armed === btn.dataset.type ? null : btn.dataset.type;
        ghost = null;
        renderPalette();
        status(armed
          ? `${ELEMENT_TYPES[armed].name}: auf die Fahrbahn tippen.`
          : 'Auswahl aufgehoben.');
        draw();
      });
    });
    $('ed-hint').textContent = armed
      ? ELEMENT_TYPES[armed].hint
      : 'Typ wählen und auf die Fahrbahn tippen. Ohne Auswahl wählt ein Tipp ein vorhandenes Element.';
  }

  function fieldRow(key, label, min, max, step, value) {
    return `
      <label class="ed-field">
        <span class="ed-field-head"><b>${esc(label)}</b><em data-out="${key}">${formatValue(key, value)}</em></span>
        <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
      </label>`;
  }

  function renderProps() {
    const box = $('ed-props');
    if (!selected) {
      box.innerHTML = `<h3>EIGENSCHAFTEN</h3>
        <p class="seg-hint">Kein Element gewählt. Tippe eines auf der Strecke an.</p>`;
      return;
    }
    const spec = ELEMENT_TYPES[selected.type];
    const fields = [
      // `at` steht nicht in `fields`, ist aber die wichtigste Stellgröße –
      // per Regler auch ohne ruhige Hand genau einstellbar.
      fieldRow('at', 'Position auf der Runde', 0, 0.999, 0.002, selected.at),
      ...spec.fields.map(([k, label, min, max, step]) => fieldRow(k, label, min, max, step, selected[k])),
    ].join('');
    const flags = (spec.flags ?? []).map(([k, label]) =>
      `<button class="seg ed-flag${selected[k] ? ' on' : ''}" data-flag="${k}">${esc(label)}</button>`).join('');
    const cycle = hasCycle(selected.type)
      ? `<div class="ed-cycle"><div class="ed-cycle-fill" id="ed-cycle-fill"></div></div>
         <p class="seg-hint" id="ed-cycle-text">&nbsp;</p>`
      : '';

    box.innerHTML = `
      <h3>${spec.icon} ${esc(spec.name)}</h3>
      ${fields}
      ${flags ? `<div class="ed-flags">${flags}</div>` : ''}
      ${cycle}
      <div class="ed-actions"><button class="buy danger" id="ed-delete">LÖSCHEN</button></div>`;

    box.querySelectorAll('input[type=range]').forEach((input) => {
      input.addEventListener('input', () => setField(input, input.dataset.key, Number(input.value)));
    });
    box.querySelectorAll('[data-flag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setFlag(btn.dataset.flag, !selected[btn.dataset.flag]);
        btn.classList.toggle('on', Boolean(selected[btn.dataset.flag]));
      });
    });
    $('ed-delete').addEventListener('click', () => {
      const name = ELEMENT_TYPES[selected.type].name;
      elements = elements.filter((el) => el !== selected);
      selected = null;
      dirty = true;
      renderPanels();
      status(`${name} gelöscht.`, 'ok');
      draw();
    });
  }

  function renderPanels() {
    renderPalette();
    renderProps();
  }

  /** Nur die Zahlenanzeigen nachziehen – das Formular bleibt stehen. */
  function updateReadouts() {
    if (!selected) return;
    host.querySelectorAll('[data-out]').forEach((out) => {
      const key = out.dataset.out;
      out.textContent = formatValue(key, selected[key]);
      const input = host.querySelector(`input[data-key="${key}"]`);
      if (input && document.activeElement !== input) input.value = String(selected[key]);
    });
  }

  function setField(input, key, value) {
    const next = normalizeElement({ ...toDef(selected), [key]: value });
    const reason = validatePlacement(track, elements, next, selected);
    if (reason) {
      input.value = String(selected[key]);   // ungültige Eingabe zurückdrehen
      status(reason, 'bad');
      return;
    }
    Object.assign(selected, next);
    resolve(track, selected);
    dirty = true;
    status(`${ELEMENT_TYPES[selected.type].name} angepasst.`, 'ok');
    updateReadouts();
    draw();
  }

  function setFlag(key, value) {
    const next = normalizeElement({ ...toDef(selected), [key]: value });
    Object.assign(selected, next);
    resolve(track, selected);
    dirty = true;
    updateReadouts();
    draw();
  }

  /* ---------- Vorschau ---------- */

  function layout() {
    const stage = host.querySelector('.ed-stage');
    const width = stage.clientWidth || host.clientWidth || 320;
    size = Math.max(200, Math.min(width, window.innerHeight * 0.38, 520));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = size / WORLD;
  }

  /** Spannweite höhengetrennter Abschnitte – macht die obere Ebene sichtbar. */
  function drawSpan(el) {
    ctx.save();
    ctx.beginPath();
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const p = posAt(track, el.s + (el.length * i) / steps);
      const x = p.x * scale;
      const y = p.y * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(84,214,255,.28)';
    ctx.lineWidth = Math.max(6, ROAD_WIDTH * scale);
    ctx.stroke();
    ctx.strokeStyle = '#54d6ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.restore();
  }

  function drawBadge(el) {
    const p = handlePoint(track, el);
    const x = p.x * scale;
    const y = p.y * scale;
    const spec = ELEMENT_TYPES[el.type];

    if (el === selected) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }

    const label = spec.icon + ((el.level ?? 0) > 0 ? ` ${el.level}` : '');
    ctx.save();
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 8;
    const top = Math.max(2, y - 24);
    ctx.fillStyle = el === selected ? 'rgba(255,210,63,.92)' : 'rgba(6,10,24,.82)';
    ctx.strokeStyle = el === selected ? '#ffd23f' : '#2c3560';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top - 8, w, 17, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = el === selected ? '#0c1020' : '#e8ecff';
    ctx.fillText(label, x, top);
    ctx.restore();
  }

  function drawGhostMark() {
    const p = handlePoint(track, ghost.el);
    const x = p.x * scale;
    const y = p.y * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = ghost.reason ? '#ff4f7b' : '#5be07a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (ghost.reason) {
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 8);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 8, y - 8);
      ctx.lineTo(x - 8, y + 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    if (!visible) return;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.scale(scale, scale);
    if (baked) ctx.drawImage(baked, 0, 0);
    // Nach Höhenebene sortiert zeichnen, damit ein Brückendeck über dem liegt,
    // was es überquert.
    const ordered = [...elements].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    for (const el of ordered) drawElement(ctx, el, { time, track, selected: el === selected });
    if (ghost) drawElement(ctx, ghost.el, { time, track, ghost: true });
    ctx.restore();

    // Auswahl- und Beschriftungsebene liegt in Bildschirmpixeln obenauf,
    // damit Symbole und Ringe auch bei kleiner Streckendarstellung lesbar sind.
    for (const el of elements) if (isSpan(el)) drawSpan(el);
    for (const el of elements) drawBadge(el);
    if (ghost) drawGhostMark();

    updateCycle();
  }

  /** Laufende Anzeige der Zeitsteuerung des gewählten Elements. */
  function updateCycle() {
    const fill = $('ed-cycle-fill');
    if (!fill || !selected) return;
    const state = gateState(selected, time);
    const total = state.closed ? selected.closedTicks : selected.openTicks;
    const done = Math.max(0, Math.min(1, 1 - state.ticksLeft / Math.max(1, total)));
    fill.style.width = `${done * 100}%`;
    const tone = state.closed ? 'bad' : state.warning ? 'warn' : 'ok';
    fill.className = `ed-cycle-fill ${tone}`;
    const seconds = (state.ticksLeft / 60).toFixed(1);
    $('ed-cycle-text').textContent = state.closed
      ? `GESPERRT – öffnet in ${seconds} s`
      : state.warning
        ? `VORWARNUNG – schließt in ${seconds} s`
        : `OFFEN – schließt in ${seconds} s`;
  }

  /** Läuft nur, solange es etwas zu animieren gibt. */
  const animated = () => elements.some((el) => isDynamic(el.type)) || Boolean(ghost && isDynamic(ghost.el.type));

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!visible || !animated()) return;
    time += 1;
    draw();
  }

  /* ---------- Knöpfe ---------- */

  $('ed-exit').addEventListener('click', () => {
    if (dirty && !confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
    onExit();
  });

  $('ed-save').addEventListener('click', () => {
    if (persist()) status(`${trackDef.name} gespeichert – ${elements.length} Element(e).`, 'ok');
  });

  $('ed-test').addEventListener('click', () => {
    if (!persist()) return;
    onTest(trackIndex);
  });

  $('ed-reset').addEventListener('click', () => {
    if (!confirm(`${trackDef.name} auf den Auslieferungszustand zurücksetzen?`)) return;
    clearElements(trackDef.id);
    loadTrack(trackIndex);
    status('Auslieferungszustand wiederhergestellt.', 'ok');
    draw();
  });

  $('ed-json-toggle').addEventListener('click', () => {
    const hidden = jsonPanel.classList.toggle('hidden');
    if (!hidden) {
      jsonText.value = exportJson(trackDef.id, elements);
      jsonPanel.scrollIntoView({ block: 'nearest' });
    }
  });

  $('ed-copy').addEventListener('click', async () => {
    jsonText.value = exportJson(trackDef.id, elements);
    jsonText.select();
    try {
      await navigator.clipboard.writeText(jsonText.value);
      status('JSON in die Zwischenablage kopiert.', 'ok');
    } catch {
      status('Kopieren nicht erlaubt – der Text ist markiert, bitte von Hand kopieren.', 'bad');
    }
  });

  $('ed-import').addEventListener('click', () => {
    const result = importJson(trackDef.id, jsonText.value, (list) => checkAll(list));
    if (!result.ok) {
      status(result.error, 'bad');
      return;
    }
    loadTrack(trackIndex);
    status(`Import übernommen – ${elements.length} Element(e).`, 'ok');
    draw();
  });

  window.addEventListener('resize', () => {
    if (!visible) return;
    layout();
    draw();
  });

  /* ---------- Öffentliche Schnittstelle ---------- */

  return {
    open() {
      visible = true;
      host.classList.remove('hidden');
      if (!baked) loadTrack(trackIndex);
      layout();
      draw();
      if (!raf) loop();
    },
    close() {
      visible = false;
      host.classList.add('hidden');
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
