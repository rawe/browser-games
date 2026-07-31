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
  parseLevel, validateLevel, cellAt, startConfig, configCost, placedPrisms, prismsLeft,
  MIN_SIZE, MAX_SIZE,
} from '../level.js';
import { traceBeam, isSolved } from '../beam.js';
import { createSession, cycleAt, cycleControl, undo, resetSession, rating, stateAt } from '../game.js';
import { levels } from '../levels.js';
import { solveLevel, irrelevantControls, searchSpace, movesBetween, MAX_IDLE_STATES } from './solver.js';
import { fuzzLevel, rng } from './headless.js';
import { isUnlocked, nextOpenIndex, totalStars, isStudioId } from '../progress.js';
import {
  TOOLS, createDraft, paint, resizeRows, lostOnResize, searchSpaceOf,
} from '../editor/model.js';
import { inspect } from '../editor/validate.js';
import { encodeLevel, decodeLevel, shareUrl, readShareFragment, SHARE_KEY } from '../editor/share.js';
import { newId } from '../editor/library.js';

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

/* ---------- Editor: Entwurf, Prüfung, Bibliothek ---------- */
//
// Der Editor selbst ist Oberfläche und läuft hier nicht. Seine Logik ist es
// nicht: Entwurfsmodell, Prüfkette und Kodierung sind DOM-frei und werden hier
// genauso abgenommen wie das Spiel.

{
  const draft = createDraft();
  const check0 = inspect(draft);
  check('frischer Entwurf ist spielbar', check0.ok, check0.errors.map((e) => e.text).join(' / '));
  check('frischer Entwurf startet ungelöst',
    !isSolved(check0.level, startConfig(check0.level)));
  eq('frischer Entwurf hat genau einen Regler', check0.level.controls.length, 1);

  // Ein Entwurf ist dasselbe Textformat wie die eingebauten Level – sonst gäbe
  // es zwei Formate, die auseinanderlaufen können.
  eq('Entwurf ist rechteckig', new Set(draft.rows.map((r) => r.length)).size, 1);
}

{
  // Der Pinsel: erstes Zeichen setzen, dann den Zyklus durchlaufen.
  const tool = TOOLS.find((t) => t.id === 'source');
  let rows = ['...', '...', '...'];
  let out = paint(rows, 1, 1, tool);
  eq('erster Strich setzt das erste Zeichen', out.char, '>');
  for (const want of ['v', '<', '^', '>']) {
    out = paint(out.rows, 1, 1, tool);
    eq(`Quelle dreht weiter auf ${want}`, out.char, want);
  }
  const mirror = TOOLS.find((t) => t.id === 'mirror');
  eq('fremdes Zeichen wird ersetzt, nicht zykliert', paint(out.rows, 1, 1, mirror).char, '/');
  const empty = TOOLS.find((t) => t.id === 'empty');
  check('Leer auf leer ändert nichts', !paint(['...'], 1, 0, empty).changed);
  check('Strich außerhalb des Rasters ändert nichts', !paint(['...'], 9, 9, mirror).changed);
}

{
  // Größe ändern: rechts und unten beschneiden, mit leeren Zellen auffüllen.
  const rows = ['>..o', '.\\..', '....', '....'];
  const bigger = resizeRows(rows, 6, 5);
  eq('breiter: Zeilenlänge', bigger[0].length, 6);
  eq('breiter: Zeilenzahl', bigger.length, 5);
  eq('breiter: Inhalt bleibt stehen', bigger[0].slice(0, 4), '>..o');
  eq('schmaler und wieder breiter verliert nur, was außen lag',
    resizeRows(resizeRows(rows, 3, 4), 4, 4)[0], '>...');
  eq('Verlust wird gezählt', lostOnResize(rows, 3, 4), 1);
  eq('kein Verlust beim Vergrößern', lostOnResize(rows, 6, 6), 0);
  eq('Größe wird auf das Erlaubte gestutzt', resizeRows(rows, 99, 99).length, MAX_SIZE);
  eq('Größe wird nach unten gestutzt', resizeRows(rows, 1, 1).length, MIN_SIZE);
}

{
  // Suchraum direkt aus dem Raster – die Zahl, die der Editor anzeigt.
  eq('zwei Spiegel = vier Stellungen', searchSpaceOf(['>/o', './.', '...']).states, 4);
  eq('eine Fassung verdreifacht', searchSpaceOf(['>_o', './.', '...']).states, 6);
  eq('feste Bauteile zählen nicht', searchSpaceOf(['>1o', '.3.', '...']).states, 1);
}

{
  // Die Prüfkette meldet, statt zu werfen – und meldet das Richtige.
  const errs = (rows, extra) => inspect({ name: 'x', rows, prisms: 0, ...extra }).errors.length;
  eq('unbekanntes Zeichen ist ein Fehler', errs(['...', '>?o', '...']), 1);
  eq('krumme Zeilen sind ein Fehler', errs(['...', '>.o.', '...']), 1);
  check('fehlende Quelle wird gemeldet', errs(['...', '../', '..o']) > 0);
  check('fehlender Knoten wird gemeldet', errs(['...', '>./', '...']) > 0);
  check('fehlender Regler wird gemeldet', errs(['...', '>.o', '...']) > 0);
  check('zu großes Raster wird gemeldet',
    errs(Array.from({ length: MAX_SIZE + 1 }, () => '.'.repeat(MAX_SIZE + 1))) > 0);

  // Ein Level, das schon gelöst dasteht, ist kein Level: Der Strahl läuft hier
  // ohne Zutun quer durch den Knoten, der Spiegel oben steht nur herum.
  const solved = inspect({ name: 'x', rows: ['../', '>.o', '...'], prisms: 0 });
  check('bereits gelöster Start wird gemeldet',
    solved.errors.some((e) => e.text.includes('bereits gelöst')));

  // Die Fassungsregel ist für selbstgebaute Level eine Warnung, kein Fehler:
  // Wer jede Fassung besetzen lassen will, darf das – es ist dann eben kein
  // Rätsel mehr. Für die Kampagne bleibt es ein harter Fehler (`validateLevel`).
  const full = inspect({ name: 'x', rows: ['.._', '>_#', '..o'], prisms: 2 });
  eq('Prismen = Fassungen ist im Editor nur eine Warnung', full.errors.length, 0);
  eq('… und wird als Warnung gemeldet', full.warnings.length, 1);
  check('… bleibt für die Kampagne ein Fehler',
    (() => { try { validateLevel(full.level); return false; } catch { return true; } })());

  // Bei genau **einer** Fassung gibt es nichts anzumahnen: Ein Prisma ist dort
  // das Minimum, und die Wahl „leer, / oder \“ bleibt bestehen. Vorher setzte
  // der Editor den Vorrat selbst auf 1 und warnte anschließend darüber – eine
  // Warnung, die sich nicht abstellen ließ.
  const single = inspect({ name: 'x', rows: ['.._', '>.#', '..o'], prisms: 1 });
  eq('eine Fassung mit einem Prisma ist fehlerfrei', single.errors.length, 0);
  eq('… und wird auch nicht angemahnt', single.warnings.length, 0);

  // Einzahl und Mehrzahl in den Meldungen
  const one = inspect({ name: 'x', rows: ['..o', '>._', '...'], prisms: 0 });
  check('Meldung sagt „1 Fassung“, nicht „1 Fassungen“',
    one.errors.some((e) => e.text.startsWith('1 Fassung,')), one.errors.map((e) => e.text).join(' / '));
  const stock = inspect({ name: 'x', rows: ['..o', '>./', '...'], prisms: 1 });
  check('Meldung sagt „1 Prisma“, nicht „1 Prismen“',
    stock.errors.some((e) => e.text.startsWith('1 Prisma ')), stock.errors.map((e) => e.text).join(' / '));
}

{
  // Mehrere Quellen sind erlaubt – der Editor lässt sie zu, also wird das hier
  // abgenommen statt nur gehofft.
  const level = mini(['>..o', '....', '>..o', '..\\.']);
  eq('zwei Quellen werden erkannt', level.sources.length, 2);
  const t = trace(level);
  eq('beide Quellen speisen je einen Faden', t.paths.length, 2);
  check('beide Ziele lassen sich erhellen', t.litTargets.size === 2);
  eq('Prüfkette nimmt zwei Quellen an',
    inspect({ name: 'x', rows: ['>..o', '....', '>./o', '....'], prisms: 0 }).errors.length, 0);
}

/* ---------- Editor: Teilen ---------- */

{
  const draft = { name: 'Übermäßig schöner Name', rows: ['>.o', './.', '...'], prisms: 0, best: 7 };
  const round = decodeLevel(encodeLevel(draft));
  eq('Name übersteht die Kodierung', round.name, draft.name);
  eq('Raster übersteht die Kodierung', round.rows.join('|'), draft.rows.join('|'));
  eq('Bestwert reist mit', round.best, 7);
  eq('ohne Bestwert bleibt null', decodeLevel(encodeLevel({ ...draft, best: null })).best, null);

  // Umlaute überleben nur, wenn wirklich über UTF-8 kodiert wird.
  eq('Umlaute überstehen die Kodierung',
    decodeLevel(encodeLevel({ ...draft, name: 'Grüße, Fässer & Öl' })).name, 'Grüße, Fässer & Öl');

  // Der Code steckt in einer Adresse und muss sich daraus wieder lösen lassen.
  const url = shareUrl(draft, 'https://example.org/spiel/');
  check('Adresse trägt das Level im Fragment', url.includes(`#${SHARE_KEY}=`));
  eq('Fragment lässt sich wieder auslesen',
    decodeLevel(readShareFragment(new URL(url).hash)).name, draft.name);
  check('Adresse bleibt handlich', url.length < 400, `${url.length} Zeichen`);

  // Das größte erlaubte Brett, voll belegt – die obere Schranke der Linklänge.
  const dense = shareUrl({
    name: 'X'.repeat(60),
    rows: Array.from({ length: MAX_SIZE }, () => '\\'.repeat(MAX_SIZE)),
    prisms: 0,
    best: 99,
  }, 'https://example.org/spiel/');
  check('auch das größte Brett bleibt weit unter jeder Grenze',
    dense.length < 800, `${dense.length} Zeichen`);
}

{
  // Fremder Text: Ein Link darf ein kaputtes Level enthalten, aber nichts
  // anrichten. Vor allem darf er keine Größe anfordern, die Speicher frisst –
  // `beam.js` legt Breite · Höhe · 4 Bytes an.
  const bad = (what, text) => throws(`Link abgewiesen: ${what}`, () => decodeLevel(text));
  const enc = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

  bad('leer', '');
  bad('kein base64', '###');
  bad('kein JSON', Buffer.from('kein json', 'utf8').toString('base64url'));
  bad('fremde Fassung', enc({ v: 99, r: ['...'], p: 0 }));
  bad('Raster fehlt', enc({ v: 1, p: 0 }));
  bad('Raster ist kein Array', enc({ v: 1, r: 'xxx', p: 0 }));
  bad('zu wenige Zeilen', enc({ v: 1, r: ['..'], p: 0 }));
  bad('Zeile ist kein Text', enc({ v: 1, r: ['...', 5, '...'], p: 0 }));
  bad('Vorrat ist Unsinn', enc({ v: 1, r: ['...', '...', '...'], p: -3 }));
  bad('Bestwert ist Unsinn', enc({ v: 1, r: ['...', '...', '...'], p: 0, b: 1.5 }));

  // Der wichtigste Fall: ein Raster, das Speicher anfordert.
  bad('riesiges Raster',
    enc({ v: 1, r: Array.from({ length: 5000 }, () => '.'.repeat(5000)), p: 0 }));
  bad('einzelne Riesenzeile',
    enc({ v: 1, r: ['.'.repeat(9000), '...', '...'], p: 0 }));

  // Auch die kodierte Zeichenkette selbst ist gedeckelt, bevor irgendetwas
  // entschlüsselt wird.
  bad('unsinnig lange Zeichenkette', 'A'.repeat(50000));
}

{
  // Ein Mailprogramm bricht lange Links um. Vorher entschied die Zahl der
  // Umbrüche modulo vier darüber, ob der Code noch las – bei 76 Zeichen je
  // Zeile ging es, bei 78 nicht.
  const draft = { name: 'Umbruch', rows: ['>.o', './.', '...'], prisms: 0, best: 3 };
  const code = encodeLevel(draft);
  const chop = (n) => code.replace(new RegExp(`(.{${n}})`, 'g'), '$1\n');
  for (const width of [40, 60, 72, 76, 78, 80]) {
    eq(`umgebrochener Code (alle ${width} Zeichen) wird gelesen`,
      decodeLevel(chop(width)).name, 'Umbruch');
  }
  eq('Code mit Leerzeichen und Rändern wird gelesen',
    decodeLevel(`  ${code.slice(0, 10)} ${code.slice(10)}\n`).name, 'Umbruch');

  // Der erzeugte Link darf keine Abfrage mitschleppen: `?level=3` startet beim
  // Empfänger stumm das eingebaute Level 3, statt das geteilte anzubieten.
  const url = shareUrl(draft, 'https://example.org/spiel/?level=3');
  check('geteilter Link trägt keine Abfrage mehr', !url.includes('level=3'), url);
  check('… und das Level steckt weiterhin im Fragment', url.includes(`#${SHARE_KEY}=`));
}

/* ---------- Editor: Bewertung ohne Par ---------- */

{
  // Ohne Par gibt es keine Sterne. Vorher lieferte `rating` in diesem Fall
  // stillschweigend die volle Punktzahl – bei selbstgebauten Leveln wäre das
  // eine Behauptung über einen kürzesten Weg, den niemand kennt.
  eq('kein Par heißt keine Sterne', rating({ par: null }, 5), null);
  eq('par 0 heißt ebenfalls keine Sterne', rating({ par: 0 }, 5), null);
  eq('mit Par gibt es weiterhin Sterne', rating({ par: 4 }, 4), 3);
}

/* ---------- Editor: getrennte Ablage ---------- */

{
  // Die härteste Zusage des Editors: Selbstgebaute Level können den Fortschritt
  // der Kampagne nicht anfassen. Zwei Schlösser – ein eigener Speicherschlüssel
  // und ein eigener Namensraum für IDs.
  check('Studio-IDs sind als solche erkennbar', isStudioId(newId()));
  check('eingebaute IDs gehören nicht zum Studio', !isStudioId('l07'));
  check('Studio-IDs kollidieren nicht mit eingebauten',
    levels.every((l) => !isStudioId(l.id)));

  const ids = new Set(Array.from({ length: 500 }, () => newId()));
  eq('500 IDs sind 500 verschiedene', ids.size, 500);
}

/* ---------- Ausgabe ---------- */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? ` – ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden`);
if (failed.length) process.exit(1);
