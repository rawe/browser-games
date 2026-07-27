// Streckenelemente: Sprungschanzen, Öllachen, Schranken und Brücken.
//
// Datengetriebenes Objektsystem – jedes Element ist ein einfaches Objekt in der
// Streckendefinition. Dieses Modul kennt weder DOM noch Rendering; es liefert
// nur Geometrie und Zustand. Physik steht in `race.js`, Darstellung in
// `render.js`, Bearbeitung in `editor.js`.
//
// Positionierung
// --------------
// `at`  Position entlang der Runde als Anteil 0…1 der Streckenlänge. Bewusst
//       relativ: so bleiben Elemente an ihrem Platz, wenn sich die Geometrie
//       oder der Streckenmaßstab ändert.
// `lat` Seitenversatz zur Ideallinie in Weltmaß (0 = Mitte, ±50 = Fahrbahnrand).
//
// Höhenebenen
// -----------
// Brücken heben einen Streckenabschnitt auf `level: 1`. Fahrzeuge übernehmen
// die Ebene des Abschnitts, auf dem sie fahren – Kollisionen und Raketen
// wirken nur innerhalb derselben Ebene. Damit können sich zwei Abschnitte
// kreuzen, ohne dass die Fahrzeuge sich berühren.

import { offsetPoint, posAt, project, gapAlong, ROAD_WIDTH } from './trackGeometry.js';

/**
 * Bauplan je Elementtyp. Der Editor baut seine Palette und die
 * Eigenschaften-Formulare allein aus diesen Daten – ein neuer Typ braucht
 * hier einen Eintrag und je eine Stelle in Physik und Darstellung.
 *
 * `fields` beschreibt die editierbaren Zahlenwerte:
 *   [Schlüssel, Beschriftung, Minimum, Maximum, Schrittweite]
 */
export const ELEMENT_TYPES = {
  ramp: {
    name: 'Sprungschanze',
    icon: '⛰',
    hint: 'Katapultiert schnelle Fahrzeuge über Gegner und Hindernisse hinweg.',
    defaults: { at: 0, lat: 0, width: 52, length: 40, power: 1 },
    fields: [
      ['lat', 'Seitenversatz', -34, 34, 2],
      ['width', 'Breite', 26, 90, 2],
      ['length', 'Länge', 20, 80, 2],
      ['power', 'Sprungkraft', 0.5, 2, 0.1],
    ],
  },
  oil: {
    name: 'Öllache',
    icon: '🛢',
    hint: 'Fahrzeuge verlieren die Bodenhaftung und geraten ins Schleudern.',
    defaults: { at: 0, lat: 0, radius: 28 },
    fields: [
      ['lat', 'Seitenversatz', -40, 40, 2],
      ['radius', 'Radius', 14, 46, 2],
    ],
  },
  gate: {
    name: 'Schranke',
    icon: '⛔',
    hint: 'Sperrt zeitgesteuert einen Teil der Fahrbahn – mit Vorwarnung.',
    defaults: {
      at: 0, lat: 26, width: 48,
      openTicks: 420, closedTicks: 240, offsetTicks: 0, warnTicks: 90, startClosed: false,
    },
    fields: [
      ['lat', 'Mitte der Sperre', -40, 40, 2],
      ['width', 'Breite der Sperre', 20, 70, 2],
      ['openTicks', 'Offen (Ticks)', 120, 900, 30],
      ['closedTicks', 'Gesperrt (Ticks)', 60, 600, 30],
      ['offsetTicks', 'Startversatz', 0, 900, 30],
      ['warnTicks', 'Vorwarnung', 30, 240, 15],
    ],
    flags: [['startClosed', 'Startet gesperrt']],
  },
  bridge: {
    name: 'Brücke',
    icon: '🌉',
    hint: 'Hebt den Abschnitt auf die obere Ebene – kreuzende Strecken berühren sich nicht.',
    defaults: { at: 0, length: 150, level: 1 },
    fields: [
      ['length', 'Länge', 60, 400, 10],
    ],
  },
};

export const ELEMENT_ORDER = ['ramp', 'oil', 'gate', 'bridge'];

/** Höhenebene der Fahrbahn (0 = Boden). */
export const GROUND = 0;

/** Sprungdauer in Ticks – skaliert mit Tempo und Sprungkraft der Schanze. */
export const JUMP_TICKS = 44;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Ein Element auf gültige, vollständige Werte bringen. */
export function normalizeElement(raw) {
  const spec = ELEMENT_TYPES[raw?.type];
  if (!spec) return null;
  const el = { type: raw.type, ...spec.defaults, ...raw };
  el.at = ((el.at % 1) + 1) % 1;
  for (const [key, , min, max] of spec.fields) el[key] = clamp(Number(el[key]) || 0, min, max);
  for (const [key] of spec.flags ?? []) el[key] = Boolean(el[key]);
  return el;
}

/**
 * Elemente einer Streckendefinition in Weltkoordinaten auflösen. Ergebnis ist
 * eine flache Liste, die nach Bogenlänge sortiert ist.
 */
export function buildElements(track, defs = []) {
  const out = [];
  for (const raw of defs) {
    const el = normalizeElement(raw);
    if (!el) continue;
    el.s = el.at * track.total;
    const p = offsetPoint(track, el.s, el.lat ?? 0);
    el.x = p.x;
    el.y = p.y;
    el.angle = p.angle;
    out.push(el);
  }
  out.sort((a, b) => a.s - b.s);
  return out;
}

/* ---------- Schranken ---------- */

/**
 * Zustand einer Schranke zum Zeitpunkt `time` (Ticks seit Rennstart).
 * Rein berechnet, kein veränderlicher Zustand – damit bleibt die Simulation
 * über den Seed reproduzierbar und Vor-/Zurückspulen wäre problemlos möglich.
 */
export function gateState(el, time) {
  const cycle = el.openTicks + el.closedTicks;
  // `startClosed` verschiebt die Phase um die offene Dauer.
  const base = time + el.offsetTicks + (el.startClosed ? el.openTicks : 0);
  const phase = ((base % cycle) + cycle) % cycle;
  const closed = phase >= el.openTicks;
  const toClose = el.openTicks - phase;
  return {
    closed,
    // Vorwarnung, bevor sie zufährt – „rechtzeitig und eindeutig angekündigt".
    warning: !closed && toClose <= el.warnTicks,
    // 0…1, wie weit die Schranke unten ist (für die Darstellung).
    drop: closed ? 1 : clamp(1 - toClose / Math.max(1, el.warnTicks), 0, 1),
    ticksLeft: closed ? cycle - phase : toClose,
  };
}

/** Deckt die Schranke bei `lat` gerade die Fahrbahn ab? */
export const gateBlocks = (el, lat) => Math.abs(lat - el.lat) <= el.width / 2;

/**
 * Freier Seitenversatz neben einer geschlossenen Schranke – die Seite mit mehr
 * Platz gewinnt. `null`, wenn die Sperre die ganze Fahrbahn abdeckt.
 */
export function gateDetour(el) {
  const edge = ROAD_WIDTH / 2 - 14;
  const gapLeft = (el.lat - el.width / 2) + edge;
  const gapRight = edge - (el.lat + el.width / 2);
  if (gapLeft < 16 && gapRight < 16) return null;
  return gapRight >= gapLeft
    ? clamp(el.lat + el.width / 2 + gapRight / 2, -edge, edge)
    : clamp(el.lat - el.width / 2 - gapLeft / 2, -edge, edge);
}

/* ---------- Abfragen für Physik und KI ---------- */

/**
 * Elemente in einem Bogenlängenfenster vor `s`. `back` erlaubt zusätzlich ein
 * Stück rückwärts, damit ein gerade überfahrenes Element noch gefunden wird.
 */
export function elementsAhead(track, elements, s, range, back = 0) {
  const out = [];
  for (const el of elements) {
    const gap = gapAlong(track, s, el.s);
    if (gap < -back || gap > range) continue;
    out.push({ el, gap });
  }
  return out;
}

/** Höhenebene an der Bogenlänge `s` – Brücken heben den Abschnitt an. */
export function levelAt(track, elements, s) {
  for (const el of elements) {
    if (el.type !== 'bridge') continue;
    const gap = gapAlong(track, el.s, s);
    if (gap >= 0 && gap <= el.length) return el.level;
  }
  return GROUND;
}

/** Liegt (x, y) in der Öllache? */
export const inOil = (el, x, y) => Math.hypot(x - el.x, y - el.y) <= el.radius;

/**
 * Wird die Schanze gerade überfahren? Geprüft wird entlang der Strecke
 * (Bogenlänge) und quer dazu – so bleibt der Test unabhängig von der
 * Blickrichtung des Fahrzeugs.
 */
export function onRamp(track, el, s, lat) {
  const gap = gapAlong(track, el.s, s);
  return Math.abs(gap) <= el.length / 2 && Math.abs(lat - el.lat) <= el.width / 2;
}

/* ---------- Prüfung für den Editor ---------- */

const MIN_DISTANCE = 34;      // Mindestabstand gleichartiger Elemente
const START_CLEARANCE = 90;   // Bereich um Start/Ziel, der frei bleibt

/**
 * Prüft eine Platzierung. Liefert `null`, wenn sie gültig ist, sonst einen
 * Klartext-Grund für den Editor.
 */
export function validatePlacement(track, elements, candidate, ignore = null) {
  const el = normalizeElement(candidate);
  if (!el) return 'Unbekannter Elementtyp.';

  const s = el.at * track.total;
  const toStart = Math.abs(gapAlong(track, 0, s));
  if (toStart < START_CLEARANCE) return 'Zu dicht an Start und Ziel.';

  const edge = ROAD_WIDTH / 2;
  const half = el.type === 'oil' ? el.radius : (el.width ?? 0) / 2;
  if (Math.abs((el.lat ?? 0)) + half > edge) return 'Ragt über den Fahrbahnrand hinaus.';

  if (el.type === 'gate' && gateDetour(el) === null) {
    return 'Die Sperre lässt keine Lücke – die Fahrbahn wäre dauerhaft dicht.';
  }

  for (const other of elements) {
    if (other === ignore) continue;
    const gap = Math.abs(gapAlong(track, other.s ?? other.at * track.total, s));
    if (el.type === 'bridge' || other.type === 'bridge') {
      // Brücken dürfen sich nicht überlappen, andere Elemente aber tragen.
      if (el.type === 'bridge' && other.type === 'bridge' && gap < el.length + other.length) {
        return 'Überschneidet eine andere Brücke.';
      }
      continue;
    }
    if (gap < MIN_DISTANCE && Math.abs((other.lat ?? 0) - (el.lat ?? 0)) < MIN_DISTANCE) {
      return `Zu dicht an: ${ELEMENT_TYPES[other.type].name}.`;
    }
  }
  return null;
}

/** Bogenlängen-Anteil und Seitenversatz für einen Weltpunkt (Editor-Klick). */
export function placementAt(track, x, y, hint = 0) {
  const pr = project(track, x, y, hint);
  return { at: pr.s / track.total, lat: pr.lat, dist: pr.dist };
}

/** Weltpunkt eines Elements – auch für Elemente ohne aufgelöste Position. */
export function elementPoint(track, el) {
  return offsetPoint(track, (el.s ?? el.at * track.total), el.lat ?? 0);
}

export { posAt };
