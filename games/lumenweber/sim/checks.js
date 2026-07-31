// Prüfungen der DOM-freien Spiellogik.
//
//   npm run check:lumen
//
// Zwei Teile: exakte Einzeltests der Strahlphysik und der Sitzungslogik – und
// eine Abnahme jedes Levels über den vollständigen Solver. Ein Level, das
// unlösbar ist, beim Start schon leuchtet oder dessen `par` nicht stimmt,
// fällt hier durch und kann gar nicht erst im Spiel landen.

import { DIRS, REFLECT, parseLevel, cellAt, startOrientations } from '../level.js';
import { traceBeam } from '../beam.js';
import { createSession, toggleAt, toggleMirror, undo, resetSession, rating } from '../game.js';
import { levels } from '../levels.js';
import { solveLevel, irrelevantMirrors } from './solver.js';
import { fuzzLevel } from './headless.js';
import { isUnlocked, nextOpenIndex, totalStars } from '../progress.js';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const eq = (name, actual, expected) =>
  check(name, actual === expected, `erwartet ${expected}, war ${actual}`);
const throws = (name, fn) => {
  try { fn(); check(name, false, 'keine Ausnahme'); }
  catch { check(name, true); }
};

/* ---------- Spiegelphysik ---------- */

{
  // Beide Spiegel müssen jede Richtung um genau 90° drehen und in sich
  // umkehrbar sein: Wer rückwärts einfällt, kommt rückwärts wieder heraus.
  for (const orient of ['/', '\\']) {
    for (const dir of ['R', 'L', 'U', 'D']) {
      const out = REFLECT[orient][dir];
      const a = DIRS[dir];
      const b = DIRS[out];
      eq(`${orient} ${dir}: 90°-Umlenkung`, a.dx * b.dx + a.dy * b.dy, 0);
      const back = { R: 'L', L: 'R', U: 'D', D: 'U' };
      eq(`${orient} ${dir}: umkehrbar`, REFLECT[orient][back[out]], back[dir]);
    }
  }
  // Physikalische Ausrichtung: „/“ wirft nach rechts laufendes Licht nach oben.
  eq('/ lenkt nach oben', REFLECT['/'].R, 'U');
  eq('\\ lenkt nach unten', REFLECT['\\'].R, 'D');
}

/* ---------- Strahlverfolgung ---------- */

/** Testraster – ohne Spielbarkeitsprüfung, damit auch Teilaufbauten gehen. */
const mini = (rows) => parseLevel({ id: 'test', name: 'test', rows, par: 0 }, { validate: false });
/** Testraster mit voller Prüfung – für die Abnahme des Formats selbst. */
const strict = (rows) => parseLevel({ id: 'test', name: 'test', rows, par: 0 });

{
  // Gerader Strahl bis zum Feldrand.
  const level = mini(['...', '>.o', '...']);
  const t = traceBeam(level, []);
  check('gerader Strahl trifft das Ziel', t.solved);
  eq('Strahl endet am Feldrand', t.endings[0], 'outside');
  eq('Endpunkt liegt auf der Kante', t.paths[0].at(-1).x, 3);
}

{
  // Blocker verschluckt das Licht vor dem Ziel.
  const level = mini(['...', '>#o', '...']);
  const t = traceBeam(level, []);
  check('Blocker verhindert den Treffer', !t.solved);
  eq('Strahl endet am Blocker', t.endings[0], 'wall');
  eq('Strahl hält an der Blockerkante', t.paths[0].at(-1).x, 1);
}

{
  // Das Licht läuft hinter einem getroffenen Ziel weiter.
  const level = mini(['....', '>oo.', '....']);
  const t = traceBeam(level, []);
  check('zwei Ziele auf einer Geraden', t.solved);
  eq('Strahl läuft bis zum Rand weiter', t.paths[0].at(-1).x, 4);
}

{
  // Umlenkung an einem drehbaren Spiegel, beide Zustände.
  const level = mini(['..o', '>./', '..o']);
  const up = traceBeam(level, ['/']);
  const down = traceBeam(level, ['\\']);
  eq('/ erhellt das obere Ziel', up.litTargets.has('2,0'), true);
  eq('/ lässt das untere dunkel', up.litTargets.has('2,2'), false);
  eq('\\ erhellt das untere Ziel', down.litTargets.has('2,2'), true);
}

{
  // Der Strahl darf dieselbe Zelle zweimal durchlaufen – einmal waagerecht,
  // einmal senkrecht. Eine Kreuzung ist keine Schleife.
  const level = mini([
    './.\\.',
    '.....',
    '>../.',
    '.....',
    '.o...',
  ]);
  const t = traceBeam(level, ['/', '\\', '/']);
  check('Kreuzung erreicht das Ziel', t.solved);
  eq('gekreuzte Zelle wird zweimal durchlaufen', t.visits.get('1,2'), 2);
  eq('Kreuzung gilt nicht als Schleife', t.endings[0], 'outside');
}

{
  // Ein Spiegel ist eine umkehrbare Abbildung von (Zelle, Richtung) auf sich
  // selbst, und die Quelle verschluckt einfallendes Licht. Damit *kann* der
  // Strahl gar nicht in einen Kreis geraten – die Schleifenerkennung in
  // `traceBeam` ist reine Absicherung. Genau das wird hier nachgewiesen:
  // ein dicht mit Spiegeln gefülltes Feld, tausend Zufallsstellungen, nie
  // eine Schleife und immer eine endliche Länge.
  const rows = ['>' + '/'.repeat(6)];
  for (let y = 1; y < 7; y += 1) rows.push('/'.repeat(6) + (y === 3 ? 'o' : '/'));
  const level = mini(rows);
  let loops = 0;
  let worst = 0;
  let seed = 12345;
  for (let run = 0; run < 1000; run += 1) {
    const orientations = level.mirrors.map(() => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed & 1 ? '/' : '\\';
    });
    const t = traceBeam(level, orientations);
    if (t.endings.includes('loop')) loops += 1;
    if (!Number.isFinite(t.length)) worst = Infinity;
    worst = Math.max(worst, t.length);
  }
  eq('dichtes Spiegelfeld erzeugt nie eine Schleife', loops, 0);
  check('Strahllänge bleibt endlich', Number.isFinite(worst) && worst > 0, `${worst}`);
}

/* ---------- Levelformat ---------- */

throws('unbekanntes Zeichen wird abgelehnt', () => mini(['...', '>?o', '...']));
throws('ungleiche Zeilenlängen werden abgelehnt', () => mini(['...', '>.o.', '...']));
throws('Level ohne Ziel wird abgelehnt', () => strict(['...', '>./', '...']));
throws('Level ohne drehbaren Spiegel wird abgelehnt', () => strict(['...', '>.o', '...']));
throws('Quelle, die sofort hinausstrahlt, wird abgelehnt', () => strict(['..o', '../', '<..']));

{
  const level = mini(['..o', '>./', '...']);
  eq('cellAt außerhalb liefert null', cellAt(level, -1, 0), null);
  eq('Spiegel bekommt einen Index', cellAt(level, 2, 1).index, 0);
  eq('Startausrichtung stimmt', startOrientations(level)[0], '/');
}

/* ---------- Sitzungslogik ---------- */

{
  const level = mini(['..o', '>.\\', '...']);
  const s = createSession(level);
  eq('Startzustand ungelöst', s.solved, false);
  eq('Tippen daneben zählt nicht', toggleAt(s, 0, 0), false);
  eq('Züge bleiben bei 0', s.moves, 0);
  eq('Tippen auf den Spiegel wirkt', toggleAt(s, 2, 1), true);
  eq('gelöst nach einem Zug', s.solved, true);
  eq('ein Zug gezählt', s.moves, 1);

  undo(s);
  eq('Zurück nimmt die Drehung zurück', s.solved, false);
  eq('Zurück kostet einen Zug', s.moves, 2);

  resetSession(s);
  eq('Reset stellt den Start wieder her', s.moves, 0);
  eq('Reset ist ungelöst', s.solved, false);
  eq('Reset leert die Historie', s.history.length, 0);
}

{
  // Feste Spiegel dürfen sich unter keinen Umständen drehen lassen.
  const level = mini(['..o', '>.1', '..o']);
  const s = createSession(level);
  const fixedIndex = cellAt(level, 2, 1).index;
  eq('fester Spiegel ignoriert Tippen', toggleAt(s, 2, 1), false);
  eq('fester Spiegel ignoriert auch den Index', toggleMirror(s, fixedIndex), false);
}

{
  const level = { par: 4 };
  eq('Par erreicht = 3 Sterne', rating(level, 4), 3);
  eq('leicht über Par = 2 Sterne', rating(level, 6), 2);
  eq('deutlich über Par = 1 Stern', rating(level, 12), 1);
}

/* ---------- Abnahme aller Level ---------- */

let prevPar = 0;
for (const level of levels) {
  const solution = solveLevel(level);
  const start = createSession(level);

  check(`${level.id} ist lösbar`, solution.solvable, 'kein Weg erhellt alle Ziele');
  check(`${level.id} ist nicht schon gelöst`, !solution.solvedAtStart);
  eq(`${level.id}: eingetragenes Par stimmt`, level.par, solution.par);
  check(`${level.id} startet unvollständig`, start.lit < level.targets.length,
    `${start.lit}/${level.targets.length} leuchten sofort`);

  // Deko-Spiegel sind erlaubt, aber die Mehrheit muss etwas bewirken – sonst
  // ist das Level kleiner, als es aussieht.
  const idle = irrelevantMirrors(level);
  check(`${level.id}: höchstens die Hälfte der Spiegel ist Deko`,
    idle.length * 2 <= level.rotatable.length,
    `${idle.length} von ${level.rotatable.length} wirkungslos`);

  // Die optimale Lösung muss auch wirklich durchspielbar sein.
  const s = createSession(level);
  for (const index of solution.moves) toggleMirror(s, index);
  check(`${level.id}: Lösungszüge führen zum Ziel`, s.solved);
  eq(`${level.id}: Lösung braucht genau Par Züge`, s.moves, solution.par);

  // Zufälliges Herumtippen darf nichts zerlegen.
  fuzzLevel(level, { taps: 300, seed: 7 });
  check(`${level.id}: 300 Zufallstipps ohne Fehler`, true);

  check(`${level.id}: Par steigt nicht sprunghaft`, solution.par <= prevPar + 3,
    `von ${prevPar} auf ${solution.par}`);
  prevPar = Math.max(prevPar, solution.par);

  check(`${level.id} hat einen Hinweistext`, Boolean(level.hint) || Number(level.id.slice(1)) > 6);
}

check('Level-IDs sind eindeutig', new Set(levels.map((l) => l.id)).size === levels.length);
check('mindestens fünf Level vorhanden', levels.length >= 5, `${levels.length}`);

/* ---------- Kampagne am Stück ---------- */

{
  // Ein kompletter Durchlauf: jedes Level optimal lösen, Fortschritt fortschreiben
  // und dabei prüfen, dass die Freischaltung immer genau ein Level weiterrückt.
  const progress = {};
  let stars = 0;
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    check(`${level.id} ist zum Spielzeitpunkt freigeschaltet`, isUnlocked(levels, i, progress));
    eq(`${level.id} ist das nächste offene Level`, nextOpenIndex(levels, progress), i);

    const s = createSession(level);
    for (const index of solveLevel(level).moves) toggleMirror(s, index);
    const got = rating(level, s.moves);
    eq(`${level.id}: optimal gespielt gibt 3 Sterne`, got, 3);
    progress[level.id] = { stars: got, moves: s.moves };
    stars += got;
  }
  eq('Kampagne komplett gelöst', totalStars(levels, progress), stars);
  eq('alle Sterne erreichbar', stars, levels.length * 3);
  check('vor dem ersten Sieg ist nur Level 1 offen',
    !isUnlocked(levels, 1, {}) || levels.length === 1);
}

/* ---------- Ausgabe ---------- */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? ` – ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden`);
if (failed.length) process.exit(1);
