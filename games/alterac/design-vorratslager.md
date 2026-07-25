# Entwurf: Vorratslager & mächtiger Verbündeter

Spezifikation der Vorrats-Mechanik. Vorbild ist das Original-Alteractal, in dem
gesammelte Gegenstände bei einem NPC abgegeben werden, ein **fraktionsweiter**
Zähler wächst und beim Schwellenwert ein mächtiger Verbündeter erscheint
(Lokholar der Eislord / Ivus der Waldlord). Übernommen wird das Muster, nicht
die Zahlen.

## 1. Problem & Ziele

Vor dieser Erweiterung hat das Spiel drei tote Winkel:

- **Wegpunkte ohne Eigenwert.** Eisfelsklamm, Steinbruch, Feldmitte,
  Wolfsschlucht und Kiefernhang sind reine Durchgangsknoten. „Halten" lohnt
  dort nie – es gibt nichts zu halten.
- **Nur ein Fortschrittsvektor.** Türme knacken, dann den Boss. Wer diesen Weg
  nicht geht, hat keinen alternativen Plan.
- **Tempo wird nicht belohnt.** Der Kampfwert je Ressourcenpunkt (Lebenspunkte ×
  Schaden pro Sekunde) beträgt bei „Schwer" 113, bei „Leicht" nur 24. Ohne eine
  Aufgabe, für die Schnelligkeit zählt, ist die leichte Einheit dominiert.

Ziele:

1. Ausgewählte Wegpunkte werden zu **Zielen**, die man einnehmen und halten will.
2. Ein **zweiter Weg zur Stärke** neben der Turmoffensive – als echte Abwägung,
   nicht als klar besserer Plan.
3. **Strikte Symmetrie** zwischen Norden und Süden, nachweisbar über die
   Kartenstruktur.
4. Determinismus und das ereignisbasierte Zeitmodell bleiben unangetastet.

## 2. Die Lager: Standort und Symmetrie

Jede Fraktion hat **genau ein fest zugeordnetes Vorratslager** an einem
bestehenden Kampfpunkt: der **Steinbruch** (`en`, Norden) gehört dem Frostwolf,
die **Wolfsschlucht** (`ws`, Süden) der Sturmlanze. Markiert wird das – wie bei
den Türmen – direkt am Wegpunkt in `NODES` (`supply: 'red' | 'blue'`); ein neuer
Knotentyp entsteht nicht.

Ein Lager **wechselt nie den Besitzer**. Der Gegner kann es besetzen und damit
lahmlegen, aber niemals selbst nutzen. Das ist der wesentliche Unterschied zum
Friedhofssystem und hält die Mechanik symmetrisch: Es gibt keinen Wettlauf um
einen neutralen Punkt, den eine Seite dauerhaft für sich vereinnahmen könnte.

Der Kartengraph ist unter der Spiegelung

```
rboss↔bboss   rgate↔sgate   reast↔swest   rgy↔bgy
wn↔es         en↔ws         gyw↔gye       mid, gym (Fixpunkte)
```

vollständig invariant – alle 23 Verbindungen bilden sich paarweise aufeinander
ab. Wegen `en ↔ ws` gilt damit für die Lager exakte Spiegelsymmetrie. Da die
Reisezeit **pro Wegstück** zählt (`edgeTime`, unabhängig von der Pixel-Distanz),
ist die Symmetrie auch zeitlich exakt:

| von | zum Steinbruch (`en`) | zur Wolfsschlucht (`ws`) |
| --- | --- | --- |
| Frostwolf-Basis (`rboss`) | **2 Wegstücke** | 3 Wegstücke |
| Sturmlanzen-Basis (`bboss`) | 3 Wegstücke | **2 Wegstücke** |

Jede Fraktion erreicht ihr **eigenes** Lager also in zwei Wegstücken und das
**gegnerische** in drei. Verteidigen ist billig, den Gegner stören ist teuer –
dieselbe Risiko/Ertrag-Spannung wie bei den Minen des Originals, aber ohne
dessen berüchtigten Geometriefehler, bei dem eine Fraktion deutlich weiter
laufen musste als die andere.

Hinzu kommt eine Eigenschaft, die sich aus der Flankenregel der Wegsuche ergibt
(`pathLess` in `map.js`): Der automatische Marsch zum gegnerischen Boss führt
**jede Fraktion am Lager des Gegners vorbei** – Blau über den Steinbruch, Rot
über die Wolfsschlucht. Das Lager liegt damit von selbst dort, wo der Feind
ohnehin durchkommt, und ist verteidigungswürdig, ohne dass es künstlich
aufgewertet werden müsste. Weil beide Seiten dasselbe erleben, bleibt es fair.

**Warum bestehende Kampfpunkte und keine Sackgassen?** Weil genau die
Durchgangsknoten den Eigenwert brauchen. Friedhöfe bleiben bewusst Sackgassen;
die beiden Systeme sollen sich unterscheiden.

## 3. Inbetriebnahme, Betrieb und Blockade

Ein Lager kennt vier Zustände: **inaktiv** (Ausgangslage), **in Arbeit**
(Inbetriebnahme läuft oder ruht), **in Betrieb** und **blockiert**.

Die ganze Mechanik steht auf **einer** Regel:

> Auf ein Lager wirkt nur, wer es **ausdrücklich als Pfadziel** plant – für die
> Inbetriebnahme wie für die Blockade. Wer bloß durchmarschiert, tut beides nicht.

**Inbetriebnahme:**

- Eine Einheit der **Besitzerfraktion** muss das Lager ausdrücklich als Ziel
  haben (ihr Pfad endet dort) und `supplyCaptureTime` daran arbeiten; mehrere
  eigene Einheiten verkürzen nichts.
- Aufhalten kann sie nur ein Gegner, der das Lager **seinerseits ausdrücklich
  besetzt**. Dann ruht die Arbeit.
- **Der Fortschritt verfällt nie.** Ruht die Arbeit – weil der Läufer fällt,
  abzieht oder ein Besetzer eintrifft –, wird der erreichte Stand verbucht und
  bleibt liegen. Der nächste Läufer setzt dort fort, wo der letzte aufhörte.
- Danach liefert das Lager **dauerhaft**, auch wenn die Einheit weiterzieht. Sie
  ist wieder frei und muss keine Wache stehen.

**Blockade** – der Hebel des Gegners gegen ein bereits laufendes Lager:

- Solange eine **gegnerische** Einheit das Lager ausdrücklich besetzt, liefert
  es nichts.
- Zieht sie ab oder fällt sie, liefert es **sofort wieder** – die einmal
  erfolgte Inbetriebnahme geht nie verloren.
- Wer ein gegnerisches Lager besetzt, **hält die Stellung**: Sein Auftrag gilt
  nie als erledigt, er marschiert also nicht von selbst weiter.

### Warum genau so – die Korrektur einer toten Mechanik

Der erste Entwurf folgte der **Friedhofsregel**: ununterbrochene Präsenz, allein
vor Ort, jede Störung wirft den Fortschritt auf 0. Damit war die Mechanik
**praktisch tot** – in 0 von 16 gemessenen Partien kam der Verbündete zustande,
selbst mit einem erzwungenen Läufer.

Die Ursache war strukturell, keine Zahlenfrage. Das Lager `ws` ist der einzige
Zugang zum Nebenturm `swest`; jede Turmoffensive des Gegners läuft zwangsläufig
mitten hindurch (gespiegelt gilt dasselbe für `en` und `reast`). Zählte bloße
Anwesenheit, zerstörte **reiner Zufallsverkehr** jede Inbetriebnahme – ohne dass
der Gegner es beabsichtigt oder irgendetwas dafür bezahlt hätte. Die
Inbetriebnahme (8 s) war zudem länger als das Zeitfenster bis zum Eintreffen der
feindlichen Hauptmacht (~7 s), das Fenster ging also nie auf.

Die Regel stand damit **an der falschen Stelle streng**: Das Verwundbare – die
Inbetriebnahme – kostete den Gegner nichts, das Robuste – die laufende Lieferung
– kostete ihn eine dauerhaft gebundene Einheit. Der teure Hebel war genau der,
den er nie brauchte.

Beide Korrekturen zusammen drehen das um:

1. **Dieselbe Bedingung für Einnahme und Blockade.** Stören kostet immer eine
   Einheit, die dafür abgestellt wird. Das macht die Regel gleichzeitig
   *einfacher* (eine statt zwei) und die Mechanik erst spielbar.
2. **Fortschritt ruht statt zu verfallen.** `supplyCaptureTime` heißt „so viele
   Sekunden insgesamt", nicht „am Stück". Ein Läufer darf fallen, ohne dass
   seine Arbeit verloren ist.

Das Gegenmittel bleibt erhalten und ist sogar das naheliegendste: **Wer den
Läufer erschlägt, hält die Inbetriebnahme an.** Sie verliert nur nichts mehr.

Gemessen nach der Änderung (headless über `createSim`, gleiche Armee mit und
ohne Lagerlauf): Das Lager geht in **100 %** der Partien in Betrieb – vorher 0 %.

Das ist auch die zentrale Balance-Entscheidung: Ein Lager kostet **einmalig**
Zeit, nicht dauerhaft eine Einheit. Bei vier Einheiten je Seite wäre ein
dauerhaft abgestellter Sammler zu teuer – der Abstecher würde sich nie lohnen,
genau wie heute der Friedhofsläufer.

## 4. Vorrat: stetiger Nachschub

Jede Fraktion führt einen Zähler `supply`, Startwert 0:

> Das eigene Lager liefert **einen Vorratspunkt je `supplyTickTime`**, solange
> es in Betrieb und nicht blockiert ist. Sonst fließt nichts.

Der Vorrat läuft **stetig** auf, nicht in Takten. Verbucht wird nur bei
Besitzwechseln (`settleSupply`), und weil die Rate zwischen zwei Besitzwechseln
konstant ist, lässt sich der Moment des Schwellenübertritts exakt ausrechnen und
als reguläres Ereignis einplanen.

**Warum nicht der naheliegende globale Takt** (Vielfache von `supplyTickTime`,
wie bei den Respawn-Wellen)? Weil ein Rasterpunkt, der zwischen zwei Batches
fällt, nachgeholt werden müsste – und ob das passiert, hinge davon ab, ob
zufällig anderswo auf der Karte ein Kampf für einen Zwischen-Batch sorgt.
Deterministisch wäre das zwar, aber der Spieler könnte nicht mehr vorhersagen,
wann sein Verbündeter kommt: mal 36, mal 40 Sekunden nach der Inbetriebnahme.
Stetiger Nachschub macht daraus eine feste Zusage – **ein laufendes Lager = 40 s
bis zum Verbündeten**, immer.

## 5. Der Verbündete

Erreicht der Vorrat einer Fraktion `allySupplyCost`, wird er **verbraucht** und
ihr **mächtiger Verbündeter** erscheint:

- **Sturmlanze:** Ivus der Waldlord · **Frostwolf:** Lokholar der Eislord.
- Er erscheint am **eigenen Boss-Wegpunkt** und marschiert selbstständig auf
  kürzestem Weg zum gegnerischen Boss – er nutzt exakt den bestehenden
  Fallback (leerer Pfad, Haltung „Angriff"), es braucht keinen neuen Auftragstyp.
- Er kämpft unterwegs wie jede andere Einheit und ist **tötbar**.
- Er **respawnt nicht**. Fällt er, ist er endgültig weg.
- Der **Boss-Schild gilt auch für ihn**: Solange gegnerische Türme stehen,
  blockt der Schild seinen Schaden genauso. Der Verbündete ersetzt die
  Turmarbeit also nicht, er beschleunigt sie.
- Je Fraktion und Partie **höchstens einer**. Nach der Beschwörung sammelt die
  Fraktion weiter Vorrat, aber ein zweiter Verbündeter erscheint nicht.

Im Original startet der Elementarlord auf dem Feld der Zwietracht und stößt von
dort in die feindliche Basis vor. Der Start am eigenen Boss ist die
spielmechanisch fairere Variante: Der lange Anmarsch ist die Gegenleistung
dafür, dass der Gegner ihn kommen sieht und abfangen kann.

### Bewusst nicht übernommen

- **Zweiter Verbündeter, Stapel-Buffs.** Lokholar wächst im Original pro
  getötetem Gegner (`Swell of Souls`), Ivus nicht – eine der bekanntesten
  Asymmetrien des Vorbilds. Beide Seiten bekommen hier dieselbe Einheit mit
  denselben Werten, nur mit eigenem Namen und eigener Farbe.
- **Ritual mit Anwesenheitspflicht.** Im Original müssen zehn Spieler einen
  Beschwörungskreis anklicken. In einem Spiel mit vorausgeplanten Befehlen wäre
  das keine Entscheidung, sondern eine Stolperfalle.
- **Weitere Doktrinen** (Rüstkammer, Reiterei). Bleiben als spätere Ausbaustufe
  denkbar; der Vorrat ist bewusst als allgemeine Währung modelliert, damit eine
  zweite Verwendung nur eine Auswahl in der Planung braucht.

## 6. Zahlenwerte (im Turnier kalibriert)

| Wert | Schlüssel | Wert | Begründung |
| --- | --- | --- | --- |
| Inbetriebnahme | `supplyCaptureTime` | 6 s | Deutlich kürzer als die Friedhofseinnahme (10 s): Das Lager liegt auf dem Hauptweg und ist schwerer ungestört zu halten. |
| Rate | `supplyTickTime` | 4 s | Ein laufendes Lager liefert 10 Vorrat in 40 s. |
| Schwelle | `allySupplyCost` | 10 | Zusammen **46 s Gesamtdauer** ab Eintreffen des Läufers. |
| Verbündeter | `allyHp` / `allyDamage` / `allyAttackInterval` / `allySpeed` | 60 / 20 / 1,5 s / 1,0 | Kampfwert 800 ≈ 2,4 schwere Einheiten, also ungefähr +50 % auf eine Armee aus vier schweren Einheiten. |

Der eigentliche Hebel ist die **Gesamtdauer** `supplyCaptureTime +
allySupplyCost × supplyTickTime`. Sie entscheidet, ob der Verbündete die Partie
überhaupt noch erreicht. Gemessen headless über `createSim` – beide Varianten
mit demselben KI-Plan als Basis, verändert wird nur die Route einer einzigen
Einheit, damit der Vergleich nicht die Aufstellung misst (gemittelt über alle
Budgets, je 16 Partien):

| Gesamtdauer | Lager läuft | Verbündeter erscheint | Ø Ruf |
| --- | --- | --- | --- |
| 68 s (8 s + 12 × 5 s, alter Stand) | 100 % | 32/64 | 90 s |
| **46 s (6 s + 10 × 4 s)** | **100 %** | **32/64** | **68 s** |
| 38 s (6 s + 8 × 4 s) | 100 % | 32/64 | 60 s |
| 29 s (5 s + 8 × 3 s) | 100 % | 32/64 | 51 s |
| 22 s (4 s + 6 × 3 s) | 100 % | 48/64 | 38 s |

Gewählt sind **46 s**. Die alten 68 s riefen den Verbündeten erst nach Ø 90 s –
zu spät, um in einer Partie von Ø 190 s (Schwer gegen Schwer) noch zu wirken.
Kürzere Werte holen ihn früher, machen den Läufer aber bei großen Budgets
übermächtig.

Dass der Verbündete nur in 32 von 64 Partien erscheint, ist **kein Zahlenproblem
und beabsichtigt**: Er kommt bei 18 und 24 Ressourcen zuverlässig (16/16), bei 8
und 12 nie. Dort ist die Partie schon entschieden, bevor er fällig wäre – eine
von vier Einheiten für einen Abstecher abzustellen, ist bei kleinem Budget ein
echtes Opfer. Kürzere Werte ändern daran nichts (bei 29 s ebenfalls 0/16). Genau
das soll die Mechanik sein: eine Entscheidung mit Preis, kein Automatismus.

Alle Werte stehen in `config.js` und sind im Erweitert-Menü feinjustierbar –
aufgeteilt auf die Sektionen **„Vorratslager"** (Zeiten und Schwelle) und
**„Mächtiger Verbündeter"** (seine Kampfwerte, dieselben Größen wie bei den
anwerbbaren Einheitentypen). Der Setup-Schalter **„Vorratslager aktiv"** schaltet
das ganze System ab (`supplyEnabled: false`), analog zum Türme-Schalter.

**Kalibrierungsregel:** Die Werte sind dann richtig, wenn ein Computergegner mit
Lagerstrategie gegen einen ohne Lagerstrategie ungefähr ausgeglichen abschneidet.
Gewinnt die Lagerstrategie deutlich, ist der Abstecher zu billig; verliert sie
deutlich, ist er sinnlos. Gemessen wird headless über `createSim`.

## 7. Determinismus

Das ereignisbasierte Zeitmodell bleibt vollständig intakt:

1. **Inbetriebnahmen** werden wie Friedhofseinnahmen am Ende eines Batches
   ausgewertet. Ihr Abschlusszeitpunkt ist `since + (supplyCaptureTime −
   progress)` und fließt über `supplyCaptureDueAt` in `nextEventTime` ein; ruht
   die Arbeit, ist er `Infinity`. Der Fortschritt wird bei jedem Wechsel
   zwischen Arbeiten und Ruhen verbucht – nach demselben Muster wie der Vorrat
   bei `settleSupply`, damit eine geänderte Rate nie rückwirkend gilt. Eine
   **Blockade** ändert nur die Rate und erzeugt keinen neuen Zeitpunkt.
2. **Der Schwellenzeitpunkt** ist pro Fraktion genau ein Ereignis
   (`allyDueAt`), berechnet aus verbuchtem Stand und aktueller Rate. Liefert das
   Lager gerade nicht oder ist der Verbündete bereits erschienen, ist er
   `Infinity` – die Patt-Erkennung („keine Einheit mehr in Bewegung") bleibt
   dadurch voll funktionsfähig und wird nicht von einem endlos tickenden Timer
   ausgehebelt.
3. **Die Schwellenprüfung** rechnet den aufgelaufenen Vorrat auf den aktuellen
   Zeitpunkt fort und prüft ihn – ohne je einen neuen Zeitpunkt zu erzeugen.
4. **Der Verbündete** wird im selben Batch erzeugt, in dem die Schwelle fällt,
   und beginnt seinen Marsch über denselben Weg wie jede respawnte Einheit.
   Seine Kennung ist so gewählt, dass die deterministische Sortierung der
   Angriffe (`attackKey`) eindeutig bleibt.
5. **Kein Zufall.** Wie im übrigen Simulationskern kommt kein `Math.random` vor.

## 8. Auswirkungen

**Positiv**

- Zwei Wegpunkte auf dem Hauptweg bekommen Eigenwert: Sie zu halten lohnt, sie
  zu durchqueren stört den Gegner.
- Die leichte Einheit erhält ihre erste eigene Rolle – der schnelle Läufer
  sichert das Heimlager, bevor die Hauptmacht überhaupt in Position ist.
- Ein zweiter Plan neben der Turmoffensive, mit eigener Zeitachse.
- Das Spiegelduell zweier gleich starker Computergegner bekommt einen
  Symmetriebruch: Wer zuerst am Lager ist, zieht davon.

**Kosten / Risiken**

- **Der Verbündete kann zu stark sein.** Gegenmittel sind eingebaut: Er
  unterliegt dem Boss-Schild, respawnt nicht und braucht einen langen Anmarsch.
- **Der Abstecher kann zu teuer sein** und das System damit tot – dasselbe
  Schicksal wie beim heutigen Friedhofsläufer. Genau deshalb ist die
  Kalibrierung gegen eine lagerlose Strategie Teil der Umsetzung.
- **Mehr Balancing-Fläche.** Vier neue Zahlenwerte, die miteinander wechselwirken.
