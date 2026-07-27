# Headless-Simulation

Rennen von Turbo Trophy ohne Browser, Canvas oder DOM ausfahren – zum Prüfen
und Kalibrieren der KI. Ein kompletter Durchlauf über alle Strecken und
Schwierigkeitsstufen dauert wenige Sekunden.

```bash
npm run sim:turbo                 # Kennzahlentabelle
npm run sim:turbo -- --check      # Akzeptanzkriterien als PASS/FAIL
npm run sim:turbo -- --seeds=12 --difficulty=schwer --stage=2
```

Daneben gibt es schnelle Zustandsprüfungen der übrigen DOM-freien Logik:

```bash
npm run check:turbo               # z. B. der Dauergas-Schalter aus throttle.js
```

`checks.js` ist bewusst klein gehalten: reine Zustandsmaschinen lassen sich
damit exakt prüfen, ohne ein ganzes Rennen simulieren zu müssen.

## Wie es funktioniert

`headless.js` benutzt dieselben Module wie das Spiel (`race.js`, `ai.js`,
`trackGeometry.js`) und ruft `stepRace` in der Schleife auf, statt sie an
`requestAnimationFrame` zu hängen. Der Spielerwagen wird von einem
*Referenzfahrer* gesteuert: derselbe KI-Code mit einem festen Profil. Sein
Durchschnittsplatz ist damit ein Maßstab dafür, wie stark die Gegner sind.

Jedes Rennen läuft über `createRace(track, career, { seed })` mit einem
deterministischen Zufallsgenerator (`rng.js`) – gleicher Seed, gleicher Lauf.

## Funktionen

- `simulateRace({ stage, difficulty, seed })` – ein Rennen, liefert
  Platzierungen, Tempo, Überholvorgänge, Kolonnen- und Graszeiten,
  Kontakt-Ticks und ein Schlangenlinien-Maß.
- `simulateSeries({ stage, difficulty, seeds })` – Mittelwerte über mehrere Seeds.
- `simulateOvertake({ stage, difficulty, blockers })` – gezieltes Szenario:
  ein bewusst langsames Auto (oder eine Kolonne) vor einem schnelleren Bot.
  Prüft direkt, ob überholt wird und wie lange es dauert.

## Kennzahlen

| Spalte | Bedeutung |
| --- | --- |
| Platz Ref. | Durchschnittsplatz des Referenzfahrers (1 = Sieg) |
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

Für die Streckenelemente aus Issue #26 prüft `--check` zusätzlich, dass
Schanzen tatsächlich befahren werden, Öllachen wirken, Schranken während des
Rennens umschalten, die KI nicht dauernd in geschlossene Sperren fährt und
Fahrzeuge auf getrennten Höhenebenen einander durchdringen, statt zu
kollidieren.

## Parameter-Sweeps

`ai.js` exportiert `TUNING` als einfaches Objekt. Zum Kalibrieren lässt es sich
vor dem Lauf überschreiben:

```js
import { TUNING } from '../ai.js';
import { simulateSeries } from './headless.js';

TUNING.lineGain = 24;
console.log(simulateSeries({ stage: 0, difficulty: 'mittel', seeds: 5 }));
```
