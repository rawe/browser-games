# Simulation & Solver

Lumenweber lässt sich vollständig ohne Browser spielen, prüfen und lösen. Die
Spiellogik (`optics.js`, `level.js`, `beam.js`, `game.js`) kennt weder Canvas
noch DOM – dieselben Module laufen hier unter Node.

```bash
npm run sim:lumen                  # Kennzahlentabelle aller Level
npm run sim:lumen -- --show=l03    # Start- und Lösungsbild als ASCII
npm run sim:lumen -- --show=all
npm run sim:lumen -- --par         # Par-Werte zum Übernehmen in levels.js
npm run sim:lumen -- --fuzz=2000   # Zufalls-Tipps je Level

npm run check:lumen                # Abnahme: Optik, Sitzungslogik, alle Level
```

## Warum das hier steht

Ein Lichträtsel ist ein Suchproblem, kein Reaktionsspiel. Ob ein Level lösbar
ist, wie viele Züge es mindestens braucht und ob es mehr als eine kürzeste
Lösung gibt, ist eine **rechenbare Eigenschaft** – und keine, die man durch
Herumklicken zuverlässig herausfindet. Genau deshalb wird jedes Level hier
abgenommen, bevor es im Spiel landet.

## Das ASCII-Bild

`--show` zeichnet Raster und Lichtweg als Text. Es zeigt exakt das, was der
Spieler später sieht – inklusive der Lichtfarbe:

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
| `○` / `◉` | Knoten für jedes Licht, dunkel / erhellt |
| `a` / `Ⓐ` | Bernsteinknoten |
| `c` / `Ⓒ` | Cyanknoten |
| `w` / `Ⓦ` | Weißknoten |
| `/` `\` | drehbarer Spiegel |
| `╱` `╲` | fester Spiegel |
| `⟋` `⟍` | drehbares Prisma |
| `⧸` `⧹` | festes Prisma |
| `◌` | leere Fassung |
| `─` `│` | weißes Licht |
| `═` `║` | Bernstein |
| `┈` `┊` | Cyan |
| `┼` | der Faden kreuzt sich selbst |
| `·` | leere Zelle |

## Der Solver

Jedes bewegliche Bauteil ist ein **Regler** mit einer festen Zahl an Zuständen:
ein Spiegel oder ein drehbares Prisma mit zwei, eine Fassung mit dreien
(`leer → / → \`). Der Suchraum ist damit das Produkt aller Zustandszahlen – eine
Zahl in gemischter Basis, die sich schlicht durchzählen lässt.

Entscheidend ist, dass die Regler **voneinander unabhängig** sind: Jeder
zykliert für sich. Damit ist die Reihenfolge der Züge egal, und die
Mindestzahl an Zügen ist die Summe der **zyklischen Abstände** zwischen
Startstellung und irgendeiner Lösungsstellung – nicht das Ergebnis einer
Pfadsuche. Bei zwei Zuständen ist das genau der alte Hamming-Abstand; die Regel
ist nur allgemeiner geworden, nicht anders.

Der Prismenvorrat schränkt nur die *Reihenfolge* ein, nie die *Zahl* der Züge:
`movesBetween()` räumt erst Fassungen leer, dreht dann um und füllt zuletzt
auf. Damit sind nie mehr Fassungen belegt als am Anfang oder am Ende – und
beides liegt im Vorrat.

`solveFrom(level, stellung)` rechnet dasselbe von einer beliebigen Stellung
aus. Darauf sitzt die Tipp-Funktion im Spiel: Sie nennt ein Bauteil, das von
*hier* aus noch dran ist, nicht eines vom Levelstart aus.

### Rechenbudget

`MAX_STATES` (2²²) ist die harte Grenze der Suche, `MAX_IDLE_STATES` (2¹⁸) die
der Deko-Analyse – letztere kostet noch einmal das `n`-Fache. `check:lumen`
weist jedes Level ab, dessen Suchraum darüber liegt.

Praktisch sollte ein Level deutlich darunter bleiben: **höchstens rund 20 000
Stellungen**, sonst dauert die Abnahme spürbar. Prisma-Level brauchen deshalb
weniger Spiegel als die alten – ihre Schwierigkeit kommt aus den Farben, nicht
aus der Zahl der Schalter. Die Spalte `Zust.` in der Tabelle zeigt den Wert.

## Kennzahlen der Tabelle

| Spalte | Bedeutung |
| --- | --- |
| Größe | Raster (Breite × Höhe) |
| Spiegel / Prism / Fass | Zahl der Spiegel, fest gesetzten Prismen, Fassungen |
| Vorrat | in der Lösung benutzte / vorhandene Prismen |
| fest | verschraubte Bauteile |
| Block | Zahl der Blocker |
| Ziele | Zahl der Knoten, in Klammern die farbigen |
| Regler | bewegliche Bauteile |
| Zust. | Größe des Suchraums |
| Start | wie viele Knoten schon im Startzustand leuchten (soll < Ziele sein) |
| Par | Mindestzahl an Zügen |
| Lös. | Zahl aller Stellungen, die das Level lösen |
| opt. | davon die mit genau `Par` Zügen – muss `1` sein |
| Deko | Regler, die auf das Ergebnis keinerlei Einfluss haben |
| Fäden | Zahl der Linien im Lichtweg (1 ohne Prisma) |
| Länge | Länge des Lichtwegs in Zellen (in der Lösung) |

## Was `check:lumen` prüft

**Optik: Spiegel**

- Beide Spiegel lenken jede Richtung um genau 90° um und sind umkehrbar.
- `/` wirft nach rechts laufendes Licht nach oben, `\` nach unten.
- Ein Spiegel ändert die Farbe nicht.

**Optik: Farbe**

- Weiß ist die Vereinigung von Bernstein und Cyan.
- Ein Bernsteinknoten bleibt im weißen *und* im cyanfarbenen Licht dunkel.
- Ein Weißknoten braucht beide Grundfarben.

**Optik: Prisma**

- Weiß spaltet sich in genau zwei Äste: Bernstein geradeaus, Cyan um 90°.
- Spalten ist **umkehrbar**: Beide Farben, gegen ihre Ausgangsrichtung
  eingespeist, verlassen das Prisma in derselben Richtung. Genau dort
  vereinigen sie sich wieder. Geprüft für beide Ausrichtungen × vier
  Richtungen.
- Eine einzelne Farbe wird nicht noch einmal zerlegt.

**Optik: Fassung und Rest**

- Eine leere Fassung ist für das Licht nicht vorhanden, eine besetzte ist ein
  Prisma.
- Blocker und Quelle verschlucken alles.

**Strahlverfolgung**

- Der Strahl endet am Feldrand, am Blocker und an der Quelle – jeweils exakt
  auf der Zellkante, damit die Grafik nicht in den Blocker hineinzeichnet.
- Er läuft hinter einem getroffenen Knoten weiter.
- Er darf dieselbe Zelle einmal waagerecht und einmal senkrecht durchlaufen;
  eine Kreuzung ist keine Teilung.
- Aufspalten und Wiedervereinigen erreichen die richtigen Knoten in der
  richtigen Farbe.
- Ein dicht mit Prismen und Spiegeln gefülltes Feld bleibt über 1000
  Zufallsstellungen **immer** endlich, und die Zahl der Linien bleibt unter
  `Breite · Höhe · 4`. Das ist kein Zufall: Der Fixpunkt läuft über einen
  endlichen Zustandsraum, und Farbmasken wachsen nur.
- Ein Ring aus Spiegeln, den die Quelle nicht speist, bleibt **dunkel**. Der
  Fixpunkt ist der kleinste – es gibt kein Perpetuum mobile.
- Kaputte Level (unbekannte Zeichen, ungleiche Zeilenlängen, kein Ziel, kein
  Regler, Quelle strahlt sofort aus dem Feld, Fassung ohne Vorrat, Vorrat ohne
  Fassung, so viele Prismen wie Fassungen) werden abgelehnt.

**Sitzungslogik**

- Tippen daneben oder auf ein verschraubtes Bauteil zählt keinen Zug.
- Der Fassungszyklus `leer → / → \ → leer` stimmt, der Vorrat wird korrekt
  auf- und abgebucht, und ein Tipp ohne Vorrat zählt keinen Zug.
- Zurück, Neu und die Sternbewertung verhalten sich wie beschrieben – auch für
  Fassungen.
- Die Zugfolge des Solvers überzieht den Vorrat nie.

**Jedes Level**

- ist lösbar und startet **nicht** gelöst,
- hat ein `par`, das dem Solver-Wert entspricht,
- hat **genau eine** kürzeste Lösung,
- bleibt im Rechenbudget,
- lässt sich mit den Solver-Zügen tatsächlich durchspielen (in genau `par` Zügen),
- besteht zu höchstens der Hälfte aus wirkungslosen Reglern,
- lässt bei Fassungen mindestens eine leer und benutzt mindestens ein Prisma,
- übersteht 300 zufällige Tipps ohne Fehler,
- springt im Par nicht um mehr als 3 gegenüber dem bisherigen Höchstwert.

**Lehrkarten**

- Prisma, Knotenfarben und Fassungen werden **genau einmal** erklärt, und zwar
  im Level ihres ersten Auftretens.
- Es gibt keine Lehrkarte ohne zugehörige Mechanik.

## Neues Level einbauen

1. In `levels.js` eintragen, `par` erst einmal weglassen oder raten.
2. `npm run sim:lumen -- --par` – der Solver nennt den richtigen Wert.
3. `npm run sim:lumen -- --show=lXX` – Start- und Lösungsbild ansehen.
   Läuft der Faden im Startzustand sichtbar irgendwohin? Kreuzt er sich?
   Sieht die Lösung nach einem Aha-Moment aus?
4. `npm run sim:lumen` – `opt.` muss `1` sein, `Deko` klein, `Zust.` im Budget.
5. `npm run check:lumen` muss grün sein.

## Ein neues Bauteil einbauen

1. `optics.js`: Eintrag in `DEVICES` mit `interact(zustand, richtung, farben)`.
2. `level.js`: Zeichen in `SYMBOLS`, Zustandsliste in `STATES`, Zweig in
   `symbolFor`.
3. `gfx/kinds.js`: Sprite-Nummer **vor** `TARGET_GLOW` (Materie) bzw. dahinter
   (Licht), Form in `gfx/shaders/sprite.js`, Zuordnung in `gfx/scene.js`, und
   dieselbe Form im 2D-Rückfall `gfx/canvas2d.js`.
4. `sim/ascii.js`: Glyphe.

Solver, Abnahme und Sitzungslogik brauchen **nichts** – sie kennen nur Regler
mit `n` Zuständen.
