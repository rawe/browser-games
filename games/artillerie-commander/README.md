# Artillerie Commander

Ein eigenständiges, rundenbasiertes 2D-Artilleriespiel, inspiriert vom Spielprinzip klassischer DOS-Artilleriespiele. Sämtliche Grafik wird zur Laufzeit im Canvas gezeichnet; es werden keine Originalassets verwendet.

## Spielen

- Pfeiltasten oder Bildschirmtasten: Winkel und Ladung
- Breite virtuelle Rollen: horizontal ziehen; langsames Ziehen arbeitet fein, schnelles Loslassen gibt gedämpften Nachlauf
- `Tab` oder Waffenknopf: verfügbare Waffe wechseln
- Leertaste oder **FEUER**: schießen
- Ein-Finger-Wischen beziehungsweise Mausziehen: Kamera verschieben
- Zwei-Finger-Geste beziehungsweise Mausrad: zoomen
- `◎`: Kamera auf den aktiven Panzer setzen
- Lokal spielen 1–4 Menschen im Hot-Seat gegen 1–4 Computergegner (maximal sechs Panzer)

Wind, Schwerkraft und das pro Runde erzeugte Gelände beeinflussen die Flugbahn. Explosionen schlagen Krater, der Erdformer baut Gelände auf. Geschosse zünden bei Kontakt mit der Trefferfläche eines Panzers. Abschüsse und Rundensiege bringen Credits für Spezialmunition.

Vor der Partie stehen drei Randregeln zur Wahl: Ohne Wände verlassen Geschosse das Feld und Panzer können aus der Welt fallen. Feste Wände lassen Geschosse am Rand explodieren und tragen Panzer am Boden. Spiegelwände reflektieren Geschosse. Die optionale Zielhilfe zeigt nur den ersten Flugabschnitt; die ebenfalls optionale letzte Flugbahn wird für jeden Spieler getrennt gespeichert. Eine weitere Option löst beim Tod eines Panzers eine zufällige Todes-Salve aus, ohne dessen Vorrat zu verbrauchen.

## Aufbau

`game.js` enthält die DOM-freie Simulation: Terrain, Krater, Spieler, Geschosse, Schaden und Zielsuche der KI. `main.js` verbindet sie mit Canvas, Eingabe, Zugfolge, Effekten und Einkaufsphase. Dadurch lassen sich die Kernregeln direkt mit Node prüfen:

```bash
npm run check:artillerie
```

## Umfang dieser ersten Version

Enthalten sind vierzehn Waffen beziehungsweise Größenstufen in fünf Shop-Kategorien: vier Sprengsätze, MIRV-Cluster mit drei, fünf oder sieben Köpfen, Kettenbohrer, zwei Säureklassen, drei Erdformer und ein energiebasierter Laser. Jede Familie besitzt einen eigenen Einschlagseffekt. Erdformer begraben Panzer, statt sie auf den neuen Berg zu setzen; bei einer Kollision in der Luft fällt die Erdkugel erst auf den Boden. Säure zersetzt ein zufälliges Muster, anschließend fällt die nicht aufgelöste Erde auf den Restboden. Der Laser bleibt entsprechend der eingesetzten Energie aktiv, schneidet durch Berge und wird von lebenden Panzern aufgehalten. Seine abgetrennte obere Erdschicht bleibt erhalten und sackt erst am Strahlende auf den Untergrund. Hinzu kommen zufällige, fair verteilte Startpositionen, lokale Mehrspielerpartien, kaufende und Spezialwaffen nutzende Computergegner, zufälliger Wind, zerstörbares Höhenfeld-Terrain, Fallschaden, drei Randmodi, eine schwenk- und zoombare Kamera, optionale Schusshilfen, Todes-Salven, Rundenwertung und eine Kaufrunde vor dem ersten Gefecht. Teamspiel, Leitsysteme, Verteidigung und gespeicherte Matchserien sind sinnvolle spätere Ausbaustufen.
