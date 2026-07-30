# ✦ Lumenweber

Ein Lichträtsel. Auf einem dunklen Raster steht eine Quelle und strahlt in eine
feste Richtung. Der Spieler tippt Spiegel an – sie kippen zwischen `/` und `\`
und lenken den Strahl um 90° um. Gelöst ist ein Level, wenn der Faden aus Licht
alle Knoten gleichzeitig durchläuft.

Mehr kann der Spieler nicht tun. Nichts wird gesetzt, nichts verschoben, nichts
gelöscht: **nur drehen.** Die ganze Schwierigkeit steckt in der Anordnung.

## Spielen

`games/lumenweber/index.html` – oder über die Übersicht.

| | |
| --- | --- |
| Spiegel drehen | antippen / anklicken |
| Zug zurück | `↩ Zurück` oder <kbd>U</kbd> |
| Level neu | `⟳ Neu` oder <kbd>R</kbd> |
| Tipp | `💡 Tipp` oder <kbd>H</kbd> |
| Levelauswahl | `☰` oder <kbd>Esc</kbd> |
| Ohne Maus | Pfeiltasten bewegen den Fokus, <kbd>Enter</kbd> dreht |

Der Tipp ist kein vorgeschriebener Text, sondern gerechnet: Der Solver schaut
sich die **aktuelle** Spiegelstellung an und nennt einen Spiegel, der von hier
aus noch gedreht gehört, samt Zahl der verbleibenden Züge.

### Auf dem Handy und Tablet

Das Brett skaliert auf die verfügbare Fläche, die Trefferfläche einer Zelle ist
großzügiger als ihr sichtbarer Rand, und Scrollen, Zoomen und Doppeltipp-Zoom
sind auf dem Spielfeld abgeschaltet – sonst rutscht bei jedem zweiten Zug die
Seite weg. `env(safe-area-inset-*)` hält HUD und Bedienleiste aus der Notch und
der Home-Leiste heraus.

## Regeln im Detail

Der Strahl läuft Zelle für Zelle geradeaus, bis eines davon eintritt:

| trifft auf | passiert |
| --- | --- |
| Spiegel | 90°-Umlenkung, weiter |
| Zielknoten | Knoten leuchtet, Strahl **läuft weiter** |
| Blocker | Ende |
| Quelle | Ende |
| Feldrand | Ende |

Fest sind: Position und Richtung der Quelle, Position der Knoten, Blocker,
Position aller Spiegel. Veränderbar ist ausschließlich die Ausrichtung der
drehbaren Spiegel. Verschraubte Spiegel (dunkle Trägerplatte mit vier
Schraubenköpfen) lenken mit, lassen sich aber nicht drehen.

Der **Par-Wert** ist die vom Solver bestimmte Mindestzahl an Drehungen. Wer ihn
trifft, bekommt drei Sterne. Es gibt keine Zugbegrenzung – niemand wird aus
einem Level geworfen, weil er zu viel probiert hat.

### Eine Abweichung vom Entwurf

Der Spielentwurf beschreibt `/` als Spiegel, der nach rechts laufendes Licht
**nach unten** wirft. Das ist die Tabelle für `\`. Hier gilt die physikalische
Zuordnung: `/` wirft nach oben, `\` nach unten. Das Verhalten ist dasselbe, nur
die Beschriftung der Glyphe wäre sonst verdreht – und ein sichtbarer
`/`-Spiegel, der nach unten ablenkt, sieht auf dem Schirm schlicht falsch aus.

## Die Level

20 Level, von 5×5 mit einem einzigen Spiegel bis 9×9 mit dreizehn drehbaren
Spiegeln und fünf Knoten. Der Par-Wert steigt von 1 auf 8, nie um mehr als
einen Zug pro Level.

Jedes Level hat **genau eine** kürzeste Lösung – es gibt keine zwei
gleichwertigen Wege, und damit auch keinen Zufallstreffer. In jedem Level gibt
es außerdem mindestens zwei drehbare Spiegel mehr, als Züge nötig sind:
„einfach alles umlegen" funktioniert nirgends.

Drei der späten Level (`l13`, `l17`, `l19`) enthalten je einen **Ablenkspiegel**
– einen drehbaren Spiegel, den das Licht in keiner Stellung berührt. Ohne ihn
wüsste ein aufmerksamer Spieler, dass jeder sichtbare Spiegel gebraucht wird,
und könnte allein daraus auf die Lösung schließen. Die Spalte `Deko` in
`npm run sim:lumen` weist sie aus; `check:lumen` sorgt dafür, dass es bei
Ablenkung bleibt und nicht die halbe Fläche Attrappe wird.

Neue Mechaniken kommen einzeln und mit einem Satz Erklärung: Spiegel drehen
(l01), der Faden läuft hinter einem Knoten weiter (l02), Blocker (l03), feste
Spiegel (l04), Kreuzungen (l06), vier Knoten auf einem Faden (l11), das große
Feld (l16).

## Aufbau

```
level.js      Datenmodell, Spiegelphysik, Textformat der Level
beam.js       Strahlverfolgung – rein aus Level + Spiegelstellungen
game.js       Sitzung: drehen, zurück, neu, Sternbewertung
levels.js     Levelsammlung im Textformat
layout.js     Geometrie – geteilt von Renderer und Eingabe
render.js     Wahl der Darstellung: WebGL2, sonst 2D-Canvas
gfx/          WebGL2-Renderer (Shader, Bloom) und der 2D-Rückfall
input.js      Finger, Maus, Tastatur
progress.js   Fortschritt im localStorage
audio.js      synthetischer Klang über die Web Audio API
main.js       Verdrahtung, Bildschirme
sim/          Simulation & Solver ohne Browser (eigene README)
```

`level.js`, `beam.js`, `game.js` und `levels.js` sind vollständig DOM-frei.
Genau deshalb lässt sich das Spiel ohne Browser durchspielen und prüfen.

## Ohne Browser testen

```bash
npm run check:lumen                # Physik, Sitzungslogik, Abnahme aller Level
npm run sim:lumen                  # Kennzahlentabelle
npm run sim:lumen -- --show=l05    # Start- und Lösungsbild als ASCII
```

```
── Lösung ────────────────────────────
l05 · Serpentine  (7×7)
· · · · · · ·
· / ─ ◉ ─ \ ·
· │ · · · │ ·
▶ ┼ ─ ─ ─ / ·
· ◉ · · · · ·
· \ ─ ◉ ─ ─ ─
· · · · · · ·
Züge 3 / Par 3  ·  Ziele 3/3  ·  GELÖST  ·  3★
```

Details in [`sim/README.md`](sim/README.md): warum der Solver erschöpfend suchen
darf, was `check:lumen` alles abnimmt und wie man ein neues Level einbaut.

## Levelformat

Ein Level ist ein Array aus gleich langen Zeilen:

```js
{
  id: 'l03',
  name: 'Schattenwurf',
  hint: 'Blocker verschlucken den Faden. Führe ihn außen herum.',
  par: 2,
  rows: [
    '..#...',
    '......',
    '>./...',
    '......',
    '../..o',
    '......',
  ],
}
```

| Zeichen | Bedeutung |
| --- | --- |
| `.` | leer |
| `#` | Blocker |
| `o` | Zielknoten |
| `>` `<` `^` `v` | Lichtquelle mit Strahlrichtung |
| `/` `\` | drehbarer Spiegel in dieser Ausrichtung |
| `1` `2` | fester Spiegel (`/` bzw. `\`) |

In JS-Strings muss `\` als `\\` geschrieben werden. `par` wird von
`check:lumen` gegen den Solver geprüft – ein falscher Wert ist ein Testfehler,
kein Schönheitsfehler.
