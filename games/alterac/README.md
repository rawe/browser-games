# Alterac Combat Simulator

Taktik-Autobattler: Beide Seiten werben aus einem Ressourcenbudget eine Armee
an (drei Einheitentypen: leicht, mittel, schwer) und planen geheim für jede
Einheit einen eigenen Pfad durch das Wegpunkt-Netzwerk plus Haltung (Angriff
oder Halten). Danach läuft die Schlacht deterministisch und ohne weitere
Eingriffe ab. Wer den gegnerischen Endboss fällt, gewinnt.

## Module

| Datei        | Aufgabe |
| ------------ | ------- |
| `sim.js`     | Simulationskern (DOM-frei, deterministisch, ereignisbasiert; liefert typisierte Ereignisse für Effekte); verwaltet auch Friedhofsbesitz, Einnahmen und Türme |
| `map.js`     | Zentrale Kartenkonfiguration (Wegpunkte, Verbindungen, Friedhöfe samt Startbesitz und Heimat-Markierung, Routen, Wachposten, Turm-Standorte), Wegsuche, Friedhofswahl |
| `planner.js` | Planungsphase (Rekrutierung aus dem Budget, Pfad- und Haltungswahl pro Einheit) |
| `ai.js`      | Computergegner (datengetrieben über Einheitentypen, Routen- und Turm-Konfiguration; greift gegnerische Türme an und verteidigt eigene) |
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

In der Planung baut der Spieler den Pfad jeder Einheit Wegpunkt für Wegpunkt
über benachbarte Punkte auf – es gibt keine automatische Kürzeste-Route-Wahl
für geplante Pfade. Die Wegsuche (`shortestPath`) dient nur noch als
Rückfalllösung: für den automatischen Marsch zum gegnerischen Boss nach
abgearbeitetem Pfad und für den Rückweg nach einem Respawn. Vordefinierte
Routen (`ROUTES`) und Wachposten (`GUARD_POSTS`) sind ebenfalls zentrale
Konfigurationsdaten und werden vom Computergegner genutzt.

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

Alle Turmwerte, die Turmanzahl (`towersPerFaction`), die Schadensreduktion je
Turm (`towerDamageReduction`) und die Mindestschadensgrenze des Fürsten
(`bossDamageFloor`) stehen zentral in `config.js`. Im Setup lassen sich die
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
