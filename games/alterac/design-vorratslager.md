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

Ein Lager kennt drei Zustände: **inaktiv** (Ausgangslage), **in Betrieb** und
**blockiert**.

**Inbetriebnahme** – nach dem Vorbild der Friedhofseinnahme, damit der Spieler
keine zweite Regel lernen muss:

- Eine Einheit der **Besitzerfraktion** muss das Lager **ausdrücklich als Ziel**
  geplant haben (ihr Pfad endet dort).
- Sie verlangt **ununterbrochene Präsenz** über `supplyCaptureTime`, während die
  eigene Fraktion **allein vor Ort** ist; mehrere eigene Einheiten verkürzen nichts.
- Jede Unterbrechung – Kampf, Verlust der Präsenz – setzt den Fortschritt
  **vollständig auf 0**.
- Danach liefert das Lager **dauerhaft**, auch wenn die Einheit weiterzieht. Sie
  ist wieder frei und muss keine Wache stehen.

Das ist die zentrale Balance-Entscheidung: Ein Lager kostet **einmalig** Zeit,
nicht dauerhaft eine Einheit. Bei vier Einheiten je Seite wäre ein dauerhaft
abgestellter Sammler zu teuer – der Abstecher würde sich nie lohnen, genau wie
heute der Friedhofsläufer.

**Blockade** – der einzige Hebel des Gegners:

- Solange eine **gegnerische** Einheit das Lager **ausdrücklich besetzt** (auch
  ihr Pfad endet dort), liefert es nichts.
- Zieht sie ab oder fällt sie, liefert es **sofort wieder** – die einmal
  erfolgte Inbetriebnahme geht nie verloren.
- Ein bloßer **Durchmarsch blockiert nicht**. Das ist wichtig, weil der
  Anmarschweg des Gegners ohnehin am Lager vorbeiführt: Ohne diese Regel wäre
  der Nachschub permanent durch Zufallsverkehr zerrissen, ohne dass irgendwer
  es beabsichtigt. Dieselbe Unterscheidung gilt schon bei den Türmen, wo bloßes
  Durchqueren keinen Turmkampf auslöst.
- Wer ein gegnerisches Lager besetzt, **hält die Stellung**: Sein Auftrag gilt
  nie als erledigt, er marschiert also nicht von selbst weiter.

Der Unterschied zwischen „ausdrücklich" und „im Vorbeigehen" wirkt genau dort,
wo er soll. Während der Inbetriebnahme steht ohnehin eine eigene Einheit am
Lager – ein ankommender Feind löst dann automatisch einen Kampf aus und
unterbricht, ganz gleich was er vorhatte. Erst im laufenden Betrieb, wenn das
Lager unbewacht ist, entscheidet die Absicht des Gegners.

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
wann sein Verbündeter kommt: mal 55, mal 60 Sekunden nach der Einnahme. Stetiger
Nachschub macht daraus eine feste Zusage – **ein Lager = 60 s bis zum
Verbündeten**, immer.

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

## 6. Zahlenwerte (Startpunkt, im Turnier kalibriert)

| Wert | Schlüssel | Start | Begründung |
| --- | --- | --- | --- |
| Inbetriebnahme | `supplyCaptureTime` | 8 s | Etwas kürzer als die Friedhofseinnahme (10 s): Das Lager liegt auf dem Hauptweg und ist deutlich schwerer ungestört zu halten. |
| Rate | `supplyTickTime` | 5 s | Ein laufendes Lager liefert 12 Vorrat in 60 s. |
| Schwelle | `allySupplyCost` | 12 | Der Verbündete erscheint nach ≈ 70 s inklusive Anmarsch und Inbetriebnahme – spät genug, dass die Turmoffensive nicht ausgestochen wird. |
| Verbündeter | `allyHp` / `allyDamage` / `allyAttackInterval` / `allySpeed` | 60 / 20 / 1,5 s / 1,0 | Kampfwert 800 ≈ 2,4 schwere Einheiten, also ungefähr +50 % auf eine Armee aus vier schweren Einheiten. |

Alle Werte stehen in `config.js` und sind im Erweitert-Menü feinjustierbar; der
Setup-Schalter **„Vorratslager aktiv"** schaltet das ganze System ab
(`supplyEnabled: false`), analog zum Türme-Schalter.

**Kalibrierungsregel:** Die Werte sind dann richtig, wenn ein Computergegner mit
Lagerstrategie gegen einen ohne Lagerstrategie ungefähr ausgeglichen abschneidet.
Gewinnt die Lagerstrategie deutlich, ist der Abstecher zu billig; verliert sie
deutlich, ist er sinnlos. Gemessen wird headless über `createSim`.

## 7. Determinismus

Das ereignisbasierte Zeitmodell bleibt vollständig intakt:

1. **Inbetriebnahmen** verhalten sich exakt wie Friedhofseinnahmen: Ihr
   Abschlusszeitpunkt (`startedAt + supplyCaptureTime`) fließt in
   `nextEventTime` ein, Start und Abbruch werden am Ende eines Batches
   ausgewertet. Eine **Blockade** ändert nur die Rate und erzeugt keinen neuen
   Zeitpunkt – der Vorrat wird beim Zustandswechsel abgerechnet
   (`settleSupply`), bevor die neue Rate gilt.
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
