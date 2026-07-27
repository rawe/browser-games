// Headless-Prüfungen der DOM-freien Spiellogik.
//
//   npm run check:turbo
//
// Ergänzt die Renn-Simulation (`sim/run.js`), die das Fahrverhalten über ganze
// Rennen misst. Hier stehen kleine, exakte Zustandsprüfungen – schnell genug,
// um sie bei jeder Änderung laufen zu lassen.

import { createThrottle, TAP_MS } from '../throttle.js';

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

/* ---------- Ausgabe ---------- */

console.log('Prüfungen');
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? `\nAlle ${checks.length} Prüfungen bestanden.` : `\n${failed} Prüfung(en) fehlgeschlagen.`);
process.exitCode = failed === 0 ? 0 : 1;
