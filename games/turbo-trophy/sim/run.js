// CLI für die Headless-Simulation:
//
//   npm run sim:turbo                  → Tabelle über alle Strecken und Stufen
//   npm run sim:turbo -- --check       → Akzeptanzkriterien als PASS/FAIL
//   npm run sim:turbo -- --seeds=12 --difficulty=schwer --stage=2
//
// Kein Browser nötig, und jeder Lauf ist über den Seed reproduzierbar.

import { tracks } from '../tracks.js';
import { DIFFICULTIES } from '../ai.js';
import { simulateOvertake, simulateSeries } from './headless.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const seeds = Number(args.seeds ?? 6);
const levels = args.difficulty ? [args.difficulty] : DIFFICULTIES.map((d) => d.id);
const stages = args.stage !== undefined ? [Number(args.stage)] : tracks.map((_, i) => i);

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
];

function table(rows) {
  console.log(COLUMNS.map(([h, w]) => pad(h, w)).join(' '));
  console.log(COLUMNS.map(([, w]) => '-'.repeat(w)).join(' '));
  for (const r of rows) console.log(COLUMNS.map(([, w, get]) => pad(get(r), w)).join(' '));
}

const results = [];
for (const stage of stages) {
  for (const difficulty of levels) results.push(simulateSeries({ stage, difficulty, seeds }));
}
table(results);

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
const avg = (rows, key) => rows.reduce((s, r) => s + r[key], 0) / (rows.length || 1);

if (levels.length === DIFFICULTIES.length) {
  const speeds = DIFFICULTIES.map((d) => avg(byLevel(d.id), 'botAvgSpeed'));
  add('Stufen klar unterscheidbar (Ø Tempo)',
    speeds.every((v, i) => i === 0 || v > speeds[i - 1] + 0.15),
    speeds.map((v, i) => `${DIFFICULTIES[i].id}=${v.toFixed(2)}`).join('  '));

  const places = DIFFICULTIES.map((d) => avg(byLevel(d.id), 'playerPlace'));
  add('Referenzfahrer wird Stufe für Stufe schlechter',
    places.every((v, i) => i === 0 || v > places[i - 1] + 0.3),
    places.map((v, i) => `${DIFFICULTIES[i].id}=${v.toFixed(2)}`).join('  '));

  add('Auch „schwer" bleibt schlagbar (Referenzfahrer nicht immer Letzter)',
    avg(byLevel('schwer'), 'playerPlace') < 3.9,
    `Ø Platz ${avg(byLevel('schwer'), 'playerPlace').toFixed(2)}`);
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

console.log('\nAkzeptanzkriterien');
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? '\nAlle Kriterien erfüllt.' : `\n${failed} Kriterium/Kriterien verfehlt.`);
process.exitCode = failed === 0 ? 0 : 1;
