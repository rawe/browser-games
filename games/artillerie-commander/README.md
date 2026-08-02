# Artillerie Commander

Ein eigenständiges, rundenbasiertes 2D-Artilleriespiel, inspiriert vom Spielprinzip klassischer DOS-Artilleriespiele. Sämtliche Grafik wird zur Laufzeit im Canvas gezeichnet; es werden keine Originalassets verwendet.

## Spielen

- Pfeiltasten oder Bildschirmtasten: Winkel und Ladung
- `Tab` oder Waffenknopf: verfügbare Waffe wechseln
- Leertaste oder **FEUER**: schießen
- Lokal spielen 1–4 Menschen im Hot-Seat gegen 1–4 Computergegner (maximal sechs Panzer)

Wind, Schwerkraft und das pro Runde erzeugte Gelände beeinflussen die Flugbahn. Explosionen schlagen Krater, der Erdformer baut Gelände auf. Abschüsse und Rundensiege bringen Credits für Spezialmunition.

## Aufbau

`game.js` enthält die DOM-freie Simulation: Terrain, Krater, Spieler, Geschosse, Schaden und Zielsuche der KI. `main.js` verbindet sie mit Canvas, Eingabe, Zugfolge, Effekten und Einkaufsphase. Dadurch lassen sich die Kernregeln direkt mit Node prüfen:

```bash
npm run check:artillerie
```

## Umfang dieser ersten Version

Enthalten sind sechs deutlich verschiedene Waffen, lokale Mehrspielerpartien, Computergegner, zufälliger Wind, zerstörbares Höhenfeld-Terrain, Fallschaden, Rundenwertung und Einkauf. Weitere Waffen, Teamspiel, Leitsysteme, Verteidigung und gespeicherte Matchserien sind sinnvolle spätere Ausbaustufen.
