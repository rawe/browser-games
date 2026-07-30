// CLI für die Headless-Simulation:
//
//   npm run sim:turbo                  → Tabelle über alle Strecken und Stufen
//   npm run sim:turbo -- --check       → Akzeptanzkriterien als PASS/FAIL
//   npm run sim:turbo -- --seeds=12 --difficulty=schwer --stage=2
//   npm run sim:turbo -- --season=2    → dieselben Strecken in Saison 3
//
// `--stage` ist der Index im *Streckenpool* (tracks.js), nicht der Lauf einer
// Saison: gemessen wird jede Strecke einzeln. `--season` legt die Saison-
// staffelung darüber (siehe seasons.js).
//
// Kein Browser nötig, und jeder Lauf ist über den Seed reproduzierbar.

import { tracks } from '../tracks.js';
import { DIFFICULTIES } from '../ai.js';
import { ELEMENT_TYPES } from '../elements.js';
import { PEAK_SEASON } from '../seasons.js';
import {
  simulateHoming, simulateOvertake, simulateParked, simulateSeries, simulateTurboRam,
} from './headless.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const seeds = Number(args.seeds ?? 6);
const levels = args.difficulty ? [args.difficulty] : DIFFICULTIES.map((d) => d.id);
const stages = args.stage !== undefined ? [Number(args.stage)] : tracks.map((_, i) => i);
const season = Number(args.season ?? 0);

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const pad = (v, n) => String(v).padStart(n);

const COLUMNS = [
  ['Strecke', 12, (r) => r.track],
  ['Stufe', 8, (r) => r.difficulty],
  ['Platz Ref.', 10, (r) => r.playerPlace.toFixed(2)],
  ['Siege', 6, (r) => pct(r.playerWins)],
  ['Zeit s', 7, (r) => r.seconds.toFixed(1)],
  ['Ø Tempo', 8, (r) => r.botAvgSpeed.toFixed(2)],
  ['Überh. KI', 10, (r) => r.aiOvertakes.toFixed(1)],
  ['Kolonne', 8, (r) => pct(r.convoyShare)],
  ['Gras', 7, (r) => pct(r.offroadShare)],
  ['Zickzack', 9, (r) => r.zigzag.toFixed(2)],
  ['Kontakte', 9, (r) => r.aiContacts.toFixed(0)],
  ['Sprünge', 8, (r) => r.jumps.toFixed(1)],
  ['Öl', 5, (r) => r.oilHits.toFixed(1)],
  ['Schranke', 9, (r) => `${r.gateSwitches.toFixed(0)}/${r.gateStops.toFixed(0)}`],
  ['Brücke s', 9, (r) => (r.bridgeTicks / 60).toFixed(1)],
  ['Zielsuch', 9, (r) => r.homingHits.toFixed(1)],
  ['Turbo', 6, (r) => r.turboUses.toFixed(1)],
  ['Rammen', 7, (r) => r.turboRams.toFixed(1)],
  ['Öl abgel.', 10, (r) => r.oilDrops.toFixed(1)],
];

function table(rows) {
  console.log(COLUMNS.map(([h, w]) => pad(h, w)).join(' '));
  console.log(COLUMNS.map(([, w]) => '-'.repeat(w)).join(' '));
  for (const r of rows) console.log(COLUMNS.map(([, w, get]) => pad(get(r), w)).join(' '));
}

const results = [];
for (const stage of stages) {
  for (const difficulty of levels) results.push(simulateSeries({ stage, difficulty, season, seeds }));
}
if (season > 0) console.log(`Saison ${season + 1} (Saisonstaffelung aktiv)\n`);
table(results);

// Zweiter Durchgang mit dem starken Fahrer am Steuer. Er ist der Maßstab für
// die Frage aus der Rückmeldung zu Issue #24 – „selbst auf SCHWER überhole ich
// das ganze Feld in Runde eins“. Der Durchschnittsfahrer oben kann das nicht
// beantworten, weil er selbst nur mittelmäßig fährt.
const aces = [];
for (const stage of stages) {
  for (const difficulty of levels) {
    aces.push(simulateSeries({ stage, difficulty, season, seeds, driver: 'ace' }));
  }
}
console.log('\nGegen einen starken Fahrer (Referenzprofil „ASS“: Dauergas, saubere Linie, keine Fehler)');
console.log(['Strecke', 'Stufe', 'Platz Ass', 'Siege', 'Ø Tempo Ass', 'Ø Tempo Bots']
  .map((h, i) => pad(h, [12, 8, 10, 7, 12, 13][i])).join(' '));
for (const r of aces) {
  console.log([
    pad(r.track, 12), pad(r.difficulty, 8), pad(r.playerPlace.toFixed(2), 10),
    pad(pct(r.playerWins), 7), pad(r.playerAvgSpeed.toFixed(2), 12), pad(r.botAvgSpeed.toFixed(2), 13),
  ].join(' '));
}

if (!args.check) process.exit(0);

/* ---------- Akzeptanzkriterien aus Issue #24 ---------- */

// Überhol-Szenarien: fester Bremsklotz vor einem schnelleren Bot.
const duels = [];
for (const stage of stages) {
  for (const difficulty of levels) {
    for (let i = 0; i < seeds; i++) {
      duels.push(simulateOvertake({ stage, difficulty, seed: 1 + i * 977, blockers: 1 }));
      duels.push(simulateOvertake({ stage, difficulty, seed: 1 + i * 977, blockers: 2, ticks: 60 * 40 }));
    }
  }
}
const solo = duels.filter((d) => d.blockers === 1);
const convoy = duels.filter((d) => d.blockers === 2);
const rate = (list, key) => list.filter((d) => d[key]).length / list.length;
const meanOf = (list, key) => {
  const v = list.map((d) => d[key]).filter((x) => Number.isFinite(x));
  return v.reduce((a, b) => a + b, 0) / (v.length || 1);
};

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });
const byLevel = (id) => results.filter((r) => r.difficulty === id);
const aceLevel = (id) => aces.filter((r) => r.difficulty === id);
const avg = (rows, key) => rows.reduce((s, r) => s + r[key], 0) / (rows.length || 1);

if (levels.length === DIFFICULTIES.length) {
  const speeds = DIFFICULTIES.map((d) => avg(byLevel(d.id), 'botAvgSpeed'));
  add('Stufen klar unterscheidbar (Ø Tempo)',
    speeds.every((v, i) => i === 0 || v > speeds[i - 1] + 0.15),
    speeds.map((v, i) => `${DIFFICULTIES[i].id}=${v.toFixed(2)}`).join('  '));

  const places = DIFFICULTIES.map((d) => avg(byLevel(d.id), 'playerPlace'));
  add('Durchschnittsfahrer wird Stufe für Stufe schlechter',
    places.every((v, i) => i === 0 || v > places[i - 1] + 0.3),
    places.map((v, i) => `${DIFFICULTIES[i].id}=${v.toFixed(2)}`).join('  '));

  // Der Kern der Rückmeldung zu Issue #24: Gemessen wird an einem starken
  // Fahrer, nicht am Durchschnitt. Gegen den Durchschnittsfahrer sah die
  // Staffelung schon vorher gut aus – gewonnen hat trotzdem der Spieler.
  const wins = DIFFICULTIES.map((d) => avg(aceLevel(d.id), 'playerWins'));
  const aceWins = (id) => avg(aceLevel(id), 'playerWins');
  const acePlace = (id) => avg(aceLevel(id), 'playerPlace');

  // Jede Stufe wird an dem Fahrer gemessen, für den sie gemacht ist. Die
  // frühere Fassung verlangte, dass die Siegquote des starken Fahrers auf
  // *jeder* Stufe fällt – das ist nur erfüllbar, wenn auch LEICHT ihn schon
  // schlägt, und dann ist LEICHT kein Einstieg mehr. Umgekehrt sättigt der
  // Durchschnittsfahrer schon auf MITTEL beim letzten Platz und kann sich auf
  // SCHWER gar nicht mehr verschlechtern. Beides sagt nichts über die
  // Staffelung aus, sondern nur über den falsch gewählten Maßstab.
  add('Sprung von LEICHT auf MITTEL trifft den Durchschnittsfahrer',
    places[1] - places[0] > 1,
    `Ø Platz leicht=${places[0].toFixed(2)} → mittel=${places[1].toFixed(2)}`);

  add('Sprung von MITTEL auf SCHWER trifft den starken Fahrer',
    wins[1] - wins[2] > 0.3,
    wins.map((v, i) => `${DIFFICULTIES[i].id}=${pct(v)} Siege`).join('  '));

  add('Auf SCHWER gewinnt auch ein starker Fahrer nicht mehr durch (< 45 % Siege)',
    aceWins('schwer') < 0.45,
    `${pct(aceWins('schwer'))} Siege, Ø Platz ${acePlace('schwer').toFixed(2)}`);

  add('SCHWER bleibt schlagbar (starker Fahrer schafft das Podium)',
    acePlace('schwer') < 3.2 && aceWins('schwer') > 0.05,
    `Ø Platz ${acePlace('schwer').toFixed(2)}, ${pct(aceWins('schwer'))} Siege`);

  add('LEICHT bleibt ein Einstieg (Durchschnittsfahrer gewinnt)',
    avg(byLevel('leicht'), 'playerWins') > 0.8,
    `${pct(avg(byLevel('leicht'), 'playerWins'))} Siege des Durchschnittsfahrers`);
}

add('Schnellerer Bot überholt den langsameren (≥ 90 % der Duelle)',
  rate(solo, 'passed') >= 0.9,
  `${(rate(solo, 'passed') * 100).toFixed(0)} % in Ø ${meanOf(solo, 'seconds').toFixed(1)} s`);

add('Auch aus einer Kolonne heraus wird überholt (≥ 80 % mindestens einmal)',
  rate(convoy, 'passedFirst') >= 0.8,
  `${(rate(convoy, 'passedFirst') * 100).toFixed(0)} % in Ø ${meanOf(convoy, 'firstSeconds').toFixed(1)} s, ` +
  `beide überholt: ${(rate(convoy, 'passed') * 100).toFixed(0)} %`);

const maxConvoy = Math.max(...results.map((r) => r.convoyShare));
add('Keine Dauer-Kolonne im Rennen (< 8 % der Zeit)', maxConvoy < 0.08, `Maximum ${pct(maxConvoy)}`);

const maxZigzag = Math.max(...results.map((r) => r.zigzag));
add('Keine Schlangenlinien (< 3 Richtungswechsel/s)', maxZigzag < 3, `Maximum ${maxZigzag.toFixed(2)}`);

const maxContacts = Math.max(...results.map((r) => r.aiContacts));
add('Keine Dauerkollisionen (< 400 Kontakt-Ticks je Rennen)', maxContacts < 400,
  `Maximum ${maxContacts.toFixed(0)}`);

const maxOffroad = Math.max(...results.map((r) => r.offroadShare));
add('Bots bleiben auf der Strecke (< 5 % Gras)', maxOffroad < 0.05, `Maximum ${pct(maxOffroad)}`);

const noFinish = results.reduce((s, r) => s + r.runs.filter((run) => !run.playerFinished).length, 0);
add('Rennen laufen sauber durch', noFinish === 0, `${noFinish} Rennen ohne Zieleinlauf`);

// Härtefall: ein stehendes Auto mitten auf der Ideallinie. Früher stauten sich
// die Bots dahinter bis zum Stillstand.
const parked = [];
for (const stage of stages) {
  for (const difficulty of levels) {
    parked.push(simulateSeries({ stage, difficulty, seeds: Math.min(3, seeds), driver: 'parked', maxTicks: 60 * 150 }));
  }
}
const worstBlocked = Math.max(...parked.map((r) => r.maxBlocked));
const fewestLaps = Math.min(...parked.map((r) => r.minBotLaps));
add('Stehendes Hindernis blockiert die Bots nicht dauerhaft',
  worstBlocked < 600 && fewestLaps >= 3,
  `längste Blockade ${(worstBlocked / 60).toFixed(1)} s, wenigste Runden ${fewestLaps} in 150 s`);

// Ausweichen heißt vorbeikommen, nicht nur den Blinker setzen: Aus der
// Rückmeldung zu Issue #24 – „die Bots versuchen auszuweichen, ich werde
// trotzdem gerammt“. Hier zählt jede Vorbeifahrt an einem festgenagelten
// Fahrzeug, und jede Berührung dabei geht in die Quote ein.
//
// Die Stelle in der Runde wird bewusst gestreut. Eine einzelne Messstelle sagt
// wenig: An einer Geraden weicht jeder aus, in einer engen Haarnadel niemand.
// Eine frühere Fassung maß nur bei 50 % der Runde und kam auf 0,2 % – über die
// ganze Runde gemessen waren es 5 %, mit einzelnen Stellen bei 100 %.
const PARK_SPOTS = [0.08, 0.2, 0.32, 0.44, 0.55, 0.67, 0.79, 0.91];
const dodges = [];
for (const stage of stages) {
  for (const difficulty of levels) {
    for (const at of PARK_SPOTS) {
      // Auch seitlich versetzt prüfen – auf der Ideallinie ist der Fall am
      // eindeutigsten, am Rand wird die Lücke auf einer Seite eng.
      for (const lat of [0, 22, -22]) {
        dodges.push(simulateParked({ stage, difficulty, seed: 1, lat, at, ticks: 60 * 60 }));
      }
    }
  }
}
const passes = dodges.reduce((s, d) => s + d.encounters, 0);
const rams = dodges.reduce((s, d) => s + d.rams, 0);
const nearest = Math.min(...dodges.map((d) => d.closest));
add('Bots fahren an einem stehenden Fahrzeug vorbei, statt es zu rammen (< 5 %)',
  passes > 100 && rams / passes < 0.05,
  `${rams} Berührungen in ${passes} Vorbeifahrten (${pct(rams / Math.max(1, passes))}), ` +
  `engster Abstand ${nearest.toFixed(1)} (Berührung ab 26)`);

// Zusätzlich: keine einzelne Stelle darf reihenweise zu Berührungen führen.
// Der Durchschnitt verdeckt sonst genau die Stellen, an denen es klemmt.
//
// Gewertet werden nur Stellen, an denen überhaupt eine Lücke bleibt. Zwei
// Fälle lassen keine: eine sehr enge Kehre (HAFEN-GP bei 67 % hat 2,2 rad
// Krümmung auf 120 Einheiten – der Kurveninnenrand ist dort fast ein Punkt)
// und ein stehendes Fahrzeug direkt an einer geschlossenen Schranke. Dort ist
// eine Berührung kein Fehler der KI, sondern schlicht kein Platz. Diese
// Stellen werden getrennt ausgewiesen, damit sie nicht unter den Tisch fallen.
const bySpot = new Map();
for (const d of dodges) {
  const key = `${d.track} @ ${(d.at * 100).toFixed(0)} %`;
  const acc = bySpot.get(key) ?? { passes: 0, rams: 0, passable: false };
  acc.passes += d.encounters;
  acc.rams += d.rams;
  acc.passable = acc.passable || d.passable;
  bySpot.set(key, acc);
}
const allSpots = [...bySpot.entries()]
  .filter(([, v]) => v.passes >= 8)
  .map(([key, v]) => ({ key, share: v.rams / v.passes, ...v }))
  .sort((a, b) => b.share - a.share);
const spots = allSpots.filter((s) => s.passable);
const blocked = allSpots.filter((s) => !s.passable);
add('Keine passierbare Stelle ist ein Rammpunkt (< 25 % Berührungen)',
  spots.length > 0 && spots[0].share < 0.25,
  `schlechteste: ${spots.slice(0, 3).map((s) => `${s.key} ${pct(s.share)}`).join('  •  ')}`);
// Und es dürfen nicht beliebig viele solcher Stellen sein – sonst wäre das
// Kriterium oben durch Wegdefinieren zu erfüllen.
add(`Höchstens eine Engstelle je Strecke ohne Lücke (${stages.length} Strecken)`,
  blocked.length <= stages.length,
  blocked.length === 0 ? 'keine' : blocked.map((s) => `${s.key} ${pct(s.share)}`).join('  •  '));

/* ---------- Akzeptanzkriterien aus Issue #26 (Streckenelemente) ---------- */

// Nur prüfen, wenn alle Strecken im Lauf sind – sonst fehlen Elementtypen.
if (stages.length === tracks.length) {
  const withType = (type) => tracks
    .map((t, i) => ({ i, has: (t.elements ?? []).some((el) => el.type === type) }))
    .filter((e) => e.has).map((e) => e.i);
  const rowsOf = (stageList) => results.filter((r) => stageList.includes(r.stage));
  const total = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

  const rampRows = rowsOf(withType('ramp'));
  add('Sprungschanzen werden befahren',
    withType('ramp').length > 0 && total(rampRows, 'jumps') > 0,
    `${total(rampRows, 'jumps').toFixed(0)} Sprünge, ${(total(rampRows, 'airTicks') / 60).toFixed(0)} s Flugzeit`);

  const oilRows = rowsOf(withType('oil'));
  add('Öllachen bringen Fahrzeuge ins Schleudern',
    total(oilRows, 'oilHits') > 0,
    `${total(oilRows, 'oilHits').toFixed(0)} Auslösungen`);

  const gateRows = rowsOf(withType('gate'));
  add('Schranken wechseln während des Rennens ihren Zustand',
    total(gateRows, 'gateSwitches') > 0,
    `${total(gateRows, 'gateSwitches').toFixed(0)} Zustandswechsel`);

  // Die KI soll die Sperre umfahren, nicht dauernd hineinfahren.
  const stopsPerRace = total(gateRows, 'gateStops') / Math.max(1, gateRows.length);
  add('KI fährt nicht dauernd in geschlossene Schranken (< 90 Ticks je Rennen)',
    stopsPerRace < 90, `Ø ${stopsPerRace.toFixed(0)} Ticks je Rennen`);

  const bridgeRows = rowsOf(withType('bridge'));
  add('Brücken werden befahren (obere Höhenebene erreicht)',
    total(bridgeRows, 'bridgeTicks') > 0,
    `${(total(bridgeRows, 'bridgeTicks') / 60).toFixed(1)} s auf der oberen Ebene`);

  add('Fahrzeuge auf getrennten Ebenen kollidieren nicht',
    total(bridgeRows, 'crossLevelPasses') > 0,
    `${total(bridgeRows, 'crossLevelPasses').toFixed(0)} Begegnungen ohne Kontakt – ohne Höhentrennung wären das Kollisionen`);

  add('Alle Elementtypen sind auf mindestens einer Strecke im Einsatz',
    Object.keys(ELEMENT_TYPES).every((type) => withType(type).length > 0),
    Object.keys(ELEMENT_TYPES).map((t) => `${t}=${withType(t).length}`).join('  '));
}

/* ---------- Akzeptanzkriterien aus Issue #27 (Arsenal) ---------- */
{
  const sum = (key) => results.reduce((s, r) => s + r[key], 0);
  const late = results.filter((r) => r.stage >= 2); // ab hier hat die KI das volle Arsenal

  add('KI setzt Zielsuchraketen ein und trifft damit',
    sum('homingHits') > 0, `${sum('homingHits').toFixed(0)} Treffer`);

  add('KI setzt den Turbo ein',
    sum('turboUses') > 0, `${sum('turboUses').toFixed(0)} Schübe`);

  add('KI legt Öllachen ab',
    sum('oilDrops') > 0, `${sum('oilDrops').toFixed(0)} Ablagen`);

  // Die Ramme ist ein seltener Glücksfall – sie muss vorkommen können,
  // darf das Rennen aber nicht bestimmen.
  add('Turbo-Sprünge auf Gegner kommen vor, bleiben aber selten',
    sum('turboRams') > 0 && sum('turboRams') / Math.max(1, results.length) < 3,
    `${sum('turboRams').toFixed(0)} Rammen in ${results.length} Serien`);

  // Balance: das neue Arsenal darf die Rennen nicht in Materialschlachten
  // verwandeln – die Referenzfahrt muss weiter sauber durchlaufen.
  const lateContacts = Math.max(...late.map((r) => r.aiContacts), 0);
  add('Arsenal bleibt ausbalanciert (keine Materialschlacht)',
    lateContacts < 400, `höchste Kontaktzahl in späten Rennen: ${lateContacts.toFixed(0)}`);

  // Gezielte Szenarien – im normalen Rennen treten diese Fälle zu selten auf,
  // um daraus etwas ablesen zu können.
  const rams = [];
  for (const error of [-20, -10, 0, 10, 20]) {
    for (let i = 0; i < 3; i++) rams.push(simulateTurboRam({ error, seed: 1 + i * 977 }));
  }
  const hits = rams.filter((r) => r.rammed);
  const minRamDamage = Math.min(Infinity, ...hits.map((r) => r.victimDamage));
  add('Turbo-Sprung auf ein Fahrzeug richtet erheblichen Schaden an',
    hits.length > 0 && minRamDamage >= 40,
    `${hits.length}/${rams.length} Landungen trafen, Schaden am Getroffenen ab ${minRamDamage}, ` +
    `Rückschlag für den Angreifer ${hits[0]?.attackerDamage ?? 0}`);

  const straight = [0, 20, 34, 44].map((offset) => simulateHoming({ offset, homing: false }));
  const homing = [0, 20, 34, 44].map((offset) => simulateHoming({ offset, homing: true }));
  add('Zielsuchraketen verfolgen ihr Ziel zuverlässig',
    homing.every((r) => r.hit && r.hadTarget),
    `zielsuchend ${homing.filter((r) => r.hit).length}/${homing.length} Treffer, ` +
    `gerade ${straight.filter((r) => r.hit).length}/${straight.length} bei seitlich versetztem Ziel`);

  // Gemessen wird der tatsächliche Trefferschaden – die gerade Rakete trifft
  // im Versatz-Aufbau nie, deshalb dient ein Treffer aus kurzer Distanz
  // geradeaus als Vergleichswert.
  const nose = simulateHoming({ offset: 0, gap: 60, homing: false });
  const homingDamage = Math.max(...homing.map((r) => r.damage));
  add('Zielsuchrakete trifft härter als eine gerade Rakete',
    nose.hit && homingDamage > nose.damage,
    `${homingDamage} gegen ${nose.damage} Schaden`);
}

/* ---------- Akzeptanzkriterien der Saisonstaffelung ---------- */

// Die Frage hinter den Saisons: Bleibt es interessant, wenn der Spieler seinen
// ausgebauten Wagen mitnimmt? Gemessen wird an zwei Strecken über alle Saisons
// bis über den Anschlag hinaus – einmal das Gegnertempo, einmal der starke
// Fahrer mit dem Ausbaustand, den er in dieser Saison plausibel hätte.
// Gemessen wird auf SCHWER: Nur dort ist die Frage überhaupt zu stellen. Auf
// MITTEL gewinnt ein starker Fahrer schon in Saison 1 fast jedes Rennen – da
// wäre keine Verschiebung mehr abzulesen.
if (args.stage === undefined && args.season === undefined) {
  const seasonStages = [1, tracks.length - 1];
  const seasonSeeds = Math.min(4, seeds);
  const perSeason = [];
  for (let s = 0; s <= PEAK_SEASON + 1; s++) {
    const rows = seasonStages.map((stage) =>
      simulateSeries({ stage, difficulty: 'schwer', season: s, seeds: seasonSeeds }));
    const aceRows = seasonStages.map((stage) =>
      simulateSeries({ stage, difficulty: 'schwer', season: s, seeds: seasonSeeds, driver: 'ace' }));
    perSeason.push({
      season: s,
      botSpeed: avg(rows, 'botAvgSpeed'),
      aceWins: avg(aceRows, 'playerWins'),
      acePlace: avg(aceRows, 'playerPlace'),
    });
  }

  const speeds = perSeason.map((p) => p.botSpeed);
  const detail = perSeason.map((p) => `S${p.season + 1}=${p.botSpeed.toFixed(2)}`).join('  ');
  add('Das Feld wird Saison für Saison schneller (bis zum Anschlag)',
    speeds[PEAK_SEASON] > speeds[0] + 0.4
    && speeds.slice(1, PEAK_SEASON + 1).every((v, i) => v > speeds[i] - 0.03),
    detail);

  add('Am Anschlag hört die Steigerung auf',
    Math.abs(speeds[PEAK_SEASON + 1] - speeds[PEAK_SEASON]) < 0.06,
    `S${PEAK_SEASON + 1}=${speeds[PEAK_SEASON].toFixed(2)}  S${PEAK_SEASON + 2}=${speeds[PEAK_SEASON + 1].toFixed(2)}`);

  // Der mitgenommene Wagen darf die späten Saisons nicht zum Selbstläufer
  // machen – sonst wäre „Verbesserungen mitnehmen" ein Abschalter.
  const worstWins = Math.max(...perSeason.map((p) => p.aceWins));
  add('Mitgenommenes Tuning macht keine Saison zum Selbstläufer (< 60 % Siege auf SCHWER)',
    worstWins < 0.6,
    perSeason.map((p) => `S${p.season + 1}=${pct(p.aceWins)}`).join('  '));

  // Und andersherum: Es darf auch nicht aussichtslos werden. Maßstab ist die
  // erste Saison – der absolute Platz sagt hier wenig, weil gerade die beiden
  // schwersten Strecken des Pools gemessen werden.
  const later = perSeason.slice(1).map((p) => p.acePlace);
  add('Keine spätere Saison ist schwerer als die erste',
    Math.max(...later) <= perSeason[0].acePlace + 0.3,
    perSeason.map((p) => `S${p.season + 1}=Ø ${p.acePlace.toFixed(2)}`).join('  '));

  add('Auch am Anschlag ist das Podium drin',
    perSeason[PEAK_SEASON].acePlace < 3.2,
    `S${PEAK_SEASON + 1}: Ø Platz ${perSeason[PEAK_SEASON].acePlace.toFixed(2)}, `
    + `${pct(perSeason[PEAK_SEASON].aceWins)} Siege`);
}

console.log('\nAkzeptanzkriterien');
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? '\nAlle Kriterien erfüllt.' : `\n${failed} Kriterium/Kriterien verfehlt.`);
process.exitCode = failed === 0 ? 0 : 1;
