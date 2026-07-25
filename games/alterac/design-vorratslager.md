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

Zwei bestehende Kampfpunkte tragen ein **Vorratslager**: der **Steinbruch**
(`en`, Norden) und die **Wolfsschlucht** (`ws`, Süden). Markiert wird das – wie
bei den Türmen – direkt am Wegpunkt in `NODES` (`supply: true`); ein neuer
Knotentyp entsteht nicht. Beide Lager starten **neutral**.

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

Jede Fraktion hat also ein **nahes Heimlager** (billig zu sichern) und ein
**fernes Lager** im Vorfeld des Gegners (teurer, exponierter). Das ist dieselbe
Risiko/Ertrag-Spannung wie bei den Minen des Originals – aber ohne deren
berüchtigten Geometriefehler, bei dem eine Fraktion deutlich weiter laufen
musste als die andere.

**Warum bestehende Kampfpunkte und keine Sackgassen?** Weil genau die
Durchgangsknoten den Eigenwert brauchen. Ein Lager auf dem Hauptweg heißt: Wer
es hält, hält zugleich einen Korridor – und wer durchmarschiert, unterbricht
nebenbei eine fremde Einnahme. Friedhöfe bleiben bewusst Sackgassen; die beiden
Systeme sollen sich unterscheiden.

## 3. Einnahme

Identisch zur Friedhofseinnahme, damit der Spieler keine zweite Regel lernen muss:

- Eine Einheit erreicht das Lager und wartet; die Einnahme beginnt, sobald ihre
  Fraktion **allein vor Ort** ist.
- Sie verlangt **ununterbrochene Präsenz** über `supplyCaptureTime`; mehrere
  eigene Einheiten verkürzen nichts.
- Jede Unterbrechung – Kampf, Verlust der Präsenz – setzt den Fortschritt
  **vollständig auf 0**.
- Nach der Einnahme gehört das Lager der Fraktion, **auch wenn sie abzieht**.
  Die Einheit ist wieder frei; sie muss nicht Wache stehen.
- Rückeroberung ist jederzeit und beliebig oft möglich. Eine Schutzregel wie
  beim Heimatfriedhof gibt es **nicht** – beide Lager sind immer angreifbar.

Der zweite Punkt ist die zentrale Balance-Entscheidung: Ein gehaltenes Lager
kostet **einmalig** Zeit, nicht dauerhaft eine Einheit. Bei vier Einheiten je
Seite wäre ein dauerhaft abgestellter Sammler zu teuer – der Abstecher würde
sich nie lohnen, genau wie heute der Friedhofsläufer.

## 4. Vorrat: stetiger Nachschub

Jede Fraktion führt einen Zähler `supply`, Startwert 0:

> Ein gehaltenes Lager liefert **einen Vorratspunkt je `supplyTickTime`**. Zwei
> Lager verdoppeln die Rate, kein Lager heißt kein Nachschub.

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
| Einnahmedauer | `supplyCaptureTime` | 8 s | Etwas kürzer als beim Friedhof (10 s): Das Lager liegt auf dem Hauptweg und ist deutlich schwerer ungestört zu halten. |
| Takt | `supplyTickTime` | 5 s | Ein Lager liefert 12 Vorrat in 60 s, beide in 30 s. |
| Schwelle | `allySupplyCost` | 12 | Mit einem Heimlager erscheint der Verbündete nach ≈ 70 s inkl. Anmarsch – spät genug, dass die Turmoffensive nicht ausgestochen wird. |
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

1. **Einnahmen** verhalten sich exakt wie Friedhofseinnahmen: Ihr
   Abschlusszeitpunkt (`startedAt + supplyCaptureTime`) fließt in
   `nextEventTime` ein, Start und Abbruch werden am Ende eines Batches
   ausgewertet.
2. **Der Schwellenzeitpunkt** ist pro Fraktion genau ein Ereignis
   (`allyDueAt`), berechnet aus verbuchtem Stand und aktueller Rate. Hält eine
   Fraktion kein Lager oder ist ihr Verbündeter bereits erschienen, ist er
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
