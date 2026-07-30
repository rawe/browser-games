# Headless-Simulation

Rennen von Turbo Trophy ohne Browser, Canvas oder DOM ausfahren – zum Prüfen
und Kalibrieren der KI. Ein kompletter Durchlauf über alle Strecken und
Schwierigkeitsstufen dauert wenige Sekunden.

```bash
npm run sim:turbo                 # Kennzahlentabelle
npm run sim:turbo -- --check      # Akzeptanzkriterien als PASS/FAIL
npm run sim:turbo -- --seeds=12 --difficulty=schwer --stage=2
npm run sim:turbo -- --season=2   # dieselben Strecken in Saison 3
```

`--stage` ist der Index im **Streckenpool** (`tracks.js`), nicht der Lauf einer
Saison: Gemessen wird jede Strecke einzeln, unabhängig davon, in welchem
Kalender sie vorkommt. `--season` legt die Saisonstaffelung darüber – höheres
Grundtempo und mehr Mut in den Kurven bei den Gegnern, dazu der Ausbaustand,
den ein Spieler in dieser Saison plausibel mitbrächte (siehe `seasons.js`).

Daneben gibt es schnelle Zustandsprüfungen der übrigen DOM-freien Logik:

```bash
npm run check:turbo               # Dauergas, Streckengeometrie, Saisonmodell
```

`checks.js` ist bewusst klein gehalten: reine Zustandsmaschinen und Daten
lassen sich damit exakt prüfen, ohne ein ganzes Rennen simulieren zu müssen.
Dort liegen auch die Prüfungen, die eine neu eingetragene Strecke abfangen,
bevor sie im Spiel landet: keine ungebrückte Kreuzung, keine Kurve enger als
der Wendekreis, keine Elemente jenseits des Fahrbahnrands.

## Wie es funktioniert

`headless.js` benutzt dieselben Module wie das Spiel (`race.js`, `ai.js`,
`trackGeometry.js`) und ruft `stepRace` in der Schleife auf, statt sie an
`requestAnimationFrame` zu hängen. Der Spielerwagen wird von einem
*Referenzfahrer* gesteuert: derselbe KI-Code mit einem festen Profil. Sein
Durchschnittsplatz ist damit ein Maßstab dafür, wie stark die Gegner sind.

Jedes Rennen läuft über `createRace(track, career, { seed })` mit einem
deterministischen Zufallsgenerator (`rng.js`) – gleicher Seed, gleicher Lauf.

### Zwei Maßstäbe

Es gibt zwei feste Fahrerprofile, und der Unterschied ist der Grund, warum die
erste Fassung der KI-Stufen an der Realität vorbeigemessen hat:

| `driver` | Profil | wofür |
| --- | --- | --- |
| `reference` | `mittel` | Durchschnittsfahrer – zeigt, ob die Stufen überhaupt auseinanderliegen |
| `ace` | `ACE_PROFILE` | jemand, der das Spiel kann: Dauergas, saubere Linie, keine Fahrfehler, wenig Tempoverlust in Kurven |
| `parked` | – | fährt nicht, steht als Hindernis herum |

Gegen den Durchschnittsfahrer sahen die Stufen sauber gestaffelt aus – ein
guter Spieler hat auf SCHWER trotzdem in der ersten Runde das ganze Feld
kassiert. Seitdem hängen die Balance-Kriterien am `ace`, nicht am
Durchschnitt. `npm run sim:turbo` gibt beide Tabellen aus.

Der `ace` ist bewusst eine *Untergrenze* für einen starken Spieler: Er nutzt
weder Turbo-Timing noch Waffen taktisch. Wenn er ein Viertel der Rennen
gewinnt, gewinnt ein guter Mensch eher mehr.

## Funktionen

- `simulateRace({ stage, difficulty, seed })` – ein Rennen, liefert
  Platzierungen, Tempo, Überholvorgänge, Kolonnen- und Graszeiten,
  Kontakt-Ticks und ein Schlangenlinien-Maß.
- `simulateSeries({ stage, difficulty, seeds })` – Mittelwerte über mehrere Seeds.
- `simulateOvertake({ stage, difficulty, blockers })` – gezieltes Szenario:
  ein bewusst langsames Auto (oder eine Kolonne) vor einem schnelleren Bot.
  Prüft direkt, ob überholt wird und wie lange es dauert.
- `simulateTurboRam({ error })` – Turbo-Sprung auf ein anderes Fahrzeug. Das
  Opfer wird im Moment des Abhebens auf den vorausberechneten Landepunkt
  gesetzt, `error` verschiebt es dagegen. So lässt sich die Wirkung messen,
  obwohl der Fall im Rennen viel zu selten auftritt.
- `simulateHoming({ offset, gap, homing })` – Rakete auf ein seitlich
  versetztes Ziel. Mit `homing: false` als Vergleichswert: eine gerade Rakete
  verfehlt dort, eine zielsuchende trifft.
- `simulateParked({ stage, difficulty, lat })` – ein Fahrzeug wird mitten auf
  der Strecke festgenagelt, die Bots fahren ihre Runden daran vorbei. Gezählt
  wird jede Vorbeifahrt und jede Berührung dabei. Misst nicht, *ob* die Bots
  ausweichen wollen, sondern ob sie es schaffen.

Diese Szenarien entwaffnen alle Fahrzeuge und parken die Unbeteiligten –
gemessen wird nur, was geprüft werden soll.

## Kennzahlen

| Spalte | Bedeutung |
| --- | --- |
| Platz Ref. | Durchschnittsplatz des Durchschnittsfahrers (1 = Sieg) |
| Platz Ass | dasselbe für den starken Fahrer – die zweite Tabelle |
| Ø Tempo | mittlere Geschwindigkeit der Bots |
| Überh. KI | Positionswechsel zwischen Bots je Rennen |
| Kolonne | Zeitanteil, in dem ein Bot länger als 2 s hinter einem langsameren klebt |
| Gras | Zeitanteil neben der Strecke |
| Zickzack | Richtungswechsel der Seitenbewegung pro Sekunde |
| Kontakte | Ticks, in denen sich zwei Bots berühren |
| Sprünge | Anzahl befahrener Sprungschanzen |
| Öl | Auslösungen von Öllachen |
| Schranke | Zustandswechsel / Ticks, in denen eine Sperre jemanden aufhält |
| Brücke s | Zeit, die Fahrzeuge auf der oberen Höhenebene verbringen |
| Zielsuch | Treffer von Zielsuchraketen |
| Turbo | eingesetzte Turboschübe |
| Rammen | Landungen eines Turbo-Sprungs auf einem Gegner |
| Öl abgel. | zur Laufzeit abgelegte Öllachen |

Für die Streckenelemente aus Issue #26 prüft `--check` zusätzlich, dass
Schanzen tatsächlich befahren werden, Öllachen wirken, Schranken während des
Rennens umschalten, die KI nicht dauernd in geschlossene Sperren fährt und
Fahrzeuge auf getrennten Höhenebenen einander durchdringen, statt zu
kollidieren.

## Saisonstaffelung

Mehrere Saisons werfen eine eigene Balance-Frage auf: Der Spieler nimmt seinen
ausgebauten Wagen mit – bleibt es trotzdem ein Rennen? `--check` misst das an
den beiden schwersten Strecken des Pools auf SCHWER über alle Saisons bis über
den Anschlag hinaus:

- **Das Feld wird Saison für Saison schneller** – bis `PEAK_SEASON`, danach
  nicht mehr. Gemessen am mittleren Tempo der Bots, nicht an ihrer
  Höchstgeschwindigkeit: Die erreichen sie auf kurvigen Strecken ohnehin nie.
- **Keine Saison wird zum Selbstläufer** – der starke Fahrer bleibt auch mit
  vollem Ausbau unter 60 % Siegen.
- **Keine spätere Saison ist schwerer als die erste** und am Anschlag ist das
  Podium noch drin – sonst wäre der Endloslauf nur eine Wand.

Der letzte Punkt ist der Grund, warum die Staffelung an `curveBrake` hängt und
nicht nur am Tempo: Mehr Höchstgeschwindigkeit allein macht Gegner, die vor
jeder Kurve vom Gas gehen, nicht schneller.

## Parameter-Sweeps

`ai.js` exportiert `TUNING` als einfaches Objekt. Zum Kalibrieren lässt es sich
vor dem Lauf überschreiben:

```js
import { TUNING } from '../ai.js';
import { simulateSeries } from './headless.js';

TUNING.lineGain = 24;
console.log(simulateSeries({ stage: 0, difficulty: 'mittel', seeds: 5 }));
```
