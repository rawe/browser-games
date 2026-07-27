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
| `plans.js`   | Aufmärsche sichern, teilen und laden (DOM-frei: Teilen-Code, Prüfung gegen Karte und Partie, Bibliothek im `localStorage`) |
| `ai.js`      | Computergegner: Stufenliste (`AI_LEVELS`) und Auswahl des Planers anhand von `config.aiLevel` |
| `ai-easy.js` | Stufe „Leicht": zufällig gemischte Armee, grobe Marschbefehle |
| `ai-hard.js` | Stufe „Schwer": kampfwertoptimierte Armee, Turmwache, konzentrierte Turmoffensive, Boss-Sturm per Event |
| `render.js`  | Canvas-Rendering: Knoten, Token, Overlays, Wetter (keine Spiellogik) |
| `sprites.js` | Porträt- und Gebäude-Atlanten aus `assets/` laden und Zellen ausgeben |
| `terrain.js` | Landschafts-Hintergrund: gemaltes Talbild `assets/valley.webp` plus Wege, prozedurale Fassung als Rückfall |
| `effects.js` | Partikeleffekte (Schadenszahlen, Funken, Geister, Respawn-Säulen, Boss-Sturz) |
| `report.js`  | Schlachtbericht: rohe Bilanzzahlen der Simulation zu einer fertigen Auswertung verdichten (DOM-frei) |
| `result.js`  | Ergebnisbildschirm: Bericht als Blatt über der Karte, samt Sichern und Teilen des Aufmarschs |
| `main.js`    | Bildschirm-Ablauf, Render-Schleife und das Panel der Simulation (Boss-HUD mit Schild und Vorrat, Ticker) |
| `config.js`  | Einheitentypen sowie alle Kampf- und Zeitwerte |

## Wegpunkt-Netzwerk

Die Karte ist ein konfigurierbares Netzwerk aus Wegpunkten (`NODES`) und
Verbindungen (`EDGES`) in `map.js`. Sie enthält Abzweigungen, zwei
Querverbindungen (Eisfelsklamm–Steinbruch, Wolfsschlucht–Kiefernhang) und zu
jedem Endboss mindestens zwei getrennte Zugänge: das Nordtor und den Eisigen
Grat im Norden, das Südtor und den Schmugglerpfad im Süden.

### Der Hintergrund kennt das Wegenetz nicht

Der Untergrund ist ein gemaltes Talbild, `assets/valley.webp` (960×1920, also
doppelte Kartenauflösung). Es enthält bewusst **weder Wege noch Wegpunkte**:
Beides steht in `NODES`/`EDGES` und darf sich ändern – ein mitgemaltes Wegenetz
wäre beim nächsten verschobenen Wegpunkt falsch. Gemalt ist nur, was darunter
liegt: Felsflanken, Bäche, Wälder, Feldlager, Lichtstimmung. Die Wege zeichnet
weiterhin `drawRoad` entlang `edgePoint`, die Knoten der Renderer.

Damit das trägt, hält das Bild seine offene Talmitte frei – nichts Hohes,
nichts Kontrastreiches zwischen den Felsflanken. Wer das Bild ersetzt, muss
diese Eigenschaft erhalten, sonst steht irgendwann ein gemalter Baum unter
einem Turm.

`paintTerrain` schaltet zwischen zwei Fassungen um: mit Bild zwei Lagen (Tal,
Wege darüber), ohne Bild die vollständige prozedurale Landschaft, die es vorher
gab und aus der das Talbild entstanden ist. Der Rückfall greift beim ersten
Frame wie bei einem fehlgeschlagenen Ladevorgang; `onValleyReady` stößt das
einmalige Neurastern an, wenn das Bild nachträglich eintrifft.

#### Die Hintergrundebene muss nachrasterbar bleiben

Tal und Wege liegen zusammen auf einer **einmal** gerasterten Offscreen-Leinwand
(`bg` in `render.js`), die danach je Bild nur noch kopiert wird. Das ist der
Grund, warum der Hintergrund überhaupt bezahlbar ist – und zugleich eine
Annahme, die kein Browser garantiert: Mobile Browser dürfen die Zeichenfläche
einer nicht sichtbaren Leinwand verwerfen, wenn die App in den Hintergrund geht
(Speicherdruck, Neustart des GPU-Prozesses, Rückkehr aus dem bfcache).

Die sichtbare Leinwand übersteht das, weil sie jedes Bild neu entsteht. Die
kopierte nicht: Sie bliebe für den Rest der Sitzung leer, und die Karte zeigte
Knoten und Token auf schwarzem Grund – ohne Gelände, ohne Wege. Genau so gemeldet
für Firefox auf Android (Issue #34).

Deshalb rastert `main.js` die Ebene neu, sobald die Seite wieder sichtbar wird
(`visibilitychange` und `pageshow`, jeweils im nächsten Frame). Wer künftig
weitere Ebenen vorrastert, muss sie an denselben Punkt hängen – eine einmal
gemalte Leinwand bleibt nicht von selbst gemalt.

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

## Aufmärsche sichern, teilen und laden

Einen Aufmarsch Wegpunkt für Wegpunkt aufzubauen ist Arbeit – sie soll nicht bei
jeder Revanche von vorn anfangen. Das Symbol 💾 in der Kopfzeile des
Planungspanels öffnet dafür die Bibliothek als **eigenen Layer** über der
Planung (`plans.js` ist die DOM-freie Logik, die UI dazu sitzt in `planner.js`,
das Layer-Gerüst als `#plan-overlay` in `index.html`). Der Layer ist bewusst kein
Panel-Abschnitt: Panel und Karte teilen sich eine Bildschirmhöhe, und eine
gefüllte Liste hatte dort keinen Platz, ohne die Einheitenliste zu verdrängen.
Im Layer bekommt sie den ganzen Raum und scrollt für sich; geschlossen wird per
✕, Klick auf den Hintergrund oder Escape.

- **Zuletzt gespielt:** Jeder bestätigte Aufmarsch wird ohne Zutun gemerkt und
  steht in der Liste ganz oben. Eine Revanche beginnt damit nie bei null.
- **Bibliothek:** Benannte Einträge (bis zu 20 je Fraktion) im `localStorage`
  unter dem Schlüssel `alterac.plans.v1`. Jede Zeile nennt Einheitenzahl,
  Budget, aktive Teilsysteme und Datum. Laden ersetzt die ganze Aufstellung,
  schließt den Layer und lässt sich einstufig zurücknehmen – die Meldung dazu
  steht dann im Panel, also dort, wohin der Blick geht.
- **Teilen-Code:** „🔗 Eigenen Aufmarsch als Link kopieren" erzeugt eine URL mit
  `?plan=<code>`; ein solcher Link (oder der nackte Code) lässt sich im selben
  Feld wieder einlesen. Ein Aufmarsch aus drei Einheiten ist so rund 20 Zeichen
  lang. Der Link wird beim ersten Planungsbildschirm eingelöst.

Drei Regeln halten das Ganze zusammen:

1. **Ein Plan gehört zu genau einer Fraktion.** Er trägt sie im Code mit sich und
   wird auf der Gegenseite abgelehnt statt umgerechnet: Seine Pfade beginnen an
   der eigenen Basis und zielen auf die gegnerischen Türme.
2. **Die Partie-Einstellungen kommen nie aus einem Plan.** Budget, Türme und
   Vorratslager wählt weiterhin das Setup; ein geladener Plan wird stattdessen
   dagegen **geprüft** (`validatePlan`). Was nicht mehr passt, fällt heraus –
   Einheiten über dem Budget, Pfade über nicht mehr vorhandene Verbindungen,
   Turm-Auslöser in einer Partie ohne Türme – und der Spieler bekommt es als
   Klartext zu lesen, statt es erst in der Schlacht zu bemerken.
3. **Die Bibliothek zeigt nur die eigene Fraktion.** Im Hotseat sitzen beide
   Spieler am selben Gerät; eine gemischte Liste wäre ein Blick in die geheime
   Planung der Gegenseite.

Der Code ist bewusst kein Base64 von JSON, sondern ein kurzes Format aus
unreservierten Zeichen (`0-9 a-z . _ ~`), das ohne Prozent-Kodierung durch jede
URL passt und sich von Hand lesen lässt. Typen, Bedingungen und Wegpunkte stehen
darin als Index ihrer zentralen Listen – kurz, aber verschiebbar, sobald jemand
die Karte erweitert. Deshalb trägt jeder Code einen Fingerabdruck dieser Listen:
Passt er nicht, wird der Code abgelehnt, statt still einen falschen Plan zu
erzeugen.

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
Schlacht ohne Planungsphase, `?test=result&ai=hard,easy` rechnet sie in einem
Zug durch und zeigt nur den Ergebnisbildschirm.

## Einheiten und Ressourcen

Jeder Spieler erhält ein konfigurierbares Budget an Ressourcenpunkten und
wirbt damit Einheiten an. Die drei Typen (leicht, mittel, schwer) sind
vollständig datengetrieben in `config.js` (`UNIT_TYPES`) definiert:
Ressourcenkosten, Hitpoints, Schaden pro Angriff, Angriffsintervall,
Bewegungstempo und Token-Darstellung. Simulation, Planung, KI und Rendering
lesen ausschließlich diese Definitionen – neue Typen oder Attribute lassen
sich ergänzen, ohne Kernlogik anzupassen. Jede Einheit ist eigenständig;
Fusionen oder Folgen-Befehle gibt es nicht.

### Porträts

Jedes Token zeigt ein gemaltes Bruststück: `assets/units/units.webp` ist ein
Atlas aus acht Zellen à 128 px – vier Typen (leicht, mittel, schwer,
Verbündeter) mal zwei Fraktionen. Die Zellkoordinaten stehen in
`units.json` und werden von `sprites.js` an genau zwei Stellen ausgegeben: als
Bildausschnitt für den Canvas (`unitSprite`, gezeichnet in `drawToken`) und als
Spalte/Zeile für den CSS-Hintergrund der Aufstellungsliste (`spriteCell`,
`.chip-pic` in `style.css`). Beide Wege benutzen denselben Zuschnitt
(`PORTRAIT_ZOOM`/`PORTRAIT_SHIFT` in `render.js`), damit Liste und Schlachtfeld
dasselbe Gesicht zeigen.

Drei Punkte, die den Umgang damit bestimmen:

- **Die Fraktionsfarbe steckt nicht in der Grafik.** Die Zellen sind
  freigestellt; der Kreis darunter liefert den Farbverlauf. Deshalb reichen acht
  Zellen, deshalb bleibt Blau gegen Rot auf einen Blick unterscheidbar – und
  deshalb dürfen künftige Porträts nie flächig in Fraktionsfarbe gemalt sein.
- **Die Grafik ist Kosmetik.** Lädt der Atlas nicht, zeichnet `drawToken` das
  frühere Kreis-Token mit Kurzzeichen. Es gibt keinen Ladebildschirm und keinen
  Zustand, in dem das Spiel auf ein Bild wartet.
- **Die römische Ziffer sitzt auf einem Band am unteren Kreisrand**, nicht mehr
  in der Mitte – dort läge sie im Gesicht. Das Band ist ins Kreissegment
  geschnitten und ragt darum nie über das Token hinaus.

Die WebP ist verlustlos (`VP8L`) und damit selbst das Original – ein PNG
daneben wäre dieselbe Pixelmenge in größer. Die hochauflösenden Ausgangsblätter
liegen bewusst nicht im Repo.

### Gebäude: Ebenen statt Standbild

Burg und Wachturm kommen aus `assets/buildings.webp` (1024×1024, sechzehn Zellen
à 256 px) mit `buildings.json` daneben. Je Bautyp und Fraktion liegen dort drei
Ebenen – `body`, `glow`, `ruin` – dazu je Fraktion ein Fahnentuch.

Der Schnitt hat einen Grund: **Ein Standbild würde die Animationen töten.** An
Burg und Turm hängen wehende Fahne, flackerndes Fensterlicht, Feuerschalen,
Schutzkuppel und Rauch. Animierte Sprite-Sheets generieren zu lassen scheitert
an der Frame-Kohärenz – Frame 2 wäre eine andere Burg als Frame 1. Also wird
nur das unbewegte Mauerwerk gemalt, und der Code bewegt weiterhin alles, was
sich bewegt:

- `glow` ist eine reine Leuchtmaske und wird additiv mit derselben
  Flackerfunktion darübergelegt, die früher die gezeichneten Schießscharten
  pulsieren ließ (`0,55 + 0,45·sin(anim·9)`).
- Das Fahnentuch ist flach und ungewellt gemalt. `drawBannerCloth` zerlegt es in
  achtzehn senkrechte Streifen und versetzt sie mit dem Wellenprofil aus
  `traceFlag` – dieselbe Bewegung wie vorher, nur auf gemaltem Tuch statt auf
  einem Farbverlauf. Der Schwalbenschwanz steckt als Transparenz im Bild.
- Feuerschalen, Schutzkuppel, Lebensbalken, Bodenschatten, Kampfring,
  Fraktions-Basisring und Rauch sind unverändert Code.

Damit `body`, `glow` und `ruin` deckungsgleich liegen, teilen alle Zellen eines
Bauwerks Zellgröße und Ankerpunkt; `buildingLayout` rechnet den Maßstab **immer
aus der `body`-Ebene** und benutzt ihn für alle drei. Die Leuchtmaske wurde beim
Erzeugen nicht gemalt, sondern per Schwellwert aus dem fertigen Body gezogen –
Deckungsgleichheit per Konstruktion.

`anchor` aus der JSON ist der Punkt, der auf dem Wegpunkt landet: bei Gebäuden
die Mitte der Standfläche, beim Banner die Mastseite oben. Deshalb steht die
Ruine auf derselben Linie wie der heile Bau, obwohl sie niedriger ist.

`KEEP_WIDTH`/`TOWER_WIDTH` in `render.js` sind nach oben begrenzt: Über dem
Bauwerk hängen noch Mast, Fahne und Lebensbalken, und die nördliche Burg steht
bei y = 78. Ein größerer Bau schöbe ihren Lebensbalken aus der Karte.

Fehlt der Atlas, zeichnen `drawKeepVector` und `drawTowerVector` die frühere
Fassung vollständig – inklusive der Laufzeit-Fraktionstönung des Turmsteins
(`mixHex`), die die gemalten Türme nicht mehr brauchen.

### Porträts der Bosse

Die beiden **Bosse** haben ihren eigenen Atlas `assets/units/bosses.webp`: zwei
Zellen à 256 px, Spalte 0 Sturmlanze, Spalte 1 Frostwolf. Er kommt ohne JSON
aus – mit einer Zelle je Fraktion ist die Aufteilung abschließend, es gibt keine
dritte Seite, um die er wachsen könnte.

Auf dem Canvas erscheinen die Porträts **nicht**. Beide Abnehmer sind HTML und
holen die Grafik über das Stylesheet aus derselben Zelle: das **Boss-HUD** der
Simulation (`.boss-pic`) und das Sieges-Overlay (`.overlay-boss`). Den
gemeinsamen Zuschnitt hält `.boss-portrait` – er entspricht dem der
Canvas-Tokens (`PORTRAIT_ZOOM`/`PORTRAIT_SHIFT`), damit Karte, HUD und Overlay
dieselben Gesichter gleich beschnitten zeigen. Die doppelte Zellgröße bleibt
nötig, weil das Overlay das Porträt groß zeigt.

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

Die ganze Mechanik steht auf **einer** Regel: Auf ein Lager wirkt nur, wer es
**ausdrücklich als Pfadziel** plant – für die Inbetriebnahme wie für die
Blockade. Wer bloß durchmarschiert, tut beides nicht. Das ist entscheidend, weil
der Anmarschweg ohnehin an den Lagern vorbeiführt: Zählte bloße Anwesenheit,
zerstörte reiner Zufallsverkehr jede Inbetriebnahme, ohne dass der Gegner es
beabsichtigt oder etwas dafür bezahlt hätte. Störung soll eine Entscheidung
sein, die eine Einheit bindet. (Dieselbe Unterscheidung gilt bei den Türmen, wo
bloßes Durchqueren keinen Turmkampf auslöst.)

- **Inbetriebnahme:** Ein Lager startet inaktiv. Eine Einheit der Besitzer-
  fraktion muss es **ausdrücklich als Pfadziel** haben und `supplyCaptureTime`
  Sekunden daran arbeiten. Aufhalten kann sie nur ein Gegner, der das Lager
  seinerseits ausdrücklich besetzt. **Der Fortschritt verfällt dabei nie** – er
  ruht. Fällt der Läufer, setzt der nächste dort fort, wo dieser aufhörte;
  `supplyCaptureTime` heißt „so viele Sekunden insgesamt", nicht „am Stück".
  Danach liefert das Lager **dauerhaft**, auch wenn die Einheit weiterzieht;
  eine Wache ist nicht nötig.
- **Blockade:** Solange eine gegnerische Einheit das Lager **ausdrücklich
  besetzt**, stockt der Nachschub. Zieht sie ab oder fällt sie, liefert es
  sofort wieder – die Inbetriebnahme geht nie verloren, der bereits gesammelte
  Vorrat auch nicht. Wer ein gegnerisches Lager besetzt, hält die Stellung –
  sein Auftrag gilt nie als erledigt.
- **Das Gegenmittel:** Wer den Läufer erschlägt, hält die Inbetriebnahme an –
  sie verliert nur nichts mehr. Ein laufendes Lager stillzulegen kostet dagegen
  dauerhaft eine abgestellte Einheit. Beides ist eine Entscheidung mit Preis.
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

**Zeitrechnung:** `supplyCaptureTime` + `allySupplyCost × supplyTickTime` ergibt
die Gesamtdauer ab Eintreffen des Läufers – im Standard **6 s + 10 × 4 s = 46 s**.
Sie ist der eigentliche Balancing-Hebel: Liegt sie zu nah an der Partiedauer,
kommt der Verbündete zu spät, um noch etwas zu bedeuten.

Alle Werte stehen in `config.js` und sind im Erweitert-Menü feinjustierbar,
aufgeteilt auf zwei Sektionen:

| Sektion | Werte |
| --- | --- |
| **Vorratslager** | `supplyCaptureTime` (Inbetriebnahme), `supplyTickTime` (Nachschub je Vorrat), `allySupplyCost` (Vorrat für Verbündeten) |
| **Mächtiger Verbündeter** | `allyHp`, `allyDamage`, `allyAttackInterval`, `allySpeed` – dieselben Größen wie bei den anwerbbaren Einheitentypen, nur ohne Kosten: Er wird nicht gekauft, sondern über den Vorrat verdient. |

Der Setup-Schalter **„Vorratslager aktiv"** schaltet das System ganz ab
(`supplyEnabled: false`) und graut beide Sektionen aus.

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

## Boss-HUD: beide Fürsten immer im Blick

Während der Schlacht steht im Panel **eine Zeile je Fraktion** – rot oben, blau
unten wie die Festungen auf der Karte. Sie trägt alles, was zu dieser Seite zu
wissen ist: Porträt und Name des Fürsten, seine Lebenspunkte und darunter zwei
Messwert-Zeilen für Schild und Vorrat. Gebaut und je Bild aktualisiert wird das
in `main.js` (`bossBoardMarkup`/`updateBossBoard`).

Drei Entscheidungen dahinter:

- **Es sitzt im Panel, nicht über der Karte.** Auf einem Telefon zeigt der
  Kartenausschnitt nie beide Festungen gleichzeitig; wer einen Turmkampf in der
  Mitte verfolgt, verlöre den Stand der Schlacht genau dann aus dem Blick, wenn
  er zählt. Im Panel verdeckt der Block zu keinem Zeitpunkt Gelände, und das
  Karten-Scrollen berührt ihn nicht.
- **Eine Zeile je Fraktion, nicht ein Kasten je Thema.** Der Vorrat stand vorher
  als eigener Block darunter – zweimal dieselben zwei Fraktionen untereinander,
  jede mit eigener Namenszeile und eigener Lagerzustandszeile. Zusammengelegt
  kostet der Vorrat nur noch eine Messwert-Zeile, und die Karte bekommt den
  gewonnenen Platz.
- **Die Porträts sind die früheren Medaillons.** Sie standen rechts neben der
  Festung, also nur dort, wo der Boss ohnehin steht. Der Renderer zeichnet sie
  nicht mehr; auf der Karte tragen den Boss weiterhin Festung, Banner,
  Lebensbalken und Schutzkuppel. Fehlt der Bossatlas, entfällt im HUD allein
  das Bild – die Zeile trägt ihre Werte auch ohne Gesicht.

**Jede Messwert-Zeile hängt an ihrem Teilsystem.** Die Schildzeile erscheint nur,
wenn sie etwas bedeutet: ohne Türme (`towersPerFaction: 0`) oder bei
`bossTowerShield: 0` – Türme, die nichts blocken – entfällt sie. Die
Vorratszeile erscheint nur, wenn die Partie Lager hat (`supplyEnabled`). Sind
beide aus, bleibt die Fraktionszeile bei Porträt, Name und Lebensbalken; das
Zeilen-Grid kommt dann ohne den Messwert-Block aus
(`.boss-row:not(:has(.boss-meters))`).

**Der Schildbalken speist sich aus den Turm-Lebenspunkten, nicht aus
`sim.bossShield`.** Letzteres ist ein Schalter: voller Schutz, solange irgendein
eigener Turm steht – null, sobald der letzte fällt. Ein Balken daraus stünde bis
zuletzt voll und spränge dann. Die Summe der Rest-LP aller eigenen Türme sinkt
dagegen stetig, während am Turm gekämpft wird, und erreicht 0 in genau dem
Moment, in dem der Schild bricht. Unter einem Viertel Restkraft pulsiert der
Balken deutlicher (`SHIELD_WEAK`), bei `prefers-reduced-motion` nicht.

**Die Vorratszeile trägt Zustand und Fortschritt zugleich.** Der Balken zeigt den
Stand zur Schwelle, Symbol und Farbe den Zustand des eigenen Lagers: `⬡` inaktiv
(gedämpft), `⬢` liefert, `⚠` blockiert (orange – die einzige Warnung, die
auffallen soll). Ist der mächtige Verbündete erschienen, wechselt die Zeile auf
Gold und nennt statt der Zahlen seinen Namen. Der Lagername steht nicht mehr
dabei: Jede Fraktion hat genau ein fest zugeordnetes Lager, der Name ist also
eine Konstante und kostete nur Breite.

Der **Ticker** darunter ist der Puffer des Panels – das einzige Element, das
nachgibt. Er belegt genau so viel, wie seine höchstens drei Meldungen brauchen
(nach oben auf 3,6 rem gedeckelt, ohne Vorratsreserve, die zu Beginn als leeres
Feld über der ersten Meldung stünde). Reicht die Bildschirmhöhe nicht – kleines
Gerät, beide Messwerte aktiv –, schrumpft er unter seinen Inhalt und hängt dabei
an der Unterkante: Die neueste Meldung bleibt stehen, oben fallen die ohnehin
ausgeblichenen ältesten weg.

## Der Ergebnisbildschirm

Der Spieler greift während der Schlacht nie ein. Der Ergebnisbildschirm ist
damit die **einzige** Stelle, an der er erfährt, was sein Plan getaugt hat –
und der Ort, an dem die nächste Planung anfängt. Er sagt deshalb nicht nur, wer
gewonnen hat, sondern beantwortet drei Fragen der nächsten Partie:

| Frage | Kennzahl |
| --- | --- |
| War die Armee richtig zusammengestellt? | Schaden je Ressourcenpunkt, je Einheit |
| Waren die Ziele richtig? | Türme gefällt, am Schild verpufft, Friedhöfe, Vorrat |
| Hat jede Einheit etwas getan? | Zeitbudget je Einheit |

Der Aufbau ist ein **Blatt** nach dem Muster der Plan-Bibliothek: fester Kopf,
fester Fuß, nur die Mitte scrollt. Auf einem Telefon bleibt „Revanche" damit
immer einen Daumen entfernt, egal wie weit jemand im Bericht gelesen hat, und
ohne zu scrollen steht der Kern da – Ausgang, Dauer und die Lebenspunkte beider
Fürsten.

- **Ausgang:** Gegen den Computer in der zweiten Person („Du siegst" / „Du
  unterliegst"), im Hotseat beim Fraktionsnamen – dort sitzen zwei Spieler am
  Gerät, „du" hätte keinen Adressaten. Aus dem Blatt blickt der Fürst des
  Siegers, nach einer Niederlage also der, gegen den man verloren hat.
- **Duell der Fürsten:** dieselben `.boss-row`-Bausteine wie im Schlacht-HUD,
  nur eingefroren. Der Endstand sieht damit aus wie der letzte Blick auf das HUD.
- **Bilanz:** Gegenüberstellung statt Kachelraster – „3 Verluste" sagt wenig,
  „3 gegen 9" alles. Jede Zeile hängt wie im Boss-HUD an ihrem Teilsystem: keine
  Turmzeile ohne Türme, keine Vorratszeile ohne Lager.
- **Truppenbericht:** je Einheit eine Karte mit Ziffer und Porträt aus der
  Planungsliste – derselbe Trupp, den der Spieler geplant und auf der Karte
  verfolgt hat. Bewusst kein Tabellenlayout: Eine Tabelle erzwingt auf 360 px
  waagerechtes Scrollen. Die gegnerische Seite steht eingeklappt darunter (nach
  der Schlacht gibt es nichts mehr geheim zu halten).
- **Sichern:** Aufmarsch benennen und in die Bibliothek legen, aus der die
  Planung lädt, oder als Teilen-Link kopieren (`plans.js`). Die Bibliothek
  selbst bleibt im Planer; hier steht nur der Eingang zu ihr. Im Hotseat gehören
  zwei Aufmärsche zur Schlacht – dann gibt es je Seite eine Zeile.

### Das Zeitbudget je Einheit

Der Balken unter jeder Einheit teilt die Schlachtdauer auf vier Eimer auf:
**Marsch**, **Kampf**, **Stellung**, **Gefallen**. Er ist die Kennzahl, die
keine Schadenszahl ersetzen kann: Eine Einheit, die 80 % der Schlacht marschiert
ist, hat kein Kampfproblem, sondern ein Wegproblem – und wer nie zuschlug,
bekommt es ausdrücklich als „nie im Kampf" gesagt, statt es in einer Null zu
verstecken.

Was auf 100 % fehlt, ist die Zeit **vor** dem Erscheinen; sie führt den Balken
schraffiert an. Nur der mächtige Verbündete hat sie, und sie gehört an den
Anfang: ans Ende gerückt sähe sie aus, als hätte er die Schlacht überlebt.

### Die Zähler dürfen den Ablauf nicht anfassen

Die Rohzahlen sammelt `sim.js` unter `stats` je Gruppe (ausgeteilter und
erlittener Schaden, vom Boss-Schild geschluckter Anteil, Todesstöße, Tode,
Zeitbudget). Sie sind **rein additiv** – nichts davon wird je zurückgelesen,
keine Entscheidung hängt daran. Der Ablauf einer Schlacht ist mit und ohne diese
Zähler derselbe; das Headless-Turnier und geteilte Aufmärsche bleiben unberührt.
Gebucht wird die Zeit an genau einer Stelle, jedem Zeitsprung der Simulation,
mit dem Zustand *vor* den Ereignissen dieses Zeitpunkts.

Zwei Zuschreibungen sind bewusst so und nicht anders:

- **Todesstöße statt „Kills":** Alle Schläge eines Zeitpunkts werden verrechnet,
  bevor Gefallene entfernt werden – wer eine Einheit „getötet" hat, ist also
  nicht eindeutig. Zugeschrieben wird der letzte Treffer in der ohnehin festen
  Angriffsreihenfolge: deterministisch und nachvollziehbar. Deshalb führt im
  Bericht der ausgeteilte Schaden, nicht die Zahl der Erschlagenen.
- **Schläge von Boss und Turm gehören niemandem.** Sie zählen beim Getroffenen
  als erlittener Schaden, aber bei keinem Trupp als ausgeteilter.

Für die Arbeit am Bildschirm selbst rechnet `?test=result` eine ganze Schlacht
in einem Zug durch und zeigt nur den Bericht – mit `&ai=<blau>,<rot>` wie bei
`?test=sim` und mit `&players=2` in der Hotseat-Fassung.

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
