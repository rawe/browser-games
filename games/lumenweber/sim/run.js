// CLI der Headless-Simulation.
//
//   npm run sim:lumen                  Kennzahlentabelle aller Level
//   npm run sim:lumen -- --show=l03    Start- und Lösungsbild als ASCII
//   npm run sim:lumen -- --show=all
//   npm run sim:lumen -- --par         Par-Werte zum Übernehmen in levels.js
//   npm run sim:lumen -- --fuzz=2000   Zufalls-Tipps je Level

import { levels, levelById } from '../levels.js';
import { levelReport, fuzzLevel, showStart, showSolved } from './headless.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};

const pad = (value, width, right = false) => {
  const s = String(value);
  return right ? s.padStart(width) : s.padEnd(width);
};

function table(rows, columns) {
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(c.get(r)).length)));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i], columns[i].right)).join('  ');
  console.log(line(columns.map((c) => c.label)));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(columns.map((c) => c.get(row))));
}

const show = flag('show');
if (show) {
  const picked = show === true || show === 'all' ? levels : [levelById.get(show)];
  for (const level of picked) {
    if (!level) { console.error(`Unbekanntes Level: ${show}`); process.exit(1); }
    console.log(`\n── Start ─────────────────────────────`);
    console.log(showStart(level));
    console.log(`\n── Lösung ────────────────────────────`);
    console.log(showSolved(level));
    if (level.hint) console.log(`\n„${level.hint}“`);
    console.log();
  }
  process.exit(0);
}

const reports = levels.map(levelReport);

if (flag('par')) {
  for (const r of reports) console.log(`${r.id}: par ${r.solvedPar}  (eingetragen: ${r.declaredPar})`);
  process.exit(0);
}

table(reports, [
  { label: 'Level', get: (r) => r.id },
  { label: 'Name', get: (r) => r.name },
  { label: 'Größe', get: (r) => r.size },
  { label: 'Spiegel', get: (r) => r.mirrors, right: true },
  { label: 'dreh', get: (r) => r.rotatable, right: true },
  { label: 'fest', get: (r) => r.locked, right: true },
  { label: 'Block', get: (r) => r.walls, right: true },
  { label: 'Ziele', get: (r) => r.targets, right: true },
  { label: 'Start', get: (r) => r.litAtStart, right: true },
  { label: 'Par', get: (r) => r.solvedPar, right: true },
  { label: 'Lös.', get: (r) => r.solutions, right: true },
  { label: 'opt.', get: (r) => r.optimal, right: true },
  { label: 'Deko', get: (r) => r.idleMirrors, right: true },
  { label: 'Länge', get: (r) => r.beamLength, right: true },
  { label: 'OK', get: (r) => (r.ok ? '✓' : '✗') },
]);

const taps = Number(flag('fuzz', 0));
if (taps > 0) {
  console.log();
  for (const level of levels) {
    const f = fuzzLevel(level, { taps, seed: 1234 });
    console.log(`${level.id}  ${f.taps} Tipps  ·  gelöst in ${f.solvedSeen} Zuständen  ·  längster Faden ${f.maxLength}`);
  }
}
