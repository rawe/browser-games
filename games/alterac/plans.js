// Aufmarschpläne sichern, teilen und wieder einspielen. Das Modul ist DOM-frei:
// Es kodiert Pläne als kurzen Teilen-Code, prüft sie gegen Karte und Partie-
// Einstellungen und verwaltet die Bibliothek im localStorage. Die Planungs-UI
// (planner.js) ruft ausschließlich diese Funktionen auf.
//
// Ein Plan ist genau das, was der Planer an die Simulation übergibt:
//   [{ type, actions: [{ path: [nodeId…], stance, trigger }] }]
//
// Er hängt an drei Dingen, die sich unabhängig von ihm ändern können: an der
// Karte (Wegpunkte), an den Partie-Einstellungen (Budget, Türme, Lager) und an
// der Fraktion (jeder Pfad startet an der eigenen Basis). Ein geladener Plan
// wird deshalb nie blind übernommen, sondern immer durch `validatePlan`
// geschickt: Was nicht mehr passt, fällt heraus – und der Spieler erfährt es,
// statt es erst in der Schlacht zu merken.
//
// **Ein Plan gehört zu genau einer Fraktion.** Er trägt sie im Code mit sich und
// wird auf der Gegenseite abgelehnt – nicht umgerechnet. Ein Aufmarsch ist auf
// die eigene Basis, die eigenen Türme und das eigene Vorratslager hin geplant;
// „derselbe Plan für beide Seiten" gibt es hier nicht.

import {
  UNIT_TYPES,
  MAX_ACTIONS,
  MAX_PATH_LENGTH,
  EVENT_CONDITIONS,
  EVENT_CONDITION_BY_TYPE,
  resolveUnitTypeMap,
} from './config.js';
import { towerNodes, enemyOf } from './map.js';

// ------------------------------------------------------------- Teilen-Code
// Ziel des Formats: kurz genug für eine URL, aus lauter unreservierten
// Zeichen (RFC 3986: 0-9 a-z . _ ~) und damit ohne jede Prozent-Kodierung,
// und trotzdem von Hand lesbar, wenn man einen Fehler sucht.
//
//   code    := "a1" <fingerprint 3> <fraktion b|r> "~" <einheit> ("_" <einheit>)*
//   einheit := <typ> <auftrag> ("." <auftrag>)*
//   auftrag := <haltung a|d> <auslöser?> <wegpunkt>*
//   auslöser:= "t" („Dann")
//            | "w" <bedingung> <wegpunkt>?   („Sobald"; Wegpunkt nur, wenn die
//                                              Bedingung einen Turm braucht)
//
// Der erste Auftrag einer Einheit hat nie einen Auslöser (er läuft ab Sekunde 0)
// – dort entfällt das Zeichen ersatzlos, statt eine leere Stelle zu belegen.
//
// Typ, Bedingung und Wegpunkt stehen als Index (ein Zeichen zur Basis 36) für
// ihren Eintrag in UNIT_TYPES, EVENT_CONDITIONS bzw. map.nodeList. Indizes sind
// kurz, aber sie verschieben sich, sobald jemand die Karte erweitert – deshalb
// trägt jeder Code den `fingerprint` dieser drei Listen. Passt er nicht, wird
// der Code abgelehnt, statt einen stillschweigend falschen Plan zu erzeugen.
const CODE_MAGIC = 'a1';
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const FACTION_CHAR = { blue: 'b', red: 'r' };
const CHAR_FACTION = { b: 'blue', r: 'red' };

// Ein Zeichen zur Basis 36 reicht für 36 Einträge. Mehr Wegpunkte hat die Karte
// nicht – hätte sie sie, bräuchte das Format eine zweite Stelle, deshalb prüft
// `encodePlan` das ausdrücklich und liefert lieber gar keinen Code.
const CODE_LIMIT = B36.length;

function fingerprint(map) {
  const src = [
    map.nodeList.map((n) => n.id).join(','),
    UNIT_TYPES.map((t) => t.key).join(','),
    EVENT_CONDITIONS.map((c) => c.type).join(','),
  ].join('|');
  let h = 0x811c9dc5; // FNV-1a, 32 Bit
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 3; i++) {
    out += B36[h % 36];
    h = Math.floor(h / 36);
  }
  return out;
}

const nodeIndexOf = (map) => Object.fromEntries(map.nodeList.map((n, i) => [n.id, i]));

// Plan → Code. Gibt `null` zurück, wenn der Plan Unbekanntes enthält oder die
// Karte zu groß für das Format ist; die UI blendet das Teilen dann aus.
export function encodePlan(units, { map, faction }) {
  if (map.nodeList.length > CODE_LIMIT) return null;
  if (!FACTION_CHAR[faction] || !Array.isArray(units) || !units.length) return null;
  const nodeIdx = nodeIndexOf(map);
  const typeIdx = Object.fromEntries(UNIT_TYPES.map((t, i) => [t.key, i]));
  const condIdx = Object.fromEntries(EVENT_CONDITIONS.map((c, i) => [c.type, i]));

  const blocks = [];
  for (const u of units) {
    const t = typeIdx[u?.type];
    if (t === undefined) return null;
    const actions = [];
    for (const [idx, a] of (u.actions ?? []).entries()) {
      const stance = a?.stance === 'defend' ? 'd' : 'a';
      let trig = '';
      if (idx > 0) {
        if (a?.trigger?.kind === 'when') {
          const cond = a.trigger.cond ?? {};
          const ci = condIdx[cond.type];
          if (ci === undefined) return null;
          trig = 'w' + B36[ci];
          if (EVENT_CONDITION_BY_TYPE[cond.type].needsTower) {
            const ni = nodeIdx[cond.node];
            if (ni === undefined) return null;
            trig += B36[ni];
          }
        } else {
          trig = 't';
        }
      }
      let path = '';
      for (const id of a?.path ?? []) {
        const ni = nodeIdx[id];
        if (ni === undefined) return null;
        path += B36[ni];
      }
      actions.push(stance + trig + path);
    }
    if (!actions.length) return null;
    blocks.push(B36[t] + actions.join('.'));
  }
  return `${CODE_MAGIC}${fingerprint(map)}${FACTION_CHAR[faction]}~${blocks.join('_')}`;
}

// Aus einer Eingabe den reinen Code herausschälen. Erlaubt ist beides: der
// nackte Code und eine ganze Spiel-URL (`…?plan=<code>&…`) – geteilt wird in der
// Regel der Link, eingefügt wird, was in der Zwischenablage liegt.
function extractCode(text) {
  const s = String(text ?? '').trim().toLowerCase();
  const at = s.lastIndexOf('plan=');
  const raw = at >= 0 ? s.slice(at + 5) : s;
  const m = raw.match(/^[0-9a-z._~]+/);
  return m ? m[0] : null;
}

// Code → { ok, faction, units } bzw. { ok: false, error }. Der Plan ist danach
// strukturell gültig, aber noch nicht gegen die Partie geprüft – das macht
// `validatePlan`.
export function decodePlan(input, { map }) {
  const code = extractCode(input);
  const bad = (error) => ({ ok: false, error });
  if (!code) return bad('Kein Code erkannt.');
  if (!code.startsWith(CODE_MAGIC) || code[6] !== '~') return bad('Das ist kein Alterac-Plancode.');
  if (code.slice(2, 5) !== fingerprint(map)) {
    return bad('Der Code stammt aus einer anderen Spielversion und passt nicht mehr zur Karte.');
  }
  const faction = CHAR_FACTION[code[5]];
  if (!faction) return bad('Unbekannte Fraktion im Code.');

  const nodeAt = (ch) => map.nodeList[B36.indexOf(ch)]?.id;
  const units = [];
  for (const block of code.slice(7).split('_')) {
    if (!block) return bad('Der Code ist unvollständig.');
    const type = UNIT_TYPES[B36.indexOf(block[0])]?.key;
    if (!type) return bad('Unbekannter Einheitentyp im Code.');
    const actions = [];
    for (const [idx, part] of block.slice(1).split('.').entries()) {
      if (!part) return bad('Der Code ist unvollständig.');
      const stance = part[0] === 'd' ? 'defend' : 'attack';
      let at = 1;
      let trigger = null;
      if (idx > 0) {
        const kind = part[1];
        at = 2;
        if (kind === 'w') {
          const cond = EVENT_CONDITIONS[B36.indexOf(part[2])];
          if (!cond) return bad('Unbekannte Bedingung im Code.');
          at = 3;
          trigger = { kind: 'when', cond: { type: cond.type } };
          if (cond.needsTower) {
            const node = nodeAt(part[3]);
            if (!node) return bad('Unbekannter Turm im Code.');
            trigger.cond.node = node;
            at = 4;
          }
        } else {
          trigger = { kind: 'then' };
        }
      }
      const path = [];
      for (const ch of part.slice(at)) {
        const id = nodeAt(ch);
        if (!id) return bad('Unbekannter Wegpunkt im Code.');
        path.push(id);
      }
      actions.push({ path, stance, trigger });
    }
    units.push({ type, actions });
  }
  return { ok: true, faction, units };
}

// ------------------------------------------------------------ Validierung
// Prüft einen geladenen Plan gegen Karte, Fraktion und Partie-Einstellungen und
// gibt eine bereinigte Fassung samt Klartext-Hinweisen zurück. Grundhaltung:
// übernehmen, was gültig ist, und benennen, was wegfällt – ein Plan aus einer
// Partie mit anderem Budget oder ohne Türme soll nutzbar bleiben.
export function validatePlan(units, { map, config, faction }) {
  const byKey = resolveUnitTypeMap(config);
  const towers = towerNodes(map, config?.towersPerFaction ?? 0);
  const enemy = enemyOf(faction);
  const budget = config?.resources ?? 0;
  const out = [];
  const counts = { units: 0, actions: 0, paths: 0, triggers: 0 };
  let spent = 0;

  for (const raw of Array.isArray(units) ? units : []) {
    const def = byKey[raw?.type];
    // Zu teuer oder unbekannt: Diese Einheit entfällt, spätere günstigere
    // dürfen aber noch nachrücken – so füllt ein Plan ein kleineres Budget so
    // weit wie möglich aus.
    if (!def || spent + def.cost > budget) {
      counts.units++;
      continue;
    }
    spent += def.cost;
    const rawActions = Array.isArray(raw.actions) && raw.actions.length ? raw.actions : [{}];
    if (rawActions.length > MAX_ACTIONS) counts.actions++;
    const actions = [];
    let anchor = map.start[faction];

    for (const a of rawActions.slice(0, MAX_ACTIONS)) {
      const idx = actions.length;
      // Pfad Schritt für Schritt nachvollziehen – genau wie ihn der Planer
      // aufbauen würde. Beim ersten Schritt, der nicht mehr passt, endet er.
      const path = [];
      for (const id of Array.isArray(a?.path) ? a.path : []) {
        const from = path.length ? path[path.length - 1] : anchor;
        if (path.length >= MAX_PATH_LENGTH || !map.adjacency[from]?.includes(id)) {
          counts.paths++;
          break;
        }
        path.push(id);
      }
      if (path.length) anchor = path[path.length - 1];

      let trigger = null;
      if (idx > 0) {
        trigger = { kind: 'then' };
        if (a?.trigger?.kind === 'when') {
          const cond = a.trigger.cond ?? {};
          const condDef = EVENT_CONDITION_BY_TYPE[cond.type];
          // Eine Turm-Bedingung braucht einen Turm, den es in dieser Partie
          // wirklich gibt (Türme lassen sich im Setup abschalten).
          if (!condDef || (condDef.needsTower && towers[cond.node] !== enemy)) {
            counts.triggers++;
          } else {
            trigger = { kind: 'when', cond: condDef.needsTower ? { type: cond.type, node: cond.node } : { type: cond.type } };
          }
        }
      }
      actions.push({ path, stance: a?.stance === 'defend' ? 'defend' : 'attack', trigger });
    }
    out.push({ type: def.key, actions });
  }

  const issues = [];
  if (counts.units) {
    issues.push(
      counts.units === 1
        ? 'Eine Einheit wurde gestrichen – sie passt nicht ins Budget dieser Partie.'
        : `${counts.units} Einheiten wurden gestrichen – sie passen nicht ins Budget dieser Partie.`
    );
  }
  if (counts.actions) issues.push(`Aufträge über ${MAX_ACTIONS} hinaus wurden entfernt.`);
  if (counts.paths) issues.push('Einzelne Pfade wurden gekürzt – sie passen nicht mehr zur Karte.');
  if (counts.triggers) issues.push('„Sobald"-Auslöser ohne gültigen Turm wurden zu „Dann".');
  return { units: out, issues };
}

// ------------------------------------------------------------- Bibliothek
// Gespeichert wird im localStorage unter einem einzigen versionierten Schlüssel:
//   { v, seq, slots: [{ id, name, faction, units, meta }], last: { blue, red } }
// `slots` ist die benannte Bibliothek, `last` der zuletzt gespielte Aufmarsch je
// Fraktion – er landet dort ohne Zutun des Spielers, damit eine Revanche nie bei
// null anfängt. Die Konfiguration selbst wird bewusst NICHT mitgespeichert, nur
// als `meta` zur Anzeige und Prüfung: Ein geladener Plan soll niemals heimlich
// die Setup-Einstellungen der laufenden Partie überschreiben.
const KEY = 'alterac.plans.v1';
export const MAX_SLOTS = 20;
export const MAX_NAME_LENGTH = 40;

const storage = (() => {
  try {
    const probe = '__alterac__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null; // privater Modus, gesperrte Speicherung, kein Browser
  }
})();

const emptyData = () => ({ v: 1, seq: 0, slots: [], last: {} });

function readData() {
  if (!storage) return emptyData();
  try {
    const data = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (!data || data.v !== 1) return emptyData();
    return { ...emptyData(), ...data, slots: Array.isArray(data.slots) ? data.slots : [] };
  } catch {
    return emptyData(); // beschädigter Eintrag: neu anfangen statt abstürzen
  }
}

function writeData(data) {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // Kontingent erschöpft
  }
}

// Beschreibende Begleitdaten eines gespeicherten Plans: Budget und die beiden
// Teilsysteme, die einen Plan unbrauchbar machen können, plus Zeitstempel.
export function planMeta(config) {
  return {
    resources: config?.resources ?? 0,
    towers: (config?.towersPerFaction ?? 0) > 0,
    supply: !!config?.supplyEnabled,
    at: Date.now(),
  };
}

// Einzeiler für die Listenzeile: „12 ⬢ · Türme · Lager · 25.07."
export function describeMeta(meta) {
  if (!meta) return '';
  const parts = [`${meta.resources} ⬢`];
  if (meta.towers) parts.push('Türme');
  if (meta.supply) parts.push('Lager');
  if (meta.at) {
    parts.push(new Date(meta.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }));
  }
  return parts.join(' · ');
}

// Tiefe Kopie der reinen Plandaten – nichts anderes darf in den Speicher.
const cleanUnits = (units) =>
  units.map((u) => ({
    type: u.type,
    actions: u.actions.map((a) => ({
      path: [...a.path],
      stance: a.stance,
      trigger: a.trigger ? JSON.parse(JSON.stringify(a.trigger)) : null,
    })),
  }));

export const planStore = {
  // false → privater Modus o. Ä.: Die UI blendet die Bibliothek aus, der
  // Teilen-Code funktioniert trotzdem, denn er braucht keinen Speicher.
  available: !!storage,

  // Alle benannten Einträge, neueste zuerst.
  list() {
    return readData()
      .slots.filter((s) => s && Array.isArray(s.units))
      .sort((a, b) => (b.meta?.at ?? 0) - (a.meta?.at ?? 0));
  },

  // Zuletzt gespielter Aufmarsch einer Fraktion (oder null).
  last(faction) {
    const entry = readData().last?.[faction];
    return entry && Array.isArray(entry.units) ? entry : null;
  },

  save({ name, faction, units, config }) {
    if (!storage) return { ok: false, error: 'Dieser Browser speichert nichts (privater Modus?).' };
    const data = readData();
    // Je Fraktion gezählt, denn die Planungs-UI zeigt auch nur die eigene Seite –
    // ein Limit über beide Fraktionen wäre für den Spieler nicht nachvollziehbar.
    if (data.slots.filter((s) => s.faction === faction).length >= MAX_SLOTS) {
      return { ok: false, error: `Bibliothek voll (${MAX_SLOTS} je Fraktion) – bitte zuerst einen Eintrag löschen.` };
    }
    data.seq = (data.seq ?? 0) + 1;
    const entry = {
      id: `p${data.seq}`,
      name: String(name || `Aufmarsch ${data.seq}`).slice(0, MAX_NAME_LENGTH),
      faction,
      units: cleanUnits(units),
      meta: planMeta(config),
    };
    data.slots.push(entry);
    if (!writeData(data)) return { ok: false, error: 'Speichern fehlgeschlagen – der Speicher ist voll.' };
    return { ok: true, entry };
  },

  remove(id) {
    const data = readData();
    data.slots = data.slots.filter((s) => s.id !== id);
    return writeData(data);
  },

  // Wird nach jedem Schlachtstart aufgerufen – ohne Zutun des Spielers.
  rememberLast(faction, units, config) {
    if (!storage || !units?.length) return false;
    const data = readData();
    data.last = { ...data.last, [faction]: { units: cleanUnits(units), meta: planMeta(config) } };
    return writeData(data);
  },
};
