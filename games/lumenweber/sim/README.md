# Simulation & Solver

Lumenweber lässt sich vollständig ohne Browser spielen, prüfen und lösen. Die
Spiellogik (`level.js`, `beam.js`, `game.js`) kennt weder Canvas noch DOM –
dieselben Module laufen hier unter Node.

```bash
npm run sim:lumen                  # Kennzahlentabelle aller Level
npm run sim:lumen -- --show=l03    # Start- und Lösungsbild als ASCII
npm run sim:lumen -- --show=all
npm run sim:lumen -- --par         # Par-Werte zum Übernehmen in levels.js
npm run sim:lumen -- --fuzz=2000   # Zufalls-Tipps je Level

npm run check:lumen                # Abnahme: Physik, Sitzungslogik, alle Level
```

## Warum das hier steht

Ein Lichträtsel ist ein Suchproblem, kein Reaktionsspiel. Ob ein Level lösbar
ist, wie viele Züge es mindestens braucht und ob es mehr als eine kürzeste
Lösung gibt, ist eine **rechenbare Eigenschaft** – und keine, die man durch
Herumklicken zuverlässig herausfindet. Genau deshalb wird jedes Level hier
abgenommen, bevor es im Spiel landet.

## Das ASCII-Bild

`--show` zeichnet Raster und Lichtweg als Text. Es zeigt exakt das, was der
Spieler später sieht:

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

| Zeichen | Bedeutung |
| --- | --- |
| `▶ ◀ ▲ ▼` | Lichtquelle mit Strahlrichtung |
| `█` | Blocker |
| `○` / `◉` | Zielknoten dunkel / erhellt |
| `/` `\` | drehbarer Spiegel |
| `╱` `╲` | fester Spiegel |
| `─` `│` `┼` | Lichtweg, `┼` = der Faden kreuzt sich selbst |
| `·` | leere Zelle |

## Der Solver

Ein drehbarer Spiegel hat genau zwei Zustände. Bei `n` drehbaren Spiegeln gibt
es also `2^n` Stellungen – für die im Spiel benutzten Größen (n ≤ 16) reicht
schlichtes Durchzählen.

Weil zweimal Drehen denselben Spiegel wieder in die Ausgangslage bringt, ist
die **Reihenfolge der Züge egal**. Der Par-Wert ist damit exakt der kleinste
Hamming-Abstand zwischen Startstellung und irgendeiner Lösungsstellung – nicht
das Ergebnis einer Pfadsuche.

`solveFrom(level, stellung)` rechnet dasselbe von einer beliebigen Stellung
aus. Darauf sitzt die Tipp-Funktion im Spiel: Sie nennt einen Spiegel, der von
*hier* aus noch gedreht gehört, nicht einen vom Levelstart aus.

## Kennzahlen der Tabelle

| Spalte | Bedeutung |
| --- | --- |
| Größe | Raster (Breite × Höhe) |
| Spiegel / dreh / fest | gesamt, davon drehbar, davon verschraubt |
| Block | Zahl der Blocker |
| Ziele | Zahl der Zielknoten |
| Start | wie viele Knoten schon im Startzustand leuchten (soll < Ziele sein) |
| Par | Mindestzahl an Drehungen |
| Lös. | Zahl aller Spiegelstellungen, die das Level lösen |
| opt. | davon die mit genau `Par` Drehungen – `1` heißt: eine eindeutige kürzeste Lösung |
| Deko | drehbare Spiegel, die auf das Ergebnis keinerlei Einfluss haben |
| Länge | Länge des Lichtwegs in Zellen (in der Lösung) |

## Was `check:lumen` prüft

**Physik und Format**

- Beide Spiegel lenken jede Richtung um genau 90° um und sind umkehrbar.
- `/` wirft nach rechts laufendes Licht nach oben, `\` nach unten.
- Der Strahl endet am Feldrand, am Blocker und an der Quelle – jeweils exakt
  auf der Zellkante, damit die Grafik nicht in den Blocker hineinzeichnet.
- Er läuft hinter einem getroffenen Knoten weiter.
- Er darf dieselbe Zelle einmal waagerecht und einmal senkrecht durchlaufen;
  eine Kreuzung ist keine Schleife.
- Ein dicht mit Spiegeln gefülltes Feld erzeugt über 1000 Zufallsstellungen
  **nie** eine Schleife. Das ist kein Zufall: Ein Spiegel ist eine umkehrbare
  Abbildung, und die Quelle verschluckt einfallendes Licht – der Strahl kann
  seinen Startzustand also nie wieder erreichen. Die Schleifenerkennung in
  `beam.js` ist reine Absicherung für spätere Erweiterungen.
- Kaputte Level (unbekannte Zeichen, ungleiche Zeilenlängen, kein Ziel, kein
  drehbarer Spiegel, Quelle strahlt sofort aus dem Feld) werden abgelehnt.

**Sitzungslogik**

- Tippen daneben oder auf einen verschraubten Spiegel zählt keinen Zug.
- Zurück, Neu und die Sternbewertung verhalten sich wie beschrieben.

**Jedes Level**

- ist lösbar und startet **nicht** gelöst,
- hat ein `par`, das dem Solver-Wert entspricht,
- lässt sich mit den Solver-Zügen tatsächlich durchspielen (in genau `par` Zügen),
- besteht zu höchstens der Hälfte aus wirkungslosen Spiegeln,
- übersteht 300 zufällige Tipps ohne Fehler,
- springt im Par nicht um mehr als 3 gegenüber dem bisherigen Höchstwert.

## Neues Level einbauen

1. In `levels.js` eintragen, `par` erst einmal weglassen oder raten.
2. `npm run sim:lumen -- --par` – der Solver nennt den richtigen Wert.
3. `npm run sim:lumen -- --show=lXX` – Start- und Lösungsbild ansehen.
   Läuft der Faden im Startzustand sichtbar irgendwohin? Kreuzt er sich?
   Sieht die Lösung nach einem Aha-Moment aus?
4. `npm run check:lumen` muss grün sein.
