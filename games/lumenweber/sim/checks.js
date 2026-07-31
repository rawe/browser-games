// Prüfungen der DOM-freien Spiellogik.
//
//   npm run check:lumen
//
// Drei Teile: exakte Einzeltests der Optik und der Sitzungslogik, ein Nachweis,
// dass die Strahlverfolgung auch mit Prismen immer terminiert – und eine
// Abnahme jedes Levels über den vollständigen Solver. Ein Level, das unlösbar
// ist, beim Start schon leuchtet, dessen `par` nicht stimmt oder das mehr als
// eine kürzeste Lösung hat, fällt hier durch und kann gar nicht erst im Spiel
// landen.

import {
  DIRS, OPPOSITE, REFLECT, AMBER, CYAN, WHITE, interact, accepts,
} from '../optics.js';
import {
  parseLevel, cellAt, startConfig, configCost, placedPrisms, prismsLeft,
} from '../level.js';
import { traceBeam } from '../beam.js';
import { createSession, cycleAt, cycleControl, undo, resetSession, rating, stateAt } from '../game.js';
import { levels } from '../levels.js';
import { solveLevel, irrelevantControls, searchSpace, movesBetween, MAX_IDLE_STATES } from './solver.js';
import { fuzzLevel, rng } from './headless.js';
import { isUnlocked, nextOpenIndex, totalStars } from '../progress.js';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const eq = (name, actual, expected) =>
  check(name, actual === expected, `erwartet ${expected}, war ${actual}`);
const throws = (name, fn) => {
  try { fn(); check(name, false, 'keine Ausnahme'); }
  catch { check(name, true); }
};

/* ---------- Optik: Spiegel ---------- */

{
  // Beide Spiegel müssen jede Richtung um genau 90° drehen und in sich
  // umkehrbar sein: Wer rückwärts einfällt, kommt rückwärts wieder heraus.
  for (const orient of ['/', '\\']) {
    for (const dir of ['R', 'L', 'U', 'D']) {
      const out = REFLECT[orient][dir];
      const a = DIRS[dir];
      const b = DIRS[out];
      eq(`${orient} ${dir}: 90°-Umlenkung`, a.dx * b.dx + a.dy * b.dy, 0);
      eq(`${orient} ${dir}: umkehrbar`, REFLECT[orient][OPPOSITE[out]], OPPOSITE[dir]);
      // Ein Spiegel färbt nicht: Was hineinläuft, läuft heraus.
      const outs = interact('mirror', orient, dir, AMBER);
      eq(`${orient} ${dir}: Spiegel lässt die Farbe unberührt`, outs[0].colors, AMBER);
    }
  }
  // Physikalische Ausrichtung: „/“ wirft nach rechts laufendes Licht nach oben.
  eq('/ lenkt nach oben', REFLECT['/'].R, 'U');
  eq('\\ lenkt nach unten', REFLECT['\\'].R, 'D');
}

/* ---------- Optik: Farbe ---------- */

{
  eq('Weiß ist die Vereinigung beider Grundfarben', AMBER | CYAN, WHITE);
  check('Weiß erhellt einen beliebigen Knoten', accepts('any', WHITE));
  check('Bernstein erhellt einen Bernsteinknoten', accepts('amber', AMBER));
  check('Weiß erhellt einen Bernsteinknoten NICHT', !accepts('amber', WHITE));
  check('Cyan erhellt einen Bernsteinknoten NICHT', !accepts('amber', CYAN));
  check('nur weißes Licht erhellt einen Weißknoten', accepts('white', WHITE) && !accepts('white', CYAN));
  check('Dunkelheit erhellt gar nichts', !accepts('any', 0));
}

/* ---------- Optik: Prisma ---------- */

{
  for (const orient of ['/', '\\']) {
    for (const dir of ['R', 'L', 'U', 'D']) {
      // Weiß spaltet sich in genau zwei Äste: Bernstein geradeaus, Cyan um die Ecke.
      const split = interact('prism', orient, dir, WHITE);
      eq(`${orient} ${dir}: Weiß spaltet sich in zwei Äste`, split.length, 2);
      const amber = split.find((o) => o.colors === AMBER);
      const cyan = split.find((o) => o.colors === CYAN);
      eq(`${orient} ${dir}: Bernstein läuft geradeaus`, amber.dir, dir);
      eq(`${orient} ${dir}: Cyan wird umgelenkt`, cyan.dir, REFLECT[orient][dir]);

      // Und rückwärts: Beide Farben, gegen ihre Ausgangsrichtung eingespeist,
      // verlassen das Prisma in derselben Richtung – dort vereinigen sie sich.
      const backAmber = interact('prism', orient, OPPOSITE[amber.dir], AMBER)[0].dir;
      const backCyan = interact('prism', orient, OPPOSITE[cyan.dir], CYAN)[0].dir;
      eq(`${orient} ${dir}: Spalten ist umkehrbar`, backAmber, OPPOSITE[dir]);
      eq(`${orient} ${dir}: beide Farben treten gemeinsam aus`, backCyan, backAmber);

      // Einzelne Farben werden nicht weiter zerlegt.
      eq(`${orient} ${dir}: Bernstein bleibt ein Ast`, interact('prism', orient, dir, AMBER).length, 1);
      eq(`${orient} ${dir}: Cyan bleibt ein Ast`, interact('prism', orient, dir, CYAN).length, 1);
    }
  }
}

/* ---------- Optik: Fassung ---------- */

{
  const empty = interact('socket', null, 'R', WHITE);
  eq('leere Fassung lässt Licht durch', empty.length, 1);
  eq('leere Fassung lenkt nicht ab', empty[0].dir, 'R');
  eq('leere Fassung färbt nicht', empty[0].colors, WHITE);
  const filled = interact('socket', '/', 'R', WHITE);
  eq('besetzte Fassung wirkt wie ein Prisma', filled.length, 2);
  eq('Blocker verschluckt alles', interact('wall', null, 'R', WHITE).length, 0);
  eq('die Quelle verschluckt einfallendes Licht', interact('source', null, 'R', WHITE).length, 0);
}

/* ---------- Strahlverfolgung ---------- */

/** Testraster – ohne Spielbarkeitsprüfung, damit auch Teilaufbauten gehen. */
const mini = (rows, extra = {}) =>
  parseLevel({ id: 'test', name: 'test', rows, par: 0, ...extra }, { validate: false });
/** Testraster mit voller Prüfung – für die Abnahme des Formats selbst. */
const strict = (rows, extra = {}) => parseLevel({ id: 'test', name: 'test', rows, par: 0, ...extra });
/** Kurzform: Level mit seiner Startstellung verfolgen. */
const trace = (level, config) => traceBeam(level, config ?? startConfig(level));

{
  // Gerader Strahl bis zum Feldrand.
  const level = mini(['...', '>.o', '...']);
  const t = trace(level);
  check('gerader Strahl trifft das Ziel', t.solved);
  eq('Strahl endet am Feldrand', t.endings[0], 'outside');
  eq('Endpunkt liegt auf der Kante', t.paths[0].points.at(-1).x, 3);
  eq('weißes Licht bleibt weiß', t.paths[0].colors, WHITE);
}

{
  // Blocker verschluckt das Licht vor dem Ziel.
  const level = mini(['...', '>#o', '...']);
  const t = trace(level);
  check('Blocker verhindert den Treffer', !t.solved);
  eq('Strahl endet am Blocker', t.endings[0], 'wall');
  eq('Strahl hält an der Blockerkante', t.paths[0].points.at(-1).x, 1);
}

{
  // Das Licht läuft hinter einem getroffenen Ziel weiter.
  const level = mini(['....', '>oo.', '....']);
  const t = trace(level);
  check('zwei Ziele auf einer Geraden', t.solved);
  eq('Strahl läuft bis zum Rand weiter', t.paths[0].points.at(-1).x, 4);
}

{
  // Umlenkung an einem drehbaren Spiegel, beide Zustände.
  const level = mini(['..o', '>./', '..o']);
  const up = trace(level, [0]);
  const down = trace(level, [1]);
  check('/ erhellt das obere Ziel', up.litTargets.has('2,0'));
  check('/ lässt das untere dunkel', !up.litTargets.has('2,2'));
  check('\\ erhellt das untere Ziel', down.litTargets.has('2,2'));
}

{
  // Der Strahl darf dieselbe Zelle zweimal durchlaufen – einmal waagerecht,
  // einmal senkrecht. Eine Kreuzung ist keine Teilung.
  const level = mini([
    './.\\.',
    '.....',
    '>../.',
    '.....',
    '.o...',
  ]);
  const t = trace(level, [0, 1, 0]);
  check('Kreuzung erreicht das Ziel', t.solved);
  eq('genau eine Kreuzung erkannt', t.crossings.length, 1);
  eq('die Kreuzung liegt an der erwarteten Stelle', `${t.crossings[0].x},${t.crossings[0].y}`, '1,2');
  eq('eine Kreuzung teilt den Faden nicht', t.splits.length, 0);
}

{
  // Aufspalten: Bernstein läuft geradeaus weiter, Cyan biegt ab.
  const level = mini(['.....', '..C..', '>.p.A', '.....']);
  const t = trace(level);
  check('das Prisma erhellt beide Farbknoten', t.solved);
  eq('genau eine Teilung', t.splits.length, 1);
  eq('der Bernsteinknoten leuchtet bernsteinfarben', t.litTargets.get('4,2'), AMBER);
  eq('der Cyanknoten leuchtet cyan', t.litTargets.get('2,1'), CYAN);
}

{
  // Weißes Licht ist einem Farbknoten zu grell – erst das Prisma trennt sauber.
  const level = mini(['.....', '.....', '>..A.', '.....']);
  check('weißes Licht erhellt keinen Bernsteinknoten', !trace(level).solved);
}

{
  // Wiedervereinigung: Cyan läuft außen herum und trifft den Bernsteinstrahl
  // im zweiten Prisma so, dass beide es in derselben Richtung verlassen.
  const level = mini([
    '../..\\..',
    '........',
    '>.p..q.W',
    '........',
  ]);
  const t = trace(level);
  check('vereinigtes Licht erhellt den Weißknoten', t.solved);
  eq('der Weißknoten leuchtet in vollem Licht', t.litTargets.get('7,2'), WHITE);
  check('eine Linie endet als Wiedervereinigung', t.endings.includes('merge'));
}

{
  // Fassungen: leer unsichtbar, besetzt ein Prisma.
  const level = mini(['.....', '..C..', '>._.A', '.....'], { prisms: 1 });
  check('leere Fassung lässt das Licht durchlaufen', !trace(level, [0]).solved);
  check('Prisma in der Fassung spaltet den Strahl', trace(level, [1]).solved);
}

{
  // Terminierung mit Prismen. Ein Prisma ist keine umkehrbare Abbildung mehr,
  // Ringe im Lichtweg sind also wirklich möglich. Die Rechnung bleibt trotzdem
  // endlich, weil der Zustandsraum (Zelle × Richtung × Farbmaske) endlich ist
  // und Farbmasken nur wachsen. Nachweis: ein dicht mit Prismen und Spiegeln
  // gefülltes Feld, tausend Zufallsstellungen.
  const size = 7;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    let line = '';
    for (let x = 0; x < size; x += 1) line += ((x + y) % 3 === 0 ? 'p' : ((x + y) % 3 === 1 ? '\\' : '/'));
    rows.push(line);
  }
  rows[3] = '>' + rows[3].slice(1);
  rows[size - 1] = rows[size - 1].slice(0, size - 1) + 'o';
  const level = mini(rows);
  const random = rng(12345);
  let worstLength = 0;
  let worstPaths = 0;
  let finite = true;
  for (let run = 0; run < 1000; run += 1) {
    const config = level.controls.map((c) => Math.floor(random() * c.states.length));
    const t = traceBeam(level, config);
    if (!Number.isFinite(t.length)) finite = false;
    worstLength = Math.max(worstLength, t.length);
    worstPaths = Math.max(worstPaths, t.paths.length);
  }
  check('dichtes Prismenfeld: Strahllänge bleibt endlich', finite && worstLength > 0, `${worstLength}`);
  check('dichtes Prismenfeld: Zahl der Linien bleibt beschränkt',
    worstPaths <= size * size * 4, `${worstPaths} Linien`);
}

{
  // Kein Perpetuum mobile: Ein Ring aus Spiegeln, den die Quelle nicht speist,
  // bleibt dunkel. Der Fixpunkt ist die kleinste Lösung, nicht irgendeine.
  const level = mini(['>....', './\\..', '.\\/..', '.....']);
  const t = trace(level);
  eq('ein ungespeister Ring bleibt dunkel', t.litDevices.size, 0);
  eq('nur der Strahl aus der Quelle wird gezeichnet', t.paths.length, 1);
}

/* ---------- Levelformat ---------- */

throws('unbekanntes Zeichen wird abgelehnt', () => mini(['...', '>?o', '...']));
throws('ungleiche Zeilenlängen werden abgelehnt', () => mini(['...', '>.o.', '...']));
throws('Level ohne Ziel wird abgelehnt', () => strict(['...', '>./', '...']));
throws('Level ohne beweglichen Regler wird abgelehnt', () => strict(['...', '>.o', '...']));
throws('Quelle, die sofort hinausstrahlt, wird abgelehnt', () => strict(['..o', '../', '<..']));
throws('Fassung ohne Prisma im Vorrat wird abgelehnt', () => strict(['..o', '>._', '...']));
throws('Prisma im Vorrat ohne Fassung wird abgelehnt',
  () => strict(['..o', '>./', '...'], { prisms: 1 }));
throws('so viele Prismen wie Fassungen wird abgelehnt',
  () => strict(['._o', '>._', '...'], { prisms: 2 }));

{
  const level = mini(['..o', '>./', '...']);
  eq('cellAt außerhalb liefert null', cellAt(level, -1, 0), null);
  eq('Spiegel wird zu einem Bauteil', level.devices.length, 1);
  eq('drehbarer Spiegel wird zu einem Regler', level.controls.length, 1);
  eq('Startstellung stimmt', level.controls[0].states[startConfig(level)[0]], '/');
  const fixed = mini(['..o', '>.1', '...']);
  eq('fester Spiegel ist kein Regler', fixed.controls.length, 0);
  eq('fester Spiegel ist trotzdem ein Bauteil', fixed.devices.length, 1);
}

{
  // Zugkosten: Ein Spiegel kippt hin und her, eine Fassung zykliert im Dreier.
  const level = mini(['._o', '>./', '...'], { prisms: 1 });
  const socket = level.controls.findIndex((c) => c.kind === 'socket');
  const mirror = level.controls.findIndex((c) => c.kind === 'mirror');
  const base = startConfig(level);
  const to = base.slice();
  to[mirror] = 1 - base[mirror];
  eq('Spiegel kippen kostet einen Zug', configCost(level, base, to), 1);
  const back = base.slice();
  back[socket] = 2;              // leer → / → \ sind zwei Tipps
  eq('Fassung auf \\ kostet zwei Züge', configCost(level, base, back), 2);
  eq('von \\ zurück auf leer kostet einen', configCost(level, back, base), 1);
}

/* ---------- Sitzungslogik ---------- */

{
  const level = mini(['..o', '>.\\', '...']);
  const s = createSession(level);
  eq('Startzustand ungelöst', s.solved, false);
  eq('Tippen daneben zählt nicht', cycleAt(s, 0, 0), false);
  eq('Züge bleiben bei 0', s.moves, 0);
  eq('Tippen auf den Spiegel wirkt', cycleAt(s, 2, 1), true);
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
  // Feste Bauteile dürfen sich unter keinen Umständen bewegen lassen.
  const level = mini(['..o', '>.1', '..o']);
  const s = createSession(level);
  eq('fester Spiegel ignoriert Tippen', cycleAt(s, 2, 1), false);
  eq('festes Bauteil hat keinen Regler', level.devices[0].control, -1);
  const prism = mini(['..o', '>.3', '..o']);
  eq('festes Prisma ist auch fest', createSession(prism) && cycleAt(createSession(prism), 2, 1), false);
}

{
  // Der Fassungszyklus und der Prismenvorrat.
  const level = mini(['._o', '>._', '..o'], { prisms: 1 });
  const s = createSession(level);
  const first = level.devices.find((d) => d.kind === 'socket');
  const second = level.devices.filter((d) => d.kind === 'socket')[1];
  eq('Fassungen starten leer', stateAt(s, first), null);
  eq('der ganze Vorrat liegt bereit', s.prismsLeft, 1);

  cycleAt(s, first.x, first.y);
  eq('erster Tipp setzt ein Prisma ein', stateAt(s, first), '/');
  eq('der Vorrat schrumpft', s.prismsLeft, 0);
  eq('zweite Fassung bleibt ohne Vorrat leer', cycleAt(s, second.x, second.y), false);
  eq('ein abgewiesener Tipp zählt keinen Zug', s.moves, 1);

  cycleAt(s, first.x, first.y);
  eq('zweiter Tipp dreht das Prisma', stateAt(s, first), '\\');
  eq('gedreht bleibt gesetzt', s.prismsLeft, 0);

  cycleAt(s, first.x, first.y);
  eq('dritter Tipp nimmt das Prisma wieder auf', stateAt(s, first), null);
  eq('der Vorrat ist wieder voll', s.prismsLeft, 1);

  undo(s);
  eq('Zurück setzt das Prisma wieder ein', stateAt(s, first), '\\');
  eq('und nimmt es aus dem Vorrat', s.prismsLeft, 0);
}

{
  // Die Zugfolge des Solvers darf den Vorrat nie überziehen: erst leeren,
  // dann umsetzen, dann füllen.
  const level = mini(['._o', '>._', '..o'], { prisms: 1 });
  const from = [1, 0];   // erste Fassung besetzt
  const to = [0, 1];     // zweite Fassung besetzt
  const s = createSession(level);
  s.config = from.slice();
  let overdrawn = false;
  for (const control of movesBetween(level, from, to)) {
    if (!cycleControl(s, control)) overdrawn = true;
    if (prismsLeft(level, s.config) < 0) overdrawn = true;
  }
  check('Umsetzen überzieht den Vorrat nie', !overdrawn);
  eq('und landet auf der Zielstellung', placedPrisms(level, s.config), 1);
  eq('die Zielfassung ist besetzt', s.config[1], 1);
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

  // Genau eine kürzeste Lösung – sonst gibt es einen Zufallstreffer.
  eq(`${level.id}: genau eine kürzeste Lösung`, solution.optimal, 1);

  // Der Suchraum muss klein genug für die vollständige Abnahme bleiben.
  check(`${level.id}: Suchraum bleibt im Budget`, searchSpace(level) <= MAX_IDLE_STATES,
    `${searchSpace(level)} Stellungen`);

  // Ablenkung ist erlaubt, aber die Mehrheit der Regler muss etwas bewirken –
  // sonst ist das Level kleiner, als es aussieht.
  const idle = irrelevantControls(level);
  check(`${level.id}: höchstens die Hälfte der Regler ist Ablenkung`,
    idle.length * 2 <= level.controls.length,
    `${idle.length} von ${level.controls.length} wirkungslos`);

  // Die optimale Lösung muss auch wirklich durchspielbar sein.
  const s = createSession(level);
  for (const control of solution.moves) {
    check(`${level.id}: Zug auf Regler ${control} ist erlaubt`, cycleControl(s, control));
  }
  check(`${level.id}: Lösungszüge führen zum Ziel`, s.solved);
  eq(`${level.id}: Lösung braucht genau Par Züge`, s.moves, solution.par);

  if (level.sockets.length > 0) {
    check(`${level.id}: in der Lösung bleibt eine Fassung frei`,
      placedPrisms(level, solution.config) < level.sockets.length,
      `${placedPrisms(level, solution.config)} von ${level.sockets.length} besetzt`);
    check(`${level.id}: die Lösung braucht wirklich ein Prisma`,
      placedPrisms(level, solution.config) > 0);
  }

  // Zufälliges Herumtippen darf nichts zerlegen.
  fuzzLevel(level, { taps: 300, seed: 7 });
  check(`${level.id}: 300 Zufallstipps ohne Fehler`, true);

  check(`${level.id}: Par steigt nicht sprunghaft`, solution.par <= prevPar + 3,
    `von ${prevPar} auf ${solution.par}`);
  prevPar = Math.max(prevPar, solution.par);

  check(`${level.id} hat einen Hinweistext`, Boolean(level.hint) || Number(level.id.slice(1)) > 6);
  if (level.teach) {
    check(`${level.id}: Lehrkarte hat Titel und Text`,
      Boolean(level.teach.title) && Boolean(level.teach.body));
  }
}

check('Level-IDs sind eindeutig', new Set(levels.map((l) => l.id)).size === levels.length);
check('mindestens fünf Level vorhanden', levels.length >= 5, `${levels.length}`);

{
  // Jede neue Mechanik wird genau einmal erklärt, beim ersten Auftreten.
  const firstWith = (predicate) => levels.find(predicate);
  const explained = new Set(levels.filter((l) => l.teach).map((l) => l.teach.id));
  const milestones = [
    ['prisma', (l) => l.devices.some((d) => d.kind === 'prism')],
    ['farbe', (l) => l.targets.some((t) => t.want !== 'any')],
    ['fassung', (l) => l.sockets.length > 0],
  ];
  for (const [id, predicate] of milestones) {
    const level = firstWith(predicate);
    if (!level) continue;
    check(`erste Begegnung mit „${id}“ wird erklärt (${level.id})`,
      level.teach?.id === id, `Lehrkarte war ${level.teach?.id ?? 'keine'}`);
    check(`„${id}“ wird nur einmal erklärt`,
      levels.filter((l) => l.teach?.id === id).length === 1);
    explained.delete(id);
  }
  check('keine Lehrkarte ohne Mechanik', explained.size === 0, [...explained].join(', '));
}

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
    for (const control of solveLevel(level).moves) cycleControl(s, control);
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
