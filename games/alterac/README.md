# Alterac Combat Simulator

Taktik-Autobattler: Beide Seiten planen geheim die Befehle ihrer Einheiten
(Angriffsrouten, Verteidigung, Fusion per Folgen-Befehl), danach läuft die
Schlacht deterministisch und ohne weitere Eingriffe ab. Wer den gegnerischen
Endboss fällt, gewinnt.

## Module

| Datei        | Aufgabe |
| ------------ | ------- |
| `sim.js`     | Simulationskern (DOM-frei, deterministisch, ereignisbasiert) |
| `map.js`     | Kartendaten, Wegsuche, Friedhofswahl |
| `planner.js` | Planungsphase (Befehlsvergabe pro Einheit) |
| `ai.js`      | Computergegner |
| `render.js`  | Canvas-Rendering (keine Spiellogik) |
| `main.js`    | Bildschirm-Ablauf und Render-Schleife |
| `config.js`  | Alle Kampf- und Zeitwerte |

## Begegnungskämpfe auf Wegstücken

Kämpfe finden nicht nur an Knoten statt: Treffen sich verfeindete Trupps auf
demselben Wegstück, stoppen sie am exakten Treffpunkt und kämpfen dort im
offenen Feld.

### Regeln

- **Entgegenkommende Gegner** auf derselben Kante treffen sich am rechnerisch
  exakten Punkt (beide Seiten bewegen sich gleich schnell, der Treffpunkt
  ergibt sich aus den Abfahrtszeiten) und beginnen dort einen Kampf.
- **Nachrücker greifen ein:** Jede Gruppe, die den Treffpunkt eines laufenden
  Kampfs erreicht – egal aus welcher Richtung und welcher Fraktion –, wird
  Teil dieses Kampfs.
- **Offenes Feld:** Es gibt keinen Verteidigungsbonus und keinen Boss. Beide
  Seiten teilen im gewohnten Sekundentakt gleichzeitig vollen Schaden aus
  (schwächstes Ziel zuerst). Der Bonus für eingegrabene Verteidiger bleibt
  Knoten vorbehalten – Verteidigen bleibt dadurch als Befehl attraktiv.
- **Sieger ziehen weiter:** Überlebende setzen ihre unterbrochene Bewegung ab
  dem Treffpunkt fort, mit unveränderter Richtung, Befehlskette und ihren
  restlichen Lebenspunkten. Es gibt keinen Rückzug.
- **Gefallene** zählen zum näher gelegenen Endknoten des Wegstücks und
  respawnen wie gewohnt am nächstgelegenen eigenen Friedhof.
- **Treffen exakt an einem Knoten** (Treffpunkt fällt mit einer Ankunft
  zusammen) wird nicht als Feldkampf gewertet – dort greift der normale
  Knotenkampf. So entstehen nie zwei konkurrierende Kämpfe am selben Ort.
- Gruppen **gleicher Richtung** holen einander nie ein (gleiche
  Geschwindigkeit) – außer der Vordermann steckt in einem Kampf, dann greift
  der Nachfolgende dort ein.

### Warum das Spielprinzip intakt bleibt

Die Planung bleibt vollständig im Voraus: Niemand kann ausweichen oder
umgelenkt werden, Routen bleiben exakt so gültig wie geplant. Neu ist nur,
dass sich kreuzende Routen jetzt ein taktisches Element sind – wer den
Korridor des Gegners spiegelt, riskiert eine offene Feldschlacht statt eines
freien Durchmarschs. Abfangen, Timing und Routenwahl gewinnen an Bedeutung,
ohne dass ein neuer Befehlstyp nötig ist.

### Deadlock-Betrachtung

Die Simulation ist ereignisbasiert (`nextEventTime` liefert den nächsten
relevanten Zeitpunkt). Damit sie nie hängen bleibt, gilt:

1. **Jeder Feldkampf endet garantiert.** Im offenen Feld gibt es keinen
   Verteidigungsbonus, beide Seiten verursachen jede Sekunde vollen Schaden.
   Die Summe der Lebenspunkte sinkt also streng monoton – nach endlich vielen
   Intervallen ist eine Seite (oder beide gleichzeitig) vollständig gefallen.
   Ein ewiges Patt im Stand ist unmöglich.
2. **Kampfende gibt die Bewegung frei.** Sobald eine Seite fällt, wird der
   Kampf aufgelöst und alle Überlebenden werden wieder zu normalen bewegten
   Gruppen. Es gibt keinen Zustand, aus dem eine Gruppe nicht mehr
   herauskommt; bei beidseitiger Auslöschung respawnen beide Seiten regulär.
3. **Begegnungen sind vollwertige Ereignisse.** Treffzeitpunkte und das
   Erreichen laufender Kämpfe fließen in `nextEventTime` ein. Die
   Patt-Erkennung („keine Einheit mehr in Bewegung") und das Zeitlimit
   funktionieren dadurch unverändert.
4. **Gleichzeitigkeit ist deterministisch geregelt.** Mehrere Paare, die sich
   im selben Moment am selben Punkt treffen, werden zu einem einzigen Kampf
   zusammengefasst (Fixpunkt-Schleife in `processEncounters`); am selben
   Punkt existiert nie mehr als ein Kampf. Die Verarbeitung folgt einer
   festen, reproduzierbaren Reihenfolge – gleiche Pläne ergeben immer
   denselben Schlachtverlauf.
5. **Zyklen über Respawns endet das Zeitlimit.** Spiegelbildliche Pläne können
   dazu führen, dass sich Trupps nach jedem Respawn erneut gegenseitig
   auslöschen (das gab es analog schon bei Knotenkämpfen). Solche Schleifen
   sind gewollt möglich und werden wie bisher durch `maxTime` als
   Unentschieden aufgelöst.
