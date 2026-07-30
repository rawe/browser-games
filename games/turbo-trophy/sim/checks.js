// Headless-Prüfungen der DOM-freien Spiellogik.
//
//   npm run check:turbo
//
// Ergänzt die Renn-Simulation (`sim/run.js`), die das Fahrverhalten über ganze
// Rennen misst. Hier stehen kleine, exakte Zustandsprüfungen – schnell genug,
// um sie bei jeder Änderung laufen zu lassen.

import { createThrottle, TAP_MS } from '../throttle.js';
import { tracks } from '../tracks.js';
import { buildTrack, posAt, ROAD_WIDTH } from '../trackGeometry.js';
import { normalizeElement } from '../elements.js';
import { ITEMS } from '../items.js';
import {
  MAX_TUNING_CAP, NAMED_SEASONS, PEAK_SEASON,
  calendarFor, racesIn, seasonAiBonus, seasonAt, startChoices, tuningCap,
} from '../seasons.js';
import { createCareer, maxLevel, nextSeason, upgradeCost } from '../career.js';

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
const eq = (name, actual, expected) =>
  check(name, actual === expected, `erwartet ${expected}, war ${actual}`);

/* ---------- Gas-Schalter (Issue #25) ---------- */

const TAP = TAP_MS - 60;   // eindeutig ein Tippen
const HOLD = TAP_MS + 400; // eindeutig ein Halten

{
  // Kurzes Tippen schaltet Dauergas ein und lässt es an.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  eq('Tippen aktiviert Dauergas', t.latched, true);
  eq('Dauergas gibt Gas ohne gedrückten Finger', t.active, true);
}

{
  // Erneutes Tippen schaltet wieder aus.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  t.press(1000);
  t.release(1000 + TAP);
  eq('Erneutes Tippen beendet Dauergas', t.latched, false);
  eq('Nach dem Ausschalten kein Gas mehr', t.active, false);
}

{
  // Halten verhält sich wie bisher: Gas nur, solange gedrückt wird.
  const t = createThrottle();
  t.press(0);
  eq('Gas beim Drücken sofort aktiv', t.active, true);
  t.release(HOLD);
  eq('Nach langem Halten kein Dauergas', t.latched, false);
  eq('Nach langem Halten kein Gas', t.active, false);
}

{
  // Halten aus dem Dauergas heraus beendet es beim Loslassen.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  t.press(1000);
  t.release(1000 + HOLD);
  eq('Langes Halten beendet laufendes Dauergas', t.latched, false);
}

{
  // Bremsen ist die eindeutige Gegenaktion.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  t.brake();
  eq('Bremsen beendet Dauergas', t.latched, false);
  eq('Bremsen nimmt das Gas weg', t.active, false);
}

{
  // Bremsen, während der Finger auf dem Gas liegt: Gas bleibt am Finger,
  // aber das Dauergas ist weg.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  t.press(1000);
  t.brake();
  eq('Bremsen bei liegendem Finger löst nur das Dauergas', t.latched, false);
  eq('Gas hängt dann wieder am Finger', t.active, true);
  t.release(1000 + TAP);
  eq('Loslassen schaltet danach neu ein', t.latched, true);
}

{
  // `touchcancel` (Anruf, Systemgeste) darf das Dauergas nicht kippen.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  t.press(1000);
  t.cancel();
  eq('Abbruch lässt Dauergas bestehen', t.latched, true);
  eq('Abbruch lässt Gas bestehen', t.active, true);
}

{
  // Ohne Dauergas beendet ein Abbruch das Gas.
  const t = createThrottle();
  t.press(0);
  t.cancel();
  eq('Abbruch ohne Dauergas nimmt das Gas weg', t.active, false);
}

{
  // Rennwechsel darf keinen hängenden Gaszustand hinterlassen.
  const t = createThrottle();
  t.press(0);
  t.release(TAP);
  t.reset();
  eq('reset() räumt das Dauergas ab', t.active, false);
}

{
  // Doppeltes press/release aus verschachtelten Events darf nichts kippen.
  const t = createThrottle();
  t.press(0);
  t.press(50);
  t.release(TAP);
  t.release(TAP + 50);
  eq('Doppelte Events bleiben folgenlos', t.latched, true);
}

/* ---------- Streckengeometrie ---------- */
//
// Eine neue Strecke ist schnell eingetragen und schwer nachzumessen. Diese
// Prüfungen fangen die drei Fehler ab, die man von Hand nicht sieht: zwei
// Fahrbahnen, die sich ohne Brücke überlagern; eine Kehre, die enger ist als
// der Wendekreis; und Elemente, die über den Fahrbahnrand hinausragen.

// Ab dieser Bogenlängen-Trennung gelten zwei Stellen als verschiedene
// Streckenteile und dürfen sich nicht mehr nahekommen.
const APART = 260;
// Zwei Fahrbahnen berühren sich, wenn ihre Mitten näher als eine Fahrbahnbreite
// beieinander liegen.
const CLEAR = ROAD_WIDTH;
// Richtungsänderung über 120 Einheiten, ab der eine Kurve als Haarnadel gilt.
const HAIRPIN = 2.6;

/**
 * Kreuzungen: Stellen, an denen sich zwei weit auseinander liegende
 * Streckenteile näher als eine Fahrbahnbreite kommen. Zusammenhängende Funde
 * werden zu einer Kreuzung zusammengefasst und auf ihren engsten Punkt
 * reduziert – genau dort muss eine Brücke liegen.
 */
function crossingsOf(track) {
  const step = 25;
  const hits = [];
  for (let s = 0; s < track.total; s += step) {
    const p = posAt(track, s);
    for (let u = s + APART; u < track.total; u += step) {
      if (track.total - (u - s) < APART) break; // um den Rundenschluss herum
      const q = posAt(track, u);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < CLEAR) hits.push({ a: s / track.total, b: u / track.total, d });
    }
  }
  // Nach Nähe gruppieren: Was innerhalb von 6 % der Runde liegt, gehört zur
  // selben Kreuzung.
  const groups = [];
  for (const hit of hits) {
    const near = groups.find((g) => Math.abs(g.a - hit.a) < 0.06 && Math.abs(g.b - hit.b) < 0.06);
    if (!near) groups.push({ ...hit });
    else if (hit.d < near.d) Object.assign(near, hit);
  }
  return groups;
}

for (const def of tracks) {
  const track = buildTrack(def);
  /** Deckt eine Brücke diese Stelle der Runde ab? */
  const bridged = (at) => (def.elements ?? []).some((el) => {
    if (el.type !== 'bridge') return false;
    const span = (el.length ?? 150) / track.total;
    return ((at - el.at) % 1 + 1) % 1 <= span;
  });

  // Eine Kreuzung ist in Ordnung, wenn *einer* der beiden Durchgänge auf einer
  // Brücke liegt – dann fahren die Ebenen übereinander statt ineinander.
  const unbridged = crossingsOf(track).filter((c) => !bridged(c.a) && !bridged(c.b));
  check(`${def.name}: keine ungebrückte Kreuzung`, unbridged.length === 0,
    unbridged.map((c) => `${(c.a * 100).toFixed(0)}%↔${(c.b * 100).toFixed(0)}%`).join(', '));

  let maxCurve = 0;
  for (let s = 0; s < track.total; s += 20) {
    let d = posAt(track, s + 120).angle - posAt(track, s).angle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    maxCurve = Math.max(maxCurve, Math.abs(d));
  }
  check(`${def.name}: keine unfahrbare Haarnadel`, maxCurve < HAIRPIN,
    `engste Kurve ${maxCurve.toFixed(2)} rad/120 (Grenze ${HAIRPIN})`);

  const edge = ROAD_WIDTH / 2;
  const outside = (def.elements ?? []).map(normalizeElement).filter((el) => {
    if (!el) return true;
    const half = el.type === 'oil' ? el.radius : (el.width ?? 0) / 2;
    return Math.abs(el.lat ?? 0) + half > edge;
  });
  check(`${def.name}: alle Elemente liegen auf der Fahrbahn`, outside.length === 0,
    outside.map((el) => el?.type ?? '?').join(', '));
}

/* ---------- Saisonmodell ---------- */

{
  const known = new Set(tracks.map((t) => t.id));
  const bad = [];
  for (let i = 0; i < NAMED_SEASONS.length; i++) {
    for (const id of NAMED_SEASONS[i].trackIds) if (!known.has(id)) bad.push(`${i}:${id}`);
  }
  check('Alle Saisonkalender verweisen auf vorhandene Strecken', bad.length === 0, bad.join(', '));

  // Auch weit hinter den benannten Saisons muss ein Kalender herauskommen –
  // die offene Meisterschaft ist der Dauerzustand einer langen Karriere.
  const empty = [];
  for (let i = 0; i < 40; i++) if (racesIn(i) < 3) empty.push(i);
  check('Jede Saison hat einen Kalender', empty.length === 0, `leer bei: ${empty.join(', ')}`);

  const ramp = calendarFor(1).map((t) => t.aiBonus);
  check('Kalender sind nach Gegnertempo aufsteigend sortiert',
    ramp.every((v, i) => i === 0 || v >= ramp[i - 1]), ramp.join(' → '));

  // Jede Strecke des Pools soll auch wirklich vorkommen – sonst baut man
  // Kurse, die nie jemand fährt.
  const used = new Set();
  for (let i = 0; i < 12; i++) for (const t of calendarFor(i)) used.add(t.id);
  const unused = tracks.filter((t) => !used.has(t.id)).map((t) => t.id);
  check('Jede Strecke kommt in den ersten zwölf Saisons vor', unused.length === 0, unused.join(', '));

  const bonuses = [];
  for (let i = 0; i <= PEAK_SEASON + 2; i++) bonuses.push(seasonAiBonus(i));
  check('Gegnertempo steigt bis zum Anschlag und dann nicht weiter',
    bonuses.slice(1, PEAK_SEASON + 1).every((v, i) => v > bonuses[i])
    && bonuses[PEAK_SEASON + 1] === bonuses[PEAK_SEASON],
    bonuses.map((v) => v.toFixed(2)).join(' → '));

  const caps = [];
  for (let i = 0; i < 10; i++) caps.push(tuningCap(i));
  check('Ausbaugrenze wächst je Saison bis zum Maximum',
    caps.every((v, i) => i === 0 || v >= caps[i - 1]) && caps.at(-1) === MAX_TUNING_CAP,
    caps.join(' → '));

  // Jede offene Stufe muss auch einen Preis haben, sonst wäre sie unkaufbar.
  const priceless = [];
  for (let i = 0; i < 10; i++) {
    const career = { ...createCareer(), season: i };
    for (let level = 0; level < maxLevel(career); level++) {
      if (!Number.isFinite(upgradeCost(career, level))) priceless.push(`S${i + 1}/${level}`);
    }
  }
  check('Jede freigeschaltete Ausbaustufe hat einen Preis', priceless.length === 0, priceless.join(', '));
}

/* ---------- Quereinstieg in einen späteren Cup ---------- */

{
  // Jeder Cup ist beim Spielstart wählbar. Der Wagen dazu muss in die
  // gewählte Saison passen: nicht über der Ausbaugrenze (sonst zeigt die
  // Werkstatt Stufen, die es nicht zu kaufen gab) und nicht über dem
  // Höchstbestand eines Items.
  const bad = [];
  for (const season of startChoices().map((s) => s.index)) {
    const career = createCareer(undefined, season);
    if (career.season !== season) bad.push(`S${season + 1}: falsche Saison`);
    const cap = maxLevel(career);
    for (const key of ['engine', 'handling', 'armor']) {
      if (career[key] > cap) bad.push(`S${season + 1}: ${key} ${career[key]} > Grenze ${cap}`);
    }
    for (const item of ITEMS) {
      const have = career.ammo[item.id] ?? 0;
      if (have > item.max) bad.push(`S${season + 1}: ${item.id} ${have} > max ${item.max}`);
    }
    if (career.money <= 0) bad.push(`S${season + 1}: kein Startkapital`);
  }
  check('Startausstattung passt zu jedem wählbaren Cup', bad.length === 0, bad.join(', '));

  const first = createCareer(undefined, 0);
  eq('Der erste Cup startet unverändert bei null', `${first.engine}/${first.handling}/${first.armor}/${first.money}`, '0/0/0/1000');

  // Der Quereinstieg soll dem entsprechen, womit ein Aufsteiger dort ankäme.
  const climbed = createCareer();
  climbed.engine = tuningCap(0);
  climbed.handling = tuningCap(0);
  climbed.armor = tuningCap(0) - 1;
  nextSeason(climbed);
  const direct = createCareer(undefined, 1);
  eq('Quereinstieg entspricht dem Wagen eines Aufsteigers',
    `${direct.engine}/${direct.handling}/${direct.armor}`,
    `${climbed.engine}/${climbed.handling}/${climbed.armor}`);

  const levels = startChoices().map((s) => createCareer(undefined, s.index).engine);
  check('Spätere Cups starten mit mehr Wagen', levels.every((v, i) => i === 0 || v > levels[i - 1]),
    levels.join(' → '));
}

/* ---------- Saisonwechsel ---------- */

{
  // Der Kern der Sache: Beim Wechsel darf nichts Erspieltes verloren gehen.
  const career = createCareer();
  career.engine = 4;
  career.handling = 3;
  career.armor = 2;
  career.money = 800;
  career.hp = 61;
  career.points = 37;
  career.totalPoints = 37;
  career.ammo.homing = 3;
  career.stage = racesIn(0) - 1;

  const { season, bonus } = nextSeason(career);
  eq('Saisonwechsel zählt die Saison hoch', season, 1);
  eq('Saisonwechsel setzt den Kalender zurück', career.stage, 0);
  eq('Saisonwechsel trägt den Titel ein', career.titles, 1);
  eq('Tuning wird mitgenommen', `${career.engine}/${career.handling}/${career.armor}`, '4/3/2');
  eq('Arsenal wird mitgenommen', career.ammo.homing, 3);
  eq('Schaden bleibt bestehen', career.hp, 61);
  eq('Meisterprämie landet auf dem Konto', career.money, 800 + bonus);
  eq('Saisonpunkte starten neu', career.points, 0);
  eq('Karrierepunkte bleiben', career.totalPoints, 37);
  check('Neue Saison gibt eine Ausbaustufe frei', maxLevel(career) > tuningCap(0),
    `${tuningCap(0)} → ${maxLevel(career)}`);
  check('Die nächste Saison hat einen Namen', Boolean(seasonAt(career.season).name),
    seasonAt(career.season).name);
}

/* ---------- Ausgabe ---------- */

console.log('Prüfungen');
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? `\nAlle ${checks.length} Prüfungen bestanden.` : `\n${failed} Prüfung(en) fehlgeschlagen.`);
process.exitCode = failed === 0 ? 0 : 1;
