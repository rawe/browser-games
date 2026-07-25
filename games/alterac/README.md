# Alterac Combat Simulator

Taktik-Autobattler: Beide Seiten werben aus einem Ressourcenbudget eine Armee
an (drei Einheitentypen: leicht, mittel, schwer) und planen geheim für jede
Einheit einen eigenen Pfad durch das Wegpunkt-Netzwerk plus Haltung (Angriff
oder Halten). Danach läuft die Schlacht deterministisch und ohne weitere
Eingriffe ab. Wer den gegnerischen Endboss fällt, gewinnt.

## Module

| Datei        | Aufgabe |
| ------------ | ------- |
| `sim.js`     | Simulationskern (DOM-frei, deterministisch, ereignisbasiert; liefert typisierte Ereignisse für Effekte); verwaltet auch Friedhofsbesitz, Einnahmen, Türme, Vorratslager und den mächtigen Verbündeten |
| `map.js`     | Zentrale Kartenkonfiguration (Wegpunkte, Verbindungen, Friedhöfe samt Startbesitz und Heimat-Markierung, Routen, Wachposten, Turm- und Vorratslager-Standorte), Wegsuche, Friedhofswahl |
| `planner.js` | Planungsphase (Rekrutierung aus dem Budget, Auftragskette je Einheit: Pfad, Haltung und Auslöser pro Auftrag) |
| `ai.js`      | Computergegner: Stufenliste (`AI_LEVELS`) und Auswahl des Planers anhand von `config.aiLevel` |
| `ai-easy.js` | Stufe „Leicht": zufällig gemischte Armee, grobe Marschbefehle |
| `ai-hard.js` | Stufe „Schwer": kampfwertoptimierte Armee, Turmwache, konzentrierte Turmoffensive, Boss-Sturm per Event |
| `render.js`  | Canvas-Rendering: Knoten, Token, Overlays, Wetter (keine Spiellogik) |
| `terrain.js` | Vorgerenderter Landschafts-Hintergrund (Schneetal, Felswände, Wälder, Wege, Lager) |
| `effects.js` | Partikeleffekte (Schadenszahlen, Funken, Geister, Respawn-Säulen, Boss-Sturz) |
| `main.js`    | Bildschirm-Ablauf und Render-Schleife |
| `config.js`  | Einheitentypen sowie alle Kampf- und Zeitwerte |

## Wegpunkt-Netzwerk

Die Karte ist ein konfigurierbares Netzwerk aus Wegpunkten (`NODES`) und
Verbindungen (`EDGES`) in `map.js`. Sie enthält Abzweigungen, zwei
Querverbindungen (Eisfelsklamm–Steinbruch, Wolfsschlucht–Kiefernhang) und zu
jedem Endboss mindestens zwei getrennte Zugänge: das Nordtor und den Eisigen
Grat im Norden, das Südtor und den Schmugglerpfad im Süden.

### Spiegelsymmetrie – die Fairness-Grundlage

Die Karte bildet sich unter der Punktspiegelung Nord↔Süd **vollständig auf sich
selbst ab** (rboss↔bboss, rgate↔sgate, reast↔swest, rgy↔bgy, wn↔es, en↔ws,
gyw↔gye; Feldmitte und Talfriedhof liegen auf der Achse). Alle 23 Verbindungen
sind unter dieser Abbildung invariant, und weil die Reisezeit **pro Wegstück**
zählt (`edgeTime`) statt in Pixeln, sind auch alle Wegstrecken exakt gleich.

Zwei Dinge müssen dafür erhalten bleiben, wenn jemand die Karte erweitert:

1. **Jede Neuerung braucht ihr Spiegelbild.** Ein markierter Wegpunkt (Turm,
   Vorratslager) ist nur dann fair, wenn sein gespiegelter Partner dieselbe
   Markierung für die andere Fraktion trägt.
2. **Die x-Koordinaten müssen exakt gespiegelt bleiben** – die Summe zweier
   gespiegelter Knoten ist immer 480. Der Grund steht im nächsten Abschnitt.
   (Die y-Koordinaten sind nur ungefähr gespiegelt; das ist unerheblich, weil
   Pixel-Abstände die Reisezeit nicht beeinflussen.)

### Die Flankenregel der Wegsuche

Geplante Pfade folgen exakt den gewählten Wegpunkten. Nur wo die Simulation
selbst einen Weg sucht – beim Marsch zum Boss nach abgearbeitetem Pfad und beim
Rückweg nach einem Respawn – muss sie zwischen mehreren **gleich langen** Wegen
wählen. Diese Wahl entscheidet die **Flanke der Fraktion**: Im Zweifel hält sich
eine Einheit rechts, aus Sicht ihrer eigenen Basis in Marschrichtung. Für die
Sturmlanze ist das die Ost-, für den Frostwolf die Westflanke.

Das ist keine Kosmetik, sondern notwendig. Vorher entschied die alphabetische
Ordnung der Knoten-Kennungen – und die überlebt eine Spiegelung nicht, weil sie
die Kennungen paarweise vertauscht. Die Folge war, dass **beide** Fraktionen
durch denselben Korridor marschierten: Eine Flanke wurde zur vielbegangenen
Hauptachse, die andere zum toten Winkel, und Wegpunkte auf der einen Seite waren
systematisch umkämpfter als ihre Spiegelbilder. Mit der Flankenregel ist der Weg
der einen Seite stets das exakte Spiegelbild des Weges der anderen — und ganz
nebenbei führt der Anmarsch jeder Fraktion am Vorratslager des Gegners vorbei.

Dieselbe Regel gilt in `ai-hard.js`, wo gleichwertige Ziele und Routen sonst
über Routennamen oder Knoten-Kennungen aufgelöst würden.

In der Planung baut der Spieler den Pfad jeder Einheit Wegpunkt für Wegpunkt
über benachbarte Punkte auf – es gibt keine automatische Kürzeste-Route-Wahl
für geplante Pfade. Die Wegsuche (`shortestPath`) dient nur noch als
Rückfalllösung: für den automatischen Marsch zum gegnerischen Boss nach
abgearbeitetem Pfad und für den Rückweg nach einem Respawn. Vordefinierte
Routen (`ROUTES`) und Wachposten (`GUARD_POSTS`) sind ebenfalls zentrale
Konfigurationsdaten und werden vom Computergegner genutzt.

## Auftragsketten und globale Events

Jede Einheit arbeitet eine **geordnete Kette von Aufträgen** ab statt nur eines
einzelnen Pfads. Ein Auftrag ist – wie zuvor – ein Pfad benachbarter Wegpunkte
plus Haltung (Angriff/Halten); neu ist ein optionaler **Auslöser** je Auftrag.
So greift eine Einheit z. B. erst Turm A und **dann** Turm B an (ein einzelner
Auftrag konnte nie zwei Türme treffen). Datenmodell und Regeln sind in
`design-aktionen-events.md` beschrieben; die Simulation normalisiert alte Pläne
(`{ path, stance }`) transparent zu einer Ein-Auftrag-Kette.

- **„Dann" (sequenziell, Standard):** Der Auftrag startet, sobald der vorige
  fertig ist (Pfad abgelaufen und ein etwaiger Ziel-Turm zerstört). Der erste
  Auftrag läuft ab Sekunde 0. Kein Event nötig.
- **„Sobald" (Reaktion/Unterbrechung):** Der Auftrag ist an eine **globale
  Bedingung** gekoppelt. Sobald sie wahr wird, wirft die Einheit ihren aktuellen
  Auftrag weg und wechselt zu diesem – am nächsten freien Wegpunkt (nie mitten
  auf einer Kante oder im Nahkampf). Er feuert genau einmal. Eine Einheit
  reagiert **nur** auf Events, für die sie einen „Sobald"-Auftrag besitzt
  (explizites Zuhören).
- **Fallback:** Nach der abgearbeiteten Kette marschiert eine Angriffs-Einheit
  zum gegnerischen Boss, eine „Halten"-Einheit bleibt stehen (unverändert). Der
  Boss-Marsch ist damit der implizite letzte Auftrag.

Die verfügbaren Bedingungen stehen zentral in `config.js` (`EVENT_CONDITIONS`)
und werden von der Simulation rein lesend über den Weltzustand ausgewertet
(`condHolds` in `sim.js`) – deterministisch und ohne neue Zeitpunkte, da sie
sich nur an bestehenden Ereignissen (Turmzerstörung) ändern:

| Bedingung | Subjekt | Auswertung |
| --- | --- | --- |
| **Boss-Schild des Gegners fällt** | – | alle gegnerischen Türme zerstört |
| **Gegnerischer Turm fällt** | ein konkreter Turm (auf der Karte antippen) | dieser Turm zerstört |

Im Planungspanel zeigt jede Einheit ihre Auftragsliste; „➕ Auftrag" hängt einen
weiteren an (Pfad baut ab dem Ende des vorigen weiter auf), pro Auftrag lassen
sich Haltung und – ab dem zweiten – der Auslöser wählen. Braucht eine Bedingung
ein Subjekt („Gegnerischer Turm fällt"), tippt der Spieler den betreffenden
gegnerischen Turm auf der Karte an; die Turm-Identität wird in die Bedingung
eingefroren.

## Computergegner: einstellbare Stärke

Im Setup wird bei **jedem Spielstart** die Stärke des Computergegners gewählt –
das Auswahlfeld erscheint nur im Modus „Gegen den Computer" (im Hotseat gibt es
keinen). Die Auswahl landet als `aiLevel` in der Partie-Konfiguration; `aiPlan`
(`ai.js`) wählt daraus den Planer. Die Stufenliste `AI_LEVELS` (Schlüssel,
Anzeigename, Beschreibung, Planer) ist die einzige Stelle, an der eine neue
Stufe ergänzt wird – die Setup-UI baut Auswahlfeld und Erläuterung daraus.

| Stufe | Verhalten |
| --- | --- |
| **Leicht** (`ai-easy.js`) | Würfelt die Armee aus dem Budget zusammen, stellt ab mittlerer Größe ein bis zwei Wachen ab und schickt den Rest über zwei zufällig gewählte Standardrouten los. Ein Trupp nimmt einen zufälligen neutralen Friedhof, ein bis zwei nehmen gegnerische Türme ins Visier. Keine Auftragsketten, keine Events, keine Abstimmung. |
| **Schwer** (`ai-hard.js`) | Spielt die Mechaniken gezielt aus (siehe unten). Deterministisch: gleiche Einstellungen ergeben denselben Aufmarsch. |

Die harte Stufe leitet ihren Plan vollständig aus den Regeln und den
Kartendaten ab (Wegenetz, Turm-Standorte, Routen, Einheitenwerte) – ohne fest
verdrahtete Knoten-, Typ- oder Fraktionsnamen:

- **Armee:** exakte dynamische Programmierung über das Ressourcenbudget,
  maximiert die Summe der Kampfwerte (Lebenspunkte × Schaden pro Sekunde), bei
  Gleichstand gewinnt die Aufstellung mit mehr Einheiten.
- **Doktrin (Türme oder direkt zum Boss?):** verglichen werden zwei
  Zeitabschätzungen der Angriffsgruppe – der direkte Sturm
  (`bossHp / (Schaden pro Sekunde × durchgelassener Anteil)`) gegen den Umweg
  (Turm-LP je Turm + Umwegstrecke + `bossHp` bei vollem Schaden). Weil der Umweg
  zusätzlich den Fürsten dauerhaft schwächt und der Kampf am ungeschützten Boss
  billiger ist, gilt er bis zum Faktor `TOWER_DETOUR_TOLERANCE` (2, im Turnier
  kalibriert) als lohnend. Beim Standard-Schild (95 %) fällt die Entscheidung
  klar auf die Türme, bei schwach eingestelltem Schild auf den direkten Sturm.
- **Wache:** je angefangene vier Einheiten eine – die zäheste – als eingegrabene
  Wache. Steht der Schild (Doktrin „Türme"), bezieht sie den eigenen Turm, über
  den die meisten gegnerischen Standardrouten führen: Der Turm ist unverwundbar,
  solange sie lebt, und ein stehender Turm hält den Schild. Taugt der Schild
  nichts (schwach eingestellt oder Türme aus), hält sie stattdessen den eigenen
  Boss-Wegpunkt, wo der Fürst samt Flächenschlag mitkämpft. Mehr Wachen als
  Posten stellen sich zusammen.
- **Angriff:** der ganze Rest bleibt zusammen und arbeitet die gegnerischen
  Türme als Auftragskette („Dann") ab – zuerst den Nebenzugang (die wenigsten
  Routen führen dorthin: selten bewacht, und dem Gegner marschiert dort nicht
  seine ausrückende Armee zu Hilfe), danach den Hauptzugang. Nach dem letzten
  Turm greift der reguläre Fallback: Marsch auf den Boss, der dann ungeschützt
  und durch den Turm-Debuff geschwächt ist.
- **Boss-Sturm:** die Wachen tragen einen „Sobald"-Auftrag auf die Bedingung
  *Boss-Schild des Gegners fällt* und stoßen genau in diesem Moment nach.
- **Bewusst weggelassen:** ein eigener Friedhofsläufer. Er steht die volle
  Einnahmedauer still und fehlt der Angriffsgruppe – im Turnier verlor diese
  Variante klar gegen die konzentrierte Aufstellung.

### Belastbarkeit (Headless-Turnier)

Gemessen über 15 Einstellungen (Budgets, Türme an/aus, Boss- und Turmwerte,
Respawn-Takt, Schildstärke), je 120 Partien in Hin- und Rückrunde – insgesamt
1800 Partien je Paarung, gefahren direkt über `createSim` (ohne UI und Rendering):

| Paarung | Siege | Niederlagen | Unentschieden | Ø Dauer |
| --- | --- | --- | --- | --- |
| Schwer gegen Leicht | **92 %** | 2 % | 6 % | 90 s |
| Leicht gegen Leicht | 24 % | 24 % | 52 % | 217 s |
| Schwer gegen Schwer | 3 % | 3 % | 93 % | 263 s |

Keine Einstellung fällt unter 80 % Siege; im Schnitt behält „Schwer" dabei 88 %
der eigenen Boss-Lebenspunkte und zerstört 1,9 der 2 gegnerischen Türme (die
leichte Stufe 0,6). Das Spiegelduell endet fast immer unentschieden – zwei
identische, deterministische Pläne heben sich gegenseitig auf.

Für Entwicklung und Balancing lassen sich die Stufen direkt gegeneinander
antreten lassen: `?test=sim&ai=hard,easy` (blau, rot) startet sofort eine
Schlacht ohne Planungsphase.

## Einheiten und Ressourcen

Jeder Spieler erhält ein konfigurierbares Budget an Ressourcenpunkten und
wirbt damit Einheiten an. Die drei Typen (leicht, mittel, schwer) sind
vollständig datengetrieben in `config.js` (`UNIT_TYPES`) definiert:
Ressourcenkosten, Hitpoints, Schaden pro Angriff, Angriffsintervall,
Bewegungstempo und Token-Darstellung. Simulation, Planung, KI und Rendering
lesen ausschließlich diese Definitionen – neue Typen oder Attribute lassen
sich ergänzen, ohne Kernlogik anzupassen. Jede Einheit ist eigenständig;
Fusionen oder Folgen-Befehle gibt es nicht.

Jede angeworbene Einheit trägt eine fortlaufende **römische Ziffer** (in der
Reihenfolge des Anwerbens je Fraktion). Sie erscheint als Kennzeichen in der
Einheitenliste des Planungspanels und – sobald die Schlacht läuft – im Token-
Kreis der Einheit auf der Karte, sodass Liste und Kampfgeschehen eindeutig
zusammenpassen. Die Ziffer stammt aus `group.ordinal` (gesetzt beim Aufbau der
Trupps in `sim.js`); `toRoman` in `config.js` ist der gemeinsame Formatierer.

Über der Rekrutierung schaltet eine Karteneinstellung die **Ziel-Marker der
übrigen Trupps** ein oder aus (`planner`-State `showTargets`, vom Renderer je
Frame gelesen): eine Marke mit der römischen Ziffer am jeweiligen Zielknoten –
nur das Ziel, nicht der ganze Pfad. So ist auf einen Blick erkennbar, welcher
Turm bereits angegriffen bzw. welcher Friedhof schon eingenommen wird
(Fraktionsfarbe = Angriff, Gold = Halten). Der Pfad der gerade gewählten
Einheit bleibt davon unberührt vollständig sichtbar.

Die Zahlenwerte der Typen (Kosten, Lebenspunkte, Schaden, Angriffsintervall,
Tempo) sind Datei-Defaults und lassen sich – wie die Boss- und Turmwerte – im
Setup je Partie feinjustieren. Das aufklappbare **Erweitert-Menü** zeigt dazu
je Typ eine Gruppe Zahlenfelder (`UNIT_STAT_FIELDS` in `config.js`); die UI
klemmt jede Eingabe auf ihren gültigen Bereich und schreibt das Ergebnis nach
`config.unitStats`. Der **einzige Abrufpunkt** der effektiven Werte ist
`resolveUnitTypes(config)` bzw. `resolveUnitTypeMap(config)`: beide verbinden
die festen Identitätsfelder (Name, Icon, Radius …) mit den – ggf.
überschriebenen – Zahlenwerten und fallen pro fehlendem Wert auf den
Datei-Default zurück. Sim, Planer, KI und Rendering (über die dem Trupp
angehängte `def`) holen ihre Werte ausschließlich hierüber, egal ob Datei-
Default oder Override.

Im Kampf schlägt jede Einheit in ihrem eigenen Angriffsintervall zu und trifft
das schwächste gegnerische Ziel an ihrem Ort (der Boss ist stets das letzte
Ziel). Eingegrabene Verteidiger erleiden nur einen konfigurierbaren Anteil des
Schadens (`entrenchedFactor`). Aktuelle Hitpoints bleiben über Kämpfe hinweg
erhalten; erst der Respawn am Friedhof stellt sie vollständig wieder her.
Der Boss hat eigene Hitpoints, kämpft mit und regeneriert sich nicht.

Zusätzlich führt der Boss einen **Flächen-Gegenschlag** aus: Neben seinem
Einzelangriff trifft er in einem eigenen Takt (`bossAoeInterval`) **alle** gerade
an ihm angreifenden Einheiten gleichzeitig für `bossAoeDamage` Schaden. Der
ausgeteilte Gesamtschaden wächst so mit der Zahl der Angreifer – ein
unkoordinierter Massensturm direkt auf den Boss wird dadurch verlustreich, und
Vorarbeit über Türme und Friedhöfe lohnt sich. Der Flächenschaden unterliegt
demselben Fürsten-Debuff wie der Einzelangriff (jeder zerstörte eigene Turm senkt
ihn, Untergrenze `bossDamageFloor`). Beide Werte stehen zentral in `config.js` und
sind im Erweitert-Menü unter „Boss" feinjustierbar; `bossAoeDamage: 0` schaltet den
Flächenschlag ab.

## Friedhofssystem

Alle Friedhofsdaten sind zentral konfigurierbar: Lage und Verbindungen in
`NODES`/`EDGES`, Startbesitz und Heimat-Markierung in `GRAVEYARDS` (beides
`map.js`), die Einnahmedauer als `graveyardCaptureTime` in `config.js`
(Standard: 10 Sekunden, im Erweitert-Menü unter „Zeiten" einstellbar – ebenso
das Respawn-Intervall `respawnTime`). Der laufende Besitzstand einer
Schlacht lebt im Simulationszustand (`sim.graveyards`).

- **Sackgassen abseits der Hauptwege:** Jeder Friedhof hat genau eine
  Verbindung und liegt nie auf einem Hauptweg zur gegnerischen Basis. Wer
  einen Friedhof will, muss ihn in der Planung explizit in den Pfad einer
  Einheit aufnehmen und Hin- wie Rückweg selbst über Wegpunkte planen; die
  automatische Wegsuche durchquert Friedhöfe nie.
- **Einnahme:** Erreicht eine Einheit einen fremden Friedhof, wartet sie dort
  und die Einnahme beginnt automatisch, sobald ihre Fraktion allein vor Ort
  ist. Sie verlangt ununterbrochene Präsenz über die volle Einnahmedauer;
  mehrere eigene Einheiten verkürzen nichts. Trifft eine gegnerische Einheit
  ein, beginnt ein normaler Kampf – jede Unterbrechung setzt den Fortschritt
  vollständig auf 0 zurück. Nach erfolgreicher Einnahme gehört der Friedhof
  sofort der neuen Fraktion, ist unmittelbar Respawnpunkt und kann beliebig
  oft zurückerobert werden.
- **Basisfriedhof-Schutz:** Jede Fraktion besitzt einen basisnahen
  Heimatfriedhof (`home` in `GRAVEYARDS`). Er ist nur einnehmbar, solange
  seine Fraktion keinen anderen Friedhof mehr kontrolliert; sobald sie wieder
  mindestens einen anderen hält, greift der Schutz erneut (eine laufende
  Einnahme bricht dann ab). Hält der Gegner den Heimatfriedhof bereits, ist
  die Rückeroberung jederzeit erlaubt.
- **Respawn in Wellen:** Der Respawn läuft auf einem **globalen Takt** statt
  pro Einheit: `respawnTime` ist das Intervall zwischen zwei Respawn-Wellen
  (an Spielbeginn verankerte Vielfache). Eine gefallene Einheit wartet bis zur
  nächsten Welle und kehrt dann **gemeinsam** mit allen anderen wartenden
  Gefallenen zurück – so ballen sich Respawns automatisch. Zurück kommen sie
  mit vollen Hitpoints am nächstgelegenen aktuell kontrollierten eigenen
  Friedhof; der Respawnpunkt wird erst im Moment der Welle bestimmt. Danach
  setzt die Einheit ihr aktuell offenes Ziel fort und läuft vom Respawn-Friedhof
  aus den kürzestmöglichen Weg dorthin; die ursprünglich geplante Route wird
  nicht strikt weiterverwendet. Kontrolliert die Fraktion zum Wellenzeitpunkt
  keinen Friedhof mehr, ist kein Respawn mehr möglich – die Einheit ist
  endgültig gefallen.

## Vorratslager und der mächtige Verbündete

Vorbild ist das Original-Alteractal, in dem gesammelte Gegenstände bei einem NPC
abgegeben werden, ein fraktionsweiter Zähler wächst und beim Schwellenwert ein
mächtiger Verbündeter erscheint (Lokholar der Eislord / Ivus der Waldlord).
Übernommen ist das Muster, nicht die Zahlen. Entwurf und Begründungen stehen in
`design-vorratslager.md`.

Jede Fraktion hat **genau ein fest zugeordnetes Vorratslager** an einem
bestehenden Kampfpunkt: der **Steinbruch** gehört dem Frostwolf, die
**Wolfsschlucht** der Sturmlanze (`supply: 'red' | 'blue'` am Wegpunkt in
`map.js`). Ein Lager wechselt **nie** den Besitzer – der Gegner kann es besetzen
und lahmlegen, aber niemals selbst nutzen. Beide Standorte sind Spiegelbilder:
Jede Fraktion erreicht ihr eigenes Lager in zwei, das gegnerische in drei
Wegstücken, und der automatische Marsch führt jede Seite am Lager der anderen
vorbei.

- **Inbetriebnahme:** Ein Lager startet inaktiv. Eine Einheit der Besitzer-
  fraktion muss es **ausdrücklich als Pfadziel** haben und `supplyCaptureTime`
  Sekunden ununterbrochen dort stehen, während ihre Fraktion allein vor Ort ist –
  dieselbe Regel wie bei der Friedhofseinnahme, jede Störung setzt den
  Fortschritt auf 0. Danach liefert das Lager **dauerhaft**, auch wenn die
  Einheit weiterzieht; eine Wache ist nicht nötig.
- **Blockade:** Solange eine gegnerische Einheit das Lager **ausdrücklich
  besetzt** (auch ihr Pfad endet dort), stockt der Nachschub. Zieht sie ab oder
  fällt sie, liefert es sofort wieder – die Inbetriebnahme geht nie verloren.
  Ein bloßer **Durchmarsch blockiert nicht**: Weil der Anmarschweg des Gegners
  ohnehin am Lager vorbeiführt, würde sonst Zufallsverkehr den Nachschub
  permanent zerreißen. Dieselbe Unterscheidung gilt bei den Türmen, wo bloßes
  Durchqueren keinen Turmkampf auslöst. Wer ein gegnerisches Lager besetzt, hält
  die Stellung – sein Auftrag gilt nie als erledigt.
- **Nachschub:** Ein lieferndes Lager bringt einen Vorratspunkt je
  `supplyTickTime`. Der Vorrat läuft **stetig** auf und wird nur bei
  Zustandswechseln verbucht; daraus ist der Moment des Schwellenübertritts exakt
  berechenbar und wird als reguläres Ereignis eingeplant. Ein Lager bedeutet
  damit immer dieselbe, vorhersagbare Wartezeit – unabhängig davon, was sonst
  auf der Karte passiert.
- **Der Verbündete:** Bei `allySupplyCost` wird der Vorrat verbraucht und der
  mächtige Verbündete erscheint am eigenen Boss-Wegpunkt – **Ivus der Waldlord**
  für die Sturmlanze, **Lokholar der Eislord** für den Frostwolf. Er marschiert
  über den regulären Fallback selbstständig zum gegnerischen Boss, kämpft
  unterwegs wie jede andere Einheit, ist tötbar und **respawnt nicht**. Je
  Fraktion und Partie erscheint höchstens einer. Der Boss-Schild gilt auch für
  ihn: Er ersetzt die Turmarbeit nicht, er beschleunigt sie.

Anders als im Original sind beide Verbündete **exakt gleich stark** – dort ist
Lokholar schwächer, wächst aber mit jedem Kill, während Ivus stark startet und
nicht skaliert. Diese Asymmetrie ist bewusst nicht übernommen.

Alle Werte (`supplyCaptureTime`, `supplyTickTime`, `allySupplyCost`, `allyHp`,
`allyDamage`, `allyAttackInterval`) stehen in `config.js` und sind im
Erweitert-Menü feinjustierbar; der Setup-Schalter **„Vorratslager aktiv"**
schaltet das System ganz ab (`supplyEnabled: false`).

## Türme

Beide Fraktionen besitzen gleich viele Wachtürme (MVP-Standard: 2 pro Fraktion)
an markierten **bestehenden** Wegpunkten – den je zwei Boss-Zugängen. Der
Standort steht unmittelbar in der Knotenkonfiguration: Der jeweilige Wegpunkt in
`NODES` (`map.js`) trägt eine `tower: 'red' | 'blue'`-Markierung; das Wegesystem
selbst wird dafür nicht erweitert. Türme platziert die Karte, nicht der Spieler. Ein Turm ist eine ortsfeste Kampfeinheit mit
eigenen Werten (maximale Hitpoints, Angriffsschaden, Angriffsintervall,
Fraktion); er bewegt sich nicht, regeneriert nicht und respawnt nicht.

- **Ausdrücklicher Angriff:** Ein Turmkampf beginnt nur, wenn der Pfad einer
  Angriffs-Einheit ausdrücklich auf dem gegnerischen Turm endet. Bloßes Betreten
  oder Durchqueren des Wegpunkts aktiviert den Turm nicht – eine Einheit
  passiert einen Turm-Wegpunkt also normal.
- **Verteidigung:** Eigene Einheiten können den eigenen Turm mit „Halten"
  ausdrücklich verteidigen (normaler Verteidigungsmodus samt bestehender
  Schadensreduktion). Solange mindestens ein Verteidiger lebt, erleidet der Turm
  keinen Schaden; der Turm greift die Angreifer währenddessen durchgehend mit
  seinen normalen Werten an. Erst nach dem Fall aller Verteidiger trifft der
  Angriff den Turm direkt – ohne zusätzlichen Verteidigungsbonus, ohne weitere
  Schadensreduktion und ohne Verstärkung durch Verteidiger.
- **Zerstörung & Fürsten-Debuff:** Auf 0 Hitpoints reduziert, ist ein Turm für
  den Rest der Partie dauerhaft zerstört. Jeder zerstörte Turm senkt dauerhaft
  den Angriffsschaden des zugehörigen Fürsten – stets berechnet auf dessen
  **Basiswert**, nie auf den bereits reduzierten Wert (bei zwei Türmen empfohlen:
  −25 % pro Turm, Untergrenze 50 % des Basiswerts).
- **Boss-Schutz durch stehende Türme:** Solange eine Fraktion noch **mindestens
  einen** Turm besitzt, blockt ihr Boss den prozentualen, konfigurierbaren Anteil
  `bossTowerShield` des Schadens und erleidet nur `1 − bossTowerShield` (Standard
  `0.95` → es kommen noch 5 % durch). Sind **alle** Türme des Gegners gefallen,
  fällt der Schild auf 0 % und der Boss erleidet vollen Schaden. So lässt sich der
  Boss nicht ungestraft direkt niederrennen, ein normaler Angriff nach dem Turmfall
  bleibt aber möglich. Weil jeder Zugang zum Boss ohnehin an einem eigenen Turm
  vorbeiführt, ist der Schutz auch geografisch stimmig. Ohne Türme
  (`towersPerFaction: 0`) greift er nie. Der Renderer zeigt den Schutz als
  schimmernde Schild-Kuppel über der Festung; vom Schild geschluckte Treffer blitzen
  als Schild-Ring auf (statt einer Schadenszahl).

Alle Turmwerte, die Turmanzahl (`towersPerFaction`), die Schadensreduktion je
Turm (`towerDamageReduction`), die Mindestschadensgrenze des Fürsten
(`bossDamageFloor`) sowie der prozentuale Boss-Schutz (`bossTowerShield`)
stehen zentral in `config.js`. Im Setup lassen sich die
Türme über den Schalter **„Türme aktiv"** ganz an- oder abschalten (aus =
`towersPerFaction: 0`); ihre Kampfwerte samt Fürsten-Debuff sind – wie die
Boss-Werte – im aufklappbaren **Erweitert-Menü** als Zahlenfelder feinjustierbar
(siehe `CONFIG_SECTIONS` in `config.js`). Der Renderer visualisiert
die Fraktion eindeutig (in der Fraktionsfarbe getönter Turmkörper samt Banner
und Basisring), die aktuellen Hitpoints (Balken), den laufenden Turmkampf
(Kampfring) und den zerstörten Zustand (dunkle, rissige, rauchende Ruine).

## Begegnungskämpfe auf Wegstücken

Kämpfe finden nicht nur an Wegpunkten statt: Treffen sich verfeindete
Einheiten auf demselben Wegstück, stoppen sie am exakten Treffpunkt und
kämpfen dort im offenen Feld.

### Regeln

- **Entgegenkommende Gegner** auf derselben Kante treffen sich am rechnerisch
  exakten Punkt; da Einheitentypen unterschiedlich schnell sein können, ergibt
  sich der Treffpunkt aus den linearen Bewegungen beider Seiten. Auch eine
  schnellere Einheit, die eine langsamere gegnerische auf derselben Kante
  einholt, stellt sie zum Kampf.
- **Nachrücker greifen ein:** Jede Einheit, die den Treffpunkt eines laufenden
  Kampfs erreicht – egal aus welcher Richtung und welcher Fraktion –, wird
  Teil dieses Kampfs.
- **Offenes Feld:** Es gibt keinen Verteidigungsbonus und keinen Boss. Beide
  Seiten schlagen in ihren gewohnten Angriffsintervallen zu (schwächstes Ziel
  zuerst). Der Bonus für eingegrabene Verteidiger bleibt Wegpunkten
  vorbehalten – Halten bleibt dadurch als Befehl attraktiv.
- **Sieger ziehen weiter:** Überlebende setzen ihre unterbrochene Bewegung ab
  dem Treffpunkt fort, mit unveränderter Richtung, Befehlskette und ihren
  restlichen Lebenspunkten. Es gibt keinen Rückzug.
- **Gefallene** zählen zum näher gelegenen Endknoten des Wegstücks und
  respawnen wie gewohnt am nächstgelegenen eigenen Friedhof.
- **Treffen exakt an einem Knoten** (Treffpunkt fällt mit einer Ankunft
  zusammen) wird nicht als Feldkampf gewertet – dort greift der normale
  Knotenkampf. So entstehen nie zwei konkurrierende Kämpfe am selben Ort.

### Warum das Spielprinzip intakt bleibt

Die Planung bleibt vollständig im Voraus: Niemand kann ausweichen oder
umgelenkt werden, Pfade bleiben exakt so gültig wie geplant. Sich kreuzende
Routen sind ein taktisches Element – wer den Korridor des Gegners spiegelt,
riskiert eine offene Feldschlacht statt eines freien Durchmarschs. Abfangen,
Timing, Truppenzusammenstellung und Routenwahl entscheiden die Schlacht.

### Deadlock-Betrachtung

Die Simulation ist ereignisbasiert (`nextEventTime` liefert den nächsten
relevanten Zeitpunkt). Damit sie nie hängen bleibt, gilt:

1. **Jeder Kampf endet garantiert.** Jede kämpfende Einheit hat ein endliches
   Angriffsintervall und positiven Schaden; die Summe der Lebenspunkte der
   Beteiligten sinkt also streng monoton – nach endlich vielen Angriffen ist
   eine Seite (oder beide gleichzeitig) vollständig gefallen. Ein ewiges Patt
   im Stand ist unmöglich.
2. **Kampfende gibt die Bewegung frei.** Sobald eine Seite fällt, wird der
   Kampf aufgelöst und alle Überlebenden werden wieder zu normalen bewegten
   Einheiten. Es gibt keinen Zustand, aus dem eine Einheit nicht mehr
   herauskommt; bei beidseitiger Auslöschung respawnen beide Seiten regulär.
3. **Begegnungen sind vollwertige Ereignisse.** Treffzeitpunkte und das
   Erreichen laufender Kämpfe fließen in `nextEventTime` ein. Die
   Patt-Erkennung („keine Einheit mehr in Bewegung") und das Zeitlimit
   funktionieren dadurch unverändert.
4. **Gleichzeitigkeit ist deterministisch geregelt.** Mehrere Paare, die sich
   im selben Moment am selben Punkt treffen, werden zu einem einzigen Kampf
   zusammengefasst (Fixpunkt-Schleife in `processEncounters`); am selben
   Punkt existiert nie mehr als ein Kampf. Alle Angriffe desselben Zeitpunkts
   werden in fester, reproduzierbarer Reihenfolge verrechnet, Gefallene erst
   danach entfernt – gleiche Pläne ergeben immer denselben Schlachtverlauf.
5. **Zyklen über Respawns beendet das Zeitlimit.** Spiegelbildliche Pläne
   können dazu führen, dass sich Einheiten nach jedem Respawn erneut
   gegenseitig auslöschen. Solche Schleifen sind gewollt möglich und werden
   wie bisher durch `maxTime` als Unentschieden aufgelöst.
6. **Friedhöfe erzeugen nur endliche Ereignisse.** Laufende Einnahmen fließen
   mit ihrem Abschlusszeitpunkt in `nextEventTime` ein. Einheiten, die an
   einem (noch) geschützten Friedhof warten, sowie endgültig gefallene
   Einheiten ohne Respawn-Friedhof erzeugen keine Ereignisse mehr – solche
   Stellungen enden wie bisher über die Patt-Erkennung oder das Zeitlimit.
