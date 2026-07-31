# ✦ Lumenweber

Ein Lichträtsel. Auf einem dunklen Raster steht eine Quelle und strahlt in eine
feste Richtung. Der Spieler tippt Spiegel an – sie kippen zwischen `/` und `\`
und lenken den Strahl um 90° um. Gelöst ist ein Level, wenn der Faden aus Licht
alle Knoten gleichzeitig durchläuft.

Später kommen **Prismen** dazu. Sie trennen das weiße Licht in seine beiden
Grundfarben und führen sie an anderer Stelle wieder zusammen – und einige davon
setzt der Spieler selbst.

## Spielen

`games/lumenweber/index.html` – oder über die Übersicht.

| | |
| --- | --- |
| Bauteil weiterschalten | antippen / anklicken |
| Zug zurück | `↩ Zurück` oder <kbd>U</kbd> |
| Level neu | `⟳ Neu` oder <kbd>R</kbd> |
| Tipp | `💡 Tipp` oder <kbd>H</kbd> |
| Legende der Knoten | `◉ 2/4` in der Kopfzeile oder <kbd>L</kbd> |
| Levelauswahl | `☰` oder <kbd>Esc</kbd> |
| Ohne Maus | Pfeiltasten bewegen den Fokus, <kbd>Enter</kbd> schaltet |

Der Tipp ist kein vorgeschriebener Text, sondern gerechnet: Der Solver schaut
sich die **aktuelle** Stellung an und nennt ein Bauteil, das von hier aus noch
dran ist, samt Zahl der verbleibenden Züge.

### Auf dem Handy und Tablet

Das Brett skaliert auf die verfügbare Fläche, die Trefferfläche einer Zelle ist
großzügiger als ihr sichtbarer Rand, und Scrollen, Zoomen und Doppeltipp-Zoom
sind auf dem Spielfeld abgeschaltet – sonst rutscht bei jedem zweiten Zug die
Seite weg. `env(safe-area-inset-*)` hält HUD und Bedienleiste aus der Notch und
der Home-Leiste heraus.

## Regeln im Detail

### Licht hat eine Farbe

Licht ist eine **Menge aus zwei Grundfarben**: Bernstein und Cyan. Weiß ist
keine dritte Farbe, sondern die Vereinigung der beiden. Die Quelle strahlt weiß.

| trifft auf | passiert |
| --- | --- |
| Spiegel | 90°-Umlenkung, Farbe bleibt |
| **Prisma** | **Bernstein läuft geradeaus, Cyan wird um 90° umgelenkt** |
| **leere Fassung** | nichts – das Licht läuft hindurch |
| Zielknoten | Knoten leuchtet, wenn die Farbe passt; Strahl **läuft weiter** |
| Blocker | Ende |
| Quelle | Ende |
| Feldrand | Ende |

Weißes Licht **spaltet sich** an einem Prisma also in zwei Strahlen. Und weil
die Regel umkehrbar ist, **vereinigt** dasselbe Prisma zwei passend einfallende
Farbstrahlen wieder zu weißem Licht: Beide verlassen es in derselben Richtung,
und die Vereinigung ihrer Farbmengen ist wieder Weiß. Es braucht dafür kein
zweites Bauteil und keine Sonderregel – Spalten und Vereinigen sind dieselbe
Regel, einmal vorwärts und einmal rückwärts gelesen.

### Knotenfarben

| Knoten | leuchtet bei |
| --- | --- |
| `o` | jedem Licht |
| `A` Bernsteinknoten | **reinem** Bernstein |
| `C` Cyanknoten | **reinem** Cyan |
| `W` Weißknoten | weißem, also wiedervereinigtem Licht |

Weißes Licht lässt einen Bernsteinknoten dunkel – es ist ihm zu grell. Erst das
Prisma trennt sauber genug. Damit hat das Zusammenführen einen zwingenden
Grund: Ohne Wiedervereinigung bleibt jeder Weißknoten dunkel.

Farbe ist nie das einzige Unterscheidungsmerkmal: Die Knoten haben auch
verschiedene Formen (Kreis, Dreieck, Viereck, Achteck mit zweitem Reif).

#### Wie ein Knoten seine Farbe zeigt

Im ganzen Spiel gilt eine Aussage, und zwar ausnahmslos:

> **Die Farbe am Knoten ist die Farbe, die durch ihn hindurchpasst.
> Kein Farbton heißt: keine Forderung.**

Daraus folgen zwei Entscheidungen, die leicht wieder verlorengehen:

* Ein Knoten trägt seine Wunschfarbe **schon bevor Licht ihn trifft** – gedämpft
  (`TARGET_DIM_*` in `gfx/palette.js`), aber im Farbton eindeutig. Zeigte er sie
  erst beim Treffer, stünde die Auskunft genau dann zur Verfügung, wenn niemand
  sie mehr braucht; beim Lösen bliebe nur die Eckenzahl, und die liest sich bei
  kleiner Zelle schlecht.
* Der `o`-Knoten ist **farblos**, nicht goldgelb. Gold heißt hier überall
  Bernstein – Quelle, Faden, der gerade Anteil hinter dem Prisma. Ein goldener
  „nimmt alles"-Knoten behauptet das Gegenteil dessen, was er tut.

`nodes.js` hält Form, Farbe und Klartext dazu an einer Stelle; Brett, Legende,
Erklärkarte und Regelseite greifen alle darauf zu. Was durch welchen Knoten
passt, kommt dort aus `accepts()` selbst statt aus einer zweiten Tabelle – eine
Legende, die von der Regel abweicht, ist schlimmer als gar keine.

#### Legende

Der Zielzähler `◉ 2/4` in der Kopfzeile ist zugleich der Griff zur Legende
(Taste `L`). Sie zeigt **nur die Knotenarten dieses Levels**, je mit Symbol,
Klartext, den drei Lichtsorten als ✓/✗ und dem Zählerstand. Sie legt sich nicht
über das Brett, sondern nimmt ihm Platz weg – rechts auf breiten Schirmen, unten
auf schmalen. Sonst läge sie über genau den Knoten, die sie erklärt. Dieselben
Zeilen stehen vollständig auf der Regelseite hinter `?` (`legend.js`).

### Fassungen und der Vorrat

Ein Level kann **Fassungen** enthalten und dazu einen **Vorrat an Prismen**.
Eine Fassung ist eine markierte Zelle, in die ein Prisma passt. Ein Tipp
schaltet sie weiter:

```
leer  →  ◆ /  →  ◆ \  →  leer  →  …
```

Jeder Tipp ist ein Zug. Es gibt immer **mehr Fassungen als Prismen** – welche
man besetzt, ist Teil des Rätsels. Ist der Vorrat leer, bleibt eine leere
Fassung stumm.

Fest sind: Position und Richtung der Quelle, Position der Knoten, Blocker und
aller Bauteile. Veränderbar ist ausschließlich die Ausrichtung der beweglichen
Bauteile und der Inhalt der Fassungen. Verschraubte Bauteile (dunkle
Trägerplatte mit vier Schraubenköpfen) wirken mit, lassen sich aber nicht
antippen.

Der **Par-Wert** ist die vom Solver bestimmte Mindestzahl an Zügen. Wer ihn
trifft, bekommt drei Sterne. Es gibt keine Zugbegrenzung – niemand wird aus
einem Level geworfen, weil er zu viel probiert hat.

### Eine Abweichung vom Entwurf

Der Spielentwurf beschreibt `/` als Spiegel, der nach rechts laufendes Licht
**nach unten** wirft. Das ist die Tabelle für `\`. Hier gilt die physikalische
Zuordnung: `/` wirft nach oben, `\` nach unten. Das Verhalten ist dasselbe, nur
die Beschriftung der Glyphe wäre sonst verdreht – und ein sichtbarer
`/`-Spiegel, der nach unten ablenkt, sieht auf dem Schirm schlicht falsch aus.

## Die Level

Level 1–20 sind das Spiegelspiel: von 5×5 mit einem einzigen Spiegel bis 9×9
mit dreizehn drehbaren Spiegeln und fünf Knoten, Par von 1 auf 8. Ab Level 21
kommen die Prismen dazu.

Jedes Level hat **genau eine** kürzeste Lösung – es gibt keine zwei
gleichwertigen Wege und damit auch keinen Zufallstreffer. In jedem Level gibt
es außerdem mehr bewegliche Bauteile, als Züge nötig sind: „einfach alles
umlegen" funktioniert nirgends.

Einige der späten Level enthalten **Ablenkbauteile** – bewegliche Teile, die
das Licht in keiner Stellung berührt. Ohne sie wüsste ein aufmerksamer Spieler,
dass jedes sichtbare Bauteil gebraucht wird, und könnte allein daraus auf die
Lösung schließen. Die Spalte `Deko` in `npm run sim:lumen` weist sie aus;
`check:lumen` sorgt dafür, dass es bei Ablenkung bleibt und nicht die halbe
Fläche Attrappe wird.

Neue Mechaniken kommen einzeln und werden erklärt. Für die kleinen Sachen
genügt ein Satz Toast (`hint`): Spiegel drehen (l01), der Faden läuft hinter
einem Knoten weiter (l02), Blocker (l03), feste Spiegel (l04), Kreuzungen
(l06), vier Knoten auf einem Faden (l11), das große Feld (l16). Für die drei
großen gibt es eine einmalige **Lehrkarte** mit Zeichnung (`teach`): das
Prisma, die Knotenfarben und die Fassungen. `check:lumen` erzwingt, dass jede
davon genau einmal und bei ihrem ersten Auftreten erklärt wird.

## Aufbau

```
optics.js     Farbmodell und Bauteilverhalten – die einzige Stelle, an der
              steht, was ein Bauteil mit Licht macht
level.js      Datenmodell, Regler, Textformat der Level
beam.js       Strahlverfolgung als Fixpunkt – rein aus Level + Reglerstellung
game.js       Sitzung: schalten, zurück, neu, Sternbewertung
levels.js     Levelsammlung im Textformat
nodes.js      Knotenkunde: Form, Farbe, Klartext – eine Quelle für Brett,
              Legende, Lehrkarte und Regelseite
legend.js     die Legendenzeilen, für beide Orte dieselben
teach.js      Zeichnungen der Lehrkarten
layout.js     Geometrie – geteilt von Renderer und Eingabe
render.js     Wahl der Darstellung: WebGL2, sonst 2D-Canvas
gfx/          WebGL2-Renderer (Shader, Bloom), der 2D-Rückfall und die Palette
input.js      Finger, Maus, Tastatur
progress.js   Fortschritt im localStorage
audio.js      synthetischer Klang über die Web Audio API
main.js       Verdrahtung, Bildschirme
sim/          Simulation & Solver ohne Browser (eigene README)
```

`optics.js`, `level.js`, `beam.js`, `game.js` und `levels.js` sind vollständig
DOM-frei. Genau deshalb lässt sich das Spiel ohne Browser durchspielen und
prüfen.

### Warum die Optik ein eigenes Modul ist

`beam.js` kennt kein einziges Bauteil beim Namen. Es fragt nur
`interact(art, zustand, richtung, farben)` und bekommt die austretenden
Strahlen zurück. Ein neues Spielprinzip ist deshalb ein Eintrag in `DEVICES` –
und nicht ein Eingriff in die Strahlverfolgung, den Solver, die Abnahme und
zwei Renderer.

Dieselbe Trennung zieht sich durch: Der Solver kennt nur **Regler** mit `n`
Zuständen, nicht Spiegel und Fassungen. Die Szene läuft über `level.devices`
und ordnet jeder Art in einer Tabelle einen Sprite zu. Die Farben stehen einmal
in `gfx/palette.js` und gelten für beide Renderer.

### Warum die Strahlverfolgung ein Fixpunkt ist

Solange es nur Spiegel gab, war der Lichtweg ein Pfad: Ein Spiegel ist eine
umkehrbare Abbildung, die Quelle verschluckt einfallendes Licht, also konnte
der Strahl gar nicht in einen Kreis geraten.

Ein Prisma macht aus einem Strahl zwei und ist damit nicht mehr umkehrbar –
Ringe im Lichtweg sind jetzt wirklich möglich. Statt sie mit einer
Schleifenerkennung abzufangen, rechnet `beam.js` einen **Fixpunkt** über

```
(Zelle, Laufrichtung)  →  Farbmaske
```

Farbmasken wachsen nur (Vereinigung zweier Strahlen = ODER der Masken), der
Zustandsraum ist endlich. Damit terminiert die Rechnung garantiert nach
höchstens `Breite · Höhe · 4 · 2` Schritten, ganz gleich wie viele Prismen im
Feld stehen. Die Wiedervereinigung fällt dabei kostenlos ab – sie *ist* die
Mengenvereinigung. Und weil der Fixpunkt der kleinste ist, bleibt ein Ring, der
sich nur selbst speisen würde, dunkel: Licht entsteht ausschließlich an der
Quelle.

## Ohne Browser testen

```bash
npm run check:lumen                # Optik, Sitzungslogik, Abnahme aller Level
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

Farbiges Licht bekommt eigene Linien: `─│` weiß, `═║` Bernstein, `┈┊` Cyan.

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
| `>` `<` `^` `v` | Lichtquelle mit Strahlrichtung |
| `o` | Knoten für jedes Licht |
| `A` `C` `W` | Bernstein-, Cyan-, Weißknoten |
| `/` `\` | drehbarer Spiegel |
| `1` `2` | fester Spiegel (`/` bzw. `\`) |
| `p` `q` | drehbares Prisma (`/` bzw. `\`) |
| `3` `4` | festes Prisma |
| `_` | leere Fassung |

Dazu die Felder `prisms` (Vorrat, nur bei Fassungen), `hint` (Toast beim
Levelstart) und `teach` (`{ id, title, body }` – einmalige Lehrkarte).

In JS-Strings muss `\` als `\\` geschrieben werden. `par` wird von
`check:lumen` gegen den Solver geprüft – ein falscher Wert ist ein Testfehler,
kein Schönheitsfehler.
