# Fantasy Pinball – Prototyp

Ein für Smartphones im Hochformat gebauter Flipper-Prototyp. Das Ziel dieser
ersten Fassung ist das Spielgefühl: zwei gleichzeitig bedienbare Flipper,
stabile 2D-Physik, Bumper, Targets, ein erkennbarer Rampenweg, Score, drei
Kugeln und automatischer Neustart nach dem Drain.

## Steuerung

| Aktion | Smartphone | Desktop |
| --- | --- | --- |
| Linker Flipper | linke Spielfeldhälfte halten | `←` oder `A` |
| Rechter Flipper | rechte Spielfeldhälfte halten | `→` oder `D` |
| Beide Flipper | beide Daumen gleichzeitig | beide Tasten gleichzeitig |
| Neuer Durchgang | Button nach Game Over | `R` |

Die Touch-Flächen sind die beiden unsichtbaren Bildschirmhälften. Pointer werden
beim Aufsetzen einer Seite zugeordnet und bis zum Loslassen dort gehalten. Das
verhindert verlorene Eingaben bei zwei Daumen.

## Kleine Umbau-Demo

Das violette Runen-Target links löst genau einmal einen deklarativen
Board-Befehl aus. Ein vierter, violetter Bumper wird aktiviert und über die
Board-Präsentation ausgeklappt. Seine Matter-Kollision wird gleichzeitig
freigeschaltet. Damit führt derselbe Lebenszyklus Darstellung und Physik,
ohne die Flipperlogik umzubauen.

## Aufbau

```text
board-definition.js  deklarative Elemente, Flipper und Spawnpunkt
board.js             Registry: hinzufügen, entfernen, aktivieren, verändern,
                     animieren – ohne DOM und ohne Physikbibliothek
physics.js           Matter.js-Welt, Kugel, Collider, Fixed-Step-Schnittstelle
flippers.js          kinematische Flippersteuerung
game-state.js        Kugeln, Drain, Respawn und Game Over
scoring.js           ereignisbasiertes Punktesystem
adventure.js         schmale Campaign-/Quest-/NPC-/Unlock-Erweiterungsbrücke
game.js              Spielfassade und Ereignis-/Board-Befehlsfluss
input.js             Multi-Pointer, Tastatur und späterer Motion-Eingang
render.js            Canvas-2D-Darstellung
audio.js             synthetische, ereignisbasierte Web-Audio-Platzhalter
main.js              DOM-Verdrahtung und 240-Hz-Fixed-Step-Loop
sim/checks.js        Headless-Checks der nicht-visuellen Logik und Physik
```

`adventure.js` implementiert noch keine Kampagne. Es dokumentiert und kapselt
die vorgesehenen Erweiterungspunkte: Kapitelstart und Direktstart mit eigenem
Scoring-Scope, Quest-Ereignisse, Board-Befehle, NPC-Slots sowie dauerhafte
Mechanik-Freischaltungen. Countdown-Quests sind ausdrücklich nur eine optionale
Quest-Art.

## Physik

Matter.js 0.20 übernimmt Broadphase, Kontakte und Impulsauflösung. Der
Game-Loop läuft mit 240 Hz, begrenzt Frame-Nachholzeit und verwendet dicke
Collider. Eine maximale Kugelgeschwindigkeit hält die Auflösung kontrollierbar.
Bumper ergänzen den Kontaktimpuls gezielt; Flipper werden kinematisch um feste
Drehpunkte geführt. Der `input`-Motion-Eingang kann später eine gefilterte
Sensor-Pipeline an `game.nudge()` anschließen, ohne Eingabe oder Physik neu zu
strukturieren.

## Lokal prüfen

Vom Repository-Root:

```bash
npm install
npm run check:pinball
npm run dev
```

Danach die von Vite genannte Adresse mit
`/games/fantasy-pinball/` öffnen. Für einen Test auf dem Smartphone den
Dev-Server im lokalen Netz verfügbar machen (`npm run dev -- --host`) und die
angezeigte Netzwerkadresse vom Telefon aus öffnen.

## Grenzen des Prototyps

- Die Rampe ist ein sichtbar abgegrenzter alternativer Weg, aber noch keine
  echte Höhenebene mit Über-/Unterführung.
- Nudge/Tilt besitzt nur den technischen Eingang; Sensorberechtigung,
  Filterung, Tilt-Warnung und Straflogik fehlen.
- Grafik und Klänge sind bewusst synthetische Platzhalter.
- Campaign, Kapitel, NPC-Dialoge, Extra-Ball-Herausforderung und persistente
  Freischaltungen sind Schnittstellen, noch kein spielbarer Inhalt.
